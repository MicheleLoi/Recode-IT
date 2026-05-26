/**
 * PseudonymizePanel.test.tsx — Phase 3 wiring assertions.
 *
 * Specifically:
 *   - "Salva mapping" button is rendered (not a disabled placeholder anymore)
 *     and stays disabled when there's no user / no master key / no entries.
 *   - The label-input prompt appears when the save button is clicked.
 *   - The active-mapping badge shows the label + close button when a mapping
 *     is open.
 *   - The primary action button is ALWAYS labeled "Pseudonimizza" — even
 *     when a mapping is active (Round 2 UX-loop Item B: removed the
 *     "Estendi mapping" jargon that surfaced the system's internal
 *     extend-vs-create distinction to the user). The Save button still
 *     renames to "Aggiorna mapping" when active (Save is secondary).
 *
 * The save POST itself is exercised manually by the founder (acceptance check)
 * and via the engine extend-mode test for the cross-document continuity
 * guarantee.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// Mock the extraction dispatcher so file-drop tests can control its return
// value without exercising pdf.js / mammoth in jsdom. SUPPORTED_EXTENSIONS is
// re-exported from the mock unchanged so the drop-zone copy still reflects
// the real format list.
vi.mock('../../extraction/extract', () => ({
  extractText: vi.fn(),
  SUPPORTED_EXTENSIONS: ['.txt', '.md', '.docx', '.pdf'],
}))

import { PseudonymizePanel } from '../PseudonymizePanel'
import { extractText } from '../../extraction/extract'
import type { ReviewEntity, SwitchableCategory } from '../types'
import { PseudonymMapper } from '../../engine/pseudonym_mapper'

const mockedExtract = vi.mocked(extractText)

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  })
  mockedExtract.mockReset()
})

const NO_OP = (): void => undefined
const NO_OP_STRING = (_: string): void => undefined
const NO_OP_CATEGORY = (_a: string, _b: SwitchableCategory): void => undefined
const NO_OP_MANUAL = (_a: number, _b: number, _c: string): void => undefined

const baseProps = {
  originalText: '',
  pseudonymizedText: '',
  entities: [] as ReviewEntity[],
  onResult: NO_OP,
  onOriginalChange: NO_OP_STRING,
  onAccept: NO_OP_STRING,
  onChangeCategory: NO_OP_CATEGORY,
  onFalsePositive: NO_OP_STRING,
  onSubstituteAnyway: NO_OP_STRING,
  onManualAnnotate: NO_OP_MANUAL,
  seedMapper: null,
  seedFalsePositives: new Set<string>(),
  canSave: false,
  loggedIn: false,
  masterKeyAvailable: false,
  saveStatus: 'idle' as const,
  saveError: null,
  labelInputOpen: false,
  labelInput: '',
  onLabelChange: NO_OP_STRING,
  onSaveClick: NO_OP,
  onSaveConfirm: NO_OP,
  onSaveCancel: NO_OP,
  activeLabel: null,
  onCloseActive: NO_OP,
}

describe('PseudonymizePanel — Save mapping button', () => {
  it('renders the Save mapping button (not a disabled placeholder)', () => {
    render(<PseudonymizePanel {...baseProps} />)
    const btn = screen.getByTestId('save-mapping-btn') as HTMLButtonElement
    expect(btn).toBeInTheDocument()
    expect(btn.textContent).toMatch(/salva mapping/i)
  })

  it('disables Save when not logged in', () => {
    render(<PseudonymizePanel {...baseProps} canSave={false} />)
    const btn = screen.getByTestId('save-mapping-btn') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('enables Save when canSave=true', () => {
    render(
      <PseudonymizePanel
        {...baseProps}
        canSave
        loggedIn
        masterKeyAvailable
        entities={[
          {
            id: 'x',
            pseudonym: 'Tizio',
            realValue: 'Mario',
            category: 'persona',
            status: 'pending',
          },
        ]}
      />,
    )
    const btn = screen.getByTestId('save-mapping-btn') as HTMLButtonElement
    expect(btn.disabled).toBe(false)
  })

  it('shows the label-input form when labelInputOpen=true', () => {
    render(<PseudonymizePanel {...baseProps} labelInputOpen />)
    expect(screen.getByTestId('save-label-form')).toBeInTheDocument()
    expect(screen.getByTestId('save-label-input')).toBeInTheDocument()
  })

  it('calls onSaveClick when the user clicks Save mapping', () => {
    const onSaveClick = vi.fn()
    render(
      <PseudonymizePanel
        {...baseProps}
        canSave
        loggedIn
        masterKeyAvailable
        entities={[
          {
            id: 'x',
            pseudonym: 'Tizio',
            realValue: 'Mario',
            category: 'persona',
            status: 'pending',
          },
        ]}
        onSaveClick={onSaveClick}
      />,
    )
    fireEvent.click(screen.getByTestId('save-mapping-btn'))
    expect(onSaveClick).toHaveBeenCalledTimes(1)
  })

  // Regression — Item 2 of brief recode_it_ux_loop_chrome_session_20260526.md
  // ("bug Save button tier-aware"). Pre-fix the tooltip claimed "Master key
  // non in memoria" even for free-tier users where masterKey is structurally
  // not required (IndexedDB plaintext storage per capabilities_index §7.1).
  it('tier=free: tooltip describes local browser save (no master-key reference)', () => {
    render(
      <PseudonymizePanel
        {...baseProps}
        canSave
        loggedIn
        masterKeyAvailable={false}
        tier="free"
        entities={[
          {
            id: 'x',
            pseudonym: 'Tizio',
            realValue: 'Mario',
            category: 'persona',
            status: 'pending',
          },
        ]}
      />,
    )
    const btn = screen.getByTestId('save-mapping-btn') as HTMLButtonElement
    expect(btn.disabled).toBe(false)
    expect(btn.title).toMatch(/browser di questo computer/i)
    expect(btn.title).not.toMatch(/master key/i)
  })

  it('tier=pro + no masterKey: tooltip surfaces the master-key gate', () => {
    render(
      <PseudonymizePanel
        {...baseProps}
        canSave={false}
        loggedIn
        masterKeyAvailable={false}
        tier="pro"
        entities={[
          {
            id: 'x',
            pseudonym: 'Tizio',
            realValue: 'Mario',
            category: 'persona',
            status: 'pending',
          },
        ]}
      />,
    )
    const btn = screen.getByTestId('save-mapping-btn') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(btn.title).toMatch(/master key non in memoria/i)
  })

  it('tier=pro + masterKey: tooltip describes encrypted server save', () => {
    render(
      <PseudonymizePanel
        {...baseProps}
        canSave
        loggedIn
        masterKeyAvailable
        tier="pro"
        entities={[
          {
            id: 'x',
            pseudonym: 'Tizio',
            realValue: 'Mario',
            category: 'persona',
            status: 'pending',
          },
        ]}
      />,
    )
    const btn = screen.getByTestId('save-mapping-btn') as HTMLButtonElement
    expect(btn.disabled).toBe(false)
    expect(btn.title).toMatch(/cifrato sul server/i)
  })
})

describe('PseudonymizePanel — Active mapping UX', () => {
  it('shows the active-badge with label + close button when activeLabel is set', () => {
    render(<PseudonymizePanel {...baseProps} activeLabel="Causa Test" />)
    const badge = screen.getByTestId('active-badge-inline')
    expect(badge).toBeInTheDocument()
    expect(badge.textContent).toMatch(/Causa Test/)
    expect(screen.getByTestId('close-active-btn')).toBeInTheDocument()
  })

  // Round 2 UX-loop — Item B regression: pre-fix, the primary button was
  // renamed to "Estendi mapping" whenever `activeLabel` was set, surfacing
  // the system's internal extend-vs-create distinction to the user (Steve
  // Krug "Don't Make Me Think" violation). Fix: the primary button label is
  // always "Pseudonimizza" — the engine still extends when a mapping is
  // active, but that's invisible to the user.
  // Brief: `MHC-Work/briefs/mhc-l/recode_it_ux_loop_action_flow_round2_20260526.md`.
  it('keeps the primary button labelled "Pseudonimizza" even with an active mapping (Item B)', () => {
    render(<PseudonymizePanel {...baseProps} activeLabel="Causa Test" />)
    const btn = screen.getByTestId('pseudonymize-btn') as HTMLButtonElement
    expect(btn.textContent).toMatch(/pseudonimizza/i)
    expect(btn.textContent).not.toMatch(/estendi/i)
  })

  it('renames the Save button to "Aggiorna mapping" when a mapping is active', () => {
    render(
      <PseudonymizePanel
        {...baseProps}
        activeLabel="Causa Test"
        canSave
        loggedIn
        masterKeyAvailable
        entities={[
          {
            id: 'x',
            pseudonym: 'Tizio',
            realValue: 'Mario',
            category: 'persona',
            status: 'pending',
          },
        ]}
      />,
    )
    const btn = screen.getByTestId('save-mapping-btn') as HTMLButtonElement
    expect(btn.textContent).toMatch(/aggiorna mapping/i)
  })

  it('accepts a seedMapper prop and threads it through to anonymize() without crashing', () => {
    // Smoke test for the extend-mode wiring at the component level — the
    // semantic guarantee is exercised in engine/__tests__/extend_mode.test.ts.
    const mapper = new PseudonymMapper()
    mapper.seedFromEntries([
      { pseudonym: 'Tizio', realValue: 'Mario Rossi', category: 'persona' },
    ])
    render(<PseudonymizePanel {...baseProps} seedMapper={mapper} activeLabel="Causa Test" />)
    expect(screen.getByTestId('active-badge-inline')).toBeInTheDocument()
  })
})

/**
 * Regression 20260518 — UI partial reset bug.
 *
 * Symptom: after `NerRunner.predict()` returned `{partial: true, ...}`, the
 * primary button stayed disabled on "Riconoscimento entità in corso…".
 * Root cause: stale-state read of `nerStatus` from the closure captured at
 * the start of `handlePseudonymize` — the guard `if (nerStatus === 'running')
 * setNerStatus('idle')` never fired because the captured value was still
 * the pre-click 'idle'/'loading' state.
 *
 * Fix: unconditional `finally`-block reset using the functional setState
 * form so the latest status drives the transition (and 'unavailable' set on
 * permanent errors is preserved).
 *
 * Test strategy: jsdom has no Worker, so the eager NerRunner init in the
 * mount useEffect short-circuits and `runnerRef.current` stays null — the
 * button never enters 'running'. To exercise the partial path we mock
 * `NerRunner` so `init()` succeeds (sets a synthetic worker) and
 * `predict()` returns `{partial: true, ...}`. The assertion then drives
 * the click and verifies (a) the button re-enables, (b) the partial
 * banner renders.
 */
describe('PseudonymizePanel — partial-NER reset (regression 20260518)', () => {
  it('re-enables the Pseudonimizza button + shows banner when predict returns partial:true', async () => {
    vi.resetModules()
    // Stub a global Worker so the panel's `typeof Worker !== 'undefined'`
    // guard passes — the actual worker isn't used; the mocked NerRunner
    // replaces all worker interaction.
    const originalWorker = (globalThis as unknown as { Worker?: unknown }).Worker
    ;(globalThis as unknown as { Worker?: unknown }).Worker = class {
      // empty stub — never instantiated because NerRunner is fully mocked.
    }

    const initMock = vi.fn().mockResolvedValue(undefined)
    const terminateMock = vi.fn()
    const predictMock = vi.fn().mockResolvedValue({
      detections: [],
      partial: true,
      failedChunkRanges: [[0, 200]] as Array<[number, number]>,
    })

    vi.doMock('../../engine/ner_runner', () => ({
      NerRunner: class {
        init = initMock
        terminate = terminateMock
        predict = predictMock
      },
    }))

    try {
      // Re-import the panel AFTER the mock is installed so it picks up the
      // mocked NerRunner constructor.
      const { PseudonymizePanel: MockedPanel } = await import(
        '../PseudonymizePanel'
      )

      const onResult = vi.fn()
      render(
        <MockedPanel
          {...baseProps}
          originalText="Mario Rossi va al Tribunale."
          onResult={onResult}
        />,
      )

      // Eager init must have been kicked off at mount.
      await waitFor(() => expect(initMock).toHaveBeenCalledTimes(1))

      // Click Pseudonimizza.
      const btn = screen.getByTestId('pseudonymize-btn') as HTMLButtonElement
      fireEvent.click(btn)

      // After predict resolves with partial:true:
      //   (a) onResult is still called — regex+NER ran on the successful
      //       part of the document;
      //   (b) the button re-enables (no longer "Riconoscimento entità in
      //       corso…");
      //   (c) the partial banner is rendered.
      await waitFor(() => expect(predictMock).toHaveBeenCalledTimes(1))
      await waitFor(() => expect(onResult).toHaveBeenCalled())
      await waitFor(() => {
        const refreshed = screen.getByTestId('pseudonymize-btn') as HTMLButtonElement
        expect(refreshed.disabled).toBe(false)
        expect(refreshed.textContent).not.toMatch(/Riconoscimento entità in corso/i)
      })
      const banner = screen.getByTestId('partial-ner-banner')
      expect(banner).toBeInTheDocument()
      expect(banner.textContent).toMatch(/incompleto/i)
    } finally {
      vi.doUnmock('../../engine/ner_runner')
      vi.resetModules()
      if (originalWorker === undefined) {
        delete (globalThis as unknown as { Worker?: unknown }).Worker
      } else {
        ;(globalThis as unknown as { Worker?: unknown }).Worker = originalWorker
      }
    }
  })
})

describe('PseudonymizePanel — File extraction (DOCX / PDF / scanned-PDF modal)', () => {
  it('advertises .docx and .pdf in the drop-zone copy and accept attribute', () => {
    render(<PseudonymizePanel {...baseProps} />)
    const input = screen.getByTestId('file-input') as HTMLInputElement
    expect(input.accept).toContain('.docx')
    expect(input.accept).toContain('.pdf')
    const dropZone = screen.getByTestId('drop-zone')
    expect(dropZone.textContent).toMatch(/\.docx/)
    expect(dropZone.textContent).toMatch(/\.pdf/)
  })

  it('routes a dropped .docx file through extractText and pushes the result into the textarea', async () => {
    mockedExtract.mockResolvedValue({ text: 'DOCX body content', scannedPdf: false })
    const onOriginalChange = vi.fn()
    render(<PseudonymizePanel {...baseProps} onOriginalChange={onOriginalChange} />)
    const file = new File(['ignored'], 'memo.docx')
    fireEvent.change(screen.getByTestId('file-input'), { target: { files: [file] } })
    await waitFor(() => expect(mockedExtract).toHaveBeenCalledTimes(1))
    expect(mockedExtract).toHaveBeenCalledWith(file)
    expect(onOriginalChange).toHaveBeenCalledWith('DOCX body content')
  })

  it('routes a text-extractable .pdf through extractText and pushes the text into the textarea', async () => {
    mockedExtract.mockResolvedValue({ text: 'PDF body', scannedPdf: false })
    const onOriginalChange = vi.fn()
    render(<PseudonymizePanel {...baseProps} onOriginalChange={onOriginalChange} />)
    const file = new File(['ignored'], 'sentenza.pdf')
    fireEvent.change(screen.getByTestId('file-input'), { target: { files: [file] } })
    await waitFor(() => expect(onOriginalChange).toHaveBeenCalledWith('PDF body'))
  })

  it('shows the scanned-PDF modal when the dispatcher reports scannedPdf=true', async () => {
    mockedExtract.mockResolvedValue({ text: '', scannedPdf: true })
    const onOriginalChange = vi.fn()
    render(<PseudonymizePanel {...baseProps} onOriginalChange={onOriginalChange} />)
    const file = new File(['ignored'], 'scan.pdf')
    fireEvent.change(screen.getByTestId('file-input'), { target: { files: [file] } })
    await waitFor(() => {
      expect(screen.getByTestId('scanned-pdf-modal')).toBeInTheDocument()
    })
    // Modal text must mention OCR + Pro plan (DESIGN §10 wording requirement).
    const modal = screen.getByTestId('scanned-pdf-modal')
    expect(modal.textContent).toMatch(/OCR/i)
    expect(modal.textContent).toMatch(/pro/i)
    // The textarea must NOT be populated with the empty extraction result.
    expect(onOriginalChange).not.toHaveBeenCalled()
  })

  it('closes the scanned-PDF modal when the user clicks Capito', async () => {
    mockedExtract.mockResolvedValue({ text: '', scannedPdf: true })
    render(<PseudonymizePanel {...baseProps} />)
    const file = new File(['ignored'], 'scan.pdf')
    fireEvent.change(screen.getByTestId('file-input'), { target: { files: [file] } })
    await waitFor(() => screen.getByTestId('scanned-pdf-modal'))
    fireEvent.click(screen.getByTestId('scanned-pdf-modal-ok'))
    await waitFor(() => {
      expect(screen.queryByTestId('scanned-pdf-modal')).not.toBeInTheDocument()
    })
  })

  it('shows an error for unsupported extensions without calling extractText', async () => {
    render(<PseudonymizePanel {...baseProps} />)
    const file = new File(['x'], 'thing.xyz')
    fireEvent.change(screen.getByTestId('file-input'), { target: { files: [file] } })
    await waitFor(() => {
      expect(screen.getByTestId('pseudo-error')).toBeInTheDocument()
    })
    expect(mockedExtract).not.toHaveBeenCalled()
  })

  it('surfaces extractor errors as a user-facing error message', async () => {
    const err = new Error('Errore nel caricamento del PDF: corrupt')
    ;(err as Error & { code?: string }).code = 'ERR_PDF_CORRUPT'
    mockedExtract.mockRejectedValue(err)
    render(<PseudonymizePanel {...baseProps} />)
    const file = new File(['x'], 'broken.pdf')
    fireEvent.change(screen.getByTestId('file-input'), { target: { files: [file] } })
    await waitFor(() => {
      expect(screen.getByTestId('pseudo-error')).toBeInTheDocument()
    })
  })
})
