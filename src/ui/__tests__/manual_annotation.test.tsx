/**
 * manual_annotation.test.tsx — Priority C, Step 3.
 *
 * UI-level guarantees for the "Anonimizza la selezione" gesture. We assert:
 *   1. The button is rendered, the category dropdown is rendered, both
 *      data-testid attributes are stable.
 *   2. The button is disabled when no selection is active.
 *   3. After selecting a span in the original textarea and choosing a
 *      category, clicking the button fires `onManualAnnotate(start, end,
 *      category)`.
 *
 * The full engine-level semantics (entry shape, pseudonymized-text rewrite)
 * are covered in `src/engine/__tests__/manual_annotation_engine.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('../../extraction/extract', () => ({
  extractText: vi.fn(),
  SUPPORTED_EXTENSIONS: ['.txt', '.md', '.docx', '.pdf'],
}))

import { PseudonymizePanel } from '../PseudonymizePanel'
import type { ReviewEntity, SwitchableCategory } from '../types'

const NO_OP = (): void => undefined
const NO_OP_STRING = (_: string): void => undefined
const NO_OP_CATEGORY = (_a: string, _b: SwitchableCategory): void => undefined
const NO_OP_MANUAL = (_a: number, _b: number, _c: string): void => undefined

function makeProps(overrides: Partial<React.ComponentProps<typeof PseudonymizePanel>> = {}) {
  return {
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
    ...overrides,
  }
}

describe('PseudonymizePanel — manual annotation gesture', () => {
  it('renders the category dropdown + "Anonimizza la selezione" button', () => {
    render(<PseudonymizePanel {...makeProps()} />)
    expect(screen.getByTestId('manual-annotate-category')).toBeInTheDocument()
    expect(screen.getByTestId('manual-annotate-btn')).toBeInTheDocument()
  })

  it('disables the button when no selection is active', () => {
    render(
      <PseudonymizePanel
        {...makeProps({ originalText: 'Mario Rossi va al Tribunale.' })}
      />,
    )
    const btn = screen.getByTestId('manual-annotate-btn') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('disables the button when the textarea is empty (no text to annotate)', () => {
    render(<PseudonymizePanel {...makeProps()} />)
    const btn = screen.getByTestId('manual-annotate-btn') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('exposes the persona / luogo / organizzazione / tribunale / altro categories', () => {
    render(<PseudonymizePanel {...makeProps()} />)
    const select = screen.getByTestId('manual-annotate-category') as HTMLSelectElement
    const values = Array.from(select.options).map((o) => o.value)
    expect(values).toEqual([
      'persona',
      'luogo',
      'organizzazione',
      'tribunale',
      'altro',
    ])
  })

  it('fires onManualAnnotate(start, end, category) when the user selects text and clicks', () => {
    const onManualAnnotate = vi.fn()
    const text = 'Mario Rossi va al Tribunale di Torino.'
    render(
      <PseudonymizePanel
        {...makeProps({ originalText: text, onManualAnnotate })}
      />,
    )

    const ta = screen.getByTestId('original-textarea') as HTMLTextAreaElement
    // Simulate the user selecting "Mario Rossi" — set the range on the
    // textarea ref. Then dispatch a `select` event so the panel's effect
    // observes the new selection range and enables the button.
    const start = text.indexOf('Mario Rossi')
    const end = start + 'Mario Rossi'.length
    ta.setSelectionRange(start, end)
    fireEvent.select(ta)

    // Category defaults to "persona" — no need to change it for this assertion.
    const btn = screen.getByTestId('manual-annotate-btn') as HTMLButtonElement
    expect(btn.disabled).toBe(false)

    fireEvent.click(btn)

    expect(onManualAnnotate).toHaveBeenCalledTimes(1)
    expect(onManualAnnotate).toHaveBeenCalledWith(start, end, 'persona')
  })

  it('respects a different category chosen from the dropdown', () => {
    const onManualAnnotate = vi.fn()
    const text = 'Vive a Bologna da anni.'
    render(
      <PseudonymizePanel
        {...makeProps({ originalText: text, onManualAnnotate })}
      />,
    )
    const ta = screen.getByTestId('original-textarea') as HTMLTextAreaElement
    const start = text.indexOf('Bologna')
    const end = start + 'Bologna'.length
    ta.setSelectionRange(start, end)
    fireEvent.select(ta)

    const select = screen.getByTestId('manual-annotate-category') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'luogo' } })

    fireEvent.click(screen.getByTestId('manual-annotate-btn'))

    expect(onManualAnnotate).toHaveBeenCalledWith(start, end, 'luogo')
  })
})
