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

type ReplacementFn = (match: RegExpExecArray) => string
type Replacement = string | ReplacementFn

export type RegexRule = {
  category: string
  pattern: RegExp
  replacement: Replacement
}

// ---------------------------------------------------------------------------
// Individual patterns — exported as named consts for direct testing.
// ---------------------------------------------------------------------------

/** Persona CF — 16-char alphanumeric. Case-insensitive (OCR / lowercase). */
export const CF_RE =
  /\b[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]\b/gi

/** Persona CF tolerant of internal whitespace (OCR artefact). */
export const CF_WS_RE =
  /\b[A-Z]{6}\s+[0-9]{2}[A-Z][0-9]{2}\s+[A-Z][0-9]{3}[A-Z]\b/gi

/** CF azienda con prefisso esplicito "C.F." / "CF:". */
export const CF_NUM_RE = /(C\.?\s*F\.?\s*:?\s*)(\d{11})/gi

/** CF azienda con prefisso "Cod. Fisc." / "Codice Fiscale". */
export const CF_NUM_LONG_RE =
  /((?:Cod(?:ice)?\.?\s*Fisc(?:ale)?\.?)\s*:?\s*)(\d{11})/gi

/** P.IVA — covers "P. IVA", "PIVA", "Partita IVA" variants. */
export const PIVA_RE =
  /((?:P\.?\s*IVA\s*|PIVA\s*|Partita\s+IVA\s*):?\s*)(\d{11})/gi

/** IBAN IT — 27 chars total, IT prefix + 2 check digits + 23 alphanumeric. */
export const IBAN_IT_RE = /\bIT\d{2}[A-Z0-9]{23}\b/g

/** CRO bancario — 13 digits following "CRO". */
export const CRO_RE = /(CRO:?\s*)(\d{13})/gi

/** Numero di protocollo — "prot. n. MI/2024/001" and similar. */
export const PROT_RE =
  /(prot\.?\s*(?:n\.?\s*)?)([A-Z]{2,}\/\d{4}\/\d{3,})/gi

/** Email / PEC. */
export const EMAIL_RE = /\b[\w.+-]+@[\w.-]+\.\w{2,}\b/g

/**
 * Telefono italiano con prefisso internazionale esplicito (+39 o 0039).
 * High precision: il prefisso è il segnale univoco. Accetta separatori
 * comuni (spazio, punto, dash) fra i gruppi di cifre. 9-15 cifre totali
 * post-prefisso (copre mobile + fisso italiano).
 */
export const PHONE_IT_PREFIX_RE =
  /(?:\+39|0039)\s?\d[\d\s.-]{7,13}\d\b/g

/**
 * Telefono mobile italiano formattato (3xx prefisso + separatore). Il
 * separatore obbligatorio (spazio/punto/dash) controlla i falsi positivi:
 * "3001234567" come stringa nuda non matcha; "300 123 4567" sì.
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
  { category: 'CF', pattern: CF_RE, replacement: '<DS>' },
  { category: 'CF', pattern: CF_WS_RE, replacement: '<DS>' },
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
  { category: 'IBAN', pattern: IBAN_IT_RE, replacement: '<IBAN>' },
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
  { category: 'PHONE', pattern: PHONE_IT_PREFIX_RE, replacement: '<PHONE>' },
  { category: 'PHONE', pattern: PHONE_IT_MOBILE_RE, replacement: '<PHONE>' },
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
    // previous one).
    rule.pattern.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = rule.pattern.exec(current)) !== null) {
      detections.push({
        pattern: rule.category,
        category: rule.category,
        start: m.index,
        end: m.index + m[0].length,
        match: m[0],
      })
      // Defensive: zero-width matches would loop forever.
      if (m.index === rule.pattern.lastIndex) {
        rule.pattern.lastIndex += 1
      }
    }

    rule.pattern.lastIndex = 0
    if (typeof rule.replacement === 'string') {
      const replacement = rule.replacement
      current = current.replace(rule.pattern, replacement)
    } else {
      const replacementFn = rule.replacement
      current = current.replace(rule.pattern, (...args) => {
        // String.prototype.replace passes (match, p1, p2, ..., offset, string).
        // We re-shape to a RegExpExecArray-compatible object so the callback
        // can use `m[1]`, `m[2]`, etc. identically to the rule definitions.
        const fullMatch = args[0] as string
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

  return { text: current, detections }
}
