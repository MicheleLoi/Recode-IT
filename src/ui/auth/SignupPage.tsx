/**
 * SignupPage — collects email + password and surfaces the 10 recovery codes
 * exactly once. The codes display is the most consequential UI moment in
 * Phase 3 (see OPEN_RISKS.md §R-05): the user MUST grasp that recovery
 * code use destroys all saved mappings.
 */

import { useState } from 'react'
import { ApiError } from '../../api/client'
import { useAuth } from '../../auth/auth-context'
import { useLanguage } from '../LanguageContext'

type Props = {
  onSignedUp?: (email: string) => void
  onSwitchToLogin?: () => void
}

export function SignupPage({ onSignedUp, onSwitchToLogin }: Props): JSX.Element {
  const { signup } = useAuth()
  const { t } = useLanguage()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [marketingConsent, setMarketingConsent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [codes, setCodes] = useState<string[] | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault()
    setError(null)
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('Inserisci il tuo nome (anche solo nome di battesimo).')
      return
    }
    if (trimmedName.length > 256) {
      setError('Il nome può avere al massimo 256 caratteri.')
      return
    }
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
      const resp = await signup({
        email: email.trim().toLowerCase(),
        password,
        name: trimmedName,
        marketing_consent_requested: marketingConsent,
      })
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
        <h2>{t('auth.signup.codes.title')}</h2>
        <p>{t('auth.signup.codes.saveNotice')}</p>
        <p className="hint">{t('auth.signup.codes.preservesNotice')}</p>
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
          {t('auth.signup.codes.acknowledge')}
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
            {t('auth.signup.codes.goToLogin')}
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
          <span className="field__label">Nome</span>
          <input
            type="text"
            required
            autoComplete="name"
            maxLength={256}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="auth-input"
          />
        </label>
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
        <label className="field field--checkbox">
          <input
            type="checkbox"
            checked={marketingConsent}
            onChange={(e) => setMarketingConsent(e.target.checked)}
          />
          <span>
            Voglio ricevere occasionalmente aggiornamenti sul prodotto via
            email (puoi disiscriverti in qualsiasi momento).
          </span>
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
              Ho già un account
            </button>
          )}
        </div>
      </form>
    </section>
  )
}
