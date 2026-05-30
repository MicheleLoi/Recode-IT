/**
 * phone-detector.ts — production phone-number detection backed by
 * `libphonenumber-js` (MIT, see NOTICE.md). Replaces the two Italian-only,
 * regex-only heuristics (`PHONE_IT_PREFIX_RE` + `PHONE_IT_MOBILE_RE`) that
 * recalled ~2.9% globally / ~0% outside Italy.
 *
 * WHY libphonenumber and not more regex: national number formats outside Italy
 * are not capturable by a single generic regex (variable length, country-
 * specific trunk codes, ambiguous separators). Google's libphonenumber metadata
 * encodes the per-country numbering plans; `findNumbers()` walks free text and
 * returns spans it can parse + validate. Recall is the privacy-relevant axis:
 * a missed number is PII that leaks into the "anonymized" output.
 *
 * OFFLINE / ZERO-EGRESS: libphonenumber-js parses entirely from bundled
 * metadata. No network call at runtime — confirmed by the `min` entry point
 * importing only `metadata.min.json` (static JSON, no fetch). This preserves
 * Recode-IT's browser-side, no-server privacy contract.
 *
 * defaultCountry: 'IT' — lets bare national Italian numbers ("340 123 4567",
 * "3401234567") parse as IT, while +CC / 00CC prefixed numbers from any country
 * still resolve via their explicit calling code. This is the single knob that
 * unlocks both the Italian national surface AND the international surface.
 *
 * CROSS-LOCALE FALSE POSITIVE FIX: the old `PHONE_IT_MOBILE_RE` matched the
 * bare shape `3xx-ddd-dddd`, so an internal order code "300-123-4567" was
 * indistinguishable from a mobile (eval FP `order_code`). libphonenumber's
 * validity gate (`isPossible()` + a leniency floor) rejects number-plan-invalid
 * runs. We additionally require `number.isValid()` OR an explicit international
 * prefix, which drops the order-code FP while keeping real numbers.
 */

import { findNumbers } from 'libphonenumber-js'

/** A phone span located in free text. Shape mirrors `RegexDetection` enough to
 * be folded into the regex-layer detection list by the caller. */
export interface PhoneSpan {
  start: number
  end: number
  /** The matched substring exactly as it appears in the source text. */
  match: string
  /**
   * Canonical, format-independent identity of the number (E.164, e.g.
   * "+393331112222"). Same physical number written "+39 333 111 2222" and
   * "333 111 2222" (IT default region) shares one canonical key, so the caller
   * collapses both onto a single numbered token. Falls back to the raw match
   * when libphonenumber cannot format the parsed number (defensive — should not
   * happen for a gate-passing span, which is always either intl-prefixed or
   * plan-valid).
   */
  canonical: string
}

/**
 * Detect phone numbers in `text` using libphonenumber-js with an Italian
 * default region.
 *
 * Returns spans against the ORIGINAL text offsets (caller uses them to record
 * detections and drive substitution). Overlapping/duplicate spans are not
 * produced by findNumbers for a single pass; we still de-dup defensively.
 *
 * Validity policy (recall-biased, FP-controlled):
 *   - `findNumbers` already discards runs it cannot parse to a possible number.
 *   - We KEEP a candidate when EITHER:
 *       (a) it carries an explicit international prefix (`+` or `00`), in which
 *           case the calling code disambiguates and FP risk is low; OR
 *       (b) `number.isValid()` is true under the resolved country plan.
 *     A bare national run that is merely "possible" but not "valid" (e.g. the
 *     `300-123-4567` order code, which is length-plausible but not a valid IT
 *     mobile) is dropped. This is the cross-locale substring FP fix.
 */
export function detectPhones(text: string): PhoneSpan[] {
  if (!text) return []

  // `findNumbers` with `defaultCountry` resolves bare national numbers as IT.
  // `extended: true` returns startsAt/endsAt offsets + the parsed PhoneNumber.
  // We do NOT pass a leniency that would admit pure-possible-only matches for
  // bare national runs; the per-candidate gate below enforces that instead.
  const found = findNumbers(text, {
    defaultCountry: 'IT',
    // v2: true → each match exposes `.number` (a PhoneNumber with `.isValid()`),
    // `.startsAt`, `.endsAt`. Without it, findNumbers returns the legacy shape
    // (no `.number`), so the isValid() gate below silently never fires and bare
    // national IT numbers get dropped. Required for the national surface to work.
    v2: true,
    // Match the international + national surfaces. 'POSSIBLE' lets findNumbers
    // surface candidates; our gate below decides which to keep. (Stricter
    // 'VALID' leniency would silently drop some E.164 numbers whose country
    // metadata is absent in the `min` dataset; we re-validate ourselves.)
  })

  const spans: PhoneSpan[] = []
  const seen = new Set<string>()

  for (const match of found) {
    const start = match.startsAt
    const end = match.endsAt
    const raw = text.slice(start, end)

    // Gate: explicit international prefix OR plan-valid number.
    const trimmed = raw.trimStart()
    const hasIntlPrefix = trimmed.startsWith('+') || trimmed.startsWith('00')
    const isValid = match.number?.isValid() === true
    if (!hasIntlPrefix && !isValid) {
      // Bare national run that doesn't validate under the IT plan (order codes,
      // matricole, etc.). Drop — this is the FP fix.
      continue
    }

    const key = `${start}:${end}`
    if (seen.has(key)) continue
    seen.add(key)
    // Canonical E.164 identity for value-distinct token numbering by the
    // caller. `match.number` is present (v2 + the gate above implies a parsed
    // PhoneNumber for valid/intl spans); format('E.164') normalises away
    // spacing/prefix variants of the same physical number.
    const canonical = match.number?.format('E.164') ?? raw
    spans.push({ start, end, match: raw, canonical })
  }

  return spans
}
