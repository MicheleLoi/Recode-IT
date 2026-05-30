/**
 * Tests for `mergeEntries` (WireframeWorkArea).
 *
 * Founder criterio canonico 2026-05-30 SID-20260530-095254 — bug "Firenze →
 * Firenze identity dopo run 2": il merge precedente conservava SEMPRE la prev
 * entry quando una key collideva. Risultato: dopo un run 1 col toggle "Luoghi"
 * SPENTO (Firenze preservato isPreserved:true) e un run 2 col toggle ACCESO
 * (Firenze sostituito con pseudonimo), la mappa UI continuava a mostrare
 * Firenze → Firenze identity mentre il `pseudonymizedText` mostrava lo
 * pseudonimo. Disaster per la demo founder LinkedIn.
 *
 * Fix: substitution-wins-over-preservation — quando `prev.isPreserved===true`
 * e `fresh.isPreserved===false`, la fresh vince. Edge case: ENTRAMBE preserved
 * → prev vince (potrebbe essere una decisione utente esplicita "Falso
 * positivo").
 */

import { describe, expect, it } from 'vitest'
import { mergeEntries } from '../WireframeWorkArea'
import type { MappingEntry } from '../../types/engine'

const e = (
  realValue: string,
  pseudonym: string,
  category: string,
  flags: Partial<Pick<MappingEntry, 'isPreserved' | 'isFalsePositive' | 'pass'>> = {},
): MappingEntry => ({
  realValue,
  pseudonym,
  category,
  source: 'gliner',
  ...flags,
})

describe('mergeEntries — substitution wins over preservation (run 2 toggle flip)', () => {
  it('fresh substitution OVERWRITES prev preserved (the original bug)', () => {
    const prev: MappingEntry[] = [
      e('Firenze', 'Firenze', 'citta', { isPreserved: true, pass: 2 }),
    ]
    const fresh: MappingEntry[] = [
      e('Firenze', 'Pisa', 'citta', { isPreserved: false, pass: 2 }),
    ]
    const merged = mergeEntries(prev, fresh)
    expect(merged).toHaveLength(1)
    expect(merged[0]?.pseudonym).toBe('Pisa')
    expect(merged[0]?.isPreserved).toBe(false)
  })

  it('preserves prev when fresh ALSO marks the entry as preserved (e.g. toggle still off, idempotent re-run)', () => {
    const prev: MappingEntry[] = [
      e('Firenze', 'Firenze', 'citta', { isPreserved: true, pass: 2 }),
    ]
    const fresh: MappingEntry[] = [
      e('Firenze', 'Firenze', 'citta', { isPreserved: true, pass: 2 }),
    ]
    const merged = mergeEntries(prev, fresh)
    expect(merged).toHaveLength(1)
    expect(merged[0]?.isPreserved).toBe(true)
    expect(merged[0]?.pseudonym).toBe('Firenze')
  })

  it("preserves prev when prev is a substitution and fresh is preserved (toggle turned OFF on run 2) — don't lose pseudonym choice silently", () => {
    // Symmetric edge: prev was substituted (Firenze→Pisa, isPreserved:false),
    // fresh is preserved (toggle off). Current logic keeps prev — we do NOT
    // downgrade a substitution back to identity just because the toggle was
    // flipped off. Trade-off: aligns with "user already accepted the
    // substitution; flipping the toggle off doesn't retroactively cancel
    // already-committed mapping entries". If founder later wants symmetric
    // behaviour, this test marks the intentional choice.
    const prev: MappingEntry[] = [
      e('Firenze', 'Pisa', 'citta', { isPreserved: false, pass: 2 }),
    ]
    const fresh: MappingEntry[] = [
      e('Firenze', 'Firenze', 'citta', { isPreserved: true, pass: 2 }),
    ]
    const merged = mergeEntries(prev, fresh)
    expect(merged).toHaveLength(1)
    expect(merged[0]?.pseudonym).toBe('Pisa')
    expect(merged[0]?.isPreserved).toBe(false)
  })

  it('adds fresh entries that have no key collision with prev', () => {
    const prev: MappingEntry[] = [
      e('Mario Rossi', 'Tizio', 'persona', { pass: 1 }),
    ]
    const fresh: MappingEntry[] = [
      e('Mario Rossi', 'Tizio', 'persona', { pass: 1 }),
      e('Firenze', 'Pisa', 'citta', { isPreserved: false, pass: 2 }),
    ]
    const merged = mergeEntries(prev, fresh)
    expect(merged).toHaveLength(2)
    const firenze = merged.find((m) => m.realValue === 'Firenze')
    expect(firenze?.pseudonym).toBe('Pisa')
  })

  it('keys are case-insensitive on realValue (FIRENZE and Firenze collide)', () => {
    const prev: MappingEntry[] = [
      e('Firenze', 'Firenze', 'citta', { isPreserved: true, pass: 2 }),
    ]
    const fresh: MappingEntry[] = [
      e('FIRENZE', 'Pisa', 'citta', { isPreserved: false, pass: 2 }),
    ]
    const merged = mergeEntries(prev, fresh)
    expect(merged).toHaveLength(1)
    expect(merged[0]?.pseudonym).toBe('Pisa')
  })

  it('different categories with same realValue do NOT collide', () => {
    const prev: MappingEntry[] = [
      e('Roma', 'Roma', 'persona', { isPreserved: true, pass: 2 }),
    ]
    const fresh: MappingEntry[] = [
      e('Roma', 'Pisa', 'citta', { isPreserved: false, pass: 2 }),
    ]
    const merged = mergeEntries(prev, fresh)
    expect(merged).toHaveLength(2)
  })
})
