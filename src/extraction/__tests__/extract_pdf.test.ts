/**
 * extract_pdf.test.ts — pdf.js wrapper behavior.
 *
 * pdf.js is mocked at module scope so the tests run in jsdom without a real
 * worker / wasm. The Vite-specific `?url` import for the worker file is
 * shimmed to a plain string so the module loads cleanly under Vitest.
 *
 * The semantic guarantees exercised here:
 *   - Page text items are concatenated into a single string.
 *   - The scanned-PDF heuristic (`isScanned=true` when text < 50 chars AND
 *     file >= 100KB) fires on a large empty-text PDF and does NOT fire on a
 *     small empty-text PDF.
 *   - Password / corrupt / generic load errors get the right `code`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Shim the `?url` import: Vite resolves this to a string at build time; in
// Vitest we just give it a placeholder so the module evaluates.
vi.mock('pdfjs-dist/build/pdf.worker.mjs?url', () => ({ default: 'mock-worker-url' }))

const mockGetDocument = vi.fn()
const mockGlobalWorkerOptions = { workerSrc: '' }

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: mockGlobalWorkerOptions,
  getDocument: mockGetDocument,
}))

import { extractPdfText } from '../extract_pdf'

type FakeTextItem = { str: string }
type FakePage = {
  getTextContent: () => Promise<{ items: FakeTextItem[] }>
  cleanup: () => void
}
type FakePdf = {
  numPages: number
  getPage: (n: number) => Promise<FakePage>
  destroy: () => Promise<void>
}

function fakePdfWithPages(pageTexts: string[]): FakePdf {
  return {
    numPages: pageTexts.length,
    getPage: vi.fn(async (n: number) => ({
      getTextContent: async () => ({
        items: (pageTexts[n - 1] ?? '').split(/\s+/).filter(Boolean).map((s) => ({ str: s })),
      }),
      cleanup: vi.fn(),
    })),
    destroy: vi.fn(async () => undefined),
  }
}

function makePdfFile(name: string, sizeBytes: number): File {
  // Construct a File with the requested byte size so the scanned-PDF heuristic
  // (which checks file.size against SCANNED_SIZE_THRESHOLD = 100KB) can be
  // exercised deterministically.
  const buf = new Uint8Array(sizeBytes)
  return new File([buf], name, { type: 'application/pdf' })
}

beforeEach(() => {
  mockGetDocument.mockReset()
})

describe('extract_pdf — extractPdfText', () => {
  it('configures the pdf.js worker on first extraction call', async () => {
    // pdf.js is dynamically imported (see extract_pdf.ts), so the worker URL
    // is wired the first time a PDF is actually extracted, not at module
    // load. This keeps the heavy bundle out of unrelated test files.
    const pdf = fakePdfWithPages(['x'])
    mockGetDocument.mockReturnValue({ promise: Promise.resolve(pdf) })
    await extractPdfText(makePdfFile('a.pdf', 5_000))
    expect(mockGlobalWorkerOptions.workerSrc).toBe('mock-worker-url')
  })

  it('concatenates page text items into a single string', async () => {
    const pdf = fakePdfWithPages([
      'hello world from page one',
      'and page two continues here',
    ])
    mockGetDocument.mockReturnValue({ promise: Promise.resolve(pdf) })
    const result = await extractPdfText(makePdfFile('a.pdf', 5_000))
    expect(result.text).toContain('hello world from page one')
    expect(result.text).toContain('and page two continues here')
    expect(result.isScanned).toBe(false)
  })

  it('marks isScanned=true when text is empty AND file is large (>= 100KB)', async () => {
    const pdf = fakePdfWithPages([''])
    mockGetDocument.mockReturnValue({ promise: Promise.resolve(pdf) })
    const result = await extractPdfText(makePdfFile('scan.pdf', 200_000))
    expect(result.text).toBe('')
    expect(result.isScanned).toBe(true)
  })

  it('does NOT mark isScanned=true on a small empty PDF (below size threshold)', async () => {
    // Rationale: a 5KB blank-form PDF is ambiguous, not necessarily a scan.
    // The heuristic is conservative — only large empty PDFs trigger the modal.
    const pdf = fakePdfWithPages([''])
    mockGetDocument.mockReturnValue({ promise: Promise.resolve(pdf) })
    const result = await extractPdfText(makePdfFile('tiny.pdf', 5_000))
    expect(result.isScanned).toBe(false)
  })

  it('throws ERR_PDF_PASSWORD on password-protected PDF', async () => {
    mockGetDocument.mockImplementation(() => ({
      promise: Promise.reject(new Error('No password given for encrypted document')),
    }))
    await expect(extractPdfText(makePdfFile('locked.pdf', 5_000))).rejects.toMatchObject({
      code: 'ERR_PDF_PASSWORD',
    })
  })

  it('throws ERR_PDF_CORRUPT on invalid PDF bytes', async () => {
    mockGetDocument.mockImplementation(() => ({
      promise: Promise.reject(new Error('Invalid PDF structure')),
    }))
    await expect(extractPdfText(makePdfFile('broken.pdf', 5_000))).rejects.toMatchObject({
      code: 'ERR_PDF_CORRUPT',
    })
  })

  it('throws ERR_PDF_LOAD on generic load failures', async () => {
    mockGetDocument.mockImplementation(() => ({
      promise: Promise.reject(new Error('worker fetch failed')),
    }))
    await expect(extractPdfText(makePdfFile('x.pdf', 5_000))).rejects.toMatchObject({
      code: 'ERR_PDF_LOAD',
    })
  })
})
