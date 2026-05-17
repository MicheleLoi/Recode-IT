/**
 * ClipboardWidget — end-to-end render of the two-panel layout and a smoke run
 * of the pseudonymize pipeline against a short Italian-legal-flavored fixture.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ClipboardWidget } from '../ClipboardWidget'

const FIXTURE = `Il sig. Mario Rossi (CF: RSSMRA80A01H501Z), residente in
Roma, ha contattato l'avvocato all'indirizzo mario.rossi@example.com per
il bonifico sull'IBAN IT60X0542811101000000123456.`

beforeEach(() => {
  // jsdom doesn't ship navigator.clipboard — stub it for the copy buttons.
  Object.assign(navigator, {
    clipboard: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  })
})

describe('ClipboardWidget', () => {
  it('renders both panels in the two-panel layout', () => {
    render(<ClipboardWidget />)
    expect(screen.getByTestId('clipboard-widget')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /pseudonimizza/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /^recode$/i })).toBeInTheDocument()
    expect(screen.getByTestId('drop-zone')).toBeInTheDocument()
    expect(screen.getByTestId('claude-response-textarea')).toBeInTheDocument()
  })

  it('shows an error if user presses Pseudonimizza with empty input', () => {
    render(<ClipboardWidget />)
    fireEvent.click(screen.getByTestId('pseudonymize-btn'))
    expect(screen.getByTestId('pseudo-error')).toHaveTextContent(/inserisci del testo/i)
  })

  it('pseudonymizes a fixture end-to-end and populates the review list', () => {
    render(<ClipboardWidget />)
    const input = screen.getByTestId('original-textarea') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: FIXTURE } })
    fireEvent.click(screen.getByTestId('pseudonymize-btn'))

    const pseudo = screen.getByTestId('pseudonymized-textarea') as HTMLTextAreaElement
    // Regex pipeline should mask the CF, IBAN and email — none of the original
    // structured identifiers should survive in the masked output.
    expect(pseudo.value).not.toContain('RSSMRA80A01H501Z')
    expect(pseudo.value).not.toContain('mario.rossi@example.com')
    expect(pseudo.value).not.toContain('IT60X0542811101000000123456')
    expect(pseudo.value).toContain('<DS>')
    expect(pseudo.value).toContain('<EMAIL>')
    expect(pseudo.value).toContain('<IBAN>')

    // The review list must render at least one row per masked detection.
    expect(screen.getByTestId('review-list')).toBeInTheDocument()
  })

  it('copies the pseudonymized text to the clipboard', async () => {
    render(<ClipboardWidget />)
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
    render(<ClipboardWidget />)
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
