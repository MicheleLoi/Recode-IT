import { describe, it, expect } from 'vitest'
import { ENGINE_VERSION, anonymize } from './index'

describe('engine entrypoint (Phase 1)', () => {
  it('exposes the Phase 1 version string', () => {
    expect(ENGINE_VERSION).toBe('0.1.0-phase1')
  })

  it('returns the canonical AnonymizeResult shape on a minimal input', () => {
    const result = anonymize('plain text with no identifiers')
    expect(result).toHaveProperty('pseudonymizedText')
    expect(result).toHaveProperty('mappingEntries')
    expect(result).toHaveProperty('collisions')
    expect(result).toHaveProperty('skipSet')
    expect(result).toHaveProperty('regexSubstitutionCounts')
    expect(result.pseudonymizedText).toBe('plain text with no identifiers')
    expect(result.mappingEntries).toEqual([])
    expect(result.collisions.size).toBe(0)
    expect(result.skipSet.size).toBe(0)
  })

  it('runs the regex layer end-to-end on a representative Italian snippet', () => {
    // CF re-encoded to a checksum-valid form (CEI 12-1979) to satisfy the
    // post-match `validateCF` filter introduced in Pacchetto A
    // (SID-20260527-181552). The IBAN was already MOD-97-valid.
    const text =
      'Mario Rossi, C.F. RSSMRA70B03A662E, IBAN IT60X0542811101000000123456, ' +
      'email mario.rossi@studio.it.'
    const result = anonymize(text)
    expect(result.pseudonymizedText).not.toContain('RSSMRA70B03A662E')
    expect(result.pseudonymizedText).not.toContain('IT60X0542811101000000123456')
    expect(result.pseudonymizedText).not.toContain('mario.rossi@studio.it')
    expect(result.pseudonymizedText).toContain('<DS>')
    expect(result.pseudonymizedText).toContain('<IBAN>')
    expect(result.pseudonymizedText).toContain('<EMAIL>')
    expect(result.regexSubstitutionCounts.IBAN).toBe(1)
    expect(result.regexSubstitutionCounts.EMAIL).toBe(1)
    // Two CF rules can both match (16-char literal + the keyword-prefixed
    // numeric variant); the union must be > 0.
    expect((result.regexSubstitutionCounts.CF ?? 0)).toBeGreaterThanOrEqual(1)
  })

  it('honors the A-2 de cuius pre-pass even in regex-only mode', () => {
    const text =
      'L\'Avv. Rossella Amadori, difensore di Erminia Vanzetti, vedova del ' +
      'de cuius Arturo Vanzetti, deceduto il 12 agosto 2024.'
    const result = anonymize(text)
    expect(result.skipSet.has('arturo vanzetti')).toBe(true)
  })

  it('ignores the Phase 4 nerDetections hook without throwing', () => {
    expect(() =>
      anonymize('hello', { nerDetections: [], userFalsePositives: new Set() }),
    ).not.toThrow()
  })
})
