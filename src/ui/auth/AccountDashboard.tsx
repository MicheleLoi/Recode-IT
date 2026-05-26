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
import { useLanguage } from '../LanguageContext'

// Post-pivot 2026-05-24/25: Pro €25 cloud zero-knowledge è parcheggiato fuori
// landing principale (paywall Decodifica €20 è il canale primario). La sezione
// "Richiedi accesso al piano pro" mostrata pre-pivot in questa dashboard è
// stata rimossa: il componente UpgradePage.tsx resta valido per quando Pro si
// riattiva, e backend + api/client (getMyProRequest/requestProInvite) restano
// committed dietro env vars. Reattivazione: reintrodurre qui un blocco
// dedicato — non riproporre il vecchio in quanto il pricing canon è cambiato.

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
  // active + deleteActive needed for free-tier "I miei mapping" card
  // (canon 2026-05-26: C1 visibility — voce locale visibile solo dopo
  // prima codifica, empty state finché entries=0).
  const { active, openMapping, deleteActive } = useActiveMapping()
  const { t } = useLanguage()
  const isPro = user?.tier === 'pro'
  // Inline confirm before deleting the local mapping (free tier).
  const [confirmDeleteLocal, setConfirmDeleteLocal] = useState(false)
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
    if (deleteConfirmation !== 'ELIMINA IL MIO ACCOUNT') {
      setError('Per confermare scrivi ELIMINA IL MIO ACCOUNT.')
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
        <>
          {/*
            Free-tier "I miei mapping" — ATTIVA con visibility C1 (canon
            2026-05-26 _org/decision_log.md): empty state card-level finché
            entries=0; voce mapping locale con metadata + actions quando
            entries>0. Bottone "Elimina mapping" nascosto in empty state
            (coerente con C1 — voce assente, niente da eliminare).
          */}
          <section className="panel" data-testid="free-mappings-panel">
            <h3>{t('dashboard.localMapping.empty.title')}</h3>
            {!active || active.entries.length === 0 ? (
              <p className="hint" data-testid="free-mappings-empty">
                {t('dashboard.localMapping.empty.body')}
              </p>
            ) : (
              <ul className="account-mappings">
                <li
                  className="account-mappings__row"
                  data-testid="local-mapping-row"
                >
                  <div>
                    <strong>{t('dashboard.localMapping.label')}</strong>
                    <span className="muted">
                      {' · '}
                      {t('dashboard.localMapping.metadata.pseudonyms').replace(
                        '{n}',
                        String(active.entries.length),
                      )}
                    </span>
                    {confirmDeleteLocal && (
                      <p className="hint" data-testid="local-mapping-delete-confirm">
                        {t('banner.active.deleteConfirm')}
                      </p>
                    )}
                  </div>
                  <div className="account-mappings__row-actions">
                    <button
                      className="btn btn--primary"
                      onClick={() => {
                        if (onOpened) onOpened()
                      }}
                      data-testid="local-mapping-goto-tool"
                    >
                      {t('dashboard.localMapping.actions.goToTool')}
                    </button>
                    {!confirmDeleteLocal ? (
                      <button
                        className="btn btn--danger"
                        onClick={() => setConfirmDeleteLocal(true)}
                        data-testid="local-mapping-delete"
                      >
                        {t('dashboard.localMapping.actions.delete')}
                      </button>
                    ) : (
                      <>
                        <button
                          className="btn btn--danger"
                          onClick={() => {
                            void deleteActive().finally(() =>
                              setConfirmDeleteLocal(false),
                            )
                          }}
                          data-testid="local-mapping-delete-confirm-btn"
                        >
                          {t('dashboard.localMapping.actions.delete')}
                        </button>
                        <button
                          className="btn btn--secondary"
                          onClick={() => setConfirmDeleteLocal(false)}
                          data-testid="local-mapping-delete-cancel-btn"
                        >
                          Annulla
                        </button>
                      </>
                    )}
                  </div>
                </li>
              </ul>
            )}
          </section>
          {/*
            Pro upsell card — SOTTO la voce attiva (NON sopra), coerente con
            audience Tipo 1 sovranità dati: l'invito Pro non precede mai la
            voce primary (no effetto pubblicitario invasivo). Email
            destinazione: mhcl@micheleloi.pro (stessa di PrivacyPage.tsx:113
            e UpgradePage.tsx:81 — nessuna const dedicata trovata in src/).
          */}
          <section
            className="panel panel--upsell"
            data-testid="pro-upsell-panel"
          >
            <h3>{t('dashboard.proUpsell.title')}</h3>
            <p>{t('dashboard.proUpsell.body')}</p>
            <a
              href="mailto:mhcl@micheleloi.pro"
              className="btn btn--secondary"
              data-testid="pro-upsell-cta"
            >
              {t('dashboard.proUpsell.cta')}
            </a>
          </section>
        </>
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
            attivi nella sessione corrente del browser. Non vengono salvati
            sui nostri server.
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
            Scrivi <code>ELIMINA IL MIO ACCOUNT</code> per confermare
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
            deleteConfirmation !== 'ELIMINA IL MIO ACCOUNT' || !deletePassword
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
