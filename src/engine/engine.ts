/**
 * engine.ts — Phase 1+4 pseudonymization entrypoint.
 *
 * Phase 1 path (regex-only): runs the A-2 de-cuius pre-pass + the regex layer
 * and returns the substituted text + mapping entries.
 *
 * Phase 4 path (NER-enabled): when `options.nerDetections` is supplied, also
 * applies the GLiNER-driven entity replacement pipeline ported from
 * `MHC-L/gate-local/tools/anonymize.py::apply_gliner_with_pseudonyms`. The
 * Python order is canonical — see DESIGN.md §8.6 and IMPLEMENTATION_PLAN.md
 * §Phase 4 Task 4.
 */

import { applyRegexRules } from './regex'
import { findDeCuiusNames, isStoplist } from './stoplist'
import { PseudonymMapper } from './pseudonym_mapper'
import type {
  AnonymizeOptions,
  AnonymizeResult,
  MappingEntry,
  NerDetection,
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

// ---------------------------------------------------------------------------
// NER classification helpers — direct ports of the heuristics in anonymize.py
// (`_is_street_like`, `_is_company`, `_is_institutional_org`).
// ---------------------------------------------------------------------------

function isStreetLike(text: string): boolean {
  const t = text.trim()
  return /^(via |viale |corso |piazza |largo )/i.test(t) || /^\d{5}\s/.test(t)
}

function isCompany(text: string): boolean {
  return /(S\.r\.l\.|S\.p\.A\.|S\.n\.c\.|S\.a\.s\.)\s*$/i.test(text.trim())
}

function isInstitutionalOrg(text: string): boolean {
  return /(ordine|camera\s+di\s+commercio|organismo|agenzia|arpa|banca|sanpaolo|credito|intesa)/i.test(
    text,
  )
}

/**
 * Two-pass replacement of NER entities — see Python
 * `apply_gliner_with_pseudonyms` for the canonical order. Mutates `mapper`,
 * returns the substituted text + the list of mapping entries produced (one
 * per entity, deduped by `realValue+pseudonym`).
 */
function applyNerWithPseudonyms(
  text: string,
  ner: NerDetection[],
  mapper: PseudonymMapper,
  userFalsePositives: ReadonlySet<string>,
): { text: string; mappingEntries: MappingEntry[] } {
  // Filter stoplist + user-marked false positives early (Python parity).
  const filtered = ner.filter(
    (e) => !isStoplist(e.text) && !userFalsePositives.has(e.text),
  )

  // Two-pass: full names first to seed the surname map, then partials.
  const personFull = filtered
    .filter(
      (e) =>
        (e.label === 'persona' || e.label === 'avvocato') &&
        e.text.trim().split(/\s+/).length >= 2,
    )
    .sort((a, b) => a.start - b.start)
  const personPartial = filtered
    .filter(
      (e) =>
        (e.label === 'persona' || e.label === 'avvocato') &&
        e.text.trim().split(/\s+/).length < 2,
    )
    .sort((a, b) => a.start - b.start)
  for (const ent of personFull) mapper.getPerson(ent.text)
  for (const ent of personPartial) mapper.getPerson(ent.text)

  // Seed companies (full names before suffix-only mentions).
  const companiesFull = filtered
    .filter((e) => e.label === 'organizzazione' && isCompany(e.text))
    .sort((a, b) => a.start - b.start)
  for (const ent of companiesFull) mapper.getCompany(ent.text)

  // Replace in reverse so offsets remain valid.
  const seen = new Set<string>()
  const mappingEntries: MappingEntry[] = []
  let result = text
  const ordered = [...filtered].sort((a, b) => b.start - a.start)
  for (const ent of ordered) {
    const original = ent.text
    const label = ent.label
    let replacement: string | null = null
    let category = label

    if (label === 'avvocato' || label === 'persona') {
      replacement = mapper.getPerson(original)
      category = 'persona'
    } else if (label === 'organizzazione') {
      if (isCompany(original)) {
        replacement = mapper.getCompany(original)
        category = 'azienda'
      } else if (isInstitutionalOrg(original)) {
        replacement = mapper.getOrg(original)
        category = 'organizzazione'
      } else {
        replacement = mapper.getOrg(original)
        category = 'organizzazione'
      }
    } else if (label === 'tribunale') {
      replacement = mapper.getCourt(original)
      category = 'tribunale'
    } else if (label === 'luogo') {
      if (isStreetLike(original)) {
        replacement = mapper.getStreet(original)
        category = 'via'
      } else {
        replacement = mapper.getCity(original)
        category = 'citta'
      }
    } else if (label === 'data') {
      continue // preserved
    } else if (label === 'numero di causa') {
      replacement = 'n. XXXX/YYYY RG'
      category = 'numero di causa'
    } else if (label === 'email' || label === 'telefono' || label === 'iban') {
      if (label === 'email' && !/@/.test(original)) continue
      replacement = `<${label.toUpperCase()}>`
      category = label
    } else {
      replacement = `<${label.toUpperCase()}>`
    }

    if (replacement === null) continue
    if (replacement === original) {
      // De-cuius path (mapper.getPerson returned input verbatim) — skip the
      // substitution AND the mapping entry; the realValue survives by design.
      continue
    }

    // Defensive bounds (Python uses exact slice; we mirror.)
    result =
      result.slice(0, ent.start) + replacement + result.slice(ent.end)

    const key = `${replacement}::${original}`
    if (seen.has(key)) continue
    seen.add(key)
    mappingEntries.push({
      pseudonym: replacement,
      realValue: original,
      category,
    })
  }
  return { text: result, mappingEntries }
}

export function anonymize(
  text: string,
  options: AnonymizeOptions = {},
): AnonymizeResult {
  const mapper = new PseudonymMapper()

  // A-2 pre-pass: GDPR Recital 27 — exempt deceased persons before any NER /
  // mapper allocation. Runs in every mode (regex-only AND NER-enabled).
  for (const name of findDeCuiusNames(text)) {
    mapper.markSkip(name)
  }

  // Layer 1: regex (deterministic). Always runs.
  const { text: afterRegex, detections } = applyRegexRules(text)

  // Build per-category regex counts (kept for golden-file comparison).
  const regexSubstitutionCounts: Record<string, number> = {}
  for (const det of detections) {
    regexSubstitutionCounts[det.category] =
      (regexSubstitutionCounts[det.category] ?? 0) + 1
  }

  const seenRegex = new Set<string>()
  const mappingEntries: MappingEntry[] = []
  for (const det of detections) {
    const pseudonym = REGEX_CATEGORY_TO_MASK[det.category] ?? `<${det.category}>`
    const dedupeKey = `${pseudonym}::${det.match}`
    if (seenRegex.has(dedupeKey)) continue
    seenRegex.add(dedupeKey)
    mappingEntries.push({
      pseudonym,
      realValue: det.match,
      category: det.category,
    })
  }

  // Layer 2: NER (optional, Phase 4 path). The browser-side runner produces
  // detections over the *post-regex* text, matching the Python pipeline
  // (`apply_gliner_with_pseudonyms` is called with `text_after_regex`).
  let pseudonymizedText = afterRegex
  if (options.nerDetections && options.nerDetections.length > 0) {
    const fp = options.userFalsePositives ?? new Set<string>()
    const nerOutcome = applyNerWithPseudonyms(
      afterRegex,
      options.nerDetections,
      mapper,
      fp,
    )
    pseudonymizedText = nerOutcome.text
    mappingEntries.push(...nerOutcome.mappingEntries)
  }

  return {
    pseudonymizedText,
    mappingEntries,
    collisions: mapper.detectCollisions(),
    skipSet: new Set(mapper.getSkipSet()),
    regexSubstitutionCounts,
    personMap: new Map(mapper.getPersonMap()),
    surnameMap: new Map(mapper.getSurnameMap()),
  }
}
