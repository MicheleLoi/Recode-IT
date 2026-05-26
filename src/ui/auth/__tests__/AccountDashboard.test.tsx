/**
 * AccountDashboard.test.tsx — tier-routing contract for il dashboard account.
 *
 * Post-migration zero-euro (2026-05-19): la dashboard è duale.
 *   - tier='pro' → fetch /recode/mappings + /recode/false-positives,
 *     form 'Elimina mapping in blocco' visibile, copy elimina account
 *     menziona 'mapping cifrati'.
 *   - tier='free' → niente fetch cloud, panel "I miei mapping" ATTIVA con
 *     C1 visibility (canon 2026-05-26 _org/decision_log.md): empty state
 *     card-level finché entries=0; voce mapping locale con metadata quando
 *     entries>0. NEW Pro upsell panel SOTTO la voce attiva (non sopra).
 *     Copy elimina account adattata (NO 'mapping cifrati'); paragrafo helper
 *     'cancella dati browser'.
 *
 * Post-pivot 2026-05-24/25: Pro €25 cloud zero-knowledge è parcheggiato fuori
 * landing principale (paywall Decodifica €20 è il canale primario). La
 * sezione "Richiedi accesso al piano pro" è stata rimossa dalla dashboard;
 * i test rilevanti ora asseriscono la sua assenza per il tier free.
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

  // Canon 2026-05-26 (_org/decision_log.md): panel "I miei mapping" ATTIVA
  // (NON più disabled). Empty state card-level finché entries=0.
  // Wrappato in ActiveMappingProvider senza login esplicito → active=null
  // → empty state visibile.
  it('mostra panel "I miei mapping" ATTIVA (non disabled) con empty state card-level', async () => {
    renderDashboard()
    await waitFor(() => {
      expect(screen.getByText(/Account: free@studio\.it/)).toBeInTheDocument()
    })
    const panel = screen.getByTestId('free-mappings-panel')
    expect(panel).toBeInTheDocument()
    // C1: panel è ATTIVA, non più aria-disabled / muted heading.
    expect(panel.getAttribute('aria-disabled')).toBeNull()
    const heading = panel.querySelector('h3')
    expect(heading).not.toBeNull()
    expect(heading!.textContent).toMatch(/I miei mapping/i)
    expect(heading!.className).not.toMatch(/muted/)
    // Empty state body visibile (active=null nel provider di test).
    const emptyBody = screen.getByTestId('free-mappings-empty')
    expect(emptyBody.textContent).toMatch(
      /Non hai ancora pseudonimizzato nessun documento/i,
    )
    expect(emptyBody.textContent).toMatch(/Vai a Codifica/i)
    // Hard rule post-pivot: nessuna menzione "€25" qui (Pro upsell separato
    // ha la sua copy, ma niente prezzo).
    expect(panel.textContent).not.toMatch(/€25/)
    // C1: empty state → bottone "Elimina mapping" NASCOSTO (voce assente,
    // niente da eliminare).
    expect(screen.queryByTestId('local-mapping-delete')).toBeNull()
    expect(screen.queryByTestId('local-mapping-row')).toBeNull()
  })

  it('rende il pannello Pro upsell SOTTO la voce "I miei mapping" con CTA mailto', async () => {
    renderDashboard()
    await waitFor(() => {
      expect(screen.getByText(/Account: free@studio\.it/)).toBeInTheDocument()
    })
    const upsell = screen.getByTestId('pro-upsell-panel')
    expect(upsell).toBeInTheDocument()
    expect(upsell.className).toMatch(/panel--upsell/)
    // Pro upsell DEVE apparire DOPO la voce "I miei mapping" nel DOM
    // (canon 2026-05-26 §"refinement #1": no effetto pubblicitario invasivo).
    const miei = screen.getByTestId('free-mappings-panel')
    expect(
      miei.compareDocumentPosition(upsell) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    // Heading + body content sanity.
    const heading = upsell.querySelector('h3')
    expect(heading!.textContent).toMatch(/Mapping multipli/i)
    expect(heading!.textContent).toMatch(/Pro, in arrivo/i)
    expect(upsell.textContent).toMatch(/zero-knowledge/i)
    // CTA mailto a mhcl@micheleloi.pro (coerente con PrivacyPage.tsx +
    // UpgradePage.tsx — nessuna const dedicata in src/).
    const cta = screen.getByTestId('pro-upsell-cta')
    expect(cta.getAttribute('href')).toBe('mailto:mhcl@micheleloi.pro')
    expect(cta.textContent).toMatch(/Scrivici/i)
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

  // --- Post-pivot 2026-05-24/25: Pro €25 cloud zero-knowledge è parcheggiato
  // fuori landing principale (paywall Decodifica €20 è il canale primario).
  // La sezione "Richiedi accesso al piano pro" è stata rimossa dalla dashboard.
  // Backend + api/client (getMyProRequest/requestProInvite) restano dietro env
  // vars per riattivazione futura ma non sono più esposti qui.

  it('NON mostra la sezione "Richiedi accesso al piano pro" (Pro parcheggiato post-pivot)', async () => {
    renderDashboard()
    await waitFor(() => {
      expect(screen.getByText(/Account: free@studio\.it/)).toBeInTheDocument()
    })
    expect(screen.queryByTestId('pro-request-section')).toBeNull()
    expect(screen.queryByTestId('pro-request-email')).toBeNull()
    expect(screen.queryByTestId('pro-request-form')).toBeNull()
    expect(apiMocks.requestProInviteMock).not.toHaveBeenCalled()
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
    // Pannelli "free" NON presenti per tier=pro.
    expect(screen.queryByTestId('free-mappings-panel')).toBeNull()
    expect(screen.queryByTestId('free-fps-panel')).toBeNull()
    expect(screen.queryByTestId('browser-data-helper')).toBeNull()
    // Canon 2026-05-26: Pro upsell + voce locale appartengono SOLO al
    // ramo free; NON devono apparire in tier=pro.
    expect(screen.queryByTestId('pro-upsell-panel')).toBeNull()
    expect(screen.queryByTestId('local-mapping-row')).toBeNull()
    // La sezione "Richiedi accesso pro" non appare per gli utenti già pro.
    expect(screen.queryByTestId('pro-request-section')).toBeNull()
  })
})
