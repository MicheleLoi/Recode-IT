/**
 * PseudonymizePanel — left panel of the clipboard widget.
 *
 * Lets the user drop a `.txt` / `.md` / `.docx` / `.pdf` file (or paste text),
 * runs `anonymize()` from the Phase 1 engine, shows original vs pseudonymized
 * side by side, and surfaces the detected entities for review. The "Copia per
 * Claude" button writes the pseudonymized text to the clipboard.
 *
 * File extraction is delegated to `src/extraction/extract.ts`, which routes
 * by extension (DESIGN.md §3). The scanned-PDF edge case (DESIGN.md §10) is
 * handled inline here: when the dispatcher reports `scannedPdf=true` we open
 * a modal announcing that OCR is in the Pro plan rather than dropping a
 * blank string into the textarea.
 */

import { useCallback, useEffect, useRef, useState, type DragEvent, type ChangeEvent } from 'react'
import { anonymize } from '../engine/engine'
import { NerRunner } from '../engine/ner_runner'
import type { NerProgressEvent } from '../engine/ner_runner'
import type { PseudonymMapper } from '../engine/pseudonym_mapper'
import type { MappingEntry, NerDetection } from '../types/engine'

/**
 * localStorage key for the variante-β toggle preference (opt-in
 * luoghi / organizzazioni / tribunali). Default `false` — preserving these
 * data points often matters for legal reasoning (foro competente,
 * giurisdizione, leggi regionali).
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
import { extractText, SUPPORTED_EXTENSIONS } from '../extraction/extract'
import { EntityReviewList } from './EntityReviewList'
import { ModelLoadingState } from './ModelLoadingState'
import type { ModelLoadPhase } from './ModelLoadingState'
import type { ReviewEntity, SwitchableCategory } from './types'

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
  /**
   * Phase-3 wiring — when the user has an active saved mapping open, the
   * seeded PseudonymMapper carries pseudonym↔original allocations across
   * documents of the same case. Passing it here puts the engine in EXTEND
   * mode (anonymize.ts). Null → fresh mapper per run (legacy single-doc).
   */
  seedMapper?: PseudonymMapper | null
  /**
   * False-positive originals carried forward from the active mapping (so
   * Emilia marked FP in Doc1 stays "Emilia" in Doc2). Engine consults this
   * via `userFalsePositives`.
   */
  seedFalsePositives?: ReadonlySet<string>
  /** Whether "Salva mapping" is enabled. */
  canSave: boolean
  loggedIn: boolean
  masterKeyAvailable: boolean
  saveStatus: 'idle' | 'saving' | 'saved' | 'error'
  saveError: string | null
  labelInputOpen: boolean
  labelInput: string
  onLabelChange: (v: string) => void
  onSaveClick: () => void
  onSaveConfirm: () => void
  onSaveCancel: () => void
  /** Label of the currently-active mapping, if any. */
  activeLabel: string | null
  onCloseActive: () => void
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
  seedMapper = null,
  seedFalsePositives,
  canSave,
  loggedIn,
  masterKeyAvailable,
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
}: Props): JSX.Element {
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle')
  const [scannedPdfModalOpen, setScannedPdfModalOpen] = useState(false)
  const [includePlaces, setIncludePlaces] = useState<boolean>(() =>
    readIncludePlacesPref(),
  )
  /**
   * Partial-NER banner state: when the last `predict()` call reported
   * `partial: true`, we surface a non-modal banner with the failed character
   * ranges so the avvocato knows which slice of the document wasn't covered
   * by NER. Cleared on each new pseudonimizza run.
   */
  const [partialNotice, setPartialNotice] = useState<{
    failedRanges: Array<[number, number]>
  } | null>(null)
  const [nerStatus, setNerStatus] = useState<'idle' | 'loading' | 'running' | 'unavailable'>(
    'idle',
  )
  const [loadProgress, setLoadProgress] = useState<{
    phase: ModelLoadPhase
    loaded: number
    total: number
  } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const runnerRef = useRef<NerRunner | null>(null)

  /**
   * Eager NER init at mount: the model is ~67 MB so we want the download to
   * start as soon as the user opens the page (rather than on first click,
   * which created a confusing "broken page" UX — see the
   * recode_it_ner_rewrite_brief_20260518 brief). The defensive error handling
   * below (rawMsg / ERR_MODEL_NOT_FOUND / ERR_BACKEND_INIT) is preserved:
   * if init fails at mount, we silently fall back to regex-only mode — the
   * user's first interaction still works, just without NER.
   *
   * StrictMode double-invoke caveat: the cleanup terminates the worker; the
   * second invocation will create a new one. We accept the wasted boot in
   * dev (~50ms) for correctness in prod.
   */
  useEffect(() => {
    let cancelled = false
    if (typeof Worker === 'undefined') {
      // jsdom / SSR: no Worker, no eager init. The on-click path will set
      // nerStatus='unavailable' the same way it did before.
      return
    }
    const runner = new NerRunner()
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
        // Sentinel-based UX split — same pattern as handlePseudonymize:
        // distinguish "model not deployed" from "ort runtime failed". Eager
        // path uses a softer wording: the user hasn't asked for anything
        // yet, so we don't surface a red error — we just store it for the
        // next pseudonymize call to display.
        if (rawMsg.includes('ERR_MODEL_NOT_FOUND')) {
          setError(
            'Modello NER non disponibile. La pseudonimizzazione resta attiva ' +
              'per CF, IBAN, email e altri identificatori strutturati.',
          )
        } else {
          setError(
            'Errore tecnico nel caricamento del runtime NER. La ' +
              'pseudonimizzazione regex resta attiva (CF, IBAN, email, ecc.). ' +
              `Dettaglio: ${rawMsg.replace(/^ERR_BACKEND_INIT:\s*/, '')}`,
          )
        }
      })
    return () => {
      cancelled = true
      runner.terminate()
      runnerRef.current = null
    }
  }, [])

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      setError(null)
      if (!files || files.length === 0) return
      const file = files[0]
      if (!file) return
      const name = file.name.toLowerCase()

      if (!ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext))) {
        setError(
          `Formato non supportato. Trascina un file ${ACCEPTED_EXTENSIONS.join(', ')}, oppure incolla il testo qui sotto.`,
        )
        return
      }
      try {
        const result = await extractText(file)
        // Scanned-PDF edge case (DESIGN.md §10): pdf.js returns ~empty text
        // for a scan. Don't pollute the textarea — surface the OCR-coming-soon
        // modal so the user understands why their PDF didn't load.
        if (result.scannedPdf) {
          setScannedPdfModalOpen(true)
          return
        }
        onOriginalChange(result.text)
      } catch (err) {
        setError(`Impossibile leggere il file: ${(err as Error).message}`)
      }
    },
    [onOriginalChange],
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

  /** Run anonymize() and push the result up. Pure sync — no NER. */
  const runRegexOnly = useCallback(
    (userFalsePositives: Set<string>, nerDetections?: NerDetection[]) => {
      const result = anonymize(originalText, {
        userFalsePositives,
        nerDetections,
        // EXTEND mode: when a mapping is active, the seeded mapper carries
        // forward Tier 1 (exact match) allocations from previous documents so
        // pseudonyms stay coherent across the case (capabilities_index §6.2).
        seedMapper: seedMapper ?? undefined,
        // Variante β: opt-in luoghi/org/tribunali. When OFF (default), these
        // categories surface in the review list as preserved entries the
        // avvocato can flip to substituted per-entity.
        includeCategoriesPass2: includePlaces,
      })
      onResult({
        originalText,
        pseudonymizedText: result.pseudonymizedText,
        mapping: result.mappingEntries,
      })
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
    // Build the FP set from BOTH local UI state AND the carried-forward set
    // from the active mapping (DESIGN §8.7): Emilia marked FP in Doc1 stays
    // un-pseudonymized in Doc2 of the same case.
    const userFalsePositives = new Set<string>([
      ...entities.filter((e) => e.status === 'falsePositive').map((e) => e.realValue),
      ...(seedFalsePositives ?? new Set<string>()),
    ])

    // Fast path: NER unavailable (jsdom / init failed / no Worker) →
    // immediate regex-only pseudonymization. The UI still shows the regex
    // masks (`<DS>`, `<IBAN>`, …) which is the Phase 2 contract.
    const workerSupported =
      typeof Worker !== 'undefined' && nerStatus !== 'unavailable'

    if (!workerSupported || !runnerRef.current) {
      runRegexOnly(userFalsePositives)
      return
    }

    // NER path: the worker is already booted eagerly at mount (see useEffect
    // above), so by the time the user clicks Pseudonimizza either the runner
    // is `ready` (predict succeeds) or it has flipped to `unavailable`
    // (handled above). The only thing that can fail here is the actual
    // inference — degrade to regex-only with a forensic-sober notice.
    //
    // Bug fix (regression 20260518): the previous "reset to idle on the way
    // out" path read `nerStatus === 'running'` from the closure captured at
    // the start of handlePseudonymize — but that closure still saw the
    // pre-click `nerStatus` value (typically `'idle'`), so the guard
    // never fired and the button stayed wedged on "Riconoscimento entità in
    // corso…" even when `predict()` returned `{partial: true, ...}`.
    // Fix: drop the stale-state guard and reset unconditionally in a
    // `finally` block.
    let nerDetections: NerDetection[] | undefined
    setNerStatus('running')
    try {
      const predictResult = await runnerRef.current.predict(originalText)
      nerDetections = predictResult.detections
      if (predictResult.partial) {
        setPartialNotice({ failedRanges: predictResult.failedChunkRanges })
      }
    } catch (err) {
      // Hard failure: not even partial results. Mirror the legacy behaviour
      // (drop NER, run regex-only with a forensic-sober notice) but DO NOT
      // mark the runner unavailable for transient timeouts — the user can
      // retry. Only `ERR_BACKEND_INIT` / `ERR_MODEL_NOT_FOUND` warrant a
      // permanent flip.
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
      // Always flip out of 'running' so the button re-enables — partial,
      // success, or transient failure. (`'unavailable'` was already set
      // above for permanent failures and must not be overwritten.)
      setNerStatus((prev) => (prev === 'running' ? 'idle' : prev))
    }

    runRegexOnly(userFalsePositives, nerDetections)
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

  return (
    <section className="panel panel--pseudonymize" aria-label="Pseudonimizzazione">
      <header className="panel__header">
        <h2>Pseudonimizza</h2>
        <p className="panel__subtitle">
          Sostituisce nomi, codici fiscali, IBAN, email con pseudonimi prima di
          inviarli a Claude.
        </p>
      </header>

      <div
        className={`drop-zone${dragOver ? ' drop-zone--active' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        data-testid="drop-zone"
      >
        <p>
          Trascina qui un file <code>.txt</code>, <code>.md</code>,{' '}
          <code>.docx</code> o <code>.pdf</code>, oppure incolla il testo qui
          sotto.
        </p>
        <p className="drop-zone__hint">
          I PDF scannerizzati (senza testo selezionabile) richiedono OCR —
          disponibile nel piano Pro in arrivo.
        </p>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => fileInputRef.current?.click()}
        >
          Seleziona file…
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

      <label className="field">
        <span className="field__label">Testo originale</span>
        <textarea
          className="field__textarea"
          value={originalText}
          onChange={(e) => onOriginalChange(e.target.value)}
          placeholder="Incolla qui il documento da pseudonimizzare…"
          rows={10}
          data-testid="original-textarea"
        />
      </label>

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

      <div className="toggle-pass2" data-testid="toggle-pass2">
        <label className="toggle-pass2__label">
          <input
            type="checkbox"
            checked={includePlaces}
            onChange={(e) => handleIncludePlacesChange(e.target.checked)}
            data-testid="toggle-pass2-checkbox"
          />
          <span className="toggle-pass2__text">
            Sostituisci anche luoghi, organizzazioni e tribunali
          </span>
        </label>
        <p className="toggle-pass2__hint">
          Default OFF — preservare questi dati può essere importante per il
          ragionamento giuridico (es. giurisdizione, foro competente, leggi
          regionali). Puoi sostituirli singolarmente dal riquadro entità.
        </p>
      </div>

      <div className="actions">
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => {
            void handlePseudonymize()
          }}
          disabled={nerStatus === 'loading' || nerStatus === 'running'}
          data-testid="pseudonymize-btn"
        >
          {nerStatus === 'loading'
            ? 'Caricamento modello AI…'
            : nerStatus === 'running'
              ? 'Riconoscimento entità in corso…'
              : activeLabel
                ? 'Estendi mapping'
                : 'Pseudonimizza'}
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={handleCopy}
          disabled={!pseudonymizedText}
          data-testid="copy-pseudonymized-btn"
        >
          {copyState === 'copied' ? '✓ Copiato' : 'Copia per Claude'}
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={onSaveClick}
          disabled={!canSave || saveStatus === 'saving'}
          title={
            !loggedIn
              ? "Accedi o crea un account per salvare il mapping."
              : !masterKeyAvailable
                ? 'Master key non in memoria — esci e riaccedi.'
                : entities.length === 0
                  ? "Pseudonimizza un documento prima di salvare."
                  : 'Salva il mapping cifrato sul server.'
          }
          data-testid="save-mapping-btn"
        >
          {saveStatus === 'saving'
            ? 'Salvataggio…'
            : saveStatus === 'saved'
              ? '✓ Salvato'
              : activeLabel
                ? 'Aggiorna mapping'
                : 'Salva mapping'}
        </button>
      </div>

      {labelInputOpen && (
        <div className="save-label-form" data-testid="save-label-form">
          <label className="field">
            <span className="field__label">
              Etichetta mapping (es. "Causa Rossi vs Bianchi")
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
          Riconoscimento entità in corso…
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
          <strong>Riconoscimento entità incompleto</strong> su{' '}
          {partialNotice.failedRanges.length}{' '}
          {partialNotice.failedRanges.length === 1
            ? 'sezione'
            : 'sezioni'}{' '}
          del documento (caratteri{' '}
          {partialNotice.failedRanges
            .map(([s, e]) => `${s}-${e}`)
            .join(', ')}
          ). Pseudonimizzazione completata su regex e parti riconosciute.
        </div>
      )}

      <label className="field">
        <span className="field__label">Testo pseudonimizzato</span>
        <textarea
          className="field__textarea field__textarea--readonly"
          value={pseudonymizedText}
          readOnly
          rows={10}
          placeholder="L'output apparirà qui dopo Pseudonimizza."
          data-testid="pseudonymized-textarea"
        />
      </label>

      <section className="review" aria-label="Entità rilevate">
        <h3>Entità rilevate</h3>
        <EntityReviewList
          entities={entities}
          onAccept={onAccept}
          onChangeCategory={onChangeCategory}
          onFalsePositive={onFalsePositive}
          onSubstituteAnyway={onSubstituteAnyway}
        />
      </section>

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
