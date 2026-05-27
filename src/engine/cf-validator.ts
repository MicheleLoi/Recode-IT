/**
 * cf-validator.ts — CF (Codice Fiscale) check-digit validation.
 *
 * Algoritmo CEI 12-1979 / D.M. 12 marzo 1974 (spec public domain).
 *
 * Purpose: the `CF_RE` in `regex.ts` matches the *structure* of a CF — 6 letters,
 * 2 digits, month letter, 2 digits, letter, 3 digits, letter — but the 16th char
 * is a deterministic check digit derived from the first 15. Without checksum
 * verification, syntactically-shaped tokens like `ABCDEF12G34H567I` would be
 * reported as CFs (false positives). `validateCF` plugs into `applyRegexRules`
 * as a post-match filter and rejects detections whose 16th character does NOT
 * match the spec-derived checksum.
 *
 * Omocodia: when 2+ persons would collide on the same canonical CF, INPS
 * substitutes specific digits with letters (0→L, 1→M, 2→N, 3→P, 4→Q, 5→R,
 * 6→S, 7→T, 8→U, 9→V) in the three substitution-eligible positions (year, day,
 * city code). The check digit is recomputed on the *literal* (omocoded) form —
 * NOT on the reverse-substituted canonical form. python-stdnum's
 * `stdnum/it/codicefiscale.py` validates as-is, matching INPS production
 * behaviour. The omocoded CF is its own valid CF with its own check digit.
 *
 * Spec sources (public domain):
 *  - D.M. 12 marzo 1974 — Italian ministerial decree defining CF structure +
 *    omocodia mapping rules
 *  - CEI 12-1979 — Italian Electrotechnical Committee standard, encodes the
 *    ODD/EVEN value tables verbatim
 *
 * Char-class idea credited to `arthurdejong/python-stdnum` (LGPL-2.1+) — the
 * code below does not copy expressive code, only the fact-not-expression
 * value-table mapping which is itself defined by the public-domain spec.
 * See NOTICE.md.
 */

/**
 * ODD position values (positions 1, 3, 5, 7, 9, 11, 13, 15 — counted from 1).
 * Public domain — CEI 12-1979 § "Tabella valori dispari".
 */
const ODD_VALUES: Readonly<Record<string, number>> = Object.freeze({
  '0': 1, '1': 0, '2': 5, '3': 7, '4': 9,
  '5': 13, '6': 15, '7': 17, '8': 19, '9': 21,
  'A': 1, 'B': 0, 'C': 5, 'D': 7, 'E': 9,
  'F': 13, 'G': 15, 'H': 17, 'I': 19, 'J': 21,
  'K': 2, 'L': 4, 'M': 18, 'N': 20, 'O': 11,
  'P': 3, 'Q': 6, 'R': 8, 'S': 12, 'T': 14,
  'U': 16, 'V': 10, 'W': 22, 'X': 25, 'Y': 24, 'Z': 23,
})

/**
 * EVEN position values (positions 2, 4, 6, 8, 10, 12, 14 — counted from 1).
 * Public domain — CEI 12-1979 § "Tabella valori pari" (identità: '0'..'9' →
 * 0..9, 'A'..'Z' → 0..25).
 */
const EVEN_VALUES: Readonly<Record<string, number>> = Object.freeze({
  '0': 0, '1': 1, '2': 2, '3': 3, '4': 4,
  '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  'A': 0, 'B': 1, 'C': 2, 'D': 3, 'E': 4,
  'F': 5, 'G': 6, 'H': 7, 'I': 8, 'J': 9,
  'K': 10, 'L': 11, 'M': 12, 'N': 13, 'O': 14,
  'P': 15, 'Q': 16, 'R': 17, 'S': 18, 'T': 19,
  'U': 20, 'V': 21, 'W': 22, 'X': 23, 'Y': 24, 'Z': 25,
})

/** Letters that may appear in the omocoded substitution positions
 * (and which the regex now admits). Exported for use in the validator's
 * char-class sanity check. */
export const OMOCODIA_LETTERS = 'LMNPQRSTUV'

/**
 * Validates the 16th character of an Italian fiscal code (Codice Fiscale)
 * against the CEI 12-1979 / D.M. 12 marzo 1974 checksum algorithm.
 *
 * Accepts:
 *  - canonical 16-char form (`RSSMRA70B03A662E`)
 *  - lowercase / mixed case (`rssmra70b03a662e`)
 *  - whitespace-separated readable forms (`RSS MRA 70B03 A662E`,
 *    `RSSMRA 70B03 A662E`) — whitespace is stripped before validation
 *  - omocoded forms (digit→letter substitutions in positions 7-8, 10-11,
 *    13-15) — validates as-is, matching INPS production behaviour
 *
 * Returns `true` iff the supplied 16th character equals the spec-derived
 * check digit; `false` for any other input (wrong length, invalid character,
 * checksum mismatch). Does NOT throw.
 */
export function validateCF(cf: string): boolean {
  if (typeof cf !== 'string') return false
  const normalized = cf.toUpperCase().replace(/\s+/g, '')
  if (normalized.length !== 16) return false
  // Defensive: reject any non-alphanumeric char (CF is strict A-Z 0-9 only).
  if (!/^[A-Z0-9]{16}$/.test(normalized)) return false

  let sum = 0
  for (let i = 0; i < 15; i++) {
    const c = normalized[i]!
    // Position 1-indexed: odd positions use ODD table, even positions use EVEN.
    const isOdd = (i + 1) % 2 === 1
    const value = isOdd ? ODD_VALUES[c] : EVEN_VALUES[c]
    if (value === undefined) return false
    sum += value
  }
  const expected = String.fromCharCode('A'.charCodeAt(0) + (sum % 26))
  return normalized[15] === expected
}
