/**
 * UpgradePage — claim flow per il funnel pro su invito (Phase 1).
 *
 * Montata da App.tsx quando l'URL ha `?t=<token>`. Il claim funziona
 * INDIPENDENTEMENTE dallo stato di login: il token HMAC è autosufficiente
 * (backend lo verifica per firma + lookup hash + scadenza). Lo user può
 * arrivare via email su un device dove non è loggato e completare comunque
 * il flusso.
 *
 * Flow:
 *   1. on mount: POST /recode/pro/claim-invite { token } .
 *   2. 200 + stripe_payment_link_url → CTA "Procedi al checkout" che fa
 *      window.location.href = stripe_payment_link_url.
 *   3. 400 → mostra error message + CTA "Torna alla home".
 *
 * Il token NON è consumato qui: lo è solo al webhook Stripe
 * customer.subscription.created. Quindi un click ripetuto sul link funziona
 * fino a quando l'utente non completa il checkout Stripe (o scade).
 */

import { useEffect, useState } from 'react'
import { ApiError, claimProInvite } from '../../api/client'

type Props = {
  token: string
  /** Called when the user clicks "Torna alla home" on the error branch. */
  onBack: () => void
}

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; stripeUrl: string; expiresAt: string }
  | { kind: 'error'; message: string; code: string }

export function UpgradePage({ token, onBack }: Props): JSX.Element {
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const resp = await claimProInvite(token)
        if (cancelled) return
        setState({
          kind: 'ready',
          stripeUrl: resp.stripe_payment_link_url,
          expiresAt: resp.expires_at,
        })
      } catch (err) {
        if (cancelled) return
        const apiErr = err instanceof ApiError ? err : null
        setState({
          kind: 'error',
          message: apiErr?.message ?? 'Errore di rete. Riprova più tardi.',
          code: apiErr?.code ?? 'unknown_error',
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  if (state.kind === 'loading') {
    return (
      <section className="panel" data-testid="upgrade-loading">
        <h2>Sto verificando il tuo invito…</h2>
        <p>Un attimo.</p>
      </section>
    )
  }

  if (state.kind === 'error') {
    return (
      <section className="panel panel--danger" data-testid="upgrade-error">
        <h2>Invito non valido</h2>
        <p data-testid="upgrade-error-message">{state.message}</p>
        <p className="hint">
          Possibili cause: link già usato, scaduto (7 giorni), o copiato male
          dalla mail. Se pensi sia un errore scrivi a{' '}
          <a href="mailto:mhcl@micheleloi.pro">mhcl@micheleloi.pro</a>.
        </p>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={onBack}
          data-testid="upgrade-back"
        >
          Torna alla home
        </button>
      </section>
    )
  }

  // ready
  return (
    <section className="panel" data-testid="upgrade-ready">
      <h2>Il tuo invito è approvato</h2>
      <p>
        Tutto pronto per attivare il piano pro di Recode IT. Il prossimo passo
        è il checkout su Stripe.
      </p>
      <p className="hint">
        <strong>Nessuna carta richiesta.</strong> In Phase 1 il piano pro è
        gratuito su invito: l'abbonamento Stripe è a <strong>€0/mese</strong> e
        Stripe non ti chiederà un metodo di pagamento. Lo usiamo solo per
        gestire un'eventuale futura transizione al pricing €25 una tantum senza
        dover migrare il tuo account.
      </p>
      <a
        href={state.stripeUrl}
        className="btn btn--primary"
        data-testid="upgrade-checkout-link"
      >
        Procedi al checkout (gratis)
      </a>
      <p className="muted" data-testid="upgrade-expires">
        Link valido fino al {new Date(state.expiresAt).toLocaleString('it-IT')}.
      </p>
    </section>
  )
}
