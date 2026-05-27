/**
 * cf-validator.test.ts — coverage for the CEI 12-1979 check-digit validator.
 *
 * Pacchetto A SID-20260527-181552: post-regex FP rejection. The validator
 * MUST accept canonical Italian fiscal codes, accept omocoded variants
 * (digit→letter substitutions in positions 7-8, 10-11, 13-15), and reject
 * checksum-invalid tokens regardless of shape.
 */

import { describe, it, expect } from 'vitest'
import { validateCF, OMOCODIA_LETTERS } from '../cf-validator'

describe('validateCF — canonical Italian fiscal codes', () => {
  // Each pair below is `(prefix, expected_check_digit)` computed offline against
  // the CEI 12-1979 ODD/EVEN tables. Real-encoding, no homocodia.
  const VALID_CANONICAL: ReadonlyArray<string> = [
    'RSSMRA70B03A662E',
    'RSSMRA70A01H501S',
    'RSSMRO80A01H501I',
    'RNLLSS84C52H501U',
    'BLLMRC79A11F205K',
    'RSSMRA80A01H501U',
    'BNCGLI90B02H501E',
    'FRRMRC80A01L219O',
    'BRMCRL55D01F205A',
  ]
  for (const cf of VALID_CANONICAL) {
    it(`accepts ${cf}`, () => {
      expect(validateCF(cf)).toBe(true)
    })
  }

  it('is case-insensitive (lowercase input is normalised)', () => {
    expect(validateCF('rssmra70b03a662e')).toBe(true)
    expect(validateCF('Rssmra70B03A662E')).toBe(true)
  })

  it('strips whitespace separators before validating', () => {
    expect(validateCF('RSS MRA 70B03 A662E')).toBe(true)
    expect(validateCF('RSSMRA 70B03 A662E')).toBe(true)
    expect(validateCF('RSS MRA 70B03  A662E')).toBe(true)
  })
})

describe('validateCF — omocoded INPS variants', () => {
  // Omocodia mapping (D.M. 12 marzo 1974): 0→L, 1→M, 2→N, 3→P, 4→Q, 5→R,
  // 6→S, 7→T, 8→U, 9→V — applied in the 3 substitution-eligible blocks
  // (anno YY pos 7-8, giorno DD pos 10-11, codice catastale pos 13-15).
  // The 16th-char checksum is recomputed on the literal omocoded form.

  it('accepts an omocoded CF with substitutions in day and city positions', () => {
    // Canonical RNLLSS84C52H501U → omocoded RNLLSS84CR2H50LK
    //  - position 11 (giorno-tens): 5 → R
    //  - position 15 (city last digit): 1 → L
    //  - new check digit recomputed from the omocoded form: K (not U)
    expect(validateCF('RNLLSS84CR2H50LK')).toBe(true)
  })

  it('accepts the canonical sibling of the same case (regression guard)', () => {
    expect(validateCF('RNLLSS84C52H501U')).toBe(true)
  })

  it('rejects an omocoded CF when the 16th char is the canonical check digit', () => {
    // RNLLSS84CR2H50L_U (using U, which is the CANONICAL check digit, not
    // the omocoded one). The literal-form checksum is K, so this must
    // fail.
    expect(validateCF('RNLLSS84CR2H50LU')).toBe(false)
  })

  it('exports the OMOCODIA_LETTERS string for regex char-class composition', () => {
    expect(OMOCODIA_LETTERS).toBe('LMNPQRSTUV')
  })
})

describe('validateCF — false positives rejected', () => {
  it('rejects a CF-shaped string with the wrong check digit', () => {
    // ABCDEF12A34H567E is the valid checksum form (computed offline);
    // ABCDEF12A34H567Z is the same shape with a deliberately wrong 16th
    // char. The shape passes the regex (positions 1-15 are alphanumeric,
    // month is A=gennaio), so the validator is the only gate.
    expect(validateCF('ABCDEF12A34H567Z')).toBe(false)
  })

  it('rejects strings of the wrong length', () => {
    expect(validateCF('RSSMRA70B03A662')).toBe(false) // 15 chars
    expect(validateCF('RSSMRA70B03A662EX')).toBe(false) // 17 chars
    expect(validateCF('')).toBe(false)
  })

  it('rejects strings with non-alphanumeric chars after whitespace strip', () => {
    // After stripping spaces, this is "RSSMRA70B03A662E-" — 17 chars (the
    // dash is preserved). Length mismatch ⇒ false.
    expect(validateCF('RSSMRA70B03A662E-')).toBe(false)
    // Punctuation in the middle of the 16-char block also produces a non-
    // alphanumeric character that the validator rejects up-front.
    expect(validateCF('RSSMRA.70B03A662')).toBe(false)
  })

  it('handles non-string inputs gracefully (no throw, returns false)', () => {
    // The validator must never throw, even on unexpected input types.
    expect(validateCF(undefined as unknown as string)).toBe(false)
    expect(validateCF(null as unknown as string)).toBe(false)
    expect(validateCF(12345 as unknown as string)).toBe(false)
  })
})
