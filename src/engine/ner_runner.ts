/**
 * ner_runner.ts — main-thread wrapper around the NER Web Worker.
 *
 * Responsibilities:
 *   - Lifecycle (init / terminate) of the worker.
 *   - Promise-based request/response over postMessage (correlated by `id`).
 *   - Chunk splitting (port of Python `_split_into_chunks`) so the worker
 *     processes manageable text windows.
 *
 * The actual ONNX inference lives in `src/workers/ner.worker.ts`. That file
 * is loaded as a module worker via Vite at build time; in tests we don't spin
 * up the runner at all (the equivalence harness uses mock mode — see
 * `src/engine/__tests__/numerical_equivalence.test.ts`).
 *
 * Threshold tiers, IO-scheme decoding, label mapping and overlap resolution
 * are all handled inside the worker; the runner is transport + scheduling
 * only.
 */

import type { NerDetection } from '../types/engine'
import { getModelUrl, type Language } from '../ui/LanguageContext'
// DEV-ONLY: deterministic NER stub. The import is static, but every USE of it
// is gated behind MOCK_NER_ENABLED (see below), which is a compile-time-false
// constant in any production build — so Vite tree-shakes both the guarded
// branches and this module out of the prod bundle, exactly like the auth mock.
import { mockNerPredict } from '../mock/mock-ner'

/**
 * DEV-ONLY e2e stub switch. When true, {@link NerRunner.init} does NOT spawn
 * the Web Worker (no ONNX / transformers.js import) and {@link NerRunner.predict}
 * returns a fixed set of detections instantly. Mirrors the auth mock gate in
 * `App.tsx` EXACTLY: both conditions required.
 *
 *   - `import.meta.env.DEV` — true only on the Vite dev server; a production
 *     build statically inlines `false`, making this constant `false` and the
 *     guarded branches dead code (tree-shaken out, mock-ner.ts dropped).
 *   - `import.meta.env.VITE_MOCK_FULL === '1'` — explicit opt-in flag set by
 *     `.env.mock` (loaded via `npm run dev:mock` → `vite --mode mock`).
 *
 * When this is false, the NER path below is byte-for-byte the original
 * behaviour — the real Worker is created and used.
 */
const MOCK_NER_ENABLED =
  import.meta.env.DEV && import.meta.env.VITE_MOCK_FULL === '1'

/** Progress information forwarded from the NER worker during init(). */
export type NerProgressEvent = {
  /** Loading phase. */
  phase: 'wasm' | 'download' | 'session'
  /** Bytes downloaded so far (0 for non-download phases). */
  loaded: number
  /** Total expected bytes (0 when Content-Length is unavailable). */
  total: number
}

export type NerRunnerOptions = {
  /**
   * NER language. Drives which ONNX model is loaded and which raw-label
   * scheme the worker decodes (IO for Italian, BIO for English/German/
   * French). Defaults to 'it' so existing call sites keep working.
   */
  language?: Language
  /**
   * Absolute or root-relative URL to the ONNX model. Overrides the URL
   * derived from `language` — used by tests that mount mock workers.
   */
  modelUrl?: string
  /** Override the worker constructor — used in tests. */
  workerFactory?: () => Worker
}

/**
 * Result of a full-text NER pass — see `NerRunner.predict()`.
 *
 * `partial` is true when at least one chunk failed even after retry. The UI
 * surfaces a banner ("Riconoscimento entità incompleto su <N> sezione/i…")
 * but the pipeline still proceeds with `detections` from the successful
 * chunks plus the deterministic regex layer.
 *
 * `failedChunkRanges` carries the character ranges in the *input* text that
 * had no NER coverage, in order — useful for forensic surfacing in the UI.
 */
export type NerPredictResult = {
  detections: NerDetection[]
  partial: boolean
  failedChunkRanges: Array<[number, number]>
}

/** Sentinel error code raised by `predictChunk` when `timeoutMs` elapses. */
export const ERR_CHUNK_TIMEOUT = 'ERR_CHUNK_TIMEOUT'

/** Default per-chunk timeout (ms) before `predictChunk` rejects. */
export const DEFAULT_CHUNK_TIMEOUT_MS = 30_000

/** Delay (ms) between the first attempt failure and the retry. */
export const RETRY_BACKOFF_MS = 2_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type PendingRequest = {
  resolve: (value: NerDetection[]) => void
  reject: (reason: unknown) => void
}

let _idCounter = 0
function nextId(): string {
  _idCounter += 1
  return `req-${_idCounter}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Default language when none is provided in {@link NerRunnerOptions} —
 * preserves backward compatibility with pre-multilingual call sites.
 */
const DEFAULT_LANGUAGE: Language = 'it'

/**
 * Split text into chunks of at most `maxChars` characters, snapping on
 * paragraph boundaries (double newline). Direct port of Python
 * `_split_into_chunks` in anonymize.py — yields `[charStart, chunkText]`.
 */
export function splitIntoChunks(
  text: string,
  maxChars = 800,
): Array<{ start: number; text: string }> {
  const chunks: Array<{ start: number; text: string }> = []
  // Three-tier splitter:
  //   1. Try paragraph boundaries (\n\s*\n) — keeps related sentences
  //      together when the document has paragraph structure.
  //   2. If any resulting "part" still exceeds maxChars, fall back to
  //      single-newline boundaries — handles flat-line documents like
  //      WhatsApp chat exports where every message is one line and
  //      paragraphs never appear.
  //   3. If a single line still exceeds maxChars (extreme case), hard-cut
  //      at maxChars boundaries. Prevents the worker from being asked to
  //      tokenize a sequence > BERT's 512-token capacity, which fails
  //      silently and causes the partial-NER banner with 0 entities.
  const flush = (chunk: string, start: number): void => {
    if (chunk.length > 0) chunks.push({ start, text: chunk })
  }

  const splitByNewline = (segment: string, segmentStart: number): void => {
    const lines = segment.split(/(\n)/) // preserve newlines as separator tokens
    let buf = ''
    let bufStart = segmentStart
    for (const line of lines) {
      // If a single line is itself too long, hard-cut it.
      if (line.length > maxChars) {
        if (buf) {
          flush(buf, bufStart)
          bufStart += buf.length
          buf = ''
        }
        for (let i = 0; i < line.length; i += maxChars) {
          chunks.push({
            start: bufStart + i,
            text: line.slice(i, i + maxChars),
          })
        }
        bufStart += line.length
        continue
      }
      if (buf.length + line.length <= maxChars) {
        buf += line
      } else {
        flush(buf, bufStart)
        bufStart += buf.length
        buf = line
      }
    }
    flush(buf, bufStart)
  }

  const parts = text.split(/(\n\s*\n)/)
  let currentStart = 0
  let currentChunk = ''
  for (const part of parts) {
    if (part.length > maxChars) {
      // Paragraph alone exceeds budget — emit any pending buffer, then
      // descend to newline-level splitting for this part.
      if (currentChunk) {
        flush(currentChunk, currentStart)
        currentStart += currentChunk.length
        currentChunk = ''
      }
      splitByNewline(part, currentStart)
      currentStart += part.length
      continue
    }
    if (currentChunk.length + part.length <= maxChars) {
      currentChunk += part
    } else {
      flush(currentChunk, currentStart)
      currentStart += currentChunk.length
      currentChunk = part
    }
  }
  flush(currentChunk, currentStart)
  return chunks
}

export class NerRunner {
  private worker: Worker | null = null
  private ready = false
  private readonly pending = new Map<string, PendingRequest>()
  private readonly language: Language
  private readonly modelUrl: string
  private readonly workerFactory: () => Worker

  constructor(options: NerRunnerOptions = {}) {
    this.language = options.language ?? DEFAULT_LANGUAGE
    this.modelUrl = options.modelUrl ?? getModelUrl(this.language)
    this.workerFactory =
      options.workerFactory ??
      (() => {
        // Vite-flavored module worker import. Wrapped so test environments
        // (no DOM Worker) can override via `workerFactory`.
        return new Worker(
          new URL('../workers/ner.worker.ts', import.meta.url),
          { type: 'module' },
        )
      })
  }

  /**
   * Boot the worker and load the ONNX model. Idempotent.
   *
   * @param onProgress — optional callback called with progress events during
   *   model download and initialisation. Safe to ignore; the promise resolves
   *   when the model is fully ready regardless.
   */
  async init(onProgress?: (event: NerProgressEvent) => void): Promise<void> {
    if (this.ready) return
    // DEV-ONLY e2e stub: do NOT create the Worker (no ONNX/transformers import,
    // which stalls on the dev server). Mark ready so call sites (PseudonymizePanel,
    // WireframeWorkArea) transition nerStatus → idle and proceed to predict().
    // Tree-shaken in prod (MOCK_NER_ENABLED is compile-time false).
    if (MOCK_NER_ENABLED) {
      this.ready = true
      return
    }
    if (typeof Worker === 'undefined') {
      throw new Error(
        "Worker API not available in this environment — NER cannot start.",
      )
    }
    this.worker = this.workerFactory()
    this.worker.onmessage = this.onMessage
    this.worker.onerror = (ev) => {
      for (const [, p] of this.pending) {
        p.reject(new Error(`Worker error: ${ev.message ?? 'unknown'}`))
      }
      this.pending.clear()
    }

    await new Promise<void>((resolve, reject) => {
      const onReady = (event: MessageEvent) => {
        const data = event.data
        if (data?.type === 'ready') {
          this.worker?.removeEventListener('message', onReady)
          this.ready = true
          resolve()
        } else if (data?.type === 'error') {
          this.worker?.removeEventListener('message', onReady)
          reject(new Error(data.error ?? 'NER init failed'))
        } else if (data?.type === 'progress' && onProgress) {
          onProgress({
            phase: data.phase as NerProgressEvent['phase'],
            loaded: data.loaded as number,
            total: data.total as number,
          })
        }
      }
      this.worker?.addEventListener('message', onReady)
      this.worker?.postMessage({
        type: 'init',
        payload: { modelUrl: this.modelUrl, language: this.language },
      })
    })
  }

  /**
   * Predict entities on a single text chunk.
   *
   * @param text — the chunk to send to the worker.
   * @param timeoutMs — abort the request and reject with `ERR_CHUNK_TIMEOUT`
   *   after this many milliseconds. Defaults to {@link DEFAULT_CHUNK_TIMEOUT_MS}.
   *
   * The previous implementation had no timeout, so a single silent worker
   * stall (ORT decoder edge case, memory pressure, dropped postMessage)
   * blocked `predict()` indefinitely — observed on DOCX of ~400 words. We
   * now race the pending promise against a `setTimeout` and clear the
   * pending entry on either resolution path so the worker's eventual
   * (late) response doesn't leak.
   */
  async predictChunk(
    text: string,
    timeoutMs: number = DEFAULT_CHUNK_TIMEOUT_MS,
  ): Promise<NerDetection[]> {
    if (!this.ready || !this.worker) {
      throw new Error('NerRunner: call init() before predictChunk()')
    }
    const id = nextId()
    return new Promise<NerDetection[]>((resolve, reject) => {
      let settled = false
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              if (settled) return
              settled = true
              this.pending.delete(id)
              reject(new Error(`${ERR_CHUNK_TIMEOUT}: chunk did not return within ${timeoutMs}ms`))
            }, timeoutMs)
          : null
      this.pending.set(id, {
        resolve: (value) => {
          if (settled) return
          settled = true
          if (timer !== null) clearTimeout(timer)
          resolve(value)
        },
        reject: (reason) => {
          if (settled) return
          settled = true
          if (timer !== null) clearTimeout(timer)
          reject(reason)
        },
      })
      this.worker?.postMessage({
        type: 'predict',
        payload: { id, chunkText: text },
      })
    })
  }

  /**
   * Predict entities across the whole text — chunks, dedupes, merges.
   *
   * Parallelised via `Promise.allSettled` so a single chunk failure does not
   * block the others (previously sequential `for-await`, which deadlocked on
   * a silent worker stall — see brief 20260518). Each failed chunk is
   * retried once with a {@link RETRY_BACKOFF_MS} delay; chunks that fail
   * both attempts are surfaced via `partial: true` + `failedChunkRanges`
   * for the UI banner. The successful chunks still feed the regex + NER
   * pipeline downstream, so the user always gets a usable result.
   */
  async predict(text: string): Promise<NerPredictResult> {
    // DEV-ONLY e2e stub: return fixed detections instantly, no worker, no
    // chunking, no ONNX. Offsets are already in input-text space (the stub
    // scans the full text), so no chunk re-basing is needed. Tree-shaken in
    // prod (MOCK_NER_ENABLED is compile-time false).
    if (MOCK_NER_ENABLED) {
      return {
        detections: mockNerPredict(text),
        partial: false,
        failedChunkRanges: [],
      }
    }

    const chunks = splitIntoChunks(text, 800)

    const attemptChunk = async (
      chunkText: string,
    ): Promise<NerDetection[]> => {
      try {
        return await this.predictChunk(chunkText)
      } catch (firstErr) {
        // Brief 20260518: one retry only, after a short backoff to let the
        // worker (and ORT internals) settle. If the second attempt also
        // fails the chunk is recorded as failed and we move on.
        await sleep(RETRY_BACKOFF_MS)
        try {
          return await this.predictChunk(chunkText)
        } catch (_secondErr) {
          throw firstErr instanceof Error ? firstErr : new Error(String(firstErr))
        }
      }
    }

    const settled = await Promise.allSettled(
      chunks.map((c) => attemptChunk(c.text)),
    )

    const merged: NerDetection[] = []
    const failedChunkRanges: Array<[number, number]> = []
    for (let i = 0; i < settled.length; i++) {
      const chunk = chunks[i]
      const outcome = settled[i]
      if (!chunk || !outcome) continue
      if (outcome.status === 'fulfilled') {
        for (const e of outcome.value) {
          merged.push({
            ...e,
            start: e.start + chunk.start,
            end: e.end + chunk.start,
          })
        }
      } else {
        failedChunkRanges.push([chunk.start, chunk.start + chunk.text.length])
      }
    }

    // Global overlap dedup (mirror of Python `apply_gliner_with_pseudonyms`).
    merged.sort((a, b) => b.score - a.score)
    const accepted: NerDetection[] = []
    for (const span of merged) {
      const overlaps = accepted.some(
        (a) => span.start < a.end && span.end > a.start,
      )
      if (!overlaps) accepted.push(span)
    }
    accepted.sort((a, b) => a.start - b.start)
    return {
      detections: accepted,
      partial: failedChunkRanges.length > 0,
      failedChunkRanges,
    }
  }

  /** Shut down the worker and reject any in-flight requests. */
  terminate(): void {
    if (this.worker) {
      try {
        this.worker.postMessage({ type: 'terminate' })
      } catch {
        // ignore — worker may already be gone.
      }
      this.worker.terminate()
      this.worker = null
    }
    this.ready = false
    for (const [, p] of this.pending) {
      p.reject(new Error('NerRunner terminated'))
    }
    this.pending.clear()
  }

  private onMessage = (event: MessageEvent) => {
    const data = event.data
    if (!data || typeof data !== 'object') return
    if (data.type === 'log') {
      // Diagnostic relay from the worker — bubble up to the page console
      // so DevTools (and remote inspection tools that only see main-thread
      // console messages) can observe the worker's internal state. We
      // serialize the payload into the label so that single-arg console
      // capture (e.g. Chrome MCP read_console_messages) sees the data.
      try {
        // eslint-disable-next-line no-console
        console.log(`${data.label} ${JSON.stringify(data.payload)}`)
      } catch {
        // eslint-disable-next-line no-console
        console.log(data.label, data.payload)
      }
      return
    }
    if (data.type === 'result' || data.type === 'error') {
      const id: string | undefined = data.id
      if (!id) return
      const pending = this.pending.get(id)
      if (!pending) return
      this.pending.delete(id)
      if (data.type === 'result') {
        pending.resolve(data.entities ?? [])
      } else {
        pending.reject(new Error(data.error ?? 'NER worker error'))
      }
    }
  }
}
