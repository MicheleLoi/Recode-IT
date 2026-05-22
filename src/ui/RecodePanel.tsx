/**
 * RecodePanel — recode the Claude response (Design C: slide-in panel).
 *
 * Two presentation modes:
 *   - 'inline'    → legacy in-flow panel (kept for backwards compat / tests)
 *   - 'slidein'   → fixed right-anchored panel covering ~40% viewport; the
 *                   document view stays visible on the left as read-only
 *                   reference. Includes a close button (X).
 *
 * Behaviour is unchanged: paste Claude's response, debounced reverse-mapping,
 * copy the recoded text. All testids preserved.
 */

import { useEffect, useState } from 'react'
import { recodeText } from '../engine/recode'
import type { MappingEntry } from '../types/engine'

type Props = {
  mapping: MappingEntry[]
  /** Design C: slide-in vs legacy inline. Defaults to 'inline'. */
  mode?: 'inline' | 'slidein'
  /** Slide-in close handler (only used in 'slidein' mode). */
  onClose?: () => void
}

const DEBOUNCE_MS = 500

export function RecodePanel({
  mapping,
  mode = 'inline',
  onClose,
}: Props): JSX.Element {
  const [claudeResponse, setClaudeResponse] = useState('')
  const [recoded, setRecoded] = useState('')
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!claudeResponse) {
      setRecoded('')
      return
    }
    const handle = window.setTimeout(() => {
      try {
        setRecoded(recodeText(claudeResponse, mapping))
      } catch (err) {
        setError(`Errore durante il recoding: ${(err as Error).message}`)
      }
    }, DEBOUNCE_MS)
    return () => window.clearTimeout(handle)
  }, [claudeResponse, mapping])

  const handleRecodeNow = () => {
    setError(null)
    if (!claudeResponse.trim()) {
      setRecoded('')
      return
    }
    try {
      setRecoded(recodeText(claudeResponse, mapping))
    } catch (err) {
      setError(`Errore durante il recoding: ${(err as Error).message}`)
    }
  }

  const handleCopy = async () => {
    if (!recoded) return
    try {
      await navigator.clipboard.writeText(recoded)
      setCopyState('copied')
      window.setTimeout(() => setCopyState('idle'), 2000)
    } catch (err) {
      setError(`Impossibile copiare negli appunti: ${(err as Error).message}`)
    }
  }

  const hasMapping = mapping.length > 0
  const isSlideIn = mode === 'slidein'

  return (
    <section
      className={`panel panel--recode${isSlideIn ? ' panel--recode-slidein' : ''}`}
      aria-label="Recoding"
      data-mode={mode}
    >
      <header className="panel__header">
        <h2>Recode</h2>
        <p className="panel__subtitle">
          Incolla qui la risposta dell'AI (che contiene gli pseudonimi). I
          pseudonimi vengono sostituiti con i valori originali, in locale, via
          reverse-mapping della tabella di sostituzione.
        </p>
        {isSlideIn && onClose && (
          <button
            type="button"
            className="panel__close"
            onClick={onClose}
            aria-label="Chiudi pannello recode"
            data-testid="recode-close-btn"
          >
            ✕
          </button>
        )}
      </header>

      {hasMapping && (
        <div
          className="recode-mapping-badge"
          data-testid="recode-mapping-badge"
        >
          <strong>{mapping.length}</strong>{' '}
          {mapping.length === 1
            ? 'sostituzione attiva'
            : 'sostituzioni attive'}
        </div>
      )}

      {!hasMapping && (
        <div
          className="hint hint--warning"
          data-testid="recode-no-mapping-hint"
        >
          <strong>Nessuna mappa di sostituzione attiva.</strong>{' '}
          Pseudonimizza prima un documento (bottone &laquo;Pseudonimizza&raquo;
          a sinistra) per popolare la tabella di reverse-mapping. Una volta
          fatto, potrai incollare qui la risposta dell'AI e vedere i nomi
          originali apparire automaticamente sotto.
        </div>
      )}

      <label className="field">
        <span className="field__label">Risposta dell'AI (con pseudonimi)</span>
        <textarea
          className="field__textarea"
          value={claudeResponse}
          onChange={(e) => setClaudeResponse(e.target.value)}
          placeholder="Incolla qui la risposta dell'AI…"
          rows={isSlideIn ? 8 : 10}
          data-testid="claude-response-textarea"
        />
      </label>

      <label className="field">
        <span className="field__label">Risposta recodata</span>
        <textarea
          className="field__textarea field__textarea--readonly"
          value={recoded}
          readOnly
          rows={isSlideIn ? 8 : 10}
          placeholder="Il testo recodato apparirà qui."
          data-testid="recoded-textarea"
        />
      </label>

      <div className="actions">
        <button
          type="button"
          className="btn btn--secondary"
          onClick={handleRecodeNow}
          disabled={!claudeResponse.trim() || !hasMapping}
          data-testid="recode-now-btn"
          title={
            !hasMapping
              ? 'Serve una mappa di sostituzione attiva (pseudonimizza prima un documento).'
              : !claudeResponse.trim()
                ? "Incolla la risposta dell'AI qui sopra."
                : 'Esegui subito il reverse-mapping (succede anche automaticamente dopo qualche istante).'
          }
        >
          Recode
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={handleCopy}
          disabled={!recoded}
          data-testid="copy-recoded-btn"
        >
          {copyState === 'copied' ? '✓ Copiato' : 'Copia finale negli appunti'}
        </button>
      </div>

      {error && (
        <div className="error" role="alert" data-testid="recode-error">
          {error}
        </div>
      )}
    </section>
  )
}
