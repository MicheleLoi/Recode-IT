import { describe, it, expect } from 'vitest'
import { anonymize } from '../engine'
import { recodeText } from '../recode'
import { loadFixture } from './fixtures'

describe('recodeText — primitive', () => {
  it('restores the original via the simplest mapping', () => {
    const result = recodeText('Tizio è in ritardo', [
      {
        pseudonym: 'Tizio',
        realValue: 'Mario Rossi',
        category: 'persona',
      },
    ])
    expect(result).toBe('Mario Rossi è in ritardo')
  })

  it('sorts longest-first to avoid partial matches', () => {
    // "Alfa" is contained in "Alfa S.r.l." — without longest-first sort, a
    // naive replace would partially mangle the longer entry.
    const result = recodeText('Alfa S.r.l. e Alfa hanno fatto causa', [
      { pseudonym: 'Alfa', realValue: 'Acme', category: 'persona' },
      {
        pseudonym: 'Alfa S.r.l.',
        realValue: 'Acme S.r.l.',
        category: 'azienda',
      },
    ])
    expect(result).toBe('Acme S.r.l. e Acme hanno fatto causa')
  })

  it('respects word boundaries (no partial substring replacement)', () => {
    const result = recodeText('Tiziano è un nome diverso da Tizio', [
      { pseudonym: 'Tizio', realValue: 'Mario', category: 'persona' },
    ])
    expect(result).toBe('Tiziano è un nome diverso da Mario')
  })

  it('replaces tag-style pseudonyms (<DS>, <IBAN>, <EMAIL>) literally', () => {
    // CF re-encoded to a checksum-valid form (Pacchetto A
    // SID-20260527-181552). `recodeText` does not validate — it performs
    // a pure tag→realValue substitution — but using a real-valid CF keeps
    // the fixture coherent with the rest of the suite.
    const result = recodeText('CF <DS>, IBAN <IBAN>', [
      {
        pseudonym: '<DS>',
        realValue: 'RSSMRA70B03A662E',
        category: 'CF',
      },
      {
        pseudonym: '<IBAN>',
        realValue: 'IT60X0542811101000000123456',
        category: 'IBAN',
      },
    ])
    expect(result).toBe('CF RSSMRA70B03A662E, IBAN IT60X0542811101000000123456')
  })

  it('returns input unchanged when mapping is empty', () => {
    expect(recodeText('nothing to recode', [])).toBe('nothing to recode')
  })
})

// ---------------------------------------------------------------------------
// Drift smoke (3 cases per TEST_PLAN §"Phase 1 — Drift-smoke") —
// anonymize → recode behavior on the three regression fixtures.
//
// In regex-only Phase 1 mode pseudonyms are tags (`<DS>`, `<IBAN>`, …) and the
// regex layer is intentionally many-to-one (every CF collapses to `<DS>`),
// so an identity round-trip is structurally impossible at this layer — that
// behaviour is identical to the Python `apply_regex_rules`. The drift-smoke
// contract here is the one in TEST_PLAN §DS.1/DS.2/DS.3:
//   DS.1 — mapping is non-empty for documents containing detectable entities.
//   DS.2 — given a hand-rolled passage that references each detected pseudonym
//          tag, `recodeText` produces output with zero pseudonym tokens
//          surviving.
//   DS.3 — pseudonymized output contains no CF / IBAN / EMAIL plaintext.
// ---------------------------------------------------------------------------

describe('drift smoke — anonymize → recode (regex-only, Phase 1)', () => {
  const fixtures = [
    'doc_A_fendipista',
    'doc_B_eredita',
    'doc_C_il_leak',
  ] as const

  for (const fixture of fixtures) {
    it(`DS.1 ${fixture}: mapping is non-empty`, () => {
      const original = loadFixture(fixture)
      const result = anonymize(original)
      expect(result.mappingEntries.length).toBeGreaterThan(0)
    })

    it(`DS.2 ${fixture}: simulated Claude output → recode strips all pseudonym tags`, () => {
      const original = loadFixture(fixture)
      const result = anonymize(original)
      // Build a synthetic Claude-style passage referencing each pseudonym tag
      // in a sentence — recode must remove every tag.
      const uniquePseudonyms = [
        ...new Set(result.mappingEntries.map((e) => e.pseudonym)),
      ]
      const claudeLike = uniquePseudonyms
        .map((p) => `Riferimento al token ${p} nel testo.`)
        .join(' ')
      const recoded = recodeText(claudeLike, result.mappingEntries)
      // Every tag must be replaced — drift = 0 for the recoded output.
      for (const tag of uniquePseudonyms) {
        expect(recoded.includes(tag)).toBe(false)
      }
    })

    it(`DS.3 ${fixture}: no plaintext identifiers leak in pseudonymized output`, () => {
      const original = loadFixture(fixture)
      const result = anonymize(original)
      // No 16-char Italian CF survives.
      expect(result.pseudonymizedText).not.toMatch(
        /\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/i,
      )
      // No IT IBAN survives.
      expect(result.pseudonymizedText).not.toMatch(/\bIT\d{2}[A-Z0-9]{23}\b/)
      // No raw email survives.
      expect(result.pseudonymizedText).not.toMatch(
        /\b[\w.+-]+@[\w.-]+\.\w{2,}\b/,
      )
    })
  }
})
