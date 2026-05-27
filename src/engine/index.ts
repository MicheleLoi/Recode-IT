/**
 * Engine package entrypoint — Phase 1.
 *
 * Phase 1 delivers the TypeScript port of `MHC-L/gate-local/tools/anonymize.py`
 * (regex layer + PseudonymMapper with A-1 / A-2 / A-3 fixes) and the recode
 * primitive from `recode_gui.py`. NER lives in Phase 4 — `anonymize` accepts a
 * forward-compatible `nerDetections` option that is ignored here.
 */

export const ENGINE_VERSION = '0.1.0-phase1'

export { anonymize } from './engine'
export { recodeText } from './recode'
export { applyRegexRules, REGEX_RULES } from './regex'
export {
  DE_CUIUS_RE,
  FALSE_POSITIVE_PATTERNS,
  findDeCuiusNames,
  GENERIC_LABELS_IT,
  isGenericLabel,
  isStoplist,
  ITALIAN_ARTICLES,
  LEGAL_STOPLIST,
  stripTitle,
  TITLE_RE,
} from './stoplist'
export {
  CITY_POOL,
  COMPANY_POOL,
  PERSON_POOL,
  STREET_POOL,
  VOCAB_RAW,
} from './pools'
export { PseudonymMapper } from './pseudonym_mapper'
export { VocabAllocator, VOCAB_CATEGORIES } from './vocab'
export type { VocabCategory } from './vocab'
export type {
  AnonymizeOptions,
  AnonymizeResult,
  MappingEntry,
  NerDetection,
  RegexDetection,
} from '../types/engine'
