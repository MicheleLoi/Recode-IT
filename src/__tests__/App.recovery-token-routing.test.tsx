/**
 * App.recovery-token-routing.test.tsx — recovery deep-link routing contract.
 *
 * Bug context (founder MHC-Work SID-20260525-105757):
 *   - Before fix: the password-reset email link pointed at /recode/recovery/
 *     reset, a backend path that does not GET → 404.
 *   - After fix: the email link points at /?token=<...>; App.tsx detects
 *     the `?token=` query param on first mount and routes to the
 *     RecoveryPage, which auto-fills the verify stage from the URL.
 *
 * Contract this test enforces:
 *   1. `?token=<...>` present on first mount → RecoveryPage is rendered, the
 *      verify form is visible (RecoveryPage transitions stage to 'verify'
 *      because the token is non-empty), and the token-from-link confirmation
 *      block is shown.
 *   2. No `?token=` param → app lands on the default 'work' view; the
 *      RecoveryPage is NOT mounted automatically.
 *   3. `?token=` empty string → treated as no token (default view).
 *
 * We mock the auth `me()` call to return null (anonymous user) so the test
 * surface is the bare routing logic, not authentication state.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const apiMocks = vi.hoisted(() => ({
  meMock: vi.fn(),
}))

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>(
    '../api/client',
  )
  return {
    ...actual,
    me: apiMocks.meMock,
  }
})

import { App } from '../App'

function stubLocationSearch(search: string): void {
  // jsdom allows reassigning window.location.search directly via defineProperty
  // on the location object. We snapshot + restore in afterEach so test order
  // doesn't matter.
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: {
      ...window.location,
      search,
      pathname: '/',
    },
  })
}

const originalLocation = window.location

beforeEach(() => {
  apiMocks.meMock.mockReset()
  // Anonymous by default: backend returns "not authenticated". The real
  // api.me() throws ApiError on 401; mock with rejection that AuthProvider's
  // refresh swallows, leaving user=null.
  apiMocks.meMock.mockRejectedValue(new Error('not authenticated'))
})

afterEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: originalLocation,
  })
})

describe('App — recovery token deep-link routing', () => {
  it('routes to RecoveryPage when ?token=<value> is on the URL at mount', async () => {
    stubLocationSearch('?token=ABC123XYZ')
    render(<App />)
    // Loading spinner → resolved auth → RecoveryPage. The recovery verify
    // form is rendered immediately because RecoveryPage::readTokenFromUrl
    // sees the same query param and starts at stage='verify'.
    await waitFor(() => {
      expect(screen.getByTestId('recovery-verify-form')).toBeInTheDocument()
    })
    // The token-from-link confirmation block confirms RecoveryPage saw the
    // URL token (not a manual paste).
    expect(screen.getByTestId('recovery-token-from-link')).toBeInTheDocument()
  })

  it('does NOT route to RecoveryPage when ?token= is empty', async () => {
    stubLocationSearch('?token=')
    render(<App />)
    // Wait for auth state to settle (loading spinner clears). Then assert no
    // recovery surface is rendered.
    await waitFor(() => {
      expect(screen.queryByTestId('auth-loading')).toBeNull()
    })
    expect(screen.queryByTestId('recovery-verify-form')).toBeNull()
    expect(screen.queryByTestId('recovery-email-input')).toBeNull()
  })

  it('does NOT route to RecoveryPage when no query param is present', async () => {
    stubLocationSearch('')
    render(<App />)
    await waitFor(() => {
      expect(screen.queryByTestId('auth-loading')).toBeNull()
    })
    expect(screen.queryByTestId('recovery-verify-form')).toBeNull()
    expect(screen.queryByTestId('recovery-email-input')).toBeNull()
  })
})
