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

// ---------------------------------------------------------------------------
// PHONE reversibility — value-distinct numbered tokens (bug fix 2026-05-30).
//
// Before the fix every detected number collapsed to a single constant
// `<PHONE>`, so on Decodifica the first realValue overwrote ALL occurrences and
// distinct numbers came back identical (silent data loss). The fix numbers
// tokens per DISTINCT canonical (E.164) value — `<PHONE_1>`, `<PHONE_2>`, … —
// mirroring the gated Date/CAP detectors. This locks the round-trip contract:
//   - same physical number, ANY format  → same token (canonical collapse)
//   - genuinely distinct numbers         → distinct tokens (injective map)
//   - Decodifica reconstructs each number to its own original value
// ---------------------------------------------------------------------------

describe('phone reversibility — value-distinct numbered tokens', () => {
  // Four valid IT mobiles. #1 appears TWICE, the second time in a different
  // surface format (+39 prefix + grouping) to prove canonical collapse. #2/#3/#4
  // are distinct. (libphonenumber must validate each as an IT number, else the
  // gate in phone-detector.ts drops it.)
  const PHONE_1_BARE = '333 111 2222'
  const PHONE_1_INTL = '+39 333 111 2222' // same number as PHONE_1_BARE
  const PHONE_2 = '340 555 6677'
  const PHONE_3 = '348 999 0011'

  const original =
    `Chiamare il sig. Rossi al ${PHONE_1_BARE} oppure al ${PHONE_2}. ` +
    `Per la pratica usare ${PHONE_3}; in alternativa lo stesso numero ${PHONE_1_INTL}.`

  it('encode: 3 distinct numbers → <PHONE_1..3>, repeated number shares its token', () => {
    const result = anonymize(original)

    const phoneEntries = result.mappingEntries.filter(
      (e) => e.category === 'PHONE',
    )
    const tokens = phoneEntries.map((e) => e.pseudonym)

    // Exactly three distinct tokens (PHONE_1 appears twice in text but is one
    // mapping entry; PHONE_2, PHONE_3 are the others).
    expect(new Set(tokens)).toEqual(
      new Set(['<PHONE_1>', '<PHONE_2>', '<PHONE_3>']),
    )
    expect(phoneEntries).toHaveLength(3)

    // The old constant token must be gone.
    expect(result.pseudonymizedText).not.toMatch(/<PHONE>/)
    // No raw IT mobile shape survives in the pseudonymized text.
    expect(result.pseudonymizedText).not.toMatch(/\b3\d{2}[ .]?\d{3}[ .]?\d{4}\b/)

    // The repeated number (both formats) collapses to a SINGLE token, which
    // therefore appears twice in the output.
    const token1 = phoneEntries.find((e) =>
      e.realValue.replace(/\D/g, '').endsWith('3331112222'),
    )?.pseudonym
    expect(token1).toBeDefined()
    const occurrences = result.pseudonymizedText.split(token1 as string).length - 1
    expect(occurrences).toBe(2)
  })

  it('decode: each distinct number is reconstructed to its own value', () => {
    const result = anonymize(original)

    // Decodifica reverse pass: feed the pseudonymized text + mapping back
    // through recodeText (exactly what DecodificaPanel does).
    const recoded = recodeText(result.pseudonymizedText, result.mappingEntries)

    // Every distinct number is back, each restored to its OWN value — the
    // bug would have produced three identical numbers here.
    expect(recoded).toContain(PHONE_2)
    expect(recoded).toContain(PHONE_3)
    // PHONE_1: both surfaces collapsed to one token → both decode to the
    // first-seen original surface (the bare form). The number is preserved;
    // the surface format of the second mention canonicalises to the first.
    const digitsOnly = recoded.replace(/\D/g, '')
    expect((digitsOnly.match(/3331112222/g) ?? []).length).toBe(2)

    // No pseudonym token survives the reverse pass.
    expect(recoded).not.toMatch(/<PHONE_\d+>/)
    expect(recoded).not.toMatch(/<PHONE>/)
  })
})
