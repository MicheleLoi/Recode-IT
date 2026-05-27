/**
 * BundleBanner.tsx — Touchpoint 1 of the bundle cross-link surface
 * (SID-20260527, Polo E flip propagation inside the Recode IT app).
 *
 * Persistent gradient banner shown ABOVE AppHeader. Surfaces the bundle
 * landing path BEFORE the user encounters the Decodifica paywall. Felt-not-said:
 * "esiste un percorso gratis" rather than "vendiamo qualcosa".
 *
 * Behavior:
 *   - Visible by default for every visitor (anonymous or logged-in).
 *   - Dismissible via the ✕ button — state persisted in localStorage so a
 *     page reload (or returning visit) doesn't re-surface it after dismiss.
 *   - Defensive: if localStorage is unavailable (private mode / disabled),
 *     dismissal still works in-memory for the current page lifetime.
 *
 * Canon spec: notes/research/recode-it/wireframes/bundle_crosslink_prototype_20260527.html
 * (1:1 transcription — no improvisation, no scope creep).
 */

import { useCallback, useEffect, useState } from 'react'
import { useLanguage } from './LanguageContext'

const DISMISS_KEY = 'recode-it.bundleBanner.dismissed'
const BUNDLE_LANDING_URL = 'https://micheleloi.pro/mhc-l/'

function readDismissed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    // localStorage may be unavailable (Safari private mode, disabled storage,
    // etc.). We don't treat that as "dismissed" — banner stays visible.
    return false
  }
}

function writeDismissed(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(DISMISS_KEY, '1')
  } catch {
    /* silent — same defensive posture as readDismissed */
  }
}

export function BundleBanner(): JSX.Element | null {
  const { t } = useLanguage()
  const [visible, setVisible] = useState<boolean>(() => !readDismissed())

  // Re-evaluate on mount in case storage state changed in another tab.
  useEffect(() => {
    setVisible(!readDismissed())
  }, [])

  const dismiss = useCallback(() => {
    writeDismissed()
    setVisible(false)
  }, [])

  if (!visible) return null

  return (
    <div className="bundle-banner" role="region" data-testid="bundle-banner">
      <div className="bundle-banner__text">
        <strong>{t('bundleBanner.text')}</strong>
      </div>
      <a
        href={BUNDLE_LANDING_URL}
        className="bundle-banner__cta"
        target="_blank"
        rel="noopener noreferrer"
        data-testid="bundle-banner-cta"
      >
        {t('bundleBanner.cta')}
      </a>
      <button
        type="button"
        className="bundle-banner__close"
        onClick={dismiss}
        aria-label={t('bundleBanner.dismissAria')}
        title={t('bundleBanner.dismissAria')}
        data-testid="bundle-banner-close"
      >
        ×
      </button>
    </div>
  )
}

export const __TEST__ = { DISMISS_KEY, BUNDLE_LANDING_URL, readDismissed, writeDismissed }
