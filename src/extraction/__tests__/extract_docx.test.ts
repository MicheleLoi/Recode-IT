/**
 * extract_docx.test.ts — mammoth wrapper behavior.
 *
 * We mock the `mammoth` module rather than feeding real DOCX bytes: the unit
 * we're testing is the wrapper's error mapping + trim/return shape, not
 * mammoth itself.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('mammoth', () => ({
  default: {
    extractRawText: vi.fn(),
  },
}))

import mammoth from 'mammoth'
import { extractDocxText } from '../extract_docx'

const mockedExtract = vi.mocked(mammoth.extractRawText)

function makeFile(name = 'doc.docx', bytes = new Uint8Array([1, 2, 3])): File {
  return new File([bytes], name)
}

beforeEach(() => {
  mockedExtract.mockReset()
})

describe('extract_docx — extractDocxText', () => {
  it('returns the trimmed text from mammoth.extractRawText', async () => {
    mockedExtract.mockResolvedValue({
      value: '  hello DOCX world\n',
      messages: [],
    })
    const text = await extractDocxText(makeFile())
    expect(text).toBe('hello DOCX world')
  })

  it('passes the file as arrayBuffer to mammoth', async () => {
    mockedExtract.mockResolvedValue({ value: 'x', messages: [] })
    await extractDocxText(makeFile())
    expect(mockedExtract).toHaveBeenCalledTimes(1)
    const firstCall = mockedExtract.mock.calls[0]
    expect(firstCall).toBeDefined()
    const arg = firstCall![0] as { arrayBuffer: ArrayBuffer }
    expect(arg.arrayBuffer).toBeInstanceOf(ArrayBuffer)
  })

  it('throws ERR_DOCX_FORMAT when mammoth reports invalid zip / non-DOCX bytes', async () => {
    mockedExtract.mockRejectedValue(new Error('end of central directory record not found'))
    await expect(extractDocxText(makeFile('not-really.docx'))).rejects.toMatchObject({
      code: 'ERR_DOCX_FORMAT',
    })
  })

  it('throws ERR_DOCX_CORRUPT on a generic mammoth parse error', async () => {
    mockedExtract.mockRejectedValue(new Error('unexpected XML token at offset 42'))
    await expect(extractDocxText(makeFile())).rejects.toMatchObject({
      code: 'ERR_DOCX_CORRUPT',
    })
  })
})
