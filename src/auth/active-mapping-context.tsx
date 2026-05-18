/**
 * active-mapping-context.tsx — Recode IT active-mapping orchestrator (cross-doc
 * continuity, capabilities_index §6.2 + §7).
 *
 * The active-mapping is the cardinal UX gesture that turns Recode IT from a
 * single-doc tool into a multi-doc case workflow:
 *
 *   1. The user opens a saved mapping for "Causa Rossi vs Bianchi".
 *   2. The PseudonymMapper is re-seeded from the decrypted entries — every
 *      pseudonym↔original allocation from previous documents survives.
 *   3. When a new document is dropped (same case), the engine EXTENDS rather
 *      than RESETS: Mario Rossi → Tizio (seeded), Giulia Bianchi → Caio
 *      (already known), unknown new person → next free pseudonym from the
 *      pool starting at the post-seed index.
 *
 * False-positive entries carry an `isFalsePositive: true` flag and survive
 * across documents within the same active-mapping (DESIGN §8.7,
 * capabilities_index §5 D6): Emilia marked FP in Doc1 stays the literal
 * "Emilia" in Doc2. They are NOT carried across DIFFERENT mappings, since the
 * server-side FP table is only an aggregate model-improvement signal.
 *
 * The mapping is persisted server-side as an opaque AES-256-GCM blob; the
 * server-visible label / doc_type / size are metadata. The key never leaves
 * the browser. R-04 mitigations are enforced in `crypto.ts`.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import {
  ApiError,
  deleteMapping as apiDeleteMapping,
  getMapping,
  saveMapping,
} from '../api/client'
import {
  base64ToBytes,
  bytesToBase64,
  decryptMapping,
  encryptMapping,
} from '../api/crypto'
import { PseudonymMapper } from '../engine/pseudonym_mapper'
import type { MappingEntry } from '../types/engine'
import { useAuth } from './auth-context'

type ActiveMapping = {
  mappingId: string
  label: string
  /**
   * The persistent PseudonymMapper carrying allocations across documents of
   * the same case. Holds reference equality so the engine can detect "extend
   * mode" via `instanceof`.
   */
  mapper: PseudonymMapper
  /**
   * All entries ever associated with this mapping — across every document
   * processed in this active session. Includes `isFalsePositive` flagged
   * entries so the engine can apply them to subsequent documents.
   */
  entries: MappingEntry[]
  /**
   * Tracks whether the active mapping has unsaved changes (drop a new doc,
   * mark a new FP, etc.). Drives the beforeunload warning + the "save"
   * button state.
   */
  dirty: boolean
  /**
   * `true` while the mapping is freshly opened from server and has never
   * been mutated yet — used to differentiate "just opened" from "edited".
   */
  pristine: boolean
}

export type ActiveMappingContextValue = {
  active: ActiveMapping | null
  /**
   * Save the current in-memory mapping. If `active` already has a
   * mappingId, the same id is reused (overwrite-then-update via DELETE+POST
   * — the backend rejects duplicate POSTs with 409). Otherwise a fresh
   * client-side UUID is generated. Returns the saved mapping_id.
   */
  saveActive: (label: string, entries: MappingEntry[]) => Promise<string>
  /**
   * Open a saved mapping by id: fetch the blob, decrypt with the master
   * key, rebuild the PseudonymMapper. Replaces any currently active
   * mapping.
   */
  openMapping: (mappingId: string) => Promise<void>
  /** Close the active mapping (back to single-doc mode). */
  closeActive: () => void
  /**
   * Replace the entries (called after each pseudonymize/extend run by
   * ClipboardWidget). Marks the mapping dirty.
   */
  updateEntries: (entries: MappingEntry[]) => void
  /** Hard-delete the active mapping on the server + close locally. */
  deleteActive: () => Promise<void>
  /** Plain ad-hoc save with explicit id (used by Account dashboard rename UX). */
  renameActive: (newLabel: string) => void
}

const ActiveMappingContext = createContext<ActiveMappingContextValue | null>(null)

function genId(): string {
  // RFC 4122 v4-ish UUID; sufficient for client-side mapping ids (server
  // enforces uniqueness within user scope).
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID()
  }
  const bytes = new Uint8Array(16)
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Serialize the entry list as a Map<string, string> for the existing
 * crypto.ts encryptMapping API. We round-trip the metadata (category +
 * isFalsePositive) by JSON-encoding it into the value side.
 *
 * Backward-compatible: a legacy plain "pseudonym → realValue" Map without
 * embedded metadata still round-trips, the deserialize step recovers the
 * entries with category='' and isFalsePositive=false defaults.
 */
function entriesToBlobMap(entries: MappingEntry[]): Map<string, string> {
  const out = new Map<string, string>()
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!
    // Use index-prefixed keys to allow duplicate pseudonyms (e.g. both <DS>
    // and <DS> for different real values).
    const key = `${i.toString().padStart(6, '0')}::${e.pseudonym}`
    const value = JSON.stringify({
      pseudonym: e.pseudonym,
      realValue: e.realValue,
      category: e.category,
      isFalsePositive: e.isFalsePositive === true,
    })
    out.set(key, value)
  }
  return out
}

function blobMapToEntries(blob: Map<string, string>): MappingEntry[] {
  const entries: MappingEntry[] = []
  // Sort by key so we recover the original insertion order.
  const keys = Array.from(blob.keys()).sort()
  for (const k of keys) {
    const raw = blob.get(k)
    if (!raw) continue
    try {
      const parsed = JSON.parse(raw)
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof parsed.pseudonym === 'string' &&
        typeof parsed.realValue === 'string'
      ) {
        entries.push({
          pseudonym: parsed.pseudonym,
          realValue: parsed.realValue,
          category: typeof parsed.category === 'string' ? parsed.category : '',
          isFalsePositive: parsed.isFalsePositive === true,
        })
      }
    } catch {
      // Legacy entry (plain string value) — treat as pseudonym→realValue
      // with category unknown.
      const pseudo = k.split('::').slice(1).join('::') || k
      entries.push({
        pseudonym: pseudo,
        realValue: raw,
        category: '',
        isFalsePositive: false,
      })
    }
  }
  return entries
}

export function ActiveMappingProvider({
  children,
}: {
  children: React.ReactNode
}): JSX.Element {
  const { masterKey } = useAuth()
  const [active, setActive] = useState<ActiveMapping | null>(null)

  // Beforeunload warning when the active mapping has dirty unsaved changes —
  // see DESIGN.md §10 and OPEN_RISKS.md (session-loss UX). We do NOT warn on
  // pristine state (just opened, nothing modified yet) so a user who opens
  // for read-only inspection isn't nagged.
  useEffect(() => {
    if (!active || !active.dirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      // Most browsers ignore the custom message in 2026; setting returnValue
      // is what still triggers the dialog.
      e.returnValue = ''
      return ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [active])

  const saveActive = useCallback(
    async (label: string, entries: MappingEntry[]): Promise<string> => {
      if (!masterKey) {
        throw new Error(
          'Crittografia non disponibile: sblocca la sessione con la password prima di salvare.',
        )
      }
      const mappingId = active?.mappingId ?? genId()
      const blobMap = entriesToBlobMap(entries)
      const cipher = await encryptMapping(blobMap, masterKey)
      const blob64 = bytesToBase64(cipher)
      // Idempotent save: if the id already exists server-side, we drop the
      // old row first (the backend rejects POST on conflict). Cheaper than a
      // dedicated PUT route.
      if (active?.mappingId) {
        try {
          await apiDeleteMapping(active.mappingId)
        } catch (err) {
          // 404 is fine (first save / already gone); other errors propagate.
          if (!(err instanceof ApiError && err.status === 404)) throw err
        }
      }
      await saveMapping({
        mapping_id: mappingId,
        blob_base64: blob64,
        label,
        doc_type: 'txt',
      })
      // Rebuild the active state to reflect the post-save reality (clean,
      // entries === what we just persisted, mapper unchanged).
      const newMapper = active?.mapper ?? new PseudonymMapper()
      newMapper.seedFromEntries(entries)
      setActive({
        mappingId,
        label,
        mapper: newMapper,
        entries,
        dirty: false,
        pristine: false,
      })
      return mappingId
    },
    [active, masterKey],
  )

  const openMapping = useCallback(
    async (mappingId: string): Promise<void> => {
      if (!masterKey) {
        throw new Error(
          'Crittografia non disponibile: sblocca la sessione con la password prima di aprire un mapping.',
        )
      }
      const payload = await getMapping(mappingId)
      const cipher = base64ToBytes(payload.blob)
      const blobMap = await decryptMapping(cipher, masterKey)
      const entries = blobMapToEntries(blobMap)
      const mapper = new PseudonymMapper()
      mapper.seedFromEntries(entries)
      setActive({
        mappingId: payload.mapping_id,
        label: payload.label ?? '(senza etichetta)',
        mapper,
        entries,
        dirty: false,
        pristine: true,
      })
    },
    [masterKey],
  )

  const closeActive = useCallback(() => setActive(null), [])

  const updateEntries = useCallback((entries: MappingEntry[]) => {
    setActive((cur) => {
      if (!cur) return cur
      return { ...cur, entries, dirty: true, pristine: false }
    })
  }, [])

  const deleteActive = useCallback(async () => {
    if (!active) return
    await apiDeleteMapping(active.mappingId)
    setActive(null)
  }, [active])

  const renameActive = useCallback((newLabel: string) => {
    setActive((cur) => (cur ? { ...cur, label: newLabel, dirty: true } : cur))
  }, [])

  const value = useMemo<ActiveMappingContextValue>(
    () => ({
      active,
      saveActive,
      openMapping,
      closeActive,
      updateEntries,
      deleteActive,
      renameActive,
    }),
    [
      active,
      saveActive,
      openMapping,
      closeActive,
      updateEntries,
      deleteActive,
      renameActive,
    ],
  )

  return (
    <ActiveMappingContext.Provider value={value}>
      {children}
    </ActiveMappingContext.Provider>
  )
}

export function useActiveMapping(): ActiveMappingContextValue {
  const ctx = useContext(ActiveMappingContext)
  if (!ctx) {
    throw new Error('useActiveMapping must be used inside <ActiveMappingProvider>')
  }
  return ctx
}

// Test-only export: tests need to round-trip the blob layout without going
// through the full save/open cycle.
export const __TEST__ = { entriesToBlobMap, blobMapToEntries }
