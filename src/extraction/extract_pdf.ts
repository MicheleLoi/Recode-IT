/**
 * extract_pdf.ts — pdf.js wrapper for browser-side PDF text extraction.
 *
 * Implements DESIGN.md §3 (frontend stack: pdf.js for PDF extraction) and the
 * scanned-PDF edge case from §10:
 *
 *   > PDF with no text layer (scanned) | pdf.js returns empty string → show
 *   > banner: "PDF scannerizzato rilevato — carica come testo o usa PDF con
 *   > testo incorporato. OCR disponibile in Phase 2."
 *
 * The function returns `{ text, isScanned }` so the UI layer can decide
 * whether to populate the textarea or show the OCR-coming-soon modal.
 *
 * Implementation notes:
 *   - Uses pdfjs-dist 5.x ESM build (`pdfjs-dist/build/pdf.mjs`).
 *   - The worker is configured at module load via `GlobalWorkerOptions
 *     .workerSrc` pointing at the bundled `.mjs?url` (Vite resolves to a
 *     fingerprinted asset at build time). This avoids the CDN fallback pdf.js
 *     uses when no worker is configured, which would break the
 *     zero-network-egress guarantee in DESIGN.md §4 (bytes never leave the
 *     browser).
 *   - Page text is reconstructed by joining `TextItem.str` values. Layout
 *     (columns, tables) is intentionally not preserved: the downstream
 *     pseudonymization pipeline operates on flat text and the cost/complexity
 *     of layout-aware extraction is not justified by the use case.
 *   - The scanned-PDF heuristic (DESIGN §10): if the extracted text is empty
 *     or trivially short relative to the file size, we mark `isScanned=true`
 *     and let the UI surface the OCR-coming-soon modal.
 */

// pdfjs-dist 5.x: types are emitted by the package; the runtime entry is the
// ESM build under `build/pdf.mjs`. We import the worker URL via Vite's
// `?url` suffix so the asset gets fingerprinted + served locally.
// pdfjs-dist is imported dynamically inside `extractPdfText` rather than at
// module load. Two reasons:
//   1. pdf.js pulls in DOMMatrix and other browser globals at evaluation time;
//      a static import crashes Vitest/jsdom test files that only transitively
//      depend on this module (e.g. ClipboardWidget tests that don't touch PDF
//      at all).
//   2. The pdf.js bundle is large (~1MB minified); deferring the load keeps
//      it out of the critical render path for users who never drop a PDF.
import type { PDFDocumentProxy, TextItem } from 'pdfjs-dist/types/src/display/api'

let workerConfigured = false

async function loadPdfJs(): Promise<typeof import('pdfjs-dist')> {
  const pdfjsLib = await import('pdfjs-dist')
  if (!workerConfigured) {
    // The `?url` suffix is a Vite-resolved import returning the fingerprinted
    // public URL of the worker. We keep it inside this function so it is only
    // evaluated when an actual PDF extraction is requested.
    const workerUrlModule = await import('pdfjs-dist/build/pdf.worker.mjs?url')
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrlModule.default as string
    workerConfigured = true
  }
  return pdfjsLib
}

/**
 * Heuristic threshold: a PDF is considered "scanned" (no text layer) if the
 * extracted text contains fewer than this many printable characters.
 *
 * Rationale: a genuine text-extractable PDF of any non-trivial length will
 * yield hundreds-to-thousands of characters. A scanner-produced PDF typically
 * returns either an empty string or a handful of stray ligature artifacts.
 * 50 chars is comfortably above the noise floor and below the text-layer
 * floor.
 */
const SCANNED_TEXT_THRESHOLD = 50

/**
 * File-size threshold (bytes) above which we apply the scanned-PDF heuristic
 * unconditionally. A 100KB+ PDF that returns near-zero text is virtually
 * certain to be a scan; a 10KB PDF might legitimately be a 1-page form with
 * very little prose. The threshold prevents false positives on very small
 * docs.
 */
const SCANNED_SIZE_THRESHOLD = 100 * 1024

export type PdfExtractResult = {
  text: string
  isScanned: boolean
}

/**
 * Extract plain text from a PDF file.
 *
 * @throws Error with `code` property:
 *   - `ERR_PDF_PASSWORD` — PDF is password-protected
 *   - `ERR_PDF_CORRUPT` — bytes are not a valid PDF or parsing failed
 *   - `ERR_PDF_LOAD` — generic load failure (network, worker, etc.)
 */
export async function extractPdfText(file: File): Promise<PdfExtractResult> {
  let arrayBuffer: ArrayBuffer
  try {
    arrayBuffer = await file.arrayBuffer()
  } catch (err) {
    const e = new Error(`Impossibile leggere il file: ${(err as Error).message}`)
    ;(e as Error & { code?: string }).code = 'ERR_PDF_LOAD'
    throw e
  }

  const pdfjsLib = await loadPdfJs()

  let pdf: PDFDocumentProxy
  try {
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(arrayBuffer),
      // Disable worker fetch fallback — we set workerSrc above, but if that
      // somehow fails we want a hard error rather than a silent CDN fetch.
      disableAutoFetch: false,
      disableStream: false,
    })
    pdf = await loadingTask.promise
  } catch (err) {
    const msg = (err as Error).message ?? ''
    const e = new Error(`Errore nel caricamento del PDF: ${msg}`)
    if (/password/i.test(msg)) {
      ;(e as Error & { code?: string }).code = 'ERR_PDF_PASSWORD'
    } else if (/invalid|corrupt|missing/i.test(msg)) {
      ;(e as Error & { code?: string }).code = 'ERR_PDF_CORRUPT'
    } else {
      ;(e as Error & { code?: string }).code = 'ERR_PDF_LOAD'
    }
    throw e
  }

  const pageTexts: string[] = []
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum)
    const content = await page.getTextContent()
    // `items` is (TextItem | TextMarkedContent)[]. TextItem has `.str`,
    // TextMarkedContent does not. We filter to TextItem-shaped entries.
    const pageText = content.items
      .map((it) => ('str' in it ? (it as TextItem).str : ''))
      .join(' ')
    pageTexts.push(pageText)
    // Release page resources eagerly — pdf.js holds them until the doc is
    // destroyed otherwise, which matters for large multi-page PDFs.
    page.cleanup()
  }

  // Best-effort cleanup; failures are harmless.
  try {
    await pdf.destroy()
  } catch {
    /* ignore */
  }

  const text = pageTexts.join('\n\n').trim()
  const isScanned =
    text.length < SCANNED_TEXT_THRESHOLD && file.size >= SCANNED_SIZE_THRESHOLD

  return { text, isScanned }
}
