/**
 * indexeddb-service.test.ts — unit tests on the IDB wrapper using
 * `fake-indexeddb` to provide a Node-side IDB implementation.
 *
 * Covers (plan §"Test frontend" requirement: 6 test):
 *   1. openDB creates store + index on v1
 *   2. putMapping inserts a record retrievable by id
 *   3. listMappingsForUser scopes results to the supplied userId
 *   4. listMappingsForUser orders newest-first by updatedAt
 *   5. deleteMapping removes a record
 *   6. closeDB + reopen returns the same data (durability)
 */

import { beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import {
  DB_NAME,
  INDEX_UPDATED_AT,
  STORE_MAPPINGS,
  closeDB,
  deleteMapping,
  getMappingRecord,
  listMappingsForUser,
  openDB,
  putMapping,
  type MappingRecord,
} from '../indexeddb-service'

function makeRecord(over: Partial<MappingRecord> = {}): MappingRecord {
  return {
    id: over.id ?? crypto.randomUUID(),
    userId: over.userId ?? 'user-a',
    label: over.label ?? 'Causa X',
    entries: over.entries ?? [
      { pseudonym: 'Tizio', realValue: 'Mario Rossi', category: 'persona' },
    ],
    createdAt: over.createdAt ?? '2026-05-18T00:00:00Z',
    updatedAt: over.updatedAt ?? '2026-05-18T00:00:00Z',
  }
}

async function resetDB(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => resolve()
  })
}

describe('indexeddb-service', () => {
  beforeEach(async () => {
    await resetDB()
  })

  it('openDB creates the mappings store + the by_updatedAt index on v1', async () => {
    const db = await openDB()
    try {
      expect(Array.from(db.objectStoreNames)).toContain(STORE_MAPPINGS)
      const tx = db.transaction(STORE_MAPPINGS, 'readonly')
      const store = tx.objectStore(STORE_MAPPINGS)
      expect(Array.from(store.indexNames)).toContain(INDEX_UPDATED_AT)
    } finally {
      closeDB(db)
    }
  })

  it('putMapping stores a record retrievable by id', async () => {
    const db = await openDB()
    try {
      const rec = makeRecord()
      await putMapping(db, rec)
      const got = await getMappingRecord(db, rec.id)
      expect(got).not.toBeNull()
      expect(got!.label).toBe(rec.label)
      expect(got!.entries[0]!.pseudonym).toBe('Tizio')
    } finally {
      closeDB(db)
    }
  })

  it('listMappingsForUser scopes to the supplied userId', async () => {
    const db = await openDB()
    try {
      await putMapping(db, makeRecord({ userId: 'user-a', label: 'A1' }))
      await putMapping(db, makeRecord({ userId: 'user-b', label: 'B1' }))
      await putMapping(db, makeRecord({ userId: 'user-a', label: 'A2' }))
      const a = await listMappingsForUser(db, 'user-a')
      const b = await listMappingsForUser(db, 'user-b')
      expect(a.length).toBe(2)
      expect(b.length).toBe(1)
      expect(a.map((r) => r.label).sort()).toEqual(['A1', 'A2'])
      expect(b[0]!.label).toBe('B1')
    } finally {
      closeDB(db)
    }
  })

  it('listMappingsForUser returns most-recent-first via the index', async () => {
    const db = await openDB()
    try {
      await putMapping(
        db,
        makeRecord({ label: 'oldest', updatedAt: '2026-01-01T00:00:00Z' }),
      )
      await putMapping(
        db,
        makeRecord({ label: 'newest', updatedAt: '2026-05-18T12:00:00Z' }),
      )
      await putMapping(
        db,
        makeRecord({ label: 'middle', updatedAt: '2026-03-15T00:00:00Z' }),
      )
      const list = await listMappingsForUser(db, 'user-a')
      expect(list.map((r) => r.label)).toEqual(['newest', 'middle', 'oldest'])
    } finally {
      closeDB(db)
    }
  })

  it('deleteMapping removes a record', async () => {
    const db = await openDB()
    try {
      const rec = makeRecord()
      await putMapping(db, rec)
      await deleteMapping(db, rec.id)
      const got = await getMappingRecord(db, rec.id)
      expect(got).toBeNull()
    } finally {
      closeDB(db)
    }
  })

  it('records survive close + reopen (durability)', async () => {
    const id = crypto.randomUUID()
    let db = await openDB()
    try {
      await putMapping(db, makeRecord({ id, label: 'survives' }))
    } finally {
      closeDB(db)
    }
    db = await openDB()
    try {
      const got = await getMappingRecord(db, id)
      expect(got).not.toBeNull()
      expect(got!.label).toBe('survives')
    } finally {
      closeDB(db)
    }
  })
})
