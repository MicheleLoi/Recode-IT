/**
 * compare_view.test.tsx — Design C v3 split-pane Confronta originale.
 *
 * UI-level guarantees:
 *   1. Bottone "⇆ Confronta originale" appare in toolbar solo quando esiste
 *      del pseudonymizedText (cioè dopo Pseudonimizza).
 *   2. Click sul bottone apre il split-pane (compare-view), entrambi i pannelli
 *      renderano testo (originale a sinistra, pseudonimizzato a destra).
 *   3. Click "× Chiudi confronto" torna alla vista singola (DocumentView).
 *   4. Prima entrata in confronto mostra il micro-toast; localStorage flag
 *      `recode_compare_seen` viene impostato e seconda entrata NON mostra
 *      il toast.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
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

function makeProps(
  overrides: Partial<React.ComponentProps<typeof PseudonymizePanel>> = {},
) {
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

const SAMPLE_ENTITIES: ReviewEntity[] = [
  {
    id: 'e1',
    realValue: 'Mario Rossi',
    pseudonym: 'PERSONA_1',
    category: 'PERSONA',
    status: 'pending',
  },
]

describe('Design C v3 — Compare view (Confronta originale)', () => {
  beforeEach(() => {
    try {
      localStorage.removeItem('recode_compare_seen')
    } catch {
      /* ignore */
    }
  })

  it('does not render the compare toggle when there is no result yet', () => {
    render(
      <PseudonymizePanel
        {...makeProps({
          originalText: 'Caso di Mario Rossi.',
          pseudonymizedText: '',
          entities: [],
        })}
      />,
    )
    expect(screen.queryByTestId('toggle-compare-btn')).toBeNull()
  })

  it('renders the compare toggle once pseudonymized text exists', () => {
    render(
      <PseudonymizePanel
        {...makeProps({
          originalText: 'Caso di Mario Rossi.',
          pseudonymizedText: 'Caso di PERSONA_1.',
          entities: SAMPLE_ENTITIES,
        })}
      />,
    )
    const btn = screen.getByTestId('toggle-compare-btn')
    expect(btn.textContent).toMatch(/Confronta originale/)
  })

  it('opens split-pane with both panels and a toast on first activation', () => {
    render(
      <PseudonymizePanel
        {...makeProps({
          originalText: 'Caso di Mario Rossi.',
          pseudonymizedText: 'Caso di PERSONA_1.',
          entities: SAMPLE_ENTITIES,
        })}
      />,
    )
    fireEvent.click(screen.getByTestId('toggle-compare-btn'))

    // Split-pane rendered.
    expect(screen.getByTestId('compare-view')).toBeTruthy()
    expect(screen.getByTestId('compare-left')).toBeTruthy()
    expect(screen.getByTestId('compare-right')).toBeTruthy()

    // Left renders original, right renders pseudonym (entity sostituita).
    expect(screen.getByTestId('compare-left').textContent).toContain(
      'Mario Rossi',
    )
    expect(screen.getByTestId('compare-right').textContent).toContain(
      'PERSONA_1',
    )

    // Toast onboarding visibile la prima volta.
    expect(screen.getByTestId('compare-toast')).toBeTruthy()
    expect(localStorage.getItem('recode_compare_seen')).toBe('true')

    // Toggle button cambia label.
    expect(screen.getByTestId('toggle-compare-btn').textContent).toMatch(
      /Chiudi confronto/,
    )
  })

  it('closing compare returns to single-document view', () => {
    render(
      <PseudonymizePanel
        {...makeProps({
          originalText: 'Caso di Mario Rossi.',
          pseudonymizedText: 'Caso di PERSONA_1.',
          entities: SAMPLE_ENTITIES,
        })}
      />,
    )
    const btn = screen.getByTestId('toggle-compare-btn')
    fireEvent.click(btn) // apre
    expect(screen.getByTestId('compare-view')).toBeTruthy()
    fireEvent.click(screen.getByTestId('toggle-compare-btn')) // chiude
    expect(screen.queryByTestId('compare-view')).toBeNull()
    expect(screen.getByTestId('document-view')).toBeTruthy()
  })

  it('does NOT show the toast on second activation (localStorage flag honored)', () => {
    // Marca la prima entrata come già vista.
    localStorage.setItem('recode_compare_seen', 'true')
    render(
      <PseudonymizePanel
        {...makeProps({
          originalText: 'Caso di Mario Rossi.',
          pseudonymizedText: 'Caso di PERSONA_1.',
          entities: SAMPLE_ENTITIES,
        })}
      />,
    )
    fireEvent.click(screen.getByTestId('toggle-compare-btn'))
    expect(screen.queryByTestId('compare-toast')).toBeNull()
  })
})
