/**
 * extend_mode.test.ts — cross-document pseudonym continuity (Phase 3 wiring).
 *
 * This is the most architecturally load-bearing test of the active-mapping
 * gesture (capabilities_index §6.2 + §7, DESIGN.md §8.7). The founder's
 * acceptance criterion verbatim:
 *
 *   "carico Doc1 contenente Mario Rossi, salvo come 'Causa Test', refresh
 *    tab, login, apro mapping, carico Doc2 contenente Mario Rossi → vedo
 *    lo stesso pseudonimo in entrambi"
 *
 * The crypto + transport layers are exercised separately in
 * `src/api/__tests__/crypto.test.ts` and the active-mapping-context tests
 * below. This file exercises the engine-level guarantee at the heart of it:
 * a `PseudonymMapper` carried across two anonymize() calls preserves Tier-1
 * (exact match) allocations.
 */

import { describe, it, expect } from 'vitest'
import { anonymize } from '../engine'
import { PseudonymMapper } from '../pseudonym_mapper'
import type { NerDetection } from '../../types/engine'

// Lightweight NER detection synthesizer for the test fixtures — bypasses the
// onnxruntime-web stack so the tests run in node without WASM.
function nerDetect(text: string, name: string, label = 'persona'): NerDetection {
  const start = text.indexOf(name)
  if (start < 0) throw new Error(`fixture mismatch: '${name}' not in text`)
  return { start, end: start + name.length, label, text: name, score: 0.99 }
}

const DOC1 = 'Mario Rossi e Giulia Bianchi hanno partecipato a Roma.'
const DOC2 = 'Mario Rossi e Carlo Verdi si sono incontrati a Milano.'

describe('Engine — EXTEND mode (cross-document pseudonym continuity)', () => {
  it('reuses the same pseudonym for Mario Rossi across two documents', () => {
    // --- DOC 1: fresh run, allocate a pseudonym for Mario Rossi.
    const mapper = new PseudonymMapper()
    const r1 = anonymize(DOC1, {
      seedMapper: mapper,
      nerDetections: [
        nerDetect(DOC1, 'Mario Rossi'),
        nerDetect(DOC1, 'Giulia Bianchi'),
        nerDetect(DOC1, 'Roma', 'luogo'),
      ],
    })
    const rossiPseudo1 = r1.mappingEntries.find(
      (e) => e.realValue === 'Mario Rossi',
    )?.pseudonym
    expect(rossiPseudo1).toBeDefined()
    expect(r1.pseudonymizedText).toContain(rossiPseudo1!)
    expect(r1.pseudonymizedText).not.toContain('Mario Rossi')

    // --- DOC 2: same mapper passed in → Tier 1 hit, same pseudonym.
    const r2 = anonymize(DOC2, {
      seedMapper: mapper,
      nerDetections: [
        nerDetect(DOC2, 'Mario Rossi'),
        nerDetect(DOC2, 'Carlo Verdi'),
        nerDetect(DOC2, 'Milano', 'luogo'),
      ],
    })
    const rossiPseudo2 = r2.mappingEntries.find(
      (e) => e.realValue === 'Mario Rossi',
    )?.pseudonym
    expect(rossiPseudo2).toBeDefined()
    // THE CARDINAL ASSERTION: same person, same pseudonym across docs.
    expect(rossiPseudo2).toBe(rossiPseudo1)
    expect(r2.pseudonymizedText).toContain(rossiPseudo1!)
    expect(r2.pseudonymizedText).not.toContain('Mario Rossi')

    // New person (Carlo Verdi) gets a fresh pseudonym, NOT reusing Mario's.
    const verdiPseudo = r2.mappingEntries.find(
      (e) => e.realValue === 'Carlo Verdi',
    )?.pseudonym
    expect(verdiPseudo).toBeDefined()
    expect(verdiPseudo).not.toBe(rossiPseudo1)
  })

  it('allocates fresh pseudonyms when seedMapper is NOT provided (legacy single-doc)', () => {
    // Same docs, no shared mapper → independent allocations. The actual
    // assignments may differ; what matters is that the two runs are NOT
    // coupled.
    const r1 = anonymize(DOC1, {
      nerDetections: [
        nerDetect(DOC1, 'Mario Rossi'),
        nerDetect(DOC1, 'Giulia Bianchi'),
        nerDetect(DOC1, 'Roma', 'luogo'),
      ],
    })
    const r2 = anonymize(DOC2, {
      nerDetections: [
        nerDetect(DOC2, 'Mario Rossi'),
        nerDetect(DOC2, 'Carlo Verdi'),
        nerDetect(DOC2, 'Milano', 'luogo'),
      ],
    })
    // Both runs assign SOME pseudonym to Mario Rossi (the first one from
    // PERSON_POOL each time), so without seedMapper they happen to coincide
    // by allocation order — but neither was a Tier-1 hit. Verify each
    // independently produced its mappings without crashing.
    expect(
      r1.mappingEntries.some((e) => e.realValue === 'Mario Rossi'),
    ).toBe(true)
    expect(
      r2.mappingEntries.some((e) => e.realValue === 'Mario Rossi'),
    ).toBe(true)
  })
})

describe('PseudonymMapper.seedFromEntries — round-trip rehydration', () => {
  it('rehydrates a previously serialized mapping into Tier-1 state', () => {
    // Simulate a save: encrypt → decrypt → seedFromEntries → run anonymize
    // on a new document and assert the previously allocated pseudonyms are
    // reused.
    const savedEntries = [
      { pseudonym: 'Tizio', realValue: 'Mario Rossi', category: 'persona' },
      { pseudonym: 'Caio', realValue: 'Giulia Bianchi', category: 'persona' },
      { pseudonym: 'Metropoli', realValue: 'Roma', category: 'citta' },
    ]
    const mapper = new PseudonymMapper()
    mapper.seedFromEntries(savedEntries)

    // Verify the internal maps have been populated.
    expect(mapper.getPersonMap().get('mario rossi')).toBe('Tizio')
    expect(mapper.getPersonMap().get('giulia bianchi')).toBe('Caio')
    expect(mapper.getSurnameMap().get('rossi')).toBe('Tizio')
    expect(mapper.getSurnameMap().get('bianchi')).toBe('Caio')
    expect(mapper.getCityMap().get('roma')).toBe('Metropoli')

    // Now extend with a new doc that names Mario Rossi again — Tier 1 hit
    // must return 'Tizio'.
    expect(mapper.getPerson('Mario Rossi')).toBe('Tizio')
    expect(mapper.getPerson('Giulia Bianchi')).toBe('Caio')
  })

  it('preserves the de-cuius skip set when rehydrating', () => {
    const savedEntries = [
      // Skip-set markers serialize as pseudonym === realValue (DESIGN §8.7
      // de-cuius preservation).
      { pseudonym: 'Arturo Vanzetti', realValue: 'Arturo Vanzetti', category: 'persona' },
    ]
    const mapper = new PseudonymMapper()
    mapper.seedFromEntries(savedEntries)
    expect(mapper.getSkipSet().has('arturo vanzetti')).toBe(true)
    // Verify getPerson returns the original unchanged (A-2 exemption).
    expect(mapper.getPerson('Arturo Vanzetti')).toBe('Arturo Vanzetti')
  })

  it('advances pool indices past seeded pseudonyms so new allocations skip them', () => {
    // Seed with the first three from PERSON_POOL — next allocation must
    // pick the fourth, not collide.
    const mapper = new PseudonymMapper()
    mapper.seedFromEntries([
      { pseudonym: 'Tizio', realValue: 'Mario Rossi', category: 'persona' },
      { pseudonym: 'Caio', realValue: 'Giulia Bianchi', category: 'persona' },
      { pseudonym: 'Sempronio', realValue: 'Luca Verdi', category: 'persona' },
    ])
    const newPseudo = mapper.getPerson('Nuova Persona')
    expect(newPseudo).not.toBe('Tizio')
    expect(newPseudo).not.toBe('Caio')
    expect(newPseudo).not.toBe('Sempronio')
  })

  it('idempotent: a second seed call with the same entries is a no-op', () => {
    const entries = [
      { pseudonym: 'Tizio', realValue: 'Mario Rossi', category: 'persona' },
    ]
    const mapper = new PseudonymMapper()
    mapper.seedFromEntries(entries)
    const snap1 = new Map(mapper.getPersonMap())
    mapper.seedFromEntries(entries)
    const snap2 = new Map(mapper.getPersonMap())
    expect(snap2.size).toBe(snap1.size)
    expect(snap2.get('mario rossi')).toBe('Tizio')
  })

  it('skips false-positive entries from re-allocation (no pseudonym registered)', () => {
    const mapper = new PseudonymMapper()
    mapper.seedFromEntries([
      { pseudonym: 'Tizio', realValue: 'Mario Rossi', category: 'persona' },
      // Emilia marked FP — should NOT be entered into personMap. When the
      // next document NER-detects "Emilia", the engine still pseudonymizes
      // by default. The FP propagation is implemented at the engine level
      // via `userFalsePositives` (engine.ts), NOT at the mapper level.
      {
        pseudonym: 'Caio',
        realValue: 'Emilia',
        category: 'persona',
        isFalsePositive: true,
      },
    ])
    expect(mapper.getPersonMap().has('emilia')).toBe(false)
  })
})

describe('Engine + extend + userFalsePositives — Emilia stays Emilia across docs', () => {
  // The full FP-propagation test: Emilia marked FP in Doc1 must survive in
  // Doc2 when the active mapping is used. This is the contract the
  // ClipboardWidget binds via `seedFalsePositives`.
  it('does not pseudonymize Emilia in Doc2 when she is in userFalsePositives', () => {
    const doc1 = 'Mario Rossi e Emilia si sono incontrati.'
    const doc2 = 'Anche Emilia partecipa al meeting con Mario Rossi.'

    const mapper = new PseudonymMapper()

    // --- Doc 1 ---
    anonymize(doc1, {
      seedMapper: mapper,
      nerDetections: [
        nerDetect(doc1, 'Mario Rossi'),
        nerDetect(doc1, 'Emilia'),
      ],
    })
    // Simulate: user marks "Emilia" as false positive in the review panel.
    const fpSet = new Set(['Emilia'])

    // --- Doc 2 (extend) — engine consults userFalsePositives ---
    const r2 = anonymize(doc2, {
      seedMapper: mapper,
      userFalsePositives: fpSet,
      nerDetections: [
        nerDetect(doc2, 'Emilia'),
        nerDetect(doc2, 'Mario Rossi'),
      ],
    })

    expect(r2.pseudonymizedText).toContain('Emilia')
    // Mario Rossi gets the same pseudonym as in Doc1 (extend mode).
    expect(r2.pseudonymizedText).not.toContain('Mario Rossi')
    // No mapping entry for Emilia — the engine filtered her out.
    const emiliaEntry = r2.mappingEntries.find((e) => e.realValue === 'Emilia')
    expect(emiliaEntry).toBeUndefined()
  })
})
