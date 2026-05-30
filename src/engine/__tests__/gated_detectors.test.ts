/**
 * gated_detectors.test.ts — opt-in Date + CAP detectors and their integration
 * into `anonymize`, plus the encode→decode round-trip via
 * `applyReverseSubstitution`.
 *
 * Founder criterio canonico `_org/decision_log.md` MHC-Work 2026-05-30
 * SID-20260530-095254: Date e CAP sono rilevatori OPT-IN (default OFF), con
 * trade-off giuridico; ogni valore distinto riceve un token numerato
 * (<DATA_n>/<CAP_n>) round-trippabile dalla Decodifica.
 */

import { describe, it, expect } from 'vitest'
import { anonymize } from '../engine'
import {
  detectCaps,
  detectDates,
  detectGated,
} from '../gated_detectors'
import { applyReverseSubstitution } from '../../ui/DecodificaPanel'

// ---------------------------------------------------------------------------
// Date detector — unit
// ---------------------------------------------------------------------------

describe('detectDates — numeric formats', () => {
  it.each([
    ['12/03/2024', '12/03/2024'],
    ['12-03-2024', '12-03-2024'],
    ['12.03.2024', '12.03.2024'],
    ['2024-03-12', '2024-03-12'],
    ['5/3/24', '5/3/24'],
  ])('matches %s', (input, expected) => {
    const hits = detectDates(`evento del ${input} ore 10`)
    expect(hits.map((h) => h.match)).toContain(expected)
  })
})

describe('detectDates — textual Italian formats', () => {
  it.each([
    '12 marzo 2024',
    '1 gennaio 2025',
    '5 set 2023',
    '30 settembre 2024',
    '8 dic 2022',
  ])('matches "%s"', (input) => {
    const hits = detectDates(`firmato il ${input} a Milano`)
    expect(hits.map((h) => h.match)).toContain(input)
  })

  it('matches an ordinal day (1° gennaio 2025)', () => {
    const hits = detectDates('decorrenza 1° gennaio 2025 salvo')
    expect(hits.some((h) => h.match.includes('gennaio'))).toBe(true)
  })

  it('does NOT match a bare month word without a day+year', () => {
    const hits = detectDates('nel mese di marzo si terrà')
    expect(hits).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// CAP detector — unit (context-aware)
// ---------------------------------------------------------------------------

describe('detectCaps — keyword context', () => {
  it.each(['CAP 20100', 'C.A.P. 00185', 'cap: 35100'])(
    'matches "%s" capturing only the 5 digits',
    (input) => {
      const hits = detectCaps(`indirizzo, ${input}, citta`)
      expect(hits).toHaveLength(1)
      expect(hits[0]!.match).toMatch(/^\d{5}$/)
    },
  )
})

describe('detectCaps — address shape (5 digits + city)', () => {
  it('matches "20100 Milano"', () => {
    const hits = detectCaps('Via Roma 1, 20100 Milano (MI)')
    expect(hits.map((h) => h.match)).toContain('20100')
  })

  it('matches "00185 Roma"', () => {
    const hits = detectCaps('residente in 00185 Roma')
    expect(hits.map((h) => h.match)).toContain('00185')
  })
})

describe('detectCaps — false-positive avoidance (bare 5-digit runs)', () => {
  it('does NOT match a bare 5-digit number with no CAP context', () => {
    const hits = detectCaps('importo di 20100 euro versati')
    expect(hits).toHaveLength(0)
  })

  it('does NOT match a 5-digit run followed by a lowercase word', () => {
    const hits = detectCaps('codice 12345 interno pratica')
    expect(hits).toHaveLength(0)
  })

  it('does NOT match a 6-digit run', () => {
    const hits = detectCaps('CAP 201000 errato')
    // 201000 is 6 digits — the \b\d{5}\b in the keyword rule won't bite the
    // first 5 because the 6th digit is a word char (no boundary).
    expect(hits).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// detectGated — token numbering + dedupe
// ---------------------------------------------------------------------------

describe('detectGated — numbered tokens, distinct per value', () => {
  it('assigns one token per distinct date, sharing across repeats', () => {
    const text = 'il 12/03/2024 e ancora il 12/03/2024, poi il 05/06/2025'
    const { spans, entries } = detectGated(text, new Set(['date']))
    // 3 spans (2 repeats + 1 distinct), 2 distinct entries.
    expect(spans).toHaveLength(3)
    expect(entries).toHaveLength(2)
    const tokens = new Set(spans.map((s) => s.token))
    expect(tokens.size).toBe(2)
    expect([...tokens].every((t) => /^<DATA_\d+>$/.test(t))).toBe(true)
  })

  it('uses independent counters for DATA and CAP', () => {
    const text = '20100 Milano, evento del 12 marzo 2024'
    const { entries } = detectGated(text, new Set(['date', 'cap']))
    const tokens = entries.map((e) => e.pseudonym).sort()
    expect(tokens).toContain('<CAP_1>')
    expect(tokens).toContain('<DATA_1>')
  })

  it('returns nothing when the relevant detector is not enabled', () => {
    const text = 'il 12/03/2024 a 20100 Milano'
    expect(detectGated(text, new Set()).spans).toHaveLength(0)
    // Only CAP enabled → date not detected.
    const capOnly = detectGated(text, new Set(['cap']))
    expect(capOnly.entries.every((e) => e.category === 'cap')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// anonymize integration — gated detectors are OPT-IN
// ---------------------------------------------------------------------------

describe('anonymize — gated detectors are OFF by default', () => {
  it('leaves dates and CAPs untouched when no detector is enabled', () => {
    const text = 'Contratto del 12/03/2024, sede 20100 Milano.'
    const result = anonymize(text)
    expect(result.pseudonymizedText).toContain('12/03/2024')
    expect(result.pseudonymizedText).toContain('20100')
  })

  it('masks dates only when "date" is enabled', () => {
    const text = 'Contratto del 12/03/2024 firmato.'
    const result = anonymize(text, {
      enabledGatedDetectors: new Set(['date']),
    })
    expect(result.pseudonymizedText).not.toContain('12/03/2024')
    expect(result.pseudonymizedText).toMatch(/<DATA_\d+>/)
    const entry = result.mappingEntries.find((e) => e.category === 'data')
    expect(entry?.realValue).toBe('12/03/2024')
    expect(entry?.isPreserved).toBe(false)
  })

  it('masks CAPs only when "cap" is enabled (date stays)', () => {
    const text = 'Sede in 20100 Milano dal 12/03/2024.'
    const result = anonymize(text, {
      enabledGatedDetectors: new Set(['cap']),
    })
    expect(result.pseudonymizedText).not.toContain('20100')
    expect(result.pseudonymizedText).toMatch(/<CAP_\d+>/)
    // Date untouched (not enabled).
    expect(result.pseudonymizedText).toContain('12/03/2024')
  })
})

// ---------------------------------------------------------------------------
// Round-trip (encode → decode) — the cardinal Gate requirement
// ---------------------------------------------------------------------------

describe('round-trip encode→decode — Date + CAP', () => {
  it('restores dates and CAPs exactly via applyReverseSubstitution', () => {
    const original =
      'Udienza del 12/03/2024, rinvio al 5 giugno 2024. ' +
      'Domicilio: 20100 Milano, recapito C.A.P. 00185.'
    const result = anonymize(original, {
      enabledGatedDetectors: new Set(['date', 'cap']),
    })
    // Sanity: the encoded text no longer carries the raw values.
    expect(result.pseudonymizedText).not.toContain('12/03/2024')
    expect(result.pseudonymizedText).not.toContain('5 giugno 2024')
    expect(result.pseudonymizedText).not.toContain('20100')
    expect(result.pseudonymizedText).not.toContain('00185')

    // Decode the encoded text with the produced mapping.
    const decoded = applyReverseSubstitution(
      result.pseudonymizedText,
      result.mappingEntries,
    )
    // Every masked value is restored…
    expect(decoded.output).toContain('12/03/2024')
    expect(decoded.output).toContain('5 giugno 2024')
    expect(decoded.output).toContain('20100')
    expect(decoded.output).toContain('00185')
    // …and no detector token survives the reverse pass.
    expect(decoded.output).not.toMatch(/<DATA_\d+>/)
    expect(decoded.output).not.toMatch(/<CAP_\d+>/)
    // And the round-trip reproduces the original verbatim.
    expect(decoded.output).toBe(original)
  })

  it('round-trips repeated dates with a shared token (no clobber)', () => {
    const original = 'Pagato il 01/02/2023; saldo il 01/02/2023.'
    const result = anonymize(original, {
      enabledGatedDetectors: new Set(['date']),
    })
    // Both occurrences masked with the SAME token (single distinct value).
    const dateEntries = result.mappingEntries.filter((e) => e.category === 'data')
    expect(dateEntries).toHaveLength(1)
    const decoded = applyReverseSubstitution(
      result.pseudonymizedText,
      result.mappingEntries,
    )
    expect(decoded.output).toBe(original)
  })
})

// ---------------------------------------------------------------------------
// Regression — always-on personal identifiers stay masked regardless of the
// gated toggles (flusso standard intatto).
// ---------------------------------------------------------------------------

describe('regression — standard-flow identifiers always masked', () => {
  it('masks CF / IBAN / email / phone / booking even with gated detectors OFF', () => {
    const text =
      'Mario Rossi, C.F. RSSMRA70B03A662E, IBAN IT60X0542811101000000123456, ' +
      'email mario.rossi@studio.it, tel +39 347 551 2093, ' +
      'Numero Prenotazione: ABC123456.'
    const result = anonymize(text)
    expect(result.pseudonymizedText).not.toContain('RSSMRA70B03A662E')
    expect(result.pseudonymizedText).not.toContain('IT60X0542811101000000123456')
    expect(result.pseudonymizedText).not.toContain('mario.rossi@studio.it')
    expect(result.pseudonymizedText).not.toContain('347 551 2093')
    expect(result.pseudonymizedText).not.toContain('ABC123456')
    expect(result.pseudonymizedText).toContain('<DS>')
    expect(result.pseudonymizedText).toContain('<IBAN>')
    expect(result.pseudonymizedText).toContain('<EMAIL>')
    expect(result.pseudonymizedText).toContain('<PHONE>')
    expect(result.pseudonymizedText).toContain('<RES_NUM>')
  })

  it('still masks the same identifiers WITH gated detectors ON', () => {
    const text =
      'C.F. RSSMRA70B03A662E, IBAN IT60X0542811101000000123456 il 12/03/2024.'
    const result = anonymize(text, {
      enabledGatedDetectors: new Set(['date', 'cap']),
    })
    expect(result.pseudonymizedText).toContain('<DS>')
    expect(result.pseudonymizedText).toContain('<IBAN>')
    expect(result.pseudonymizedText).toMatch(/<DATA_\d+>/)
  })
})
