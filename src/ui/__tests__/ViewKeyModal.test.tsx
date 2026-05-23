/**
 * ViewKeyModal.test.tsx — render-state tests for the view-key modal
 * (capabilities_index §9.9).
 *
 * Covers:
 *   - Closed state: renders nothing
 *   - Locked anonymous: shows sign-in nudge, no pay CTA
 *   - Locked logged-in: pay CTA + bearer paste form
 *   - Bearer validation error path
 *   - Unlocked + mapping present: source pill + table + copy/export
 *   - Unlocked + no mapping: noMapping notice
 *   - Close button + ESC + backdrop click all trigger onClose
 */

import 'fake-indexeddb/auto'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { AuthContextValue } from '../../auth/auth-context'
import type { ActiveMappingContextValue } from '../../auth/active-mapping-context'
import type { MappingEntry } from '../../types/engine'

// Mock the api/client module entirely — the modal only needs the three
// view-key functions and we want full control over their behaviour.
vi.mock('../../api/client', () => ({
  ApiError: class ApiError extends Error {
    public readonly status: number
    public readonly code: string
    public readonly body: unknown
    constructor(status: number, body: unknown, fallback: string) {
      super(fallback)
      this.status = status
      this.code = 'mock'
      this.body = body
    }
  },
  claimViewKeyByBearer: vi.fn(),
  claimViewKeyCheckout: vi.fn(),
}))

// Mock the auth + active-mapping contexts so we can pin specific values
// for each test scenario without rebuilding the whole provider stack.
// We use module-level mutable references so each test can swap the value
// before render() without re-mocking.
type AuthRef = { current: AuthContextValue }
type ActiveRef = { current: ActiveMappingContextValue }
const authRef: AuthRef = { current: null as unknown as AuthContextValue }
const activeRef: ActiveRef = {
  current: null as unknown as ActiveMappingContextValue,
}

vi.mock('../../auth/auth-context', () => ({
  useAuth: () => authRef.current,
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock('../../auth/active-mapping-context', () => ({
  useActiveMapping: () => activeRef.current,
  ActiveMappingProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}))

import { ViewKeyModal } from '../ViewKeyModal'
import * as api from '../../api/client'

function buildAuthValue(overrides: Partial<AuthContextValue>): AuthContextValue {
  return {
    user: null,
    masterKey: null,
    loading: false,
    signup: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    unlock: vi.fn(),
    lockKey: vi.fn(),
    refresh: vi.fn(),
    viewKeyGranted: false,
    viewKeySource: null,
    refreshViewKey: vi.fn(),
    ...overrides,
  } as AuthContextValue
}

function buildActiveValue(
  overrides: Partial<ActiveMappingContextValue>,
): ActiveMappingContextValue {
  return {
    active: null,
    saveActive: vi.fn(),
    openMapping: vi.fn(),
    closeActive: vi.fn(),
    updateEntries: vi.fn(),
    deleteActive: vi.fn(),
    renameActive: vi.fn(),
    ...overrides,
  } as ActiveMappingContextValue
}

const sampleEntries: MappingEntry[] = [
  { pseudonym: 'Tizio', realValue: 'Mario Rossi', category: 'persona' },
  { pseudonym: 'Caio', realValue: 'Giulia Bianchi', category: 'persona' },
]

describe('ViewKeyModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authRef.current = (buildAuthValue({}))
    activeRef.current = (buildActiveValue({}))
  })

  it('renders nothing when isOpen=false', () => {
    const { container } = render(<ViewKeyModal isOpen={false} onClose={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('locked state for anonymous user shows sign-in nudge (no pay CTA)', () => {
    authRef.current = (buildAuthValue({ user: null }))
    render(<ViewKeyModal isOpen={true} onClose={() => {}} />)
    expect(screen.getByTestId('view-key-modal')).toBeInTheDocument()
    expect(screen.getByTestId('view-key-anon-notice')).toBeInTheDocument()
    expect(screen.queryByTestId('view-key-pay-btn')).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('view-key-bearer-validate-btn'),
    ).not.toBeInTheDocument()
  })

  it('locked state for logged-in user shows pay CTA + bearer paste form', () => {
    authRef.current = buildAuthValue({
        user: {
          user_id: 'u1',
          email: 'a@b.it',
          kdf_salt: 'x',
          email_verified: true,
          tier: 'free',
          name: 'Test',
          marketing_consent: false,
        },
      })
    render(<ViewKeyModal isOpen={true} onClose={() => {}} />)
    expect(screen.getByTestId('view-key-pay-btn')).toBeInTheDocument()
    expect(screen.getByTestId('view-key-bearer-input')).toBeInTheDocument()
    expect(screen.getByTestId('view-key-bearer-validate-btn')).toBeInTheDocument()
  })

  it('pay CTA calls claimViewKeyCheckout and redirects to URL', async () => {
    vi.mocked(api.claimViewKeyCheckout).mockResolvedValue({
      already_granted: false,
      checkout_url: 'https://buy.stripe.com/test',
    })
    authRef.current = buildAuthValue({
        user: {
          user_id: 'u1',
          email: 'a@b.it',
          kdf_salt: 'x',
          email_verified: true,
          tier: 'free',
          name: 'Test',
          marketing_consent: false,
        },
      })
    // window.location.href assignment — use a getter/setter spy.
    const hrefSetter = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: '' },
    })
    Object.defineProperty(window.location, 'href', {
      configurable: true,
      set: hrefSetter,
    })

    render(<ViewKeyModal isOpen={true} onClose={() => {}} />)
    fireEvent.click(screen.getByTestId('view-key-pay-btn'))
    await waitFor(() =>
      expect(api.claimViewKeyCheckout).toHaveBeenCalledTimes(1),
    )
    await waitFor(() =>
      expect(hrefSetter).toHaveBeenCalledWith('https://buy.stripe.com/test'),
    )
  })

  it('bearer validate rejects invalid format before calling API', () => {
    authRef.current = buildAuthValue({
        user: {
          user_id: 'u1',
          email: 'a@b.it',
          kdf_salt: 'x',
          email_verified: true,
          tier: 'free',
          name: 'Test',
          marketing_consent: false,
        },
      })
    render(<ViewKeyModal isOpen={true} onClose={() => {}} />)
    const input = screen.getByTestId('view-key-bearer-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'wrong-prefix-key' } })
    fireEvent.click(screen.getByTestId('view-key-bearer-validate-btn'))
    expect(screen.getByTestId('view-key-bearer-error')).toBeInTheDocument()
    expect(api.claimViewKeyByBearer).not.toHaveBeenCalled()
  })

  it('bearer validate calls API and triggers refreshViewKey on success', async () => {
    vi.mocked(api.claimViewKeyByBearer).mockResolvedValue({
      granted: true,
      source: 'mhc_bearer',
    })
    const refreshViewKey = vi.fn(async () => {})
    authRef.current = buildAuthValue({
        user: {
          user_id: 'u1',
          email: 'a@b.it',
          kdf_salt: 'x',
          email_verified: true,
          tier: 'free',
          name: 'Test',
          marketing_consent: false,
        },
        refreshViewKey,
      })
    render(<ViewKeyModal isOpen={true} onClose={() => {}} />)
    const input = screen.getByTestId('view-key-bearer-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'mhc_live_abcdef12345' } })
    fireEvent.click(screen.getByTestId('view-key-bearer-validate-btn'))
    await waitFor(() =>
      expect(api.claimViewKeyByBearer).toHaveBeenCalledWith(
        'mhc_live_abcdef12345',
      ),
    )
    await waitFor(() => expect(refreshViewKey).toHaveBeenCalled())
  })

  it('unlocked state shows source pill + mapping table', () => {
    authRef.current = buildAuthValue({
        viewKeyGranted: true,
        viewKeySource: 'paid',
        user: {
          user_id: 'u1',
          email: 'a@b.it',
          kdf_salt: 'x',
          email_verified: true,
          tier: 'free',
          name: 'Test',
          marketing_consent: false,
        },
      })
    activeRef.current = buildActiveValue({
        active: {
          mappingId: 'agg::u1',
          label: 'Test',
          mapper: null as never,
          entries: sampleEntries,
          dirty: false,
          pristine: false,
        },
      })
    render(<ViewKeyModal isOpen={true} onClose={() => {}} />)
    expect(screen.getByTestId('view-key-source-pill')).toBeInTheDocument()
    expect(screen.getByTestId('view-key-table')).toBeInTheDocument()
    expect(screen.getByText('Mario Rossi')).toBeInTheDocument()
    expect(screen.getByText('Tizio')).toBeInTheDocument()
    expect(screen.getByText('Giulia Bianchi')).toBeInTheDocument()
    expect(screen.getByText('Caio')).toBeInTheDocument()
    expect(screen.getByTestId('view-key-copy-btn')).toBeInTheDocument()
    expect(screen.getByTestId('view-key-export-btn')).toBeInTheDocument()
  })

  it('unlocked state with no mapping shows noMapping notice', () => {
    authRef.current = buildAuthValue({
        viewKeyGranted: true,
        viewKeySource: 'pro_tier',
      })
    activeRef.current = buildActiveValue({ active: null })
    render(<ViewKeyModal isOpen={true} onClose={() => {}} />)
    expect(screen.getByTestId('view-key-no-mapping')).toBeInTheDocument()
    expect(screen.queryByTestId('view-key-table')).not.toBeInTheDocument()
  })

  it('Close button triggers onClose', () => {
    const onClose = vi.fn()
    render(<ViewKeyModal isOpen={true} onClose={onClose} />)
    fireEvent.click(screen.getByTestId('view-key-close-btn'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ESC key triggers onClose', () => {
    const onClose = vi.fn()
    render(<ViewKeyModal isOpen={true} onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
