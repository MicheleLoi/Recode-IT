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
import { applyGatedSpans, detectGated } from './gated_detectors'
import { detectItalianCities, mergeWhitelistWithNer } from './city_whitelist'
import { findDeCuiusNames, isStoplist } from './stoplist'
import { PseudonymMapper } from './pseudonym_mapper'
import type {
  AnonymizeOptions,
  AnonymizeResult,
  MappingEntry,
  NerDetection,
  RegexDetection,
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
 * NER labels that belong to the MHC-L "Pass 2" opt-in workflow
 * (`pseudonymize_gui_local.py:109-134`). When `includeCategoriesPass2` is
 * false (default), detections with these labels are emitted as preserved
 * mapping entries instead of being substituted in the output text — the user
 * can then flip individual entities to substituted via the review panel.
 */
const PASS_2_LABELS = new Set<string>([
  'luogo',
  'organizzazione',
  'tribunale',
])

// ---------------------------------------------------------------------------
// Substitution-offset bug fix (regression test 20260518): NER detections
// arrive with offsets into the ORIGINAL text (that's what the worker sees on
// the way in). The engine, however, substitutes against the POST-REGEX text
// — after CFs (16 chars) became "<DS>" (4 chars), emails became "<EMAIL>"
// (7 chars), etc. Applying a raw NER offset to the shifted text writes the
// pseudonym at the wrong column — almost always wedged inside an adjacent
// token (founder bug report: `BLL MRC 7TizioEMAIL>+39 347 551 2093`).
//
// We rebuild a coordinate map (originalPos → postRegexPos) from the regex
// detections, then re-anchor each NER detection. Detections whose original
// range overlaps a regex range are dropped (the regex already replaced that
// span with a deterministic mask; reapplying a pseudonym there would corrupt
// the mask). Detections whose mapped span no longer points at the expected
// `det.text` in the post-regex text are dropped too (defensive: a regex
// substitution swallowed the entity surface).
// ---------------------------------------------------------------------------

function reanchorNerDetections(
  detections: ReadonlyArray<NerDetection>,
  regexDetections: ReadonlyArray<RegexDetection>,
  originalText: string,
  postRegexText: string,
): NerDetection[] {
  // Fast path: no regex substitutions → offsets unchanged. We still verify
  // each slice (defensive — protects against unforeseen drift).
  if (regexDetections.length === 0) {
    const passthrough: NerDetection[] = []
    for (const det of detections) {
      if (postRegexText.slice(det.start, det.end) === det.text) {
        passthrough.push(det)
      } else {
        const idx = postRegexText.indexOf(det.text)
        if (idx >= 0) {
          passthrough.push({ ...det, start: idx, end: idx + det.text.length })
        }
      }
    }
    return passthrough
  }

  // Build a coordinate map (originalPos ↔ postRegexPos) by walking both
  // texts in lockstep. For each regex detection, the unchanged prefix
  // before it MUST match in both texts; the regex's replacement length is
  // then discovered by reading whatever sits between postCursor and the
  // start of the next unchanged segment.
  const sortedRegex = [...regexDetections].sort((a, b) => a.start - b.start)
  type RegexRun = {
    origStart: number
    origEnd: number
    postStart: number
    postEnd: number
  }
  const builtRuns: RegexRun[] = []
  let origCursor = 0
  let postCursor = 0
  for (let i = 0; i < sortedRegex.length; i++) {
    const r = sortedRegex[i]!
    // Unchanged prefix between the previous run and this one.
    const prefix = originalText.slice(origCursor, r.start)
    if (postRegexText.slice(postCursor, postCursor + prefix.length) !== prefix) {
      // Drift — bail out by returning the unmapped detections; the caller's
      // defensive verification will still drop the bad ones.
      break
    }
    origCursor = r.start
    postCursor += prefix.length

    // Discover the post run length by finding where the next unchanged
    // segment begins in postRegexText (the next char after the mask is the
    // char at originalText[r.end]).
    // Easiest: derive from the next regex run's postStart, or from the
    // remaining tail of the post-regex text if this is the last run.
    let postRunLen: number
    if (i + 1 < sortedRegex.length) {
      const next = sortedRegex[i + 1]!
      const between = originalText.slice(r.end, next.start)
      // Search for `between` starting from postCursor in postRegexText.
      const found = postRegexText.indexOf(between, postCursor)
      if (found < 0) {
        // Drift — bail.
        break
      }
      postRunLen = found - postCursor
    } else {
      // Last run — the tail of postRegexText after the mask must equal the
      // tail of originalText after r.end.
      const tail = originalText.slice(r.end)
      const tailStart = postRegexText.length - tail.length
      if (tailStart < postCursor) {
        // Drift — replacement was longer than original (uncommon but
        // possible). Fall back to indexOf from postCursor.
        const idx = postRegexText.indexOf(tail, postCursor)
        if (idx < 0) break
        postRunLen = idx - postCursor
      } else if (postRegexText.slice(tailStart) !== tail) {
        // Drift — bail.
        break
      } else {
        postRunLen = tailStart - postCursor
      }
    }

    builtRuns.push({
      origStart: r.start,
      origEnd: r.end,
      postStart: postCursor,
      postEnd: postCursor + postRunLen,
    })
    origCursor = r.end
    postCursor += postRunLen
  }

  if (builtRuns.length === 0 && regexDetections.length > 0) {
    // Couldn't build a coordinate map — fall back to text-search alignment.
    const fallback: NerDetection[] = []
    for (const det of detections) {
      const idx = postRegexText.indexOf(det.text)
      if (idx >= 0) {
        fallback.push({ ...det, start: idx, end: idx + det.text.length })
      }
    }
    return fallback
  }

  // Translate a single original-text offset to a post-regex offset.
  // Returns null if the offset falls inside a regex run (the detection
  // overlaps a mask and must be dropped).
  function translateOffset(origPos: number, isEnd: boolean): number | null {
    let delta = 0
    for (const run of builtRuns) {
      if (origPos < run.origStart) break
      if (origPos > run.origEnd) {
        delta += (run.postEnd - run.postStart) - (run.origEnd - run.origStart)
        continue
      }
      // origPos in [run.origStart, run.origEnd].
      if (isEnd && origPos === run.origStart) {
        // Detection ends exactly at the start of a regex run → still outside
        // the run on the right side, no overlap.
        delta += 0
        return origPos + delta
      }
      if (!isEnd && origPos === run.origEnd) {
        // Detection starts exactly at the end of a regex run → outside.
        delta += (run.postEnd - run.postStart) - (run.origEnd - run.origStart)
        return origPos + delta
      }
      // Genuine overlap — caller must drop.
      return null
    }
    return origPos + delta
  }

  const result: NerDetection[] = []
  for (const det of detections) {
    const newStart = translateOffset(det.start, false)
    const newEnd = translateOffset(det.end, true)
    if (newStart === null || newEnd === null || newEnd <= newStart) {
      continue
    }
    // Verify the post-regex slice still equals det.text — guard against
    // off-by-one mistakes in the coordinate map.
    if (postRegexText.slice(newStart, newEnd) !== det.text) {
      // Drift: fall back to first-occurrence lookup.
      const idx = postRegexText.indexOf(det.text)
      if (idx < 0) continue
      result.push({ ...det, start: idx, end: idx + det.text.length })
      continue
    }
    result.push({ ...det, start: newStart, end: newEnd })
  }
  return result
}

/**
 * Two-pass replacement of NER entities — see Python
 * `apply_gliner_with_pseudonyms` for the canonical order. Mutates `mapper`,
 * returns the substituted text + the list of mapping entries produced (one
 * per entity, deduped by `realValue+pseudonym`).
 *
 * `isPass2Enabled(label)` decides, PER LABEL, whether a Pass-2 category
 * (`luogo` / `organizzazione` / `tribunale`) is substituted (predicate true)
 * or preserved (predicate false → emit `isPreserved: true`,
 * `pseudonym === realValue`). This per-label granularity is the fix for the
 * all-or-nothing bug (spuntare una voce attivava tutte e 3 le categorie) —
 * founder criterio canonico `_org/decision_log.md` 2026-05-30
 * SID-20260530-095254.
 */
function applyNerWithPseudonyms(
  text: string,
  ner: NerDetection[],
  mapper: PseudonymMapper,
  userFalsePositives: ReadonlySet<string>,
  isPass2Enabled: (label: string) => boolean,
): { text: string; mappingEntries: MappingEntry[] } {
  // Filter stoplist + user-marked false positives early (Python parity).
  // Drop 1-char entities (Pass-1 NER noise; no real IT surname is 1 char).
  const filtered = ner.filter(
    (e) =>
      !isStoplist(e.text) &&
      !userFalsePositives.has(e.text) &&
      e.text.trim().length >= 2,
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

  // Seed companies (full names before suffix-only mentions). Only seed when
  // the organizzazione label is enabled — otherwise the org will be preserved
  // and there's no reason to burn a pool slot.
  if (isPass2Enabled('organizzazione')) {
    const companiesFull = filtered
      .filter((e) => e.label === 'organizzazione' && isCompany(e.text))
      .sort((a, b) => a.start - b.start)
    for (const ent of companiesFull) mapper.getCompany(ent.text)
  }

  // Replace in reverse so offsets remain valid.
  //
  // Bug fix (regression 20260518): an additional safety pass dedupes any
  // NER detection that overlaps another, keeping the higher-score one.
  // Two overlapping replacements applied to the SAME span produce
  // corrupted output ("MarSempronio Bellini" etc.); upstream
  // `NerRunner.predict` already does this globally, but defending here is
  // cheap and protects callers that build detections by hand.
  const sortedForOverlap = [...filtered].sort((a, b) => b.score - a.score)
  const acceptedSpans: NerDetection[] = []
  for (const span of sortedForOverlap) {
    const overlaps = acceptedSpans.some(
      (a) => span.start < a.end && span.end > a.start,
    )
    if (!overlaps) acceptedSpans.push(span)
  }

  const seen = new Set<string>()
  const mappingEntries: MappingEntry[] = []
  let result = text
  const ordered = [...acceptedSpans].sort((a, b) => b.start - a.start)
  for (const ent of ordered) {
    const original = ent.text
    const label = ent.label
    let replacement: string | null = null
    let category = label

    // Variante β: Pass 2 labels (luogo / organizzazione / tribunale) bypass
    // pseudonym allocation when THAT specific label is not enabled. Emit a
    // preserved entry (realValue verbatim, no text edit) so the UI review
    // panel can offer [Sostituisci comunque] per single entity. Per-label
    // (not all-or-nothing) — founder criterio 2026-05-30.
    const isPass2Label = PASS_2_LABELS.has(label)
    if (isPass2Label && !isPass2Enabled(label)) {
      // De-dupe by category::realValue so repeated mentions of the same
      // place don't produce N rows in the review list.
      const dedupeKey = `preserved::${label}::${original}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)
      // Map NER label → UI-facing category, matching the substituted path's
      // category names (citta/azienda/organizzazione/tribunale).
      let preservedCategory = label
      if (label === 'organizzazione') {
        if (isCompany(original)) preservedCategory = 'azienda'
        else preservedCategory = 'organizzazione'
      } else if (label === 'luogo') {
        if (isStreetLike(original)) preservedCategory = 'via'
        else preservedCategory = 'citta'
      }
      mappingEntries.push({
        pseudonym: original,
        realValue: original,
        category: preservedCategory,
        isPreserved: true,
        pass: 2,
        source: 'gliner',
      })
      continue
    }

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
      pass: PASS_2_LABELS.has(label) ? 2 : 1,
      isPreserved: false,
      source: 'gliner',
    })
  }
  return { text: result, mappingEntries }
}

export function anonymize(
  text: string,
  options: AnonymizeOptions = {},
): AnonymizeResult {
  // EXTEND mode: if a seeded mapper is provided (active-mapping UX, see
  // capabilities_index §6.2 + §7), reuse it so pseudonym allocations from
  // previous documents in the same case survive. Tier 1 of `getPerson` ('exact
  // match') guarantees Mario Rossi → Tizio remains Tizio in Doc2. Otherwise
  // start fresh — preserves the legacy single-doc behaviour.
  const mapper =
    options.seedMapper instanceof PseudonymMapper
      ? (options.seedMapper as PseudonymMapper)
      : new PseudonymMapper({ language: options.language })

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
    // A detector that numbers its own tokens per distinct value (PHONE →
    // `<PHONE_1>`, see regex.ts) sets `det.pseudonym`; use it verbatim. Else
    // fall back to the per-category constant mask (CF/IBAN/EMAIL/…).
    const pseudonym =
      det.pseudonym ?? REGEX_CATEGORY_TO_MASK[det.category] ?? `<${det.category}>`
    // For self-numbered tokens (PHONE) the token IS the canonical identity, so
    // dedup on the token alone — two surface formats of the same number share
    // `<PHONE_1>` and must yield ONE mapping entry (first-seen realValue), else
    // the reverse pass sees two `<PHONE_1>→…` rows. For constant-mask categories
    // the legacy `pseudonym::match` key still distinguishes distinct values.
    const dedupeKey = det.pseudonym ? pseudonym : `${pseudonym}::${det.match}`
    if (seenRegex.has(dedupeKey)) continue
    seenRegex.add(dedupeKey)
    mappingEntries.push({
      pseudonym,
      realValue: det.match,
      category: det.category,
      source: 'regex',
    })
  }

  // Layer 2: NER (optional, Phase 4 path). The browser-side runner produces
  // detections over the *original* text (it runs against the raw user input
  // in parallel chunks). The regex layer above has since shifted offsets —
  // every CF lost 12 chars to "<DS>", every email lost (length - 7) chars
  // to "<EMAIL>", etc. Apply detections raw and the substitution lands at
  // the wrong column, producing the founder bug
  // `BLL MRC 7TizioEMAIL>+39 347 551 2093`.
  //
  // `reanchorNerDetections` rebuilds the originalPos → postRegexPos map
  // from the regex detections and re-anchors every NER detection. Spans
  // that overlap a regex mask are dropped (the regex already handled that
  // surface); spans whose mapped slice no longer matches `det.text` fall
  // back to a first-occurrence text search.

  // Per-label Pass-2 predicate. Precedence:
  //   1. `enabledPass2Labels` (granular, founder criterio 2026-05-30) — when
  //      supplied (even empty), each label is enabled iff it's in the set.
  //   2. else the legacy all-or-nothing `includeCategoriesPass2` boolean
  //      (PseudonymizePanel single checkbox + engine regression suite).
  const isPass2Enabled = ((): ((label: string) => boolean) => {
    if (options.enabledPass2Labels !== undefined) {
      const set = options.enabledPass2Labels
      return (label: string) => set.has(label)
    }
    const all = options.includeCategoriesPass2 === true
    return () => all
  })()

  // Deterministic city-whitelist augmentation (founder criterio 2026-05-30,
  // bug NER recall variabile su città IT in liste). Runs SOLO quando il
  // toggle "Luoghi" è attivo (`luogo` ∈ enabledPass2Labels) — rispetta il
  // canone per-label del 2026-05-30. Le hit sono calcolate sul TESTO
  // ORIGINALE (stessa convenzione del NER, che il reanchor riallinea sul
  // post-regex) e mergiate con `options.nerDetections` senza sovrapporsi a
  // span NER esistenti. Effetto netto: copertura deterministica su
  // capoluoghi (Firenze/Palermo/...) anche quando il NER li manca; nessuna
  // regressione quando li cattura (overlap-dedup le scarta).
  let augmentedNer: NerDetection[] | undefined = options.nerDetections
  if (isPass2Enabled('luogo')) {
    const cityHits = detectItalianCities(text)
    if (cityHits.length > 0) {
      augmentedNer = mergeWhitelistWithNer(
        options.nerDetections ?? [],
        cityHits,
      )
    }
  }

  let pseudonymizedText = afterRegex
  if (augmentedNer && augmentedNer.length > 0) {
    const fp = options.userFalsePositives ?? new Set<string>()
    const reanchored = reanchorNerDetections(
      augmentedNer,
      detections,
      text,
      afterRegex,
    )
    const nerOutcome = applyNerWithPseudonyms(
      afterRegex,
      reanchored,
      mapper,
      fp,
      isPass2Enabled,
    )
    pseudonymizedText = nerOutcome.text
    mappingEntries.push(...nerOutcome.mappingEntries)
  }

  // Layer 3: gated opt-in detectors (Date + CAP). Runs LAST, against the
  // already-substituted text — same discipline as the phone pass in
  // applyRegexRules: names/orgs/places are already masked, so a date/CAP scan
  // can't bite into a pseudonym. Each distinct value gets a numbered token
  // (<DATA_n>/<CAP_n>) recorded as a normal (non-preserved) mapping entry, so
  // the Decodifica reverse pass round-trips it. Default OFF (trade-off
  // giuridico → opt-in), founder criterio 2026-05-30 SID-20260530-095254.
  if (options.enabledGatedDetectors && options.enabledGatedDetectors.size > 0) {
    const { spans, entries } = detectGated(
      pseudonymizedText,
      options.enabledGatedDetectors,
    )
    if (spans.length > 0) {
      pseudonymizedText = applyGatedSpans(pseudonymizedText, spans)
      for (const e of entries) {
        mappingEntries.push({
          pseudonym: e.pseudonym,
          realValue: e.realValue,
          category: e.category,
          isPreserved: false,
          pass: 2,
          source: 'regex',
        })
      }
    }
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
