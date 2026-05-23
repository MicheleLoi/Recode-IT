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
import { PseudonymMapper } from '../engine/pseudonym_mapper'
import {
  aggregateRecordId,
  deleteMappingById,
  loadAggregateMapping,
  loadMapping,
  saveAggregateMapping,
  saveMapping,
} from '../storage/mapping-store'
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
  const { user, masterKey } = useAuth()
  const [active, setActive] = useState<ActiveMapping | null>(null)

  // tier=free cross-doc continuity bootstrap (bug fix 2026-05-19):
  //
  // Design ratificato: tier=free ha UN SOLO mapping aggregato per browser,
  // chiavato per userId, sempre attivo. All'inizializzazione del provider —
  // appena `user` è disponibile e tier === 'free' — carichiamo il record
  // IDB aggregato e seedaiamo il PseudonymMapper engine. In questo modo il
  // primo documento caricato dopo il login riconosce già "Mario Rossi" →
  // "Tizio" allocato in una sessione precedente, senza UI di "open mapping".
  //
  // Idempotente: se non esiste record IDB, `entries` è [] e il mapper resta
  // vuoto (no crash). Re-trigger solo quando cambia user.user_id.
  const userId = user?.user_id ?? null
  const userTier = user?.tier ?? null
  useEffect(() => {
    if (userId === null || userTier !== 'free') return
    // Non sovrascrivere uno stato già attivo (es. apertura esplicita di un
    // mapping in tier=pro futuro). Se l'utente è davvero free, semanticamente
    // l'unico active possibile è già l'aggregato — ma siamo difensivi.
    if (active && active.mappingId === aggregateRecordId(userId)) return
    let cancelled = false
    void (async () => {
      try {
        const entries = await loadAggregateMapping(userId)
        if (cancelled) return
        const mapper = new PseudonymMapper()
        if (entries.length > 0) mapper.seedFromEntries(entries)
        setActive({
          mappingId: aggregateRecordId(userId),
          label: 'Mapping locale',
          mapper,
          entries,
          dirty: false,
          pristine: true,
        })
      } catch {
        // IDB non disponibile (incognito strict, browser legacy): non blocchiamo
        // l'app, il pseudonimizzatore funziona comunque sul singolo documento.
        if (cancelled) return
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, userTier])

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
      if (!user) {
        throw new Error(
          'Devi accedere o creare un account per salvare i mapping (tier anonymous: in RAM solo).',
        )
      }
      // tier='pro' needs masterKey for AES-GCM; tier='free' does not (IDB
      // plaintext per capabilities_index §9.1).
      if (user.tier === 'pro' && !masterKey) {
        throw new Error(
          'Crittografia non disponibile: sblocca la sessione con la password prima di salvare.',
        )
      }
      // tier=free → singolo record aggregato per userId (design 2026-05-19).
      // L'argomento `label` viene ignorato per tier=free (non c'è UI lista
      // mapping in cui esporre l'etichetta) ma manteniamo la stessa firma per
      // compatibilità con il chiamante (ClipboardWidget).
      if (user.tier === 'free') {
        await saveAggregateMapping(user.user_id, entries)
        const mappingId = aggregateRecordId(user.user_id)
        const newMapper = active?.mapper ?? new PseudonymMapper()
        newMapper.seedFromEntries(entries)
        setActive({
          mappingId,
          label: active?.label ?? 'Mapping locale',
          mapper: newMapper,
          entries,
          dirty: false,
          pristine: false,
        })
        return mappingId
      }
      // tier=pro — path storico invariato.
      const mappingId = active?.mappingId ?? genId()
      await saveMapping({
        id: mappingId,
        userId: user.user_id,
        tier: user.tier,
        label,
        entries,
        masterKey,
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
    [active, masterKey, user],
  )

  const openMapping = useCallback(
    async (mappingId: string): Promise<void> => {
      if (!user) {
        throw new Error(
          'Devi accedere per aprire un mapping salvato.',
        )
      }
      if (user.tier === 'pro' && !masterKey) {
        throw new Error(
          'Crittografia non disponibile: sblocca la sessione con la password prima di aprire un mapping.',
        )
      }
      const payload = await loadMapping({
        id: mappingId,
        tier: user.tier,
        masterKey,
      })
      if (!payload) {
        throw new Error('Mapping non trovato.')
      }
      const mapper = new PseudonymMapper()
      mapper.seedFromEntries(payload.entries)
      setActive({
        mappingId: payload.id,
        label: payload.label,
        mapper,
        entries: payload.entries,
        dirty: false,
        pristine: true,
      })
    },
    [masterKey, user],
  )

  const closeActive = useCallback(() => setActive(null), [])

  const updateEntries = useCallback((entries: MappingEntry[]) => {
    setActive((cur) => {
      if (!cur) return cur
      return { ...cur, entries, dirty: true, pristine: false }
    })
  }, [])

  const deleteActive = useCallback(async () => {
    if (!active || !user) return
    await deleteMappingById({ id: active.mappingId, tier: user.tier })
    setActive(null)
  }, [active, user])

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

/**
 * Tolerant variant of `useActiveMapping()` — returns `null` when no provider
 * is mounted instead of throwing. Used by ancillary CTAs (ViewKeyButton /
 * ViewKeyModal) that can be rendered in test surfaces or future contexts
 * without the full provider stack. The strict `useActiveMapping()` remains
 * the recommended hook for the main app paths where the provider is always
 * present.
 */
export function useActiveMappingOptional(): ActiveMappingContextValue | null {
  return useContext(ActiveMappingContext)
}

// Test-only export: tests need to round-trip the blob layout without going
// through the full save/open cycle.
export const __TEST__ = { entriesToBlobMap, blobMapToEntries }
