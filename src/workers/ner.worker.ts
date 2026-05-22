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

type InitMessage = { type: 'init'; payload: { modelUrl: string; language?: string } }
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

/**
 * id2label by language — must match each model's `config.json` exactly.
 *
 * IT (DistilBERT-italian-cased): 5-class IO scheme.
 * EN (Xenova/bert-base-NER from dslim): 9-class BIO scheme — B-/I- prefixes
 * are normalized away at decode time so the same IO-style decoder handles
 * both. Same for DE/FR when they ship.
 */
const ID2LABEL_BY_LANG: Record<string, Record<number, string>> = {
  it: {
    0: 'O',
    1: 'PER',
    2: 'LOC',
    3: 'ORG',
    4: 'MISC',
  },
  en: {
    0: 'O',
    1: 'B-MISC',
    2: 'I-MISC',
    3: 'B-PER',
    4: 'I-PER',
    5: 'B-ORG',
    6: 'I-ORG',
    7: 'B-LOC',
    8: 'I-LOC',
  },
}

/** Active model's id2label — set during init(), defaults to Italian. */
let ID2LABEL: Record<number, string> = ID2LABEL_BY_LANG.it!

/**
 * Active language code — set during init(). Drives downstream decisions
 * that depend on the model architecture, e.g. whether to attach
 * `token_type_ids` to the ORT feeds (BERT-family yes, DistilBERT no).
 */
let CURRENT_LANG: string = 'it'

/**
 * Strip BIO scheme prefix (`B-` / `I-`) to obtain the base entity class.
 * Models like `dslim/bert-base-NER` emit `B-PER`/`I-PER`; the legacy
 * Italian model emits the bare `PER`. This normalization lets the
 * downstream IO-decoder + LABEL_MAP lookup work for both schemes.
 *
 * Collapsing B-/I- to a single class loses the "new entity vs continuation"
 * signal that BIO encodes — in practice this only matters when two
 * different entities of the same class appear adjacent (e.g. "Mr. Smith,
 * Ms. Jones" with no separator). For legal documents these adjacencies
 * are rare and recoverable via manual annotation (Fix 1A).
 */
function normalizeRawLabel(raw: string): string {
  return raw.replace(/^[BI]-/, '')
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
 * Send a diagnostic log message to the main thread. The main thread's
 * NerRunner relays this to `console.log` so the worker's view of the
 * world is visible via the regular DevTools console — workers' own
 * console output is not always captured by remote inspection tools.
 */
function postDiag(label: string, payload: any): void {
  try {
    ;(self as any).postMessage({ type: 'log', label, payload })
  } catch {
    /* postMessage can fail with non-cloneable values — best-effort. */
  }
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

async function init(modelUrl: string, language: string = 'it'): Promise<void> {
  // Switch id2label to the active language. Unknown languages fall back to
  // the Italian map (degrades gracefully — at worst the new model's labels
  // won't decode meaningfully, but init won't crash).
  ID2LABEL = ID2LABEL_BY_LANG[language] ?? ID2LABEL_BY_LANG.it!
  CURRENT_LANG = language
  postDiag('[NER-WORKER] init start', { modelUrl, language, id2labelKeys: Object.keys(ID2LABEL).length })
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

  // Configure transformers.js to load tokenizer artefacts from the same
  // directory as the model URL (where the agent's export script wrote them
  // alongside the ONNX file).
  //
  // `allowRemoteModels: true` is required because transformers.js classifies
  // any `http(s)://` URL as "remote" — including same-origin localhost URLs.
  // The "remote" gate exists to block uncontrolled HuggingFace downloads;
  // it does NOT happen here because `localModelPath` pins the fetch to our
  // explicit URL (not the HF hub).
  //
  // Defensive URL resolution: resolve any relative modelUrl against the
  // worker's own location before using it as a base for `new URL('./', ...)`.
  ;(transformers as any).env.allowRemoteModels = true
  ;(transformers as any).env.localModelPath = new URL(
    './',
    new URL(modelUrl, self.location.href),
  ).toString()

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
    postDiag('[NER-WORKER] session created', {
      inputNames: session.inputNames,
      outputNames: session.outputNames,
      inputType: typeof session.inputNames,
      inputIsArray: Array.isArray(session.inputNames),
    })
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err)
    if (/404|not.?found|failed to fetch/i.test(msg)) {
      throw new Error(`${ERR_MODEL_NOT_FOUND}: ${modelUrl}`)
    }
    throw new Error(`${ERR_BACKEND_INIT}: ${msg}`)
  }

  // Tokenizer location: same directory as the model URL.
  // transformers.js `from_pretrained(modelName)` constructs URLs as
  // `${env.localModelPath}/${modelName}/{file}`. Passing a full URL as
  // modelName produces a malformed path (concatenation, not substitution).
  // The correct split is: localModelPath = the PARENT of the tokenizer dir
  // (typically the origin + a base prefix), modelName = the LAST path
  // segment that contains the tokenizer files.
  //
  // We re-derive everything from `modelUrl` so the same logic works for any
  // hosting layout (dev `/models/...`, prod `https://.../recode-it/models/...`).
  const absoluteModelUrl = new URL(modelUrl, self.location.href)
  // Drop the model filename → `<origin>/<...>/<tokenizerDir>/`
  const tokenizerDirUrl = new URL('./', absoluteModelUrl)
  // The tokenizer "model name" is the last directory segment.
  const tokenizerName = tokenizerDirUrl.pathname.replace(/\/$/, '').split('/').pop() || ''
  // The localModelPath is the parent of the tokenizer directory.
  const localBase = new URL('../', tokenizerDirUrl).toString()
  ;(transformers as any).env.localModelPath = localBase
  tokenizer = await (transformers as any).AutoTokenizer.from_pretrained(tokenizerName)
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
/**
 * Reconstruct per-token character offsets and a special-tokens mask from the
 * raw input_ids by walking the original text.
 *
 * Why: @xenova/transformers 2.17 silently ignores `return_offsets_mapping`
 * and `return_special_tokens_mask` for BERT/DistilBERT tokenizers — verified
 * by source-grep over node_modules/@xenova/transformers/src/tokenizers.js
 * (0 matches for offset_mapping). The Python `transformers` library produces
 * offsets via the Rust "fast" tokenizer; the JS port has no equivalent.
 *
 * Without offsets, the IO decoder's `s === 0 && e === 0` skip-sentinel
 * triggered on every token → entities: [] for every prediction.
 *
 * Strategy: DistilBERT-Italian is WordPiece with `##` continuation. Walk the
 * source text with a cursor:
 *   - special id (CLS/SEP/PAD/MASK) → specialMask=1, offset [0,0];
 *   - surface starts with '##' → glue to previous, no whitespace skip;
 *   - otherwise → skip whitespace, match surface at cursor, advance.
 * Fallback (case-insensitive scan within +64 chars) handles rare unicode
 * normalisation drift. Unmatched token → emit [0,0] (decoder skips), keep
 * cursor unchanged — losing one span is better than crashing.
 */
function reconstructOffsetsAndSpecialMask(
  text: string,
  inputIds: number[],
): { offsets: Array<[number, number]>; specialMask: number[] } {
  const tok: any = tokenizer
  const specialIds = new Set<number>()
  for (const k of [
    'cls_token_id', 'sep_token_id', 'pad_token_id',
    'mask_token_id', 'bos_token_id', 'eos_token_id',
  ]) {
    const v = tok?.[k]
    if (typeof v === 'number') specialIds.add(v)
  }

  let tokens: string[]
  try {
    tokens = tok.model.convert_ids_to_tokens(inputIds)
  } catch {
    tokens = inputIds.map(() => '')
  }

  const offsets: Array<[number, number]> = new Array(inputIds.length)
  const specialMask: number[] = new Array(inputIds.length).fill(0)
  let cursor = 0
  const norm = (s: string): string => s.toLowerCase()

  for (let i = 0; i < inputIds.length; i += 1) {
    const id = inputIds[i] as number
    const surfaceRaw = tokens[i] ?? ''

    if (specialIds.has(id)) {
      specialMask[i] = 1
      offsets[i] = [0, 0]
      continue
    }
    const isContinuation = surfaceRaw.startsWith('##')
    const surface = isContinuation ? surfaceRaw.slice(2) : surfaceRaw
    if (surface.length === 0) { offsets[i] = [0, 0]; continue }

    if (!isContinuation) {
      while (cursor < text.length && /\s/.test(text.charAt(cursor))) cursor += 1
    }

    let start = -1
    if (text.substr(cursor, surface.length) === surface) {
      start = cursor
    } else if (norm(text.substr(cursor, surface.length)) === norm(surface)) {
      start = cursor
    } else {
      const horizon = Math.min(text.length, cursor + 64)
      const idx = text.toLowerCase().indexOf(norm(surface), cursor)
      if (idx !== -1 && idx < horizon) start = idx
    }

    if (start === -1) { offsets[i] = [0, 0]; continue }
    const end = start + surface.length
    offsets[i] = [start, end]
    cursor = end
  }

  return { offsets, specialMask }
}

function tokenize(text: string): TokenizerOutput {
  // @xenova/transformers 2.17 silently ignores return_offsets_mapping /
  // return_special_tokens_mask for BERT/DistilBERT tokenizers, so we don't
  // pass them and reconstruct manually below from the input_ids surface.
  const enc = (tokenizer as any)(text)
  const inputIds = unwrapToArray(enc.input_ids)
  const attentionMask = unwrapToArray(enc.attention_mask)
  const { offsets, specialMask } = reconstructOffsetsAndSpecialMask(text, inputIds)
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
    const rawLabelFull = ID2LABEL[Number(predIds[i])] ?? 'O'
    const rawLabel = normalizeRawLabel(rawLabelFull)
    if (rawLabel === 'O') {
      close()
      continue
    }
    const score = Number(predScores[i] ?? 0)
    // BIO signal: B- prefix means "new entity starts here", even when the
    // base class matches the active span. Close the active span and open
    // a new one to preserve adjacency boundaries.
    const isBPrefix = rawLabelFull.startsWith('B-')
    if (isBPrefix && active !== null) {
      close()
    }
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
  //
  // BERT-family models (e.g. Xenova/bert-base-NER for English) require a
  // third input `token_type_ids` — a sequence of zeros for single-sentence
  // tasks. DistilBERT-family models (e.g. osiria/distilbert-italian-cased-ner)
  // do NOT take this input. We decide based on the active language rather
  // than introspecting `session.inputNames` because the onnxruntime-web
  // ReadonlyArray exposed there does not always report as a plain JS Array
  // and the introspection-based path silently produced empty feeds.
  //
  // Single source of truth for "which language uses which architecture":
  // tracked alongside ID2LABEL_BY_LANG via CURRENT_LANG, set by init().
  const isBertFamily = CURRENT_LANG !== 'it'
  const feeds: Record<string, any> = {
    input_ids: new ort.Tensor('int64', bigInt64(enc.inputIds), [1, L]),
    attention_mask: new ort.Tensor('int64', bigInt64(enc.attentionMask), [1, L]),
  }
  if (isBertFamily) {
    feeds.token_type_ids = new ort.Tensor('int64', new BigInt64Array(L), [1, L])
  }
  postDiag('[NER-WORKER] predictChunk feeds prepared', {
    lang: CURRENT_LANG,
    L,
    feedKeys: Object.keys(feeds),
    inputNamesAtRunTime: (session as any).inputNames,
    firstTokens: enc.inputIds.slice(0, 8),
  })

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

  // Distribution of predicted classes — helps tell apart "model returned
  // all-O" (= 0 spans expected) from "spans found but filtered downstream".
  const classCounts: Record<number, number> = {}
  for (let i = 0; i < predIds.length; i += 1) {
    const k = predIds[i] as number
    classCounts[k] = (classCounts[k] ?? 0) + 1
  }
  postDiag('[NER-WORKER] predict logits/decode', {
    lang: CURRENT_LANG,
    L,
    C,
    classCounts,
    rawSpansCount: rawSpans.length,
    sampleSpans: rawSpans.slice(0, 5).map(s => ({ label: s.rawLabel, text: text.slice(s.start, s.end) })),
  })

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
      await init(msg.payload.modelUrl, msg.payload.language ?? 'it')
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
