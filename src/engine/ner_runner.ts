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
  /** Absolute or root-relative URL to the ONNX model. */
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
 * Default model URL — env-aware:
 *
 *   1. `VITE_NER_MODEL_URL` (set in .env / .env.production / .env.local)
 *      always wins when defined.
 *   2. Otherwise: same-origin relative path `/models/distilbert_italian_ner_q8.onnx`.
 *      Works in both dev (Vite serves `public/models/`) and prod (nginx
 *      serves `/var/www/recode-it/models/`). Same-origin avoids COEP
 *      cross-origin fetch blocks and keeps the privacy claim "nulla esce
 *      dal computer dell'utente" architecturally enforced.
 *
 * Kept inside `ner_runner.ts` (not the worker) so the env var resolves at
 * main-thread bundle time — Vite's `import.meta.env` substitution does not
 * cross the worker boundary in the same way.
 */
const DEFAULT_MODEL_URL =
  (import.meta.env.VITE_NER_MODEL_URL as string | undefined) ||
  '/models/distilbert_italian_ner_q8.onnx'

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
  const parts = text.split(/(\n\s*\n)/)
  let currentStart = 0
  let currentChunk = ''
  for (const part of parts) {
    if (currentChunk.length + part.length <= maxChars) {
      currentChunk += part
    } else {
      if (currentChunk) {
        chunks.push({ start: currentStart, text: currentChunk })
      }
      currentStart = currentStart + currentChunk.length
      currentChunk = part
    }
  }
  if (currentChunk) {
    chunks.push({ start: currentStart, text: currentChunk })
  }
  return chunks
}

export class NerRunner {
  private worker: Worker | null = null
  private ready = false
  private readonly pending = new Map<string, PendingRequest>()
  private readonly modelUrl: string
  private readonly workerFactory: () => Worker

  constructor(options: NerRunnerOptions = {}) {
    this.modelUrl = options.modelUrl ?? DEFAULT_MODEL_URL
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
        payload: { modelUrl: this.modelUrl },
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
