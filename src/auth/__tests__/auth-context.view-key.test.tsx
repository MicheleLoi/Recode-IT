/**
 * auth-context.view-key.test.tsx — verify the view-key permission state
 * machine wired into AuthContext.
 *
 * Tests the API-mocked refreshViewKey() flow:
 *   - granted=true / source resolution
 *   - granted=false / source null
 *   - fetch failure → cleared local state
 *   - logout clears state
 *   - manual refreshViewKey() trigger
 */

import 'fake-indexeddb/auto'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { AuthProvider, useAuth } from '../auth-context'

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>(
    '../../api/client',
  )
  return {
    ...actual,
    me: vi.fn(async () => ({
      user_id: 'user-vk-1',
      email: 'vk@example.it',
      kdf_salt: '00112233445566778899aabbccddeeff',
      email_verified: true,
      created_at: '2026-05-23T00:00:00Z',
      tier: 'free' as const,
      name: 'View Key Tester',
      marketing_consent: false,
    })),
    logout: vi.fn(async () => ({ ok: true as const })),
    getViewKeyPermission: vi.fn(),
  }
})

import * as api from '../../api/client'

function wrapper({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>
}

describe('auth-context view-key permission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default me() impl is set in vi.mock; restore in case a test overrides.
    vi.mocked(api.me).mockResolvedValue({
      user_id: 'user-vk-1',
      email: 'vk@example.it',
      kdf_salt: '00112233445566778899aabbccddeeff',
      email_verified: true,
      created_at: '2026-05-23T00:00:00Z',
      tier: 'free',
      name: 'View Key Tester',
      marketing_consent: false,
    })
  })

  it('starts with viewKeyGranted=false / source=null before fetch resolves', async () => {
    vi.mocked(api.getViewKeyPermission).mockResolvedValue({
      granted: false,
      source: null,
    })
    const { result } = renderHook(() => useAuth(), { wrapper })
    expect(result.current.viewKeyGranted).toBe(false)
    expect(result.current.viewKeySource).toBeNull()
    await waitFor(() => expect(result.current.user).not.toBeNull())
    // After fetch settles, still false (backend returned not-granted).
    await waitFor(() => {
      expect(api.getViewKeyPermission).toHaveBeenCalled()
    })
  })

  it('sets granted=true + source=paid when backend grants permission', async () => {
    vi.mocked(api.getViewKeyPermission).mockResolvedValue({
      granted: true,
      source: 'paid',
    })
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.user).not.toBeNull())
    await waitFor(() => expect(result.current.viewKeyGranted).toBe(true))
    expect(result.current.viewKeySource).toBe('paid')
  })

  it('sets granted=true + source=mhc_bearer when Bearer is linked', async () => {
    vi.mocked(api.getViewKeyPermission).mockResolvedValue({
      granted: true,
      source: 'mhc_bearer',
    })
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.user).not.toBeNull())
    await waitFor(() => expect(result.current.viewKeyGranted).toBe(true))
    expect(result.current.viewKeySource).toBe('mhc_bearer')
  })

  it('sets granted=true + source=pro_tier for Pro users (implicit grant)', async () => {
    vi.mocked(api.getViewKeyPermission).mockResolvedValue({
      granted: true,
      source: 'pro_tier',
    })
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.user).not.toBeNull())
    await waitFor(() => expect(result.current.viewKeyGranted).toBe(true))
    expect(result.current.viewKeySource).toBe('pro_tier')
  })

  it('clears state on permission fetch failure (e.g. network error)', async () => {
    vi.mocked(api.getViewKeyPermission).mockRejectedValue(
      new Error('network down'),
    )
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.user).not.toBeNull())
    await waitFor(() => {
      expect(api.getViewKeyPermission).toHaveBeenCalled()
    })
    // Failed fetch → silent clearing of local state.
    expect(result.current.viewKeyGranted).toBe(false)
    expect(result.current.viewKeySource).toBeNull()
  })

  it('clears view-key state on logout', async () => {
    vi.mocked(api.getViewKeyPermission).mockResolvedValue({
      granted: true,
      source: 'paid',
    })
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.user).not.toBeNull())
    await waitFor(() => expect(result.current.viewKeyGranted).toBe(true))

    await act(async () => {
      await result.current.logout()
    })

    expect(result.current.user).toBeNull()
    expect(result.current.viewKeyGranted).toBe(false)
    expect(result.current.viewKeySource).toBeNull()
  })

  it('manual refreshViewKey() updates state when backend changes grant', async () => {
    // First call: not granted (e.g. user hasn't paid yet).
    vi.mocked(api.getViewKeyPermission).mockResolvedValueOnce({
      granted: false,
      source: null,
    })
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.user).not.toBeNull())
    await waitFor(() => {
      expect(api.getViewKeyPermission).toHaveBeenCalledTimes(1)
    })
    expect(result.current.viewKeyGranted).toBe(false)

    // Second call: granted (user returned from Stripe checkout).
    vi.mocked(api.getViewKeyPermission).mockResolvedValueOnce({
      granted: true,
      source: 'paid',
    })
    await act(async () => {
      await result.current.refreshViewKey()
    })
    expect(result.current.viewKeyGranted).toBe(true)
    expect(result.current.viewKeySource).toBe('paid')
  })

  it('user=null (me() fails) does NOT fetch view-key permission', async () => {
    vi.mocked(api.me).mockRejectedValueOnce(new Error('401'))
    vi.mocked(api.getViewKeyPermission).mockResolvedValue({
      granted: false,
      source: null,
    })
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.user).toBeNull()
    // The userId-effect guards against firing when user is null.
    expect(api.getViewKeyPermission).not.toHaveBeenCalled()
    expect(result.current.viewKeyGranted).toBe(false)
    expect(result.current.viewKeySource).toBeNull()
  })
})
