/**
 * extract.test.ts — dispatcher routing tests.
 *
 * The per-format extractors are mocked so the routing logic is exercised in
 * isolation. (PDF/DOCX runtime correctness lives in their own test files.)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the per-format extractors before importing the dispatcher.
vi.mock('../extract_pdf', () => ({
  extractPdfText: vi.fn(),
}))
vi.mock('../extract_docx', () => ({
  extractDocxText: vi.fn(),
}))

import { extractText, SUPPORTED_EXTENSIONS } from '../extract'
import { extractPdfText } from '../extract_pdf'
import { extractDocxText } from '../extract_docx'

const mockedPdf = vi.mocked(extractPdfText)
const mockedDocx = vi.mocked(extractDocxText)

function makeFile(name: string, content: string | ArrayBuffer = 'data'): File {
  return new File([content], name, { type: 'application/octet-stream' })
}

beforeEach(() => {
  mockedPdf.mockReset()
  mockedDocx.mockReset()
})

describe('extract — dispatcher', () => {
  it('exposes the documented supported extensions', () => {
    expect(SUPPORTED_EXTENSIONS).toEqual(['.txt', '.md', '.docx', '.pdf'])
  })

  it('routes .pdf to extractPdfText and forwards isScanned as scannedPdf', async () => {
    mockedPdf.mockResolvedValue({ text: 'pdf body', isScanned: false })
    const result = await extractText(makeFile('doc.pdf'))
    expect(mockedPdf).toHaveBeenCalledTimes(1)
    expect(mockedDocx).not.toHaveBeenCalled()
    expect(result).toEqual({ text: 'pdf body', scannedPdf: false })
  })

  it('propagates scannedPdf=true from the PDF extractor', async () => {
    mockedPdf.mockResolvedValue({ text: '', isScanned: true })
    const result = await extractText(makeFile('scan.pdf'))
    expect(result.scannedPdf).toBe(true)
  })

  it('routes .docx to extractDocxText with scannedPdf=false', async () => {
    mockedDocx.mockResolvedValue('docx body')
    const result = await extractText(makeFile('doc.docx'))
    expect(mockedDocx).toHaveBeenCalledTimes(1)
    expect(mockedPdf).not.toHaveBeenCalled()
    expect(result).toEqual({ text: 'docx body', scannedPdf: false })
  })

  it('routes .txt via File.text() (no extractor invoked)', async () => {
    const result = await extractText(makeFile('note.txt', 'plain content'))
    expect(mockedPdf).not.toHaveBeenCalled()
    expect(mockedDocx).not.toHaveBeenCalled()
    expect(result).toEqual({ text: 'plain content', scannedPdf: false })
  })

  it('routes .md via File.text()', async () => {
    const result = await extractText(makeFile('note.md', '# heading'))
    expect(result.text).toBe('# heading')
    expect(result.scannedPdf).toBe(false)
  })

  it('matches extension case-insensitively', async () => {
    mockedPdf.mockResolvedValue({ text: 'x', isScanned: false })
    await extractText(makeFile('DOC.PDF'))
    expect(mockedPdf).toHaveBeenCalledTimes(1)
  })

  it('throws ERR_UNSUPPORTED_FORMAT for unknown extensions', async () => {
    await expect(extractText(makeFile('thing.xyz'))).rejects.toMatchObject({
      code: 'ERR_UNSUPPORTED_FORMAT',
    })
  })

  it('throws ERR_UNSUPPORTED_FORMAT for legacy .doc (binary)', async () => {
    // mammoth does not support pre-2007 binary .doc; the dispatcher must
    // refuse it before reaching the DOCX extractor.
    await expect(extractText(makeFile('old.doc'))).rejects.toMatchObject({
      code: 'ERR_UNSUPPORTED_FORMAT',
    })
    expect(mockedDocx).not.toHaveBeenCalled()
  })

  it('throws ERR_UNSUPPORTED_FORMAT for files without extension', async () => {
    await expect(extractText(makeFile('README'))).rejects.toMatchObject({
      code: 'ERR_UNSUPPORTED_FORMAT',
    })
  })
})
