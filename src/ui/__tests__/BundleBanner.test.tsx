/**
 * BundleBanner.test.tsx — Touchpoint 1 (bundle banner) tests.
 *
 * Covers both render variants AND both content states (founder direttiva
 * SID-20260527-181552 + follow-up state-based shift):
 *
 *   Variants:
 *     - 'inline' (default, post-181552) — mounted inside WireframeWorkArea
 *       toolbar decodifica slot, RegIA-green pill bar.
 *     - 'header' (legacy) — gradient banner above AppHeader, kept for
 *       backward-compat / re-mount option.
 *
 *   Content states (NEW):
 *     - PROMO (default): anonymous user / no AuthProvider / paid / pro_tier
 *       sees the CTA "Decodifica gratis con iscrizione MHC-L (€0) — Scopri →".
 *     - UNLOCKED: a user authenticated via the MHC bearer path
 *       (reverseSubstitutionSource === 'mhc_bearer') sees the calm
 *       confirmation "✓ Decodifica sbloccata via MHC-L" — no CTA, no link.
 *
 * Dismiss button + localStorage persistence REMOVED in the follow-up: the
 * banner is now position-locked toolbar furniture (symmetric to
 * ".wireframe-modifier-row" "sostituisci anche") and shifts tone via auth
 * state instead of via dismiss.
 *
 * Canon: notes/research/recode-it/wireframes/bundle_crosslink_prototype_20260527.html
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { BundleBanner, __TEST__ } from '../BundleBanner'
import { LanguageProvider } from '../LanguageContext'
import { AuthContext } from '../../auth/auth-context'
import type {
  AuthContextValue,
  AuthUser,
  ReverseSubstitutionSource,
} from '../../auth/auth-context'

function renderWithLanguage(
  variant?: 'inline' | 'header',
): ReturnType<typeof render> {
  return render(
    <LanguageProvider>
      {variant ? <BundleBanner variant={variant} /> : <BundleBanner />}
    </LanguageProvider>,
  )
}

/**
 * Render with a mocked AuthContext value so we can drive the banner from
 * the unlocked confirmation state without standing up the full AuthProvider
 * (which would issue network calls). We inject only the fields the banner
 * actually consumes (`reverseSubstitutionSource`); everything else is
 * filled with inert defaults that satisfy the type.
 */
function renderWithAuth(
  reverseSubstitutionSource: ReverseSubstitutionSource,
  variant?: 'inline' | 'header',
): ReturnType<typeof render> {
  const inertUser: AuthUser = {
    user_id: 'test-user',
    email: 'test@example.com',
    kdf_salt: 'inert',
    email_verified: true,
    tier: 'free',
    name: 'Test User',
    marketing_consent: false,
  }
  const value: AuthContextValue = {
    user: reverseSubstitutionSource ? inertUser : null,
    masterKey: null,
    loading: false,
    signup: async () => {
      throw new Error('not in test scope')
    },
    login: async () => {
      throw new Error('not in test scope')
    },
    logout: async () => {
      /* no-op */
    },
    unlock: async () => {
      /* no-op */
    },
    lockKey: () => {
      /* no-op */
    },
    refresh: async () => {
      /* no-op */
    },
    reverseSubstitutionGranted: reverseSubstitutionSource !== null,
    reverseSubstitutionSource,
    refreshReverseSubstitution: async () => {
      /* no-op */
    },
  }
  return render(
    <LanguageProvider>
      <AuthContext.Provider value={value}>
        {variant ? <BundleBanner variant={variant} /> : <BundleBanner />}
      </AuthContext.Provider>
    </LanguageProvider>,
  )
}

describe('BundleBanner', () => {
  beforeEach(() => {
    try {
      window.localStorage.clear()
    } catch {
      /* defensive — some test runners disable localStorage */
    }
  })
  afterEach(() => {
    cleanup()
  })

  describe('default variant (inline, post SID-20260527-181552)', () => {
    it('renders the banner by default (no dismiss button)', () => {
      renderWithLanguage()
      expect(screen.getByTestId('bundle-banner')).toBeInTheDocument()
      expect(screen.getByTestId('bundle-banner-cta')).toBeInTheDocument()
      // Dismiss ✕ button removed (founder direttiva: position-locked
      // toolbar element, not dismissible).
      expect(screen.queryByTestId('bundle-banner-close')).toBeNull()
    })

    it('defaults to the inline variant (data-variant=inline)', () => {
      renderWithLanguage()
      const banner = screen.getByTestId('bundle-banner')
      expect(banner.getAttribute('data-variant')).toBe('inline')
      expect(banner.className).toContain('bundle-banner--inline')
    })

    it('exposes data-auth-state=promo when no AuthProvider is mounted', () => {
      renderWithLanguage()
      const banner = screen.getByTestId('bundle-banner')
      expect(banner.getAttribute('data-auth-state')).toBe('promo')
      // No confirmation marker in promo mode.
      expect(screen.queryByTestId('bundle-banner-check')).toBeNull()
      expect(screen.queryByTestId('bundle-banner-unlocked-text')).toBeNull()
    })

    it('CTA link points to MHC-L bundle landing', () => {
      renderWithLanguage()
      const cta = screen.getByTestId('bundle-banner-cta') as HTMLAnchorElement
      expect(cta.href).toContain('micheleloi.pro/mhc-l/')
      expect(cta.rel).toContain('noopener')
      expect(cta.target).toBe('_blank')
    })

    it('exposes the canonical bundle landing URL constant', () => {
      expect(__TEST__.BUNDLE_LANDING_URL).toBe('https://micheleloi.pro/mhc-l/')
    })

    it('promo text contains the IT canonical Polo E phrase', () => {
      renderWithLanguage()
      // We don't bind to exact bytes (translation files may iterate); the
      // semantic anchor is the bundle name + free signal.
      const banner = screen.getByTestId('bundle-banner')
      expect(banner.textContent).toMatch(/MHC-L/)
      expect(banner.textContent).toMatch(/€0|gratis|free|gratuit|frei/i)
    })
  })

  describe("explicit variant='inline'", () => {
    it('renders with the inline modifier class', () => {
      renderWithLanguage('inline')
      const banner = screen.getByTestId('bundle-banner')
      expect(banner.getAttribute('data-variant')).toBe('inline')
      expect(banner.className).toContain('bundle-banner--inline')
    })
  })

  describe("explicit variant='header' (legacy)", () => {
    it('renders with the header modifier class', () => {
      renderWithLanguage('header')
      const banner = screen.getByTestId('bundle-banner')
      expect(banner.getAttribute('data-variant')).toBe('header')
      expect(banner.className).toContain('bundle-banner--header')
    })

    it('surfaces CTA + IT text in legacy shape (no close button)', () => {
      renderWithLanguage('header')
      expect(screen.getByTestId('bundle-banner-cta')).toBeInTheDocument()
      // Dismiss ✕ removed for header variant too.
      expect(screen.queryByTestId('bundle-banner-close')).toBeNull()
      const banner = screen.getByTestId('bundle-banner')
      expect(banner.textContent).toMatch(/MHC-L/)
    })
  })

  describe('state-based content (auth bearer source)', () => {
    it('PROMO state: anonymous user (no auth source) → CTA + promo text', () => {
      renderWithAuth(null)
      const banner = screen.getByTestId('bundle-banner')
      expect(banner.getAttribute('data-auth-state')).toBe('promo')
      expect(screen.getByTestId('bundle-banner-cta')).toBeInTheDocument()
      expect(screen.queryByTestId('bundle-banner-check')).toBeNull()
      expect(screen.queryByTestId('bundle-banner-unlocked-text')).toBeNull()
    })

    it("PROMO state: source='paid' (€20 standalone) → still shows CTA", () => {
      renderWithAuth('paid')
      const banner = screen.getByTestId('bundle-banner')
      expect(banner.getAttribute('data-auth-state')).toBe('promo')
      expect(screen.getByTestId('bundle-banner-cta')).toBeInTheDocument()
      // Confirmation mode is GATED on the MHC bearer path specifically —
      // paid €20 users have NOT redeemed via MHC-L.
      expect(screen.queryByTestId('bundle-banner-check')).toBeNull()
    })

    it("PROMO state: source='pro_tier' (Pro subscription) → still shows CTA", () => {
      renderWithAuth('pro_tier')
      const banner = screen.getByTestId('bundle-banner')
      expect(banner.getAttribute('data-auth-state')).toBe('promo')
      expect(screen.getByTestId('bundle-banner-cta')).toBeInTheDocument()
      expect(screen.queryByTestId('bundle-banner-check')).toBeNull()
    })

    it("UNLOCKED state: source='mhc_bearer' → confirmation pill, NO CTA", () => {
      renderWithAuth('mhc_bearer')
      const banner = screen.getByTestId('bundle-banner')
      expect(banner.getAttribute('data-auth-state')).toBe('unlocked-mhc')
      expect(banner.className).toContain('bundle-banner--unlocked')
      // ✓ icon marker
      expect(screen.getByTestId('bundle-banner-check')).toBeInTheDocument()
      // Confirmation text marker
      expect(screen.getByTestId('bundle-banner-unlocked-text')).toBeInTheDocument()
      // No CTA in unlocked state (it's a status indicator, not a promo).
      expect(screen.queryByTestId('bundle-banner-cta')).toBeNull()
      // Text references MHC-L (the bundle that unlocked the feature).
      expect(banner.textContent).toMatch(/MHC-L/)
    })

    it("UNLOCKED state: ✓ icon is aria-hidden (text carries the a11y meaning)", () => {
      renderWithAuth('mhc_bearer')
      const check = screen.getByTestId('bundle-banner-check')
      expect(check.getAttribute('aria-hidden')).toBe('true')
    })

    it("UNLOCKED state in 'header' variant: still shows confirmation, no CTA", () => {
      renderWithAuth('mhc_bearer', 'header')
      const banner = screen.getByTestId('bundle-banner')
      expect(banner.getAttribute('data-variant')).toBe('header')
      expect(banner.getAttribute('data-auth-state')).toBe('unlocked-mhc')
      expect(banner.className).toContain('bundle-banner--unlocked')
      expect(screen.getByTestId('bundle-banner-check')).toBeInTheDocument()
      expect(screen.queryByTestId('bundle-banner-cta')).toBeNull()
    })
  })
})
