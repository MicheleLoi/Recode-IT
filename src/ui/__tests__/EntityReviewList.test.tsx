/**
 * EntityReviewList — verifies the three per-entity actions: Accetta, Cambia
 * categoria, Falso positivo, and the empty-state placeholder.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EntityReviewList } from '../EntityReviewList'
import type { ReviewEntity } from '../types'

function makeEntity(overrides: Partial<ReviewEntity> = {}): ReviewEntity {
  return {
    id: 'e1',
    pseudonym: '<EMAIL>',
    realValue: 'mario.rossi@example.com',
    category: 'EMAIL',
    status: 'pending',
    ...overrides,
  }
}

describe('EntityReviewList', () => {
  it('renders the empty-state hint when there are no entities', () => {
    render(
      <EntityReviewList
        entities={[]}
        onAccept={vi.fn()}
        onChangeCategory={vi.fn()}
        onFalsePositive={vi.fn()}
      />,
    )
    expect(screen.getByTestId('review-empty')).toBeInTheDocument()
  })

  it('renders a row per entity with category, original, pseudonym', () => {
    const entities = [
      makeEntity({ id: 'a', realValue: 'Mario Rossi', pseudonym: 'Caio', category: 'PERSONA' }),
      makeEntity({ id: 'b', realValue: 'Roma', pseudonym: 'Verona', category: 'LUOGO' }),
    ]
    render(
      <EntityReviewList
        entities={entities}
        onAccept={vi.fn()}
        onChangeCategory={vi.fn()}
        onFalsePositive={vi.fn()}
      />,
    )
    expect(screen.getByTestId('review-row-a')).toBeInTheDocument()
    expect(screen.getByTestId('review-row-b')).toBeInTheDocument()
    expect(screen.getByText('Mario Rossi')).toBeInTheDocument()
    expect(screen.getByText('Caio')).toBeInTheDocument()
    expect(screen.getByText('Roma')).toBeInTheDocument()
  })

  it('calls onAccept and marks the row accepted', () => {
    const onAccept = vi.fn()
    render(
      <EntityReviewList
        entities={[makeEntity()]}
        onAccept={onAccept}
        onChangeCategory={vi.fn()}
        onFalsePositive={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /accetta/i }))
    expect(onAccept).toHaveBeenCalledWith('e1')
  })

  it('opens the category dropdown and reports a category change', () => {
    const onChangeCategory = vi.fn()
    render(
      <EntityReviewList
        entities={[makeEntity()]}
        onAccept={vi.fn()}
        onChangeCategory={onChangeCategory}
        onFalsePositive={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /cambia categoria/i }))
    const select = screen.getByTestId('category-select-e1') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'LUOGO' } })
    expect(onChangeCategory).toHaveBeenCalledWith('e1', 'LUOGO')
  })

  it('calls onFalsePositive and disables the action once marked', () => {
    const onFalsePositive = vi.fn()
    const { rerender } = render(
      <EntityReviewList
        entities={[makeEntity()]}
        onAccept={vi.fn()}
        onChangeCategory={vi.fn()}
        onFalsePositive={onFalsePositive}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /falso positivo/i }))
    expect(onFalsePositive).toHaveBeenCalledWith('e1')

    rerender(
      <EntityReviewList
        entities={[makeEntity({ status: 'falsePositive' })]}
        onAccept={vi.fn()}
        onChangeCategory={vi.fn()}
        onFalsePositive={onFalsePositive}
      />,
    )
    const row = screen.getByTestId('review-row-e1')
    expect(row.dataset.status).toBe('falsePositive')
    expect(screen.getByRole('button', { name: /falso positivo/i })).toBeDisabled()
  })
})
