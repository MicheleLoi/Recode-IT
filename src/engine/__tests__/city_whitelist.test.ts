/**
 * Tests for the deterministic Italian-city detector (city_whitelist.ts).
 *
 * Founder criterio canonico 2026-05-30 SID-20260530-095254 — la whitelist
 * esiste per fixare la causa B del bug "Firenze→Firenze identity": il NER
 * WikiNER ha recall variabile su città IT in liste enumerative. Questi test
 * garantiscono che almeno i capoluoghi canonici siano sempre catturati,
 * indipendentemente dal contesto.
 */

import { describe, expect, it } from 'vitest'
import {
  detectItalianCities,
  mergeWhitelistWithNer,
  __test__,
} from '../city_whitelist'
import type { NerDetection } from '../../types/engine'

describe('detectItalianCities — canonical capitals coverage', () => {
  it.each([
    ['Firenze'],
    ['Palermo'],
    ['Torino'],
    ['Roma'],
    ['Milano'],
    ['Napoli'],
    ['Bologna'],
    ['Venezia'],
    ['Genova'],
    ['Bari'],
    ['Cagliari'],
    ['Trieste'],
    ['Trento'],
    ['Aosta'],
  ])('detects %s as a luogo span', (city) => {
    const text = `Sede legale a ${city}, in via centrale.`
    const hits = detectItalianCities(text)
    expect(hits).toHaveLength(1)
    expect(hits[0]?.text).toBe(city)
    expect(hits[0]?.label).toBe('luogo')
    expect(hits[0]?.score).toBe(1.0)
  })

  it('detects all 5 cities in a comma-separated enumeration (the original bug surface)', () => {
    const text = 'Capitalia ha sedi a Roma, Milano, Firenze, Torino, Palermo.'
    const hits = detectItalianCities(text)
    const names = hits.map((h) => h.text).sort()
    expect(names).toEqual(['Firenze', 'Milano', 'Palermo', 'Roma', 'Torino'])
  })

  it("handles L'Aquila with both straight and typographic apostrophe", () => {
    const straight = "Il tribunale di L'Aquila ha disposto."
    const typographic = 'Il tribunale di L’Aquila ha disposto.'
    expect(detectItalianCities(straight).map((h) => h.text)).toEqual([
      "L'Aquila",
    ])
    expect(detectItalianCities(typographic).map((h) => h.text)).toEqual([
      'L’Aquila',
    ])
  })

  it('prefers the longer multi-word city over a hypothetical prefix (Reggio Calabria, Reggio Emilia)', () => {
    const text = 'Da Reggio Calabria a Reggio Emilia.'
    const names = detectItalianCities(text).map((h) => h.text)
    expect(names).toContain('Reggio Calabria')
    expect(names).toContain('Reggio Emilia')
  })

  it('is case-sensitive: lowercase mention is NOT caught (delegated to NER)', () => {
    expect(detectItalianCities('mia città è milano')).toHaveLength(0)
  })

  it('respects word boundaries: substring matches are NOT caught', () => {
    // "Romano" should NOT match "Roma"; "Trani" full-word should match.
    expect(detectItalianCities('Mario Romano')).toHaveLength(0)
    expect(detectItalianCities('passa per Trani')).toHaveLength(1)
  })

  it('returns empty on empty input', () => {
    expect(detectItalianCities('')).toEqual([])
  })

  it('list contains at least 100 cities (founder requirement: top 100-200)', () => {
    expect(__test__.ITALIAN_CITIES.length).toBeGreaterThanOrEqual(100)
  })
})

describe('mergeWhitelistWithNer', () => {
  const span = (start: number, end: number, label: string, text: string): NerDetection => ({
    start,
    end,
    text,
    label,
    score: 0.85,
  })

  it('adds whitelist hits when no NER overlap', () => {
    const ner: NerDetection[] = []
    const wl: NerDetection[] = [
      { start: 0, end: 7, text: 'Firenze', label: 'luogo', score: 1.0 },
    ]
    const merged = mergeWhitelistWithNer(ner, wl)
    expect(merged).toHaveLength(1)
    expect(merged[0]?.label).toBe('luogo')
  })

  it('drops whitelist hit that overlaps an existing NER span (NER classified surface differently)', () => {
    // NER thinks "Modena" is a persona (surname). Whitelist must not retag.
    const ner: NerDetection[] = [span(10, 16, 'persona', 'Modena')]
    const wl: NerDetection[] = [span(10, 16, 'luogo', 'Modena')]
    const merged = mergeWhitelistWithNer(ner, wl)
    expect(merged).toHaveLength(1)
    expect(merged[0]?.label).toBe('persona')
  })

  it('does not mutate the input NER array', () => {
    const ner: NerDetection[] = [span(0, 5, 'persona', 'Mario')]
    const wl: NerDetection[] = [
      { start: 10, end: 17, text: 'Firenze', label: 'luogo', score: 1.0 },
    ]
    const before = [...ner]
    mergeWhitelistWithNer(ner, wl)
    expect(ner).toEqual(before)
  })
})
