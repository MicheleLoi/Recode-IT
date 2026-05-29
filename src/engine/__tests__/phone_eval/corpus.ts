/**
 * corpus.ts — generates the phone-number eval corpus from libphonenumber-js
 * ground truth.
 *
 * EVAL-ONLY. `libphonenumber-js` (MIT) is a devDependency used solely to
 * produce *valid* mobile numbers per country; it is the de-facto benchmark for
 * phone parsing. No production module imports this file.
 *
 * For each country we take the canonical example MOBILE number and render it in
 * several realistic surface forms a user might paste into a legal document:
 *
 *   e164            +393123456789                 (machine form)
 *   intl_spaced     +39 312 345 6789              (formatInternational)
 *   intl_00         0039 312 345 6789             (00 trunk instead of +)
 *   national        312 345 6789                  (formatNational)
 *   national_plain  3123456789                    (no separators)
 *   national_dots   312.345.6789                  (dot separators)
 *   national_dash   312-345-6789                  (dash separators, where it
 *                                                  differs from national)
 *
 * Each generated case records the country, region, format label, the raw
 * rendered phone string, and a sentence embedding it (so word-boundary and
 * surrounding-text effects are exercised, matching real documents).
 */

import { getExampleNumber, type CountryCode } from 'libphonenumber-js'
import mobileExamples from 'libphonenumber-js/mobile/examples'
import { ALL_COUNTRIES, REGION_OF, type Region } from './regions'

export type PhoneFormat =
  | 'e164'
  | 'intl_spaced'
  | 'intl_00'
  | 'national'
  | 'national_plain'
  | 'national_dots'
  | 'national_dash'

export interface PhoneCase {
  country: string
  region: Region
  format: PhoneFormat
  /** The bare phone string as rendered. */
  phone: string
  /** A sentence with the phone embedded (real-document context). */
  sentence: string
  /** E.164 canonical, for de-dup / reference. */
  e164: string
}

/** Strip every non-digit, keep a single leading + if present. */
function digitsOnly(s: string): string {
  const plus = s.trimStart().startsWith('+') ? '+' : ''
  return plus + s.replace(/\D/g, '')
}

/** Replace the inter-group separators of `formatNational` with `sep`. */
function reSeparate(national: string, sep: string): string {
  // formatNational uses spaces (and sometimes parens / leading 0 trunk).
  // Normalise runs of spaces to the chosen separator; leave parens intact
  // for NANP so we still test the "(201) 555-0123" shape under `national`.
  return national.replace(/\s+/g, sep)
}

function embed(country: string, phone: string): string {
  // Vary the carrier word so the corpus isn't trivially uniform; none of these
  // words are required by the production regex (PHONE_IT_MOBILE_RE matches on
  // shape, PHONE_IT_PREFIX_RE on the +39/0039 prefix), so the embedding is
  // pure realistic noise, not a crutch.
  return `Recapito del cliente (${country}): ${phone} — confermato in udienza.`
}

export function buildCorpus(): PhoneCase[] {
  const cases: PhoneCase[] = []

  for (const country of ALL_COUNTRIES) {
    const ex = getExampleNumber(country as CountryCode, mobileExamples)
    if (!ex) continue // no mobile example in metadata; skip (rare)

    const region = REGION_OF[country] as Region
    const e164 = ex.number // +CC...
    const intlSpaced = ex.formatInternational() // +CC ddd dddd
    const national = ex.formatNational() // ddd dddd (country-local)
    const intl00 = '00' + e164.slice(1) // 00CC... no spaces
    const intl00Spaced = intlSpaced.replace(/^\+/, '00')
    const nationalPlain = digitsOnly(national).replace(/^\+/, '')
    const nationalDots = reSeparate(national, '.')
    const nationalDash = reSeparate(national, '-')

    const variants: Array<[PhoneFormat, string]> = [
      ['e164', e164],
      ['intl_spaced', intlSpaced],
      ['intl_00', intl00Spaced.length > intl00.length ? intl00Spaced : intl00],
      ['national', national],
      ['national_plain', nationalPlain],
      ['national_dots', nationalDots],
      ['national_dash', nationalDash],
    ]

    // De-dup identical renderings (e.g. national == national_dash when the
    // example has no internal separator to swap).
    const seen = new Set<string>()
    for (const [format, phone] of variants) {
      if (!phone || seen.has(phone)) continue
      seen.add(phone)
      cases.push({
        country,
        region,
        format,
        phone,
        sentence: embed(country, phone),
        e164,
      })
    }
  }

  return cases
}
