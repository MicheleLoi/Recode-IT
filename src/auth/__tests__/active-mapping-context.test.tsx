/**
 * active-mapping-context.test.tsx — exercise the blob round-trip layer used
 * by the save / open gestures.
 *
 * The full save/open cycle requires the network (POST /recode/mappings/ +
 * GET) which is out of scope for unit tests; the founder runs the manual
 * acceptance check at the end of the session. This file pins down the two
 * pure-function pieces that sit between the network and the engine:
 *
 *   1. entriesToBlobMap → blobMapToEntries is an exact-shape round-trip
 *      including the `isFalsePositive` flag.
 *   2. The deserialization tolerates legacy plain `Map<pseudonym, realValue>`
 *      blobs without a metadata payload (forward compatibility).
 */

import { describe, it, expect } from 'vitest'
import type { MappingEntry } from '../../types/engine'
import { __TEST__ } from '../active-mapping-context'

const { entriesToBlobMap, blobMapToEntries } = __TEST__

describe('Active-mapping blob serialization', () => {
  it('round-trips entries including isFalsePositive flag', () => {
    const entries: MappingEntry[] = [
      { pseudonym: 'Tizio', realValue: 'Mario Rossi', category: 'persona' },
      { pseudonym: 'Caio', realValue: 'Giulia Bianchi', category: 'persona' },
      {
        pseudonym: 'Emilia',
        realValue: 'Emilia',
        category: 'persona',
        isFalsePositive: true,
      },
      { pseudonym: '<DS>', realValue: 'RSSMRA80A01H501Z', category: 'CF' },
    ]
    const blob = entriesToBlobMap(entries)
    const round = blobMapToEntries(blob)
    expect(round.length).toBe(entries.length)
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]!
      const r = round[i]!
      expect(r.pseudonym).toBe(e.pseudonym)
      expect(r.realValue).toBe(e.realValue)
      expect(r.category).toBe(e.category)
      expect(r.isFalsePositive ?? false).toBe(e.isFalsePositive ?? false)
    }
  })

  it('preserves insertion order across the round-trip', () => {
    const entries: MappingEntry[] = []
    for (let i = 0; i < 50; i++) {
      entries.push({
        pseudonym: `P${i}`,
        realValue: `R${i}`,
        category: 'persona',
      })
    }
    const round = blobMapToEntries(entriesToBlobMap(entries))
    for (let i = 0; i < 50; i++) {
      expect(round[i]!.pseudonym).toBe(`P${i}`)
    }
  })

  it('falls back gracefully on legacy plain string values', () => {
    // Legacy blobs (pre-isFalsePositive) might have used a flat
    // pseudonym→realValue Map without JSON envelopes. Verify the
    // deserializer doesn't crash on them.
    const legacy = new Map<string, string>([
      ['000000::Tizio', 'Mario Rossi'],
      ['000001::Caio', 'Giulia Bianchi'],
    ])
    const round = blobMapToEntries(legacy)
    expect(round.length).toBe(2)
    expect(round[0]!.pseudonym).toBe('Tizio')
    expect(round[0]!.realValue).toBe('Mario Rossi')
    expect(round[0]!.isFalsePositive).toBe(false)
  })

  it('handles an empty entry list', () => {
    const round = blobMapToEntries(entriesToBlobMap([]))
    expect(round).toEqual([])
  })

  it('does not collide entries with duplicate pseudonyms (e.g. multiple <DS>)', () => {
    // Different CFs both map to '<DS>'; the round-trip must preserve both.
    const entries: MappingEntry[] = [
      { pseudonym: '<DS>', realValue: 'RSSMRA80A01H501Z', category: 'CF' },
      { pseudonym: '<DS>', realValue: 'BNCGLI90B02H501W', category: 'CF' },
    ]
    const round = blobMapToEntries(entriesToBlobMap(entries))
    expect(round.length).toBe(2)
    expect(round.map((e) => e.realValue).sort()).toEqual(
      ['BNCGLI90B02H501W', 'RSSMRA80A01H501Z'],
    )
  })
})
