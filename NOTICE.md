# Third-Party Attribution

Recode-IT is released under AGPL-3.0-or-later. The codebase integrates ideas
and patterns from open-source projects under permissive or copyleft-compatible
licenses. All incorporations are facts-not-expressive-code — regex character
classes, algorithm specifications, post-match validation patterns — drawn from
their respective public-domain specifications. No expressive source code is
copied verbatim.

## Pattern sources

### IBAN separator-tolerant regex
- **Microsoft Presidio** — `microsoft/presidio` (MIT License)
- File: `src/engine/regex.ts` — `IBAN_IT_RE`
- Pattern: `(?:[\s-]?[A-Z0-9]{4}){5}[\s-]?[A-Z0-9]{3}` — 4-char grouping with
  optional whitespace/dash separators
- Use: idea + pattern shape (the 4-char-grouped IBAN documentary form is itself
  the ISO 13616 standard reading convention; Presidio is one public reference
  encoding it as a regex)

### CF omocodia character class
- **python-stdnum** — `arthurdejong/python-stdnum` (LGPL-2.1+)
- File: `src/engine/regex.ts` — `CF_RE`
- Pattern: `[0-9LMNPQRSTUV]` in the 3 substitution-eligible positions of the CF
- Use: char-class composition idea. The 10-letter mapping `LMNPQRSTUV` for
  digits `0-9` is fixed by the spec (D.M. 12 marzo 1974), not by python-stdnum
  — but python-stdnum is a public reference encoding it as a regex/validator.

### CF omocodia reverse-mapping pattern (informational, not used)
- **python-codicefiscale** — `fabiocaccamo/python-codicefiscale` (MIT License)
- Use: cross-referenced for confirming that the CEI 12-1979 checksum is
  computed on the literal (omocoded-as-is) CF rather than on the
  reverse-substituted canonical form. No code or pattern copied; conclusion is
  inherent in the public-domain INPS spec.

## Public-spec basis (no licensing required)

- **D.M. 12 marzo 1974** (decreto ministeriale italiano) — defines Italian
  Codice Fiscale structure (16-char alphanumeric encoding cognome / nome / data
  di nascita / sesso / codice catastale comune), omocodia substitution rules
  for INPS collision resolution, and the check-digit algorithm. Public-domain
  Italian government specification.
- **CEI 12-1979** (Comitato Elettrotecnico Italiano standard 12, 1979) — encodes
  the ODD/EVEN value tables used by the CF check-digit algorithm. Public-
  domain standard.
- **ISO 13616** (IBAN structure standard) — defines the IBAN MOD-97 check-digit
  algorithm and the 4-char documentary grouping convention. ISO standard,
  publicly documented in the SWIFT IBAN Registry. Algorithm specification is
  in the public domain; the registry itself is freely consultable.

## License compatibility

Recode-IT (AGPL-3.0-or-later) integrates:
- MIT-licensed *patterns* (Presidio, python-codicefiscale) — compatible with
  AGPL-3.0 (MIT is permissive and contains no patent/copyleft clauses that
  conflict with AGPL incorporation).
- LGPL-2.1+-licensed *char-class idea* (python-stdnum) — compatible with
  AGPL-3.0 incorporation. No LGPL'd code is linked or copied; the value-table
  mapping itself is set by the public-domain CEI 12-1979 spec, which python-
  stdnum encodes (the law not the encoding is what we follow).
- Public-domain *algorithm specifications* (D.M. 12 marzo 1974, CEI 12-1979,
  ISO 13616) — no licensing required.

## Mark of origin

Each pattern source is acknowledged with an inline comment in the file where it
is used (see `src/engine/regex.ts` `IBAN_IT_RE` and `CF_RE` docblocks; see
`src/engine/cf-validator.ts` and `src/engine/iban-validator.ts` algorithm
references). This document consolidates those acknowledgements for clarity and
license-compliance audit.

For questions or concerns, see `LICENSE` (AGPL-3.0-or-later) or contact the
project maintainer at the email listed in `package.json`.
