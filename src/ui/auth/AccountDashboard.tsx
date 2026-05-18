/**
 * AccountDashboard — list saved mappings, false positive preferences, and
 * destructive actions (delete one, bulk-delete by date, nuke account).
 *
 * The blobs themselves are NEVER fetched here: only metadata. Decryption
 * happens on demand from the ClipboardWidget when the user opens a saved
 * mapping for use.
 *
 * Tier-awareness (zero-euro post-migration, 2026-05-19):
 *   - tier='pro' → comportamento storico invariato: lista mapping cifrati
 *     da /recode/mappings, falsi positivi server-side, elimina bulk per data,
 *     elimina account con copy "mapping cifrati".
 *   - tier='free' → mapping vivono in IndexedDB locale e NON c'è UI per
 *     gestirli/listarli (ratificato dal founder: Ockham, cross-doc continuity
 *     resta implicita). Sezioni cloud-only mostrate "disabled / grey" con
 *     paragrafo info; niente fetch /recode/mappings o /recode/false-positives;
 *     elimina account con copy adattata + helper testo browser data.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  ApiError,
  deleteAccount,
  deleteMapping,
  deleteMappingsBulk,
  getFalsePositives,
  getMyProRequest,
  listMappings,
  requestProInvite,
  type FalsePositiveEntry,
  type MappingMetadata,
  type ProInviteRequestRow,
} from '../../api/client'
import { useAuth } from '../../auth/auth-context'
import { useActiveMapping } from '../../auth/active-mapping-context'

const PRO_REASON_MIN = 25
const PRO_REASON_MAX = 1000

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
  const isPro = user?.tier === 'pro'
  const [mappings, setMappings] = useState<MappingMetadata[]>([])
  const [fps, setFps] = useState<Array<FalsePositiveEntry & { marked_at: string }>>(
    [],
  )
  const [loading, setLoading] = useState(isPro)
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
  // Pro upgrade funnel (visible only to tier='free').
  const [proReason, setProReason] = useState('')
  const [proSubmitting, setProSubmitting] = useState(false)
  const [proError, setProError] = useState<string | null>(null)
  const [proRequest, setProRequest] = useState<ProInviteRequestRow | null>(null)

  const refresh = useCallback(async () => {
    // tier='free': nessuna risorsa cloud-side da fetchare — i mapping vivono
    // in IndexedDB del browser e la dashboard è informativa.
    if (!isPro) {
      setLoading(false)
      return
    }
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
  }, [isPro])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Hydrate the pro-invite request status (free tier only) so a returning user
  // doesn't see the request form again after submitting.
  useEffect(() => {
    if (isPro) return
    let cancelled = false
    void (async () => {
      try {
        const { request } = await getMyProRequest()
        if (!cancelled) setProRequest(request)
      } catch {
        // Non-fatal — the form simply stays in its default state.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isPro])

  async function onSubmitProRequest(ev: FormEvent) {
    ev.preventDefault()
    setProError(null)
    const reason = proReason.trim()
    if (reason.length < PRO_REASON_MIN) {
      setProError(
        `Spiega in almeno ${PRO_REASON_MIN} caratteri come pensi di usare Recode IT.`,
      )
      return
    }
    try {
      setProSubmitting(true)
      const created = await requestProInvite(reason)
      setProRequest({
        request_id: created.request_id,
        status: created.status,
        requested_at: created.requested_at,
        approved_at: null,
        claimed_at: null,
        rejected_at: null,
        invite_expires_at: null,
      })
      setProReason('')
    } catch (err) {
      setProError(
        err instanceof ApiError ? err.message : 'Errore di rete. Riprova.',
      )
    } finally {
      setProSubmitting(false)
    }
  }

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

      {isPro ? (
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
      ) : (
        <section
          className="panel panel--disabled"
          aria-disabled="true"
          data-testid="free-mappings-panel"
        >
          <h3 className="muted">Mapping salvati</h3>
          <p className="hint" data-testid="free-mappings-info">
            I tuoi mapping sono salvati localmente in questo browser. Recode IT
            li riconosce automaticamente quando riapri un documento. La gestione
            e la lista dei mapping è disponibile con il piano €25 una tantum.
          </p>
        </section>
      )}

      {!isPro && (
        <section className="panel" data-testid="pro-request-section">
          <h3>Richiedi accesso al piano pro</h3>
          <p>
            Il piano pro sblocca: gestione mapping multipli con etichette,
            cloud cifrato zero-knowledge cross-device, recovery codes. Costo
            previsto: <strong>€25 una tantum</strong>. In Phase 1 (su invito
            gratuito).
          </p>
          {proRequest && proRequest.status === 'pending' && (
            <p className="hint" data-testid="pro-request-pending">
              Richiesta ricevuta — ti contattiamo via email. Stato:{' '}
              <strong>in attesa</strong>.
            </p>
          )}
          {proRequest && proRequest.status === 'approved' && (
            <p className="hint" data-testid="pro-request-approved">
              Invito approvato — controlla la tua email per il link al
              checkout.
            </p>
          )}
          {proRequest && proRequest.status === 'rejected' && (
            <p className="hint" data-testid="pro-request-rejected">
              La richiesta precedente è stata declinata. Puoi inviarne una
              nuova.
            </p>
          )}
          {(!proRequest ||
            proRequest.status === 'rejected' ||
            proRequest.status === 'expired') && (
            <form
              onSubmit={(e) => void onSubmitProRequest(e)}
              data-testid="pro-request-form"
            >
              <label className="field">
                <span className="field__label">
                  Spiega brevemente come pensi di usare Recode IT (almeno{' '}
                  {PRO_REASON_MIN} caratteri).
                </span>
                <textarea
                  value={proReason}
                  onChange={(e) => setProReason(e.target.value)}
                  className="auth-input"
                  rows={5}
                  maxLength={PRO_REASON_MAX}
                  data-testid="pro-request-reason"
                  placeholder="Es: avvocato civilista a Milano, uso Claude per analisi atti, mi serve il cloud cross-device…"
                />
                <span className="muted" data-testid="pro-request-counter">
                  {proReason.trim().length} / {PRO_REASON_MAX} caratteri
                </span>
              </label>
              {proError && (
                <p className="error" data-testid="pro-request-error">
                  {proError}
                </p>
              )}
              <button
                type="submit"
                className="btn btn--primary"
                disabled={proSubmitting || proReason.trim().length < PRO_REASON_MIN}
                data-testid="pro-request-submit"
              >
                {proSubmitting ? 'Invio…' : 'Invia richiesta'}
              </button>
            </form>
          )}
        </section>
      )}

      {isPro ? (
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
      ) : (
        <section
          className="panel panel--disabled"
          aria-disabled="true"
          data-testid="free-fps-panel"
        >
          <h3 className="muted">Falsi positivi memorizzati</h3>
          <p className="hint" data-testid="free-fps-info">
            I falsi positivi che marchi durante la pseudonimizzazione restano
            attivi nella sessione corrente. La memorizzazione persistente lato
            account è disponibile con il piano €25 una tantum.
          </p>
        </section>
      )}

      <section className="panel panel--danger">
        <h3>Elimina definitivamente l'account</h3>
        {isPro ? (
          <p className="hint">
            Operazione irreversibile. Account + recovery codes + mapping cifrati
            + preferenze: tutto cancellato.
          </p>
        ) : (
          <p className="hint" data-testid="delete-account-copy-free">
            Operazione irreversibile. Account + recovery codes: tutto cancellato.
            I mapping locali nel tuo browser restano fino a quando non cancelli
            i dati del sito (vedi sotto).
          </p>
        )}
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

      {!isPro && (
        <p
          className="hint account-dashboard__browser-data-helper"
          data-testid="browser-data-helper"
        >
          Per cancellare i mapping locali di Recode IT dal tuo browser: apri le
          impostazioni del browser → Privacy / Dati siti → Cancella dati per il
          sito <code>recode.micheleloi.pro</code>.
        </p>
      )}
    </section>
  )
}
