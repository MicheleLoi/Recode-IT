/**
 * RecodePanel — right panel of the clipboard widget.
 *
 * The user pastes Claude's response (still containing pseudonyms) and the
 * panel automatically reverses the substitution using the in-memory mapping
 * from the pseudonymize step. The recode runs debounced (~500ms) so each
 * keystroke doesn't trigger a re-run.
 */

import { useEffect, useState } from 'react'
import { recodeText } from '../engine/recode'
import type { MappingEntry } from '../types/engine'

type Props = {
  mapping: MappingEntry[]
}

const DEBOUNCE_MS = 500

export function RecodePanel({ mapping }: Props): JSX.Element {
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

  return (
    <section className="panel panel--recode" aria-label="Recoding">
      <header className="panel__header">
        <h2>Recode</h2>
        <p className="panel__subtitle">
          Incolla qui la risposta di Claude. I pseudonimi vengono sostituiti con
          i valori originali in locale.
        </p>
      </header>

      {!hasMapping && (
        <p className="hint" data-testid="recode-no-mapping-hint">
          Pseudonimizza prima un documento per popolare la mappa di sostituzione.
        </p>
      )}

      <label className="field">
        <span className="field__label">Risposta di Claude (con pseudonimi)</span>
        <textarea
          className="field__textarea"
          value={claudeResponse}
          onChange={(e) => setClaudeResponse(e.target.value)}
          placeholder="Incolla qui la risposta di Claude…"
          rows={10}
          data-testid="claude-response-textarea"
        />
      </label>

      <label className="field">
        <span className="field__label">Risposta recodata</span>
        <textarea
          className="field__textarea field__textarea--readonly"
          value={recoded}
          readOnly
          rows={10}
          placeholder="Il testo recodato apparirà qui."
          data-testid="recoded-textarea"
        />
      </label>

      <div className="actions">
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
