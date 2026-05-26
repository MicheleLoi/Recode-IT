/**
 * PseudonymizePanel — Design C document-first inline annotation surface.
 *
 * Lets the user drop a `.txt` / `.md` / `.docx` / `.pdf` file (or paste text),
 * runs `anonymize()` from the Phase 1 engine, then surfaces the result as a
 * single inline-annotated document view (DocumentView). The textarea +
 * review-list pair from earlier designs is kept available behind a "Vista
 * dettaglio" disclosure for power users / fallback / and to preserve the
 * existing test surface (testids unchanged).
 *
 * File extraction is delegated to `src/extraction/extract.ts`, which routes
 * by extension (DESIGN.md §3). The scanned-PDF edge case (DESIGN.md §10) is
 * handled inline here.
 *
 * Toolbar in the upper region carries:
 *   - the Pseudonimizzato / Originale toggle (DisplayMode)
 *   - the Copia button
 *   - the contextual entity counters banner (N · X da rivedere · Y originali)
 *   - the Recode-panel open button (delegated to parent via prop)
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ChangeEvent,
} from 'react'
import { anonymize } from '../engine/engine'
import { NerRunner } from '../engine/ner_runner'
import { useLanguage } from './LanguageContext'
import type { NerProgressEvent } from '../engine/ner_runner'
import type { PseudonymMapper } from '../engine/pseudonym_mapper'
import type { MappingEntry, NerDetection } from '../types/engine'
import type { ManualCategory } from '../engine/manual_annotate'
import { extractText, SUPPORTED_EXTENSIONS } from '../extraction/extract'
import { EntityReviewList } from './EntityReviewList'
import { ModelLoadingState } from './ModelLoadingState'
import type { ModelLoadPhase } from './ModelLoadingState'
import type { ReviewEntity, SwitchableCategory } from './types'
import { DocumentView } from './DocumentView'
import type { DisplayMode } from './EntityHighlight'
/** localStorage key per la prima entrata in modalità Confronta (micro-toast). */

/**
 * localStorage key for the variante-β toggle preference (opt-in
 * luoghi / organizzazioni / tribunali).
 */
const INCLUDE_PLACES_LS_KEY = 'recode-it:include-places-default'

function readIncludePlacesPref(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false
    return localStorage.getItem(INCLUDE_PLACES_LS_KEY) === 'true'
  } catch {
    return false
  }
}

function writeIncludePlacesPref(value: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(INCLUDE_PLACES_LS_KEY, value ? 'true' : 'false')
  } catch {
    /* private mode / quota — silent */
  }
}

type Props = {
  originalText: string
  pseudonymizedText: string
  entities: ReviewEntity[]
  onResult: (result: {
    originalText: string
    pseudonymizedText: string
    mapping: MappingEntry[]
  }) => void
  onOriginalChange: (text: string) => void
  onAccept: (id: string) => void
  onChangeCategory: (id: string, newCategory: SwitchableCategory) => void
  onFalsePositive: (id: string) => void
  /** Variante β: flip a preserved entity to substituted (per-entity opt-in). */
  onSubstituteAnyway: (id: string) => void
  /** Manual annotation gesture. */
  onManualAnnotate: (start: number, end: number, category: ManualCategory) => void
  seedMapper?: PseudonymMapper | null
  seedFalsePositives?: ReadonlySet<string>
  canSave: boolean
  loggedIn: boolean
  masterKeyAvailable: boolean
  /**
   * User tier for tier-aware Save gate. Free tier persists to IndexedDB
   * plaintext (no master key required); Pro tier persists encrypted to the
   * server and DOES require master key in memory. `null` = not logged in
   * (tooltip falls back to the loggedIn branch).
   */
  tier?: 'free' | 'pro' | null
  saveStatus: 'idle' | 'saving' | 'saved' | 'error'
  saveError: string | null
  labelInputOpen: boolean
  labelInput: string
  onLabelChange: (v: string) => void
  onSaveClick: () => void
  onSaveConfirm: () => void
  onSaveCancel: () => void
  activeLabel: string | null
  onCloseActive: () => void
  /** Design C: open the slide-in recode panel. */
  onOpenRecode?: () => void
  /** Whether the recode panel is currently open (affects toolbar button state). */
  recodeOpen?: boolean
}

const ACCEPTED_EXTENSIONS = SUPPORTED_EXTENSIONS

export function PseudonymizePanel({
  originalText,
  pseudonymizedText,
  entities,
  onResult,
  onOriginalChange,
  onAccept,
  onChangeCategory,
  onFalsePositive,
  onSubstituteAnyway,
  onManualAnnotate,
  seedMapper = null,
  seedFalsePositives,
  canSave,
  loggedIn,
  masterKeyAvailable,
  tier = null,
  saveStatus,
  saveError,
  labelInputOpen,
  labelInput,
  onLabelChange,
  onSaveClick,
  onSaveConfirm,
  onSaveCancel,
  activeLabel,
  onCloseActive,
  onOpenRecode,
  recodeOpen = false,
}: Props): JSX.Element {
  const { docLanguage: language, t } = useLanguage()
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle')
  const [scannedPdfModalOpen, setScannedPdfModalOpen] = useState(false)
  const [includePlaces, setIncludePlaces] = useState<boolean>(() =>
    readIncludePlacesPref(),
  )
  const [partialNotice, setPartialNotice] = useState<{
    failedRanges: Array<[number, number]>
  } | null>(null)
  const [nerStatus, setNerStatus] = useState<
    'idle' | 'loading' | 'running' | 'unavailable'
  >('idle')
  const [loadProgress, setLoadProgress] = useState<{
    phase: ModelLoadPhase
    loaded: number
    total: number
  } | null>(null)
  /**
   * Design C — Pseudonimizzato vs Originale toggle (toolbar).
   *
   * Defaults to 'originale': pre-pseudonimizzazione del documento corrente,
   * l'utente vede sempre l'originale, anche se un mapping precedente è già
   * stato pre-applicato a `pseudonymizedText` dal parent (ClipboardWidget).
   * Flippa a 'pseudonimo' solo dopo che l'utente clicca "Pseudonimizza" su
   * questo documento (Round 2 UX-loop — Steve Krug Item A).
   */
  const [displayMode, setDisplayMode] = useState<DisplayMode>('originale')
  /**
   * Tracks whether the user has explicitly clicked "Pseudonimizza" on the
   * current document. Gates rendering of the view toggle + Copia + Recode
   * controls so the primary action ("Pseudonimizza") owns the visual focus
   * pre-action. Reset to false whenever `originalText` changes (new upload /
   * paste / textarea edit / reset).
   *
   * Round 2 UX-loop — Steve Krug Items A+C (see brief
   * `MHC-Work/briefs/mhc-l/recode_it_ux_loop_action_flow_round2_20260526.md`).
   */
  const [hasRunOnCurrentDoc, setHasRunOnCurrentDoc] = useState(false)
  /** Design C v3 — modalità split-pane Confronta originale (opt-in). */
  /** Micro-toast onboarding alla prima entrata in modalità confronto. */
  const fileInputRef = useRef<HTMLInputElement>(null)
  const runnerRef = useRef<NerRunner | null>(null)
  const originalTextareaRef = useRef<HTMLTextAreaElement>(null)

  // Eager NER init — unchanged from prior design, see prior commit history
  // for the rationale (recode_it_ner_rewrite_brief).
  useEffect(() => {
    let cancelled = false
    if (typeof Worker === 'undefined') {
      return
    }
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
          setError(t('pseudo.error.nerUnavailable'))
        } else {
          setError(
            `${t('pseudo.error.nerBackend')} ${rawMsg.replace(/^ERR_BACKEND_INIT:\s*/, '')}`,
          )
        }
      })
    return () => {
      cancelled = true
      runner.terminate()
      runnerRef.current = null
    }
    // Re-init when the document language changes so the correct ONNX model
    // (it / en / de / fr) is reloaded into the worker.
  }, [language])

  /**
   * Reset the "has the user pseudonymized THIS document" flag + the view
   * toggle every time the underlying document changes. Without this, a
   * returning user with an active mapping would see the toggle (Pseudonimizzato
   * / Originale) appear immediately on upload — because `pseudonymizedText`
   * is pre-applied by ClipboardWidget — and the primary action would lose
   * visual prominence. See brief
   * `MHC-Work/briefs/mhc-l/recode_it_ux_loop_action_flow_round2_20260526.md`
   * Item A (Steve Krug "Don't Make Me Think").
   *
   * Same-string setState in the parent (e.g. `runRegexOnly` passes `originalText`
   * back through `onResult` → `setOriginalText(orig)`) is bailed out by React
   * (Object.is) so this effect doesn't re-trigger after a successful
   * pseudonymize run.
   */
  useEffect(() => {
    setHasRunOnCurrentDoc(false)
    setDisplayMode('originale')
  }, [originalText])

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      setError(null)
      if (!files || files.length === 0) return
      const file = files[0]
      if (!file) return
      const name = file.name.toLowerCase()

      if (!ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext))) {
        setError(
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
        onOriginalChange(result.text)
      } catch (err) {
        setError(`${t('pseudo.upload.errorReadPrefix')}${(err as Error).message}`)
      }
    },
    [onOriginalChange, t],
  )

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    void handleFiles(e.dataTransfer.files)
  }

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(true)
  }

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
  }

  const handleFileInput = (e: ChangeEvent<HTMLInputElement>) => {
    void handleFiles(e.target.files)
  }

  const runRegexOnly = useCallback(
    (userFalsePositives: Set<string>, nerDetections?: NerDetection[]) => {
      const result = anonymize(originalText, {
        userFalsePositives,
        nerDetections,
        seedMapper: seedMapper ?? undefined,
        includeCategoriesPass2: includePlaces,
        language,
      })
      onResult({
        originalText,
        pseudonymizedText: result.pseudonymizedText,
        mapping: result.mappingEntries,
      })
      // Round 2 UX-loop — Steve Krug Item A: only AFTER an explicit user-
      // triggered pseudonymize run does the toggle + Copia + Recode controls
      // surface, and the view flips to the pseudonymized output. Both regex-
      // only (no Worker / NER unavailable) and NER paths converge here, so
      // this single call covers both successful run flavors.
      setHasRunOnCurrentDoc(true)
      setDisplayMode('pseudonimo')
    },
    [originalText, onResult, seedMapper, includePlaces],
  )

  const handlePseudonymize = async () => {
    setError(null)
    setPartialNotice(null)
    if (!originalText.trim()) {
      setError('Inserisci del testo o trascina un file prima di pseudonimizzare.')
      return
    }
    const userFalsePositives = new Set<string>([
      ...entities.filter((e) => e.status === 'falsePositive').map((e) => e.realValue),
      ...(seedFalsePositives ?? new Set<string>()),
    ])

    const workerSupported =
      typeof Worker !== 'undefined' && nerStatus !== 'unavailable'

    if (!workerSupported || !runnerRef.current) {
      runRegexOnly(userFalsePositives)
      return
    }

    let nerDetections: NerDetection[] | undefined
    setNerStatus('running')
    try {
      const predictResult = await runnerRef.current.predict(originalText)
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
      setError(
        'Errore durante il riconoscimento entità NER. La ' +
          'pseudonimizzazione regex resta attiva (CF, IBAN, email, ecc.). ' +
          `Dettaglio: ${rawMsg.replace(/^ERR_[A-Z_]+:\s*/, '')}`,
      )
    } finally {
      setNerStatus((prev) => (prev === 'running' ? 'idle' : prev))
    }

    runRegexOnly(userFalsePositives, nerDetections)
  }

  /**
   * Legacy manual annotation handler — kept for the textarea-based fallback
   * in the "Vista dettaglio" disclosure (preserves the existing test suite).
   * The DocumentView surfaces its own selection-driven gesture.
   */
  const [manualCategory, setManualCategory] = useState<ManualCategory>('persona')
  const [hasSelection, setHasSelection] = useState(false)

  const handleLegacyManualAnnotate = () => {
    const ta = originalTextareaRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    if (start === end) return
    onManualAnnotate(start, end, manualCategory)
    ta.setSelectionRange(end, end)
    setHasSelection(false)
  }

  const updateSelectionState = () => {
    const ta = originalTextareaRef.current
    if (!ta) {
      setHasSelection(false)
      return
    }
    setHasSelection(ta.selectionStart !== ta.selectionEnd)
  }

  const handleIncludePlacesChange = (next: boolean) => {
    setIncludePlaces(next)
    writeIncludePlacesPref(next)
  }

  const handleCopy = async () => {
    if (!pseudonymizedText) return
    try {
      await navigator.clipboard.writeText(pseudonymizedText)
      setCopyState('copied')
      window.setTimeout(() => setCopyState('idle'), 2000)
    } catch (err) {
      setError(`Impossibile copiare negli appunti: ${(err as Error).message}`)
    }
  }

  // Contextual counters for the sticky banner.
  const counters = useMemo(() => {
    const pending = entities.filter((e) => e.status === 'pending').length
    const fp = entities.filter((e) => e.status === 'falsePositive').length
    return { total: entities.length, pending, fp }
  }, [entities])

  const hasDocument = originalText.length > 0
  const hasResult = pseudonymizedText.length > 0

  /** Design C v2 — empty-state tab for the hero loader: file drop vs paste. */
  const [loadTab, setLoadTab] = useState<'file' | 'paste'>('file')
  const [pasteBuffer, setPasteBuffer] = useState('')

  const handleResetDocument = () => {
    onOriginalChange('')
    setPasteBuffer('')
    setLoadTab('file')
  }

  return (
    <section className="panel panel--pseudonymize" aria-label="Pseudonimizzazione">
      {/*
        Heading kept (visually hidden in some viewports via CSS, but in DOM
        for accessibility + test queries). Preserves
        screen.getByRole('heading', { name: /pseudonimizza/i }) used in
        ClipboardWidget.test and matches the AppHeader's screen-reader
        outline.
      */}
      <h2 className="panel__heading-sr">{t('pseudo.heading')}</h2>

      {/*
        Design C v2 — empty-state hero loader. Avvocato fresh-arrival: the
        first thing they should see is "carica un documento" at hero scale.
        Once a document is present we switch to the compact toolbar layout
        with a discreet "nuovo documento" button.
      */}
      {!hasDocument && (
        <div className="drop-hero" data-testid="drop-hero">
          <div className="drop-hero__tabs" role="tablist" aria-label={t('pseudo.tabs.ariaLabel')}>
            <button
              type="button"
              role="tab"
              aria-selected={loadTab === 'file'}
              className={`drop-hero__tab${loadTab === 'file' ? ' is-active' : ''}`}
              onClick={() => setLoadTab('file')}
              data-testid="loadtab-file"
            >
              {t('pseudo.tabs.upload')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={loadTab === 'paste'}
              className={`drop-hero__tab${loadTab === 'paste' ? ' is-active' : ''}`}
              onClick={() => setLoadTab('paste')}
              data-testid="loadtab-paste"
            >
              {t('pseudo.tabs.paste')}
            </button>
          </div>

          {loadTab === 'file' ? (
            <div
              className={`drop-zone drop-zone--hero${dragOver ? ' drop-zone--active' : ''}`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              data-testid="drop-zone"
            >
              <div className="drop-zone__icon" aria-hidden="true">
                ⬆
              </div>
              <p className="drop-zone__headline">
                {t('pseudo.upload.dropzone')}
              </p>
              <p className="drop-zone__hint">
                {t('pseudo.upload.formats')} <code>.txt</code> · <code>.md</code> ·{' '}
                <code>.docx</code> · <code>.pdf</code>
              </p>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => fileInputRef.current?.click()}
                data-testid="select-file-btn"
              >
                {t('pseudo.upload.selectButton')}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md,.docx,.pdf,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={handleFileInput}
                style={{ display: 'none' }}
                data-testid="file-input"
              />
            </div>
          ) : (
            <div className="drop-hero__paste" data-testid="drop-paste">
              <label className="field">
                <span className="field__label">
                  {t('pseudo.paste.label')}
                </span>
                <textarea
                  className="field__textarea"
                  value={pasteBuffer}
                  onChange={(e) => setPasteBuffer(e.target.value)}
                  placeholder={t('pseudo.paste.placeholder')}
                  rows={10}
                  data-testid="paste-textarea"
                />
              </label>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  if (pasteBuffer.trim()) {
                    onOriginalChange(pasteBuffer)
                  }
                }}
                disabled={!pasteBuffer.trim()}
                data-testid="paste-confirm-btn"
              >
                {t('pseudo.paste.useButton')}
              </button>
            </div>
          )}
        </div>
      )}

      {/*
        Toolbar — Design C primary control surface (only when document loaded).
        Round 2 UX-loop (Steve Krug Items A+C): pre-pseudonimizzazione la
        toolbar ospita solo "Nuovo documento" (e l'input file nascosto). Il
        toggle Pseudonimizzato/Originale + Copia + Recode appaiono SOLO dopo
        che l'utente ha cliccato esplicitamente "Pseudonimizza" su questo
        documento (`hasRunOnCurrentDoc`). Così l'azione primaria
        ("Pseudonimizza") domina la prima impressione visiva, anche per
        returning user con mapping in browser.
      */}
      {hasDocument && (
        <div className="docview-toolbar" data-testid="docview-toolbar">
          <div className="docview-toolbar__left">
            {hasRunOnCurrentDoc && (
              <div
                className="docview-toggle"
                role="radiogroup"
                aria-label="Modalità visualizzazione documento"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={displayMode === 'pseudonimo'}
                  className={`docview-toggle__btn${displayMode === 'pseudonimo' ? ' is-active' : ''}`}
                  onClick={() => setDisplayMode('pseudonimo')}
                  data-testid="toggle-pseudonimo"
                >
                  {t('pseudo.toggle.pseudonimo')}
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={displayMode === 'originale'}
                  className={`docview-toggle__btn${displayMode === 'originale' ? ' is-active' : ''}`}
                  onClick={() => setDisplayMode('originale')}
                  data-testid="toggle-originale"
                >
                  {t('pseudo.toggle.originale')}
                </button>
              </div>
            )}
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={handleResetDocument}
              data-testid="reset-document-btn"
              title={t('pseudo.button.newDocumentTitle')}
            >
              {t('pseudo.button.newDocument')}
            </button>
            {/* hidden file input still available for the compact loader, reused via drop too */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.docx,.pdf,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={handleFileInput}
              style={{ display: 'none' }}
              data-testid="file-input"
            />
          </div>
          {hasRunOnCurrentDoc && (
            <div className="docview-toolbar__right">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={handleCopy}
                disabled={!pseudonymizedText}
                data-testid="copy-pseudonymized-btn"
                title="Copia il testo pseudonimizzato negli appunti"
              >
                {copyState === 'copied' ? '✓ Copiato' : 'Copia ⧉'}
              </button>
              {onOpenRecode && (
                <button
                  type="button"
                  className={`btn btn--primary${recodeOpen ? ' is-active' : ''}`}
                  onClick={onOpenRecode}
                  disabled={!hasResult}
                  data-testid="open-recode-btn"
                  title={
                    hasResult
                      ? t('pseudo.button.openRecodeReady')
                      : t('pseudo.button.openRecodeEmpty')
                  }
                >
                  {t('pseudo.button.openRecode')}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Contextual sticky counters banner */}
      {hasDocument && entities.length > 0 && (
        <div
          className="docview-banner"
          role="status"
          data-testid="docview-banner"
        >
          <strong>{counters.total}</strong>{' '}
          {counters.total === 1 ? 'entità' : 'entità'} ·{' '}
          <strong>{counters.pending}</strong>{' '}
          {counters.pending === 1 ? 'da rivedere' : 'da rivedere'} ·{' '}
          <strong>{counters.fp}</strong>{' '}
          {counters.fp === 1 ? 'lasciata originale' : 'lasciate originali'}
        </div>
      )}

      {/* Action row: Pseudonimizza + Save */}
      <div className="actions actions--inline">
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => {
            void handlePseudonymize()
          }}
          disabled={nerStatus === 'loading' || nerStatus === 'running'}
          data-testid="pseudonymize-btn"
        >
          {/*
            Round 2 UX-loop — Steve Krug Item B: label sempre "Pseudonimizza",
            mai "Estendi mapping". L'utente vede UN documento da pseudonimizzare,
            non un mapping da estendere. La logica extend-vs-create resta
            trasparente all'engine. Brief
            `MHC-Work/briefs/mhc-l/recode_it_ux_loop_action_flow_round2_20260526.md`.
          */}
          {nerStatus === 'loading'
            ? t('pseudo.button.loading')
            : nerStatus === 'running'
              ? t('pseudo.button.running')
              : t('pseudo.button.pseudonimize')}
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={onSaveClick}
          disabled={!canSave || saveStatus === 'saving'}
          title={
            !loggedIn
              ? 'Accedi o crea un account per salvare il mapping.'
              : tier === 'pro' && !masterKeyAvailable
                ? 'Master key non in memoria — esci e riaccedi.'
                : entities.length === 0
                  ? 'Pseudonimizza un documento prima di salvare.'
                  : tier === 'free'
                    ? 'Salva il mapping nel browser di questo computer.'
                    : 'Salva il mapping cifrato sul server.'
          }
          data-testid="save-mapping-btn"
        >
          {saveStatus === 'saving'
            ? t('pseudo.save.saving')
            : saveStatus === 'saved'
              ? t('pseudo.save.saved')
              : activeLabel
                ? t('pseudo.save.update')
                : t('pseudo.button.save')}
        </button>
        {/* Mappa + Decodifica tabs live in DecodificaWorkspace (parent) — no
            separate CTA button needed here post-pivot (§9.10). */}
      </div>

      {activeLabel && (
        <div className="active-badge" data-testid="active-badge-inline">
          <span>
            Mapping attivo: <strong>{activeLabel}</strong>
            {' '}— i prossimi documenti continueranno la stessa causa.
          </span>
          <button
            type="button"
            className="btn btn--secondary btn--small"
            onClick={onCloseActive}
            data-testid="close-active-btn"
          >
            Chiudi
          </button>
        </div>
      )}

      {labelInputOpen && (
        <div className="save-label-form" data-testid="save-label-form">
          <label className="field">
            <span className="field__label">
              Etichetta mapping (es. &quot;Causa Rossi vs Bianchi&quot;)
            </span>
            <input
              type="text"
              value={labelInput}
              onChange={(e) => onLabelChange(e.target.value)}
              className="auth-input"
              autoFocus
              data-testid="save-label-input"
              maxLength={120}
              placeholder="Causa Rossi vs Bianchi"
            />
          </label>
          <div className="actions">
            <button
              type="button"
              className="btn btn--primary"
              onClick={onSaveConfirm}
              disabled={!labelInput.trim() || saveStatus === 'saving'}
              data-testid="save-label-confirm"
            >
              {saveStatus === 'saving' ? 'Salvo…' : 'Conferma e salva'}
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={onSaveCancel}
              data-testid="save-label-cancel"
            >
              Annulla
            </button>
          </div>
        </div>
      )}

      {saveError && (
        <div className="error" role="alert" data-testid="save-error">
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

      {nerStatus === 'running' && (
        <div className="ner-status" role="status" data-testid="ner-status">
          {t('pseudo.status.running')}
        </div>
      )}

      {error && (
        <div className="error" role="alert" data-testid="pseudo-error">
          {error}
        </div>
      )}

      {partialNotice && (
        <div
          className="banner banner--warning"
          role="status"
          data-testid="partial-ner-banner"
        >
          <strong>{t('pseudo.partial.title')}</strong>{' '}
          {partialNotice.failedRanges.length}{' '}
          {partialNotice.failedRanges.length === 1
            ? t('pseudo.partial.singular')
            : t('pseudo.partial.plural')}{' '}
          {t('pseudo.partial.body')} {t('pseudo.partial.manualHint')}
          <details className="partial-ner-banner__details">
            <summary>{t('pseudo.partial.skippedSections')}</summary>
            {partialNotice.failedRanges
              .map(([s, e]) => `${s}-${e}`)
              .join(', ')}
          </details>
        </div>
      )}

      {/* Variante β toggle — kept available, under the doc */}
      <div className="toggle-pass2" data-testid="toggle-pass2">
        <label className="toggle-pass2__label">
          <input
            type="checkbox"
            checked={includePlaces}
            onChange={(e) => handleIncludePlacesChange(e.target.checked)}
            data-testid="toggle-pass2-checkbox"
          />
          <span className="toggle-pass2__text">
            {t('pseudo.toggle.places')}
          </span>
        </label>
      </div>

      {/* THE DOCUMENT — Design C primary surface. */}
      {hasDocument ? (
        <DocumentView
          originalText={originalText}
          pseudonymizedText={pseudonymizedText}
          entities={entities}
          displayMode={displayMode}
          onAccept={onAccept}
          onFalsePositive={onFalsePositive}
          onChangeCategory={onChangeCategory}
          onSubstituteAnyway={onSubstituteAnyway}
          onManualAnnotate={onManualAnnotate}
        />
      ) : (
        <div className="docview docview--placeholder">
          <p className="docview__empty" data-testid="docview-empty">
            {t('pseudo.detail.placeholder')}
          </p>
        </div>
      )}

      {/*
        Vista dettaglio — disclosure region preserving textarea-driven
        workflows (paste-in, legacy manual annotation, raw pseudonymized text
        readback) AND the testable surfaces used by the Phase 2 / Phase 3
        suite: original-textarea, pseudonymized-textarea, EntityReviewList,
        manual-annotate. We keep it open by default during transition so the
        founder can sanity-check the document view against the raw output.
      */}
      <details className="detail-disclosure" data-testid="detail-disclosure">
        <summary>{t('pseudo.detail.title')}</summary>

        <label className="field">
          <span className="field__label">{t('pseudo.detail.originalLabel')}</span>
          <textarea
            ref={originalTextareaRef}
            className="field__textarea"
            value={originalText}
            onChange={(e) => {
              onOriginalChange(e.target.value)
              updateSelectionState()
            }}
            onSelect={updateSelectionState}
            onKeyUp={updateSelectionState}
            onClick={updateSelectionState}
            onFocus={updateSelectionState}
            placeholder={t('pseudo.detail.originalPlaceholder')}
            rows={8}
            data-testid="original-textarea"
          />
        </label>

        <div className="manual-annotate" data-testid="manual-annotate">
          <label className="manual-annotate__category">
            <span className="manual-annotate__label">{t('pseudo.detail.categoryLabel')}</span>
            <select
              value={manualCategory}
              onChange={(e) =>
                setManualCategory(e.target.value as ManualCategory)
              }
              data-testid="manual-annotate-category"
              aria-label={t('pseudo.detail.categoryAria')}
            >
              <option value="persona">{t('pseudo.detail.cat.persona')}</option>
              <option value="luogo">{t('pseudo.detail.cat.luogo')}</option>
              <option value="organizzazione">{t('pseudo.detail.cat.organizzazione')}</option>
              <option value="tribunale">{t('pseudo.detail.cat.tribunale')}</option>
              <option value="altro">{t('pseudo.detail.cat.altro')}</option>
            </select>
          </label>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={handleLegacyManualAnnotate}
            disabled={!hasSelection || !originalText}
            title={
              !hasSelection
                ? t('pseudo.detail.manualNoSelection')
                : t('pseudo.detail.manualHasSelection')
            }
            data-testid="manual-annotate-btn"
          >
            {t('pseudo.detail.manualButton')}
          </button>
        </div>

        <label className="field">
          <span className="field__label">{t('pseudo.detail.pseudoLabel')}</span>
          <textarea
            className="field__textarea field__textarea--readonly"
            value={pseudonymizedText}
            readOnly
            rows={8}
            placeholder={t('pseudo.detail.pseudoPlaceholder')}
            data-testid="pseudonymized-textarea"
          />
        </label>

        <section className="review" aria-label={t('pseudo.detail.entitiesAria')}>
          <h3>{t('pseudo.detail.entitiesHeader')}</h3>
          <EntityReviewList
            entities={entities}
            onAccept={onAccept}
            onChangeCategory={onChangeCategory}
            onFalsePositive={onFalsePositive}
            onSubstituteAnyway={onSubstituteAnyway}
          />
        </section>
      </details>

      {scannedPdfModalOpen && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="scanned-pdf-modal-title"
          data-testid="scanned-pdf-modal"
        >
          <div className="modal">
            <h3 id="scanned-pdf-modal-title">PDF scannerizzato rilevato</h3>
            <p>
              Questo PDF è una scansione (non ha testo selezionabile).
              L&apos;OCR per fotocopie e PDF scannerizzati è nel piano Pro, in
              arrivo. Per ora carica una versione con testo selezionabile.
            </p>
            <div className="actions">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => setScannedPdfModalOpen(false)}
                data-testid="scanned-pdf-modal-ok"
                autoFocus
              >
                Capito
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
