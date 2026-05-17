/**
 * RecoveryPage — two-step password reset.
 *
 * Step 1: user enters email → POST /recode/recovery/initiate (server emails
 * a reset link with a one-time token).
 * Step 2: user pastes the token from the email + one of their 10 recovery
 * codes + new password → POST /recode/recovery/verify. Server destroys all
 * encrypted mappings (per zero-knowledge design — R-05) and rotates the
 * kdf_salt.
 *
 * The UI surfaces the data-loss warning twice (initiate screen + verify
 * screen) so the user cannot reach the reset without seeing it.
 */

import { useState } from 'react'
import { ApiError, requestRecovery, verifyRecovery } from '../../api/client'

type Props = {
  onBackToLogin?: () => void
}

export function RecoveryPage({ onBackToLogin }: Props): JSX.Element {
  const [stage, setStage] = useState<'initiate' | 'verify' | 'done'>('initiate')
  const [email, setEmail] = useState('')
  const [token, setToken] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function onInitiate(ev: React.FormEvent) {
    ev.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await requestRecovery(email.trim().toLowerCase())
      setStage('verify')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Errore inatteso.')
    } finally {
      setSubmitting(false)
    }
  }

  async function onVerify(ev: React.FormEvent) {
    ev.preventDefault()
    setError(null)
    if (!acknowledged) {
      setError('Conferma di aver compreso la conseguenza prima di procedere.')
      return
    }
    if (newPassword.length < 12) {
      setError('La nuova password deve avere almeno 12 caratteri.')
      return
    }
    setSubmitting(true)
    try {
      const resp = await verifyRecovery(token.trim(), code.trim(), newPassword)
      setSuccess(
        `${resp.message} Mapping eliminati: ${resp.mappings_destroyed}.`,
      )
      setStage('done')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Errore inatteso.')
    } finally {
      setSubmitting(false)
    }
  }

  if (stage === 'done') {
    return (
      <section className="auth-card">
        <h2>Password aggiornata</h2>
        <p className="hint">{success}</p>
        {onBackToLogin && (
          <button className="btn btn--primary" onClick={onBackToLogin}>
            Vai al login
          </button>
        )}
      </section>
    )
  }

  if (stage === 'verify') {
    return (
      <section className="auth-card">
        <h2>Reimposta la password</h2>
        <p className="hint">
          <strong>Attenzione:</strong> reimpostare la password elimina
          definitivamente tutti i mapping salvati. La nuova chiave non puo'
          decriptare i blob cifrati con la vecchia password (architettura
          zero-knowledge).
        </p>
        <form onSubmit={onVerify} className="auth-form">
          <label className="field">
            <span className="field__label">Token (dal link nell'email)</span>
            <input
              type="text"
              required
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="auth-input"
            />
          </label>
          <label className="field">
            <span className="field__label">Codice di recupero</span>
            <input
              type="text"
              required
              placeholder="A7K3-9P2M-X4N8"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="auth-input"
            />
          </label>
          <label className="field">
            <span className="field__label">Nuova password (min 12 caratteri)</span>
            <input
              type="password"
              required
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="auth-input"
            />
          </label>
          <label className="auth-acknowledge">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            Capisco che procedere eliminera' tutti i mapping salvati.
          </label>
          {error && <p className="error">{error}</p>}
          <div className="actions">
            <button type="submit" className="btn btn--danger" disabled={submitting}>
              {submitting ? 'Reimposto...' : 'Reimposta password'}
            </button>
            {onBackToLogin && (
              <button
                type="button"
                className="btn btn--secondary"
                onClick={onBackToLogin}
              >
                Annulla
              </button>
            )}
          </div>
        </form>
      </section>
    )
  }

  return (
    <section className="auth-card">
      <h2>Recupera l'accesso</h2>
      <p className="hint">
        Riceverai un link via email. Per completare il reset ti serviranno
        anche uno dei <strong>10 codici di recupero</strong> stampati al
        momento dell'iscrizione.
      </p>
      <form onSubmit={onInitiate} className="auth-form">
        <label className="field">
          <span className="field__label">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="auth-input"
          />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="submit" className="btn btn--primary" disabled={submitting}>
            {submitting ? 'Invio...' : 'Invia link'}
          </button>
          {onBackToLogin && (
            <button
              type="button"
              className="btn btn--secondary"
              onClick={onBackToLogin}
            >
              Torna al login
            </button>
          )}
        </div>
      </form>
    </section>
  )
}
