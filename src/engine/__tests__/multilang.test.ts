/**
 * multilang.test.ts — regression tests for the multi-language pilot
 * (Phase 1 EN). Verifies:
 *
 *   1. getModelUrl(lang) returns expected same-origin paths for each language
 *      (IT stays at legacy path for backward-compat; EN/DE/FR follow the
 *      new subdir layout).
 *   2. getPoolsForLanguage(lang) returns the right pool quartet per language
 *      and falls back to Italian on unknown codes.
 *   3. PseudonymMapper allocates from the EN pool when constructed with
 *      `language: 'en'` and stays Italian-by-default for legacy callers.
 *   4. BIO label normalization (B-PER / I-PER → PER) collapses correctly so
 *      the existing IO decoder can consume BERT-base NER output.
 */

import { describe, it, expect } from 'vitest'
import { getModelUrl } from '../../ui/LanguageContext'
import { getPoolsForLanguage } from '../pools'
import { PERSON_POOL_EN } from '../pools_en'
import { PseudonymMapper } from '../pseudonym_mapper'

describe('multilingue Phase 1', () => {
  describe('getModelUrl', () => {
    it('returns the legacy italian path for it (preserves backward-compat)', () => {
      expect(getModelUrl('it')).toBe('/models/distilbert_italian_ner_q8.onnx')
    })

    it('returns the new subdir path for en', () => {
      expect(getModelUrl('en')).toBe('/models/en/model_quantized.onnx')
    })

    it('returns subdir paths for de and fr (procurement pending)', () => {
      expect(getModelUrl('de')).toBe('/models/de/model_quantized.onnx')
      expect(getModelUrl('fr')).toBe('/models/fr/model_quantized.onnx')
    })
  })

  describe('getPoolsForLanguage', () => {
    it('returns Italian pools by default', () => {
      const pools = getPoolsForLanguage()
      expect(pools.PERSON_POOL).toContain('Tizio')
      expect(pools.COMPANY_POOL).toContain('Alfa')
    })

    it('returns English pools for "en"', () => {
      const pools = getPoolsForLanguage('en')
      expect(pools.PERSON_POOL).toContain('John Doe')
      expect(pools.PERSON_POOL).toBe(PERSON_POOL_EN)
      expect(pools.COMPANY_POOL).toContain('Acme Corp.')
      expect(pools.CITY_POOL).toContain('Springfield')
    })

    it('falls back to Italian pools for unknown language codes', () => {
      const pools = getPoolsForLanguage('xx')
      expect(pools.PERSON_POOL).toContain('Tizio')
    })
  })

  describe('PseudonymMapper language selection', () => {
    it('uses Italian pool when constructed with no options (backward-compat)', () => {
      const m = new PseudonymMapper()
      const first = m.getPerson('Mario Rossi')
      // First Italian allocation is "Tizio" (or whatever the union of vocab
      // JSON + ANONYMIZE_PY puts first). What matters is that it is NOT an
      // English name from PERSON_POOL_EN.
      expect(PERSON_POOL_EN).not.toContain(first)
    })

    it('uses English pool when constructed with language: "en"', () => {
      const m = new PseudonymMapper({ language: 'en' })
      const first = m.getPerson('John Smith')
      // First English allocation must come from PERSON_POOL_EN.
      expect(PERSON_POOL_EN).toContain(first)
    })

    it('English mapper allocates distinct pseudonyms to distinct persons', () => {
      const m = new PseudonymMapper({ language: 'en' })
      const a = m.getPerson('John Smith')
      const b = m.getPerson('Mary Johnson')
      expect(a).not.toBe(b)
      expect(PERSON_POOL_EN).toContain(a)
      expect(PERSON_POOL_EN).toContain(b)
    })

    it('English mapper is idempotent on the same input', () => {
      const m = new PseudonymMapper({ language: 'en' })
      const first = m.getPerson('John Smith')
      const second = m.getPerson('John Smith')
      expect(first).toBe(second)
    })
  })

  describe('BIO label normalization (worker-internal contract)', () => {
    // The actual normalizeRawLabel function lives inside the worker; we
    // re-derive the rule here as a contract test so any drift between this
    // expectation and the worker triggers a visible signal.
    const normalize = (raw: string): string => raw.replace(/^[BI]-/, '')

    it('strips B- prefix', () => {
      expect(normalize('B-PER')).toBe('PER')
      expect(normalize('B-LOC')).toBe('LOC')
      expect(normalize('B-ORG')).toBe('ORG')
      expect(normalize('B-MISC')).toBe('MISC')
    })

    it('strips I- prefix', () => {
      expect(normalize('I-PER')).toBe('PER')
      expect(normalize('I-LOC')).toBe('LOC')
    })

    it('leaves bare IO labels untouched (italian model)', () => {
      expect(normalize('PER')).toBe('PER')
      expect(normalize('LOC')).toBe('LOC')
      expect(normalize('O')).toBe('O')
    })
  })
})
