/**
 * BundleBanner.tsx — Touchpoint 1 of the bundle cross-link surface
 * (SID-20260527, Polo E flip propagation inside the Recode IT app).
 *
 * Two render variants:
 *
 *   - 'inline' (default, SID-20260527-181552 — founder direttiva):
 *     Mounted INSIDE the wireframe toolbar's decodifica slot, exactly
 *     symmetric to where ".wireframe-modifier-btn" ("sostituisci anche")
 *     lives on the codifica side. Thin bar visual, RegIA-green palette
 *     (mirroring ".wireframe-modifier-btn" structure but green instead
 *     of grey). Position locked to that exact slot — it does NOT move.
 *
 *   - 'header' (legacy, kept for backward-compat / future re-mount needs):
 *     Persistent gradient banner ABOVE AppHeader. Pre-SID-20260527-181552
 *     mount point. No longer mounted in App.tsx after the inline move; left
 *     available so the component can still be tested in isolation or
 *     re-introduced if product chooses to put it back at the top.
 *
 * Behavior (both variants):
 *   - Visible by default for every visitor (anonymous or logged-in).
 *   - Dismissible via the ✕ button — state persisted in localStorage so a
 *     page reload (or returning visit) doesn't re-surface it after dismiss.
 *   - Defensive: if localStorage is unavailable (private mode / disabled),
 *     dismissal still works in-memory for the current page lifetime.
 *
 * Canon spec: notes/research/recode-it/wireframes/bundle_crosslink_prototype_20260527.html
 * (Polo E flip; inline variant is the post-181552 refinement, header variant
 * is preserved for option-recovery if needed.)
 */

import { useCallback, useEffect, useState } from 'react'
import { useLanguage } from './LanguageContext'

const DISMISS_KEY = 'recode-it.bundleBanner.dismissed'
const BUNDLE_LANDING_URL = 'https://micheleloi.pro/mhc-l/'

type Variant = 'inline' | 'header'

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

type Props = {
  /** Render variant — defaults to 'inline' (post SID-20260527-181552). */
  variant?: Variant
}

export function BundleBanner({ variant = 'inline' }: Props = {}): JSX.Element | null {
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

  if (variant === 'inline') {
    return (
      <div
        className="bundle-banner bundle-banner--inline"
        role="region"
        data-testid="bundle-banner"
        data-variant="inline"
      >
        <span className="bundle-banner__text bundle-banner__text--inline">
          {t('bundleBanner.text')}
        </span>
        <a
          href={BUNDLE_LANDING_URL}
          className="bundle-banner__cta bundle-banner__cta--inline"
          target="_blank"
          rel="noopener noreferrer"
          data-testid="bundle-banner-cta"
        >
          {t('bundleBanner.cta')}
        </a>
        <button
          type="button"
          className="bundle-banner__close bundle-banner__close--inline"
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

  // variant === 'header' (legacy gradient banner above AppHeader)
  return (
    <div
      className="bundle-banner bundle-banner--header"
      role="region"
      data-testid="bundle-banner"
      data-variant="header"
    >
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
