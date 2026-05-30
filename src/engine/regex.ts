/**
 * regex.ts — TypeScript port of `MHC-L/gate-local/tools/regex_rules.py`
 * + Item 7 C extensions SID-20260526-011753 (telefono IT + booking ref).
 *
 * 12 patterns for Italian legal/booking structured-identifier detection. The
 * port is literal: Python `re.compile(..., re.I)` → `new RegExp(..., 'gi')`,
 * lambda replacements → arrow functions. Boundary semantics (`\b`) are
 * equivalent between Python's `re` and ECMAScript regex for ASCII inputs,
 * which is what these patterns target.
 *
 * High-precision over high-recall — extending this set is a deliberate
 * decision. Item 7 C additions (`PHONE_IT_*`, `NUM_PRENOT_RE`) require
 * explicit context prefix (telefono +39/0039 o struttura mobile formatted;
 * booking number con keyword "Numero Prenotazione"/"Conferma"/etc.) per
 * mantenere low-FP. Date/importi/CAP esplicitamente NON inclusi: sono
 * contenuto semantico del documento legale, non metadati personali (canon
 * `_org/decision_log.md` MHC-Work 2026-05-26 SID-20260526-011753 §Item 7 C).
 */

import type { RegexDetection } from '../types/engine'
import { validateCF } from './cf-validator'
import { validateIBAN } from './iban-validator'
import { detectPhones } from './phone-detector'

type ReplacementFn = (match: RegExpExecArray) => string
type Replacement = string | ReplacementFn

export type RegexRule = {
  category: string
  pattern: RegExp
  replacement: Replacement
  /**
   * Optional post-match validator. When supplied, a regex hit whose matched
   * substring does NOT satisfy the predicate is dropped (no detection
   * recorded, no substitution performed). Used by the CF and IBAN rules to
   * gate by check-digit conformance (CEI 12-1979 for CF, ISO 13616 MOD-97
   * for IBAN) — a structurally-shaped but checksum-invalid token like
   * `ABCDEF12G34H567I` no longer produces a false positive.
   */
  validate?: (match: string) => boolean
}

// ---------------------------------------------------------------------------
// Individual patterns — exported as named consts for direct testing.
// ---------------------------------------------------------------------------

/**
 * Persona CF — 16-char, tollerante di whitespace ai 3 boundary naturali fra
 * i blocchi della struttura CCC-CCC-NNCNN-CNNNC.
 *
 * Forme accettate:
 *  - canonical no-space: `RNLLSS84C52H501U`
 *  - 3-group readable (6L prefix together): `RNLLSS 84C52 H501U`
 *  - 4-group readable (split cognome|nome, form-field style): `RNL LSS 84C52 H501U`
 *  - tutte combinazioni mixed (es. solo split 6L, solo split data/codice)
 *  - omocodia INPS: nelle 3 posizioni-substituibili (anno YY, giorno DD,
 *    codice catastale comune NNN) le cifre sono sostituite da lettere mappate
 *    (0→L, 1→M, 2→N, 3→P, 4→Q, 5→R, 6→S, 7→T, 8→U, 9→V) quando 2+ persone
 *    collidono sullo stesso CF canonico. Esempio: `RNLLSS84CR2H50LK` è la
 *    forma omocodificata di `RNLLSS84C52H501U` (posizioni 11: 5→R,
 *    15: 1→L; il check digit del 16° char viene ricalcolato sulla forma
 *    omocodificata, non sulla canonica — D.M. 12 marzo 1974).
 *
 * Founder direttiva SID-20260527-181552: il form-field readable 4-group era
 * il caso che le precedenti due regex (canonical + 3-group con 6L joined) NON
 * coprivano, missing CF in screenshots come `RNL LSS 84C52 H501U`. Omocodia
 * estesa nella stessa session per matching INPS reale.
 *
 * Char-class `[0-9LMNPQRSTUV]` covers both canonical (digits only) and
 * omocoded variants (digit OR mapped letter in any of the 3
 * substitution-eligible blocks). The month letter (12° position counting from
 * 1) remains restricted to the 12 valid month codes `[ABCDEHLMPRST]` — those
 * are never substituted (they are part of the structural alphabet, not
 * digits subject to omocodia collision resolution).
 *
 * Case-insensitive (OCR / lowercase). Match is FP-filtered post-extraction by
 * `validateCF` (CEI 12-1979 checksum) — see `applyRegexRules`.
 */
export const CF_RE =
  /\b[A-Z]{3}\s*[A-Z]{3}\s*[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}\s*[A-Z][0-9LMNPQRSTUV]{3}[A-Z]\b/gi

/** CF azienda con prefisso esplicito "C.F." / "CF:". */
export const CF_NUM_RE = /(C\.?\s*F\.?\s*:?\s*)(\d{11})/gi

/** CF azienda con prefisso "Cod. Fisc." / "Codice Fiscale". */
export const CF_NUM_LONG_RE =
  /((?:Cod(?:ice)?\.?\s*Fisc(?:ale)?\.?)\s*:?\s*)(\d{11})/gi

/** P.IVA — covers "P. IVA", "PIVA", "Partita IVA" variants. */
export const PIVA_RE =
  /((?:P\.?\s*IVA\s*|PIVA\s*|Partita\s+IVA\s*):?\s*)(\d{11})/gi

/**
 * IBAN IT — `IT` + 2 check digits + 23 alphanumerics, with optional whitespace
 * or dash separators between the 4-char documentary groups
 * (`IT60 X054 2811 1010 0000 0123 456` and `IT60-X054-…` forms).
 *
 * Pattern inspired by Microsoft Presidio's `IT_IBAN` recognizer (MIT) — see
 * NOTICE.md. The grouping `(?:[\s-]?[A-Z0-9]{4}){5}[\s-]?[A-Z0-9]{3}` mirrors
 * the ISO 13616 4-char "human-readable" documentary convention while keeping
 * the canonical no-separator form a strict subset.
 *
 * Match is FP-filtered post-extraction by `validateIBAN` (ISO 13616 MOD-97)
 * — see `applyRegexRules`. A structurally-shaped but checksum-invalid token
 * like `IT99X0000000000000000000000` no longer produces a false positive.
 */
export const IBAN_IT_RE =
  /\bIT\d{2}(?:[\s-]?[A-Z0-9]{4}){5}[\s-]?[A-Z0-9]{3}\b/gi

/** CRO bancario — 13 digits following "CRO". */
export const CRO_RE = /(CRO:?\s*)(\d{13})/gi

/** Numero di protocollo — "prot. n. MI/2024/001" and similar. */
export const PROT_RE =
  /(prot\.?\s*(?:n\.?\s*)?)([A-Z]{2,}\/\d{4}\/\d{3,})/gi

/** Email / PEC. */
export const EMAIL_RE = /\b[\w.+-]+@[\w.-]+\.\w{2,}\b/g

/**
 * LEGACY — Telefono italiano con prefisso internazionale esplicito (+39/0039).
 *
 * NO LONGER IN `REGEX_RULES`. Phone detection moved to libphonenumber-js
 * (`detectPhones`, wired into `applyRegexRules`) for real EU + worldwide
 * coverage — recall went from ~2.9% global / ~0% world to library-grade.
 * This const is retained ONLY as a documented fast-path reference / for any
 * external importer; it does not drive the pipeline. See `phone-detector.ts`.
 */
export const PHONE_IT_PREFIX_RE =
  /(?:\+39|0039)\s?\d[\d\s.-]{7,13}\d\b/g

/**
 * LEGACY — Telefono mobile italiano formattato (3xx + separatore).
 *
 * NO LONGER IN `REGEX_RULES`. This pattern was the source of the documented
 * cross-locale false positive: it matched the bare shape `3xx-ddd-dddd`, so an
 * internal order code "300-123-4567" was indistinguishable from a real mobile
 * (eval FP `order_code`). libphonenumber's number-plan validity gate replaces
 * it. Retained as a documented reference only. See `phone-detector.ts`.
 */
export const PHONE_IT_MOBILE_RE =
  /\b3\d{2}[\s.-]\d{3}[\s.-]\d{3,4}\b/g

/**
 * Numero prenotazione/conferma con prefisso esplicito. Il prefisso (parola
 * "Numero"/"Codice"/"N." + "Prenotazione"/"Conferma"/"Booking"/"Reservation")
 * è il segnale che ancora il match — il numero nudo non matcha mai. Output:
 * preserva il prefisso, sostituisce solo l'identificatore.
 */
export const NUM_PRENOT_RE =
  /((?:Numero|Num\.?|Cod(?:ice)?\.?|N\.?)\s+(?:[Pp]renotazione|[Cc]onferma|[Bb]ooking|[Rr]eservation)\s*:?\s*)([A-Z0-9-]{6,20})/g

// ---------------------------------------------------------------------------
// Rule list — mirrors the order of `REGEX_RULES` in the Python source so that
// substitution side-effects (e.g. CF eating digits before CF_NUM scans) match
// the reference pipeline. Item 7 C additions appended after EMAIL (no
// interference with prior rules).
// ---------------------------------------------------------------------------

export const REGEX_RULES: RegexRule[] = [
  {
    category: 'CF',
    pattern: CF_RE,
    replacement: '<DS>',
    // Drop syntactic-but-checksum-invalid matches (CEI 12-1979). Whitespace
    // in form-field-readable forms is stripped inside `validateCF`.
    validate: validateCF,
  },
  {
    category: 'CF_NUM',
    pattern: CF_NUM_RE,
    replacement: (m) => `${m[1] ?? ''}<DS>`,
  },
  {
    category: 'CF_NUM',
    pattern: CF_NUM_LONG_RE,
    replacement: (m) => `${m[1] ?? ''}<DS>`,
  },
  {
    category: 'P.IVA',
    pattern: PIVA_RE,
    replacement: (m) => `${m[1] ?? ''}<P.IVA>`,
  },
  {
    category: 'IBAN',
    pattern: IBAN_IT_RE,
    replacement: '<IBAN>',
    // Drop syntactic-but-checksum-invalid matches (ISO 13616 MOD-97).
    // Separator stripping is internal to `validateIBAN`.
    validate: validateIBAN,
  },
  {
    category: 'CRO',
    pattern: CRO_RE,
    replacement: (m) => `${m[1] ?? ''}<CRO>`,
  },
  {
    category: 'PROT',
    pattern: PROT_RE,
    replacement: (m) => `${m[1] ?? ''}<PROT>`,
  },
  { category: 'EMAIL', pattern: EMAIL_RE, replacement: '<EMAIL>' },
  // PHONE detection is no longer regex-driven: it runs as a libphonenumber-js
  // pass inside `applyRegexRules` (see `detectPhones` import + the phone block
  // appended after the regex loop). The two legacy `PHONE_IT_*` consts above
  // are retained for reference but intentionally absent from this list.
  {
    category: 'NUM_PRENOT',
    pattern: NUM_PRENOT_RE,
    replacement: (m) => `${m[1] ?? ''}<RES_NUM>`,
  },
]

/**
 * Apply every regex rule in order, returning detections recorded against the
 * *pre-substitution* text and the substituted text.
 *
 * Implementation note: each rule's pattern carries the `/g` flag and is used
 * twice per call (once to enumerate matches for the detection record, once via
 * `replace` to mutate the running text). RegExp `lastIndex` is reset between
 * uses to avoid stateful surprises.
 */
export function applyRegexRules(text: string): {
  text: string
  detections: RegexDetection[]
} {
  const detections: RegexDetection[] = []
  let current = text

  for (const rule of REGEX_RULES) {
    // Record detections against the *current* text (mirrors the Python
    // sequential-substitution semantics where each rule sees the output of the
    // previous one). Matches that fail `rule.validate` (when supplied) are
    // dropped here AND skipped in the replacement pass below — keeping the
    // two passes in lockstep.
    rule.pattern.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = rule.pattern.exec(current)) !== null) {
      const matched = m[0]
      if (rule.validate && !rule.validate(matched)) {
        // Defensive: skip the match (no detection, no substitution) but
        // advance `lastIndex` so the next exec doesn't re-match the same
        // span (which would loop forever for zero-width edge cases).
        if (m.index === rule.pattern.lastIndex) {
          rule.pattern.lastIndex += 1
        }
        continue
      }
      detections.push({
        pattern: rule.category,
        category: rule.category,
        start: m.index,
        end: m.index + matched.length,
        match: matched,
      })
      // Defensive: zero-width matches would loop forever.
      if (m.index === rule.pattern.lastIndex) {
        rule.pattern.lastIndex += 1
      }
    }

    rule.pattern.lastIndex = 0
    if (typeof rule.replacement === 'string') {
      const replacement = rule.replacement
      if (rule.validate) {
        const validator = rule.validate
        current = current.replace(rule.pattern, (matchStr) =>
          validator(matchStr) ? replacement : matchStr,
        )
      } else {
        current = current.replace(rule.pattern, replacement)
      }
    } else {
      const replacementFn = rule.replacement
      const validator = rule.validate
      current = current.replace(rule.pattern, (...args) => {
        // String.prototype.replace passes (match, p1, p2, ..., offset, string).
        // We re-shape to a RegExpExecArray-compatible object so the callback
        // can use `m[1]`, `m[2]`, etc. identically to the rule definitions.
        const fullMatch = args[0] as string
        if (validator && !validator(fullMatch)) return fullMatch
        const groups: string[] = []
        let i = 1
        while (typeof args[i] === 'string') {
          groups.push(args[i] as string)
          i += 1
        }
        const fauxMatch = [fullMatch, ...groups] as unknown as RegExpExecArray
        return replacementFn(fauxMatch)
      })
    }
  }

  // ---------------------------------------------------------------------------
  // PHONE pass (libphonenumber-js, not regex).
  //
  // Runs LAST, against the already-substituted `current` text, so phone parsing
  // never re-scans a span the structured rules already masked (a CF/IBAN/CRO
  // digit run can no longer be mis-parsed as a phone — it's now `<DS>`/`<IBAN>`
  // /`<CRO>`). Detections are recorded against `current` offsets — identical
  // convention to the rules above (each layer sees the previous layer's output)
  // — and matches are spliced right-to-left so earlier offsets stay valid.
  // Each DISTINCT phone number gets a NUMBERED token (`<PHONE_1>`, `<PHONE_2>`,
  // …) — same value-distinct numbering the gated Date/CAP detectors use
  // (gated_detectors.ts `detectGated`: tokenByKey map + per-category counter).
  // This replaces the legacy constant `<PHONE>`, which made every number share
  // one token and collapse to a single value on Decodifica (silent data loss).
  //
  // The dedup key is the libphonenumber E.164 `canonical`, not the raw match,
  // so the same physical number in different formats ("+39 333 111 2222" vs
  // "333 111 2222") shares one `<PHONE_n>`, while genuinely distinct numbers
  // get distinct tokens (injective pseudonym→original mapping for the reverse
  // pass). The numbered token is carried on the detection via `pseudonym`, so
  // engine.ts maps it verbatim rather than falling back to the constant mask.
  // ---------------------------------------------------------------------------
  const phoneSpans = detectPhones(current)
  const phoneTokenByCanonical = new Map<string, string>()
  let phoneCounter = 0
  // Assign tokens in source order (ascending start) so numbering is stable and
  // reads left-to-right, independent of the right-to-left splice order below.
  const phoneTokenForSpan = new Map<(typeof phoneSpans)[number], string>()
  for (const span of phoneSpans) {
    let token = phoneTokenByCanonical.get(span.canonical)
    if (token === undefined) {
      phoneCounter += 1
      token = `<PHONE_${phoneCounter}>`
      phoneTokenByCanonical.set(span.canonical, token)
    }
    phoneTokenForSpan.set(span, token)
    detections.push({
      pattern: 'PHONE',
      category: 'PHONE',
      start: span.start,
      end: span.end,
      match: span.match,
      pseudonym: token,
    })
  }
  // Splice replacements descending by start offset (right-to-left).
  for (const span of [...phoneSpans].sort((a, b) => b.start - a.start)) {
    const token = phoneTokenForSpan.get(span) ?? '<PHONE>'
    current = current.slice(0, span.start) + token + current.slice(span.end)
  }

  return { text: current, detections }
}
