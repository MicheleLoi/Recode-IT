/**
 * AccountDashboard — list saved mappings, false positive preferences, and
 * destructive actions (delete one, bulk-delete by date, nuke account).
 *
 * The blobs themselves are NEVER fetched here: only metadata. Decryption
 * happens on demand from the ClipboardWidget when the user opens a saved
 * mapping for use.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  ApiError,
  deleteAccount,
  deleteMapping,
  deleteMappingsBulk,
  getFalsePositives,
  listMappings,
  type FalsePositiveEntry,
  type MappingMetadata,
} from '../../api/client'
import { useAuth } from '../../auth/auth-context'

type Props = {
  onBack?: () => void
}

export function AccountDashboard({ onBack }: Props): JSX.Element {
  const { user, logout } = useAuth()
  const [mappings, setMappings] = useState<MappingMetadata[]>([])
  const [fps, setFps] = useState<Array<FalsePositiveEntry & { marked_at: string }>>(
    [],
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [olderThan, setOlderThan] = useState('')
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [deletePassword, setDeletePassword] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [m, f] = await Promise.all([listMappings(), getFalsePositives()])
      setMappings(m.mappings)
      setFps(f.false_positives)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Errore di rete.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function onDeleteOne(id: string) {
    try {
      await deleteMapping(id)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Errore di rete.')
    }
  }

  async function onBulkDelete() {
    if (!olderThan) return
    try {
      const r = await deleteMappingsBulk({ olderThan })
      setError(null)
      alert(`Mapping eliminati: ${r.deleted}`)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Errore di rete.')
    }
  }

  async function onNuke() {
    if (deleteConfirmation !== 'DELETE MY ACCOUNT') {
      setError('Per confermare scrivi DELETE MY ACCOUNT.')
      return
    }
    if (!deletePassword) {
      setError('Inserisci la password per confermare.')
      return
    }
    try {
      await deleteAccount(deletePassword)
      await logout()
      if (onBack) onBack()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Errore di rete.')
    }
  }

  return (
    <section className="account-dashboard">
      <div className="account-dashboard__header">
        <h2>Account: {user?.email}</h2>
        {onBack && (
          <button className="btn btn--secondary" onClick={onBack}>
            Torna allo strumento
          </button>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      <section className="panel">
        <h3>Mapping salvati ({mappings.length})</h3>
        {loading && <p>Carico...</p>}
        {!loading && mappings.length === 0 && (
          <p className="review-empty">Nessun mapping salvato.</p>
        )}
        <ul className="account-mappings">
          {mappings.map((m) => (
            <li key={m.mapping_id} className="account-mappings__row">
              <div>
                <strong>{m.label ?? '(senza etichetta)'}</strong>
                <span className="muted">
                  {' '}
                  {m.doc_type ?? '—'} · {m.size_bytes} byte ·{' '}
                  {new Date(m.created_at).toLocaleString('it-IT')}
                </span>
              </div>
              <button
                className="btn btn--danger"
                onClick={() => onDeleteOne(m.mapping_id)}
              >
                Elimina
              </button>
            </li>
          ))}
        </ul>

        <div className="bulk-delete">
          <label className="field">
            <span className="field__label">
              Elimina mapping creati prima di (YYYY-MM-DD)
            </span>
            <input
              type="date"
              value={olderThan}
              onChange={(e) => setOlderThan(e.target.value)}
              className="auth-input"
            />
          </label>
          <button
            className="btn btn--danger"
            onClick={onBulkDelete}
            disabled={!olderThan}
          >
            Elimina in blocco
          </button>
        </div>
      </section>

      <section className="panel">
        <h3>Falsi positivi memorizzati ({fps.length})</h3>
        {fps.length === 0 && (
          <p className="review-empty">
            Nessun falso positivo segnato finora.
          </p>
        )}
        <ul className="account-fps">
          {fps.map((fp, i) => (
            <li key={`${fp.term}::${fp.category}::${i}`}>
              <code>{fp.term}</code> — <em>{fp.category}</em>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel panel--danger">
        <h3>Elimina definitivamente l'account</h3>
        <p className="hint">
          Operazione irreversibile. Account + recovery codes + mapping cifrati
          + preferenze: tutto cancellato.
        </p>
        <label className="field">
          <span className="field__label">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={deletePassword}
            onChange={(e) => setDeletePassword(e.target.value)}
            className="auth-input"
          />
        </label>
        <label className="field">
          <span className="field__label">
            Scrivi <code>DELETE MY ACCOUNT</code> per confermare
          </span>
          <input
            type="text"
            value={deleteConfirmation}
            onChange={(e) => setDeleteConfirmation(e.target.value)}
            className="auth-input"
          />
        </label>
        <button
          className="btn btn--danger"
          onClick={onNuke}
          disabled={
            deleteConfirmation !== 'DELETE MY ACCOUNT' || !deletePassword
          }
        >
          Elimina account
        </button>
      </section>
    </section>
  )
}
