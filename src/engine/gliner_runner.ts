/**
 * gliner_runner.ts — main-thread wrapper around the GLiNER Web Worker.
 *
 * Responsibilities:
 *   - Lifecycle (init / terminate) of the worker.
 *   - Promise-based request/response over postMessage (correlated by `id`).
 *   - Chunk splitting (port of Python `_split_into_chunks`) so the worker
 *     processes manageable text windows.
 *
 * The actual ONNX inference lives in `src/workers/gliner.worker.ts`. That
 * file is loaded as a module worker via Vite's `?worker` query at build time;
 * in tests we don't spin up the runner at all (the equivalence harness uses
 * mock mode — see `src/engine/__tests__/numerical_equivalence.test.ts`).
 *
 * Threshold tiers and overlap resolution are handled inside the worker; the
 * runner is transport + scheduling only.
 */

import type { NerDetection } from '../types/engine'

export type GlinerRunnerOptions = {
  /** Absolute or root-relative URL to the ONNX model. */
  modelUrl?: string
  /** Override the worker constructor — used in tests. */
  workerFactory?: () => Worker
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

const DEFAULT_MODEL_URL = '/models/gliner_multi_v2.1_q8.onnx'

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

export class GlinerRunner {
  private worker: Worker | null = null
  private ready = false
  private readonly pending = new Map<string, PendingRequest>()
  private readonly modelUrl: string
  private readonly workerFactory: () => Worker

  constructor(options: GlinerRunnerOptions = {}) {
    this.modelUrl = options.modelUrl ?? DEFAULT_MODEL_URL
    this.workerFactory =
      options.workerFactory ??
      (() => {
        // Vite-flavored module worker import. Wrapped so test environments
        // (no DOM Worker) can override via `workerFactory`.
        return new Worker(
          new URL('../workers/gliner.worker.ts', import.meta.url),
          { type: 'module' },
        )
      })
  }

  /** Boot the worker and load the ONNX model. Idempotent. */
  async init(): Promise<void> {
    if (this.ready) return
    if (typeof Worker === 'undefined') {
      throw new Error(
        "Worker API not available in this environment — GLiNER cannot start.",
      )
    }
    this.worker = this.workerFactory()
    this.worker.onmessage = this.onMessage
    this.worker.onerror = (ev) => {
      // Unattributed worker error: fail every pending request.
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
          reject(new Error(data.error ?? 'GLiNER init failed'))
        }
      }
      this.worker?.addEventListener('message', onReady)
      this.worker?.postMessage({
        type: 'init',
        payload: { modelUrl: this.modelUrl },
      })
    })
  }

  /** Predict entities on a single text chunk. */
  async predictChunk(text: string): Promise<NerDetection[]> {
    if (!this.ready || !this.worker) {
      throw new Error('GlinerRunner: call init() before predictChunk()')
    }
    const id = nextId()
    return new Promise<NerDetection[]>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker?.postMessage({
        type: 'predict',
        payload: { id, chunkText: text },
      })
    })
  }

  /** Predict entities across the whole text — chunks, dedupes, merges. */
  async predict(text: string): Promise<NerDetection[]> {
    const chunks = splitIntoChunks(text, 800)
    const merged: NerDetection[] = []
    for (const { start, text: chunkText } of chunks) {
      const ents = await this.predictChunk(chunkText)
      for (const e of ents) {
        merged.push({
          ...e,
          start: e.start + start,
          end: e.end + start,
        })
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
    return accepted
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
      p.reject(new Error('GlinerRunner terminated'))
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
        pending.reject(new Error(data.error ?? 'GLiNER worker error'))
      }
    }
  }
}
