/**
 * engine.ts — Phase 1 pseudonymization entrypoint (regex-only).
 *
 * The signature accepts an optional `nerDetections` field so the Phase 4 NER
 * integration is a drop-in extension. In Phase 1 we ignore that field (the
 * NER layer doesn't exist yet) but still run the A-2 de cuius pre-pass on the
 * raw text and seed the `PseudonymMapper.skipSet` so the contract is faithful.
 */

import { applyRegexRules } from './regex'
import { findDeCuiusNames } from './stoplist'
import { PseudonymMapper } from './pseudonym_mapper'
import type {
  AnonymizeOptions,
  AnonymizeResult,
  MappingEntry,
} from '../types/engine'

const REGEX_CATEGORY_TO_MASK: Record<string, string> = {
  CF: '<DS>',
  CF_NUM: '<DS>',
  'P.IVA': '<P.IVA>',
  IBAN: '<IBAN>',
  CRO: '<CRO>',
  PROT: '<PROT>',
  EMAIL: '<EMAIL>',
}

export function anonymize(
  text: string,
  options: AnonymizeOptions = {},
): AnonymizeResult {
  const mapper = new PseudonymMapper()

  // A-2 pre-pass: GDPR Recital 27 — exempt deceased persons before any NER /
  // mapper allocation. Runs even in regex-only mode so the contract is honored.
  for (const name of findDeCuiusNames(text)) {
    mapper.markSkip(name)
  }

  const { text: substituted, detections } = applyRegexRules(text)

  // Build per-category counts.
  const regexSubstitutionCounts: Record<string, number> = {}
  for (const det of detections) {
    regexSubstitutionCounts[det.category] =
      (regexSubstitutionCounts[det.category] ?? 0) + 1
  }

  // Mapping entries for the regex layer. Each detection becomes one entry
  // where pseudonym is the mask (e.g. `<DS>`) and realValue is the original
  // matched substring. We dedupe by `realValue+pseudonym` so repeated matches
  // of the same CF don't produce duplicate entries.
  const seen = new Set<string>()
  const mappingEntries: MappingEntry[] = []
  for (const det of detections) {
    const pseudonym = REGEX_CATEGORY_TO_MASK[det.category] ?? `<${det.category}>`
    const dedupeKey = `${pseudonym}::${det.match}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    mappingEntries.push({
      pseudonym,
      realValue: det.match,
      category: det.category,
    })
  }

  // Phase 4 hook — currently ignored. Surface in the return value so callers
  // can audit that they're seeing the regex-only path.
  // (No-op for `options.nerDetections` and `options.userFalsePositives` until
  // the NER + false-positive UX phases.)
  void options

  return {
    pseudonymizedText: substituted,
    mappingEntries,
    collisions: mapper.detectCollisions(),
    skipSet: new Set(mapper.getSkipSet()),
    regexSubstitutionCounts,
  }
}
