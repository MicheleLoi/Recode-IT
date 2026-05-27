/**
 * iban-validator.test.ts — coverage for the ISO 13616 MOD-97 IBAN validator.
 *
 * Pacchetto C SID-20260527-181552: post-regex FP rejection. The validator
 * MUST accept valid Italian IBANs in canonical and 4-char-grouped forms,
 * reject IT-shaped tokens with wrong MOD-97 residue, and reject inputs
 * outside the ISO 13616 length envelope.
 */

import { describe, it, expect } from 'vitest'
import { validateIBAN } from '../iban-validator'

describe('validateIBAN — canonical Italian IBANs', () => {
  it('accepts the canonical 27-char Italian form', () => {
    // IT60X0542811101000000123456 — fixture used across the suite,
    // independently verified MOD-97 valid.
    expect(validateIBAN('IT60X0542811101000000123456')).toBe(true)
  })

  it('accepts a generator-valid second Italian IBAN', () => {
    // IT81A1234500000123456789012 — computed with checkdigit = 98 - mod97.
    expect(validateIBAN('IT81A1234500000123456789012')).toBe(true)
  })

  it('is case-insensitive (lowercase normalised before MOD-97)', () => {
    expect(validateIBAN('it60x0542811101000000123456')).toBe(true)
  })
})

describe('validateIBAN — separator-tolerant documentary forms', () => {
  it('accepts the 4-char-grouped form with whitespace separators', () => {
    expect(validateIBAN('IT60 X054 2811 1010 0000 0123 456')).toBe(true)
  })

  it('accepts the 4-char-grouped form with dash separators', () => {
    expect(validateIBAN('IT60-X054-2811-1010-0000-0123-456')).toBe(true)
  })

  it('accepts a mixed-separator form', () => {
    // ISO 13616 reading conventions don't enforce uniform separators; the
    // validator strips ALL whitespace and dashes before computing.
    expect(validateIBAN('IT60 X054-2811 1010-0000 0123-456')).toBe(true)
  })
})

describe('validateIBAN — false positives rejected', () => {
  it('rejects an IT-shaped IBAN with the wrong check digits', () => {
    // IT99X0000000000000000000000 has canonical Italian shape but MOD-97
    // residue ≠ 1.
    expect(validateIBAN('IT99X0000000000000000000000')).toBe(false)
  })

  it('rejects a one-char perturbation of a valid IBAN', () => {
    // Flip a single character in the BBAN — MOD-97 should fail.
    expect(validateIBAN('IT60X0542811101000000123457')).toBe(false)
  })

  it('rejects inputs outside the ISO 13616 length envelope', () => {
    expect(validateIBAN('IT')).toBe(false) // way too short
    expect(validateIBAN('IT60X05428111010000001234561234')).toBe(false) // ovr 27
    expect(validateIBAN('')).toBe(false)
  })

  it('rejects inputs with non-alphanumeric chars (after separator strip)', () => {
    // The `.` is preserved by the separator-strip (only \s and - are
    // stripped), so the regex guard inside the validator rejects.
    expect(validateIBAN('IT60.X0542811101000000123456')).toBe(false)
  })

  it('handles non-string inputs gracefully (no throw, returns false)', () => {
    expect(validateIBAN(undefined as unknown as string)).toBe(false)
    expect(validateIBAN(null as unknown as string)).toBe(false)
    expect(validateIBAN(12345 as unknown as string)).toBe(false)
  })
})
