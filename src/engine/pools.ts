/**
 * pools.ts — pseudonym pools (Italian legal tradition).
 *
 * Source of truth:
 *   - PERSON_POOL, COMPANY_POOL, CITY_POOL, STREET_POOL: literal port of the
 *     constants in `MHC-L/gate-local/tools/anonymize.py`.
 *   - `vocabolario_pseudonimi_it.json`: snapshot of the MHC-L file shipped in
 *     `MHC-L/scripts/`. The JSON wins for `persona` / `luogo` when keys collide
 *     (per IMPLEMENTATION_PLAN.md §Phase 1 Task 3).
 *
 * The union semantics: vocab JSON entries appear first (precedence), then any
 * anonymize.py pool entries not already in the vocab list. The downstream
 * mapper allocates by ordered index, so vocab-first means "JSON list is the
 * first thing handed out".
 */

import vocabData from './data/vocabolario_pseudonimi_it.json'

export const PERSON_POOL_ANONYMIZE_PY: string[] = [
  'Tizio',
  'Caio',
  'Sempronio',
  'Mevio',
  'Filano',
  'Calpurnio',
  'Cornelia',
  'Lucrezia',
  'Servio',
  'Tullio',
  'Attilia',
  'Porzia',
  'Decio',
  'Flavio',
  'Aureliano',
  'Valeria',
]

export const COMPANY_POOL_ANONYMIZE_PY: string[] = [
  'Alfa',
  'Beta',
  'Gamma',
  'Delta',
  'Epsilon',
  'Zeta',
  'Eta',
  'Theta',
  'Iota',
  'Kappa',
]

export const CITY_POOL_ANONYMIZE_PY: string[] = [
  'Metropoli',
  'Borgo Antico',
  'Villarosa',
  'Campochiaro',
  'Fontebuona',
  'Rivalta',
  'Montenero',
  'Vallelunga',
  'Poggio Reale',
  'Casanova',
  'Pietralunga',
  'Serravalle',
]

export const STREET_POOL: string[] = [
  'Via dei Fiori 1',
  "Corso della Liberta' 22",
  'Via del Sole 8',
  'Viale degli Olmi 15',
  'Via Nuova 44',
  'Piazza Centrale 3',
  'Via del Parco 67',
  'Corso Italia 10',
  'Via Garibaldi 5',
  'Via delle Rose 12',
  'Via Mazzini 18',
  'Via Verdi 30',
]

// ---------------------------------------------------------------------------
// Vocab-JSON sourced lists.
// ---------------------------------------------------------------------------

type VocabShape = {
  language?: string
  persona?: string[] | null
  luogo?: string[] | null
  organizzazione?: string[] | null
}

const VOCAB = vocabData as VocabShape

const VOCAB_PERSONA = Array.isArray(VOCAB.persona) ? VOCAB.persona : []
const VOCAB_LUOGO = Array.isArray(VOCAB.luogo) ? VOCAB.luogo : []
const VOCAB_ORG = Array.isArray(VOCAB.organizzazione) ? VOCAB.organizzazione : []

/**
 * Union with the JSON taking precedence: JSON entries first, then anonymize.py
 * entries not already in the JSON.
 */
function unionVocabFirst(vocabList: string[], pyList: string[]): string[] {
  const seen = new Set(vocabList.map((s) => s.toLowerCase()))
  const out = [...vocabList]
  for (const item of pyList) {
    if (!seen.has(item.toLowerCase())) {
      out.push(item)
      seen.add(item.toLowerCase())
    }
  }
  return out
}

/** Person pseudonym pool — vocab JSON wins on overlap. */
export const PERSON_POOL: string[] = unionVocabFirst(
  VOCAB_PERSONA,
  PERSON_POOL_ANONYMIZE_PY,
)

/** City pseudonym pool — vocab JSON wins on overlap. */
export const CITY_POOL: string[] = unionVocabFirst(
  VOCAB_LUOGO,
  CITY_POOL_ANONYMIZE_PY,
)

/** Company pseudonym pool — vocab JSON wins on overlap. */
export const COMPANY_POOL: string[] = unionVocabFirst(
  VOCAB_ORG,
  COMPANY_POOL_ANONYMIZE_PY,
)

/** Raw vocab object (escape hatch for VocabAllocator + downstream tooling). */
export const VOCAB_RAW = {
  persona: VOCAB_PERSONA,
  luogo: VOCAB_LUOGO,
  organizzazione: VOCAB_ORG,
}

// ---------------------------------------------------------------------------
// Multi-language pool resolver
//
// The Italian pools above remain the default for backward compat. For the
// other languages we ship pure list pools (no vocab.json — those are an
// Italian-specific concept the founder curates for legal Latin tradition).
// ---------------------------------------------------------------------------

import {
  PERSON_POOL_EN,
  COMPANY_POOL_EN,
  CITY_POOL_EN,
  STREET_POOL_EN,
} from './pools_en'

import {
  PERSON_POOL_DE,
  COMPANY_POOL_DE,
  CITY_POOL_DE,
  STREET_POOL_DE,
} from './pools_de'

export type LanguagePools = {
  PERSON_POOL: string[]
  COMPANY_POOL: string[]
  CITY_POOL: string[]
  STREET_POOL: string[]
}

const POOLS_BY_LANG: Record<string, LanguagePools> = {
  it: {
    PERSON_POOL,
    COMPANY_POOL,
    CITY_POOL,
    STREET_POOL,
  },
  en: {
    PERSON_POOL: PERSON_POOL_EN,
    COMPANY_POOL: COMPANY_POOL_EN,
    CITY_POOL: CITY_POOL_EN,
    STREET_POOL: STREET_POOL_EN,
  },
  de: {
    PERSON_POOL: PERSON_POOL_DE,
    COMPANY_POOL: COMPANY_POOL_DE,
    CITY_POOL: CITY_POOL_DE,
    STREET_POOL: STREET_POOL_DE,
  },
}

/**
 * Resolve the pool quartet for a given language code. Unknown languages
 * fall back to Italian so the mapper never starves on missing data.
 */
export function getPoolsForLanguage(language: string = 'it'): LanguagePools {
  return POOLS_BY_LANG[language] ?? POOLS_BY_LANG.it!
}
