/**
 * DecodificaPanel.test.ts — unit tests for the applyReverseSubstitution
 * engine function (capabilities_index §9.10).
 *
 * The replace engine is a pure function: string × MappingEntry[] → {output, count}.
 * No DOM, no React, no mocks required.
 *
 * Coverage:
 *   1. Basic substitution — single occurrence
 *   2. Multiple occurrences of the same pseudonym in one text
 *   3. Multiple distinct pseudonyms in one text
 *   4. Longest-match wins (PERSONA_10 not clobbered by PERSONA_1)
 *   5. False-positive entries are skipped
 *   6. Empty entries → count=0, output unchanged
 *   7. Text with no matching pseudonyms → count=0
 *   8. Duplicate pseudonyms (same pseudo, different realValue) → first wins
 *   9. Special regex chars in pseudonym are escaped correctly
 */

import { describe, it, expect } from 'vitest'
import { applyReverseSubstitution } from '../DecodificaPanel'
import type { MappingEntry } from '../../types/engine'

function entry(
  realValue: string,
  pseudonym: string,
  isFalsePositive = false,
): MappingEntry {
  return { realValue, pseudonym, category: 'persona', isFalsePositive }
}

describe('applyReverseSubstitution', () => {
  it('replaces a single pseudonym occurrence', () => {
    const { output, count } = applyReverseSubstitution(
      'Il signor PERSONA_01 ha firmato il contratto.',
      [entry('Mario Rossi', 'PERSONA_01')],
    )
    expect(output).toBe('Il signor Mario Rossi ha firmato il contratto.')
    expect(count).toBe(1)
  })

  it('replaces multiple occurrences of the same pseudonym', () => {
    const { output, count } = applyReverseSubstitution(
      'PERSONA_01 ha detto a PERSONA_01 di andarsene.',
      [entry('Mario Rossi', 'PERSONA_01')],
    )
    expect(output).toBe('Mario Rossi ha detto a Mario Rossi di andarsene.')
    expect(count).toBe(2)
  })

  it('replaces multiple distinct pseudonyms in one pass', () => {
    const { output, count } = applyReverseSubstitution(
      'PERSONA_01 e PERSONA_02 lavorano presso ENTE_01.',
      [
        entry('Mario Rossi', 'PERSONA_01'),
        entry('Giulia Bianchi', 'PERSONA_02'),
        entry('Studio Legale Verdi', 'ENTE_01'),
      ],
    )
    expect(output).toBe(
      'Mario Rossi e Giulia Bianchi lavorano presso Studio Legale Verdi.',
    )
    expect(count).toBe(3)
  })

  it('longest-match wins: PERSONA_10 not split into PERSONA_1 + 0', () => {
    const { output, count } = applyReverseSubstitution(
      'Firma: PERSONA_10',
      [
        entry('Mario Rossi', 'PERSONA_01'),
        entry('Giulia Bianchi', 'PERSONA_10'),
      ],
    )
    expect(output).toBe('Firma: Giulia Bianchi')
    expect(count).toBe(1)
  })

  it('false-positive entries are skipped', () => {
    const { output, count } = applyReverseSubstitution(
      'Il comune di Milano aveva già PERSONA_01.',
      [
        entry('Mario Rossi', 'PERSONA_01'),
        entry('comune di Milano', 'LUOGO_01', true), // FP — never substituted during codifica
      ],
    )
    expect(output).toBe('Il comune di Milano aveva già Mario Rossi.')
    expect(count).toBe(1)
  })

  it('returns count=0 and unchanged output when entries is empty', () => {
    const input = 'Testo senza pseudonimi.'
    const { output, count } = applyReverseSubstitution(input, [])
    expect(output).toBe(input)
    expect(count).toBe(0)
  })

  it('returns count=0 when no pseudonyms match in text', () => {
    const input = 'Testo senza pseudonimi.'
    const { output, count } = applyReverseSubstitution(input, [
      entry('Mario Rossi', 'PERSONA_01'),
    ])
    expect(output).toBe(input)
    expect(count).toBe(0)
  })

  it('duplicate pseudonym entries: first realValue wins', () => {
    const { output } = applyReverseSubstitution('Vedi PERSONA_01.', [
      entry('Mario Rossi', 'PERSONA_01'),
      entry('Giovanni Verdi', 'PERSONA_01'), // duplicate — should be ignored
    ])
    expect(output).toBe('Vedi Mario Rossi.')
  })

  it('pseudonyms with special regex characters are escaped', () => {
    // If pseudonym contains e.g. parentheses, the regex must not throw.
    const { output, count } = applyReverseSubstitution(
      'Vedi (ENTE.01) nel contratto.',
      [entry('Studio Legale Verdi', '(ENTE.01)')],
    )
    expect(output).toBe('Vedi Studio Legale Verdi nel contratto.')
    expect(count).toBe(1)
  })
})
