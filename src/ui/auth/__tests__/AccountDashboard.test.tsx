/**
 * AccountDashboard.test.tsx — tier-routing contract for il dashboard account.
 *
 * Post-migration zero-euro (2026-05-19): la dashboard è duale.
 *   - tier='pro' → fetch /recode/mappings + /recode/false-positives,
 *     form 'Elimina mapping in blocco' visibile, copy elimina account
 *     menziona 'mapping cifrati'.
 *   - tier='free' → niente fetch cloud, sezioni cloud-only mostrate in
 *     stato disabled-grey con paragrafo info; copy elimina account adattata
 *     (NO 'mapping cifrati'); paragrafo helper 'cancella dati browser'.
 *
 * I test mockano `api/client` per ottenere lo user con il tier desiderato
 * e per spiare la fetch dei mapping/falsi positivi (devono NON essere
 * chiamati in tier=free).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import type { MeResponse } from '../../../api/client'

// vi.hoisted so the spies are constructed before the mock factory runs.
const apiMocks = vi.hoisted(() => ({
  meMock: vi.fn(),
  listMappingsMock: vi.fn(),
  getFalsePositivesMock: vi.fn(),
  getMyProRequestMock: vi.fn(),
  requestProInviteMock: vi.fn(),
}))

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>(
    '../../../api/client',
  )
  return {
    ...actual,
    me: apiMocks.meMock,
    listMappings: apiMocks.listMappingsMock,
    getFalsePositives: apiMocks.getFalsePositivesMock,
    getMyProRequest: apiMocks.getMyProRequestMock,
    requestProInvite: apiMocks.requestProInviteMock,
  }
})

import { AuthProvider } from '../../../auth/auth-context'
import { ActiveMappingProvider } from '../../../auth/active-mapping-context'
import { AccountDashboard } from '../AccountDashboard'

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

function renderDashboard(): ReturnType<typeof render> {
  return render(
    <AuthProvider>
      <ActiveMappingProvider>
        <AccountDashboard />
      </ActiveMappingProvider>
    </AuthProvider>,
  )
}

beforeEach(() => {
  apiMocks.meMock.mockReset()
  apiMocks.listMappingsMock.mockReset()
  apiMocks.getFalsePositivesMock.mockReset()
  apiMocks.getMyProRequestMock.mockReset()
  apiMocks.requestProInviteMock.mockReset()
  apiMocks.listMappingsMock.mockResolvedValue({ mappings: [] })
  apiMocks.getFalsePositivesMock.mockResolvedValue({ false_positives: [] })
  apiMocks.getMyProRequestMock.mockResolvedValue({ request: null })
})

describe('AccountDashboard — tier=free', () => {
  beforeEach(() => {
    apiMocks.meMock.mockResolvedValue(meResponseTier('free'))
  })

  it('non chiama /recode/mappings né /recode/false-positives', async () => {
    renderDashboard()
    // Wait until the dashboard has hydrated (user header visible).
    await waitFor(() => {
      expect(screen.getByText(/Account: free@studio\.it/)).toBeInTheDocument()
    })
    expect(apiMocks.listMappingsMock).not.toHaveBeenCalled()
    expect(apiMocks.getFalsePositivesMock).not.toHaveBeenCalled()
  })

  it('mostra heading "Mapping salvati" greyed-out + paragrafo info', async () => {
    renderDashboard()
    await waitFor(() => {
      expect(screen.getByText(/Account: free@studio\.it/)).toBeInTheDocument()
    })
    const panel = screen.getByTestId('free-mappings-panel')
    expect(panel).toBeInTheDocument()
    expect(panel.getAttribute('aria-disabled')).toBe('true')
    // Heading testuale presente (in stile muted).
    const heading = panel.querySelector('h3')
    expect(heading).not.toBeNull()
    expect(heading!.textContent).toMatch(/Mapping salvati/i)
    expect(heading!.className).toMatch(/muted/)
    // Paragrafo info con la frase ratificata dal founder.
    const info = screen.getByTestId('free-mappings-info')
    expect(info.textContent).toMatch(/salvati localmente in questo browser/i)
    expect(info.textContent).toMatch(/€25 una tantum/)
  })

  it('NON renderizza il form "Elimina mapping creati prima di"', async () => {
    renderDashboard()
    await waitFor(() => {
      expect(screen.getByText(/Account: free@studio\.it/)).toBeInTheDocument()
    })
    expect(
      screen.queryByText(/Elimina mapping creati prima di/i),
    ).toBeNull()
    expect(screen.queryByText(/Elimina in blocco/i)).toBeNull()
  })

  it('la copy "Elimina account" non menziona "mapping cifrati"', async () => {
    renderDashboard()
    await waitFor(() => {
      expect(screen.getByText(/Account: free@studio\.it/)).toBeInTheDocument()
    })
    const copy = screen.getByTestId('delete-account-copy-free')
    expect(copy.textContent).not.toMatch(/mapping cifrati/i)
    expect(copy.textContent).toMatch(/Account \+ recovery codes/i)
    expect(copy.textContent).toMatch(/mapping locali nel tuo browser/i)
  })

  it('mostra il paragrafo helper per cancellare i dati del sito dal browser', async () => {
    renderDashboard()
    await waitFor(() => {
      expect(screen.getByText(/Account: free@studio\.it/)).toBeInTheDocument()
    })
    const helper = screen.getByTestId('browser-data-helper')
    expect(helper.textContent).toMatch(/impostazioni del browser/i)
    expect(helper.textContent).toMatch(/Privacy \/ Dati siti/)
    expect(helper.textContent).toMatch(/recode\.micheleloi\.pro/)
  })

  // --- Pro request: Phase 1 minimal email-only funnel (no Stripe wiring yet) ---
  // Founder decision 2026-05-19: full request-then-invite Stripe flow is built
  // in backend + api/client (10 commit) but UI exposes only an email contact.
  // When the founder activates Stripe + env vars, revert this override and the
  // form returns. Tests below check only the email-only minimal version.

  it('mostra la sezione "Richiedi accesso al piano pro" con email contact', async () => {
    renderDashboard()
    await waitFor(() => {
      expect(screen.getByTestId('pro-request-section')).toBeInTheDocument()
    })
    const emailBlock = screen.getByTestId('pro-request-email')
    expect(emailBlock).toBeInTheDocument()
    expect(emailBlock.textContent).toMatch(/mhcl@micheleloi\.pro/)
    // Niente form (Phase 1 minimal). I 10 commit funnel completo restano nel
    // codice ma non sono esposti finché Stripe non è configurato.
    expect(screen.queryByTestId('pro-request-form')).toBeNull()
    expect(screen.queryByTestId('pro-request-reason')).toBeNull()
    expect(screen.queryByTestId('pro-request-submit')).toBeNull()
    expect(apiMocks.requestProInviteMock).not.toHaveBeenCalled()
  })

  it('il link mailto include un subject pre-compilato', async () => {
    renderDashboard()
    await waitFor(() => {
      expect(screen.getByTestId('pro-request-email')).toBeInTheDocument()
    })
    const link = screen
      .getByTestId('pro-request-email')
      .querySelector('a') as HTMLAnchorElement
    expect(link).not.toBeNull()
    expect(link.href).toMatch(/^mailto:mhcl@micheleloi\.pro/)
    expect(decodeURIComponent(link.href)).toMatch(/subject=Recode IT/i)
  })
})

describe('AccountDashboard — tier=pro (sanity, comportamento storico invariato)', () => {
  beforeEach(() => {
    apiMocks.meMock.mockResolvedValue(meResponseTier('pro'))
  })

  it('chiama /recode/mappings e /recode/false-positives', async () => {
    renderDashboard()
    await waitFor(() => {
      expect(apiMocks.listMappingsMock).toHaveBeenCalled()
    })
    expect(apiMocks.getFalsePositivesMock).toHaveBeenCalled()
  })

  it('mostra il form "Elimina mapping creati prima di" e la copy con "mapping cifrati"', async () => {
    renderDashboard()
    await waitFor(() => {
      expect(screen.getByText(/Account: pro@studio\.it/)).toBeInTheDocument()
    })
    expect(
      screen.getByText(/Elimina mapping creati prima di/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/Elimina in blocco/i)).toBeInTheDocument()
    // Copy storica.
    expect(screen.getByText(/mapping cifrati/i)).toBeInTheDocument()
    // Pannelli "free" disabled NON presenti.
    expect(screen.queryByTestId('free-mappings-panel')).toBeNull()
    expect(screen.queryByTestId('free-fps-panel')).toBeNull()
    expect(screen.queryByTestId('browser-data-helper')).toBeNull()
    // La sezione "Richiedi accesso pro" non appare per gli utenti già pro.
    expect(screen.queryByTestId('pro-request-section')).toBeNull()
  })
})
