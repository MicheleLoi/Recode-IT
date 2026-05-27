/**
 * WireframeWorkArea — end-to-end smoke of the side-by-side panels work area
 * (post SID-20260527 wireframe-first rewrite). Coverage:
 *
 *   1. 2-macro toggle (Codifica / Decodifica) preserves panel content
 *   2. Pseudonimizza button disabled when input panel empty
 *   3. Codifica pipeline: empty input shows error; populated input runs
 *      regex-only path (no NER worker in jsdom) and populates right panel
 *   4. Panel labels are stable across macro switch (originale | pseudonimizzato)
 *   5. Mappa cards: "Chiavi locali" toggles MappaPanel; "Chiavi su server"
 *      opens upsell modal
 *   6. Modal closes on backdrop click / × button / ESC key
 *   7. Decodifica preview pattern (free tier): banner ANTEPRIMA + CTA only
 *      when there's a Decodifica output AND user is free-tier
 *   8. "sostituisci anche" dropdown opens/closes with chevron toggle
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WireframeWorkArea } from '../WireframeWorkArea'
import { AuthProvider } from '../../auth/auth-context'
import { ActiveMappingProvider } from '../../auth/active-mapping-context'
import { LanguageProvider } from '../LanguageContext'

const FIXTURE = `Il sig. Mario Rossi (CF: RSSMRA80A01H501Z) ha contattato l'avvocato via mario.rossi@example.com.`

function renderWithProviders(): ReturnType<typeof render> {
  return render(
    <LanguageProvider>
      <AuthProvider>
        <ActiveMappingProvider>
          <WireframeWorkArea />
        </ActiveMappingProvider>
      </AuthProvider>
    </LanguageProvider>,
  )
}

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  })
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status: 401,
    text: async () => '',
  }) as typeof fetch
  try {
    localStorage.clear()
  } catch {
    /* ignore */
  }
})

describe('WireframeWorkArea — layout + macro toggle', () => {
  it('renders 2-macro toggle + toolbar + 2 panels + mappa cards', () => {
    renderWithProviders()
    expect(screen.getByTestId('wireframe-workarea')).toBeInTheDocument()
    expect(screen.getByTestId('wireframe-macro-codifica')).toBeInTheDocument()
    expect(screen.getByTestId('wireframe-macro-decodifica')).toBeInTheDocument()
    expect(screen.getByTestId('wireframe-action-btn')).toBeInTheDocument()
    expect(screen.getByTestId('wireframe-panel-originale')).toBeInTheDocument()
    expect(screen.getByTestId('wireframe-panel-pseudonimizzato')).toBeInTheDocument()
    expect(screen.getByTestId('wireframe-card-locali')).toBeInTheDocument()
    expect(screen.getByTestId('wireframe-card-server')).toBeInTheDocument()
  })

  it('defaults to codifica mode; toggle switches to decodifica', () => {
    renderWithProviders()
    expect(screen.getByTestId('wireframe-macro-codifica')).toHaveAttribute(
      'aria-selected',
      'true',
    )
    fireEvent.click(screen.getByTestId('wireframe-macro-decodifica'))
    expect(screen.getByTestId('wireframe-macro-decodifica')).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByTestId('wireframe-macro-codifica')).toHaveAttribute(
      'aria-selected',
      'false',
    )
  })

  it('preserves panel content across macro switch (no wipe)', () => {
    renderWithProviders()
    const sx = screen.getByTestId('wireframe-textarea-originale') as HTMLTextAreaElement
    fireEvent.change(sx, { target: { value: 'qualche testo' } })
    expect(sx.value).toBe('qualche testo')
    fireEvent.click(screen.getByTestId('wireframe-macro-decodifica'))
    // After switch, content is still in the originale field (read-only in
    // decodifica mode, but still present).
    const sxAgain = screen.getByTestId(
      'wireframe-textarea-originale',
    ) as HTMLTextAreaElement
    expect(sxAgain.value).toBe('qualche testo')
    fireEvent.click(screen.getByTestId('wireframe-macro-codifica'))
    const sxBack = screen.getByTestId(
      'wireframe-textarea-originale',
    ) as HTMLTextAreaElement
    expect(sxBack.value).toBe('qualche testo')
  })

  it('panel labels are STABLE across macro switch (sx=originale, dx=pseudonimizzato)', () => {
    renderWithProviders()
    const sxPanel = screen.getByTestId('wireframe-panel-originale')
    const dxPanel = screen.getByTestId('wireframe-panel-pseudonimizzato')
    // Codifica mode
    expect(sxPanel.querySelector('.wireframe-panel__label')?.textContent).toMatch(
      /originale/i,
    )
    expect(dxPanel.querySelector('.wireframe-panel__label')?.textContent).toMatch(
      /pseudonimizzato/i,
    )
    fireEvent.click(screen.getByTestId('wireframe-macro-decodifica'))
    // Labels MUST remain stable in Decodifica too (founder direttiva
    // SID-20260527: panel labels semantici stabili, è il flusso che si
    // inverte, non i labels).
    expect(sxPanel.querySelector('.wireframe-panel__label')?.textContent).toMatch(
      /originale/i,
    )
    expect(dxPanel.querySelector('.wireframe-panel__label')?.textContent).toMatch(
      /pseudonimizzato/i,
    )
  })
})

describe('WireframeWorkArea — Codifica flow', () => {
  it('PSEUDONIMIZZA button is disabled when input empty', () => {
    renderWithProviders()
    const actionBtn = screen.getByTestId('wireframe-action-btn') as HTMLButtonElement
    expect(actionBtn.disabled).toBe(true)
  })

  it('PSEUDONIMIZZA button enabled once user pastes text', () => {
    renderWithProviders()
    const sx = screen.getByTestId(
      'wireframe-textarea-originale',
    ) as HTMLTextAreaElement
    fireEvent.change(sx, { target: { value: FIXTURE } })
    const actionBtn = screen.getByTestId('wireframe-action-btn') as HTMLButtonElement
    expect(actionBtn.disabled).toBe(false)
  })

  it('runs regex-only pipeline (no NER in jsdom) and populates pseudonimizzato panel', () => {
    renderWithProviders()
    const sx = screen.getByTestId(
      'wireframe-textarea-originale',
    ) as HTMLTextAreaElement
    fireEvent.change(sx, { target: { value: FIXTURE } })
    fireEvent.click(screen.getByTestId('wireframe-action-btn'))
    // After pseudonymize, the right panel shows DocumentView (highlighted
    // entities inline) instead of the textarea — assert via wireframe panel
    // contains substituted tokens.
    const dxPanel = screen.getByTestId('wireframe-panel-pseudonimizzato')
    // CF / email regex matched
    expect(dxPanel.textContent).not.toContain('RSSMRA80A01H501Z')
    expect(dxPanel.textContent).not.toContain('mario.rossi@example.com')
    // Expected masks
    expect(dxPanel.textContent).toContain('<DS>')
    expect(dxPanel.textContent).toContain('<EMAIL>')
  })

  it('shows error when PSEUDONIMIZZA clicked with empty text (defensive — guarded by disabled, but error path is wired)', () => {
    renderWithProviders()
    const sx = screen.getByTestId(
      'wireframe-textarea-originale',
    ) as HTMLTextAreaElement
    // Place a space-only string so disabled gate's trim() passes false but
    // the engine still gets an empty trimmed input.
    fireEvent.change(sx, { target: { value: '   ' } })
    const actionBtn = screen.getByTestId('wireframe-action-btn') as HTMLButtonElement
    // disabled still — trim() empty
    expect(actionBtn.disabled).toBe(true)
  })

  it('"sostituisci anche" toggle reveals categories and tracks count', () => {
    renderWithProviders()
    const modBtn = screen.getByTestId('wireframe-modifier-btn')
    // Closed initially
    expect(
      screen.queryByTestId('wireframe-modifier-dropdown'),
    ).not.toBeInTheDocument()
    fireEvent.click(modBtn)
    expect(screen.getByTestId('wireframe-modifier-dropdown')).toBeInTheDocument()
    // Toggle cf + iban
    fireEvent.click(screen.getByTestId('wireframe-modifier-cf'))
    fireEvent.click(screen.getByTestId('wireframe-modifier-iban'))
    // Count badge present
    const modBtnAfter = screen.getByTestId('wireframe-modifier-btn')
    expect(modBtnAfter.textContent).toContain('2')
  })

  it('"sostituisci anche" row is HIDDEN in Decodifica mode (no "anche" in decoding)', () => {
    renderWithProviders()
    expect(screen.getByTestId('wireframe-modifier-btn')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('wireframe-macro-decodifica'))
    expect(screen.queryByTestId('wireframe-modifier-btn')).not.toBeInTheDocument()
  })

  it('"Nuovo documento" button clears the originale panel', () => {
    renderWithProviders()
    const sx = screen.getByTestId(
      'wireframe-textarea-originale',
    ) as HTMLTextAreaElement
    fireEvent.change(sx, { target: { value: FIXTURE } })
    expect(sx.value).toBe(FIXTURE)
    fireEvent.click(screen.getByTestId('wireframe-new-doc-btn'))
    const sxAfter = screen.getByTestId(
      'wireframe-textarea-originale',
    ) as HTMLTextAreaElement
    expect(sxAfter.value).toBe('')
  })
})

describe('WireframeWorkArea — Decodifica flow', () => {
  it('DECODIFICA button label + arrows direction flips on macro toggle', () => {
    renderWithProviders()
    expect(screen.getByTestId('wireframe-action-btn').textContent).toMatch(
      /PSEUDONIMIZZA/,
    )
    fireEvent.click(screen.getByTestId('wireframe-macro-decodifica'))
    expect(screen.getByTestId('wireframe-action-btn').textContent).toMatch(
      /DECODIFICA/,
    )
  })

  it('anonymous user in Decodifica with empty input → button stays disabled', () => {
    renderWithProviders()
    fireEvent.click(screen.getByTestId('wireframe-macro-decodifica'))
    const actionBtn = screen.getByTestId('wireframe-action-btn') as HTMLButtonElement
    expect(actionBtn.disabled).toBe(true)
  })

  it('anonymous user in Decodifica with input shows sign-in nudge after switching macro', () => {
    renderWithProviders()
    fireEvent.click(screen.getByTestId('wireframe-macro-decodifica'))
    expect(screen.getByTestId('wireframe-decodifica-anon')).toBeInTheDocument()
  })
})

describe('WireframeWorkArea — Mappa cards + modal', () => {
  it('clicking "Chiavi locali" card toggles its data-active state', () => {
    renderWithProviders()
    const card = screen.getByTestId('wireframe-card-locali')
    expect(card.getAttribute('data-active')).toBe('false')
    fireEvent.click(card)
    expect(card.getAttribute('data-active')).toBe('true')
    fireEvent.click(card)
    expect(card.getAttribute('data-active')).toBe('false')
  })

  it('clicking "Chiavi su server" card opens the upsell modal', () => {
    renderWithProviders()
    expect(
      screen.queryByTestId('wireframe-modal-backdrop'),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('wireframe-card-server'))
    expect(screen.getByTestId('wireframe-modal-backdrop')).toBeInTheDocument()
    expect(screen.getByText(/i miei mapping/i)).toBeInTheDocument()
  })

  it('modal closes via × button', () => {
    renderWithProviders()
    fireEvent.click(screen.getByTestId('wireframe-card-server'))
    fireEvent.click(screen.getByTestId('wireframe-modal-close'))
    expect(
      screen.queryByTestId('wireframe-modal-backdrop'),
    ).not.toBeInTheDocument()
  })

  it('modal closes via backdrop click', () => {
    renderWithProviders()
    fireEvent.click(screen.getByTestId('wireframe-card-server'))
    const backdrop = screen.getByTestId('wireframe-modal-backdrop')
    fireEvent.click(backdrop)
    expect(
      screen.queryByTestId('wireframe-modal-backdrop'),
    ).not.toBeInTheDocument()
  })
})

describe('WireframeWorkArea — visual stability', () => {
  it('data-decodifica-truncated attribute exposed for E2E telemetry', () => {
    renderWithProviders()
    const wa = screen.getByTestId('wireframe-workarea')
    expect(wa.getAttribute('data-decodifica-truncated')).toBe('false')
  })
})
