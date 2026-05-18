/**
 * extract.ts — file-type dispatcher for text extraction.
 *
 * Wraps `extract_pdf.ts`, `extract_docx.ts`, and the plain `File.text()`
 * reader behind a single async API the UI calls with a `File`. Routing is
 * by lowercased extension (the only signal the File API exposes
 * cross-platform; MIME types are unreliable on Windows drag-drop).
 *
 * Supported formats (DESIGN.md §3 + §9):
 *   - .txt, .md  → File.text() (UTF-8, no extraction layer)
 *   - .docx      → mammoth.js extractRawText
 *   - .pdf       → pdf.js with scanned-PDF heuristic; `scannedPdf=true` tells
 *                  the UI to show the OCR-coming-soon modal (DESIGN.md §10)
 *
 * Unsupported extensions throw `ERR_UNSUPPORTED_FORMAT`. The legacy `.doc`
 * binary format is explicitly not supported (see extract_docx.ts).
 */

import { extractPdfText } from './extract_pdf'
import { extractDocxText } from './extract_docx'

export type ExtractResult = {
  text: string
  /**
   * True iff the file was a PDF that had no extractable text layer (i.e. a
   * scan). Callers should branch on this flag to show the OCR-coming-soon
   * modal instead of populating the textarea with an empty string.
   */
  scannedPdf: boolean
}

export const SUPPORTED_EXTENSIONS = ['.txt', '.md', '.docx', '.pdf'] as const

export type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number]

function getExtension(filename: string): string | null {
  const lower = filename.toLowerCase()
  const idx = lower.lastIndexOf('.')
  if (idx < 0) return null
  return lower.slice(idx)
}

/**
 * Extract plain text from a user-supplied file.
 *
 * @throws Error with `code` property:
 *   - `ERR_UNSUPPORTED_FORMAT` — extension not in `SUPPORTED_EXTENSIONS`
 *   - any error code from the per-format extractors (ERR_PDF_*, ERR_DOCX_*)
 */
export async function extractText(file: File): Promise<ExtractResult> {
  const ext = getExtension(file.name)
  if (ext === null || !SUPPORTED_EXTENSIONS.includes(ext as SupportedExtension)) {
    const e = new Error(
      `Formato non supportato: ${ext ?? '(nessuna estensione)'}. Supportati: ${SUPPORTED_EXTENSIONS.join(', ')}.`,
    )
    ;(e as Error & { code?: string }).code = 'ERR_UNSUPPORTED_FORMAT'
    throw e
  }

  if (ext === '.pdf') {
    const result = await extractPdfText(file)
    return { text: result.text, scannedPdf: result.isScanned }
  }
  if (ext === '.docx') {
    const text = await extractDocxText(file)
    return { text, scannedPdf: false }
  }
  // .txt / .md
  const text = await file.text()
  return { text, scannedPdf: false }
}
