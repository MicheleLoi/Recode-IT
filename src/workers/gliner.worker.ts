/**
 * gliner.worker.ts — Phase 4 Web Worker that runs the GLiNER ONNX model
 * off the main thread.
 *
 * Protocol (main ↔ worker):
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
 * The actual ONNX session creation and tokenization happens via dynamic
 * `import()` so the module can be statically type-checked without the heavy
 * `onnxruntime-web` / `@xenova/transformers` modules being eagerly loaded
 * during Vitest runs (which only exercise the equivalence harness in mock
 * mode).
 *
 * ─── ONNX I/O contract (GLiNER UniEncoderSpan ONNX export) ────────────────
 *
 * Inputs the exported graph expects — names verified against
 *   gliner.model.UniEncoderSpanGLiNER._get_onnx_input_spec() in upstream
 *   (https://github.com/urchade/GLiNER, gliner/model.py L1879):
 *
 *   input_ids            : int64  [B, L_sub]          subword token ids
 *   attention_mask       : int64  [B, L_sub]          1 for valid, 0 for pad
 *   words_mask           : int64  [B, L_sub]          1..N word index of the
 *                                                     subtoken's parent word
 *                                                     (after skipping prompt
 *                                                     words); 0 for special
 *                                                     tokens, continuation
 *                                                     subtokens, and prompt
 *                                                     tokens themselves
 *   text_lengths         : int64  [B, 1]              number of *words* in the
 *                                                     text (NOT subtokens)
 *   span_idx             : int64  [B, L_word*K, 2]    enumerated (start,end)
 *                                                     word indices, inclusive
 *   span_mask            : bool   [B, L_word*K]       true where the span
 *                                                     fits inside the text
 *
 * Outputs:
 *   logits               : float  [B, L_word, K, C]   raw scores
 *                                                     L_word = num words
 *                                                     K      = max_width (12)
 *                                                     C      = num labels
 *
 * Decode: prob = sigmoid(logit); for each (b,s,k,c) where prob > threshold and
 * (s+k+1) <= num_words, emit a span [word s … word s+k] with class c+1 (the
 * 0 class is reserved for <pad>).
 *
 * ─── Threshold tiers ──────────────────────────────────────────────────────
 *
 * Threshold tiers — preserved verbatim from the Python reference
 * (`MHC-L/gate-local/tools/anonymize.py::_predict_chunk`):
 *   0.40  for ["persona", "luogo"]
 *   0.65  for ["organizzazione"]
 *   0.60  for ["numero di causa", "tribunale", "avvocato", "email",
 *              "telefono", "iban"]
 *
 * Overlap resolution: sort all spans by score desc, accept greedily, skip any
 * span that overlaps an already-accepted span (Python parity).
 *
 * Stoplist filter (`isStoplist` from Phase 1) is applied before returning.
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
    entityLabels?: string[]
    threshold?: number
  }
}
type TerminateMessage = { type: 'terminate' }
type IncomingMessage = InitMessage | PredictMessage | TerminateMessage

type ReadyOut = { type: 'ready' }
type ResultOut = { type: 'result'; id: string; entities: NerDetection[] }
type ErrorOut = { type: 'error'; id?: string; error: string }
type OutgoingMessage = ReadyOut | ResultOut | ErrorOut

const TIERS: Array<{ threshold: number; labels: string[] }> = [
  { threshold: 0.4, labels: ['persona', 'luogo'] },
  { threshold: 0.65, labels: ['organizzazione'] },
  {
    threshold: 0.6,
    labels: ['numero di causa', 'tribunale', 'avvocato', 'email', 'telefono', 'iban'],
  },
]

/**
 * Default max span width — must match the exported model's `max_width`
 * config (gliner_config.json). All current urchade GLiNER variants ship with
 * `max_width=12`. We hard-code rather than fetch the config because the
 * worker doesn't otherwise depend on it; if a future export uses a different
 * value, change here.
 */
const MAX_WIDTH = 12

/** Default GLiNER prompt special tokens (urchade v2.x convention). */
const ENT_TOKEN = '<<ENT>>'
const SEP_TOKEN = '<<SEP>>'

let session: any = null
let tokenizer: any = null
/**
 * `<<ENT>>` / `<<SEP>>` token ids resolved at init time. If the tokenizer
 * exposes them as single special tokens we use those directly; otherwise we
 * fall back to encoding the literal strings (which may produce multiple
 * subtokens — accounted for in the words_mask logic).
 */
let entTokenIds: number[] = []
let sepTokenIds: number[] = []

/**
 * Sentinel error codes the main thread can pattern-match on to differentiate
 * UX between "the ort runtime itself failed to boot" (real bug) and "the model
 * file isn't deployed yet" (expected, founder-side step).
 */
const ERR_MODEL_NOT_FOUND = 'ERR_MODEL_NOT_FOUND'
const ERR_BACKEND_INIT = 'ERR_BACKEND_INIT'

async function init(modelUrl: string): Promise<void> {
  // Dynamic imports — kept lazy so test environments without the heavyweight
  // WASM runtime never touch them. NOTE: do NOT add /* @vite-ignore */ here —
  // Vite must resolve and code-split these modules so the worker bundle and
  // the lazily-loaded ort chunk share a single `onnxruntime-common` instance.
  // Without that, ort's backend registration writes into one module copy and
  // the consumer reads from another, surfacing as
  //   "Cannot read properties of undefined (reading 'registerBackend')"
  // at the first `InferenceSession.create` call.
  let ort: any
  let transformers: any
  try {
    ort = await import('onnxruntime-web')
    transformers = await import('@xenova/transformers')
  } catch (err) {
    throw new Error(`${ERR_BACKEND_INIT}: ${(err as Error).message ?? String(err)}`)
  }

  // Point ort at the wasm runtime files copied into `public/ort/` by the
  // `copyOrtWasmPlugin` in vite.config.ts. Without an explicit wasmPaths,
  // ort tries to resolve wasm via the importing module's URL — which in a
  // Vite module-worker context resolves to a hashed asset path that doesn't
  // host the wasm files, leading to silent fetch failures and the
  // "registerBackend on undefined" error downstream.
  if (ort?.env?.wasm) {
    ort.env.wasm.wasmPaths = '/ort/'
    // Multi-threaded wasm needs SharedArrayBuffer, which needs COOP/COEP.
    // The dev server sets those headers (vite.config.ts); fall back to
    // single-threaded if SAB isn't actually available at runtime.
    if (typeof SharedArrayBuffer === 'undefined') {
      ort.env.wasm.numThreads = 1
    }
  }

  // Configure transformers.js to NOT auto-download models from HF — we serve
  // tokenizer artefacts alongside our ONNX file.
  ;(transformers as any).env.allowRemoteModels = false
  ;(transformers as any).env.localModelPath = new URL('./', modelUrl).toString()

  // Probe the model URL first so we can emit a distinct, friendly error when
  // the founder has not yet deployed the .onnx file. ort itself would
  // otherwise throw a generic "failed to load model" that's hard for the UI
  // to discriminate from a real backend failure.
  //
  // Note: Vite's dev server SPA fallback returns 200 + text/html for any
  // missing route, so a bare status check isn't enough — we sniff the
  // content-type and require an octet-stream-ish response.
  try {
    const head = await fetch(modelUrl, { method: 'HEAD' })
    const ct = head.headers.get('content-type') ?? ''
    const isMissing =
      head.status === 404 ||
      (head.ok && (ct.startsWith('text/html') || ct.startsWith('text/plain')))
    if (isMissing) {
      throw new Error(`${ERR_MODEL_NOT_FOUND}: ${modelUrl}`)
    }
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err)
    if (msg.startsWith(ERR_MODEL_NOT_FOUND)) throw err
    // network errors / HEAD-not-allowed: fall through to ort, which will
    // surface its own diagnostic
  }

  try {
    session = await ort.InferenceSession.create(modelUrl, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    })
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err)
    // ort signals model fetch failure with messages mentioning the URL +
    // "failed to fetch" / a 404 status. Promote those to ERR_MODEL_NOT_FOUND.
    if (/404|not.?found|failed to fetch/i.test(msg)) {
      throw new Error(`${ERR_MODEL_NOT_FOUND}: ${modelUrl}`)
    }
    throw new Error(`${ERR_BACKEND_INIT}: ${msg}`)
  }

  // Tokenizer name resolution: derive from modelUrl directory.
  const tokenizerDir = new URL('./', modelUrl).toString()
  tokenizer = await (transformers as any).AutoTokenizer.from_pretrained(tokenizerDir)

  // Resolve the special prompt tokens. Some GLiNER checkpoints register them
  // as proper added_tokens (single id); older ones don't, in which case we
  // fall back to encoding the literal string without special tokens — that
  // may produce multiple subwords which is fine: words_mask handles them as
  // skipped prompt tokens regardless of count.
  entTokenIds = tokenizer.encode(ENT_TOKEN, null, { add_special_tokens: false })
  sepTokenIds = tokenizer.encode(SEP_TOKEN, null, { add_special_tokens: false })
  if (!entTokenIds?.length) entTokenIds = [tokenizer.unk_token_id ?? 0]
  if (!sepTokenIds?.length) sepTokenIds = [tokenizer.sep_token_id ?? 0]
}

/* ─────────────────────────────────────────────────────────────────────────
 * Word splitting — direct port of GLiNER's `WhitespaceTokenSplitter`
 * (gliner/data_processing/tokenizer.py):
 *   self.whitespace_pattern = re.compile(r"\w+(?:[-_]\w+)*|\S")
 *
 * Python's `\w` is Unicode-aware in default mode (Python 3). JS RegExp needs
 * the `u` flag and the Unicode property class `\p{L}\p{N}_` to mirror that.
 * ──────────────────────────────────────────────────────────────────────── */

type WordRecord = { token: string; start: number; end: number }

const WORD_SPLIT_RE = /[\p{L}\p{N}_]+(?:[-_][\p{L}\p{N}_]+)*|[^\s]/gu

function splitWords(text: string): WordRecord[] {
  const out: WordRecord[] = []
  WORD_SPLIT_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = WORD_SPLIT_RE.exec(text)) !== null) {
    out.push({ token: m[0], start: m.index, end: m.index + m[0].length })
  }
  return out
}

/* ─────────────────────────────────────────────────────────────────────────
 * Build the six ONNX feeds for a single text + label set.
 * ──────────────────────────────────────────────────────────────────────── */

type FeedPack = {
  feeds: Record<string, any>
  words: WordRecord[]
  numWords: number
  numSubtokens: number
}

function bigInt64(arr: number[] | BigInt64Array): BigInt64Array {
  if (arr instanceof BigInt64Array) return arr
  const out = new BigInt64Array(arr.length)
  for (let i = 0; i < arr.length; i += 1) {
    const v = arr[i] ?? 0
    out[i] = BigInt(v | 0)
  }
  return out
}

async function buildFeeds(
  ort: any,
  text: string,
  labels: string[],
): Promise<FeedPack> {
  // 1. Word-level split of the text.
  const words = splitWords(text)
  const numWords = words.length

  // Edge case: empty / whitespace-only chunk → skip.
  if (numWords === 0) {
    return { feeds: {}, words, numWords: 0, numSubtokens: 0 }
  }

  // 2. Assemble the full subtoken sequence:
  //      [CLS] (<<ENT>> labelᵢ)* <<SEP>> word₁ … wordₙ [SEP]
  //    - Labels are tokenized as text (potentially multi-subtoken — words_mask
  //      treats every prompt subtoken as 0, so this is safe).
  //    - Words are encoded one-by-one so we can record where each word starts
  //      in the subtoken stream (the equivalent of HF's word_ids()).
  const clsId: number =
    tokenizer.cls_token_id ?? tokenizer.bos_token_id ?? null
  const sepId: number =
    tokenizer.sep_token_id ?? tokenizer.eos_token_id ?? null

  const inputIds: number[] = []
  const wordsMask: number[] = []

  if (clsId !== null) {
    inputIds.push(clsId)
    wordsMask.push(0)
  }

  // Prompt: for each label, push <<ENT>> + label subtokens.
  for (const label of labels) {
    for (const id of entTokenIds) {
      inputIds.push(id)
      wordsMask.push(0)
    }
    const labelIds: number[] = tokenizer.encode(label, null, {
      add_special_tokens: false,
    })
    for (const id of labelIds) {
      inputIds.push(id)
      wordsMask.push(0)
    }
  }
  // Closing <<SEP>> between prompt and text.
  for (const id of sepTokenIds) {
    inputIds.push(id)
    wordsMask.push(0)
  }

  // Words. Each word's first subtoken is marked with its 1-based word index
  // (after prompt skip); continuation subtokens get 0 (per
  // `prepare_word_mask(..., token_level=False)`).
  for (let i = 0; i < words.length; i += 1) {
    const wordRec = words[i]!
    const wordIds: number[] = tokenizer.encode(wordRec.token, null, {
      add_special_tokens: false,
    })
    if (wordIds.length === 0) {
      // Vocab dropped this word entirely — fall back to UNK so the word
      // index doesn't desync. (Shouldn't happen with SentencePiece, but be
      // defensive.)
      const unk =
        tokenizer.unk_token_id ?? tokenizer.pad_token_id ?? 0
      inputIds.push(unk)
      wordsMask.push(i + 1)
    } else {
      for (let s = 0; s < wordIds.length; s += 1) {
        const id = wordIds[s] ?? 0
        inputIds.push(id)
        wordsMask.push(s === 0 ? i + 1 : 0)
      }
    }
  }

  if (sepId !== null) {
    inputIds.push(sepId)
    wordsMask.push(0)
  }

  const numSubtokens = inputIds.length

  // attention_mask: all 1s since this is a single-example batch (no padding).
  const attentionMask = new Array(numSubtokens).fill(1)

  // 3. span_idx + span_mask: enumerate all (start_word, start_word+width)
  //    pairs for width in [0..MAX_WIDTH).
  const numSpans = numWords * MAX_WIDTH
  const spanIdx = new BigInt64Array(numSpans * 2)
  const spanMaskBool = new Uint8Array(numSpans) // ort bool tensor is byte-backed
  let wIdx = 0
  for (let s = 0; s < numWords; s += 1) {
    for (let w = 0; w < MAX_WIDTH; w += 1) {
      const end = s + w
      spanIdx[wIdx * 2] = BigInt(s)
      spanIdx[wIdx * 2 + 1] = BigInt(end)
      // valid iff the inclusive end stays within the text (mirror of
      // `valid_span_mask = spans_idx[:, 1] > num_tokens - 1` inverted in
      // prepare_span_labels — i.e. end <= numWords-1).
      spanMaskBool[wIdx] = end <= numWords - 1 ? 1 : 0
      wIdx += 1
    }
  }

  // 4. text_lengths: [1, 1] — single batch, scalar word count.
  const textLengths = new BigInt64Array([BigInt(numWords)])

  const feeds = {
    input_ids: new ort.Tensor('int64', bigInt64(inputIds), [1, numSubtokens]),
    attention_mask: new ort.Tensor(
      'int64',
      bigInt64(attentionMask),
      [1, numSubtokens],
    ),
    words_mask: new ort.Tensor('int64', bigInt64(wordsMask), [1, numSubtokens]),
    text_lengths: new ort.Tensor('int64', textLengths, [1, 1]),
    span_idx: new ort.Tensor('int64', spanIdx, [1, numSpans, 2]),
    span_mask: new ort.Tensor('bool', spanMaskBool, [1, numSpans]),
  }

  return { feeds, words, numWords, numSubtokens }
}

/**
 * Numerically stable sigmoid.
 */
function sigmoid(x: number): number {
  if (x >= 0) {
    const e = Math.exp(-x)
    return 1 / (1 + e)
  }
  const e = Math.exp(x)
  return e / (1 + e)
}

/**
 * Run a single GLiNER prediction pass at the given threshold for the given
 * label set. Returns raw `{start, end, label, text, score}` spans in char
 * offsets of the input text (no overlap filtering yet — that happens after
 * all tiers merge).
 */
async function predictTier(
  text: string,
  labels: string[],
  threshold: number,
): Promise<NerDetection[]> {
  if (!session || !tokenizer) {
    throw new Error('GLiNER worker not initialized — call init() first')
  }

  // ort is already loaded by init(); re-import is a cache hit.
  const ort = await import('onnxruntime-web')

  const pack = await buildFeeds(ort, text, labels)
  if (pack.numWords === 0) return []

  const output = await session.run(pack.feeds)
  // Output spec: { logits: float32 [B, L_word, K, C] }
  const logitsTensor: any = output.logits ?? output.scores
  if (!logitsTensor) {
    throw new Error(
      `GLiNER ONNX output missing 'logits'. Got keys: ${Object.keys(output).join(',')}`,
    )
  }
  const data: Float32Array = logitsTensor.data
  const dims = logitsTensor.dims as number[]
  // Be tolerant of either [B, L, K, C] (current export) or a flattened
  // variant. We strictly require 4 dims here — anything else means the
  // graph has changed and we want a loud failure.
  if (dims.length !== 4) {
    throw new Error(
      `GLiNER ONNX logits expected 4D, got dims=[${dims.join(',')}]`,
    )
  }
  const [, L, K, C] = dims as [number, number, number, number]
  const numWords = pack.numWords

  const out: NerDetection[] = []
  // Iterate (s, k, c) and emit anything above threshold. We rely on
  // span_mask to be zero outside the valid region — the model is already
  // trained to put no signal there — but we also enforce numerically.
  for (let s = 0; s < L && s < numWords; s += 1) {
    for (let k = 0; k < K; k += 1) {
      const endWord = s + k
      if (endWord >= numWords) break // span runs past the text
      const base = ((s * K) + k) * C
      for (let c = 0; c < C; c += 1) {
        const raw = data[base + c] ?? 0
        const score = sigmoid(raw)
        if (score < threshold) continue
        const label = labels[c] ?? 'unknown'
        const startChar = pack.words[s]!.start
        const endChar = pack.words[endWord]!.end
        out.push({
          start: startChar,
          end: endChar,
          label,
          text: text.slice(startChar, endChar),
          score,
        })
      }
    }
  }
  return out
}

async function predict(payload: PredictMessage['payload']): Promise<NerDetection[]> {
  const { chunkText, entityLabels, threshold } = payload

  // If caller specified a single tier (custom labels + threshold), honor it.
  // Otherwise run the canonical 3-tier sweep.
  let allSpans: NerDetection[]
  if (entityLabels && typeof threshold === 'number') {
    allSpans = await predictTier(chunkText, entityLabels, threshold)
  } else {
    const tiers = await Promise.all(
      TIERS.map((t) => predictTier(chunkText, t.labels, t.threshold)),
    )
    allSpans = tiers.flat()
  }

  // Overlap resolution: sort by score desc, accept greedily.
  allSpans.sort((a, b) => b.score - a.score)
  const accepted: NerDetection[] = []
  for (const span of allSpans) {
    const overlaps = accepted.some(
      (a) => span.start < a.end && span.end > a.start,
    )
    if (!overlaps) accepted.push(span)
  }

  // Filter stoplist + false positives (Phase 1 carve-out).
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

export type { IncomingMessage, OutgoingMessage, NerDetection }
