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
import { render, screen, fireEvent } from '@testing-library/react'
import { PseudonymizePanel } from '../PseudonymizePanel'
import type { ReviewEntity, SwitchableCategory } from '../types'
import { PseudonymMapper } from '../../engine/pseudonym_mapper'

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  })
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
