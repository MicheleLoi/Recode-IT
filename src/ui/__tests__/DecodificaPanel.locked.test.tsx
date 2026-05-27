/**
 * DecodificaPanel.locked.test.tsx — Touchpoint 2 (Polo E flip) structural
 * tests for the locked-state lock screen.
 *
 * Verifies the Polo E hierarchy ratified 2026-05-27 SID-20260527-102449:
 *   - bearer MHC-L (FREE) is the PRIMARY visual path (gradient + badge)
 *   - €20 Stripe purchase is the FALLBACK (sober gray, link-style)
 *   - both paths still present (preserve standalone purchase route)
 *   - anonymous users keep notLoggedIn notice (Polo E flip applies only to
 *     logged-in users)
 *
 * Strategy: inject mocked AuthContext directly (no real backend). Same
 * approach used by DecodificaDemoPage.tsx.
 *
 * Canon: notes/research/recode-it/wireframes/bundle_crosslink_prototype_20260527.html
 */

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import {
  AuthContext,
  type AuthContextValue,
  type AuthUser,
  type ReverseSubstitutionSource,
} from '../../auth/auth-context'
import {
  ActiveMappingContext,
  type ActiveMappingContextValue,
} from '../../auth/active-mapping-context'
import { LanguageProvider } from '../LanguageContext'
import { DecodificaPanel } from '../DecodificaPanel'

const MOCK_USER: AuthUser = {
  user_id: 'test-user-id',
  email: 'test@recode-it.local',
  kdf_salt: 'test-salt',
  email_verified: true,
  tier: 'free',
  name: 'Test User',
  marketing_consent: false,
}

function buildAuthValue(
  user: AuthUser | null,
  granted = false,
  source: ReverseSubstitutionSource = null,
): AuthContextValue {
  const noopVoidAsync = async (): Promise<void> => undefined
  const noopSync = (): void => undefined
  return {
    user,
    masterKey: null,
    loading: false,
    signup: noopVoidAsync as unknown as AuthContextValue['signup'],
    login: noopVoidAsync as unknown as AuthContextValue['login'],
    logout: noopVoidAsync,
    unlock: noopVoidAsync,
    lockKey: noopSync,
    refresh: noopVoidAsync,
    reverseSubstitutionGranted: granted,
    reverseSubstitutionSource: source,
    refreshReverseSubstitution: noopVoidAsync,
  }
}

function buildActiveMappingValue(): ActiveMappingContextValue {
  const noopVoidAsync = async (): Promise<void> => undefined
  const noopStringAsync = async (): Promise<string> => ''
  const noopSync = (): void => undefined
  return {
    active: null,
    saveActive: noopStringAsync as unknown as ActiveMappingContextValue['saveActive'],
    openMapping: noopVoidAsync,
    closeActive: noopSync,
    updateEntries: noopSync,
    deleteActive: noopVoidAsync,
    renameActive: noopSync,
  }
}

function renderLocked(user: AuthUser | null): void {
  render(
    <LanguageProvider>
      <AuthContext.Provider value={buildAuthValue(user, false, null)}>
        <ActiveMappingContext.Provider value={buildActiveMappingValue()}>
          <DecodificaPanel />
        </ActiveMappingContext.Provider>
      </AuthContext.Provider>
    </LanguageProvider>,
  )
}

describe('DecodificaPanel — locked (Polo E flip)', () => {
  afterEach(() => cleanup())

  describe('logged-in user', () => {
    it('renders the primary (bearer MHC-L) and fallback (€20) blocks', () => {
      renderLocked(MOCK_USER)
      expect(screen.getByTestId('decodifica-locked-primary')).toBeInTheDocument()
      expect(screen.getByTestId('decodifica-locked-fallback')).toBeInTheDocument()
    })

    it('places primary (bearer) BEFORE fallback (€20) in the DOM order', () => {
      renderLocked(MOCK_USER)
      const primary = screen.getByTestId('decodifica-locked-primary')
      const fallback = screen.getByTestId('decodifica-locked-fallback')
      // Polo E: bearer path comes first; €20 is the fallback below.
      const cmp = primary.compareDocumentPosition(fallback)
      expect(cmp & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('exposes the bearer input + validate button inside primary block', () => {
      renderLocked(MOCK_USER)
      const primary = screen.getByTestId('decodifica-locked-primary')
      expect(primary).toContainElement(screen.getByTestId('decodifica-bearer-input'))
      expect(primary).toContainElement(screen.getByTestId('decodifica-bearer-btn'))
    })

    it('exposes the €20 Stripe CTA inside fallback block (still present, sober)', () => {
      renderLocked(MOCK_USER)
      const fallback = screen.getByTestId('decodifica-locked-fallback')
      const payBtn = screen.getByTestId('decodifica-pay-btn')
      expect(fallback).toContainElement(payBtn)
    })

    it('primary block carries the "Consigliato" badge attribute', () => {
      renderLocked(MOCK_USER)
      const primary = screen.getByTestId('decodifica-locked-primary')
      // data-badge attribute drives the ::before pseudo-element badge.
      expect(primary.getAttribute('data-badge')).toBeTruthy()
      expect(primary.getAttribute('data-badge')).toMatch(
        /Consigliato|Recommended|Empfohlen|Recommandé/,
      )
    })

    it('bearer help link points to MHC-L bundle landing', () => {
      renderLocked(MOCK_USER)
      const link = screen.getByTestId('decodifica-bundle-link') as HTMLAnchorElement
      expect(link.href).toContain('micheleloi.pro/mhc-l/')
      expect(link.target).toBe('_blank')
      expect(link.rel).toContain('noopener')
    })

    it('fallback Stripe CTA uses link-style (button.fallback-link), not primary button', () => {
      renderLocked(MOCK_USER)
      const payBtn = screen.getByTestId('decodifica-pay-btn')
      // Visual hierarchy: button uses fallback-link class, not btn--primary.
      expect(payBtn.className).toContain('decodifica-panel__locked--fallback-link')
      expect(payBtn.className).not.toContain('btn--primary')
    })
  })

  describe('anonymous user (gating preserved)', () => {
    it('shows the notLoggedIn notice and NO bearer/pay UI', () => {
      renderLocked(null)
      expect(screen.getByTestId('decodifica-anon-notice')).toBeInTheDocument()
      // Polo E flip applies only to logged-in users; anon gating is invariant.
      expect(screen.queryByTestId('decodifica-locked-primary')).toBeNull()
      expect(screen.queryByTestId('decodifica-locked-fallback')).toBeNull()
      expect(screen.queryByTestId('decodifica-bearer-input')).toBeNull()
      expect(screen.queryByTestId('decodifica-pay-btn')).toBeNull()
    })
  })
})
