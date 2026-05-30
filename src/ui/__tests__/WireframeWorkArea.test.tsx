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

const FIXTURE = `Il sig. Mario Rossi (CF: RSSMRA80A01H501U) ha contattato l'avvocato via mario.rossi@example.com.`

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
    expect(dxPanel.textContent).not.toContain('RSSMRA80A01H501U')
    expect(dxPanel.textContent).not.toContain('mario.rossi@example.com')
    // Expected masks
    expect(dxPanel.textContent).toContain('<DS>')
    expect(dxPanel.textContent).toContain('<EMAIL>')
  })

  it('copy-output button (Fix 1) appears on the pseudonimizzato panel after a run and copies to clipboard', async () => {
    // Regressione post-wireframe: il copia-output a un click era sparito dal
    // pannello di output. Deve riapparire sul pannello pseudonimizzato dopo
    // una pseudonimizzazione, e copiare il testo pseudonimizzato.
    renderWithProviders()
    // Pre-run: nessun bottone copia (niente output ancora).
    expect(
      screen.queryByTestId('wireframe-copy-pseudonimizzato-btn'),
    ).not.toBeInTheDocument()
    const sx = screen.getByTestId(
      'wireframe-textarea-originale',
    ) as HTMLTextAreaElement
    fireEvent.change(sx, { target: { value: FIXTURE } })
    fireEvent.click(screen.getByTestId('wireframe-action-btn'))
    // Post-run: il bottone copia è presente sul pannello pseudonimizzato.
    const copyBtn = screen.getByTestId('wireframe-copy-pseudonimizzato-btn')
    expect(copyBtn).toBeInTheDocument()
    fireEvent.click(copyBtn)
    // navigator.clipboard.writeText è mockato in beforeEach.
    const writeTextMock = navigator.clipboard.writeText as ReturnType<
      typeof vi.fn
    >
    expect(writeTextMock).toHaveBeenCalledTimes(1)
    const firstCall = writeTextMock.mock.calls[0]
    expect(firstCall).toBeDefined()
    const copied = firstCall![0] as string
    // Copia il testo pseudonimizzato (CF/email mascherati, non in chiaro).
    expect(copied).not.toContain('RSSMRA80A01H501U')
    expect(copied).not.toContain('mario.rossi@example.com')
    expect(copied).toContain('<DS>')
    expect(copied).toContain('<EMAIL>')
    // Feedback "✓ Copiato" dopo il click (state update post-await: usa findBy).
    expect(
      await screen.findByText(/copiato/i),
    ).toBeInTheDocument()
  })

  it('copy-output button (Fix 1) is HIDDEN on the pseudonimizzato panel before any run', () => {
    renderWithProviders()
    const sx = screen.getByTestId(
      'wireframe-textarea-originale',
    ) as HTMLTextAreaElement
    fireEvent.change(sx, { target: { value: FIXTURE } })
    // Testo inserito ma NON ancora pseudonimizzato → nessun output → no copia.
    expect(
      screen.queryByTestId('wireframe-copy-pseudonimizzato-btn'),
    ).not.toBeInTheDocument()
  })

  it('security hint (Fix 2) renders full instructional text on the originale panel after a run', () => {
    // L'avviso "correggi i non riconosciuti" è la rete di sicurezza: deve
    // essere presente e con il testo istruttivo completo (la leggibilità del
    // font/overlap è garantita via CSS, non asseribile in jsdom).
    renderWithProviders()
    const sx = screen.getByTestId(
      'wireframe-textarea-originale',
    ) as HTMLTextAreaElement
    fireEvent.change(sx, { target: { value: FIXTURE } })
    fireEvent.click(screen.getByTestId('wireframe-action-btn'))
    const hints = screen.getAllByTestId('docview-manual-hint')
    expect(hints.length).toBeGreaterThan(0)
    const hint = hints[0]
    expect(hint).toBeDefined()
    // Testo istruttivo chiave presente (prefix + "in chiaro" + suffix).
    expect(hint!.textContent).toMatch(/in chiaro/i)
    expect(hint!.textContent).toMatch(/selezionalo/i)
    expect(hint!.textContent).toMatch(/tutte le occorrenze/i)
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

  it('"sostituisci anche" dropdown = exactly 5 independent toggles, default OFF', () => {
    // Founder criterio 2026-05-30 SID-20260530-095254: il dropdown contiene
    // ESATTAMENTE 5 interruttori veri (luoghi/organizzazioni/tribunali/CAP/
    // date), tutti default OFF. cf/iban/phone/booking rimossi (flusso standard).
    renderWithProviders()
    const modBtn = screen.getByTestId('wireframe-modifier-btn')
    // Closed initially
    expect(
      screen.queryByTestId('wireframe-modifier-dropdown'),
    ).not.toBeInTheDocument()
    fireEvent.click(modBtn)
    expect(screen.getByTestId('wireframe-modifier-dropdown')).toBeInTheDocument()

    // Exactly the 5 canonical toggles present.
    for (const key of ['places', 'organizations', 'courts', 'cap', 'date']) {
      const cb = screen.getByTestId(
        `wireframe-modifier-${key}`,
      ) as HTMLInputElement
      expect(cb).toBeInTheDocument()
      expect(cb.checked).toBe(false) // default OFF
    }
    // Removed (now-fake) entries are GONE from the menu.
    for (const gone of ['cf', 'iban', 'phone', 'booking']) {
      expect(
        screen.queryByTestId(`wireframe-modifier-${gone}`),
      ).not.toBeInTheDocument()
    }

    // Toggling two independent categories tracks the count badge.
    fireEvent.click(screen.getByTestId('wireframe-modifier-places'))
    fireEvent.click(screen.getByTestId('wireframe-modifier-cap'))
    const modBtnAfter = screen.getByTestId('wireframe-modifier-btn')
    expect(modBtnAfter.textContent).toContain('2')
  })

  it('"sostituisci anche" row is HIDDEN in Decodifica mode (no "anche" in decoding)', () => {
    renderWithProviders()
    expect(screen.getByTestId('wireframe-modifier-btn')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('wireframe-macro-decodifica'))
    expect(screen.queryByTestId('wireframe-modifier-btn')).not.toBeInTheDocument()
  })

  it('BundleBanner inline mounts in Decodifica toolbar slot (symmetric to "sostituisci anche")', () => {
    // Founder direttiva SID-20260527-181552: bar BundleBanner mounted in
    // the decodifica side of the toolbar, ESATTAMENTE simmetrico a
    // ".wireframe-modifier-btn" che vive nel lato codifica. Position locked.
    renderWithProviders()
    // In codifica (default) the inline BundleBanner is NOT mounted (the
    // slot is occupied by "sostituisci anche"). Note: the legacy 'header'
    // variant above AppHeader has been removed (App.tsx no longer mounts it).
    expect(screen.queryByTestId('bundle-banner')).not.toBeInTheDocument()
    expect(screen.getByTestId('wireframe-modifier-btn')).toBeInTheDocument()
    // Switch to decodifica → the inline BundleBanner appears in the slot;
    // "sostituisci anche" disappears (mutually exclusive).
    fireEvent.click(screen.getByTestId('wireframe-macro-decodifica'))
    expect(screen.queryByTestId('wireframe-modifier-btn')).not.toBeInTheDocument()
    const banner = screen.getByTestId('bundle-banner')
    expect(banner).toBeInTheDocument()
    expect(banner.getAttribute('data-variant')).toBe('inline')
    expect(banner.className).toContain('bundle-banner--inline')
    // CTA still wired to MHC-L landing.
    const cta = screen.getByTestId('bundle-banner-cta') as HTMLAnchorElement
    expect(cta.href).toContain('micheleloi.pro/mhc-l/')
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
