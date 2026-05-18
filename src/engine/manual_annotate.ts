/**
 * manual_annotate.ts — user-driven entity tagging (Priority C, parity with
 * MHC-L `pseudonymize_gui_local.py::_pseudonymize_selection`).
 *
 * The NER model has a real-world recall in the ~70-80% range on the founder's
 * acceptance fixtures (Priority D, OPEN_RISKS R-13 territory). The avvocato's
 * safety net is the "Anonimizza la selezione" gesture in the UI: select a span
 * in the original text, pick a category, click — a `MappingEntry` is appended
 * with `source: 'manual'` and the pseudonymized text is rewritten accordingly.
 *
 * Allocation strategy mirrors `applyNerWithPseudonyms` in engine.ts:
 *   - `persona` → `mapper.getPerson()`
 *   - `luogo` → `getStreet` if street-like else `getCity`
 *   - `organizzazione` → `getCompany` if company-like else `getOrg`
 *   - `tribunale` → `getCourt`
 *   - `altro` → literal `<MANUALE>` mask (no pool — mirrors the regex layer's
 *     `<DS>` / `<IBAN>` literal-mask pattern; the MHC-L Python uses
 *     LITERAL_MASKS the same way)
 *
 * The text rewrite uses `split/join` (all occurrences) — identical to the
 * `handleSubstituteAnyway` / `handleFalsePositive` strategy in
 * ClipboardWidget.tsx. Reason: when the avvocato manually marks "Mario Rossi",
 * they likely want every mention of Mario Rossi pseudonymized, not just the
 * one they happened to select. This is the founder-confirmed UX from MHC-L.
 */

import type { PseudonymMapper } from './pseudonym_mapper'
import type { MappingEntry } from '../types/engine'

export type ManualCategory =
  | 'persona'
  | 'luogo'
  | 'organizzazione'
  | 'tribunale'
  | 'altro'

/** Literal mask used when the user picks `altro` — no pool allocation. */
export const MANUAL_OTHER_MASK = '<MANUALE>'

export type ManualAnnotateResult = {
  entries: MappingEntry[]
  pseudonymizedText: string
}

/**
 * Apply a user-supplied annotation: extract `text[start..end]`, allocate a
 * pseudonym from `existingMapper` according to `category`, append a new
 * `MappingEntry` (with `source: 'manual'`) to `existingEntries`, and return
 * the rewritten pseudonymized text.
 *
 * Pre-conditions:
 *   - `selectionStart < selectionEnd` and both within `text.length`.
 *   - `text` is the ORIGINAL document text (pre-pseudonymization); we slice
 *     `realValue` from it. The pseudonymized text rewrite below uses split/join
 *     so it tolerates the case where the original substring appears at
 *     multiple locations.
 *
 * Mutates `existingMapper` (allocates a new pseudonym). Pure with respect to
 * `existingEntries` — returns a new array.
 */
export function manualAnnotate(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  category: ManualCategory,
  existingMapper: PseudonymMapper,
  existingEntries: ReadonlyArray<MappingEntry>,
): ManualAnnotateResult {
  if (
    selectionStart < 0 ||
    selectionEnd > text.length ||
    selectionEnd <= selectionStart
  ) {
    throw new Error(
      `manualAnnotate: invalid selection [${selectionStart}, ${selectionEnd}) for text of length ${text.length}`,
    )
  }

  const realValue = text.slice(selectionStart, selectionEnd).trim()
  if (realValue.length === 0) {
    throw new Error('manualAnnotate: selection is empty after trim')
  }

  // Allocate pseudonym. Reuses helper methods of PseudonymMapper so manual
  // annotations share the pool with NER-allocated pseudonyms — Mario Rossi
  // manually annotated in Doc1 and later mentioned in Doc2's NER run will
  // resolve to the same pseudonym (Tier 1 exact-match cache).
  let pseudonym: string
  let normalizedCategory: string

  switch (category) {
    case 'persona':
      pseudonym = existingMapper.getPerson(realValue)
      normalizedCategory = 'persona'
      break
    case 'luogo':
      if (isStreetLike(realValue)) {
        pseudonym = existingMapper.getStreet(realValue)
        normalizedCategory = 'via'
      } else {
        pseudonym = existingMapper.getCity(realValue)
        normalizedCategory = 'citta'
      }
      break
    case 'organizzazione':
      if (isCompany(realValue)) {
        pseudonym = existingMapper.getCompany(realValue)
        normalizedCategory = 'azienda'
      } else {
        pseudonym = existingMapper.getOrg(realValue)
        normalizedCategory = 'organizzazione'
      }
      break
    case 'tribunale':
      pseudonym = existingMapper.getCourt(realValue)
      normalizedCategory = 'tribunale'
      break
    case 'altro':
      pseudonym = MANUAL_OTHER_MASK
      normalizedCategory = 'altro'
      break
    default: {
      // Exhaustiveness check — TS will catch this at compile time, but we
      // belt-and-suspenders for the runtime.
      const exhaustive: never = category
      throw new Error(`manualAnnotate: unknown category ${exhaustive}`)
    }
  }

  // De-cuius / exact-match: getPerson returns the input verbatim when the
  // name is in the skip set. Surface this as a no-op for the caller (no
  // pseudonym → no rewrite, no entry).
  if (pseudonym === realValue) {
    return {
      entries: [...existingEntries],
      pseudonymizedText: '',
    }
  }

  const newEntry: MappingEntry = {
    pseudonym,
    realValue,
    category: normalizedCategory,
    isPreserved: false,
    source: 'manual',
  }

  // Append (caller decides whether to merge / dedupe further upstream — this
  // function is single-responsibility and pure-ish).
  const entries = [...existingEntries, newEntry]

  // Rebuild the pseudonymized text by applying ALL substitutions in the
  // updated entry list. We use split/join (all-occurrences) to mirror the
  // existing `handleSubstituteAnyway` / `handleFalsePositive` strategy in
  // ClipboardWidget.tsx and avoid the offset-drift class of bugs that
  // afflicted the Priority A regression (substituting by [start, end) on a
  // text that has already been pseudonymized would write at wrong columns).
  //
  // Substitution order: by descending realValue length so longer phrases
  // are replaced before any of their substrings (e.g. "Mario Rossi" before
  // "Mario"), and isPreserved/isFalsePositive entries are skipped (their
  // realValue must survive verbatim in the output).
  let pseudonymizedText = text
  const orderedEntries = [...entries]
    .filter(
      (e) =>
        e.isPreserved !== true &&
        e.isFalsePositive !== true &&
        e.pseudonym !== e.realValue,
    )
    .sort((a, b) => b.realValue.length - a.realValue.length)

  for (const e of orderedEntries) {
    pseudonymizedText = pseudonymizedText.split(e.realValue).join(e.pseudonym)
  }

  return { entries, pseudonymizedText }
}

// ---------------------------------------------------------------------------
// Heuristics — direct copies of the helpers in engine.ts (kept local rather
// than imported to avoid a circular-dependency tightening between
// engine.ts and manual_annotate.ts).
// ---------------------------------------------------------------------------

function isStreetLike(text: string): boolean {
  const t = text.trim()
  return /^(via |viale |corso |piazza |largo )/i.test(t) || /^\d{5}\s/.test(t)
}

function isCompany(text: string): boolean {
  return /(S\.r\.l\.|S\.p\.A\.|S\.n\.c\.|S\.a\.s\.)\s*$/i.test(text.trim())
}
