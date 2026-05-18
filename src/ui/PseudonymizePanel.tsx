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
      })
      onResult({
        originalText,
        pseudonymizedText: result.pseudonymizedText,
        mapping: result.mappingEntries,
      })
    },
    [originalText, onResult, seedMapper],
  )

  const handlePseudonymize = async () => {
    setError(null)
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
    let nerDetections: NerDetection[] | undefined
    try {
      setNerStatus('running')
      nerDetections = await runnerRef.current.predict(originalText)
    } catch (err) {
      runnerRef.current = null
      setNerStatus('unavailable')
      const rawMsg = (err as Error).message ?? 'errore sconosciuto'
      setError(
        'Errore durante il riconoscimento entità NER. La ' +
          'pseudonimizzazione regex resta attiva (CF, IBAN, email, ecc.). ' +
          `Dettaglio: ${rawMsg.replace(/^ERR_[A-Z_]+:\s*/, '')}`,
      )
    }

    runRegexOnly(userFalsePositives, nerDetections)
    if (nerStatus === 'running') setNerStatus('idle')
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
