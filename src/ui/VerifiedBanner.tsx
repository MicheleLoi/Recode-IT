/**
 * VerifiedBanner — top-page confirmation chip shown after the user lands on
 * Recode IT from the email-verification link. Triggered by `?verified=1` in
 * the URL (plan §"Decisioni ratificate" #3: no SPA route, just a query
 * parameter the SignupPage backend redirects to).
 *
 * Dismissible (the banner clears the query parameter via history.replaceState
 * on dismiss so a reload won't re-show it). Copy is the canonical one from
 * the brief: "Email confermata. Benvenuto su Recode IT."
 */

import { useEffect, useState } from 'react'

const QUERY_PARAM = 'verified'

function hasVerifiedFlag(): boolean {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  return params.get(QUERY_PARAM) === '1'
}

function clearVerifiedFlag(): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.searchParams.delete(QUERY_PARAM)
  const next = url.pathname + (url.search ? url.search : '') + url.hash
  window.history.replaceState({}, '', next)
}

export function VerifiedBanner(): JSX.Element | null {
  const [visible, setVisible] = useState<boolean>(() => hasVerifiedFlag())

  // Re-evaluate on mount in case the URL flipped via SPA navigation.
  useEffect(() => {
    setVisible(hasVerifiedFlag())
  }, [])

  if (!visible) return null

  const dismiss = () => {
    clearVerifiedFlag()
    setVisible(false)
  }

  return (
    <div
      className="verified-banner"
      role="status"
      data-testid="verified-banner"
    >
      <span className="verified-banner__text">
        Email confermata. Benvenuto su Recode IT.
      </span>
      <button
        type="button"
        className="verified-banner__dismiss"
        aria-label="Chiudi questa notifica"
        onClick={dismiss}
      >
        ×
      </button>
    </div>
  )
}

export const __TEST__ = { hasVerifiedFlag, clearVerifiedFlag, QUERY_PARAM }
