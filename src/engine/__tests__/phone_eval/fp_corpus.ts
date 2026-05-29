/**
 * fp_corpus.ts — false-positive probes for the phone-regex eval.
 *
 * EVAL-ONLY. Each entry is a non-phone token that a naive phone regex might
 * grab. The eval asserts the production regex emits ZERO `PHONE` detections on
 * these. (Other categories — IBAN/CF/etc. — are allowed to fire; we only count
 * PHONE-category hits as phone false positives.)
 */

export interface FpCase {
  label: string
  text: string
  /** Why this is a plausible phone false positive. */
  rationale: string
}

export const FP_CASES: FpCase[] = [
  {
    label: 'iban_it',
    text: 'Bonifico su IT60X0542811101000000123456 entro il 30.',
    rationale: 'IBAN: long digit+alpha run, contains 3xx-like substrings',
  },
  {
    label: 'cf_persona',
    text: 'Il codice fiscale RSSMRA70B03A662E del ricorrente.',
    rationale: 'CF: 16 alphanumerics, digit groups could look phone-ish',
  },
  {
    label: 'cf_numeric',
    text: 'C.F. 12345678901 della societa.',
    rationale: '11-digit company CF — same digit count as some national numbers',
  },
  {
    label: 'long_date',
    text: 'Sentenza depositata il 12/08/2024 alle ore 15:30.',
    rationale: 'Date with slashes/colon — digit groups',
  },
  {
    label: 'date_extended',
    text: 'Nato il 03 marzo 1984 a Milano, residente dal 2009.',
    rationale: 'Year runs that a loose \\d{4} phone rule might catch',
  },
  {
    label: 'order_code',
    text: 'Ordine n. 300-123-4567 evaso (codice articolo interno).',
    rationale:
      'CRITICAL: matches PHONE_IT_MOBILE_RE shape 3xx-ddd-dddd exactly — '
      + 'an internal order code starting 300 is indistinguishable from a mobile',
  },
  {
    label: 'cap_and_amounts',
    text: 'Importo 1.234.567,89 euro — CAP 20121 Milano.',
    rationale: 'Thousands separators + postal code',
  },
  {
    label: 'protocol',
    text: 'Prot. n. MI/2024/001 del fascicolo.',
    rationale: 'Protocol number with alpha prefix',
  },
  {
    label: 'cro',
    text: 'CRO: 1234567890123 accredito.',
    rationale: '13-digit bank reference',
  },
  {
    label: 'plain_long_digits',
    text: 'Matricola dipendente 30012345678 verificata.',
    rationale: '11 bare digits, no separators — should NOT match (no prefix)',
  },
  {
    label: 'isbn_like',
    text: 'Riferimento bibliografico 978-3-16-148410-0 in nota.',
    rationale: 'ISBN with dashes — dash-grouped digit runs',
  },
  {
    label: 'time_range',
    text: 'Udienza 09:00-12:30, ripresa 14:00.',
    rationale: 'Time groups with colon/dash',
  },
]
