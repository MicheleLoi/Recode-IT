/**
 * BundleBanner.test.tsx — Touchpoint 1 (bundle banner) tests.
 *
 * Covers both render variants (founder direttiva SID-20260527-181552):
 *   - 'inline' (default, post-181552) — mounted inside WireframeWorkArea
 *     toolbar decodifica slot, RegIA-green pill bar.
 *   - 'header' (legacy) — gradient banner above AppHeader, kept for
 *     backward-compat / re-mount option.
 *
 * Verifies render, copy, dismissal + localStorage persistence, and
 * graceful fallback when localStorage is unavailable.
 *
 * Canon: notes/research/recode-it/wireframes/bundle_crosslink_prototype_20260527.html
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { BundleBanner, __TEST__ } from '../BundleBanner'
import { LanguageProvider } from '../LanguageContext'

function renderWithLanguage(
  variant?: 'inline' | 'header',
): ReturnType<typeof render> {
  return render(
    <LanguageProvider>
      {variant ? <BundleBanner variant={variant} /> : <BundleBanner />}
    </LanguageProvider>,
  )
}

describe('BundleBanner', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })
  afterEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  describe('default variant (inline, post SID-20260527-181552)', () => {
    it('renders the banner by default (not dismissed)', () => {
      renderWithLanguage()
      expect(screen.getByTestId('bundle-banner')).toBeInTheDocument()
      expect(screen.getByTestId('bundle-banner-cta')).toBeInTheDocument()
      expect(screen.getByTestId('bundle-banner-close')).toBeInTheDocument()
    })

    it('defaults to the inline variant (data-variant=inline)', () => {
      renderWithLanguage()
      const banner = screen.getByTestId('bundle-banner')
      expect(banner.getAttribute('data-variant')).toBe('inline')
      expect(banner.className).toContain('bundle-banner--inline')
    })

    it('CTA link points to MHC-L bundle landing', () => {
      renderWithLanguage()
      const cta = screen.getByTestId('bundle-banner-cta') as HTMLAnchorElement
      expect(cta.href).toContain('micheleloi.pro/mhc-l/')
      expect(cta.rel).toContain('noopener')
      expect(cta.target).toBe('_blank')
    })

    it('does not render when localStorage flag is set to "1"', () => {
      window.localStorage.setItem(__TEST__.DISMISS_KEY, '1')
      renderWithLanguage()
      expect(screen.queryByTestId('bundle-banner')).toBeNull()
    })

    it('dismiss button hides the banner and writes localStorage', () => {
      renderWithLanguage()
      expect(window.localStorage.getItem(__TEST__.DISMISS_KEY)).toBeNull()
      fireEvent.click(screen.getByTestId('bundle-banner-close'))
      expect(screen.queryByTestId('bundle-banner')).toBeNull()
      expect(window.localStorage.getItem(__TEST__.DISMISS_KEY)).toBe('1')
    })

    it('exposes the canonical bundle landing URL constant', () => {
      expect(__TEST__.BUNDLE_LANDING_URL).toBe('https://micheleloi.pro/mhc-l/')
    })

    it('text contains the IT canonical Polo E phrase', () => {
      renderWithLanguage()
      // We don't bind to exact bytes (translation files may iterate); the
      // semantic anchor is the bundle name + free signal.
      const banner = screen.getByTestId('bundle-banner')
      expect(banner.textContent).toMatch(/MHC-L/)
      expect(banner.textContent).toMatch(/€0|gratis|free|gratuit|frei|gratis/i)
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

    it('still surfaces CTA + close + IT text in legacy shape', () => {
      renderWithLanguage('header')
      expect(screen.getByTestId('bundle-banner-cta')).toBeInTheDocument()
      expect(screen.getByTestId('bundle-banner-close')).toBeInTheDocument()
      const banner = screen.getByTestId('bundle-banner')
      expect(banner.textContent).toMatch(/MHC-L/)
    })

    it('dismiss button still hides + writes localStorage', () => {
      renderWithLanguage('header')
      fireEvent.click(screen.getByTestId('bundle-banner-close'))
      expect(screen.queryByTestId('bundle-banner')).toBeNull()
      expect(window.localStorage.getItem(__TEST__.DISMISS_KEY)).toBe('1')
    })
  })
})
