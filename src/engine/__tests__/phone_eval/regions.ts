/**
 * regions.ts — country groupings for the phone-regex accuracy eval.
 *
 * EVAL-ONLY. Not imported by production code. Drives `corpus.ts`, which uses
 * `libphonenumber-js` (MIT, devDependency, eval-only) example mobile numbers
 * as ground truth.
 *
 * Groupings:
 *  - EU_EEA: the 27 EU member states + the 3 EEA-EFTA states (IS, LI, NO).
 *    This is the MANDATORY coverage surface per the founder's question
 *    ("tutta l'UE/SEE").
 *  - WORLD_SAMPLE: a representative non-EU sample (UK, CH, US, plus large /
 *    structurally-diverse dialing plans) for the "idealmente mondiale" ask.
 *
 * ISO 3166-1 alpha-2 codes; libphonenumber-js keys on these.
 */

export type Region = 'EU_EEA' | 'WORLD_SAMPLE'

/** EU-27 + EEA-EFTA (IS, LI, NO). 30 countries. */
export const EU_EEA: string[] = [
  // EU-27
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
  'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  // EEA-EFTA
  'IS', 'LI', 'NO',
]

/**
 * Non-EU world sample. UK + CH called out explicitly by the founder; US as the
 * other dominant plan; the rest chosen for structural diversity (variable-length
 * national numbers, leading-zero trunk codes, long country codes, etc.).
 */
export const WORLD_SAMPLE: string[] = [
  'GB', // United Kingdom — 07xxx mobile, +44
  'CH', // Switzerland — 07x, +41 (founder home jurisdiction)
  'US', // United States — NANP (201) 555-xxxx, +1
  'CA', // Canada — NANP sibling of US (same +1, different parsing)
  'AU', // Australia — 04xx mobile, +61
  'JP', // Japan — 090/080, +81
  'BR', // Brazil — 11-9xxxx, +55
  'IN', // India — 10-digit, +91
  'CN', // China — 1xx, +86
  'RU', // Russia — 9xx, +7 (long national)
  'ZA', // South Africa — +27
  'AE', // United Arab Emirates — +971
  'MX', // Mexico — +52
  'NG', // Nigeria — +234
  'TR', // Türkiye — +90
]

export const REGION_OF: Record<string, Region> = Object.fromEntries([
  ...EU_EEA.map((c) => [c, 'EU_EEA'] as const),
  ...WORLD_SAMPLE.map((c) => [c, 'WORLD_SAMPLE'] as const),
])

export const ALL_COUNTRIES: string[] = [...EU_EEA, ...WORLD_SAMPLE]
