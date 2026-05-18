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
import { useActiveMapping } from '../../auth/active-mapping-context'

type Props = {
  onBack?: () => void
  /**
   * Called after a saved mapping has been opened (decrypt + seed). The parent
   * (App.tsx) uses this to navigate back to the work view so the user lands
   * in the pseudonymize panel with the active-mapping banner visible.
   */
  onOpened?: () => void
}

export function AccountDashboard({ onBack, onOpened }: Props): JSX.Element {
  const { user, logout, masterKey, unlock } = useAuth()
  const { openMapping } = useActiveMapping()
  const [mappings, setMappings] = useState<MappingMetadata[]>([])
  const [fps, setFps] = useState<Array<FalsePositiveEntry & { marked_at: string }>>(
    [],
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [olderThan, setOlderThan] = useState('')
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [deletePassword, setDeletePassword] = useState('')
  // Inline unlock prompt: if the user re-opened the tab the JWT cookie may
  // restore the session, but the master key (in-memory only) is gone. Asking
  // for the password here re-derives it without leaving the browser.
  const [unlockPassword, setUnlockPassword] = useState('')
  const [unlockingId, setUnlockingId] = useState<string | null>(null)
  const [openingId, setOpeningId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [m, f] = await Promise.all([listMappings(), getFalsePositives()])
      // Sort by last_accessed_at desc (server order is created_at desc). This
      // matches the capabilities_index §7 spec: most-recently-touched first.
      const sorted = [...m.mappings].sort((a, b) => {
        const ta = a.last_accessed_at ?? a.created_at
        const tb = b.last_accessed_at ?? b.created_at
        return tb.localeCompare(ta)
      })
      setMappings(sorted)
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

  async function onOpen(id: string) {
    setError(null)
    if (!masterKey) {
      // No key in memory yet — surface the inline unlock prompt for this row
      // (a fresh login derives the key automatically, so this only happens
      // after a refresh while the JWT cookie is still valid).
      setUnlockingId(id)
      return
    }
    try {
      setOpeningId(id)
      await openMapping(id)
      if (onOpened) onOpened()
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? `Impossibile aprire il mapping: ${err.message}`
            : 'Errore inatteso aprendo il mapping.',
      )
    } finally {
      setOpeningId(null)
    }
  }

  async function onUnlockAndOpen(id: string) {
    setError(null)
    try {
      await unlock(unlockPassword)
      setUnlockPassword('')
      setUnlockingId(null)
      setOpeningId(id)
      await openMapping(id)
      if (onOpened) onOpened()
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Sblocco fallito.',
      )
    } finally {
      setOpeningId(null)
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
            <li
              key={m.mapping_id}
              className="account-mappings__row"
              data-testid={`mapping-row-${m.mapping_id}`}
            >
              <div>
                <strong>{m.label ?? '(senza etichetta)'}</strong>
                <span className="muted">
                  {' '}
                  {m.doc_type ?? '—'} · {m.size_bytes} byte ·{' '}
                  {new Date(m.created_at).toLocaleString('it-IT')}
                  {m.last_accessed_at && (
                    <>
                      {' · ultimo accesso '}
                      {new Date(m.last_accessed_at).toLocaleString('it-IT')}
                    </>
                  )}
                </span>
                {unlockingId === m.mapping_id && (
                  <div className="account-mappings__unlock">
                    <p className="hint">
                      Master key non in memoria. Inserisci la password per
                      decifrare e aprire <strong>{m.label}</strong>.
                    </p>
                    <input
                      type="password"
                      className="auth-input"
                      value={unlockPassword}
                      onChange={(e) => setUnlockPassword(e.target.value)}
                      placeholder="Password"
                      data-testid={`unlock-input-${m.mapping_id}`}
                    />
                    <div className="actions">
                      <button
                        type="button"
                        className="btn btn--primary"
                        onClick={() => void onUnlockAndOpen(m.mapping_id)}
                        disabled={!unlockPassword}
                      >
                        Sblocca e apri
                      </button>
                      <button
                        type="button"
                        className="btn btn--secondary"
                        onClick={() => {
                          setUnlockingId(null)
                          setUnlockPassword('')
                        }}
                      >
                        Annulla
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <div className="account-mappings__row-actions">
                <button
                  className="btn btn--primary"
                  onClick={() => void onOpen(m.mapping_id)}
                  disabled={openingId === m.mapping_id}
                  data-testid={`open-mapping-${m.mapping_id}`}
                >
                  {openingId === m.mapping_id ? 'Apro…' : 'Apri'}
                </button>
                <button
                  className="btn btn--danger"
                  onClick={() => onDeleteOne(m.mapping_id)}
                  data-testid={`delete-mapping-${m.mapping_id}`}
                >
                  Elimina
                </button>
              </div>
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
