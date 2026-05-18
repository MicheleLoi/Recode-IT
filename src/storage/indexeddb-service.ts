/**
 * indexeddb-service.ts — thin async wrapper around the browser-native
 * IndexedDB API, scoped to the Recode IT "zero-euro" tier
 * (capabilities_index §9.1).
 *
 * Schema (v1):
 *
 *   database  recode-it
 *   store     mappings           keyPath: 'id' (string UUID v4)
 *   index     by_updatedAt       on 'updatedAt' (ISO timestamp)
 *
 * Record shape (`MappingRecord`):
 *
 *   { id: string,           // UUID v4, client-generated
 *     userId: string,       // tag for the logged-in user (logical
 *                           // isolation: a same-device, multi-user browser
 *                           // share keeps each account's records separate)
 *     label: string,        // human-friendly name (e.g. "Causa Rossi vs Bianchi")
 *     entries: MappingEntry[],   // PLAINTEXT — see §9.1: theatrical
 *                                // encryption is rejected on this tier
 *     createdAt: string,    // ISO
 *     updatedAt: string }   // ISO (indexed for list sort)
 *
 * Decisione (plan §"Decisioni ratificate" #5): on QuotaExceededError we
 * surface a typed `QuotaExceededError` subclass so the UI can render the
 * upgrade-suggestion dialog. The store itself does NOT GC anything.
 *
 * Design note: the wrapper is intentionally NOT promisified via a 3rd-party
 * dependency (`idb` package). The plan calls for stdlib-native code; reusing
 * the existing zero-dep posture of the repo. ~80 lines of `request.onsuccess`
 * vs adding a transitive dep is the right Ockham trade-off.
 */

import type { MappingEntry } from '../types/engine'

export const DB_NAME = 'recode-it'
export const DB_VERSION = 1
export const STORE_MAPPINGS = 'mappings'
export const INDEX_UPDATED_AT = 'by_updatedAt'

export type MappingRecord = {
  id: string
  userId: string
  label: string
  entries: MappingEntry[]
  createdAt: string
  updatedAt: string
}

export type MappingRecordSummary = Omit<MappingRecord, 'entries'> & {
  entriesCount: number
}

/** Raised when the browser refuses a put() because the origin quota is full. */
export class IndexedDBQuotaError extends Error {
  constructor(message: string = 'Spazio del browser pieno.') {
    super(message)
    this.name = 'IndexedDBQuotaError'
  }
}

/**
 * Open / upgrade the database. Returns a Promise wrapper around the
 * `IDBOpenDBRequest`. The v1 upgrade path creates the `mappings` object
 * store + the `by_updatedAt` index. Future schema bumps add their migration
 * branch here.
 */
export function openDB(name: string = DB_NAME, version: number = DB_VERSION): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB non disponibile in questo ambiente.'))
      return
    }
    const request = indexedDB.open(name, version)
    request.onerror = () => reject(request.error ?? new Error('openDB failed'))
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = (event) => {
      const db = request.result
      // v1 creation path.
      if (!db.objectStoreNames.contains(STORE_MAPPINGS)) {
        const store = db.createObjectStore(STORE_MAPPINGS, { keyPath: 'id' })
        store.createIndex(INDEX_UPDATED_AT, 'updatedAt', { unique: false })
      }
      // Hook for future versions: inspect `event.oldVersion` here.
      void event
    }
  })
}

function withStore<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MAPPINGS, mode)
    const store = tx.objectStore(STORE_MAPPINGS)
    const out = fn(store)
    tx.onerror = () => {
      const err = tx.error
      // Quota-exceeded shows up as a DOMException with name === 'QuotaExceededError'.
      if (err && (err as DOMException).name === 'QuotaExceededError') {
        reject(new IndexedDBQuotaError(err.message))
      } else {
        reject(err ?? new Error('IndexedDB transaction failed'))
      }
    }
    if (out instanceof Promise) {
      out.then(resolve, reject)
    } else {
      out.onsuccess = () => resolve(out.result)
      out.onerror = () => reject(out.error ?? new Error('IndexedDB request failed'))
    }
  })
}

/** Insert or replace a mapping record. The store's keyPath is `id`. */
export async function putMapping(
  db: IDBDatabase,
  record: MappingRecord,
): Promise<void> {
  await withStore<IDBValidKey>(db, 'readwrite', (store) => store.put(record))
}

/** Read a single record by primary key. Returns `null` if absent. */
export async function getMappingRecord(
  db: IDBDatabase,
  id: string,
): Promise<MappingRecord | null> {
  const result = await withStore<MappingRecord | undefined>(
    db,
    'readonly',
    (store) => store.get(id),
  )
  return result ?? null
}

/**
 * Enumerate all records for a given userId, optionally newest-first via the
 * `by_updatedAt` index. Filtering happens client-side because the userId is
 * not part of the primary key — but the dataset is tiny (single-user same
 * device), so a full scan is cheap.
 */
export async function listMappingsForUser(
  db: IDBDatabase,
  userId: string,
): Promise<MappingRecord[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MAPPINGS, 'readonly')
    const store = tx.objectStore(STORE_MAPPINGS)
    const index = store.index(INDEX_UPDATED_AT)
    const out: MappingRecord[] = []
    const req = index.openCursor(null, 'prev') // most-recent first
    req.onsuccess = () => {
      const cursor = req.result
      if (!cursor) {
        resolve(out)
        return
      }
      const value = cursor.value as MappingRecord
      if (value.userId === userId) {
        out.push(value)
      }
      cursor.continue()
    }
    req.onerror = () => reject(req.error ?? new Error('listMappingsForUser failed'))
    tx.onerror = () => reject(tx.error ?? new Error('listMappingsForUser tx failed'))
  })
}

/** Delete a single record. Resolves whether or not the id existed. */
export async function deleteMapping(
  db: IDBDatabase,
  id: string,
): Promise<void> {
  await withStore<undefined>(db, 'readwrite', (store) => store.delete(id))
}

/** Close the database handle. Idempotent. */
export function closeDB(db: IDBDatabase): void {
  db.close()
}

/**
 * Convenience helper: open + run fn + close. Useful where the caller only
 * needs one operation and doesn't want to manage the handle lifetime.
 */
export async function withDB<T>(
  fn: (db: IDBDatabase) => Promise<T>,
  name: string = DB_NAME,
  version: number = DB_VERSION,
): Promise<T> {
  const db = await openDB(name, version)
  try {
    return await fn(db)
  } finally {
    closeDB(db)
  }
}

export const __TEST__ = { DB_NAME, STORE_MAPPINGS, INDEX_UPDATED_AT }
