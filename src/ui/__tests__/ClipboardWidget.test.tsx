/**
 * ClipboardWidget — end-to-end render of the two-panel layout and a smoke run
 * of the pseudonymize pipeline against a short Italian-legal-flavored fixture.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ClipboardWidget } from '../ClipboardWidget'
import { AuthProvider } from '../../auth/auth-context'
import { ActiveMappingProvider } from '../../auth/active-mapping-context'

// CF re-encoded to a checksum-valid form (CEI 12-1979) to satisfy the
// post-match `validateCF` filter introduced in Pacchetto A
// (SID-20260527-181552 — CF hardening). The IBAN was already MOD-97-valid.
const FIXTURE = `Il sig. Mario Rossi (CF: RSSMRA80A01H501U), residente in
Roma, ha contattato l'avvocato all'indirizzo mario.rossi@example.com per
il bonifico sull'IBAN IT60X0542811101000000123456.`

// Phase-3 wiring: ClipboardWidget now consumes both auth and active-mapping
// contexts (so it can flip into "extend mode" when a saved mapping is open,
// and so the Save button knows whether the master key is in memory). The
// tests run anonymous (no /recode/me cookie in jsdom) so AuthProvider stays
// in its loading-then-null state — exactly the path an unauthenticated
// pseudonymize-locally workflow takes.
function renderWithProviders(): ReturnType<typeof render> {
  return render(
    <AuthProvider>
      <ActiveMappingProvider>
        <ClipboardWidget />
      </ActiveMappingProvider>
    </AuthProvider>,
  )
}

beforeEach(() => {
  // jsdom doesn't ship navigator.clipboard — stub it for the copy buttons.
  Object.assign(navigator, {
    clipboard: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  })
  // The AuthProvider fires `me()` at mount; in jsdom there's no backend, so
  // we stub global fetch to return a 401 (anonymous). This keeps the spinner
  // off-screen during the synchronous render.
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status: 401,
    text: async () => '',
  }) as typeof fetch
})

describe('ClipboardWidget', () => {
  it('renders both panels in the two-panel layout', () => {
    renderWithProviders()
    expect(screen.getByTestId('clipboard-widget')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /pseudonimizza/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /^recode$/i })).toBeInTheDocument()
    expect(screen.getByTestId('drop-zone')).toBeInTheDocument()
    expect(screen.getByTestId('claude-response-textarea')).toBeInTheDocument()
  })

  it('shows an error if user presses Pseudonimizza with empty input', () => {
    renderWithProviders()
    fireEvent.click(screen.getByTestId('pseudonymize-btn'))
    expect(screen.getByTestId('pseudo-error')).toHaveTextContent(/inserisci del testo/i)
  })

  it('pseudonymizes a fixture end-to-end and populates the review list', () => {
    renderWithProviders()
    const input = screen.getByTestId('original-textarea') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: FIXTURE } })
    fireEvent.click(screen.getByTestId('pseudonymize-btn'))

    const pseudo = screen.getByTestId('pseudonymized-textarea') as HTMLTextAreaElement
    // Regex pipeline should mask the CF, IBAN and email — none of the original
    // structured identifiers should survive in the masked output.
    expect(pseudo.value).not.toContain('RSSMRA80A01H501U')
    expect(pseudo.value).not.toContain('mario.rossi@example.com')
    expect(pseudo.value).not.toContain('IT60X0542811101000000123456')
    expect(pseudo.value).toContain('<DS>')
    expect(pseudo.value).toContain('<EMAIL>')
    expect(pseudo.value).toContain('<IBAN>')

    // The review list must render at least one row per masked detection.
    expect(screen.getByTestId('review-list')).toBeInTheDocument()
  })

  it('copies the pseudonymized text to the clipboard', async () => {
    renderWithProviders()
    const input = screen.getByTestId('original-textarea') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: FIXTURE } })
    fireEvent.click(screen.getByTestId('pseudonymize-btn'))

    await act(async () => {
      fireEvent.click(screen.getByTestId('copy-pseudonymized-btn'))
    })
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1)
    const writeText = navigator.clipboard.writeText as ReturnType<typeof vi.fn>
    const firstCall = writeText.mock.calls[0]
    expect(firstCall).toBeDefined()
    const arg = firstCall![0] as string
    expect(arg).toContain('<EMAIL>')
  })

  it('restores the original value in preview when an entity is marked false positive', () => {
    renderWithProviders()
    const input = screen.getByTestId('original-textarea') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: FIXTURE } })
    fireEvent.click(screen.getByTestId('pseudonymize-btn'))

    const pseudoBefore = (screen.getByTestId('pseudonymized-textarea') as HTMLTextAreaElement).value
    expect(pseudoBefore).toContain('<EMAIL>')

    // Find the row representing the email detection and trigger Falso positivo.
    const falseBtns = screen.getAllByRole('button', { name: /falso positivo/i })
    // Click the first email-row's false-positive button. We expect the email
    // to reappear in the preview and a falsePositive status on the row.
    const emailRow = screen
      .getAllByTestId(/^review-row-/)
      .find((row) => row.textContent?.includes('mario.rossi@example.com'))
    expect(emailRow).toBeDefined()
    const emailFalseBtn = emailRow!.querySelector('button.btn--danger') as HTMLButtonElement
    fireEvent.click(emailFalseBtn)
    // After the click, either the targeted button or another button still works;
    // we assert via the row's status flip.
    expect(emailRow!.getAttribute('data-status')).toBe('falsePositive')
    const pseudoAfter = (screen.getByTestId('pseudonymized-textarea') as HTMLTextAreaElement).value
    expect(pseudoAfter).toContain('mario.rossi@example.com')
    // Silence unused-warning on falseBtns.
    expect(falseBtns.length).toBeGreaterThan(0)
  })
})
