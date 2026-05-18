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
  /**
   * DESIGN.md §8.7: a flagged false-positive entry survives in the mapping
   * (so it can be re-applied across documents in the same active mapping)
   * but is excluded from the recode reverse-substitution. Optional —
   * defaults to false; legacy serialized mappings without the field are
   * treated as non-false-positive on rehydration.
   */
  isFalsePositive?: boolean
  /**
   * Variante β (opt-in luoghi/org/tribunali): when `true`, the entity was
   * detected by NER but intentionally NOT substituted in the output text —
   * `pseudonym` carries the literal original value. UI surfaces these with a
   * "preservato" badge + `[Sostituisci comunque]` action. Optional — legacy
   * entries and Pass 1 entries default to `false`.
   */
  isPreserved?: boolean
  /**
   * Workflow pass that produced this entry. `1` = always substituted
   * (persone, codici, IBAN, email, telefono, numero di causa). `2` = opt-in
   * (luogo, organizzazione, tribunale). Stored mostly for analytics + future
   * UI surface; legacy entries default to `1`.
   */
  pass?: 1 | 2
}

export type AnonymizeOptions = {
  /** Phase 4 hook — ignored in Phase 1 (regex-only mode). */
  nerDetections?: NerDetection[]
  /** Pseudonyms or tokens the user has flagged as false positives. */
  userFalsePositives?: Set<string>
  /**
   * EXTEND mode — when an active mapping is open in the UI and the user
   * drops a new document for the same case, pass the seeded
   * `PseudonymMapper` here. The pipeline will reuse existing
   * pseudonym↔original allocations (Mario Rossi → Tizio stays Tizio in
   * Doc2). When omitted, the pipeline creates a fresh mapper (default
   * single-doc behaviour). Typed as `unknown` here to avoid the engine
   * dependency on `PseudonymMapper`; the engine performs an instanceof check.
   */
  seedMapper?: unknown
  /**
   * Variante β — when `false` (default), Pass 2 categories
   * (`luogo`, `organizzazione`, `tribunale`) are RECORDED in the mapping as
   * preserved entries (`isPreserved: true`, `pseudonym === realValue`) but
   * NOT substituted in the output text. Mirror of MHC-L Python
   * `pseudonymize_gui_local.py` PASS_1_LABELS / PASS_2_LABELS workflow —
   * preserving foro competente / giurisdizione / leggi regionali is often
   * essential for downstream legal reasoning. Set to `true` to substitute
   * every category as in the legacy single-pass behaviour.
   */
  includeCategoriesPass2?: boolean
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
