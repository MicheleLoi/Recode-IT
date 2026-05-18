/**
 * extract_docx.ts — mammoth.js wrapper for browser-side DOCX text extraction.
 *
 * Implements DESIGN.md §3 (frontend stack: mammoth.js for DOCX extraction).
 *
 * mammoth offers both `extractRawText` (plain string) and `convertToHtml`
 * (HTML with style mapping). The pseudonymization pipeline downstream operates
 * on plain text — formatting carries no semantic value here — so we use
 * `extractRawText`. This also keeps the extraction surface minimal: no HTML
 * sanitization concern, no style-map configuration to maintain.
 *
 * Legacy `.doc` (binary OLE format, Office 97-2003) is NOT supported by
 * mammoth; a `.doc` file dropped here will throw `ERR_DOCX_FORMAT`. This is
 * intentional — supporting binary `.doc` would require a separate parser
 * (e.g. wvWare/antiword) and the modern court-document corpus is overwhelmingly
 * `.docx`. The UI dispatcher (`extract.ts`) only routes `.docx`, so a `.doc`
 * file will be caught earlier by the unsupported-extension branch.
 */

import mammoth from 'mammoth'

export type DocxExtractResult = {
  text: string
}

/**
 * Extract plain text from a DOCX file.
 *
 * @throws Error with `code` property:
 *   - `ERR_DOCX_FORMAT` — bytes are not a valid DOCX (e.g. legacy .doc, or
 *     completely unrelated file with `.docx` extension)
 *   - `ERR_DOCX_CORRUPT` — file is DOCX-shaped but parsing failed mid-stream
 *   - `ERR_DOCX_LOAD` — generic load failure (read/IO error)
 */
export async function extractDocxText(file: File): Promise<string> {
  let arrayBuffer: ArrayBuffer
  try {
    arrayBuffer = await file.arrayBuffer()
  } catch (err) {
    const e = new Error(`Impossibile leggere il file: ${(err as Error).message}`)
    ;(e as Error & { code?: string }).code = 'ERR_DOCX_LOAD'
    throw e
  }

  try {
    const result = await mammoth.extractRawText({ arrayBuffer })
    return result.value.trim()
  } catch (err) {
    const msg = (err as Error).message ?? ''
    const e = new Error(`Errore nell'estrazione DOCX: ${msg}`)
    // mammoth surfaces "Could not find file in options" / "end of central
    // directory" / similar messages when the bytes aren't a valid ZIP/DOCX.
    if (/zip|central directory|not.*docx|signature/i.test(msg)) {
      ;(e as Error & { code?: string }).code = 'ERR_DOCX_FORMAT'
    } else {
      ;(e as Error & { code?: string }).code = 'ERR_DOCX_CORRUPT'
    }
    throw e
  }
}
