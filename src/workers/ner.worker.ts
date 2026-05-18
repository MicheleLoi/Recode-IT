/**
 * ner.worker.ts — Web Worker running the DistilBERT Italian NER ONNX model
 * off the main thread.
 *
 * Replaces the previous GLiNER (span-based, English-primary) worker. The new
 * model is `osiria/distilbert-italian-cased-ner` — a standard token-
 * classification head over 5 labels in IO scheme:
 *
 *     id2label = { 0: 'O', 1: 'PER', 2: 'LOC', 3: 'ORG', 4: 'MISC' }
 *
 * Inputs/outputs of the exported graph:
 *     input_ids       int64 [B, L]
 *     attention_mask  int64 [B, L]
 *     logits          float [B, L, 5]
 *
 * Decoding (must mirror scripts/sanity_check_onnx.py — that script is the
 * Python ground truth):
 *   1. softmax over the last axis → per-token class probabilities
 *   2. argmax → predicted label id; gather the corresponding probability
 *   3. greedy IO-scheme span merge:
 *        - tokens carrying the same non-O label that are separated by
 *          whitespace only (or zero gap, for WordPiece continuations) merge
 *          into a single span
 *        - a different label, non-whitespace gap (e.g. punctuation), or an
 *          'O' token closes the active span
 *   4. drop MISC (legacy WikiNER catch-all, low value for legal use); map
 *        PER → persona, LOC → luogo, ORG → organizzazione
 *   5. per-category confidence threshold (min token-prob inside the span)
 *
 * Protocol (main ↔ worker) — unchanged from the GLiNER worker for drop-in
 * runner compatibility:
 *   { type: 'init',    payload: { modelUrl: string } }
 *     → { type: 'ready' } | { type: 'error', error: string }
 *
 *   { type: 'predict', payload: { id: string, chunkText: string,
 *                                 entityLabels?: string[], threshold?: number } }
 *     → { type: 'result', id, entities: NerDetection[] }
 *     | { type: 'error',  id, error: string }
 *
 *   { type: 'terminate' }
 *     → (worker self-closes)
 *
 * Progress messages are emitted during init with phases:
 *   'wasm'     — WASM runtime importing (before fetch starts)
 *   'download' — model bytes being fetched (loaded/total meaningful)
 *   'session'  — InferenceSession.create() running (post-download)
 *
 * Error sentinels (preserved from prior worker):
 *   ERR_MODEL_NOT_FOUND — model file missing (operational; expected before
 *                         founder runs the export+deploy script)
 *   ERR_BACKEND_INIT    — onnxruntime-web / tokenizer failed to load
 *                         (technical bug)
 */

import { isStoplist } from '../engine/stoplist'
import type { NerDetection } from '../types/engine'

/* eslint-disable @typescript-eslint/no-explicit-any */

type InitMessage = { type: 'init'; payload: { modelUrl: string } }
type PredictMessage = {
  type: 'predict'
  payload: {
    id: string
    chunkText: string
    /** Reserved for future fine-grained tuning; ignored in the current
     * implementation because the model's label inventory is fixed. */
    entityLabels?: string[]
    /** Override the per-category threshold floor (applies to all classes). */
    threshold?: number
  }
}
type TerminateMessage = { type: 'terminate' }
type IncomingMessage = InitMessage | PredictMessage | TerminateMessage

type ReadyOut = { type: 'ready' }
type ResultOut = { type: 'result'; id: string; entities: NerDetection[] }
type ErrorOut = { type: 'error'; id?: string; error: string }
type ProgressOut = {
  type: 'progress'
  phase: 'wasm' | 'download' | 'session'
  loaded: number
  total: number
}
type OutgoingMessage = ReadyOut | ResultOut | ErrorOut | ProgressOut

/**
 * Raw → schema label mapping. MISC is intentionally absent: the model emits
 * a noisy "miscellaneous" class trained on WikiNER, which has low precision
 * on legal text. Dropping it costs ~zero recall on the categories that
 * matter (PER/LOC/ORG) and reduces false positives downstream.
 */
const LABEL_MAP: Record<string, string> = {
  PER: 'persona',
  LOC: 'luogo',
  ORG: 'organizzazione',
}

/**
 * Per-category confidence threshold floor (min token probability inside the
 * merged span). Tuned from the Python sanity check:
 *   - persona/luogo at 0.40: rescues low-confidence single-token names
 *     ("Tizio", "Roma") without admitting noise
 *   - organizzazione at 0.55: legal text has many proper-noun-like
 *     fragments the model wants to tag ORG (legal Latin, court names);
 *     a slightly higher floor keeps precision honest
 */
const THRESHOLDS: Record<string, number> = {
  persona: 0.4,
  luogo: 0.4,
  organizzazione: 0.55,
}

/**
 * Fallback when the caller passes a custom `threshold`: applied uniformly
 * across all classes (replaces THRESHOLDS for that single call).
 */
const DEFAULT_FALLBACK_THRESHOLD = 0.4

/** id2label — must match public/models/config.json exactly. */
const ID2LABEL: Record<number, string> = {
  0: 'O',
  1: 'PER',
  2: 'LOC',
  3: 'ORG',
  4: 'MISC',
}

let session: any = null
let tokenizer: any = null

const ERR_MODEL_NOT_FOUND = 'ERR_MODEL_NOT_FOUND'
const ERR_BACKEND_INIT = 'ERR_BACKEND_INIT'

function postProgress(phase: ProgressOut['phase'], loaded: number, total: number): void {
  const msg: ProgressOut = { type: 'progress', phase, loaded, total }
  ;(self as any).postMessage(msg)
}

/**
 * Fetch a URL with streaming progress reporting. Identical contract to the
 * helper that lived in the prior worker.
 */
async function fetchModelWithProgress(
  url: string,
  onProgress: (loaded: number, total: number) => void,
): Promise<ArrayBuffer> {
  const response = await fetch(url)
  const ct = response.headers.get('content-type') ?? ''
  const isMissing =
    response.status === 404 ||
    (response.ok && (ct.startsWith('text/html') || ct.startsWith('text/plain')))
  if (isMissing) {
    throw new Error(`${ERR_MODEL_NOT_FOUND}: ${url}`)
  }
  if (!response.ok) {
    throw new Error(`${ERR_MODEL_NOT_FOUND}: HTTP ${response.status} for ${url}`)
  }

  const contentLength = response.headers.get('content-length')
  const total = contentLength ? parseInt(contentLength, 10) : 0

  if (!response.body) {
    const buf = await response.arrayBuffer()
    onProgress(buf.byteLength, buf.byteLength)
    return buf
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  let done = false

  while (!done) {
    const result = await reader.read()
    done = result.done
    if (!done && result.value) {
      chunks.push(result.value)
      loaded += result.value.byteLength
      onProgress(loaded, total || loaded)
    }
  }

  const result = new Uint8Array(loaded)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result.buffer
}

async function init(modelUrl: string): Promise<void> {
  // Dynamic imports — kept lazy so test environments without the heavyweight
  // WASM runtime never touch them. NOTE: do NOT add /* @vite-ignore */ here —
  // Vite must resolve and code-split these modules so the worker bundle and
  // the lazily-loaded ort chunk share a single `onnxruntime-common` instance.
  // Without that, ort's backend registration writes into one module copy and
  // the consumer reads from another, surfacing as
  //   "Cannot read properties of undefined (reading 'registerBackend')"
  // at the first `InferenceSession.create` call.
  postProgress('wasm', 0, 0)

  let ort: any
  let transformers: any
  try {
    ort = await import('onnxruntime-web')
    transformers = await import('@xenova/transformers')
  } catch (err) {
    throw new Error(`${ERR_BACKEND_INIT}: ${(err as Error).message ?? String(err)}`)
  }

  // Point ort at the wasm runtime files copied into `public/ort/` by the
  // `copyOrtWasmPlugin` in vite.config.ts. Without an explicit wasmPaths, ort
  // tries to resolve wasm via the importing module's URL — which in a Vite
  // module-worker context resolves to a hashed asset path that doesn't host
  // the wasm files, leading to silent fetch failures and "registerBackend on
  // undefined" downstream.
  if (ort?.env?.wasm) {
    ort.env.wasm.wasmPaths = '/ort/'
    if (typeof SharedArrayBuffer === 'undefined') {
      ort.env.wasm.numThreads = 1
    }
  }

  // Configure transformers.js to NOT auto-download models from HF — we serve
  // tokenizer artefacts alongside our ONNX file.
  ;(transformers as any).env.allowRemoteModels = false
  ;(transformers as any).env.localModelPath = new URL('./', modelUrl).toString()

  // Phase: fetch the model with streaming progress.
  let modelBuffer: ArrayBuffer
  try {
    postProgress('download', 0, 0)
    modelBuffer = await fetchModelWithProgress(modelUrl, (loaded, total) => {
      postProgress('download', loaded, total)
    })
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err)
    if (msg.startsWith(ERR_MODEL_NOT_FOUND)) throw err
    throw new Error(`${ERR_MODEL_NOT_FOUND}: ${msg}`)
  }

  postProgress('session', 0, 0)
  try {
    session = await ort.InferenceSession.create(modelBuffer, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    })
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err)
    if (/404|not.?found|failed to fetch/i.test(msg)) {
      throw new Error(`${ERR_MODEL_NOT_FOUND}: ${modelUrl}`)
    }
    throw new Error(`${ERR_BACKEND_INIT}: ${msg}`)
  }

  // Tokenizer location: same directory as the model URL.
  const tokenizerDir = new URL('./', modelUrl).toString()
  tokenizer = await (transformers as any).AutoTokenizer.from_pretrained(tokenizerDir)
}

/* ─────────────────────────────────────────────────────────────────────────
 * Math helpers
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Row-wise softmax over a [L, C] block stored as a flat Float32Array of
 * length L*C (the ONNX logits tensor, after slicing the batch axis). Writes
 * the result into `out` (same length). Numerically stable: subtracts the
 * row max before exp().
 */
function softmaxRows(data: Float32Array, L: number, C: number, out: Float32Array): void {
  for (let i = 0; i < L; i += 1) {
    const base = i * C
    let max = -Infinity
    for (let c = 0; c < C; c += 1) {
      const v = data[base + c]!
      if (v > max) max = v
    }
    let sum = 0
    for (let c = 0; c < C; c += 1) {
      const e = Math.exp((data[base + c] ?? 0) - max)
      out[base + c] = e
      sum += e
    }
    const inv = sum > 0 ? 1 / sum : 0
    for (let c = 0; c < C; c += 1) {
      out[base + c] = (out[base + c] ?? 0) * inv
    }
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * Tokenization + decode
 *
 * We rely on Transformers.js's tokenizer to produce both input_ids and the
 * per-subtoken offset_mapping. The offsets let us reconstruct char-level
 * spans even when WordPiece splits a word into multiple subtokens (e.g.
 * "S.r.l." → "S", ".", "r", ".", "l", ".").
 * ──────────────────────────────────────────────────────────────────────── */

type TokenizerOutput = {
  inputIds: number[]
  attentionMask: number[]
  offsets: Array<[number, number]>
  specialMask: number[]
}

/**
 * Pull input_ids / attention_mask / offset_mapping / special_tokens_mask out
 * of a Transformers.js tokenizer call. The shape Transformers.js returns
 * differs subtly between versions; we accept both:
 *   - Tensor-like objects with .data + .dims  (newer versions)
 *   - Plain nested arrays / Int*Array         (older versions)
 */
function unwrapToArray(maybeTensor: any): number[] {
  if (!maybeTensor) return []
  // Transformers.js Tensor — `.data` is a TypedArray, dims include batch.
  if (typeof maybeTensor === 'object' && 'data' in maybeTensor && 'dims' in maybeTensor) {
    const data = (maybeTensor as any).data as ArrayLike<number | bigint>
    const out: number[] = new Array(data.length)
    for (let i = 0; i < data.length; i += 1) {
      const v = data[i]
      out[i] = typeof v === 'bigint' ? Number(v) : (v as number)
    }
    return out
  }
  // Nested array [[...]] — flatten one level for batch=1.
  if (Array.isArray(maybeTensor) && Array.isArray(maybeTensor[0])) {
    return (maybeTensor[0] as Array<number | bigint>).map((v) =>
      typeof v === 'bigint' ? Number(v) : (v as number),
    )
  }
  // Flat array / TypedArray.
  if (Array.isArray(maybeTensor) || ArrayBuffer.isView(maybeTensor)) {
    const arr = Array.from(maybeTensor as ArrayLike<number | bigint>) as Array<number | bigint>
    return arr.map((v) => (typeof v === 'bigint' ? Number(v) : (v as number)))
  }
  return []
}

/**
 * Some Transformers.js builds return `offset_mapping` as an array of
 * `[start, end]` pairs, others as a flat [B, L, 2] tensor. Normalise to
 * `Array<[number, number]>`.
 */
function unwrapOffsets(raw: any, length: number): Array<[number, number]> {
  if (!raw) return new Array(length).fill([0, 0])
  // Tensor case: { data, dims }
  if (typeof raw === 'object' && 'data' in raw && 'dims' in raw) {
    const data = raw.data as ArrayLike<number | bigint>
    const out: Array<[number, number]> = new Array(length)
    for (let i = 0; i < length; i += 1) {
      const a = data[i * 2]
      const b = data[i * 2 + 1]
      out[i] = [
        typeof a === 'bigint' ? Number(a) : (a as number) ?? 0,
        typeof b === 'bigint' ? Number(b) : (b as number) ?? 0,
      ]
    }
    return out
  }
  // Nested array [[[s,e], [s,e], ...]] for batch=1.
  if (Array.isArray(raw) && Array.isArray(raw[0]) && Array.isArray(raw[0][0])) {
    return (raw[0] as Array<[number, number]>).map(
      ([s, e]) => [Number(s ?? 0), Number(e ?? 0)] as [number, number],
    )
  }
  // Already flat [[s,e], ...].
  if (Array.isArray(raw) && Array.isArray(raw[0])) {
    return (raw as Array<[number, number]>).map(
      ([s, e]) => [Number(s ?? 0), Number(e ?? 0)] as [number, number],
    )
  }
  return new Array(length).fill([0, 0])
}

function tokenize(text: string): TokenizerOutput {
  // Transformers.js >=2.17 callable: tokenizer(text, opts)
  const enc = (tokenizer as any)(text, {
    return_offsets_mapping: true,
    return_special_tokens_mask: true,
  })
  const inputIds = unwrapToArray(enc.input_ids)
  const attentionMask = unwrapToArray(enc.attention_mask)
  const specialMask = unwrapToArray(enc.special_tokens_mask)
  const offsets = unwrapOffsets(enc.offset_mapping, inputIds.length)
  // Defensive: pad missing specialMask with zeros so we still process tokens.
  while (specialMask.length < inputIds.length) specialMask.push(0)
  return { inputIds, attentionMask, offsets, specialMask }
}

function bigInt64(arr: number[]): BigInt64Array {
  const out = new BigInt64Array(arr.length)
  for (let i = 0; i < arr.length; i += 1) {
    out[i] = BigInt(arr[i] ?? 0)
  }
  return out
}

/* ─────────────────────────────────────────────────────────────────────────
 * Greedy IO-scheme decoder
 *
 * Mirrors the Python sanity check loop in scripts/sanity_check_onnx.py.
 * Returns raw spans before stoplist filtering and overlap resolution.
 * ──────────────────────────────────────────────────────────────────────── */

type RawSpan = { start: number; end: number; rawLabel: string; minScore: number }

function decodeIoScheme(
  text: string,
  predIds: Int32Array | number[],
  predScores: Float32Array | number[],
  offsets: Array<[number, number]>,
  specialMask: number[],
): RawSpan[] {
  const spans: RawSpan[] = []
  let active: RawSpan | null = null

  const close = () => {
    if (active) spans.push(active)
    active = null
  }

  for (let i = 0; i < predIds.length; i += 1) {
    if (specialMask[i] === 1) {
      close()
      continue
    }
    const offset = offsets[i] ?? [0, 0]
    const s = offset[0]
    const e = offset[1]
    if (s === 0 && e === 0) {
      close()
      continue
    }
    const rawLabel = ID2LABEL[Number(predIds[i])] ?? 'O'
    if (rawLabel === 'O') {
      close()
      continue
    }
    const score = Number(predScores[i] ?? 0)
    if (active === null) {
      active = { start: s, end: e, rawLabel, minScore: score }
      continue
    }
    // Bridge whitespace-only gap and same label → extend.
    const gap = text.slice(active.end, s)
    const gapIsWhitespace = gap.length === 0 || gap.trim() === ''
    if (active.rawLabel === rawLabel && gapIsWhitespace) {
      active = {
        start: active.start,
        end: e,
        rawLabel,
        minScore: Math.min(active.minScore, score),
      }
      continue
    }
    // Different label or non-whitespace gap (punctuation) → close + open.
    close()
    active = { start: s, end: e, rawLabel, minScore: score }
  }
  close()
  return spans
}

/* ─────────────────────────────────────────────────────────────────────────
 * Prediction
 * ──────────────────────────────────────────────────────────────────────── */

async function predictChunk(
  text: string,
  thresholdOverride?: number,
): Promise<NerDetection[]> {
  if (!session || !tokenizer) {
    throw new Error('NER worker not initialized — call init() first')
  }
  if (!text || text.trim().length === 0) return []

  const ort = await import('onnxruntime-web')

  const enc = tokenize(text)
  const L = enc.inputIds.length
  if (L === 0) return []

  // Build feeds. The exported graph takes int64 tensors.
  const feeds: Record<string, any> = {
    input_ids: new ort.Tensor('int64', bigInt64(enc.inputIds), [1, L]),
    attention_mask: new ort.Tensor('int64', bigInt64(enc.attentionMask), [1, L]),
  }

  const output = await session.run(feeds)
  const logitsTensor: any = output.logits ?? output[Object.keys(output)[0] ?? 'logits']
  if (!logitsTensor) {
    throw new Error(
      `NER ONNX output missing 'logits'. Got keys: ${Object.keys(output).join(',')}`,
    )
  }
  const dims = logitsTensor.dims as number[]
  if (dims.length !== 3) {
    throw new Error(`NER ONNX logits expected 3D, got dims=[${dims.join(',')}]`)
  }
  const C = dims[2] as number
  const data: Float32Array = logitsTensor.data
  const probs = new Float32Array(L * C)
  softmaxRows(data, L, C, probs)

  // argmax + gather score
  const predIds = new Int32Array(L)
  const predScores = new Float32Array(L)
  for (let i = 0; i < L; i += 1) {
    let best = 0
    let bestProb = -1
    const base = i * C
    for (let c = 0; c < C; c += 1) {
      const v = probs[base + c]!
      if (v > bestProb) {
        bestProb = v
        best = c
      }
    }
    predIds[i] = best
    predScores[i] = bestProb
  }

  // IO-scheme decode → raw spans (model labels, char offsets).
  const rawSpans = decodeIoScheme(text, predIds, predScores, enc.offsets, enc.specialMask)

  // Map labels + threshold filter + assemble NerDetection.
  const out: NerDetection[] = []
  for (const raw of rawSpans) {
    const mapped = LABEL_MAP[raw.rawLabel]
    if (!mapped) continue // drop MISC
    const threshold =
      typeof thresholdOverride === 'number'
        ? thresholdOverride
        : (THRESHOLDS[mapped] ?? DEFAULT_FALLBACK_THRESHOLD)
    if (raw.minScore < threshold) continue
    out.push({
      start: raw.start,
      end: raw.end,
      label: mapped,
      text: text.slice(raw.start, raw.end),
      score: raw.minScore,
    })
  }
  return out
}

async function predict(payload: PredictMessage['payload']): Promise<NerDetection[]> {
  const { chunkText, threshold } = payload
  const detections = await predictChunk(chunkText, threshold)

  // Overlap resolution: sort by score desc, greedy accept.
  detections.sort((a, b) => b.score - a.score)
  const accepted: NerDetection[] = []
  for (const span of detections) {
    const overlaps = accepted.some((a) => span.start < a.end && span.end > a.start)
    if (!overlaps) accepted.push(span)
  }

  // Phase 1 stoplist filter (legal role phrases, false-positive patterns).
  return accepted.filter((s) => !isStoplist(s.text))
}

self.onmessage = async (event: MessageEvent<IncomingMessage>) => {
  const msg = event.data
  try {
    if (msg.type === 'init') {
      await init(msg.payload.modelUrl)
      const out: ReadyOut = { type: 'ready' }
      ;(self as any).postMessage(out)
      return
    }

    if (msg.type === 'predict') {
      const entities = await predict(msg.payload)
      const out: ResultOut = { type: 'result', id: msg.payload.id, entities }
      ;(self as any).postMessage(out)
      return
    }

    if (msg.type === 'terminate') {
      ;(self as any).close?.()
      return
    }
  } catch (err) {
    const out: ErrorOut = {
      type: 'error',
      id: (msg as any)?.payload?.id,
      error: (err as Error)?.message ?? String(err),
    }
    ;(self as any).postMessage(out)
  }
}

export type { IncomingMessage, OutgoingMessage, ProgressOut, NerDetection }
