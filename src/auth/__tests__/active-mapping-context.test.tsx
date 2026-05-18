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

/**
 * Tier dispatch tests — exercise the active-mapping-context's interaction
 * with the mapping-store dispatcher from end to end (round-trip through IDB
 * for tier='free', mocked api for tier='pro').
 */

import 'fake-indexeddb/auto'
import { act, renderHook, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import { AuthProvider, useAuth } from '../auth-context'
import { ActiveMappingProvider, useActiveMapping } from '../active-mapping-context'

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>(
    '../../api/client',
  )
  return {
    ...actual,
    me: vi.fn(async () => ({
      user_id: 'user-free-1',
      email: 'free@example.it',
      kdf_salt: '00112233445566778899aabbccddeeff',
      email_verified: true,
      created_at: '2026-05-18T00:00:00Z',
      tier: 'free' as const,
      name: 'Test Avvocato',
      marketing_consent: false,
    })),
  }
})

function combinedWrapper({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <ActiveMappingProvider>{children}</ActiveMappingProvider>
    </AuthProvider>
  )
}

describe('Active-mapping tier dispatch (zero-euro)', () => {
  beforeEach(async () => {
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('recode-it')
      req.onsuccess = () => resolve()
      req.onerror = () => resolve()
      req.onblocked = () => resolve()
    })
  })

  it('tier=free saveActive persists to IndexedDB and round-trips via openMapping', async () => {
    const { result } = renderHook(
      () => ({ auth: useAuth(), active: useActiveMapping() }),
      { wrapper: combinedWrapper },
    )
    await waitFor(() => {
      expect(result.current.auth.user).not.toBeNull()
    })
    expect(result.current.auth.user!.tier).toBe('free')

    const entries: MappingEntry[] = [
      { pseudonym: 'Tizio', realValue: 'Mario Rossi', category: 'persona' },
    ]
    let savedId: string = ''
    await act(async () => {
      savedId = await result.current.active.saveActive('Causa IDB Test', entries)
    })
    expect(savedId).toBeTruthy()

    // Close + reopen by id.
    act(() => {
      result.current.active.closeActive()
    })
    expect(result.current.active.active).toBeNull()

    await act(async () => {
      await result.current.active.openMapping(savedId)
    })
    expect(result.current.active.active).not.toBeNull()
    expect(result.current.active.active!.label).toBe('Causa IDB Test')
    expect(result.current.active.active!.entries[0]!.pseudonym).toBe('Tizio')
  })

  it('tier=free saveActive does NOT require a masterKey', async () => {
    const { result } = renderHook(
      () => ({ auth: useAuth(), active: useActiveMapping() }),
      { wrapper: combinedWrapper },
    )
    await waitFor(() => {
      expect(result.current.auth.user).not.toBeNull()
    })
    // Confirm no master key (we never called login here — refresh hydrates
    // user from /recode/me but the key is derived only at login).
    expect(result.current.auth.masterKey).toBeNull()
    const entries: MappingEntry[] = [
      { pseudonym: 'Caio', realValue: 'Giulia Bianchi', category: 'persona' },
    ]
    await act(async () => {
      const id = await result.current.active.saveActive('Senza chiave', entries)
      expect(id).toBeTruthy()
    })
  })
})
