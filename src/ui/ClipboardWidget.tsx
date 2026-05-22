/**
 * ClipboardWidget — the two-panel single-page UI.
 *
 * Owns the cross-panel state: original text, pseudonymized output, the
 * mapping table, and the review-state augmentation that drives
 * `EntityReviewList`. Phase 3 wiring threads an optional ActiveMapping
 * through the pipeline so cross-document continuity works (capabilities_index
 * §6.2 + §7): when a mapping is open, dropping a new document EXTENDS the
 * existing pseudonym↔original allocations instead of resetting.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MappingEntry } from '../types/engine'
import { PseudonymizePanel } from './PseudonymizePanel'
import { RecodePanel } from './RecodePanel'
import type { ReviewEntity, SwitchableCategory } from './types'
import { useActiveMapping } from '../auth/active-mapping-context'
import { useLanguage } from './LanguageContext'
import { useAuth } from '../auth/auth-context'
import { ApiError } from '../api/client'
import { PseudonymMapper } from '../engine/pseudonym_mapper'
import { manualAnnotate, type ManualCategory } from '../engine/manual_annotate'

function buildReviewEntities(mapping: MappingEntry[]): ReviewEntity[] {
  return mapping.map((entry, idx) => ({
    pseudonym: entry.pseudonym,
    realValue: entry.realValue,
    category: entry.category,
    isFalsePositive: entry.isFalsePositive,
    isPreserved: entry.isPreserved,
    pass: entry.pass,
    id: `${entry.category}::${entry.realValue}::${idx}`,
    // Hydrate review status from the stored isFalsePositive flag — entries
    // that came back from a saved mapping with the FP marker render in the
    // FP state immediately.
    status: entry.isFalsePositive
      ? ('falsePositive' as const)
      : ('pending' as const),
  }))
}

/**
 * Merge fresh per-run entries with the cumulative entry list carried by the
 * active mapping. Entries are keyed by `category::realValue` so a new
 * document's repeated detection of Mario Rossi doesn't create a duplicate.
 * FP markers in the cumulative list win over new entries (the user already
 * decided this term is not personal data).
 */
function mergeEntries(
  cumulative: MappingEntry[],
  fresh: MappingEntry[],
): MappingEntry[] {
  const seen = new Map<string, MappingEntry>()
  for (const e of cumulative) {
    const k = `${e.category}::${e.realValue.toLowerCase()}`
    seen.set(k, e)
  }
  for (const e of fresh) {
    const k = `${e.category}::${e.realValue.toLowerCase()}`
    if (seen.has(k)) {
      // Keep the cumulative entry (preserves its isFalsePositive flag) but
      // make sure the pseudonym stays in sync with what the mapper used —
      // shouldn't drift in extend mode but defensive.
      const prev = seen.get(k)!
      seen.set(k, {
        ...prev,
        pseudonym: prev.pseudonym,
        category: prev.category,
        isFalsePositive: prev.isFalsePositive,
        isPreserved: prev.isPreserved,
        pass: prev.pass,
      })
    } else {
      seen.set(k, e)
    }
  }
  return Array.from(seen.values())
}

export function ClipboardWidget(): JSX.Element {
  const { active, saveActive, closeActive, updateEntries } = useActiveMapping()
  const { user, masterKey } = useAuth()
  const { language } = useLanguage()

  const [originalText, setOriginalText] = useState('')
  const [pseudonymizedText, setPseudonymizedText] = useState('')
  const [entities, setEntities] = useState<ReviewEntity[]>([])
  const [saveStatus, setSaveStatus] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [labelInputOpen, setLabelInputOpen] = useState(false)
  const [labelInput, setLabelInput] = useState('')

  // When an active mapping is opened, hydrate the review list from its
  // stored entries so the user immediately sees what's already in the case
  // dossier — and FP markers survive across the open/close cycle. We do this
  // ONLY when the active reference changes (open / close / save), not on
  // every entries update, otherwise local UI edits would be overwritten.
  const activeMappingId = active?.mappingId ?? null
  useEffect(() => {
    if (active) {
      setEntities(buildReviewEntities(active.entries))
      // Do NOT clear pseudonymizedText / originalText — the user may have
      // a doc loaded that they want to keep working with.
      setLabelInput(active.label)
    } else {
      // Closed: leave the current review state alone (don't surprise the
      // user with an empty list); just clear save status.
      setSaveStatus('idle')
      setSaveError(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMappingId])

  // Effective mapping for the recode panel: excludes entities the user has
  // marked as false positives (their realValue stays unchanged in the output,
  // so there's nothing to reverse). Variante β: preserved entries are also
  // excluded — their pseudonym IS their realValue, no reverse-substitution
  // to do.
  const effectiveMapping = useMemo<MappingEntry[]>(
    () =>
      entities
        .filter((e) => e.status !== 'falsePositive' && e.isPreserved !== true)
        .map(({ pseudonym, realValue, category }) => ({
          pseudonym,
          realValue,
          category,
        })),
    [entities],
  )

  // Whenever entities change AND there's an active mapping, propagate the
  // change up. We also recompute the cumulative list incorporating FP state
  // so a save now persists the FP markers (DESIGN §8.7).
  const pushEntriesToActive = useCallback(
    (next: ReviewEntity[]) => {
      if (!active) return
      const fresh: MappingEntry[] = next.map((e) => ({
        pseudonym: e.pseudonym,
        realValue: e.realValue,
        category: e.category,
        isFalsePositive: e.status === 'falsePositive',
      }))
      const merged = mergeEntries(active.entries, fresh)
      // Defensive equality check to avoid endless re-renders if nothing
      // changed semantically.
      const same =
        merged.length === active.entries.length &&
        merged.every((m, i) => {
          const prev = active.entries[i]
          return (
            prev !== undefined &&
            prev.pseudonym === m.pseudonym &&
            prev.realValue === m.realValue &&
            prev.category === m.category &&
            (prev.isFalsePositive ?? false) === (m.isFalsePositive ?? false)
          )
        })
      if (!same) updateEntries(merged)
    },
    [active, updateEntries],
  )

  const handleResult = ({
    originalText: orig,
    pseudonymizedText: pseudo,
    mapping,
  }: {
    originalText: string
    pseudonymizedText: string
    mapping: MappingEntry[]
  }) => {
    setOriginalText(orig)
    setPseudonymizedText(pseudo)
    const fresh = buildReviewEntities(mapping)
    // EXTEND mode: merge the fresh per-run entries with what's already in the
    // active mapping. Pseudonyms repeat across docs (Mario Rossi → Tizio in
    // Doc1 AND Doc2) which the engine guarantees; this widget only needs to
    // ensure the review list reflects the union so the user can scan all
    // entries from all documents at once.
    if (active) {
      const merged = mergeEntries(
        active.entries,
        fresh.map((e) => ({
          pseudonym: e.pseudonym,
          realValue: e.realValue,
          category: e.category,
          isFalsePositive: false,
        })),
      )
      setEntities(buildReviewEntities(merged))
      updateEntries(merged)
    } else {
      setEntities(fresh)
    }
    setSaveStatus('idle')
  }

  const handleAccept = (id: string) => {
    setEntities((prev) => {
      const next = prev.map((e) =>
        e.id === id ? { ...e, status: 'accepted' as const } : e,
      )
      pushEntriesToActive(next)
      return next
    })
  }

  const handleChangeCategory = (id: string, newCategory: SwitchableCategory) => {
    setEntities((prev) => {
      const next = prev.map((e) =>
        e.id === id
          ? { ...e, category: newCategory, status: 'accepted' as const }
          : e,
      )
      pushEntriesToActive(next)
      return next
    })
  }

  const handleFalsePositive = (id: string) => {
    setEntities((prev) => {
      const target = prev.find((e) => e.id === id)
      if (!target) return prev
      if (target.pseudonym && target.pseudonym !== target.realValue) {
        setPseudonymizedText((cur) =>
          cur.split(target.pseudonym).join(target.realValue),
        )
      }
      const next = prev.map((e) =>
        e.id === id ? { ...e, status: 'falsePositive' as const } : e,
      )
      pushEntriesToActive(next)
      return next
    })
  }

  /**
   * Variante β — flip a preserved entity (e.g. Palermo) to substituted.
   * Allocates a pseudonym via a UI-side PseudonymMapper (seeded from the
   * active mapping when one is open, to keep pool indices coherent across
   * the case) and rewrites the pseudonymized text. The mapping entry's
   * `isPreserved` becomes false and `pseudonym` is replaced with the new
   * value; the row re-renders with the standard button set.
   */
  const localMapperRef = useRef<PseudonymMapper | null>(null)

  /**
   * Lazy-init the local mapper, seeding it with whatever pseudonyms are
   * already allocated. Three sources, in priority order:
   *
   *   1. `active.mapper` (active case mapping open) — use that mapper
   *      directly, its pool indices and personMap are authoritative.
   *   2. Otherwise, build a fresh mapper and **seed it from the current
   *      `entities`** so the engine pool indices and personMap reflect what
   *      NER + regex have already allocated. Without this seed, the fresh
   *      mapper has pool_index=0 and re-allocates "Tizio" for the first
   *      manual annotation even if NER has already given Tizio to a
   *      different person — producing the collision observed by the
   *      founder on 2026-05-18.
   *   3. If `entities` is also empty, the mapper is genuinely fresh (first
   *      action on a virgin document).
   *
   * Idempotent: only initialises on first call. Re-uses the same mapper
   * across subsequent `handleSubstituteAnyway` / `handleManualAnnotate`
   * calls so they share the pool coherently.
   */
  const ensureLocalMapper = (currentEntities: ReviewEntity[]): PseudonymMapper => {
    if (localMapperRef.current !== null) return localMapperRef.current
    let mapper: PseudonymMapper
    // Reuse the active mapping's mapper ONLY when it was built for the
    // current language. Reusing across a language switch (e.g. user worked
    // in IT then switched to EN) is wrong — the mapper still holds the
    // Italian pool and would output "Tizio" for English persons.
    if (
      active?.mapper instanceof PseudonymMapper &&
      active.mapper.language === language
    ) {
      mapper = active.mapper
    } else {
      mapper = new PseudonymMapper({ language })
      // Seed from entities the NER + regex layer has already allocated.
      // Skip preserved (toggle β OFF) and falsePositive entries — their
      // pseudonyms aren't really claiming a slot in the substitution map.
      const seedEntries = currentEntities
        .filter((e) => e.isPreserved !== true && e.status !== 'falsePositive')
        .map((e) => ({
          pseudonym: e.pseudonym,
          realValue: e.realValue,
          category: e.category,
        }))
      if (seedEntries.length > 0) {
        mapper.seedFromEntries(seedEntries)
      }
    }
    localMapperRef.current = mapper
    return mapper
  }

  const handleSubstituteAnyway = (id: string) => {
    setEntities((prev) => {
      const target = prev.find((e) => e.id === id)
      if (!target) return prev
      if (target.isPreserved !== true) return prev

      const mapper = ensureLocalMapper(prev)

      let pseudonym: string
      const cat = target.category.toLowerCase()
      if (cat === 'citta' || cat === 'città' || cat === 'luogo') {
        pseudonym = mapper.getCity(target.realValue)
      } else if (cat === 'via') {
        pseudonym = mapper.getStreet(target.realValue)
      } else if (cat === 'tribunale') {
        pseudonym = mapper.getCourt(target.realValue)
      } else if (cat === 'azienda') {
        pseudonym = mapper.getCompany(target.realValue)
      } else {
        pseudonym = mapper.getOrg(target.realValue)
      }

      // Rewrite the visible pseudonymized text. We use split/join which
      // handles all occurrences — safer than a single replace when the
      // original appears multiple times in the document.
      if (pseudonym && pseudonym !== target.realValue) {
        setPseudonymizedText((cur) => cur.split(target.realValue).join(pseudonym))
      }

      const next = prev.map((e) =>
        e.id === id
          ? {
              ...e,
              pseudonym,
              isPreserved: false,
              status: 'accepted' as const,
            }
          : e,
      )
      pushEntriesToActive(next)
      return next
    })
  }

  /**
   * Manual annotation gesture (Priority C, MHC-L parity). The avvocato
   * selects a span in the original textarea, picks a category, clicks the
   * "Anonimizza la selezione" button — PseudonymizePanel surfaces the
   * (start, end, category) triple here.
   *
   * We delegate to `manualAnnotate` (engine) which: extracts the realValue,
   * allocates a pseudonym from the local PseudonymMapper (shared with the
   * `handleSubstituteAnyway` path so the pools stay coherent), and rebuilds
   * the pseudonymized text.
   */
  const handleManualAnnotate = (
    start: number,
    end: number,
    category: ManualCategory,
  ) => {
    if (!originalText) return
    if (start >= end || start < 0 || end > originalText.length) return

    // Seed-aware lazy init: see ensureLocalMapper for the rationale (avoids
    // collision where manual annotation re-allocates "Tizio" because the
    // fresh mapper has no knowledge of what NER has already given to other
    // entities).
    const mapper = ensureLocalMapper(entities)

    // Build the input list for manualAnnotate: it expects ALL substitution
    // entries (regex + NER + previous manuals) so its text-rebuild step
    // reproduces the full pseudonymized output. FP and preserved entries are
    // filtered inside manualAnnotate.
    const baseEntries: MappingEntry[] = entities.map((e) => ({
      pseudonym: e.pseudonym,
      realValue: e.realValue,
      category: e.category,
      isFalsePositive: e.status === 'falsePositive',
      isPreserved: e.isPreserved,
      pass: e.pass,
      source: e.source,
    }))

    let result
    try {
      result = manualAnnotate(
        originalText,
        start,
        end,
        category,
        mapper,
        baseEntries,
      )
    } catch {
      // Invalid selection (empty after trim, out-of-bounds, etc.) — silently
      // ignore. The button should already be disabled in this case.
      return
    }

    // De-cuius corner case: the engine returns an empty pseudonymizedText to
    // signal "no rewrite, no new entry" (the name was in the skip set).
    if (result.pseudonymizedText === '') return

    setPseudonymizedText(result.pseudonymizedText)

    // Build the new review entities from the merged entry list. Preserve
    // the existing review status (accepted / falsePositive) for entries
    // already in the list; the new manual entry comes in as 'pending'.
    const statusByKey = new Map<string, ReviewEntity['status']>()
    for (const e of entities) {
      statusByKey.set(`${e.category}::${e.realValue.toLowerCase()}`, e.status)
    }
    const nextEntities: ReviewEntity[] = result.entries.map((entry, idx) => {
      const key = `${entry.category}::${entry.realValue.toLowerCase()}`
      const prevStatus = statusByKey.get(key)
      return {
        pseudonym: entry.pseudonym,
        realValue: entry.realValue,
        category: entry.category,
        isFalsePositive: entry.isFalsePositive,
        isPreserved: entry.isPreserved,
        pass: entry.pass,
        source: entry.source,
        id: `${entry.category}::${entry.realValue}::${idx}`,
        status: entry.isFalsePositive
          ? 'falsePositive'
          : prevStatus ?? 'pending',
      }
    })
    setEntities(nextEntities)
    pushEntriesToActive(nextEntities)
  }

  const userFalsePositiveTerms = useMemo<Set<string>>(() => {
    // Carry forward FP markers from the active mapping so a re-run on a new
    // document keeps "Emilia" un-pseudonymized (DESIGN §8.7, R-06).
    const out = new Set<string>()
    if (active) {
      for (const e of active.entries) {
        if (e.isFalsePositive) out.add(e.realValue)
      }
    }
    for (const e of entities) {
      if (e.status === 'falsePositive') out.add(e.realValue)
    }
    return out
  }, [active, entities])

  const canSave = user !== null && masterKey !== null && entities.length > 0

  // Design C: slide-in recode panel state. Open/close handled here; the
  // PseudonymizePanel surfaces the "Recode risposta Claude →" toolbar button.
  const [recodeOpen, setRecodeOpen] = useState(false)

  const onSaveClick = () => {
    if (!user) {
      setSaveError('Devi accedere o creare un account per salvare i mapping.')
      return
    }
    if (!masterKey) {
      setSaveError(
        'Master key non in memoria. Esci e riaccedi (la chiave viene derivata al login).',
      )
      return
    }
    // Pre-fill label from current active mapping if any.
    setLabelInput(active?.label ?? '')
    setLabelInputOpen(true)
    setSaveError(null)
  }

  const onSaveConfirm = async () => {
    const trimmedLabel = labelInput.trim()
    if (!trimmedLabel) {
      setSaveError('Inserisci un\'etichetta (es. "Causa Rossi vs Bianchi").')
      return
    }
    setSaveStatus('saving')
    setSaveError(null)
    try {
      const entriesToSave: MappingEntry[] = entities.map((e) => ({
        pseudonym: e.pseudonym,
        realValue: e.realValue,
        category: e.category,
        isFalsePositive: e.status === 'falsePositive',
      }))
      // Merge with any pre-existing entries the active mapping carries from
      // earlier documents (so re-saving doesn't drop them).
      const finalEntries = active
        ? mergeEntries(active.entries, entriesToSave)
        : entriesToSave
      await saveActive(trimmedLabel, finalEntries)
      setSaveStatus('saved')
      setLabelInputOpen(false)
      window.setTimeout(() => setSaveStatus('idle'), 2500)
    } catch (err) {
      setSaveStatus('error')
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Errore inatteso durante il salvataggio.'
      setSaveError(msg)
    }
  }

  return (
    <div
      className={`clipboard-widget clipboard-widget--documentfirst${recodeOpen ? ' clipboard-widget--recode-open' : ''}`}
      data-testid="clipboard-widget"
    >
      <PseudonymizePanel
        originalText={originalText}
        pseudonymizedText={pseudonymizedText}
        entities={entities}
        onResult={handleResult}
        onOriginalChange={setOriginalText}
        onAccept={handleAccept}
        onChangeCategory={handleChangeCategory}
        onFalsePositive={handleFalsePositive}
        onSubstituteAnyway={handleSubstituteAnyway}
        onManualAnnotate={handleManualAnnotate}
        seedMapper={
          // Only seed the engine with the active mapping's mapper when it
          // was built for the current document language. Otherwise the
          // engine allocates pseudonyms from the wrong pool — e.g. an
          // English document handed an Italian mapper would still emit
          // "Tizio" / "Caia" because the legacy mapper's pools are frozen.
          active?.mapper instanceof PseudonymMapper &&
          active.mapper.language === language
            ? active.mapper
            : null
        }
        seedFalsePositives={userFalsePositiveTerms}
        canSave={canSave}
        loggedIn={user !== null}
        masterKeyAvailable={masterKey !== null}
        saveStatus={saveStatus}
        saveError={saveError}
        labelInputOpen={labelInputOpen}
        labelInput={labelInput}
        onLabelChange={setLabelInput}
        onSaveClick={onSaveClick}
        onSaveConfirm={() => void onSaveConfirm()}
        onSaveCancel={() => {
          setLabelInputOpen(false)
          setSaveError(null)
        }}
        activeLabel={active?.label ?? null}
        onCloseActive={closeActive}
        onOpenRecode={() => setRecodeOpen((v) => !v)}
        recodeOpen={recodeOpen}
      />
      {/*
        Recode panel — slide-in when open, hidden when closed. We always
        mount it (visibility/display rather than conditional unmount) so the
        existing tests that query its testids (recode-no-mapping-hint,
        claude-response-textarea, recoded-textarea, copy-recoded-btn) still
        find them. CSS pulls the slide-in off-screen when not open.
      */}
      <div
        className={`recode-slidein-host${recodeOpen ? ' is-open' : ''}`}
        data-testid="recode-slidein-host"
      >
        <RecodePanel
          mapping={effectiveMapping}
          mode="slidein"
          onClose={() => setRecodeOpen(false)}
        />
      </div>
    </div>
  )
}
