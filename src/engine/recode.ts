/**
 * recode.ts — reverse-substitution primitive.
 *
 * Port of `recode_text` from `MHC-L/scripts/recode_gui.py`. Given a
 * pseudonymized text and a mapping table (pseudonym → original), restore the
 * originals.
 *
 * Algorithm:
 *   1. Sort entries by `pseudonym.length` descending — prevents short
 *      pseudonyms like "Alfa" matching inside "Alfa S.r.l." before the longer
 *      one would have matched its full form.
 *   2. For each entry: replace every word-bounded occurrence of `pseudonym`
 *      with `realValue`. We use a regex with `(?<!\w)` / `(?!\w)` look-arounds
 *      to mirror the Python `(?<!\w)…(?!\w)` boundaries.
 *
 * Regex tags (`<DS>`, `<IBAN>`, `<EMAIL>`) need slightly different boundary
 * handling because `<` / `>` are not word characters. For these we fall back
 * to a literal global replace.
 */

import type { MappingEntry } from '../types/engine'

const TAG_RE = /^<[A-Z._]+>$/

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function recodeText(text: string, mapping: MappingEntry[]): string {
  if (!mapping.length) return text

  const sorted = [...mapping].sort(
    (a, b) => b.pseudonym.length - a.pseudonym.length,
  )

  let result = text
  for (const entry of sorted) {
    if (!entry.pseudonym) continue
    if (TAG_RE.test(entry.pseudonym)) {
      // Tags: literal global replacement (boundaries don't apply to `<…>`).
      const literalRe = new RegExp(escapeRegex(entry.pseudonym), 'g')
      result = result.replace(literalRe, entry.realValue)
    } else {
      const boundedRe = new RegExp(
        `(?<!\\w)${escapeRegex(entry.pseudonym)}(?!\\w)`,
        'g',
      )
      result = result.replace(boundedRe, entry.realValue)
    }
  }
  return result
}
