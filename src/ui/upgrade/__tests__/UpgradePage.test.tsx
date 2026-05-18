/**
 * UpgradePage.test.tsx — claim flow render scenarios.
 *
 * Mocka api/client.claimProInvite. Tre scenari:
 *   1. token valido → render success con bottone Stripe.
 *   2. token invalido → render error con CTA "Torna alla home".
 *   3. token vuoto → di fatto non viene mai chiamato (App.tsx già filtra),
 *      ma UpgradePage stesso passa qualunque stringa → testato con mock errore.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ApiError } from '../../../api/client'

const apiMocks = vi.hoisted(() => ({
  claimProInviteMock: vi.fn(),
}))

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>(
    '../../../api/client',
  )
  return {
    ...actual,
    claimProInvite: apiMocks.claimProInviteMock,
  }
})

import { UpgradePage } from '../UpgradePage'

beforeEach(() => {
  apiMocks.claimProInviteMock.mockReset()
})

describe('UpgradePage', () => {
  it('mostra il bottone checkout Stripe quando il token è valido', async () => {
    apiMocks.claimProInviteMock.mockResolvedValue({
      stripe_payment_link_url: 'https://buy.stripe.com/test_link?client_reference_id=u-1',
      user_id: 'u-1',
      expires_at: '2026-05-26T00:00:00+00:00',
    })

    render(<UpgradePage token="valid-token" onBack={() => undefined} />)

    await waitFor(() => {
      expect(screen.getByTestId('upgrade-ready')).toBeInTheDocument()
    })
    const link = screen.getByTestId('upgrade-checkout-link') as HTMLAnchorElement
    expect(link.href).toMatch(/buy\.stripe\.com\/test_link/)
    expect(link.href).toMatch(/client_reference_id=u-1/)
    // Copy chiave deve essere presente.
    expect(
      screen.getByText(/Nessuna carta richiesta/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/€0\/mese/)).toBeInTheDocument()
  })

  it('mostra messaggio di errore quando il token è invalido', async () => {
    apiMocks.claimProInviteMock.mockRejectedValue(
      new ApiError(
        400,
        { error: 'invalid_invite_token', message: 'Invito non valido, scaduto o già utilizzato.' },
        'HTTP 400',
      ),
    )

    render(<UpgradePage token="bad-token" onBack={() => undefined} />)

    await waitFor(() => {
      expect(screen.getByTestId('upgrade-error')).toBeInTheDocument()
    })
    expect(screen.getByTestId('upgrade-error-message').textContent).toMatch(
      /Invito non valido/,
    )
    expect(screen.getByTestId('upgrade-back')).toBeInTheDocument()
  })

  it('invoca onBack quando l\'utente clicca "Torna alla home" nel branch error', async () => {
    apiMocks.claimProInviteMock.mockRejectedValue(
      new ApiError(
        400,
        { error: 'invalid_invite_token', message: 'Invito non valido.' },
        'HTTP 400',
      ),
    )
    const onBack = vi.fn()
    render(<UpgradePage token="bad" onBack={onBack} />)
    await waitFor(() => {
      expect(screen.getByTestId('upgrade-back')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('upgrade-back'))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
