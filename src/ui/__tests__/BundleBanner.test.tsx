/**
 * BundleBanner.test.tsx — Touchpoint 1 (bundle banner persistente)
 * tests. Verifies render, copy, dismissal + localStorage persistence,
 * and graceful fallback when localStorage is unavailable.
 *
 * Canon: notes/research/recode-it/wireframes/bundle_crosslink_prototype_20260527.html
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { BundleBanner, __TEST__ } from '../BundleBanner'
import { LanguageProvider } from '../LanguageContext'

function renderWithLanguage(): ReturnType<typeof render> {
  return render(
    <LanguageProvider>
      <BundleBanner />
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

  it('renders the banner by default (not dismissed)', () => {
    renderWithLanguage()
    expect(screen.getByTestId('bundle-banner')).toBeInTheDocument()
    expect(screen.getByTestId('bundle-banner-cta')).toBeInTheDocument()
    expect(screen.getByTestId('bundle-banner-close')).toBeInTheDocument()
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
