/**
 * PseudonymizePanel.test.tsx — Phase 3 wiring assertions.
 *
 * Specifically:
 *   - "Salva mapping" button is rendered (not a disabled placeholder anymore)
 *     and stays disabled when there's no user / no master key / no entries.
 *   - The label-input prompt appears when the save button is clicked.
 *   - The active-mapping badge shows the label + close button when a mapping
 *     is open.
 *   - The button label switches to "Estendi mapping" / "Aggiorna mapping"
 *     when a mapping is active.
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

const baseProps = {
  originalText: '',
  pseudonymizedText: '',
  entities: [] as ReviewEntity[],
  onResult: NO_OP,
  onOriginalChange: NO_OP_STRING,
  onAccept: NO_OP_STRING,
  onChangeCategory: NO_OP_CATEGORY,
  onFalsePositive: NO_OP_STRING,
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
})

describe('PseudonymizePanel — Active mapping UX', () => {
  it('shows the active-badge with label + close button when activeLabel is set', () => {
    render(<PseudonymizePanel {...baseProps} activeLabel="Causa Test" />)
    const badge = screen.getByTestId('active-badge-inline')
    expect(badge).toBeInTheDocument()
    expect(badge.textContent).toMatch(/Causa Test/)
    expect(screen.getByTestId('close-active-btn')).toBeInTheDocument()
  })

  it('renames the primary button to "Estendi mapping" when a mapping is active', () => {
    render(<PseudonymizePanel {...baseProps} activeLabel="Causa Test" />)
    const btn = screen.getByTestId('pseudonymize-btn') as HTMLButtonElement
    expect(btn.textContent).toMatch(/estendi mapping/i)
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
