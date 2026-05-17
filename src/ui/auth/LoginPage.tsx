/**
 * LoginPage — email + password form. Successful login derives the master
 * key client-side via Argon2id and stores it ONLY in auth-context memory.
 */

import { useState } from 'react'
import { ApiError } from '../../api/client'
import { useAuth } from '../../auth/auth-context'

type Props = {
  onSwitchToSignup?: () => void
  onSwitchToRecovery?: () => void
}

export function LoginPage({ onSwitchToSignup, onSwitchToRecovery }: Props): JSX.Element {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(email.trim().toLowerCase(), password)
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
      } else {
        setError('Errore inatteso durante il login.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="auth-card">
      <h2>Accedi a Recode IT</h2>
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
          <span className="field__label">Password</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="auth-input"
          />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="submit" className="btn btn--primary" disabled={submitting}>
            {submitting ? 'Accesso in corso...' : 'Accedi'}
          </button>
          {onSwitchToSignup && (
            <button
              type="button"
              className="btn btn--secondary"
              onClick={onSwitchToSignup}
            >
              Crea un account
            </button>
          )}
          {onSwitchToRecovery && (
            <button
              type="button"
              className="btn btn--secondary"
              onClick={onSwitchToRecovery}
            >
              Password dimenticata
            </button>
          )}
        </div>
      </form>
    </section>
  )
}
