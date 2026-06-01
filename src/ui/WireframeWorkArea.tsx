/**
 * WireframeWorkArea — wireframe-first work area (founder direttiva
 * SID-20260527 "cambia tutto, rendilo come il prototype").
 *
 * Sostituisce la combinazione ClipboardWidget + PseudonymizePanel come surface
 * principale del work view. La spec visiva canonica è il prototipo HTML
 * `MHC-Work/notes/research/recode-it/wireframes/prototype/prototype.html`
 * (SID-20260526-172143 → SID-20260527, ratificato founder via ~30 iterazioni
 * chat). Trace dottrinale: `MHC-Work/notes/traces/trace_vibecoding_antipattern_wireframe_first_20260526.md`.
 *
 * Architettura del layout (top → bottom):
 *
 *   1. **2 macro buttons** — Codifica / Decodifica (toggle macro mode)
 *   2. **Toolbar verticale centrata** — PSEUDONIMIZZA / DECODIFICA big-button
 *      blu con frecce direzionali (→/←) + (Codifica only) bottone grigio
 *      "sostituisci anche" full-width sotto.
 *   3. **2 panel side-by-side** — labels semantici STABILI (sx=originale,
 *      dx=pseudonimizzato), flusso che si INVERTE: Codifica → sx=input
 *      editabile, dx=output read-only; Decodifica → dx=input editabile,
 *      sx=output read-only. Switch macro NON svuota i panel.
 *   4. **Entity review expandable** — sotto panel originale dopo Pseudonimizza
 *      su questo doc, "Rivedi entità rilevate (N)" expandable section.
 *   5. **Decodifica preview CTA (free tier only)** — card blu "Hai visto
 *      l'anteprima, sblocca per €20 / chiave MHC" inline bearer input.
 *   6. **Lingua documento row** — full-width sotto i panel (FR/DE disabled).
 *   7. **2 cards mappa paritarie** — "Chiavi locali" + "Chiavi su server"
 *      (Pro parcheggiato Phase 1 → card promette "in arrivo, gratis su
 *      invito"; il prezzo €25 una tantum è roadmap, non attivo oggi).
 *   8. **Vista dettaglio mappa** — MappaPanel sempre visibile (trick width
 *      SID-20260530 — gestalt verticale di default).
 *
 * Modal "I miei mapping" aperta da card "Chiavi su server" con upsell €25.
 *
 * Engine logic preservata 1:1 dal vecchio ClipboardWidget/PseudonymizePanel:
 * - anonymize() pipeline (regex + NER worker via NerRunner)
 * - manual_annotate via popup contestuale (DocumentView)
 * - active mapping context: extend mode automatica, FP propagation, save/save-as
 * - upload multi-format: .txt/.md/.docx/.pdf via extractText
 * - decodifica reverse via applyReverseSubstitution
 *
 * Features DROP rispetto al vecchio layout:
 * - Pattern "default single-view + button '⇆ Confronta originale' opt-in":
 *   side-by-side è sempre on
 * - CompareView opt-in: la SUA LOGICA è incorporata come default
 * - 3-tab structure: superata da 2-macro + sezione mappa integrata
 * - DecodificaResidualDetector: drop (già coperto da disclosure deployata)
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react'

import { useActiveMapping } from '../auth/active-mapping-context'
import { useAuth } from '../auth/auth-context'
import {
  ApiError,
  claimReverseSubstitutionByBearer,
  claimReverseSubstitutionCheckout,
} from '../api/client'
import { anonymize } from '../engine/engine'
import { manualAnnotate, type ManualCategory } from '../engine/manual_annotate'
import { NerRunner, type NerProgressEvent } from '../engine/ner_runner'
import { PseudonymMapper } from '../engine/pseudonym_mapper'
import { extractText, SUPPORTED_EXTENSIONS } from '../extraction/extract'
import type { MappingEntry, NerDetection } from '../types/engine'
import { BundleBanner } from './BundleBanner'
import { applyReverseSubstitution } from './DecodificaPanel'
import { DocumentView } from './DocumentView'
import { EntityReviewList } from './EntityReviewList'
import {
  exportToPdf,
  exportToWord,
  formatExportFilename,
} from './exportDocument'
import { type Language, SUPPORTED_LANGUAGES, useLanguage } from './LanguageContext'
import { MappaPanel } from './MappaPanel'
import { ModelLoadingState, type ModelLoadPhase } from './ModelLoadingState'
import type { ReviewEntity, SwitchableCategory } from './types'

type MacroMode = 'codifica' | 'decodifica'

const DECODIFICA_PREVIEW_LIMIT = 150
const ACCEPTED_EXTENSIONS = SUPPORTED_EXTENSIONS

// Dropdown "Sostituisci anche" — esattamente 5 interruttori VERI e
// INDIPENDENTI, default OFF (founder criterio canonico `_org/decision_log.md`
// MHC-Work 2026-05-30 SID-20260530-095254). Il flusso standard (sempre attivo
// nel motore: CF, P.IVA, IBAN, CRO, PROT, EMAIL, PHONE, NUM_PRENOT) maschera
// gli identificativi di persona senza trade-off giuridico — quelle voci NON
// sono più nel dropdown (smettevano di fingersi opzionali). Qui restano solo
// le categorie con trade-off giuridico, ciascuna indipendente:
//   - 3 NER-label (luogo/organizzazione/tribunale) → `enabledPass2Labels`
//   - 2 regex-detector gated (date/cap), nuovi      → `enabledGatedDetectors`
// Supersede la lista 9-voci pre-2026-05-30 (cf/iban/phone/booking erano finte).
const SOSTITUISCI_ANCHE_CATEGORIES = [
  { key: 'places', labelKey: 'wireframe.modifier.places' },
  { key: 'organizations', labelKey: 'wireframe.modifier.organizations' },
  { key: 'courts', labelKey: 'wireframe.modifier.courts' },
  { key: 'cap', labelKey: 'wireframe.modifier.cap' },
  { key: 'date', labelKey: 'wireframe.modifier.date' },
] as const

// Dropdown key → NER Pass-2 label (engine `enabledPass2Labels`).
const KEY_TO_NER_LABEL: Record<string, string> = {
  places: 'luogo',
  organizations: 'organizzazione',
  courts: 'tribunale',
}

// Dropdown key → gated regex-detector key (engine `enabledGatedDetectors`).
const KEY_TO_GATED_DETECTOR: Record<string, string> = {
  cap: 'cap',
  date: 'date',
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Helper — entity rebuild                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

function buildReviewEntities(mapping: MappingEntry[]): ReviewEntity[] {
  return mapping.map((entry, idx) => ({
    pseudonym: entry.pseudonym,
    realValue: entry.realValue,
    category: entry.category,
    isFalsePositive: entry.isFalsePositive,
    isPreserved: entry.isPreserved,
    pass: entry.pass,
    source: entry.source,
    id: `${entry.category}::${entry.realValue}::${idx}`,
    status: entry.isFalsePositive
      ? ('falsePositive' as const)
      : ('pending' as const),
  }))
}

function applyAllSubstitutions(
  original: string,
  entries: ReadonlyArray<MappingEntry>,
): string {
  if (!original) return original
  const ordered = [...entries]
    .filter(
      (e) =>
        e.isPreserved !== true &&
        e.isFalsePositive !== true &&
        e.pseudonym !== e.realValue,
    )
    .sort((a, b) => b.realValue.length - a.realValue.length)
  let out = original
  for (const e of ordered) {
    out = out.split(e.realValue).join(e.pseudonym)
  }
  return out
}

// Exported for tests — see `__tests__/mergeEntries.test.ts`. The function is
// part of the run-2 toggle-flip discipline (substitution-wins-over-preservation)
// and deserves a unit test surface independent of the React component.
export function mergeEntries(
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
      const prev = seen.get(k)!
      // Substitution-wins-over-preservation (founder criterio 2026-05-30,
      // bug "Firenze→Firenze identity dopo run 2"): se il run precedente ha
      // PRESERVATO l'entità (toggle categoria spento → isPreserved:true) e
      // il run corrente la SOSTITUISCE (toggle ora acceso → isPreserved:false),
      // la sostituzione fresh deve VINCERE. Senza questo, il pseudonimizzatoText
      // mostra il nuovo pseudonimo ma la mappa UI resta identity (Firenze→Firenze).
      //
      // Edge case: se ENTRAMBE le entry sono preserved, manteniamo prev — può
      // essere una decisione esplicita dell'utente ("Falso positivo / lascia
      // originale") e non va silenziosamente sovrascritta da un re-run.
      const prevPreserved = prev.isPreserved === true
      const freshPreserved = e.isPreserved === true
      if (prevPreserved && !freshPreserved) {
        seen.set(k, e)
      } else {
        seen.set(k, {
          ...prev,
          pseudonym: prev.pseudonym,
          category: prev.category,
          isFalsePositive: prev.isFalsePositive,
          isPreserved: prev.isPreserved,
          pass: prev.pass,
        })
      }
    } else {
      seen.set(k, e)
    }
  }
  return Array.from(seen.values())
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Main component                                                              */
/* ────────────────────────────────────────────────────────────────────────── */

type Props = {
  initialMode?: MacroMode
}

export function WireframeWorkArea({
  initialMode = 'codifica',
}: Props): JSX.Element {
  const { t, docLanguage: language, setDocLanguage } = useLanguage()
  const { user, masterKey } = useAuth()
  const {
    active,
    saveActive,
    closeActive,
    updateEntries,
    renameActive,
  } = useActiveMapping()
  const authCtx = useAuth()

  /* ── macro mode ────────────────────────────────────────────────────────── */
  const [mode, setMode] = useState<MacroMode>(initialMode)

  /* ── panel content (preserved across mode switches) ────────────────────── */
  const [originaleText, setOriginaleText] = useState('')
  const [pseudonimizzatoText, setPseudonimizzatoText] = useState('')
  // Decodifica preview banner / cta visibility — true after a Decodifica run
  // in free tier with non-empty output. `decodificaTruncated` value is
  // accessed via data-truncated attribute on the panel for E2E test
  // affordance + future telemetry; UI visibility derives from
  // `showDecodificaFreeAffordance` below.
  const [decodificaTruncated, setDecodificaTruncated] = useState(false)
  // Decodifica run state (the user has clicked DECODIFICA at least once on the
  // current input — drives banner ANTEPRIMA + CTA visibility).
  const [hasRunDecodifica, setHasRunDecodifica] = useState(false)

  /* ── entity review state ───────────────────────────────────────────────── */
  const [entities, setEntities] = useState<ReviewEntity[]>([])
  const [entityReviewOpen, setEntityReviewOpen] = useState(false)

  /* ── pseudonimizzazione engine state ───────────────────────────────────── */
  const [nerStatus, setNerStatus] = useState<
    'idle' | 'loading' | 'running' | 'unavailable'
  >('idle')
  const [loadProgress, setLoadProgress] = useState<{
    phase: ModelLoadPhase
    loaded: number
    total: number
  } | null>(null)
  const [pseudoError, setPseudoError] = useState<string | null>(null)
  const [partialNotice, setPartialNotice] = useState<{
    failedRanges: Array<[number, number]>
  } | null>(null)
  const [scannedPdfModalOpen, setScannedPdfModalOpen] = useState(false)
  const [hasRunOnCurrentDoc, setHasRunOnCurrentDoc] = useState(false)

  /* ── "sostituisci anche" dropdown (variante β-ish) ─────────────────────── */
  const [sostituisciAncheOpen, setSostituisciAncheOpen] = useState(false)
  const [sostituisciAnche, setSostituisciAnche] = useState<Set<string>>(
    () => new Set(),
  )
  /* Feedback visivo "Applica" del dropdown (founder SID-20260530):
     senza affordance, il click su Applica chiudeva il dropdown silently e
     l'utente non percepiva che la ri-pseudonimizzazione stava avvenendo.
     Triplo layer: (a) bottone Applica con label "Applicazione in corso..."
     + disabled durante l'esecuzione, (b) checkbox disabled durante, (c)
     flash verde 1s sul pannello pseudonimizzato al completamento. Stato
     locale dedicato (non dipende da nerStatus che ha transizioni sottili). */
  const [isApplyingModifiers, setIsApplyingModifiers] = useState(false)
  const [flashPseudoPanel, setFlashPseudoPanel] = useState(false)
  const flashPseudoTimerRef = useRef<number | null>(null)

  /* ── Mapping-lock affordance (founder SID-20260531, ratifica 2026-05-31
     ripristino pattern fe283d4 con copy dual-model — il microcopy interno
     al dropdown del commit 3a26620 si è rivelato invisibile in pratica:
     l'utente non apre il dropdown se il bottone non cambia visivamente) ──
     Una volta che esiste un mapping attivo con entità (sia loaded da IDB
     sia appena costruito in-session post-PSEUDONIMIZZA), le categorie di
     sostituzione sono fissate per coerenza di causa. Il dropdown
     "sostituisci anche" passa in stato "locked":
       - bottone collapsed: label "ora non puoi più sostituire" + rosso
         desaturato, cliccabile (apre il dropdown);
       - dropdown aperto: banner microcopy sopra i 5 toggle (disabled +
         greyed) con il copy dual-model verbatim, bottone Applica nascosto,
         link CTA "Ricomincia con un nuovo documento" sotto.
     Click CTA → closeActive() + reset input/output ⇒ stato fresh.
     Trigger semantico: `active !== null && active.entries.length > 0`,
     indipendente da `pristine` — l'evento vincolante è PSEUDONIMIZZA,
     non il save. */
  const isMappingActive =
    active !== null && active.entries.length > 0

  /* ── suggerimento "luoghi preservati" (founder SID-20260530) ──────────────
     Quando la pseudonimizzazione preserva entità Pass-2 (citta/via/azienda/
     organizzazione/tribunale) PERCHÉ la corrispondente category nel dropdown
     "sostituisci anche" è OFF, l'utente le vede evidenziate sulla mappa MA
     non sostituite — UX-confusione (sembra un bug). Affordance inline:
     suggerimento sotto il pannello pseudonimizzato che conta e propone di
     accendere il toggle + rilanciare in un click. Dismiss ephemeral
     (sessione corrente, no localStorage): set di keys dismessi dall'utente. */
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(
    () => new Set(),
  )

  /* ── upload affordance ─────────────────────────────────────────────────── */
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  /* ── mappa cards ───────────────────────────────────────────────────────── */
  const [selectedCard, setSelectedCard] = useState<'locali' | null>(null)
  const [modalChiaviServerOpen, setModalChiaviServerOpen] = useState(false)

  /* ── Decodifica unlock state ───────────────────────────────────────────── */
  const granted = authCtx?.reverseSubstitutionGranted ?? false
  const refreshReverseSubstitution =
    authCtx?.refreshReverseSubstitution ?? (async () => {})
  const [bearerInput, setBearerInput] = useState('')
  const [bearerInputVisible, setBearerInputVisible] = useState(false)
  const [bearerValidating, setBearerValidating] = useState(false)
  const [bearerError, setBearerError] = useState<string | null>(null)
  const [stripeOpening, setStripeOpening] = useState(false)

  /* ── copy-output one-click (Fix 1, regressione post-wireframe) ──────────
     Pre-wireframe PseudonymizePanel aveva un bottone "Copia ⧉ / ✓ Copiato"
     (navigator.clipboard.writeText(pseudonymizedText)). Il rewrite wireframe-
     first lo aveva droppato: l'output (pseudonimizzato in Codifica, originale
     decodificato in Decodifica) non aveva più copia a un click. Due flag
     indipendenti: uno per il pannello pseudonimizzato (Codifica), uno per il
     pannello originale che ospita l'output di Decodifica. */
  const [copyPseudoState, setCopyPseudoState] = useState<'idle' | 'copied'>(
    'idle',
  )
  const [copyDecodedState, setCopyDecodedState] = useState<'idle' | 'copied'>(
    'idle',
  )
  const copyPseudoTimerRef = useRef<number | null>(null)
  const copyDecodedTimerRef = useRef<number | null>(null)

  const handleCopyPseudo = useCallback(async () => {
    if (!pseudonimizzatoText) return
    try {
      await navigator.clipboard.writeText(pseudonimizzatoText)
      setCopyPseudoState('copied')
      if (copyPseudoTimerRef.current !== null) {
        window.clearTimeout(copyPseudoTimerRef.current)
      }
      copyPseudoTimerRef.current = window.setTimeout(
        () => setCopyPseudoState('idle'),
        2000,
      )
    } catch {
      /* clipboard unavailable (insecure context / permission) — silent */
    }
  }, [pseudonimizzatoText])

  const handleCopyDecoded = useCallback(async () => {
    if (!originaleText) return
    try {
      await navigator.clipboard.writeText(originaleText)
      setCopyDecodedState('copied')
      if (copyDecodedTimerRef.current !== null) {
        window.clearTimeout(copyDecodedTimerRef.current)
      }
      copyDecodedTimerRef.current = window.setTimeout(
        () => setCopyDecodedState('idle'),
        2000,
      )
    } catch {
      /* clipboard unavailable — silent */
    }
  }, [originaleText])

  /* ── export Word / PDF (SID-20260530) ───────────────────────────────────
     Bottoni "📄 Word" / "📕 PDF" affiancati a "Copia" SOLO sul pannello
     output di Decodifica (originale ricostruito). La Codifica produce un
     output intermedio destinato a essere incollato in un'AI esterna: NON
     ha bisogno di Word/PDF (founder directive 2026-05-30 — "codifica NON
     ha bisogno di word e pdf; è per andare all'AI"). Resta "Copia" per
     spostare il testo negli appunti.
     Generazione lato-browser via `docx` + `jspdf`, download via blob anchor.
     Privacy: no metadati identificativi, filename timestamped. */
  const handleExportDecodedWord = useCallback(async () => {
    if (!originaleText) return
    try {
      await exportToWord(
        originaleText,
        formatExportFilename('decodifica', 'docx'),
      )
    } catch {
      /* silent */
    }
  }, [originaleText])

  const handleExportDecodedPdf = useCallback(() => {
    if (!originaleText) return
    try {
      exportToPdf(originaleText, formatExportFilename('decodifica', 'pdf'))
    } catch {
      /* silent */
    }
  }, [originaleText])

  /* ── save mapping ──────────────────────────────────────────────────────── */
  const [saveStatus, setSaveStatus] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  // Krug-style ratifica founder SID-20260530: bottone "Salva nel browser" sempre
  // primary, niente form etichetta. Auto-genera label "Mapping del DD/MM/YYYY HH:MM"
  // al primo salvataggio. Rinomina rimane disponibile come link minuscolo nel banner
  // Mapping attivo.
  const [autoSaveEnabled, setAutoSaveEnabled] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('recodeit:autoSaveMapping') === '1'
    } catch {
      return false
    }
  })
  // Timestamp ms ultimo salvataggio per "salvato HH:MM" nel banner.
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)
  // Flash verde leggero sul banner per 1.5s dopo salvataggio MANUALE (founder
  // ratifica SID-20260530: feedback visivo solo per atto esplicito utente,
  // niente rumore visivo sui salvataggi automatici).
  const [flashSaved, setFlashSaved] = useState(false)
  // Mini-prompt rinomina inline nel banner Mapping attivo.
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameInput, setRenameInput] = useState('')

  /* ── NER runner ────────────────────────────────────────────────────────── */
  const runnerRef = useRef<NerRunner | null>(null)
  const localMapperRef = useRef<PseudonymMapper | null>(null)

  useEffect(() => {
    let cancelled = false
    if (typeof Worker === 'undefined') return
    const runner = new NerRunner({ language })
    runnerRef.current = runner
    setNerStatus('loading')
    setLoadProgress({ phase: 'wasm', loaded: 0, total: 0 })
    runner
      .init((evt: NerProgressEvent) => {
        if (cancelled) return
        setLoadProgress({ phase: evt.phase, loaded: evt.loaded, total: evt.total })
      })
      .then(() => {
        if (cancelled) return
        setLoadProgress(null)
        setNerStatus('idle')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setLoadProgress(null)
        runnerRef.current = null
        setNerStatus('unavailable')
        const rawMsg = (err as Error)?.message ?? 'errore sconosciuto'
        if (rawMsg.includes('ERR_MODEL_NOT_FOUND')) {
          setPseudoError(t('pseudo.error.nerUnavailable'))
        } else {
          setPseudoError(
            `${t('pseudo.error.nerBackend')} ${rawMsg.replace(/^ERR_BACKEND_INIT:\s*/, '')}`,
          )
        }
      })
    return () => {
      cancelled = true
      runner.terminate()
      runnerRef.current = null
    }
  }, [language, t])

  /* ── hydrate from active mapping ───────────────────────────────────────── */
  const activeMappingId = active?.mappingId ?? null
  const prevActiveIdRef = useRef<string | null>(activeMappingId)
  useEffect(() => {
    if (active) {
      setEntities(buildReviewEntities(active.entries))
    } else if (prevActiveIdRef.current !== null) {
      setOriginaleText('')
      setPseudonimizzatoText('')
      setEntities([])
      localMapperRef.current = null
      setSaveStatus('idle')
      setSaveError(null)
      setHasRunOnCurrentDoc(false)
      setLastSavedAt(null)
      setRenameOpen(false)
    } else {
      setSaveStatus('idle')
      setSaveError(null)
    }
    prevActiveIdRef.current = activeMappingId
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMappingId])

  // Reactive sync to MappaPanel edits
  useEffect(() => {
    if (!active) return
    if (!originaleText) return
    setEntities((prev) => {
      const statusByKey = new Map<string, ReviewEntity['status']>()
      for (const e of prev) {
        statusByKey.set(`${e.category}::${e.realValue.toLowerCase()}`, e.status)
      }
      return active.entries.map((entry, idx) => {
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
            ? ('falsePositive' as const)
            : prevStatus ?? ('pending' as const),
        }
      })
    })
    setPseudonimizzatoText(applyAllSubstitutions(originaleText, active.entries))
  }, [active, originaleText])

  /* ── reset doc-run flag on new doc ─────────────────────────────────────── */
  useEffect(() => {
    setHasRunOnCurrentDoc(false)
  }, [originaleText])

  /* ── clear copy-feedback timers on unmount (Fix 1) ─────────────────────── */
  useEffect(() => {
    return () => {
      if (copyPseudoTimerRef.current !== null) {
        window.clearTimeout(copyPseudoTimerRef.current)
      }
      if (copyDecodedTimerRef.current !== null) {
        window.clearTimeout(copyDecodedTimerRef.current)
      }
      if (flashPseudoTimerRef.current !== null) {
        window.clearTimeout(flashPseudoTimerRef.current)
      }
    }
  }, [])

  /* ── user FP carry-over ────────────────────────────────────────────────── */
  const userFalsePositiveTerms = useMemo<Set<string>>(() => {
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

  /* ────────────────────────────────────────────────────────────────────── */
  /* Engine actions                                                          */
  /* ────────────────────────────────────────────────────────────────────── */

  const seedMapper = useMemo(() => {
    if (
      active?.mapper instanceof PseudonymMapper &&
      active.mapper.language === language
    ) {
      return active.mapper
    }
    return null
  }, [active, language])

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

  const runRegexOnly = useCallback(
    (
      userFalsePositives: Set<string>,
      nerDetections?: NerDetection[],
      extraKeys?: Set<string>,
    ) => {
      // Translate the dropdown selection (UI keys) into the two granular
      // engine option sets: NER Pass-2 labels + gated regex detectors. Each
      // toggle is independent — spuntare "Luoghi" maschera SOLO `luogo`
      // (founder criterio 2026-05-30, fix bug all-or-nothing).
      //
      // `extraKeys` (opt) consente al chiamante di forzare l'inclusione di
      // chiavi aggiuntive nello stesso tick di un setState pendente — necessario
      // perché React useState è async e leggere `sostituisciAnche` dalla closure
      // del render corrente ritorna il valore PRIMA dell'update. Caso d'uso:
      // bottone "Sì, includi i luoghi" del banner preserved-suggestion che
      // attiva un toggle e rilancia subito Pseudonimizza (bug fix 2026-06-01).
      const effectiveKeys = extraKeys
        ? new Set<string>([...sostituisciAnche, ...extraKeys])
        : sostituisciAnche
      const enabledPass2Labels = new Set<string>()
      const enabledGatedDetectors = new Set<string>()
      for (const key of effectiveKeys) {
        const nerLabel = KEY_TO_NER_LABEL[key]
        if (nerLabel) enabledPass2Labels.add(nerLabel)
        const gated = KEY_TO_GATED_DETECTOR[key]
        if (gated) enabledGatedDetectors.add(gated)
      }
      const result = anonymize(originaleText, {
        userFalsePositives,
        nerDetections,
        seedMapper: seedMapper ?? undefined,
        enabledPass2Labels,
        enabledGatedDetectors,
        language,
      })
      setPseudonimizzatoText(result.pseudonymizedText)
      const fresh = buildReviewEntities(result.mappingEntries)
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
      setHasRunOnCurrentDoc(true)
    },
    [
      originaleText,
      seedMapper,
      sostituisciAnche,
      language,
      active,
      updateEntries,
    ],
  )

  const handlePseudonimizza = useCallback(
    async (options?: { extraKeys?: Set<string> }) => {
      setPseudoError(null)
      setPartialNotice(null)
      if (!originaleText.trim()) {
        setPseudoError(t('wireframe.error.emptyDoc'))
        return
      }
      const userFalsePositives = new Set<string>([
        ...entities
          .filter((e) => e.status === 'falsePositive')
          .map((e) => e.realValue),
        ...userFalsePositiveTerms,
      ])

      const workerSupported =
        typeof Worker !== 'undefined' && nerStatus !== 'unavailable'

      if (!workerSupported || !runnerRef.current) {
        runRegexOnly(userFalsePositives, undefined, options?.extraKeys)
        return
      }

      let nerDetections: NerDetection[] | undefined
      setNerStatus('running')
      try {
        const predictResult = await runnerRef.current.predict(originaleText)
        nerDetections = predictResult.detections
        if (predictResult.partial) {
          setPartialNotice({ failedRanges: predictResult.failedChunkRanges })
        }
      } catch (err) {
        const rawMsg = (err as Error).message ?? 'errore sconosciuto'
        const isPermanent =
          rawMsg.includes('ERR_MODEL_NOT_FOUND') ||
          rawMsg.includes('ERR_BACKEND_INIT')
        if (isPermanent) {
          runnerRef.current = null
          setNerStatus('unavailable')
        }
        setPseudoError(
          `${t('pseudo.error.nerBackend')} ${rawMsg.replace(/^ERR_[A-Z_]+:\s*/, '')}`,
        )
      } finally {
        setNerStatus((prev) => (prev === 'running' ? 'idle' : prev))
      }

      runRegexOnly(userFalsePositives, nerDetections, options?.extraKeys)
    },
    [
      originaleText,
      entities,
      userFalsePositiveTerms,
      nerStatus,
      runRegexOnly,
      t,
    ],
  )

  const handleDecodifica = useCallback(() => {
    if (!pseudonimizzatoText.trim()) return
    const result = applyReverseSubstitution(
      pseudonimizzatoText,
      active?.entries ?? [],
    )
    const tier = user?.tier ?? null
    const isFreeTierWithoutGrant = !granted && tier !== 'pro'
    if (
      isFreeTierWithoutGrant &&
      result.output.length > DECODIFICA_PREVIEW_LIMIT
    ) {
      setOriginaleText(result.output.slice(0, DECODIFICA_PREVIEW_LIMIT) + '…')
      setDecodificaTruncated(true)
    } else {
      setOriginaleText(result.output)
      setDecodificaTruncated(isFreeTierWithoutGrant && result.output.length > 0)
    }
    setHasRunDecodifica(true)
  }, [pseudonimizzatoText, active, user, granted])

  /* ────────────────────────────────────────────────────────────────────── */
  /* File upload                                                             */
  /* ────────────────────────────────────────────────────────────────────── */

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      setPseudoError(null)
      if (!files || files.length === 0) return
      const file = files[0]
      if (!file) return
      const name = file.name.toLowerCase()
      if (!ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext))) {
        setPseudoError(
          `${t('pseudo.upload.errorFormatPrefix')}${ACCEPTED_EXTENSIONS.join(', ')}${t('pseudo.upload.errorFormatSuffix')}`,
        )
        return
      }
      try {
        const result = await extractText(file)
        if (result.scannedPdf) {
          setScannedPdfModalOpen(true)
          return
        }
        setOriginaleText(result.text)
      } catch (err) {
        setPseudoError(
          `${t('pseudo.upload.errorReadPrefix')}${(err as Error).message}`,
        )
      }
    },
    [t],
  )

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    if (mode !== 'codifica') return
    void handleFiles(e.dataTransfer.files)
  }
  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (mode !== 'codifica') return
    setDragOver(true)
  }
  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
  }
  const handleFileInput = (e: ChangeEvent<HTMLInputElement>) => {
    void handleFiles(e.target.files)
  }

  /* ────────────────────────────────────────────────────────────────────── */
  /* Entity review actions                                                   */
  /* ────────────────────────────────────────────────────────────────────── */

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
        setPseudonimizzatoText((cur) =>
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

  const ensureLocalMapper = (currentEntities: ReviewEntity[]): PseudonymMapper => {
    if (localMapperRef.current !== null) return localMapperRef.current
    let mapper: PseudonymMapper
    if (
      active?.mapper instanceof PseudonymMapper &&
      active.mapper.language === language
    ) {
      mapper = active.mapper
    } else {
      mapper = new PseudonymMapper({ language })
      const seedEntries = currentEntities
        .filter((e) => e.isPreserved !== true && e.status !== 'falsePositive')
        .map((e) => ({
          pseudonym: e.pseudonym,
          realValue: e.realValue,
          category: e.category,
        }))
      if (seedEntries.length > 0) mapper.seedFromEntries(seedEntries)
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
      if (pseudonym && pseudonym !== target.realValue) {
        setPseudonimizzatoText((cur) =>
          cur.split(target.realValue).join(pseudonym),
        )
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

  const handleManualAnnotate = (
    start: number,
    end: number,
    category: ManualCategory,
  ) => {
    if (!originaleText) return
    if (start >= end || start < 0 || end > originaleText.length) return
    const mapper = ensureLocalMapper(entities)
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
        originaleText,
        start,
        end,
        category,
        mapper,
        baseEntries,
      )
    } catch {
      return
    }
    if (result.pseudonymizedText === '') return
    setPseudonimizzatoText(result.pseudonymizedText)
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

  /* ────────────────────────────────────────────────────────────────────── */
  /* Save mapping                                                            */
  /* ────────────────────────────────────────────────────────────────────── */

  const canSave =
    user !== null &&
    entities.length > 0 &&
    (user.tier === 'free' || masterKey !== null)

  // Auto-genera etichetta "Mapping del DD/MM/YYYY HH:MM" (founder ratifica
  // SID-20260530: niente form etichetta sul flusso primario, l'utente non viene
  // più interrotto al primo salvataggio). Pattern Date.toLocaleString IT.
  const generateAutoLabel = useCallback((): string => {
    const now = new Date()
    const stamp = now.toLocaleString('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
    return `${t('wireframe.save.autoLabelPrefix')} ${stamp}`
  }, [t])

  // Core save routine — usata sia dal click manuale che dall'auto-save effect.
  // `silent=true` salta status banner / flash (per auto-save: niente rumore visivo).
  const doSave = useCallback(
    async (opts: { silent?: boolean } = {}): Promise<void> => {
      if (!user) {
        setSaveError(t('wireframe.save.errorAnon'))
        return
      }
      if (user.tier === 'pro' && !masterKey) {
        setSaveError(t('wireframe.save.errorMasterKey'))
        return
      }
      if (!opts.silent) {
        setSaveStatus('saving')
      }
      setSaveError(null)
      try {
        const entriesToSave: MappingEntry[] = entities.map((e) => ({
          pseudonym: e.pseudonym,
          realValue: e.realValue,
          category: e.category,
          isFalsePositive: e.status === 'falsePositive',
        }))
        const finalEntries = active
          ? mergeEntries(active.entries, entriesToSave)
          : entriesToSave
        const label = active?.label ?? generateAutoLabel()
        await saveActive(label, finalEntries)
        setLastSavedAt(Date.now())
        if (!opts.silent) {
          setSaveStatus('saved')
          setFlashSaved(true)
          window.setTimeout(() => setFlashSaved(false), 1500)
          window.setTimeout(() => setSaveStatus('idle'), 2500)
        }
      } catch (err) {
        setSaveStatus('error')
        const msg =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : t('wireframe.save.errorGeneric')
        setSaveError(msg)
      }
    },
    [active, entities, generateAutoLabel, masterKey, saveActive, t, user],
  )

  const onSaveClick = useCallback((): void => {
    void doSave({ silent: false })
  }, [doSave])

  // Toggle autosave (persisted in localStorage). Quando ON, ogni cambio entities
  // triggera un save silenzioso. Bottone Salva resta visibile ma disabled.
  const onToggleAutoSave = useCallback((checked: boolean): void => {
    setAutoSaveEnabled(checked)
    try {
      window.localStorage.setItem(
        'recodeit:autoSaveMapping',
        checked ? '1' : '0',
      )
    } catch {
      /* localStorage non disponibile (incognito strict): toggle resta valido in memoria */
    }
  }, [])

  // Auto-save effect — quando il toggle è ON e l'utente è loggato con entities
  // popolate, ogni mutazione di entities triggera un salvataggio silenzioso
  // (con piccolo debounce per evitare burst durante import multi-doc).
  useEffect(() => {
    if (!autoSaveEnabled) return
    if (!user) return
    if (entities.length === 0) return
    if (user.tier === 'pro' && !masterKey) return
    const timer = window.setTimeout(() => {
      void doSave({ silent: true })
    }, 600)
    return () => window.clearTimeout(timer)
  }, [autoSaveEnabled, entities, user, masterKey, doSave])

  // Banner rinomina — open/confirm/cancel handlers.
  const onRenameOpen = useCallback((): void => {
    if (!active) return
    setRenameInput(active.label)
    setRenameOpen(true)
  }, [active])

  const onRenameConfirm = useCallback((): void => {
    const trimmed = renameInput.trim()
    if (!trimmed) return
    renameActive(trimmed)
    setRenameOpen(false)
  }, [renameActive, renameInput])

  const onRenameCancel = useCallback((): void => {
    setRenameOpen(false)
  }, [])

  /* ────────────────────────────────────────────────────────────────────── */
  /* Decodifica unlock handlers                                              */
  /* ────────────────────────────────────────────────────────────────────── */

  const handleBearerValidate = useCallback(async () => {
    const trimmed = bearerInput.trim()
    setBearerError(null)
    if (!trimmed || !trimmed.startsWith('mhc_live_')) {
      setBearerError(t('decodifica.locked.bearerFormatInvalid'))
      return
    }
    setBearerValidating(true)
    try {
      await claimReverseSubstitutionByBearer(trimmed)
      await refreshReverseSubstitution()
      setBearerInput('')
      setBearerInputVisible(false)
      // Re-decode full output now that we are paid tier
      if (mode === 'decodifica' && pseudonimizzatoText) {
        const result = applyReverseSubstitution(
          pseudonimizzatoText,
          active?.entries ?? [],
        )
        setOriginaleText(result.output)
        setDecodificaTruncated(false)
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setBearerError(
          err.status === 401
            ? t('decodifica.locked.bearerInvalid')
            : err.status === 400
              ? t('decodifica.locked.bearerFormatInvalid')
              : t('decodifica.locked.bearerError'),
        )
      } else {
        setBearerError(t('decodifica.locked.errorGeneric'))
      }
    } finally {
      setBearerValidating(false)
    }
  }, [
    bearerInput,
    refreshReverseSubstitution,
    t,
    mode,
    pseudonimizzatoText,
    active,
  ])

  const handlePayStripeCTA = useCallback(async () => {
    setBearerError(null)
    setStripeOpening(true)
    try {
      const resp = await claimReverseSubstitutionCheckout()
      if (resp.already_granted) {
        await refreshReverseSubstitution()
        setStripeOpening(false)
        return
      }
      if (!resp.checkout_url) {
        setBearerError(t('decodifica.locked.errorGeneric'))
        setStripeOpening(false)
        return
      }
      window.location.href = resp.checkout_url
    } catch {
      setBearerError(t('decodifica.locked.errorGeneric'))
      setStripeOpening(false)
    }
  }, [refreshReverseSubstitution, t])

  /* ────────────────────────────────────────────────────────────────────── */
  /* Render derivatives                                                      */
  /* ────────────────────────────────────────────────────────────────────── */

  // Pseudonimizza/Decodifica button disabled when input side is empty
  const inputContent =
    mode === 'codifica' ? originaleText : pseudonimizzatoText
  const actionDisabled =
    !inputContent.trim() ||
    nerStatus === 'loading' ||
    nerStatus === 'running'

  // Decodifica free-tier preview affordance visibility
  const tier = user?.tier ?? null
  const isFreeTierWithoutGrant = !granted && tier !== 'pro'
  const showDecodificaFreeAffordance =
    mode === 'decodifica' &&
    isFreeTierWithoutGrant &&
    hasRunDecodifica &&
    !!originaleText.trim()

  const showLockedDecodificaCTA =
    mode === 'decodifica' && isFreeTierWithoutGrant && !user

  const visibleEntityCount = entities.filter(
    (e) => e.status === 'pending' || e.status === 'accepted',
  ).length
  const pendingEntityCount = entities.filter(
    (e) => e.status === 'pending',
  ).length

  /* Conteggio entità preserved per category Pass-2 (founder SID-20260530).
     Solo categorie NON già attive nel dropdown "sostituisci anche". Mapping
     entity category → dropdown key: citta/via → places; azienda/organizzazione
     → organizations; tribunale → courts. Esclude falsePositive. Il risultato
     guida sia il rendering del suggerimento inline sia la disabilitazione
     quando l'utente attiva manualmente la category dal dropdown (in tal caso
     il key sparisce dalle preservedCounts perché il filtro `sostituisciAnche.has(key)`
     lo rimuove). */
  const preservedSuggestions = useMemo(() => {
    const counts: Record<'places' | 'organizations' | 'courts', number> = {
      places: 0,
      organizations: 0,
      courts: 0,
    }
    for (const e of entities) {
      if (e.isPreserved !== true || e.status === 'falsePositive') continue
      const cat = e.category.toLowerCase()
      let key: 'places' | 'organizations' | 'courts' | null = null
      if (cat === 'citta' || cat === 'città' || cat === 'via' || cat === 'luogo') {
        key = 'places'
      } else if (cat === 'azienda' || cat === 'organizzazione') {
        key = 'organizations'
      } else if (cat === 'tribunale') {
        key = 'courts'
      }
      if (key === null) continue
      if (sostituisciAnche.has(key)) continue
      counts[key]++
    }
    const entries: Array<{
      key: 'places' | 'organizations' | 'courts'
      count: number
    }> = []
    if (counts.places > 0 && !dismissedSuggestions.has('places')) {
      entries.push({ key: 'places', count: counts.places })
    }
    if (
      counts.organizations > 0 &&
      !dismissedSuggestions.has('organizations')
    ) {
      entries.push({ key: 'organizations', count: counts.organizations })
    }
    if (counts.courts > 0 && !dismissedSuggestions.has('courts')) {
      entries.push({ key: 'courts', count: counts.courts })
    }
    return entries
  }, [entities, sostituisciAnche, dismissedSuggestions])

  const tokens = useMemo(() => {
    const set = new Set<string>()
    for (const e of entities) {
      if (e.status !== 'falsePositive' && e.isPreserved !== true) {
        set.add(e.pseudonym)
      }
    }
    return Array.from(set)
  }, [entities])

  /* ────────────────────────────────────────────────────────────────────── */
  /* Render                                                                  */
  /* ────────────────────────────────────────────────────────────────────── */

  return (
    <div
      className="wireframe-workarea"
      data-testid="wireframe-workarea"
      data-decodifica-truncated={decodificaTruncated ? 'true' : 'false'}
    >
      {/* ── 2-macro toggle ────────────────────────────────────────────── */}
      <div
        className="wireframe-macro-row"
        role="tablist"
        aria-label={t('macro.ariaLabel')}
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'codifica'}
          className={`wireframe-macro-btn${mode === 'codifica' ? ' is-active' : ''}`}
          onClick={() => setMode('codifica')}
          data-testid="wireframe-macro-codifica"
        >
          {t('macro.codifica')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'decodifica'}
          className={`wireframe-macro-btn${mode === 'decodifica' ? ' is-active' : ''}`}
          onClick={() => setMode('decodifica')}
          data-testid="wireframe-macro-decodifica"
        >
          {t('macro.decodifica')}
        </button>
      </div>

      {/* ── Toolbar: PSEUDONIMIZZA/DECODIFICA + sostituisci anche ──────── */}
      <div className="wireframe-toolbar">
        <button
          type="button"
          className="wireframe-action-btn"
          onClick={() => {
            if (mode === 'codifica') {
              void handlePseudonimizza()
            } else {
              handleDecodifica()
            }
          }}
          disabled={actionDisabled}
          data-testid="wireframe-action-btn"
        >
          <span className="wireframe-arrow">
            {mode === 'codifica' ? '→' : '←'}
          </span>
          <span className="wireframe-action-label">
            {mode === 'codifica'
              ? nerStatus === 'loading'
                ? t('pseudo.button.loading')
                : nerStatus === 'running'
                  ? t('pseudo.button.running')
                  : t('wireframe.action.pseudonimize')
              : t('wireframe.action.decodifica')}
          </span>
          <span className="wireframe-arrow">
            {mode === 'codifica' ? '→' : '←'}
          </span>
        </button>

        {mode === 'decodifica' && (
          /* BundleBanner inline — slot ESATTAMENTE simmetrico a
             ".wireframe-modifier-row"/".wireframe-modifier-btn" (codifica side).
             Founder direttiva SID-20260527-181552: position locked here, NON
             si muove. Visual: bar sottile centered, palette RegIA verde
             (mirror del modifier-btn grigio del lato codifica). Sostituisce
             il mount precedente sopra AppHeader (src/App.tsx, ora rimosso). */
          <BundleBanner variant="inline" />
        )}

        {mode === 'codifica' && (
          <div className="wireframe-modifier-row">
            <button
              type="button"
              className={`wireframe-modifier-btn${
                isMappingActive ? ' wireframe-modifier-btn--locked' : ''
              }`}
              onClick={(e) => {
                e.stopPropagation()
                setSostituisciAncheOpen((v) => !v)
              }}
              aria-label={
                isMappingActive
                  ? 'sostituisci anche — categorie fissate, clicca per vedere'
                  : t('wireframe.modifier.label')
              }
              data-testid="wireframe-modifier-btn"
              data-locked={isMappingActive ? 'true' : 'false'}
            >
              <span>
                {isMappingActive
                  ? t('wireframe.modifier.btn.locked')
                  : t('wireframe.modifier.label')}
              </span>
              {!isMappingActive && sostituisciAnche.size > 0 && (
                <span className="wireframe-modifier-count">
                  {sostituisciAnche.size}
                </span>
              )}
              <span className="wireframe-chevron" aria-hidden>
                ▾
              </span>
            </button>
            {sostituisciAncheOpen && (
              <div
                className={`wireframe-modifier-dropdown${
                  isMappingActive ? ' wireframe-modifier-dropdown--locked' : ''
                }`}
                role={isMappingActive ? 'region' : 'menu'}
                aria-label={
                  isMappingActive
                    ? 'sostituisci anche — categorie fissate'
                    : t('wireframe.modifier.label')
                }
                data-testid="wireframe-modifier-dropdown"
                data-locked={isMappingActive ? 'true' : 'false'}
              >
                {/* Stato locked (founder SID-20260531 ripristino pattern
                    fe283d4 con copy dual-model 2026-05-31):
                    microcopy SOPRA i toggle con copy dual-model verbatim,
                    toggle visibili ma disabled + greyed, Applica nascosto,
                    link CTA "Ricomincia con un nuovo documento" SOTTO. La
                    condition è isMappingActive = active !== null &&
                    active.entries.length > 0 (estesa al caso in-session
                    post-PSEUDONIMIZZA). */}
                {isMappingActive && (
                  <div
                    className="wireframe-modifier-locked-banner"
                    data-testid="wireframe-modifier-locked-banner"
                  >
                    {(() => {
                      /* 3-blocchi + "Mappa" link cliccabile (founder direttiva
                         SID-20260601-085130). Render decomposto via JSX (NON
                         HTML-in-i18n) per restare coerenti con la convenzione
                         translations.ts text-only. Click su "Mappa" esegue
                         smooth scroll a #mappa-pseudonimi + pulse animation
                         1.5s come indizio visivo dell'arrivo. */
                      const scrollToMap = (): void => {
                        const el = document.getElementById('mappa-pseudonimi')
                        if (!el) return
                        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
                        el.classList.add('mappa-pseudonimi--highlight-pulse')
                        window.setTimeout(() => {
                          el.classList.remove('mappa-pseudonimi--highlight-pulse')
                        }, 1500)
                      }
                      const applyLabel = t('wireframe.modifier.applyBtn')
                      const pseudoLabel = t('pseudo.button.pseudonimize')
                      const mapLabel = t('wireframe.modifier.lockedBanner.mapLink')
                      const line2Body = t('wireframe.modifier.lockedBanner.line2.body')
                      const line2Parts = line2Body.split('{0}')
                      const line3 = t('wireframe.modifier.lockedBanner.line3')
                      // line3 contiene tre placeholder {0}, {1}, {2}.
                      const line3Parts: string[] = []
                      let rest = line3
                      for (const ph of ['{0}', '{1}', '{2}']) {
                        const idx = rest.indexOf(ph)
                        if (idx === -1) {
                          line3Parts.push(rest)
                          rest = ''
                          break
                        }
                        line3Parts.push(rest.slice(0, idx))
                        rest = rest.slice(idx + ph.length)
                      }
                      if (rest) line3Parts.push(rest)
                      return (
                        <>
                          <p className="wireframe-modifier-locked-banner__line">
                            {t('wireframe.modifier.lockedBanner.line1')}
                          </p>
                          <p className="wireframe-modifier-locked-banner__line">
                            <strong>{t('wireframe.modifier.lockedBanner.line2.q')}</strong>
                            {' '}
                            {line2Parts[0]}
                            <strong>{applyLabel}</strong>
                            {line2Parts[1] ?? ''}
                          </p>
                          <p className="wireframe-modifier-locked-banner__line">
                            {line3Parts[0]}
                            <strong>{'✕'}</strong>
                            {line3Parts[1] ?? ''}
                            <button
                              type="button"
                              className="wireframe-modifier-locked-banner__map-link"
                              onClick={scrollToMap}
                              data-testid="wireframe-modifier-locked-banner-map-link"
                            >
                              {mapLabel}
                            </button>
                            {line3Parts[2] ?? ''}
                            <strong>{pseudoLabel}</strong>
                            {line3Parts[3] ?? ''}
                          </p>
                        </>
                      )
                    })()}
                  </div>
                )}
                {SOSTITUISCI_ANCHE_CATEGORIES.map(({ key, labelKey }) => (
                  <label key={key} className="wireframe-modifier-option">
                    <input
                      type="checkbox"
                      checked={sostituisciAnche.has(key)}
                      disabled={isApplyingModifiers}
                      onChange={(e) => {
                        setSostituisciAnche((prev) => {
                          const next = new Set(prev)
                          if (e.target.checked) next.add(key)
                          else next.delete(key)
                          return next
                        })
                      }}
                      data-testid={`wireframe-modifier-${key}`}
                    />
                    {/* SID-20260531 founder direttiva — in stato locked
                        (isMappingActive), il toggle resta editabile ma la
                        label diventa "Nuovi/Nuove X" con prefix in rosso
                        desaturato (#a55a5a) per segnalare che la scelta
                        si applica solo alle entità NUOVE; storia mappa
                        preserved da mergeEntries (b15894a). Split prefix/rest
                        evita HTML embedded in i18n. */}
                    {isMappingActive ? (
                      <span>
                        <span className="wireframe-modifier-option-new">
                          {t(`${labelKey}.newPrefix`)}
                        </span>{' '}
                        {t(`${labelKey}.newRest`)}
                      </span>
                    ) : (
                      t(labelKey)
                    )}
                  </label>
                ))}
                {/* SID-20260528-manual + SID-20260531: bottone Applica
                   sempre visibile (anche in stato locked) per supportare la
                   ratifica founder 2026-05-31 dual-model — i toggle locked
                   sono editabili e devono poter essere APPLICATI alle entità
                   nuove. Click triggera rerun pseudonimizzazione con i nuovi
                   flag (`sostituisciAnche` letto da handlePseudonimizza come
                   `enabledPass2Labels` / `enabledGatedDetectors`). La storia
                   sostituzioni esistente è protetta da mergeEntries (b15894a).
                   SID-20260530 triplo feedback visivo: spinner + label
                   "Applicazione in corso…" + disabled, checkbox disabled
                   durante, flash verde 1s sul pannello pseudonimizzato. */}
                <div className="wireframe-modifier-actions">
                  <button
                    type="button"
                    className={`wireframe-modifier-apply-btn${
                      isApplyingModifiers ? ' is-applying' : ''
                    }`}
                    onClick={async () => {
                      if (isApplyingModifiers) return
                      setIsApplyingModifiers(true)
                      try {
                        await handlePseudonimizza()
                      } finally {
                        setIsApplyingModifiers(false)
                        setSostituisciAncheOpen(false)
                        if (flashPseudoTimerRef.current !== null) {
                          window.clearTimeout(flashPseudoTimerRef.current)
                        }
                        setFlashPseudoPanel(true)
                        flashPseudoTimerRef.current = window.setTimeout(
                          () => setFlashPseudoPanel(false),
                          1000,
                        )
                      }
                    }}
                    disabled={isApplyingModifiers}
                    data-testid="wireframe-modifier-apply-btn"
                    aria-busy={isApplyingModifiers}
                  >
                    {isApplyingModifiers && (
                      <span
                        className="wireframe-modifier-apply-spinner"
                        aria-hidden
                      />
                    )}
                    <span>
                      {isApplyingModifiers
                        ? t('wireframe.modifier.applyingBtn')
                        : t('wireframe.modifier.applyBtn')}
                    </span>
                  </button>
                </div>
                {isMappingActive && (
                  /* CTA Ricomincia — visibile in stato locked SOTTO Applica
                     (azione secondaria). Border-top dashed leggero per
                     separazione visiva dall'Apply. Equivalente a "Nuovo
                     documento" + "Elimina mapping": closeActive() + reset
                     input/output + reset entities + reset sostituisciAnche.
                     Dopo il click il dropdown si chiude e l'utente è fresh. */
                  <div className="wireframe-modifier-restart-row">
                    <button
                      type="button"
                      className="wireframe-modifier-restart-link"
                      onClick={() => {
                        closeActive()
                        setOriginaleText('')
                        setPseudonimizzatoText('')
                        setEntities([])
                        setHasRunOnCurrentDoc(false)
                        setEntityReviewOpen(false)
                        setSostituisciAnche(new Set())
                        setSostituisciAncheOpen(false)
                      }}
                      data-testid="wireframe-modifier-restart-link"
                    >
                      {t('wireframe.modifier.restartLink')}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Save group (Codifica only) — Krug-style ratifica founder
            SID-20260530: bottone Salva PRIMARY grande + toggle autosave inline
            sopra + micro-istruzione sotto. Niente form etichetta: l'etichetta
            viene auto-generata "Mapping del DD/MM/YYYY HH:MM" al primo save;
            rinomina vive nel banner Mapping attivo come link minuscolo. */}
        {mode === 'codifica' && user && entities.length > 0 && (
          <div
            className="wireframe-save-group"
            data-testid="wireframe-save-group"
          >
            <div
              className="wireframe-save-section-heading"
              data-testid="wireframe-save-section-heading"
            >
              {t('wireframe.save.sectionHeading')}
            </div>
            <label className="wireframe-save-autosave-toggle">
              <input
                type="checkbox"
                checked={autoSaveEnabled}
                onChange={(e) => onToggleAutoSave(e.target.checked)}
                data-testid="wireframe-save-autosave-toggle"
              />
              <span>{t('wireframe.save.autoSaveLabel')}</span>
            </label>
            <button
              type="button"
              className="wireframe-save-btn-primary"
              onClick={onSaveClick}
              disabled={
                !canSave || saveStatus === 'saving' || autoSaveEnabled
              }
              data-testid="wireframe-save-btn"
              title={
                user.tier === 'pro' && !masterKey
                  ? t('wireframe.save.errorMasterKey')
                  : user.tier === 'free'
                    ? t('wireframe.save.tooltipFree')
                    : t('wireframe.save.tooltipPro')
              }
            >
              {saveStatus === 'saving'
                ? t('pseudo.save.saving')
                : saveStatus === 'saved'
                  ? t('pseudo.save.saved')
                  : t('wireframe.save.primary')}
            </button>
            <div
              className="wireframe-save-hint"
              data-testid="wireframe-save-hint"
            >
              {autoSaveEnabled
                ? t('wireframe.save.autoSaveDisabledHint')
                : t('wireframe.save.manualHint')}
            </div>
          </div>
        )}
      </div>

      {saveError && (
        <div className="error" role="alert" data-testid="wireframe-save-error">
          {saveError}
        </div>
      )}

      {nerStatus === 'loading' && loadProgress && (
        <ModelLoadingState
          phase={loadProgress.phase}
          loaded={loadProgress.loaded}
          total={loadProgress.total}
        />
      )}

      {pseudoError && (
        <div className="error" role="alert" data-testid="wireframe-pseudo-error">
          {pseudoError}
        </div>
      )}

      {partialNotice && (
        <div
          className="banner banner--warning"
          role="status"
          data-testid="wireframe-partial-banner"
        >
          <strong>{t('pseudo.partial.title')}</strong>{' '}
          {partialNotice.failedRanges.length}{' '}
          {partialNotice.failedRanges.length === 1
            ? t('pseudo.partial.singular')
            : t('pseudo.partial.plural')}{' '}
          {t('pseudo.partial.body')} {t('pseudo.partial.manualHint')}
        </div>
      )}

      {/* ── Decodifica output warning (in unlocked or just-run state) ─── */}
      {mode === 'decodifica' && hasRunDecodifica && originaleText && (
        <div
          className="banner banner--warning"
          role="status"
          data-testid="wireframe-decodifica-warning"
        >
          <strong>{t('decodifica.outputWarning.title')}</strong>{' '}
          {t('decodifica.outputWarning.body')}
        </div>
      )}

      {/* ── 2 panels side-by-side ─────────────────────────────────────── */}
      <div className="wireframe-panels">
        {/* SX: Originale */}
        <div
          className={`wireframe-panel wireframe-panel--originale${dragOver && mode === 'codifica' ? ' wireframe-panel--dragover' : ''}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          data-testid="wireframe-panel-originale"
        >
          <div className="wireframe-panel__label">{t('wireframe.panel.originale')}</div>
          {/* Copia output a un click (Fix 1) — Decodifica: il testo
              decodificato (nomi reali) atterra qui nel pannello originale.
              Bottone floating top-left (".wireframe-new-doc-btn" sta top-right
              ma è codifica-only → nessuna collisione), mostrato solo in
              Decodifica quando c'è output e l'utente ha eseguito la decodifica. */}
          {mode === 'decodifica' && hasRunDecodifica && originaleText && (
            <div className="wireframe-output-actions">
              <button
                type="button"
                className="wireframe-copy-btn"
                onClick={() => void handleCopyDecoded()}
                data-testid="wireframe-copy-decodificato-btn"
                title={t('wireframe.copy.titleDecoded')}
              >
                {copyDecodedState === 'copied'
                  ? t('wireframe.copy.done')
                  : t('wireframe.copy.button')}
              </button>
              <button
                type="button"
                className="wireframe-export-btn"
                onClick={() => void handleExportDecodedWord()}
                data-testid="wireframe-export-decodificato-word-btn"
                title={t('wireframe.export.word.titleDecoded')}
              >
                {t('wireframe.export.word.button')}
              </button>
              <button
                type="button"
                className="wireframe-export-btn"
                onClick={() => handleExportDecodedPdf()}
                data-testid="wireframe-export-decodificato-pdf-btn"
                title={t('wireframe.export.pdf.titleDecoded')}
              >
                {t('wireframe.export.pdf.button')}
              </button>
            </div>
          )}
          {showDecodificaFreeAffordance && (
            <div
              className="wireframe-preview-banner"
              data-testid="wireframe-preview-banner"
            >
              <span className="wireframe-preview-badge">
                {t('wireframe.preview.badge')}
              </span>
              <span>
                {t('wireframe.preview.text').replace(
                  '{n}',
                  String(DECODIFICA_PREVIEW_LIMIT),
                )}
              </span>
            </div>
          )}
          <div className="wireframe-panel__body">
            {mode === 'codifica' && !originaleText && (
              <>
                <button
                  type="button"
                  className="wireframe-upload-pill"
                  onClick={() => fileInputRef.current?.click()}
                  title=".txt · .md · .docx · .pdf"
                  data-testid="wireframe-upload-pill"
                >
                  {t('wireframe.upload.pill')}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.md,.docx,.pdf,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={handleFileInput}
                  style={{ display: 'none' }}
                  data-testid="wireframe-file-input"
                />
              </>
            )}

            {/* When document is loaded AND in codifica mode, show DocumentView
                (highlighted entities inline) instead of textarea — but only
                after pseudonymize run; otherwise plain editable textarea. */}
            {mode === 'codifica' && originaleText && hasRunOnCurrentDoc ? (
              <DocumentView
                originalText={originaleText}
                pseudonymizedText={pseudonimizzatoText}
                entities={entities}
                displayMode="originale"
                onAccept={handleAccept}
                onFalsePositive={handleFalsePositive}
                onChangeCategory={handleChangeCategory}
                onSubstituteAnyway={handleSubstituteAnyway}
                onManualAnnotate={handleManualAnnotate}
                hideManualHint
              />
            ) : (
              <textarea
                className="wireframe-textarea"
                value={originaleText}
                onChange={(e) => {
                  if (mode === 'codifica') setOriginaleText(e.target.value)
                }}
                disabled={mode !== 'codifica'}
                placeholder={
                  mode === 'codifica'
                    ? t('wireframe.placeholder.originale.codifica')
                    : t('wireframe.placeholder.originale.decodifica')
                }
                data-testid="wireframe-textarea-originale"
                rows={10}
              />
            )}

            {/* New document affordance — discreet, top-right of the originale panel
                when a document is loaded. */}
            {mode === 'codifica' && originaleText && (
              <button
                type="button"
                className="wireframe-new-doc-btn"
                onClick={() => {
                  setOriginaleText('')
                  setPseudonimizzatoText('')
                  setHasRunOnCurrentDoc(false)
                  setEntityReviewOpen(false)
                }}
                data-testid="wireframe-new-doc-btn"
                title={t('pseudo.button.newDocumentTitle')}
              >
                {t('wireframe.newDoc.button')}
              </button>
            )}
          </div>

          {/* Suggerimento "luoghi preservati" (founder SID-20260530).
              Visibile in Codifica dopo un run, quando ci sono entità Pass-2
              preserved per categorie OFF nel dropdown "sostituisci anche".
              Posizione: tra il pannello originale (sx) e la review-list
              expandable — l'utente vede sulla mappa le entità evidenziate
              ma non sostituite, scrolla un filo e trova il suggerimento.
              Click su "Sì, includi X" → adds key al Set + chiama
              handlePseudonimizza() (stesso path di Applica del dropdown,
              incluso spinner + flash verde feedback). Dismiss ephemeral. */}
          {mode === 'codifica' &&
            hasRunOnCurrentDoc &&
            preservedSuggestions.length > 0 && (
              <div
                className="wireframe-preserved-suggestion"
                role="region"
                aria-label={t('wireframe.suggestion.aria')}
                data-testid="wireframe-preserved-suggestion"
              >
                <div className="wireframe-preserved-suggestion__text">
                  {preservedSuggestions.length === 1 && preservedSuggestions[0] ? (
                    <>
                      <strong>
                        {t('wireframe.suggestion.singleLead')
                          .replace('{count}', String(preservedSuggestions[0]!.count))
                          .replace(
                            '{label}',
                            t(
                              `wireframe.suggestion.label.${preservedSuggestions[0]!.key}`,
                            ),
                          )}
                      </strong>{' '}
                      {t('wireframe.suggestion.singleTail').replace(
                        '{label}',
                        t(
                          `wireframe.suggestion.toggleLabel.${preservedSuggestions[0]!.key}`,
                        ),
                      )}
                    </>
                  ) : (
                    <>
                      <strong>{t('wireframe.suggestion.multiLead')}</strong>{' '}
                      {preservedSuggestions
                        .map(
                          (s) =>
                            `${s.count} ${t(
                              `wireframe.suggestion.label.${s.key}`,
                            )}`,
                        )
                        .join(' · ')}
                      . {t('wireframe.suggestion.multiTail')}
                    </>
                  )}
                </div>
                <div className="wireframe-preserved-suggestion__actions">
                  {preservedSuggestions.map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      className="wireframe-preserved-suggestion__btn"
                      disabled={isApplyingModifiers}
                      aria-busy={isApplyingModifiers}
                      data-testid={`wireframe-preserved-suggestion-include-${s.key}`}
                      onClick={async () => {
                        if (isApplyingModifiers) return
                        const newKey = s.key
                        // Update toggle state for UI consistency (chip /
                        // dropdown reflects "Luoghi" now ON) — async,
                        // committed nel next render.
                        setSostituisciAnche((prev) => {
                          const next = new Set(prev)
                          next.add(newKey)
                          return next
                        })
                        setIsApplyingModifiers(true)
                        try {
                          // Pass extraKeys esplicitamente: il setState sopra è
                          // async e runRegexOnly leggerebbe il vecchio set dalla
                          // closure del render corrente. extraKeys garantisce
                          // che la run includa newKey nello stesso tick.
                          // Bug fix 2026-06-01 (closure stale).
                          await handlePseudonimizza({
                            extraKeys: new Set([newKey]),
                          })
                        } finally {
                          setIsApplyingModifiers(false)
                          if (flashPseudoTimerRef.current !== null) {
                            window.clearTimeout(flashPseudoTimerRef.current)
                          }
                          setFlashPseudoPanel(true)
                          flashPseudoTimerRef.current = window.setTimeout(
                            () => setFlashPseudoPanel(false),
                            1000,
                          )
                        }
                      }}
                    >
                      {isApplyingModifiers && (
                        <span
                          className="wireframe-preserved-suggestion__spinner"
                          aria-hidden
                        />
                      )}
                      <span>
                        {preservedSuggestions.length === 1
                          ? t('wireframe.suggestion.includeBtnSingle').replace(
                              '{label}',
                              t(`wireframe.suggestion.articled.${s.key}`),
                            )
                          : t('wireframe.suggestion.includeBtnMulti').replace(
                              '{label}',
                              t(
                                `wireframe.suggestion.toggleLabel.${s.key}`,
                              ),
                            )}
                      </span>
                    </button>
                  ))}
                  <button
                    type="button"
                    className="wireframe-preserved-suggestion__dismiss"
                    aria-label={t('wireframe.suggestion.dismissAria')}
                    title={t('wireframe.suggestion.dismissAria')}
                    data-testid="wireframe-preserved-suggestion-dismiss"
                    onClick={() => {
                      setDismissedSuggestions((prev) => {
                        const next = new Set(prev)
                        for (const s of preservedSuggestions) {
                          next.add(s.key)
                        }
                        return next
                      })
                    }}
                  >
                    ×
                  </button>
                </div>
              </div>
            )}

          {/* Entity review expandable (Codifica only, after run) */}
          {mode === 'codifica' && hasRunOnCurrentDoc && entities.length > 0 && (
            <details
              className="wireframe-entity-review"
              open={entityReviewOpen}
              onToggle={(e) =>
                setEntityReviewOpen((e.target as HTMLDetailsElement).open)
              }
              data-testid="wireframe-entity-review"
            >
              <summary>
                <strong>{t('wireframe.entityReview.heading')}</strong>{' '}
                ({visibleEntityCount}
                {pendingEntityCount > 0 ? (
                  <>
                    {' '}
                    ·{' '}
                    <span className="wireframe-entity-review__pending">
                      {pendingEntityCount}{' '}
                      {t('wireframe.entityReview.pending')}
                    </span>
                  </>
                ) : null}
                )
              </summary>
              <EntityReviewList
                entities={entities}
                onAccept={handleAccept}
                onChangeCategory={handleChangeCategory}
                onFalsePositive={handleFalsePositive}
                onSubstituteAnyway={handleSubstituteAnyway}
              />
            </details>
          )}
        </div>

        {/* DX: Pseudonimizzato */}
        <div
          className={`wireframe-panel wireframe-panel--pseudonimizzato${
            flashPseudoPanel ? ' wireframe-panel--flash' : ''
          }`}
          data-testid="wireframe-panel-pseudonimizzato"
        >
          <div className="wireframe-panel__label">
            {t('wireframe.panel.pseudonimizzato')}
          </div>
          <div className="wireframe-panel__body">
            {/* Copia output a un click (Fix 1) — Codifica: il pannello
                pseudonimizzato è l'output. Bottone floating top-left, sopra
                DocumentView/textarea (il padding-top:44px riserva la fascia).
                Il pannello pseudonimizzato non ha new-doc-btn → top-left e
                top-right entrambi liberi, scegliamo top-left per coerenza col
                pannello originale in Decodifica. Scope-reduction f3120ac
                resta: solo Copia (no Word/PDF) — output Codifica è
                intermedio per AI esterna, non deliverable archiviabile. */}
            {mode === 'codifica' && pseudonimizzatoText && (
              <div className="wireframe-output-actions">
                <button
                  type="button"
                  className="wireframe-copy-btn"
                  onClick={() => void handleCopyPseudo()}
                  data-testid="wireframe-copy-pseudonimizzato-btn"
                  title={t('wireframe.copy.titlePseudo')}
                >
                  {copyPseudoState === 'copied'
                    ? t('wireframe.copy.done')
                    : t('wireframe.copy.button')}
                </button>
              </div>
            )}
            {/* In codifica mode after run, show DocumentView (pseudo). In
                decodifica mode, plain editable textarea (user paste AI response). */}
            {mode === 'codifica' && pseudonimizzatoText && hasRunOnCurrentDoc ? (
              <DocumentView
                originalText={originaleText}
                pseudonymizedText={pseudonimizzatoText}
                entities={entities}
                displayMode="pseudonimo"
                onAccept={handleAccept}
                onFalsePositive={handleFalsePositive}
                onChangeCategory={handleChangeCategory}
                onSubstituteAnyway={handleSubstituteAnyway}
                onManualAnnotate={handleManualAnnotate}
              />
            ) : (
              <textarea
                className="wireframe-textarea"
                value={pseudonimizzatoText}
                onChange={(e) => {
                  if (mode === 'decodifica') {
                    setPseudonimizzatoText(e.target.value)
                    setHasRunDecodifica(false)
                  }
                }}
                disabled={mode !== 'decodifica'}
                placeholder={
                  mode === 'codifica'
                    ? t('wireframe.placeholder.pseudonimizzato.codifica')
                    : t('wireframe.placeholder.pseudonimizzato.decodifica')
                }
                data-testid="wireframe-textarea-pseudonimizzato"
                rows={10}
              />
            )}
          </div>
        </div>
      </div>

      {/* ── Decodifica preview CTA (free tier, has output) ────────────── */}
      {showDecodificaFreeAffordance && user && (
        <div
          className="wireframe-decodifica-cta"
          data-testid="wireframe-decodifica-cta"
        >
          <div className="wireframe-decodifica-cta__lead">
            {t('wireframe.decodifica.cta.lead')}
          </div>
          <div className="wireframe-decodifica-cta__actions">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void handlePayStripeCTA()}
              disabled={stripeOpening}
              data-testid="wireframe-decodifica-stripe-btn"
            >
              {stripeOpening
                ? t('decodifica.locked.paymentLoading')
                : t('wireframe.decodifica.cta.stripeBtn')}
            </button>
            <span className="wireframe-decodifica-cta__or">
              {t('wireframe.decodifica.cta.or')}
            </span>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => setBearerInputVisible((v) => !v)}
              data-testid="wireframe-decodifica-bearer-toggle"
            >
              {t('wireframe.decodifica.cta.bearerToggle')}
            </button>
          </div>
          {bearerInputVisible && (
            <div className="wireframe-decodifica-cta__bearer-row">
              <input
                type="text"
                value={bearerInput}
                onChange={(e) => setBearerInput(e.target.value)}
                placeholder={t('decodifica.locked.bearerPlaceholder')}
                className="auth-input"
                disabled={bearerValidating}
                data-testid="wireframe-decodifica-bearer-input"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => void handleBearerValidate()}
                disabled={bearerValidating || bearerInput.trim() === ''}
                data-testid="wireframe-decodifica-bearer-btn"
              >
                {bearerValidating
                  ? t('decodifica.locked.bearerValidating')
                  : t('decodifica.locked.bearerValidate')}
              </button>
            </div>
          )}
          {bearerError && (
            <p
              className="error"
              role="alert"
              data-testid="wireframe-decodifica-bearer-error"
            >
              {bearerError}
            </p>
          )}
        </div>
      )}

      {/* Anonymous user trying Decodifica → sign-in nudge */}
      {showLockedDecodificaCTA && (
        <div
          className="wireframe-decodifica-cta"
          data-testid="wireframe-decodifica-anon"
        >
          <div className="wireframe-decodifica-cta__lead">
            {t('decodifica.locked.notLoggedIn')}
          </div>
        </div>
      )}

      {/* ── Lingua documento row (founder direttiva (c) SID-20260527) ──
          Spostato dall'AppHeader secondary row al slot prototype-canonical
          tra Decodifica CTA e Mappa cards. Zero duplicazione (rimosso da
          App.tsx AppHeader contestualmente). FR/DE marcate "(in arrivo)"
          disabled per Phase 2/3 NER procurement pending. */}
      <div className="wireframe-lang-row">
        <label className="wireframe-lang-cell">
          <span className="wireframe-lang-label">{t('lang.doc.label')}</span>
          <select
            id="app-doc-lang-select"
            data-testid="app-doc-lang-select"
            className="wireframe-lang-select"
            value={language}
            onChange={(e) => setDocLanguage(e.target.value as Language)}
          >
            {SUPPORTED_LANGUAGES.map((lng) => {
              const isUnavailable = lng === 'fr' || lng === 'de'
              const baseLabel = `${lng.toUpperCase()} — ${t(`lang.doc.option.${lng}`)}`
              return (
                <option key={lng} value={lng} disabled={isUnavailable}>
                  {isUnavailable ? `${baseLabel} (in arrivo)` : baseLabel}
                </option>
              )
            })}
          </select>
        </label>
      </div>

      {/* ── Mappa cards ──────────────────────────────────────────────── */}
      <div className="wireframe-mappa-section">
        <div className="wireframe-mappa-cards">
          <button
            type="button"
            className="wireframe-mappa-card"
            data-active={selectedCard === 'locali'}
            onClick={() =>
              setSelectedCard((cur) => (cur === 'locali' ? null : 'locali'))
            }
            data-testid="wireframe-card-locali"
          >
            <div className="wireframe-mappa-card__title">
              {t('wireframe.mappa.locali.title')}
            </div>
            <div className="wireframe-mappa-card__meta">
              {tokens.length === 1
                ? t('wireframe.mappa.locali.metaOne')
                : t('wireframe.mappa.locali.metaMany').replace(
                    '{n}',
                    String(tokens.length),
                  )}
            </div>
          </button>
          <button
            type="button"
            className="wireframe-mappa-card"
            onClick={() => setModalChiaviServerOpen(true)}
            data-testid="wireframe-card-server"
            aria-label={t('wireframe.mappa.server.ariaLabel')}
          >
            <div className="wireframe-mappa-card__title">
              {t('wireframe.mappa.server.title')}
            </div>
            <div className="wireframe-mappa-card__cta">
              {t('wireframe.mappa.server.cta')}
            </div>
          </button>
        </div>

        {/* Detail view — MappaPanel sempre visibile (trick width SID-20260530).
            Il founder cercava un gestalt verticale che il max-width:1400 da solo
            non dava. Il pannello mappa è la "spina" verticale di default; il
            click su "Chiavi locali" / "Chiavi su server" resta funzionale ma
            non condiziona più la presenza/assenza del pannello in fondo.
            Stato "tabella vuota" è gestito internamente da MappaPanel
            (mappa-panel__empty), quindi non serve più un placeholder esterno. */}
        <div
          className="wireframe-mappa-detail"
          id="mappa-pseudonimi"
        >
          <MappaPanel />
        </div>
      </div>

      {/* ── Active mapping banner (cross-doc continuity) ─────────────────
          Founder direttiva SID-20260527: la "bolla" che era duplicata in
          alto (App.tsx AppHeader) "visualizza meglio" — spostata qui al
          posto della versione ridotta wireframe-active-mapping precedente.
          Stesso pattern 3-row visual hierarchy (identity / count or empty
          pill / dirty badge / hint) + Elimina nascosto in stato vuoto
          (Round 1+2 UX-loop SID-20260526 doctrine preservata). */}
      {active && (
        <div
          className={`active-mapping-banner${flashSaved ? ' active-mapping-banner--flash-saved' : ''}`}
          data-testid="active-mapping-banner"
        >
          <div className="active-mapping-banner__identity">
            {t('banner.active.label')}{' '}
            <strong>{active.label}</strong>
            {/* Link minuscolo "Rinomina" — Krug-style ratifica founder
                SID-20260530: unico posto dove sopravvive il prompt etichetta,
                opzionale, fuori dal flusso primario. */}
            <button
              type="button"
              className="active-mapping-banner__rename-link"
              onClick={onRenameOpen}
              data-testid="banner-active-rename-link"
              title={t('banner.active.renameTitle')}
            >
              {t('banner.active.rename')}
            </button>
            {lastSavedAt !== null && (
              <span
                className="active-mapping-banner__saved-at"
                data-testid="banner-active-saved-at"
              >
                {t('banner.active.savedAt').replace(
                  '{time}',
                  new Date(lastSavedAt).toLocaleTimeString('it-IT', {
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
                )}
              </span>
            )}
          </div>
          {renameOpen && (
            <div
              className="active-mapping-banner__rename-form"
              data-testid="banner-active-rename-form"
            >
              <input
                type="text"
                value={renameInput}
                onChange={(e) => setRenameInput(e.target.value)}
                className="auth-input"
                autoFocus
                maxLength={120}
                placeholder={t('banner.active.renamePlaceholder')}
                data-testid="banner-active-rename-input"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    onRenameConfirm()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    onRenameCancel()
                  }
                }}
              />
              <button
                type="button"
                className="btn btn--primary"
                onClick={onRenameConfirm}
                disabled={!renameInput.trim()}
                data-testid="banner-active-rename-confirm"
              >
                {t('banner.active.renameConfirm')}
              </button>
              <button
                type="button"
                className="btn btn--secondary"
                onClick={onRenameCancel}
                data-testid="banner-active-rename-cancel"
              >
                {t('banner.active.renameCancel')}
              </button>
            </div>
          )}
          {active.entries.length === 0 ? (
            <div
              className="active-mapping-banner__count-empty"
              data-testid="banner-active-count"
            >
              {t('banner.active.empty')}
            </div>
          ) : (
            <div
              className="active-mapping-banner__count"
              data-testid="banner-active-count"
            >
              {active.entries.length === 1
                ? t('banner.active.countOne')
                : t('banner.active.countMany').replace(
                    '{n}',
                    String(active.entries.length),
                  )}
            </div>
          )}
          {active.dirty && (
            <div
              className="active-mapping-banner__dirty-badge"
              data-testid="banner-active-dirty"
            >
              {t('banner.active.dirty')}
            </div>
          )}
          <span className="active-mapping-banner__hint">
            {t('banner.active.hint')}
          </span>
          {active.entries.length > 0 && (
            <button
              type="button"
              className="active-mapping-banner__close"
              onClick={() => {
                if (
                  active.dirty &&
                  // eslint-disable-next-line no-alert
                  !window.confirm(t('banner.active.deleteConfirm'))
                ) {
                  return
                }
                closeActive()
              }}
              data-testid="close-active-mapping-btn"
              title={t('banner.active.deleteTitle')}
              aria-label={t('banner.active.deleteAria')}
            >
              {t('banner.active.delete')}
            </button>
          )}
        </div>
      )}

      {/* ── Modal "I miei mapping" (Chiavi su server) ────────────────── */}
      {modalChiaviServerOpen && (
        <div
          className="wireframe-modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setModalChiaviServerOpen(false)
          }}
          data-testid="wireframe-modal-backdrop"
        >
          <div
            className="wireframe-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wireframe-modal-title"
          >
            <div className="wireframe-modal__header">
              <h2 id="wireframe-modal-title">
                {t('wireframe.modal.title')}
              </h2>
              <button
                type="button"
                className="wireframe-modal__close"
                onClick={() => setModalChiaviServerOpen(false)}
                aria-label={t('wireframe.modal.closeAria')}
                data-testid="wireframe-modal-close"
              >
                ×
              </button>
            </div>
            <div className="wireframe-modal__body">
              <p className="wireframe-modal__lead">
                {t('wireframe.modal.lead')}
              </p>
              <div className="wireframe-modal__upsell">
                <div className="wireframe-modal__upsell-status">
                  {t('wireframe.modal.upsell.status')}
                </div>
                <div className="wireframe-modal__upsell-cta">
                  <div className="wireframe-modal__upsell-price">
                    {t('wireframe.modal.upsell.priceLead')}{' '}
                    <strong>{t('wireframe.modal.upsell.priceAmount')}</strong>
                  </div>
                  <p className="wireframe-modal__upsell-details">
                    {t('wireframe.modal.upsell.details')}
                  </p>
                  {/* Parked notice (visible box) — Touchpoint 4 component A.
                      Matches prototype 1:1; alert() still fires on unlock-now
                      click for explicit user feedback. SID-20260527. */}
                  <div
                    className="wireframe-modal__parked-notice"
                    data-testid="wireframe-modal-parked-notice"
                  >
                    ⏳ {t('wireframe.modal.upsell.parkedNotice')}
                  </div>
                  {/* Bundle CTA callout — Touchpoint 4 component B.
                      Cross-link to MHC-L bundle landing: chi sta valutando Pro
                      vede subito che il bundle MHC-L è un percorso parallelo
                      (gratis €0). Canon prototype SID-20260527.
                      NB: NO mention of /mhc-h/ — Authority discipline. */}
                  <div
                    className="wireframe-modal__bundle-cta"
                    data-testid="wireframe-modal-bundle-cta"
                  >
                    <strong>
                      {t('wireframe.modal.upsell.bundleCtaLead')}
                    </strong>{' '}
                    {t('wireframe.modal.upsell.bundleCtaBody')}{' '}
                    <a
                      href="https://micheleloi.pro/mhc-l/"
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid="wireframe-modal-bundle-link"
                    >
                      {t('wireframe.modal.upsell.bundleCtaLink')}
                    </a>
                  </div>
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => {
                      // Pro €25 cloud zero-knowledge currently parked
                      // (post-pivot 2026-05-24/25). Placeholder behavior:
                      // surfaces a friendly notice — eventually wires to
                      // a Pro signup endpoint when reactivated.
                      // eslint-disable-next-line no-alert
                      window.alert(t('wireframe.modal.upsell.parkedNotice'))
                    }}
                    data-testid="wireframe-modal-upsell-btn"
                  >
                    {t('wireframe.modal.upsell.cta')}
                  </button>
                </div>
              </div>
              <p className="wireframe-modal__empty">
                {t('wireframe.modal.empty')}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Scanned PDF modal ────────────────────────────────────────── */}
      {scannedPdfModalOpen && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          data-testid="wireframe-scanned-pdf-modal"
        >
          <div className="modal">
            <h3>{t('wireframe.scannedPdf.title')}</h3>
            <p>{t('wireframe.scannedPdf.body')}</p>
            <div className="actions">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => setScannedPdfModalOpen(false)}
                autoFocus
              >
                {t('wireframe.scannedPdf.ok')}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
