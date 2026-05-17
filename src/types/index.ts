/**
 * Shared TypeScript types for the Recode IT engine, UI, auth, and API layers.
 * Phase 0 declares only the canonical mapping/detection shapes so downstream
 * phases can import from a stable surface from day one.
 */

export type Detection = {
  start: number
  end: number
  label: string
  text: string
  /** Provenance: regex layer vs. GLiNER NER. */
  source: 'regex' | 'gliner'
  /** Confidence score (GLiNER) — absent for regex hits. */
  score?: number
}

export type MappingEntry = {
  pseudonym: string
  original: string
  category: string
  source: 'regex' | 'gliner'
  isFalsePositive: boolean
}

export type MappingObject = MappingEntry[]
