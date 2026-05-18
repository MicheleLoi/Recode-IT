/**
 * App.user-lock.test.tsx — tier-routing per il widget "(bloccato)" nell'header.
 *
 * Contract:
 *   - tier='pro' + masterKey assente → widget app__user-lock visibile
 *     (l'avvocato deve sapere che serve ridigitare la password per
 *     cifrare/decifrare i mapping server).
 *   - tier='free' + masterKey assente → widget NON visibile (per il free
 *     i mapping vivono in IDB in chiaro, non c'è nulla da sbloccare —
 *     mostrare "(bloccato)" è disinformazione).
 *
 * Il masterKey resta `null` perché AuthProvider.refresh() (chiamato a mount)
 * idrata `user` da /recode/me ma NON deriva la master key (quella nasce
 * solo da login() con password). Quindi mockando `me()` con tier specifico
 * otteniamo esattamente lo scenario "JWT cookie valido + master key non in
 * memoria" — il caso che ha causato la regressione UX sul live.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import type { MeResponse } from '../api/client'

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

function meResponseTier(tier: 'free' | 'pro'): MeResponse {
  return {
    user_id: `user-${tier}-1`,
    email: tier === 'pro' ? 'pro@studio.it' : 'free@studio.it',
    kdf_salt: '00112233445566778899aabbccddeeff',
    email_verified: true,
    created_at: '2026-05-18T00:00:00Z',
    tier,
    name: 'Avvocato Test',
    marketing_consent: false,
  }
}

beforeEach(() => {
  apiMocks.meMock.mockReset()
})

describe('AppHeader — (bloccato) tier routing', () => {
  it('tier=pro + masterKey assente → widget "(bloccato)" visibile', async () => {
    apiMocks.meMock.mockResolvedValue(meResponseTier('pro'))
    render(<App />)
    const emailSpan = await waitFor(() => screen.getByTestId('auth-user-email'))
    expect(emailSpan.textContent).toMatch(/pro@studio\.it/)
    expect(emailSpan.textContent).toMatch(/\(bloccato\)/)
  })

  it('tier=free + masterKey assente → widget "(bloccato)" NON visibile', async () => {
    apiMocks.meMock.mockResolvedValue(meResponseTier('free'))
    render(<App />)
    const emailSpan = await waitFor(() => screen.getByTestId('auth-user-email'))
    expect(emailSpan.textContent).toMatch(/free@studio\.it/)
    expect(emailSpan.textContent).not.toMatch(/\(bloccato\)/)
  })
})
