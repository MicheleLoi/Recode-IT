/**
 * mapping-store.test.ts — verify the tier dispatcher routes correctly.
 *
 * tier='free' → IndexedDB only (no network call)
 * tier='pro'  → server API only (no IDB record)
 *
 * For tier='pro' we mock `api/client` so the test stays hermetic, and we
 * provide a fake CryptoKey via WebCrypto (jsdom does not natively support
 * `crypto.subtle.importKey`; we mock at the api boundary instead).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import type { MappingEntry } from '../../types/engine'
import {
  DB_NAME,
} from '../indexeddb-service'

// Mock the api/client module BEFORE importing mapping-store so the dispatcher
// picks up the spies. Vitest hoists vi.mock to the top of the file.
vi.mock('../../api/client', () => ({
  ApiError: class ApiError extends Error {
    status: number
    constructor(status: number, msg: string) {
      super(msg)
      this.status = status
    }
  },
  saveMapping: vi.fn(async () => ({
    mapping_id: 'srv-id',
    created_at: '2026-05-18T00:00:00Z',
    size_bytes: 64,
  })),
  getMapping: vi.fn(),
  listMappings: vi.fn(async () => ({ mappings: [] })),
  deleteMapping: vi.fn(async () => ({ ok: true })),
}))

// Mock crypto helpers so we don't need a real CryptoKey instance.
vi.mock('../../api/crypto', () => ({
  encryptMapping: vi.fn(async () => new Uint8Array([1, 2, 3, 4, 5])),
  decryptMapping: vi.fn(async () =>
    new Map([
      ['000000::Tizio', JSON.stringify({
        pseudonym: 'Tizio', realValue: 'Mario Rossi', category: 'persona',
        isFalsePositive: false,
      })],
    ]),
  ),
  bytesToBase64: (b: Uint8Array) => Buffer.from(b).toString('base64'),
  base64ToBytes: (s: string) => new Uint8Array(Buffer.from(s, 'base64')),
}))

import * as apiClient from '../../api/client'
import {
  deleteMappingById,
  listMappings,
  loadMapping,
  saveMapping,
} from '../mapping-store'

async function resetDB(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => resolve()
  })
}

const sampleEntries: MappingEntry[] = [
  { pseudonym: 'Tizio', realValue: 'Mario Rossi', category: 'persona' },
  { pseudonym: 'Caio', realValue: 'Giulia Bianchi', category: 'persona' },
]

describe('mapping-store dispatcher', () => {
  beforeEach(async () => {
    await resetDB()
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('tier=free saves to IndexedDB and bypasses the network', async () => {
    const id = crypto.randomUUID()
    await saveMapping({
      id,
      userId: 'user-1',
      tier: 'free',
      label: 'Causa Rossi',
      entries: sampleEntries,
    })
    // No network call at all.
    expect((apiClient.saveMapping as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(0)
    // Round-trip via load.
    const loaded = await loadMapping({ id, tier: 'free' })
    expect(loaded).not.toBeNull()
    expect(loaded!.label).toBe('Causa Rossi')
    expect(loaded!.entries.length).toBe(2)
    expect(loaded!.entries[0]!.pseudonym).toBe('Tizio')
  })

  it('tier=free listMappings filters by userId (logical isolation)', async () => {
    await saveMapping({
      id: crypto.randomUUID(),
      userId: 'user-a',
      tier: 'free',
      label: 'A-1',
      entries: sampleEntries,
    })
    await saveMapping({
      id: crypto.randomUUID(),
      userId: 'user-b',
      tier: 'free',
      label: 'B-1',
      entries: sampleEntries,
    })
    const aList = await listMappings({ userId: 'user-a', tier: 'free' })
    const bList = await listMappings({ userId: 'user-b', tier: 'free' })
    expect(aList.map((r) => r.label)).toEqual(['A-1'])
    expect(bList.map((r) => r.label)).toEqual(['B-1'])
  })

  it('tier=pro encrypts + POSTs and skips IndexedDB', async () => {
    const fakeKey = {} as CryptoKey
    const id = crypto.randomUUID()
    await saveMapping({
      id,
      userId: 'user-1',
      tier: 'pro',
      label: 'Causa Premium',
      entries: sampleEntries,
      masterKey: fakeKey,
    })
    expect((apiClient.saveMapping as unknown as { mock: { calls: unknown[][] } }).mock.calls.length).toBe(1)
    const callArg = (apiClient.saveMapping as unknown as {
      mock: { calls: Array<[{ mapping_id: string; blob_base64: string; label: string }]> }
    }).mock.calls[0]![0]
    expect(callArg.mapping_id).toBe(id)
    expect(callArg.label).toBe('Causa Premium')
    expect(callArg.blob_base64).toBeTruthy()
  })

  it('tier=pro throws if masterKey is missing (loud failure)', async () => {
    await expect(
      saveMapping({
        id: crypto.randomUUID(),
        userId: 'user-1',
        tier: 'pro',
        label: 'No Key',
        entries: sampleEntries,
      }),
    ).rejects.toThrow(/masterKey/)
  })

  it('tier=free deleteMappingById removes the record from IDB', async () => {
    const id = crypto.randomUUID()
    await saveMapping({
      id,
      userId: 'user-1',
      tier: 'free',
      label: 'To delete',
      entries: sampleEntries,
    })
    let loaded = await loadMapping({ id, tier: 'free' })
    expect(loaded).not.toBeNull()
    await deleteMappingById({ id, tier: 'free' })
    loaded = await loadMapping({ id, tier: 'free' })
    expect(loaded).toBeNull()
  })
})
