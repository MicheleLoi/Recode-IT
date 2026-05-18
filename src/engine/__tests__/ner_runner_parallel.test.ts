/**
 * ner_runner_parallel.test.ts — verifies the parallel + retry + timeout
 * refactor of `NerRunner.predict()` (brief 20260518).
 *
 * The previous sequential `for-await` loop deadlocked on a silent worker
 * stall — a single un-responding chunk blocked `predict()` indefinitely.
 * We now:
 *   - run all chunks via `Promise.allSettled` so one stall doesn't gate the
 *     others;
 *   - retry each failed chunk once after a short backoff;
 *   - timeout `predictChunk` after `DEFAULT_CHUNK_TIMEOUT_MS` so the worker
 *     can never stall the orchestrator silently;
 *   - return `{detections, partial, failedChunkRanges}` so the UI can
 *     surface an inline banner without aborting the run.
 *
 * Test approach: we stub `Worker` (jsdom has no Worker) and drive the runner
 * through scripted message responses. Each chunk gets a deterministic id;
 * the stub dispatches `result` or `error` (or stays silent) per scenario.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_CHUNK_TIMEOUT_MS,
  ERR_CHUNK_TIMEOUT,
  NerRunner,
  RETRY_BACKOFF_MS,
  splitIntoChunks,
} from '../ner_runner'

/**
 * Minimal scriptable Worker stub. The `script` function is called for every
 * `predict` message and returns either an object to post back (with `result`
 * / `error` shape) or `null` to stay silent (simulating a stall). Init
 * messages always reply with `ready`. Per-message responses are dispatched
 * asynchronously (microtask) to mirror real worker semantics.
 */
class ScriptableWorker {
  public onmessage: ((ev: { data: unknown }) => void) | null = null
  public onerror: ((ev: { message?: string }) => void) | null = null
  private listeners: Array<(ev: { data: unknown }) => void> = []
  private predictCount = 0
  constructor(
    private readonly script: (
      callIndex: number,
      payload: { id: string; chunkText: string },
    ) => unknown | null,
  ) {}

  addEventListener(_type: string, listener: (ev: { data: unknown }) => void) {
    this.listeners.push(listener)
  }

  removeEventListener(
    _type: string,
    listener: (ev: { data: unknown }) => void,
  ) {
    this.listeners = this.listeners.filter((l) => l !== listener)
  }

  postMessage(msg: { type: string; payload?: any }) {
    if (msg.type === 'init') {
      // Reply async with ready.
      queueMicrotask(() => this.dispatch({ type: 'ready' }))
      return
    }
    if (msg.type === 'predict') {
      const idx = this.predictCount
      this.predictCount += 1
      const response = this.script(idx, msg.payload)
      if (response === null) {
        // Silent stall — runner timeout must rescue.
        return
      }
      queueMicrotask(() => this.dispatch(response))
      return
    }
    // terminate / other messages: ignore.
  }

  terminate() {
    // no-op for the stub.
  }

  private dispatch(data: unknown) {
    if (this.onmessage) this.onmessage({ data })
    for (const l of this.listeners) l({ data })
  }
}

// Helper: build a long-enough text that splitIntoChunks emits >=N chunks.
function makeText(numChunks: number, chunkSize = 700): string {
  // Each paragraph is ≤700 chars and gets a unique "P<i>:" prefix.
  //   - chunkSize≤(maxChars - "\n\n".length) so paragraph + separator stay
  //     under 800 ⇒ splitIntoChunks(text, 800) yields exactly `numChunks`
  //     chunks (one chunk per paragraph+separator pair, plus the trailing
  //     paragraph alone).
  //   - Unique prefix so `chunks[i].text` differs across i (the scripted
  //     worker can match a specific chunk by equality).
  return Array.from({ length: numChunks }, (_, i) => {
    const prefix = `P${i}:`
    return prefix + 'A'.repeat(chunkSize - prefix.length)
  }).join('\n\n')
}

// jsdom does not provide Worker; the runner's `typeof Worker === 'undefined'`
// guard short-circuits init(). Polyfill with a no-op constructor so the
// runtime check passes — the runner never actually instantiates this class
// because we always supply `workerFactory` in tests.
beforeAll(() => {
  if (typeof (globalThis as any).Worker === 'undefined') {
    ;(globalThis as any).Worker = class {
      // empty — every test overrides via workerFactory.
    }
  }
})

describe('NerRunner.predict — parallel + retry + timeout (brief 20260518)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('retries a chunk that fails on first attempt and succeeds on retry', async () => {
    // 3 chunks. Chunk 1 fails on first attempt, succeeds on retry. Others
    // succeed first try. Expect: NO partial flag, all detections present.
    const text = makeText(3)
    const chunks = splitIntoChunks(text, 800)
    expect(chunks.length).toBeGreaterThanOrEqual(3)

    // Track per-chunk attempt counts via the chunkText (each chunk is a
    // distinct 900-char block, so chunkText identifies the chunk).
    const attemptsByText = new Map<string, number>()

    const script = (
      _idx: number,
      payload: { id: string; chunkText: string },
    ) => {
      const n = (attemptsByText.get(payload.chunkText) ?? 0) + 1
      attemptsByText.set(payload.chunkText, n)
      // We single out chunk 1 (index 1 in chunks array) by content match.
      const isChunk1 =
        chunks[1] !== undefined && payload.chunkText === chunks[1].text
      if (isChunk1 && n === 1) {
        return { type: 'error', id: payload.id, error: 'transient worker error' }
      }
      return {
        type: 'result',
        id: payload.id,
        entities: [
          {
            start: 0,
            end: 5,
            label: 'persona',
            text: payload.chunkText.slice(0, 5),
            score: 0.9,
          },
        ],
      }
    }

    const runner = new NerRunner({
      workerFactory: () => new ScriptableWorker(script) as unknown as Worker,
    })
    await runner.init()

    const promise = runner.predict(text)
    // Advance through the retry backoff so the retry can run.
    await vi.advanceTimersByTimeAsync(RETRY_BACKOFF_MS + 50)
    const result = await promise

    expect(result.partial).toBe(false)
    expect(result.failedChunkRanges).toEqual([])
    expect(result.detections.length).toBe(chunks.length)
    // Chunk 1 was retried.
    const chunk1Text = chunks[1]!.text
    expect(attemptsByText.get(chunk1Text)).toBe(2)
  })

  it('marks the run partial when a chunk fails both attempts; others still succeed', async () => {
    const text = makeText(3)
    const chunks = splitIntoChunks(text, 800)

    const attemptsByText = new Map<string, number>()
    const script = (
      _idx: number,
      payload: { id: string; chunkText: string },
    ) => {
      const n = (attemptsByText.get(payload.chunkText) ?? 0) + 1
      attemptsByText.set(payload.chunkText, n)
      const isChunk1 =
        chunks[1] !== undefined && payload.chunkText === chunks[1].text
      if (isChunk1) {
        return { type: 'error', id: payload.id, error: 'persistent worker error' }
      }
      return {
        type: 'result',
        id: payload.id,
        entities: [
          {
            start: 0,
            end: 5,
            label: 'persona',
            text: payload.chunkText.slice(0, 5),
            score: 0.9,
          },
        ],
      }
    }

    const runner = new NerRunner({
      workerFactory: () => new ScriptableWorker(script) as unknown as Worker,
    })
    await runner.init()

    const promise = runner.predict(text)
    await vi.advanceTimersByTimeAsync(RETRY_BACKOFF_MS + 50)
    const result = await promise

    expect(result.partial).toBe(true)
    expect(result.failedChunkRanges.length).toBe(1)
    // Failed range matches chunk 1.
    const expectedStart = chunks[1]!.start
    const expectedEnd = expectedStart + chunks[1]!.text.length
    expect(result.failedChunkRanges[0]).toEqual([expectedStart, expectedEnd])
    // Other chunks produced detections.
    expect(result.detections.length).toBe(chunks.length - 1)
    expect(attemptsByText.get(chunks[1]!.text)).toBe(2)
  })

  it('predictChunk rejects with ERR_CHUNK_TIMEOUT when the worker stays silent', async () => {
    const script = (_idx: number, _payload: { id: string; chunkText: string }) => {
      return null // silent — no response ever
    }
    const runner = new NerRunner({
      workerFactory: () => new ScriptableWorker(script) as unknown as Worker,
    })
    await runner.init()

    // Use a short custom timeout to keep test fast.
    const promise = runner.predictChunk('some text', 5_000)
    await vi.advanceTimersByTimeAsync(5_100)
    await expect(promise).rejects.toThrow(/ERR_CHUNK_TIMEOUT/)
  })

  it('default timeout constant matches the brief (30s)', () => {
    expect(DEFAULT_CHUNK_TIMEOUT_MS).toBe(30_000)
    expect(ERR_CHUNK_TIMEOUT).toBe('ERR_CHUNK_TIMEOUT')
  })

  it('combines detections from every successful chunk with global offset', async () => {
    const text = makeText(3)
    const chunks = splitIntoChunks(text, 800)

    const script = (
      _idx: number,
      payload: { id: string; chunkText: string },
    ) => ({
      type: 'result',
      id: payload.id,
      // One detection per chunk at position 10 (in-chunk-local coords).
      entities: [
        {
          start: 10,
          end: 15,
          label: 'persona',
          text: payload.chunkText.slice(10, 15),
          score: 0.9,
        },
      ],
    })

    const runner = new NerRunner({
      workerFactory: () => new ScriptableWorker(script) as unknown as Worker,
    })
    await runner.init()

    const result = await runner.predict(text)

    expect(result.partial).toBe(false)
    expect(result.detections.length).toBe(chunks.length)
    // Each detection's start must be (chunk.start + 10).
    for (let i = 0; i < chunks.length; i++) {
      const det = result.detections[i]
      expect(det).toBeDefined()
      const expectedStart = chunks[i]!.start + 10
      expect(det!.start).toBe(expectedStart)
      expect(det!.end).toBe(expectedStart + 5)
    }
  })

  it('all chunks failing both attempts yields partial=true and no detections', async () => {
    const text = makeText(2)
    const chunks = splitIntoChunks(text, 800)

    const script = (
      _idx: number,
      payload: { id: string; chunkText: string },
    ) => ({
      type: 'error',
      id: payload.id,
      error: 'every chunk fails',
    })

    const runner = new NerRunner({
      workerFactory: () => new ScriptableWorker(script) as unknown as Worker,
    })
    await runner.init()

    const promise = runner.predict(text)
    await vi.advanceTimersByTimeAsync(RETRY_BACKOFF_MS + 50)
    const result = await promise

    expect(result.partial).toBe(true)
    expect(result.detections).toEqual([])
    expect(result.failedChunkRanges.length).toBe(chunks.length)
  })
})
