/**
 * pseudonym_mapper.ts — port of `PseudonymMapper` from
 * `MHC-L/gate-local/tools/anonymize.py`.
 *
 * Includes the three documented production bug fixes — they are the heart of
 * the port:
 *   - A-1 (surname collision): three-tier `getPerson` lookup with the
 *     `ITALIAN_ARTICLES` carve-out and first-write surname-map registration.
 *   - A-2 (de cuius exemption): `markSkip` / `_skipSet` consulted before any
 *     pseudonym allocation; matching names returned unchanged.
 *   - A-3 (elided title): `TITLE_RE` (imported from stoplist.ts) strips
 *     `L'Avv.`, `L’Ing.`, `Notaio`, etc. before keying the surname index.
 *
 * All keys are lowercase-normalized for case-insensitive lookup. The mapper is
 * in-RAM only; the surrounding pipeline never persists this state.
 */

import { ITALIAN_ARTICLES, stripTitle } from './stoplist'
import {
  CITY_POOL,
  COMPANY_POOL,
  PERSON_POOL,
  STREET_POOL,
  getPoolsForLanguage,
  type LanguagePools,
} from './pools'

export type PseudonymMapperOptions = {
  /**
   * Language code that selects which pseudonym pool quartet (persons,
   * companies, cities, streets) the mapper allocates from. Defaults to
   * 'it' to preserve the original Italian behavior.
   */
  language?: string
}

export class PseudonymMapper {
  private readonly personMap = new Map<string, string>()
  private readonly surnameMap = new Map<string, string>()
  private readonly companyMap = new Map<string, string>()
  private readonly companyBase = new Map<string, string>()
  private readonly cityMap = new Map<string, string>()
  private readonly streetMap = new Map<string, string>()
  private readonly courtCityMap = new Map<string, string>()
  private readonly orgMap = new Map<string, string>()
  private readonly skipSet = new Set<string>()

  private personIdx = 0
  private companyIdx = 0
  private cityIdx = 0
  private streetIdx = 0

  private readonly pools: LanguagePools
  /**
   * Public language code this mapper was built for — callers can use it to
   * decide whether to reuse this mapper across a language switch (they
   * shouldn't: a mapper holds language-specific pseudonym allocations).
   */
  public readonly language: string

  constructor(options: PseudonymMapperOptions = {}) {
    // Default behavior (no options) remains Italian — preserves the contract
    // of every existing call site (tests, ClipboardWidget, etc.).
    this.language = options.language ?? 'it'
    if (options.language && options.language !== 'it') {
      this.pools = getPoolsForLanguage(options.language)
    } else {
      this.pools = {
        PERSON_POOL,
        COMPANY_POOL,
        CITY_POOL,
        STREET_POOL,
      }
    }
  }

  // -------------------------------------------------------------------------
  // Internal pool allocators — same overflow pattern as the Python reference
  // (`{pool[0]}_{idx + 1}` once the pool is exhausted).
  // -------------------------------------------------------------------------

  private nextPerson(): string {
    const idx = this.personIdx
    this.personIdx += 1
    const pool = this.pools.PERSON_POOL
    if (idx < pool.length) return pool[idx] as string
    return `${pool[0]}_${idx + 1}`
  }

  private nextCompany(): string {
    const idx = this.companyIdx
    this.companyIdx += 1
    const pool = this.pools.COMPANY_POOL
    if (idx < pool.length) return pool[idx] as string
    return `${pool[0]}_${idx + 1}`
  }

  private nextCity(): string {
    const idx = this.cityIdx
    this.cityIdx += 1
    const pool = this.pools.CITY_POOL
    if (idx < pool.length) return pool[idx] as string
    return `${pool[0]}_${idx + 1}`
  }

  private nextStreet(): string {
    const idx = this.streetIdx
    this.streetIdx += 1
    const pool = this.pools.STREET_POOL
    if (idx < pool.length) return pool[idx] as string
    return `${pool[0]}_${idx + 1}`
  }

  // -------------------------------------------------------------------------
  // A-2 — De cuius exemption
  // -------------------------------------------------------------------------

  /** Mark `name` (whole or partial) as exempt from pseudonymization. */
  markSkip(name: string): void {
    this.skipSet.add(name.trim().toLowerCase())
  }

  /** Read-only view of the skip set — exposed for tests / drift checks. */
  getSkipSet(): ReadonlySet<string> {
    return this.skipSet
  }

  // -------------------------------------------------------------------------
  // Person allocation — A-1 three-tier lookup (see DESIGN.md §8.3).
  // -------------------------------------------------------------------------

  private static extractSurname(name: string): string | null {
    const parts = name.trim().split(/\s+/).filter(Boolean)
    if (parts.length >= 2) {
      const last = parts[parts.length - 1]
      return last ? last.toLowerCase() : null
    }
    return null
  }

  /**
   * Resolve a person mention to a pseudonym.
   *
   * Tier 1 — exact full-name match.
   * Tier 2 — surname lookup restricted to (a) single-word inputs, or
   *          (b) 2-word inputs whose first word is an Italian article.
   * Tier 3 — allocate a fresh pseudonym; register the surname *only on first
   *          occurrence* (subsequent collisions get their own pseudonym but
   *          do NOT overwrite the surname index — this is the A-1 fix).
   *
   * Names in `_skipSet` are returned unchanged (A-2 exemption).
   */
  getPerson(original: string): string {
    const { title, bare } = stripTitle(original)
    const key = bare.toLowerCase()

    if (this.skipSet.has(key)) {
      return original
    }

    // 1. Exact match
    if (this.personMap.has(key)) {
      const pseudo = this.personMap.get(key) as string
      return title ? `${title} ${pseudo}` : pseudo
    }

    const words = bare.split(/\s+/).filter(Boolean)

    // 2. Surname lookup — restricted (A-1 fix).
    if (words.length === 1) {
      if (this.surnameMap.has(key)) {
        const pseudo = this.surnameMap.get(key) as string
        this.personMap.set(key, pseudo)
        return title ? `${title} ${pseudo}` : pseudo
      }
    } else if (
      words.length === 2 &&
      ITALIAN_ARTICLES.has((words[0] as string).toLowerCase())
    ) {
      const surname = (words[1] as string).toLowerCase()
      if (this.surnameMap.has(surname)) {
        const pseudo = this.surnameMap.get(surname) as string
        this.personMap.set(key, pseudo)
        return title ? `${title} ${pseudo}` : pseudo
      }
    }

    // 3. New person
    const pseudo = this.nextPerson()
    this.personMap.set(key, pseudo)

    const surname = PseudonymMapper.extractSurname(bare)
    if (surname) {
      if (!this.surnameMap.has(surname)) {
        this.surnameMap.set(surname, pseudo)
      }
    }

    // Single-word input: also seed the surname index under the bare key so
    // future article-prefixed references coalesce. Mirrors the Python:
    //     if len(words) == 1 and key not in self._surname_map:
    //         self._surname_map[key] = pseudo
    if (words.length === 1 && !this.surnameMap.has(key)) {
      this.surnameMap.set(key, pseudo)
    }

    return title ? `${title} ${pseudo}` : pseudo
  }

  // -------------------------------------------------------------------------
  // Company allocation
  // -------------------------------------------------------------------------

  getCompany(original: string): string {
    const text = original.trim()
    const suffixRe = /(S\.r\.l\.|S\.p\.A\.|S\.n\.c\.|S\.a\.s\.)\s*$/i
    const suffixMatch = suffixRe.exec(text)
    const suffix = suffixMatch ? suffixMatch[0].trim() : ''
    const base = suffixMatch ? text.slice(0, suffixMatch.index).trim() : text
    const baseKey = base.toLowerCase()

    if (this.companyBase.has(baseKey)) {
      const pseudoBase = this.companyBase.get(baseKey) as string
      const result = suffix ? `${pseudoBase} ${suffix}` : pseudoBase
      return result
    }

    const pseudoBase = this.nextCompany()
    this.companyBase.set(baseKey, pseudoBase)
    const result = suffix ? `${pseudoBase} ${suffix}` : pseudoBase
    this.companyMap.set(text.toLowerCase(), result)
    return result
  }

  // -------------------------------------------------------------------------
  // City / street / court / org
  // -------------------------------------------------------------------------

  getCity(original: string): string {
    const key = original.trim().toLowerCase()
    if (!this.cityMap.has(key)) {
      this.cityMap.set(key, this.nextCity())
    }
    return this.cityMap.get(key) as string
  }

  getStreet(original: string): string {
    const key = original.trim().toLowerCase()
    if (!this.streetMap.has(key)) {
      this.streetMap.set(key, this.nextStreet())
    }
    return this.streetMap.get(key) as string
  }

  private getPseudoCity(realCity: string): string {
    const key = realCity.trim().toLowerCase()
    if (!this.courtCityMap.has(key)) {
      if (this.cityMap.has(key)) {
        this.courtCityMap.set(key, this.cityMap.get(key) as string)
      } else {
        const pseudo = this.nextCity()
        this.courtCityMap.set(key, pseudo)
        this.cityMap.set(key, pseudo)
      }
    }
    return this.courtCityMap.get(key) as string
  }

  getCourt(original: string): string {
    const text = original.trim()
    const cityRe = /(?:Tribunale\s+(?:Ordinario\s+)?di\s+|Foro\s+di\s+)(.+)$/i
    const cityMatch = cityRe.exec(text)
    if (cityMatch && cityMatch[1]) {
      const realCity = cityMatch[1].trim()
      const pseudoCity = this.getPseudoCity(realCity)
      if (/^foro\s+di/i.test(text)) {
        return `Foro di ${pseudoCity}`
      }
      return `Tribunale Ordinario di ${pseudoCity}`
    }
    if (/^sezione\s+/i.test(text)) return text
    if (/tribunale\s+adito/i.test(text)) return text
    return `Tribunale di ${this.getPseudoCity('unknown')}`
  }

  getOrg(original: string): string {
    const text = original.trim()
    const key = text.toLowerCase()
    if (this.orgMap.has(key)) return this.orgMap.get(key) as string

    // Non-Italian path: skip the Italian institutional patterns
    // ("Ordine degli Avvocati di X", "Camera di Commercio di Y",
    // "Ente di ${pseudoCity}" fallback) — they're domain-specific to Italian
    // legal/civil bodies and produce nonsense like "Ente di Springfield" for
    // English orgs like Microsoft. For EN/DE/FR allocate directly from the
    // language's COMPANY_POOL so each distinct organisation gets a distinct
    // pseudonym (Acme Corp., Globex Inc., Initech LLC, ...).
    if (this.language !== 'it') {
      const result = this.companyBase.has(key)
        ? (this.companyBase.get(key) as string)
        : this.nextCompany()
      this.orgMap.set(key, result)
      if (!this.companyBase.has(key)) this.companyBase.set(key, result)
      return result
    }

    let city = ''
    const cityMatch = /\bdi\s+(\w[\w\s]*)$/i.exec(text)
    if (cityMatch && cityMatch[1]) city = cityMatch[1].trim()

    const pseudoCity = city
      ? this.getPseudoCity(city)
      : this.getPseudoCity('sede')

    let result: string
    if (
      /ordine\s+(?:degli\s+)?(?:ingegneri|avvocati|architetti|geometri)/i.test(
        text,
      )
    ) {
      result = `Ordine Professionale di ${pseudoCity}`
    } else if (/camera\s+di\s+commercio/i.test(text)) {
      result = `Camera di Commercio di ${pseudoCity}`
    } else if (/organismo\s+di\s+mediazione/i.test(text)) {
      result = `Organismo di Mediazione di ${pseudoCity}`
    } else if (/agenzia\s+delle\s+entrate/i.test(text)) {
      result = `Agenzia delle Entrate di ${pseudoCity}`
    } else if (/arpa/i.test(text)) {
      result = `ARPA ${pseudoCity}`
    } else if (/(banca|sanpaolo|credito|intesa)/i.test(text)) {
      result = `Banca di Credito di ${pseudoCity}`
    } else {
      if (this.companyBase.has(key)) {
        result = this.companyBase.get(key) as string
      } else {
        let assigned: string | null = null
        for (const [compKey, compPseudo] of this.companyBase.entries()) {
          if (compKey.includes(key) || key.includes(compKey)) {
            this.orgMap.set(key, compPseudo)
            assigned = compPseudo
            break
          }
        }
        if (assigned) return assigned
        result = `Ente di ${pseudoCity}`
      }
    }

    this.orgMap.set(key, result)
    return result
  }

  // -------------------------------------------------------------------------
  // Inspection helpers — used by tests and the drift-detection layer.
  // -------------------------------------------------------------------------

  /** Read-only view of personMap (lowercased full-name → pseudonym). */
  getPersonMap(): ReadonlyMap<string, string> {
    return this.personMap
  }

  /** Read-only view of surnameMap (lowercased surname → pseudonym). */
  getSurnameMap(): ReadonlyMap<string, string> {
    return this.surnameMap
  }

  /** Read-only view of cityMap (lowercased city → pseudonym). */
  getCityMap(): ReadonlyMap<string, string> {
    return this.cityMap
  }

  /** Read-only view of companyBase (lowercased base → pseudonym). */
  getCompanyBase(): ReadonlyMap<string, string> {
    return this.companyBase
  }

  // -------------------------------------------------------------------------
  // EXTEND mode — rehydration from previously serialized MappingEntry[]
  // (capabilities_index §7 / DESIGN §8.7). When the user reopens a saved
  // mapping for a continuing case, we replay every entry into the mapper's
  // internal maps so that Tier 1 ('exact match') in `getPerson` immediately
  // returns the pre-allocated pseudonym for repeated mentions across docs.
  //
  // The categories accepted here are exactly those produced by
  // `applyNerWithPseudonyms` in engine.ts. Regex-only entries (pseudonym is a
  // tag like '<DS>' / '<EMAIL>') are NOT seeded into the mapper — those
  // pseudonyms are deterministic per-category and need no allocation
  // coordination across documents.
  // -------------------------------------------------------------------------

  /**
   * Rehydrate the mapper's internal state from a flat list of mapping entries
   * (typically the decrypted output of a saved-mapping blob). Idempotent: a
   * second call with the same entries leaves state unchanged. Does NOT bump
   * the pool indices when seeding entries already produced by a previous run
   * — instead it advances the pool index past the highest used position so
   * future allocations skip pseudonyms already in use. The skip-set is also
   * rehydrated from any entry whose pseudonym === realValue (the de-cuius
   * exemption shape).
   */
  seedFromEntries(entries: ReadonlyArray<{
    pseudonym: string
    realValue: string
    category: string
    isFalsePositive?: boolean
  }>): void {
    const personPool = new Map<string, number>()
    PERSON_POOL.forEach((p, i) => personPool.set(p, i))
    const companyPool = new Map<string, number>()
    COMPANY_POOL.forEach((p, i) => companyPool.set(p, i))
    const cityPool = new Map<string, number>()
    CITY_POOL.forEach((p, i) => cityPool.set(p, i))
    const streetPool = new Map<string, number>()
    STREET_POOL.forEach((p, i) => streetPool.set(p, i))

    let maxPerson = -1
    let maxCompany = -1
    let maxCity = -1
    let maxStreet = -1

    for (const entry of entries) {
      const real = entry.realValue.trim()
      const realKey = real.toLowerCase()
      const pseudo = entry.pseudonym.trim()
      const cat = entry.category

      // False positives stay in the entries list but do NOT pre-allocate a
      // pseudonym — the realValue survives by design, the FP marker is what
      // the engine consults via userFalsePositives on the next extend pass.
      if (entry.isFalsePositive) continue

      // Regex tag pseudonyms (<DS>, <IBAN>, …) — no mapper state needed.
      if (/^<[A-Z._]+>$/.test(pseudo)) continue

      if (cat === 'persona' || cat === 'avvocato') {
        // De-cuius: pseudonym === original means the entry was skipped.
        if (pseudo.toLowerCase() === realKey) {
          this.skipSet.add(realKey)
          continue
        }
        // Seed personMap on the full lowercased real value — matches the key
        // shape `getPerson` uses for Tier 1 (after stripTitle).
        const { bare } = stripTitle(real)
        const bareKey = bare.toLowerCase()
        if (!this.personMap.has(bareKey)) {
          this.personMap.set(bareKey, pseudo)
        }
        // Seed surnameMap on first occurrence (mirrors A-1 fix invariant).
        const surname = (() => {
          const parts = bare.split(/\s+/).filter(Boolean)
          if (parts.length >= 2) {
            const last = parts[parts.length - 1]
            return last ? last.toLowerCase() : null
          }
          return null
        })()
        if (surname && !this.surnameMap.has(surname)) {
          this.surnameMap.set(surname, pseudo)
        }
        // Single-word: also seed surname index on the bare key.
        const words = bare.split(/\s+/).filter(Boolean)
        if (words.length === 1 && !this.surnameMap.has(bareKey)) {
          this.surnameMap.set(bareKey, pseudo)
        }
        const poolIdx = personPool.get(pseudo)
        if (poolIdx !== undefined && poolIdx > maxPerson) maxPerson = poolIdx
      } else if (cat === 'azienda') {
        // Identity entry (pseudo === real) means the category was disabled at
        // seeding time (e.g. user left "Aziende" OFF on Run 1). Skip seeding —
        // otherwise a later Run with the category enabled would find the
        // identity mapping and return the original instead of a fresh
        // pseudonym from the pool. Mirrors the de-cuius rule above.
        if (pseudo.toLowerCase() === realKey) continue
        // Strip suffix to recover the base — mirrors getCompany().
        const suffixRe = /(S\.r\.l\.|S\.p\.A\.|S\.n\.c\.|S\.a\.s\.)\s*$/i
        const m = suffixRe.exec(real)
        const base = m ? real.slice(0, m.index).trim() : real
        const baseKey = base.toLowerCase()
        const pseudoBase = m ? pseudo.replace(suffixRe, '').trim() : pseudo
        if (!this.companyBase.has(baseKey)) {
          this.companyBase.set(baseKey, pseudoBase)
          this.companyMap.set(real.toLowerCase(), pseudo)
        }
        const poolIdx = companyPool.get(pseudoBase)
        if (poolIdx !== undefined && poolIdx > maxCompany) maxCompany = poolIdx
      } else if (cat === 'citta') {
        if (pseudo.toLowerCase() === realKey) continue
        if (!this.cityMap.has(realKey)) this.cityMap.set(realKey, pseudo)
        const poolIdx = cityPool.get(pseudo)
        if (poolIdx !== undefined && poolIdx > maxCity) maxCity = poolIdx
      } else if (cat === 'via') {
        if (pseudo.toLowerCase() === realKey) continue
        if (!this.streetMap.has(realKey)) this.streetMap.set(realKey, pseudo)
        const poolIdx = streetPool.get(pseudo)
        if (poolIdx !== undefined && poolIdx > maxStreet) maxStreet = poolIdx
      } else if (cat === 'tribunale' || cat === 'organizzazione') {
        if (pseudo.toLowerCase() === realKey) continue
        if (!this.orgMap.has(realKey)) this.orgMap.set(realKey, pseudo)
      }
      // Other categories (numero di causa, data, email/telefono/iban) need no
      // mapper state — they go through deterministic substitution.
    }

    // Advance pool indices past the highest seen so future allocations skip
    // pseudonyms already in use. +1 because pool[idx] is what was assigned.
    if (maxPerson + 1 > this.personIdx) this.personIdx = maxPerson + 1
    if (maxCompany + 1 > this.companyIdx) this.companyIdx = maxCompany + 1
    if (maxCity + 1 > this.cityIdx) this.cityIdx = maxCity + 1
    if (maxStreet + 1 > this.streetIdx) this.streetIdx = maxStreet + 1
  }

  /**
   * Return any pseudonym mapped to more than one distinct full-name key in
   * `_personMap`. Shape: `Map<pseudonym, fullNames[]>`. An empty map means no
   * collisions — the post-fix state required by the MHC-L regression suite.
   */
  detectCollisions(): Map<string, string[]> {
    const inverse = new Map<string, string[]>()
    for (const [key, pseudo] of this.personMap.entries()) {
      const list = inverse.get(pseudo)
      if (list) {
        list.push(key)
      } else {
        inverse.set(pseudo, [key])
      }
    }
    const collisions = new Map<string, string[]>()
    for (const [pseudo, names] of inverse.entries()) {
      if (names.length > 1) collisions.set(pseudo, names)
    }
    return collisions
  }
}
