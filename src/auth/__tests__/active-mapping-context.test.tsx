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
      { pseudonym: '<DS>', realValue: 'RSSMRA80A01H501U', category: 'CF' },
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
      { pseudonym: '<DS>', realValue: 'RSSMRA80A01H501U', category: 'CF' },
      { pseudonym: '<DS>', realValue: 'BNCGLI90B02H501E', category: 'CF' },
    ]
    const round = blobMapToEntries(entriesToBlobMap(entries))
    expect(round.length).toBe(2)
    expect(round.map((e) => e.realValue).sort()).toEqual(
      ['BNCGLI90B02H501E', 'RSSMRA80A01H501U'],
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

  it('tier=free saveActive persists the aggregate IDB record (singolo record per userId)', async () => {
    // Design 2026-05-19: tier=free non ha "lista multi-mapping con id". È un
    // singolo record aggregato per userId. saveActive ignora il label e
    // salva nel record sentinel `agg::<userId>`. L'etichetta tornata
    // dall'active state è la sentinel 'Mapping locale'.
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
    // L'id è deterministico: agg::<userId>.
    expect(savedId).toBe('agg::user-free-1')

    // Stato attivo ricostruito post-save: label sentinel, entries persistiti.
    expect(result.current.active.active).not.toBeNull()
    expect(result.current.active.active!.mappingId).toBe('agg::user-free-1')
    expect(result.current.active.active!.entries[0]!.pseudonym).toBe('Tizio')
    expect(result.current.active.active!.dirty).toBe(false)
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

/**
 * tier=free cross-doc continuity bootstrap (bug fix 2026-05-19).
 *
 * Quando il provider monta con user.tier='free', deve caricare il record
 * aggregato IDB e seedare automaticamente il PseudonymMapper engine. Senza
 * questo seed il primo documento caricato dopo il login allocava pseudonimi
 * da pool_index=0, rompendo la continuità (Mario Rossi → nuovo pseudonimo).
 */
describe('tier=free aggregate bootstrap (cross-doc continuity)', () => {
  beforeEach(async () => {
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('recode-it')
      req.onsuccess = () => resolve()
      req.onerror = () => resolve()
      req.onblocked = () => resolve()
    })
  })

  it('al mount con IDB pre-popolato seeda il mapper engine', async () => {
    // Pre-popola il record aggregato direttamente via mapping-store, prima
    // del mount del provider — simula "utente torna sul sito dopo aver già
    // pseudonimizzato un documento".
    const { saveAggregateMapping, loadAggregateMapping } = await import(
      '../../storage/mapping-store'
    )
    const prepopulated: MappingEntry[] = [
      { pseudonym: 'Tizio', realValue: 'Mario Rossi', category: 'persona' },
      { pseudonym: 'Caio', realValue: 'Giulia Bianchi', category: 'persona' },
    ]
    await saveAggregateMapping('user-free-1', prepopulated)
    // Sanity: il record esiste.
    const loaded = await loadAggregateMapping('user-free-1')
    expect(loaded.length).toBe(2)

    // Ora mount del provider.
    const { result } = renderHook(
      () => ({ auth: useAuth(), active: useActiveMapping() }),
      { wrapper: combinedWrapper },
    )
    await waitFor(() => {
      expect(result.current.auth.user).not.toBeNull()
    })
    // Aspetta che il useEffect di bootstrap completi.
    await waitFor(() => {
      expect(result.current.active.active).not.toBeNull()
    })
    expect(result.current.active.active!.mappingId).toBe('agg::user-free-1')
    expect(result.current.active.active!.entries.length).toBe(2)
    // Il mapper engine è stato seedato: una chiamata a getPerson su un nome
    // già noto deve restituire lo stesso pseudonimo (no re-allocation).
    const mapper = result.current.active.active!.mapper
    // getPerson dovrebbe restituire 'Tizio' per 'Mario Rossi' (seeded).
    expect(mapper.getPerson('Mario Rossi')).toBe('Tizio')
    expect(mapper.getPerson('Giulia Bianchi')).toBe('Caio')
  })

  it('al mount con IDB vuoto inizializza un mapper vuoto senza crash', async () => {
    const { result } = renderHook(
      () => ({ auth: useAuth(), active: useActiveMapping() }),
      { wrapper: combinedWrapper },
    )
    await waitFor(() => {
      expect(result.current.auth.user).not.toBeNull()
    })
    await waitFor(() => {
      expect(result.current.active.active).not.toBeNull()
    })
    expect(result.current.active.active!.entries.length).toBe(0)
    // Mapper fresco: la prima allocazione parte dal pool index 0.
    const mapper = result.current.active.active!.mapper
    const p = mapper.getPerson('Sconosciuto Tale')
    expect(p).toBeTruthy()
    expect(p).not.toBe('Sconosciuto Tale')
  })

  it('cross-doc continuity end-to-end: secondo save preserva pseudonimi del primo', async () => {
    const { result } = renderHook(
      () => ({ auth: useAuth(), active: useActiveMapping() }),
      { wrapper: combinedWrapper },
    )
    await waitFor(() => {
      expect(result.current.auth.user).not.toBeNull()
    })
    await waitFor(() => {
      expect(result.current.active.active).not.toBeNull()
    })
    // Doc1: l'utente pseudonimizza Mario Rossi → Tizio.
    const doc1Entries: MappingEntry[] = [
      { pseudonym: 'Tizio', realValue: 'Mario Rossi', category: 'persona' },
    ]
    await act(async () => {
      await result.current.active.saveActive('ignored', doc1Entries)
    })
    expect(result.current.active.active!.entries[0]!.pseudonym).toBe('Tizio')

    // Doc2: l'utente pseudonimizza un nuovo nome + ri-vede Mario Rossi.
    // Il mapper deve restituire 'Tizio' per Mario Rossi (cross-doc).
    const mapper = result.current.active.active!.mapper
    expect(mapper.getPerson('Mario Rossi')).toBe('Tizio')
    // Nuovo nome → nuovo pseudonimo dalla pool, NON ricicla 'Tizio'.
    const newPseudo = mapper.getPerson('Anna Verdi')
    expect(newPseudo).toBeTruthy()
    expect(newPseudo).not.toBe('Tizio')

    // Save Doc2 con il merge corretto: doc1 + doc2 entries.
    const doc2Entries: MappingEntry[] = [
      ...doc1Entries,
      { pseudonym: newPseudo, realValue: 'Anna Verdi', category: 'persona' },
    ]
    await act(async () => {
      await result.current.active.saveActive('ignored', doc2Entries)
    })
    // Verifica round-trip su IDB: il record aggregato contiene entrambi.
    const { loadAggregateMapping } = await import(
      '../../storage/mapping-store'
    )
    const persisted = await loadAggregateMapping('user-free-1')
    expect(persisted.length).toBe(2)
    const reals = persisted.map((e) => e.realValue).sort()
    expect(reals).toEqual(['Anna Verdi', 'Mario Rossi'])
  })

  it('save sovrascrive (no append duplicate) e preserva createdAt', async () => {
    const { saveAggregateMapping, loadAggregateMapping } = await import(
      '../../storage/mapping-store'
    )
    await saveAggregateMapping('user-free-1', [
      { pseudonym: 'Tizio', realValue: 'Mario Rossi', category: 'persona' },
    ])
    await saveAggregateMapping('user-free-1', [
      { pseudonym: 'Tizio', realValue: 'Mario Rossi', category: 'persona' },
      { pseudonym: 'Caio', realValue: 'Giulia Bianchi', category: 'persona' },
    ])
    const persisted = await loadAggregateMapping('user-free-1')
    // Singolo record sovrascritto, non append: due entries, non tre.
    expect(persisted.length).toBe(2)
  })
})
