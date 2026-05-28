/**
 * BundleBanner.tsx — Touchpoint 1 of the bundle cross-link surface.
 *
 * Two render variants:
 *
 *   - 'inline' (default): mounted INSIDE the wireframe toolbar's decodifica
 *     slot, symmetric to ".wireframe-modifier-btn" on the codifica side.
 *   - 'header' (legacy): persistent gradient banner above AppHeader.
 *
 * State-driven content (3 modes):
 *
 *   1) MHC-bearer unlocked (auth.reverseSubstitutionSource === 'mhc_bearer'):
 *      sober confirmation pill "✓ Decodifica sbloccata via MHC-L". No CTA,
 *      no expand. The user has already redeemed the bundle invite.
 *
 *   2) Promo COLLAPSED (default for anonymous / paid / pro_tier / no provider):
 *      thin green bar with text + 2 CTAs:
 *        · pill primary "Scopri →" (white filled) → bundle landing page
 *          (target="_blank") — preserved testid `bundle-banner-cta`
 *          (WireframeWorkArea.test.tsx vincola questo testid sul link MHC-L).
 *        · pill secondary "Sblocca →" (outline) → expand the banner inline
 *          to reveal the bearer key input form, without leaving Recode IT.
 *      The whole green surface is ALSO clickable → same effect as "Sblocca →"
 *      (third affordance, area cliccabile grande).
 *
 *   3) Promo EXPANDED (after click on surface or "Sblocca →"):
 *      banner becomes a white card with green border. Contains:
 *        · title + lead with inline <code>mhc_live_…</code> example
 *        · form: text input (autofocus) + "Sblocca" submit button
 *        · upfront nudge if !user (saves a 401 round-trip and aligns with
 *          decodifica.locked.notLoggedIn pattern)
 *        · error display below form
 *        · footer: signup link (secondary fallback for users without a key)
 *          + close button
 *      `event.stopPropagation()` on every interactive element inside the
 *      expanded card to avoid bubble to the banner root onClick.
 *
 * Auth coupling: uses useAuthOptional() so the component renders correctly
 * even in test contexts that omit AuthProvider. When the provider is absent
 * the hook returns null and we fall back to the promo variant — same content
 * an anonymous live user would see; refreshReverseSubstitution gracefully
 * degrades to a no-op.
 *
 * Canon spec:
 *   - Wireframe HTML source-of-truth UX (Claude Preview MCP iterazione live,
 *     founder-ratified SID-20260528-manual):
 *     MHC-Work/notes/research/recode-it/wireframes/bearer_unlock_inline_banner_20260528.html
 *   - Brief ratificato:
 *     MHC-Work/briefs/recode-it/decodifica_cta_mhc_key_handoff_ux_20260528.md
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuthOptional } from '../auth/auth-context'
import { useLanguage } from './LanguageContext'
import { ApiError, claimReverseSubstitutionByBearer } from '../api/client'

const BUNDLE_LANDING_URL = 'https://micheleloi.pro/mhc-l/'

type Variant = 'inline' | 'header'
type LocalStatus = 'idle' | 'bearer-validating'

type Props = {
  /** Render variant — defaults to 'inline' (post SID-20260527-181552). */
  variant?: Variant
}

export function BundleBanner({ variant = 'inline' }: Props = {}): JSX.Element {
  const { t } = useLanguage()
  const auth = useAuthOptional()
  const user = auth?.user ?? null
  const refreshReverseSubstitution =
    auth?.refreshReverseSubstitution ?? (async () => {})
  const isMhcBearerUnlocked = auth?.reverseSubstitutionSource === 'mhc_bearer'
  const dataAuthState = isMhcBearerUnlocked ? 'unlocked-mhc' : 'promo'

  // ── Expand state (only meaningful when NOT unlocked) ────────────────────────
  const [expanded, setExpanded] = useState(false)
  const [localStatus, setLocalStatus] = useState<LocalStatus>('idle')
  const [bearerInput, setBearerInput] = useState('')
  const [bearerError, setBearerError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Autofocus input post-expand. Micro-UX: a user arriving from email with the
  // bearer key in clipboard can Ctrl+V + Enter immediately.
  useEffect(() => {
    if (!expanded) return
    const timer = setTimeout(() => inputRef.current?.focus(), 100)
    return () => clearTimeout(timer)
  }, [expanded])

  const handleBearerValidate = useCallback(async () => {
    const trimmed = bearerInput.trim()
    setBearerError(null)
    if (!trimmed || !trimmed.startsWith('mhc_live_')) {
      setBearerError(t('bundleBanner.expanded.errorFormatInvalid'))
      return
    }
    setLocalStatus('bearer-validating')
    try {
      await claimReverseSubstitutionByBearer(trimmed)
      await refreshReverseSubstitution()
      setBearerInput('')
      setExpanded(false)
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setBearerError(t('bundleBanner.expanded.errorNotLoggedIn'))
        } else if (err.status === 400) {
          setBearerError(t('bundleBanner.expanded.errorFormatInvalid'))
        } else {
          setBearerError(t('bundleBanner.expanded.errorGeneric'))
        }
      } else {
        setBearerError(t('bundleBanner.expanded.errorGeneric'))
      }
    } finally {
      setLocalStatus('idle')
    }
  }, [bearerInput, refreshReverseSubstitution, t])

  const handleSurfaceClick = useCallback(() => {
    if (!expanded) setExpanded(true)
  }, [expanded])

  const handleClose = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setExpanded(false)
    setBearerError(null)
  }, [])

  const handleSbloccaClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setExpanded(true)
  }, [])

  // ── Render: MHC-bearer unlocked (sober confirmation, no expand) ────────────
  if (isMhcBearerUnlocked) {
    if (variant === 'inline') {
      return (
        <div
          className="bundle-banner bundle-banner--inline bundle-banner--unlocked"
          role="region"
          data-testid="bundle-banner"
          data-variant="inline"
          data-auth-state={dataAuthState}
        >
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
        </div>
      )
    }
    return (
      <div
        className="bundle-banner bundle-banner--header bundle-banner--unlocked"
        role="region"
        data-testid="bundle-banner"
        data-variant="header"
        data-auth-state={dataAuthState}
      >
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
      </div>
    )
  }

  // ── Render: PROMO (collapsed or expanded) ──────────────────────────────────
  const variantClass =
    variant === 'inline' ? 'bundle-banner--inline' : 'bundle-banner--header'
  const expandedClass = expanded ? ' bundle-banner--expanded' : ''
  const className = `bundle-banner ${variantClass}${expandedClass}`

  return (
    <div
      className={className}
      role="region"
      data-testid="bundle-banner"
      data-variant={variant}
      data-auth-state={dataAuthState}
      data-expanded={expanded ? 'true' : 'false'}
      onClick={!expanded ? handleSurfaceClick : undefined}
    >
      {expanded ? (
        <div
          className="bundle-banner__expanded"
          data-testid="bundle-banner-expanded"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 className="bundle-banner__expanded-title">
            {t('bundleBanner.expanded.title')}
          </h3>
          <p className="bundle-banner__expanded-lead">
            {t('bundleBanner.expanded.leadBefore')}{' '}
            <code className="bundle-banner__code">mhc_live_…</code>{' '}
            {t('bundleBanner.expanded.leadAfter')}
          </p>
          {!user && (
            <p
              className="bundle-banner__expanded-notice"
              data-testid="bundle-banner-not-logged-in"
              role="status"
            >
              {t('bundleBanner.expanded.errorNotLoggedIn')}
            </p>
          )}
          <form
            className="bundle-banner__bearer-form"
            onSubmit={(e) => {
              e.preventDefault()
              void handleBearerValidate()
            }}
          >
            <input
              ref={inputRef}
              type="text"
              className="bundle-banner__bearer-input"
              value={bearerInput}
              onChange={(e) => setBearerInput(e.target.value)}
              placeholder={t('bundleBanner.expanded.bearerPlaceholder')}
              disabled={localStatus === 'bearer-validating' || !user}
              autoComplete="off"
              spellCheck={false}
              data-testid="bundle-banner-bearer-input"
            />
            <button
              type="submit"
              className="bundle-banner__bearer-btn"
              disabled={
                localStatus === 'bearer-validating' ||
                bearerInput.trim() === '' ||
                !user
              }
              data-testid="bundle-banner-bearer-submit"
            >
              {localStatus === 'bearer-validating'
                ? t('bundleBanner.expanded.bearerValidating')
                : t('bundleBanner.expanded.bearerValidate')}
            </button>
          </form>
          {bearerError && (
            <p
              className="bundle-banner__bearer-error"
              role="alert"
              data-testid="bundle-banner-bearer-error"
            >
              {bearerError}
            </p>
          )}
          <div className="bundle-banner__expanded-footer">
            <a
              href={BUNDLE_LANDING_URL}
              className="bundle-banner__signup-link"
              target="_blank"
              rel="noopener noreferrer"
              data-testid="bundle-banner-signup-link"
            >
              {t('bundleBanner.expanded.signupLink')}
            </a>
            <button
              type="button"
              className="bundle-banner__close-btn"
              onClick={handleClose}
              data-testid="bundle-banner-close-btn"
            >
              {t('bundleBanner.expanded.closeBtn')}
            </button>
          </div>
        </div>
      ) : (
        <>
          {variant === 'inline' ? (
            <span className="bundle-banner__text bundle-banner__text--inline">
              {t('bundleBanner.text')}
            </span>
          ) : (
            <div className="bundle-banner__text">
              <strong>{t('bundleBanner.text')}</strong>
            </div>
          )}
          <div className="bundle-banner__ctas">
            <a
              href={BUNDLE_LANDING_URL}
              className="bundle-banner__cta bundle-banner__cta--inline"
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              data-testid="bundle-banner-cta"
            >
              {t('bundleBanner.cta')}
            </a>
            <button
              type="button"
              className="bundle-banner__cta bundle-banner__cta--secondary"
              onClick={handleSbloccaClick}
              data-testid="bundle-banner-unlock-btn"
            >
              {t('bundleBanner.collapsed.sbloccaCta')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export const __TEST__ = { BUNDLE_LANDING_URL }
