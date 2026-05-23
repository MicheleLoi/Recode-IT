/**
 * mapping-store.view-key.test.ts — exercise the view-key helpers added in
 * the view-key add-on (capabilities_index §9.9).
 *
 *   - getCurrentMappingReadOnly() derives Map<original→pseudonym> from
 *     MappingEntry[]; excludes false-positives; returns null on empty.
 *   - mappingToCsv() emits RFC 4180 CSV with UTF-8 BOM for Excel.
 */

import { describe, it, expect } from 'vitest'
import type { MappingEntry } from '../../types/engine'
import { getCurrentMappingReadOnly, mappingToCsv } from '../mapping-store'

describe('getCurrentMappingReadOnly', () => {
  it('returns null on null / undefined / empty input', () => {
    expect(getCurrentMappingReadOnly(null)).toBeNull()
    expect(getCurrentMappingReadOnly(undefined)).toBeNull()
    expect(getCurrentMappingReadOnly([])).toBeNull()
  })

  it('returns a Map<original, pseudonym> for normal entries', () => {
    const entries: MappingEntry[] = [
      { pseudonym: 'Tizio', realValue: 'Mario Rossi', category: 'persona' },
      { pseudonym: 'Caio', realValue: 'Giulia Bianchi', category: 'persona' },
    ]
    const m = getCurrentMappingReadOnly(entries)
    expect(m).not.toBeNull()
    expect(m!.size).toBe(2)
    expect(m!.get('Mario Rossi')).toBe('Tizio')
    expect(m!.get('Giulia Bianchi')).toBe('Caio')
  })

  it('excludes false-positive entries', () => {
    const entries: MappingEntry[] = [
      { pseudonym: 'Tizio', realValue: 'Mario Rossi', category: 'persona' },
      {
        pseudonym: 'Emilia',
        realValue: 'Emilia',
        category: 'persona',
        isFalsePositive: true,
      },
      { pseudonym: 'Caio', realValue: 'Giulia Bianchi', category: 'persona' },
    ]
    const m = getCurrentMappingReadOnly(entries)
    expect(m).not.toBeNull()
    expect(m!.size).toBe(2)
    expect(m!.has('Emilia')).toBe(false)
    expect(m!.has('Mario Rossi')).toBe(true)
    expect(m!.has('Giulia Bianchi')).toBe(true)
  })

  it('returns null when all entries are false positives', () => {
    const entries: MappingEntry[] = [
      {
        pseudonym: 'A',
        realValue: 'A',
        category: 'persona',
        isFalsePositive: true,
      },
      {
        pseudonym: 'B',
        realValue: 'B',
        category: 'persona',
        isFalsePositive: true,
      },
    ]
    expect(getCurrentMappingReadOnly(entries)).toBeNull()
  })

  it('first-wins on duplicate realValue across entries', () => {
    const entries: MappingEntry[] = [
      { pseudonym: 'Tizio', realValue: 'Mario Rossi', category: 'persona' },
      // Could happen if merging across documents drifted (defensive case).
      { pseudonym: 'Tizio2', realValue: 'Mario Rossi', category: 'persona' },
    ]
    const m = getCurrentMappingReadOnly(entries)
    expect(m!.get('Mario Rossi')).toBe('Tizio')
  })
})

describe('mappingToCsv', () => {
  it('emits a header row plus data rows with default header labels', () => {
    const m = new Map<string, string>([
      ['Mario Rossi', 'Tizio'],
      ['Giulia Bianchi', 'Caio'],
    ])
    const csv = mappingToCsv(m)
    const lines = csv.split('\r\n').filter((l) => l !== '')
    // First line is BOM-prefixed header.
    expect(lines[0]).toContain('Originale')
    expect(lines[0]).toContain('Pseudonimo')
    expect(lines).toContain('Mario Rossi,Tizio')
    expect(lines).toContain('Giulia Bianchi,Caio')
  })

  it('honors custom header labels (localization)', () => {
    const m = new Map<string, string>([['Mario Rossi', 'Tizio']])
    const csv = mappingToCsv(m, { original: 'Original', pseudonym: 'Pseudonym' })
    expect(csv).toContain('Original,Pseudonym')
  })

  it('starts with a UTF-8 BOM for Excel compatibility', () => {
    const m = new Map<string, string>([['a', 'b']])
    const csv = mappingToCsv(m)
    // BOM is U+FEFF (decimal 65279).
    expect(csv.charCodeAt(0)).toBe(0xfeff)
  })

  it('escapes values containing comma, quote, or newline (RFC 4180)', () => {
    const m = new Map<string, string>([
      ['Rossi, Mario', 'Tizio'],
      ['Quote "Test"', 'Caio'],
      ['Multi\nLine', 'Sempronio'],
    ])
    const csv = mappingToCsv(m)
    expect(csv).toContain('"Rossi, Mario",Tizio')
    expect(csv).toContain('"Quote ""Test""",Caio')
    expect(csv).toContain('"Multi\nLine",Sempronio')
  })

  it('emits CRLF line terminators (RFC 4180)', () => {
    const m = new Map<string, string>([['a', 'b']])
    const csv = mappingToCsv(m)
    expect(csv).toContain('\r\n')
  })

  it('handles an empty map gracefully (header only)', () => {
    const m = new Map<string, string>()
    const csv = mappingToCsv(m)
    // Should have just one header line + trailing newline.
    const lines = csv.split('\r\n').filter((l) => l !== '')
    expect(lines.length).toBe(1)
    expect(lines[0]).toContain('Originale')
  })
})
