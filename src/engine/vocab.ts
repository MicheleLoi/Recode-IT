/**
 * vocab.ts — port of `MHC-L/scripts/_vocab.py::VocabAllocator`.
 *
 * Deterministic allocation: scans `text` for vocabulary tokens already in use
 * and returns the first pool entry not present. On pool exhaustion, generates
 * a suffixed fallback (`Tizio_1`, `Tizio_2`, ...) — the same overflow pattern
 * `PseudonymMapper._next_person` uses in the reference.
 */

import { VOCAB_RAW } from './pools'

export const VOCAB_CATEGORIES = ['persona', 'luogo', 'organizzazione'] as const
export type VocabCategory = (typeof VOCAB_CATEGORIES)[number]

export class VocabAllocator {
  private readonly pools: Record<VocabCategory, string[]>

  constructor(vocab?: Partial<Record<VocabCategory, string[]>>) {
    const source = vocab ?? VOCAB_RAW
    this.pools = {
      persona: [...(source.persona ?? [])],
      luogo: [...(source.luogo ?? [])],
      organizzazione: [...(source.organizzazione ?? [])],
    }
  }

  /**
   * Return an unused pseudonym from `category`, or `null` if the category is
   * unknown / empty (matches Python's `None`).
   */
  nextFor(category: string, text: string): string | null {
    if (!isVocabCategory(category)) return null
    const pool = this.pools[category]
    if (pool.length === 0) return null

    const lowered = text.toLowerCase()
    for (const tok of pool) {
      if (!lowered.includes(tok.toLowerCase())) {
        return tok
      }
    }

    // Pool exhausted — generate a suffixed fallback.
    const base = pool[0] as string
    let idx = 1
    // Bounded loop: even at idx > text.length we'd have produced a unique
    // string. Pin a hard ceiling as a safety net.
    while (idx < 10_000) {
      const candidate = `${base}_${idx}`
      if (!lowered.includes(candidate.toLowerCase())) return candidate
      idx += 1
    }
    return `${base}_${idx}`
  }

  categories(): readonly VocabCategory[] {
    return VOCAB_CATEGORIES
  }
}

function isVocabCategory(c: string): c is VocabCategory {
  return (VOCAB_CATEGORIES as readonly string[]).includes(c)
}
