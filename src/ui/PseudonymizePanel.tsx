/**
 * PseudonymizePanel — left panel of the clipboard widget.
 *
 * Lets the user drop a `.txt` / `.md` file (or paste text), runs `anonymize()`
 * from the Phase 1 engine, shows original vs pseudonymized side by side, and
 * surfaces the detected entities for review. The "Copia per Claude" button
 * writes the pseudonymized text to the clipboard. "Salva mapping" is a
 * disabled placeholder until Phase 3 (auth + server-side encrypted storage).
 */

import { useCallback, useRef, useState, type DragEvent, type ChangeEvent } from 'react'
import { anonymize } from '../engine/engine'
import type { MappingEntry } from '../types/engine'
import { EntityReviewList } from './EntityReviewList'
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
}

const ACCEPTED_EXTENSIONS = ['.txt', '.md']
const FUTURE_EXTENSIONS = ['.docx', '.pdf']

export function PseudonymizePanel({
  originalText,
  pseudonymizedText,
  entities,
  onResult,
  onOriginalChange,
  onAccept,
  onChangeCategory,
  onFalsePositive,
}: Props): JSX.Element {
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      setError(null)
      if (!files || files.length === 0) return
      const file = files[0]
      if (!file) return
      const name = file.name.toLowerCase()

      if (FUTURE_EXTENSIONS.some((ext) => name.endsWith(ext))) {
        setError(
          `I file ${FUTURE_EXTENSIONS.join(' / ')} sono in arrivo nella Phase 4. Per ora supportiamo ${ACCEPTED_EXTENSIONS.join(' / ')}.`,
        )
        return
      }
      if (!ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext))) {
        setError(
          `Formato non supportato. Trascina un file ${ACCEPTED_EXTENSIONS.join(' o ')}, oppure incolla il testo qui sotto.`,
        )
        return
      }
      try {
        const text = await file.text()
        onOriginalChange(text)
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

  const handlePseudonymize = () => {
    setError(null)
    if (!originalText.trim()) {
      setError('Inserisci del testo o trascina un file prima di pseudonimizzare.')
      return
    }
    // Phase 2: collect false positives across runs so the user's decisions
    // stick. The engine accepts this option even though regex-only mode
    // doesn't yet wire it up — Phase 4 GLiNER will honor it.
    const userFalsePositives = new Set(
      entities
        .filter((e) => e.status === 'falsePositive')
        .map((e) => e.realValue),
    )
    const result = anonymize(originalText, { userFalsePositives })
    onResult({
      originalText,
      pseudonymizedText: result.pseudonymizedText,
      mapping: result.mappingEntries,
    })
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
          Trascina qui un file <code>.txt</code> o <code>.md</code>, oppure
          incolla il testo qui sotto.
        </p>
        <p className="drop-zone__hint">
          File <code>.docx</code> e <code>.pdf</code> in arrivo (Phase 4).
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
          accept=".txt,.md,text/plain,text/markdown"
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

      <div className="actions">
        <button
          type="button"
          className="btn btn--primary"
          onClick={handlePseudonymize}
          data-testid="pseudonymize-btn"
        >
          Pseudonimizza
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
          disabled
          title="Salvataggio mapping disponibile con l'account (Phase 3)."
        >
          Salva mapping
        </button>
      </div>

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
    </section>
  )
}
