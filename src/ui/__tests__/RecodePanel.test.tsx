/**
 * RecodePanel — verifies the debounced auto-recode and the copy-to-clipboard
 * button. Uses fake timers to advance past the 500ms debounce without waiting.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { RecodePanel } from '../RecodePanel'
import type { MappingEntry } from '../../types/engine'

const MAPPING: MappingEntry[] = [
  { pseudonym: 'Caio', realValue: 'Mario Rossi', category: 'PERSONA' },
  { pseudonym: '<EMAIL>', realValue: 'mario.rossi@example.com', category: 'EMAIL' },
]

beforeEach(() => {
  vi.useFakeTimers()
  Object.assign(navigator, {
    clipboard: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('RecodePanel', () => {
  it('shows a hint when there is no mapping yet', () => {
    render(<RecodePanel mapping={[]} />)
    expect(screen.getByTestId('recode-no-mapping-hint')).toBeInTheDocument()
  })

  it('auto-recodes the pasted Claude response after the debounce window', () => {
    render(<RecodePanel mapping={MAPPING} />)
    const input = screen.getByTestId('claude-response-textarea') as HTMLTextAreaElement
    fireEvent.change(input, {
      target: {
        value: 'Caio ha scritto a <EMAIL> per il caso in corso.',
      },
    })
    // Before the debounce fires, the recoded textarea is still empty.
    expect((screen.getByTestId('recoded-textarea') as HTMLTextAreaElement).value).toBe('')

    act(() => {
      vi.advanceTimersByTime(600)
    })

    const recoded = (screen.getByTestId('recoded-textarea') as HTMLTextAreaElement).value
    expect(recoded).toContain('Mario Rossi')
    expect(recoded).toContain('mario.rossi@example.com')
    expect(recoded).not.toContain('Caio')
    expect(recoded).not.toContain('<EMAIL>')
  })

  it('debounces — only the final value is recoded after rapid changes', () => {
    render(<RecodePanel mapping={MAPPING} />)
    const input = screen.getByTestId('claude-response-textarea') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'Caio' } })
    act(() => {
      vi.advanceTimersByTime(100)
    })
    fireEvent.change(input, { target: { value: '<EMAIL>' } })
    act(() => {
      vi.advanceTimersByTime(100)
    })
    fireEvent.change(input, { target: { value: 'Caio risponde a <EMAIL>' } })
    act(() => {
      vi.advanceTimersByTime(600)
    })
    const recoded = (screen.getByTestId('recoded-textarea') as HTMLTextAreaElement).value
    expect(recoded).toBe('Mario Rossi risponde a mario.rossi@example.com')
  })

  it('copies the recoded text to the clipboard', async () => {
    render(<RecodePanel mapping={MAPPING} />)
    fireEvent.change(screen.getByTestId('claude-response-textarea'), {
      target: { value: 'Caio è il cliente.' },
    })
    act(() => {
      vi.advanceTimersByTime(600)
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId('copy-recoded-btn'))
    })
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'Mario Rossi è il cliente.',
    )
  })
})
