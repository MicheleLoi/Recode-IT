/**
 * RecoveryPage — password reset via email link + recovery code.
 *
 * Framing (founder MHC-Work SID-20260524-051552 evening): reassurance, not
 * threat. For Free users the recovery flow leaves the account, the bought
 * permissions, and the IndexedDB mappings on this device untouched — the
 * old wording was a tier-blind threat that scared Free users into
 * abandoning recovery and losing permanent account access. For Pro
 * users the server-side encrypted blob
 * backup IS lost on recovery (kdf_salt rotates, new key can't decrypt old
 * blobs) — that warning lives in the tier-aware email body (see
 * backend/mailer.py::send_password_reset_email), surfaced where it actually
 * matters: when the user reads the email tied to their Pro account.
 *
 * Flow:
 *   Stage 1 — initiate: enter email → server sends link.
 *   Stage 2 — verify: token (auto-filled from link query param when
 *             present) + recovery code + new password → reset done.
 */

import { useEffect, useState } from 'react'
import { ApiError, requestRecovery, verifyRecovery } from '../../api/client'
import { useLanguage } from '../LanguageContext'
import { localizeApiError } from './errors'

type Props = {
  onBackToLogin?: () => void
}

type Stage = 'initiate' | 'sent' | 'verify' | 'done'

function readTokenFromUrl(): string {
  if (typeof window === 'undefined') return ''
  try {
    const params = new URLSearchParams(window.location.search)
    return (params.get('token') ?? '').trim()
  } catch {
    return ''
  }
}

export function RecoveryPage({ onBackToLogin }: Props): JSX.Element {
  const { t } = useLanguage()
  const urlToken = readTokenFromUrl()
  const [stage, setStage] = useState<Stage>(urlToken ? 'verify' : 'initiate')
  const [email, setEmail] = useState('')
  const [token, setToken] = useState(urlToken)
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    if (urlToken && !token) setToken(urlToken)
  }, [urlToken, token])

  async function onInitiate(ev: React.FormEvent) {
    ev.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await requestRecovery(email.trim().toLowerCase())
      // Do NOT auto-transition to 'verify'. The user must click the link
      // in the email to arrive on the reset form with the security token
      // pre-filled via URL query param. Founder direttiva SID-20260524-
      // 051552 evening V: auto-transition was UX bug — Stage 3 form had
      // no usable input path without the URL token, since the email does
      // not contain the token as plaintext (security + UX consistency).
      setStage('sent')
    } catch (err) {
      setError(err instanceof ApiError ? localizeApiError(err, t) : t('auth.recovery.error.generic'))
    } finally {
      setSubmitting(false)
    }
  }

  async function onVerify(ev: React.FormEvent) {
    ev.preventDefault()
    setError(null)
    if (newPassword.length < 12) {
      setError(t('auth.recovery.error.weakPassword'))
      return
    }
    setSubmitting(true)
    try {
      const resp = await verifyRecovery(token.trim(), code.trim(), newPassword)
      const destroyedNote =
        resp.mappings_destroyed > 0
          ? t('auth.recovery.done.proDestroyed').replace(
              '{count}',
              String(resp.mappings_destroyed),
            )
          : t('auth.recovery.done.freePreserved')
      setSuccess(`${resp.message} ${destroyedNote}`)
      setStage('done')
    } catch (err) {
      setError(err instanceof ApiError ? localizeApiError(err, t) : t('auth.recovery.error.generic'))
    } finally {
      setSubmitting(false)
    }
  }

  if (stage === 'done') {
    return (
      <section className="auth-card">
        <h2>{t('auth.recovery.done.title')}</h2>
        <p className="hint">{success}</p>
        {onBackToLogin && (
          <button className="btn btn--primary" onClick={onBackToLogin}>
            {t('auth.recovery.done.goToLogin')}
          </button>
        )}
      </section>
    )
  }

  if (stage === 'sent') {
    return (
      <section className="auth-card">
        <h2>{t('auth.recovery.sent.title')}</h2>
        <p className="hint">{t('auth.recovery.sent.hint')}</p>
        {onBackToLogin && (
          <button className="btn btn--primary" onClick={onBackToLogin}>
            {t('auth.recovery.sent.backToLogin')}
          </button>
        )}
      </section>
    )
  }

  if (stage === 'verify') {
    const tokenFromLink = urlToken.length > 0 && token === urlToken
    return (
      <section className="auth-card">
        <h2>{t('auth.recovery.verify.title')}</h2>
        <p className="hint">{t('auth.recovery.verify.hint')}</p>
        <form onSubmit={onVerify} className="auth-form" data-testid="recovery-verify-form">
          {tokenFromLink ? (
            <div
              className="field"
              data-testid="recovery-token-from-link"
              aria-live="polite"
            >
              <span className="field__label">
                {t('auth.recovery.verify.tokenLabel')}
              </span>
              <p className="hint" style={{ margin: 0 }}>
                {t('auth.recovery.verify.tokenFromLink')}
              </p>
            </div>
          ) : (
            <label className="field">
              <span className="field__label">
                {t('auth.recovery.verify.tokenLabelManual')}
              </span>
              <input
                type="text"
                required
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="auth-input"
                data-testid="recovery-token-input"
              />
              <span className="hint">
                {t('auth.recovery.verify.tokenHintMissing')}
              </span>
            </label>
          )}
          <label className="field">
            <span className="field__label">
              {t('auth.recovery.verify.codeLabel')}
            </span>
            <input
              type="text"
              required
              placeholder="XXXX-XXXX-XXXX"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="auth-input"
              data-testid="recovery-code-input"
            />
          </label>
          <label className="field">
            <span className="field__label">
              {t('auth.recovery.verify.newPasswordLabel')}
            </span>
            <input
              type="password"
              required
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="auth-input"
              data-testid="recovery-newpassword-input"
            />
          </label>
          {error && <p className="error" data-testid="recovery-error">{error}</p>}
          <div className="actions">
            <button
              type="submit"
              className="btn btn--primary"
              disabled={submitting}
              data-testid="recovery-verify-submit"
            >
              {submitting
                ? t('auth.recovery.verify.submitting')
                : t('auth.recovery.verify.submit')}
            </button>
            {onBackToLogin && (
              <button
                type="button"
                className="btn btn--secondary"
                onClick={onBackToLogin}
              >
                {t('auth.recovery.verify.cancel')}
              </button>
            )}
          </div>
        </form>
      </section>
    )
  }

  return (
    <section className="auth-card">
      <h2>{t('auth.recovery.initiate.title')}</h2>
      <p className="hint">{t('auth.recovery.initiate.hint1')}</p>
      <p className="hint">{t('auth.recovery.initiate.hint2')}</p>
      <form onSubmit={onInitiate} className="auth-form">
        <label className="field">
          <span className="field__label">{t('auth.recovery.initiate.emailLabel')}</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="auth-input"
            data-testid="recovery-email-input"
          />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button
            type="submit"
            className="btn btn--primary"
            disabled={submitting}
            data-testid="recovery-initiate-submit"
          >
            {submitting
              ? t('auth.recovery.initiate.submitting')
              : t('auth.recovery.initiate.submit')}
          </button>
          {onBackToLogin && (
            <button
              type="button"
              className="btn btn--secondary"
              onClick={onBackToLogin}
            >
              {t('auth.recovery.initiate.cancel')}
            </button>
          )}
        </div>
      </form>
    </section>
  )
}
