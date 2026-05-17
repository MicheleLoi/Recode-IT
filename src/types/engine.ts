/**
 * Canonical engine types — Phase 1 surface.
 *
 * The Phase 1 engine is regex-only (no NER), but the public surface accepts an
 * optional pre-supplied list of NER detections so the Phase 4 integration is a
 * drop-in extension rather than a breaking change.
 */

/** A regex-layer detection produced by `applyRegexRules`. */
export type RegexDetection = {
  /** The regex rule's `category` label (e.g. "CF", "P.IVA", "IBAN"). */
  pattern: string
  /** Inclusive start offset in the *input* text (before substitution). */
  start: number
  /** Exclusive end offset in the *input* text. */
  end: number
  /** The literal matched substring (`m.group(0)`). */
  match: string
  /** Mirrors `category` for downstream consumers that key off "category". */
  category: string
}

/**
 * Forward-compatible placeholder for Phase 4 GLiNER detections.
 * Shape is intentionally identical to the Python `_predict_chunk` output rows.
 */
export type NerDetection = {
  start: number
  end: number
  label: string
  text: string
  score: number
}

/** A single pseudonym ↔ original pairing recorded during a pipeline run. */
export type MappingEntry = {
  pseudonym: string
  realValue: string
  category: string
}

export type AnonymizeOptions = {
  /** Phase 4 hook — ignored in Phase 1 (regex-only mode). */
  nerDetections?: NerDetection[]
  /** Pseudonyms or tokens the user has flagged as false positives. */
  userFalsePositives?: Set<string>
}

export type AnonymizeResult = {
  pseudonymizedText: string
  mappingEntries: MappingEntry[]
  /** pseudonym → list of distinct real names that resolved to it. */
  collisions: Map<string, string[]>
  /** Lowercased names exempt from pseudonymization (de cuius / GDPR Recital 27). */
  skipSet: Set<string>
  /** Count of substitutions per regex category. */
  regexSubstitutionCounts: Record<string, number>
  /**
   * Snapshot of the internal `PseudonymMapper._personMap` after the run.
   * Lowercased full-name → pseudonym. Exposed for the Phase 4 equivalence
   * harness; not consumed by the UI.
   */
  personMap: Map<string, string>
  /**
   * Snapshot of `PseudonymMapper._surnameMap`. Lowercased surname → pseudonym.
   */
  surnameMap: Map<string, string>
}
