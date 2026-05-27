/**
 * iban-validator.ts — IBAN MOD-97 checksum validation (ISO 13616).
 *
 * Purpose: `IBAN_IT_RE` in `regex.ts` matches the *structure* of an Italian
 * IBAN — `IT` + 2 check digits + 23 BBAN chars (separator-tolerant since
 * Task K). Without MOD-97 verification, a perturbed-but-shaped string like
 * `IT99X0000000000000000000000` would pass the regex while being
 * mathematically invalid. `validateIBAN` plugs into `applyRegexRules` as a
 * post-match filter and rejects detections whose MOD-97 residue is not 1.
 *
 * Algorithm (ISO 13616 — publicly documented):
 *  1. Strip whitespace and dashes.
 *  2. Move the first 4 chars (country code + 2 check digits) to the end.
 *  3. Replace letters with numbers: A=10, B=11, …, Z=35.
 *  4. Compute the numeric value modulo 97. Valid IBAN ⇒ result == 1.
 *
 * BigInt is required because the numerified string can reach 70 digits for
 * the longest IBAN forms — outside `Number.MAX_SAFE_INTEGER`. Vite default
 * `target: 'modules'` supports BigInt natively in every browser shipping
 * ES2020+ (Chrome 67+, Firefox 68+, Safari 14+, Edge 79+).
 *
 * Reference (no expressive code copied — algorithm is the ISO standard):
 *  - `microsoft/presidio` (MIT) — separator-tolerance regex pattern inspiration
 *    for `IBAN_IT_RE` (`(?:[\s-]?[A-Z0-9]{4}){5}[\s-]?[A-Z0-9]{3}` 4-char
 *    grouping)
 */

/**
 * Validates the MOD-97 check digits of an IBAN per ISO 13616.
 *
 * Accepts:
 *  - canonical no-separator form (`IT60X0542811101000000123456`)
 *  - 4-char-grouped readable forms with spaces or dashes
 *    (`IT60 X054 2811 1010 0000 0123 456`,
 *    `IT60-X054-2811-1010-0000-0123-456`)
 *  - lowercase / mixed case (normalized to uppercase before computation)
 *
 * Returns `true` iff the MOD-97 residue equals 1; `false` for any other
 * input (length outside ISO bounds 15-34, non-alphanumeric chars after
 * separator stripping, or residue ≠ 1). Does NOT throw.
 *
 * Note: the country code is not validated against the public registry —
 * this is a *checksum* validator, not a country-code lookup. The caller
 * (regex pipeline) gates by country via the IT-prefixed regex pattern.
 */
export function validateIBAN(iban: string): boolean {
  if (typeof iban !== 'string') return false
  const normalized = iban.toUpperCase().replace(/[\s-]/g, '')
  // ISO 13616 length bounds: 15 chars (minimum for some country forms) up
  // to 34 chars (maximum across all registered countries).
  if (normalized.length < 15 || normalized.length > 34) return false
  if (!/^[A-Z0-9]+$/.test(normalized)) return false

  // Move first 4 chars (country code + check digits) to the end.
  const rearranged = normalized.slice(4) + normalized.slice(0, 4)
  // Numerify: A→10, B→11, …, Z→35 (ASCII 'A'=65, so c-55).
  let numerified = ''
  for (const c of rearranged) {
    if (c >= '0' && c <= '9') {
      numerified += c
    } else {
      // c is uppercase A-Z (guaranteed by the regex above).
      numerified += (c.charCodeAt(0) - 55).toString()
    }
  }

  try {
    return BigInt(numerified) % 97n === 1n
  } catch {
    // Defensive: BigInt() throws on malformed input. Should be unreachable
    // given the regex guard above, but we never throw from a validator.
    return false
  }
}
