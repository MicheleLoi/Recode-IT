/**
 * RecoveryPage — three-step destructive password reset (OPEN_RISKS.md R-05).
 *
 * Per the founder's spec (capabilities_index §7 + R-05 mitigation #2), a
 * recovery-code reset is irreversible: all encrypted mappings are server-side
 * deleted because the new Argon2id-derived key cannot decrypt blobs sealed
 * with the old key. The UI surfaces this consequence in THREE explicit
 * checkpoints before letting the user submit the verify call:
 *
 *   Step 1 — Initiate: enter email, request reset link.
 *   Step 2 — Warning gate: user sees the destructive consequence in plain
 *            Italian, must check an "I understand" box, AND must type
 *            ELIMINA into a confirmation textbox before "Continua" enables.
 *   Step 3 — Verify form: token + recovery code + new password fields,
 *            visible only after the warning gate has been cleared.
 *
 * The gating logic is intentionally not skippable. The data-loss surprise
 * documented in R-05 is the prototypical "negative review trigger" we are
 * mitigating; the three-step pattern is the founder-ratified UX answer.
 */

import { useState } from 'react'
import { ApiError, requestRecovery, verifyRecovery } from '../../api/client'

type Props = {
  onBackToLogin?: () => void
}

type Stage = 'initiate' | 'warning' | 'verify' | 'done'

const DESTRUCTIVE_CONFIRM_WORD = 'ELIMINA'

export function RecoveryPage({ onBackToLogin }: Props): JSX.Element {
  const [stage, setStage] = useState<Stage>('initiate')
  const [email, setEmail] = useState('')
  const [token, setToken] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [destructiveConfirm, setDestructiveConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function onInitiate(ev: React.FormEvent) {
    ev.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await requestRecovery(email.trim().toLowerCase())
      setStage('warning')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Errore inatteso.')
    } finally {
      setSubmitting(false)
    }
  }

  function onWarningContinue() {
    if (!acknowledged) {
      setError('Spunta la conferma di aver compreso la conseguenza.')
      return
    }
    if (destructiveConfirm.trim().toUpperCase() !== DESTRUCTIVE_CONFIRM_WORD) {
      setError(`Scrivi ${DESTRUCTIVE_CONFIRM_WORD} per confermare.`)
      return
    }
    setError(null)
    setStage('verify')
  }

  async function onVerify(ev: React.FormEvent) {
    ev.preventDefault()
    setError(null)
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
          Hai confermato la consapevolezza della distruzione dei mapping.
          Compila i campi per completare il reset.
        </p>
        <form onSubmit={onVerify} className="auth-form" data-testid="recovery-verify-form">
          <label className="field">
            <span className="field__label">Token (dal link nell'email)</span>
            <input
              type="text"
              required
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="auth-input"
              data-testid="recovery-token-input"
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
              data-testid="recovery-code-input"
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
              data-testid="recovery-newpassword-input"
            />
          </label>
          {error && <p className="error" data-testid="recovery-error">{error}</p>}
          <div className="actions">
            <button
              type="submit"
              className="btn btn--danger"
              disabled={submitting}
              data-testid="recovery-verify-submit"
            >
              {submitting ? 'Reimposto...' : 'Reimposta password e distruggi mapping'}
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

  if (stage === 'warning') {
    return (
      <section className="auth-card" data-testid="recovery-warning-stage">
        <h2>Stai per usare un codice di recupero</h2>
        <div className="recovery-warning">
          <p>
            <strong>ATTENZIONE.</strong> Procedere con un codice di recupero
            comporta conseguenze <em>permanenti e irreversibili</em>:
          </p>
          <ul>
            <li>
              <strong>Tutti i mapping salvati saranno eliminati definitivamente.</strong>
              {' '}Recode IT non puo' decifrarli con la nuova password
              (architettura zero-knowledge: senza la chiave originale, i blob
              cifrati sono inutilizzabili).
            </li>
            <li>
              Le preferenze di falso-positivo memorizzate verranno conservate
              ma diventeranno orfane (i mapping a cui si riferivano non
              esistono piu').
            </li>
            <li>
              L'operazione non puo' essere annullata dopo la conferma.
            </li>
          </ul>
          <p>
            Se non sei certo, <strong>annulla ora</strong> e prova prima a
            ricordare la password.
          </p>

          <label className="auth-acknowledge">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              data-testid="recovery-acknowledge-checkbox"
            />
            Ho compreso che <strong>tutti i mapping salvati saranno
            distrutti</strong> e che questa operazione e' irreversibile.
          </label>

          <label className="field">
            <span className="field__label">
              Scrivi <code>{DESTRUCTIVE_CONFIRM_WORD}</code> per confermare
            </span>
            <input
              type="text"
              value={destructiveConfirm}
              onChange={(e) => setDestructiveConfirm(e.target.value)}
              className="auth-input"
              autoComplete="off"
              data-testid="recovery-destructive-input"
            />
          </label>

          {error && <p className="error" data-testid="recovery-warning-error">{error}</p>}

          <div className="actions">
            <button
              type="button"
              className="btn btn--danger"
              onClick={onWarningContinue}
              disabled={
                !acknowledged ||
                destructiveConfirm.trim().toUpperCase() !==
                  DESTRUCTIVE_CONFIRM_WORD
              }
              data-testid="recovery-warning-continue"
            >
              Continua (distruttivo)
            </button>
            {onBackToLogin && (
              <button
                type="button"
                className="btn btn--secondary"
                onClick={onBackToLogin}
                data-testid="recovery-warning-cancel"
              >
                Annulla
              </button>
            )}
          </div>
        </div>
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
      <p className="hint">
        <strong>Conseguenza importante:</strong> usare un codice di recupero
        elimina <em>tutti i mapping salvati</em>. Vedremo l'avviso completo
        nel passaggio successivo.
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
