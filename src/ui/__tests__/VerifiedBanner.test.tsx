/**
 * VerifiedBanner.test.tsx — verifies the ?verified=1 detection + dismiss
 * gesture (plan §"Decisioni ratificate" #3: SPA banner on email-verify
 * landing, no dedicated route).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { VerifiedBanner } from '../VerifiedBanner'

const ORIGINAL_HREF = 'http://localhost/'

function setUrl(url: string): void {
  window.history.replaceState({}, '', url)
}

describe('VerifiedBanner', () => {
  beforeEach(() => setUrl('/'))
  afterEach(() => setUrl(ORIGINAL_HREF))

  it('renders the banner when ?verified=1 is present', () => {
    setUrl('/?verified=1')
    render(<VerifiedBanner />)
    expect(screen.getByTestId('verified-banner')).toBeInTheDocument()
    expect(screen.getByText(/Email confermata/)).toBeInTheDocument()
  })

  it('renders nothing without the query parameter', () => {
    setUrl('/')
    render(<VerifiedBanner />)
    expect(screen.queryByTestId('verified-banner')).toBeNull()
  })

  it('dismiss strips the query param + hides the banner', () => {
    setUrl('/?verified=1&other=keep')
    render(<VerifiedBanner />)
    const dismiss = screen.getByLabelText('Chiudi questa notifica')
    fireEvent.click(dismiss)
    expect(screen.queryByTestId('verified-banner')).toBeNull()
    // `verified` removed, `other` preserved.
    const params = new URLSearchParams(window.location.search)
    expect(params.get('verified')).toBeNull()
    expect(params.get('other')).toBe('keep')
  })
})
