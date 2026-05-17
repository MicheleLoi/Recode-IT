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
 *     → { type: 'result', id, entities: NerEntity[] }
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

let session: any = null
let tokenizer: any = null

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
}

/**
 * Run a single GLiNER prediction pass at the given threshold for the given
 * label set. Returns raw `{start, end, label, text, score}` spans (no
 * overlap filtering yet — that happens after all tiers merge).
 *
 * NOTE: The actual GLiNER inference graph (zero-shot span scoring with label
 * embeddings) is implementation-defined per ONNX export. This wrapper assumes
 * the exported graph follows the canonical `urchade/gliner_multi-v2.1`
 * signature: inputs `input_ids`, `attention_mask`, `entity_type_ids`; output
 * `logits` shape `[batch, num_spans, num_entity_types]`. If the founder's
 * actual export uses a different signature, this function needs adjustment —
 * but the protocol surface stays stable.
 */
async function predictTier(
  text: string,
  labels: string[],
  threshold: number,
): Promise<NerDetection[]> {
  if (!session || !tokenizer) {
    throw new Error('GLiNER worker not initialized — call init() first')
  }

  const encoded = await tokenizer(text, {
    return_tensors: 'np',
    add_special_tokens: true,
    truncation: true,
    max_length: 512,
  })

  // Reshape entity labels as the model expects (one tokenized prompt per label).
  const labelInputs = await Promise.all(
    labels.map((l) =>
      tokenizer(l, { return_tensors: 'np', add_special_tokens: true }),
    ),
  )

  // Run inference. The output keys depend on the exported graph; we accept
  // either `logits` or `scores`.
  const feeds: Record<string, any> = {
    input_ids: encoded.input_ids,
    attention_mask: encoded.attention_mask,
    entity_ids: labelInputs.map((l) => l.input_ids),
  }
  const output = await session.run(feeds)
  const scoresTensor: any = output.logits ?? output.scores
  const scoresData: Float32Array = scoresTensor.data
  const [, numSpans, numLabels] = scoresTensor.dims as [number, number, number]

  // Reconstruct char offsets via the tokenizer's offset_mapping if available.
  const offsets: Array<[number, number]> = (encoded.offset_mapping?.[0] ??
    encoded.offset_mapping ?? []) as Array<[number, number]>

  const out: NerDetection[] = []
  // Each span position i corresponds to tokens [start_token, end_token];
  // GLiNER span scoring conventionally enumerates contiguous spans up to a
  // max width. We approximate by reading the diagonal (single-token spans)
  // first and then iterating widths if the model exposes them as a flat
  // [num_spans] dimension.
  for (let s = 0; s < numSpans; s += 1) {
    for (let l = 0; l < numLabels; l += 1) {
      const score = scoresData[s * numLabels + l] ?? 0
      if (score < threshold) continue
      const tokenIdx = s % offsets.length
      const [start, end] = offsets[tokenIdx] ?? [0, 0]
      if (end <= start) continue
      out.push({
        start,
        end,
        label: labels[l] ?? 'unknown',
        text: text.slice(start, end),
        score,
      })
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
