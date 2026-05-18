/**
 * manual_annotation_engine.test.ts — Priority C, Step 2.
 *
 * Engine-level guarantees for the `manualAnnotate` helper used by the UI's
 * "Anonimizza la selezione" gesture. The UI test (manual_annotation.test.tsx)
 * covers the React wiring; this file pins the engine semantics.
 */

import { describe, it, expect } from 'vitest'
import { manualAnnotate, MANUAL_OTHER_MASK } from '../manual_annotate'
import { PseudonymMapper } from '../pseudonym_mapper'
import type { MappingEntry } from '../../types/engine'

describe('manualAnnotate — engine semantics', () => {
  it('tags a manually annotated person and rewrites the pseudonymized text', () => {
    const text = 'Mario Rossi va al Tribunale di Torino.'
    const mapper = new PseudonymMapper()
    const start = text.indexOf('Mario Rossi')
    const end = start + 'Mario Rossi'.length

    const result = manualAnnotate(text, start, end, 'persona', mapper, [])

    const manualEntry = result.entries.find(
      (e) => e.source === 'manual' && e.realValue === 'Mario Rossi',
    )
    expect(manualEntry).toBeDefined()
    expect(manualEntry?.category).toBe('persona')
    expect(manualEntry?.source).toBe('manual')
    expect(manualEntry?.isPreserved).toBe(false)
    // Pseudonym comes from the PERSON_POOL — first allocation, exact value
    // depends on the pool order which is part of the public contract; we
    // assert it's a non-empty string distinct from the realValue.
    expect(manualEntry?.pseudonym).toBeTruthy()
    expect(manualEntry?.pseudonym).not.toBe('Mario Rossi')

    // Rewritten text must replace "Mario Rossi" with the allocated pseudonym
    // and otherwise match the original.
    expect(result.pseudonymizedText).not.toContain('Mario Rossi')
    expect(result.pseudonymizedText).toContain(manualEntry!.pseudonym)
    expect(result.pseudonymizedText).toContain('Tribunale di Torino')
  })

  it('uses the <MANUALE> literal mask for the "altro" category', () => {
    const text = 'Mario Rossi va al Tribunale di Torino.'
    const mapper = new PseudonymMapper()
    const start = text.indexOf('Torino')
    const end = start + 'Torino'.length

    const result = manualAnnotate(text, start, end, 'altro', mapper, [])

    const manualEntry = result.entries.find(
      (e) => e.source === 'manual' && e.realValue === 'Torino',
    )
    expect(manualEntry).toBeDefined()
    expect(manualEntry?.category).toBe('altro')
    expect(manualEntry?.pseudonym).toBe(MANUAL_OTHER_MASK)

    // The rewritten text should have <MANUALE> in place of Torino.
    expect(result.pseudonymizedText).toContain(MANUAL_OTHER_MASK)
    expect(result.pseudonymizedText).not.toContain('Torino')
  })

  it('coexists with previously allocated entries without disturbing their order', () => {
    // Simulate the post-pipeline state: a regex entry for an email, a NER
    // entry for "Tizio" already swapped in for "Alessia Rinaldi", and the
    // user is now manually annotating "Mario Rossi" the NER missed.
    const text =
      'Alessia Rinaldi e Mario Rossi hanno scritto a contact@example.com.'
    const mapper = new PseudonymMapper()
    // Seed mapper as if NER had already done its work for Alessia Rinaldi.
    const alessiaPseudo = mapper.getPerson('Alessia Rinaldi')
    expect(alessiaPseudo).not.toBe('Alessia Rinaldi')

    const existing: MappingEntry[] = [
      {
        pseudonym: '<EMAIL>',
        realValue: 'contact@example.com',
        category: 'EMAIL',
        source: 'regex',
      },
      {
        pseudonym: alessiaPseudo,
        realValue: 'Alessia Rinaldi',
        category: 'persona',
        isPreserved: false,
        source: 'gliner',
      },
    ]

    const start = text.indexOf('Mario Rossi')
    const end = start + 'Mario Rossi'.length

    const result = manualAnnotate(text, start, end, 'persona', mapper, existing)

    // We expect three entries: the two pre-existing + the new manual one.
    expect(result.entries.length).toBe(3)

    const manualEntry = result.entries.find(
      (e) => e.source === 'manual' && e.realValue === 'Mario Rossi',
    )
    expect(manualEntry).toBeDefined()
    const rossiPseudo = manualEntry!.pseudonym
    expect(rossiPseudo).not.toBe('Mario Rossi')
    expect(rossiPseudo).not.toBe(alessiaPseudo)

    // All three substitutions must coexist in the rewritten text.
    expect(result.pseudonymizedText).not.toContain('Mario Rossi')
    expect(result.pseudonymizedText).not.toContain('Alessia Rinaldi')
    expect(result.pseudonymizedText).not.toContain('contact@example.com')
    expect(result.pseudonymizedText).toContain(rossiPseudo)
    expect(result.pseudonymizedText).toContain(alessiaPseudo)
    expect(result.pseudonymizedText).toContain('<EMAIL>')
  })

  it('classifies a street-like luogo as via and uses STREET_POOL', () => {
    const text = 'Risiede in Via Garibaldi 12.'
    const mapper = new PseudonymMapper()
    const start = text.indexOf('Via Garibaldi 12')
    const end = start + 'Via Garibaldi 12'.length

    const result = manualAnnotate(text, start, end, 'luogo', mapper, [])
    const entry = result.entries.find((e) => e.source === 'manual')
    expect(entry?.category).toBe('via')
    expect(entry?.pseudonym).toBeTruthy()
    expect(entry?.pseudonym).not.toBe('Via Garibaldi 12')
  })

  it('classifies a non-street luogo as citta and uses CITY_POOL', () => {
    const text = 'Vive a Bologna da anni.'
    const mapper = new PseudonymMapper()
    const start = text.indexOf('Bologna')
    const end = start + 'Bologna'.length

    const result = manualAnnotate(text, start, end, 'luogo', mapper, [])
    const entry = result.entries.find((e) => e.source === 'manual')
    expect(entry?.category).toBe('citta')
    expect(entry?.pseudonym).toBeTruthy()
    expect(entry?.pseudonym).not.toBe('Bologna')
  })

  it('rejects an empty selection', () => {
    const text = 'Hello world.'
    const mapper = new PseudonymMapper()
    expect(() => manualAnnotate(text, 3, 3, 'persona', mapper, [])).toThrow()
  })

  it('rejects an out-of-bounds selection', () => {
    const text = 'Hello world.'
    const mapper = new PseudonymMapper()
    expect(() => manualAnnotate(text, 0, 999, 'persona', mapper, [])).toThrow()
  })

  it('rejects a whitespace-only selection', () => {
    const text = 'a    b'
    const mapper = new PseudonymMapper()
    // Selecting "   " (whitespace only) trims to empty.
    expect(() => manualAnnotate(text, 1, 4, 'persona', mapper, [])).toThrow()
  })
})
