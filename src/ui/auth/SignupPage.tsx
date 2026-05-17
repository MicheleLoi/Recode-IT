/**
 * SignupPage — collects email + password and surfaces the 10 recovery codes
 * exactly once. The codes display is the most consequential UI moment in
 * Phase 3 (see OPEN_RISKS.md §R-05): the user MUST grasp that recovery
 * code use destroys all saved mappings.
 */

import { useState } from 'react'
import { ApiError } from '../../api/client'
import { useAuth } from '../../auth/auth-context'

type Props = {
  onSignedUp?: (email: string) => void
  onSwitchToLogin?: () => void
}

export function SignupPage({ onSignedUp, onSwitchToLogin }: Props): JSX.Element {
  const { signup } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [codes, setCodes] = useState<string[] | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault()
    setError(null)
    if (password !== password2) {
      setError('Le due password non coincidono.')
      return
    }
    if (password.length < 12) {
      setError('La password deve avere almeno 12 caratteri.')
      return
    }
    setSubmitting(true)
    try {
      const resp = await signup(email.trim().toLowerCase(), password)
      setCodes(resp.recovery_codes)
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
      } else {
        setError('Errore inatteso durante la registrazione.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (codes) {
    return (
      <section className="auth-card">
        <h2>Account creato</h2>
        <p>
          Salva subito questi <strong>10 codici di recupero</strong>. Non
          saranno mostrati di nuovo. Se perdi la password e non hai i codici,
          tutti i mapping salvati saranno irrecuperabili (architettura
          zero-knowledge: il server non puo' decriptarli senza la tua
          password).
        </p>
        <ul className="recovery-codes">
          {codes.map((c) => (
            <li key={c}>
              <code>{c}</code>
            </li>
          ))}
        </ul>
        <label className="auth-acknowledge">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
          />
          Ho copiato i 10 codici in un posto sicuro.
        </label>
        <div className="actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={!acknowledged}
            onClick={() => {
              if (onSignedUp) onSignedUp(email)
              if (onSwitchToLogin) onSwitchToLogin()
            }}
          >
            Vai al login
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="auth-card">
      <h2>Crea un account Recode IT</h2>
      <form onSubmit={onSubmit} className="auth-form">
        <label className="field">
          <span className="field__label">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="auth-input"
          />
        </label>
        <label className="field">
          <span className="field__label">
            Password (min 12 caratteri)
          </span>
          <input
            type="password"
            required
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="auth-input"
          />
        </label>
        <label className="field">
          <span className="field__label">Conferma password</span>
          <input
            type="password"
            required
            autoComplete="new-password"
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
            className="auth-input"
          />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="submit" className="btn btn--primary" disabled={submitting}>
            {submitting ? 'Creo l\'account...' : 'Crea account'}
          </button>
          {onSwitchToLogin && (
            <button
              type="button"
              className="btn btn--secondary"
              onClick={onSwitchToLogin}
            >
              Ho gia' un account
            </button>
          )}
        </div>
      </form>
    </section>
  )
}
