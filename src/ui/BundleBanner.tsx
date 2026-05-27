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
 *   - State-based content (founder direttiva SID-20260527-181552 refinement):
 *       · IF auth bearer source === 'mhc_bearer' → render confirmation
 *         "✓ Decodifica sbloccata via MHC-L" (sober pill, no CTA link).
 *         The user has already redeemed the bundle invite via MHC-L; the
 *         banner shifts from promo to status indicator.
 *       · ELSE (anonymous / paid / pro_tier / no provider) → render the
 *         standard promo "Decodifica gratis con iscrizione MHC-L (€0)"
 *         + "Scopri →" CTA pointing at the bundle landing.
 *   - NOT dismissible (Minerva: position-locked toolbar element, symmetric
 *     to ".wireframe-modifier-row" "sostituisci anche" which is itself
 *     non-dismissible). Removed the ✕ close button + the localStorage
 *     persistence in SID-20260527 follow-up (chat 'questo mi piace esegui'
 *     to Opzione 1a). Tone shifts via auth state, not via dismiss.
 *
 * Auth coupling: uses useAuthOptional() so the component renders correctly
 * even in test contexts that omit AuthProvider (the existing
 * BundleBanner.test.tsx wraps only in LanguageProvider). When the provider
 * is absent the hook returns null and we fall back to the promo variant —
 * the same content an anonymous user would see in the live app.
 *
 * Canon spec: notes/research/recode-it/wireframes/bundle_crosslink_prototype_20260527.html
 * (Polo E flip; inline variant is the post-181552 refinement, header variant
 * is preserved for option-recovery if needed.)
 */

import { useAuthOptional } from '../auth/auth-context'
import { useLanguage } from './LanguageContext'

const BUNDLE_LANDING_URL = 'https://micheleloi.pro/mhc-l/'

type Variant = 'inline' | 'header'

type Props = {
  /** Render variant — defaults to 'inline' (post SID-20260527-181552). */
  variant?: Variant
}

export function BundleBanner({ variant = 'inline' }: Props = {}): JSX.Element {
  const { t } = useLanguage()
  const auth = useAuthOptional()
  // Confirmation mode is gated on the MHC bearer authority path specifically.
  // Other sources ('paid' = €20 una tantum, 'pro_tier' = Pro subscription)
  // keep showing the promo CTA — those users have NOT redeemed via MHC-L.
  const isMhcBearerUnlocked = auth?.reverseSubstitutionSource === 'mhc_bearer'

  const dataAuthState = isMhcBearerUnlocked ? 'unlocked-mhc' : 'promo'

  if (variant === 'inline') {
    return (
      <div
        className={
          isMhcBearerUnlocked
            ? 'bundle-banner bundle-banner--inline bundle-banner--unlocked'
            : 'bundle-banner bundle-banner--inline'
        }
        role="region"
        data-testid="bundle-banner"
        data-variant="inline"
        data-auth-state={dataAuthState}
      >
        {isMhcBearerUnlocked ? (
          <>
            <span
              className="bundle-banner__check"
              aria-hidden="true"
              data-testid="bundle-banner-check"
            >
              ✓
            </span>
            <span
              className="bundle-banner__text bundle-banner__text--unlocked"
              data-testid="bundle-banner-unlocked-text"
            >
              {t('bundleBanner.unlocked.text')}
            </span>
          </>
        ) : (
          <>
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
          </>
        )}
      </div>
    )
  }

  // variant === 'header' (legacy gradient banner above AppHeader)
  return (
    <div
      className={
        isMhcBearerUnlocked
          ? 'bundle-banner bundle-banner--header bundle-banner--unlocked'
          : 'bundle-banner bundle-banner--header'
      }
      role="region"
      data-testid="bundle-banner"
      data-variant="header"
      data-auth-state={dataAuthState}
    >
      {isMhcBearerUnlocked ? (
        <div className="bundle-banner__text bundle-banner__text--unlocked">
          <span
            className="bundle-banner__check"
            aria-hidden="true"
            data-testid="bundle-banner-check"
          >
            ✓
          </span>{' '}
          <span data-testid="bundle-banner-unlocked-text">
            {t('bundleBanner.unlocked.text')}
          </span>
        </div>
      ) : (
        <>
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
        </>
      )}
    </div>
  )
}

export const __TEST__ = { BUNDLE_LANDING_URL }
