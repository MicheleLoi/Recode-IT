# Phone-regex accuracy eval (EVAL-ONLY)

Reproducible study of how well the **production** phone regex catches mobile
numbers across the EU/EEA and a world sample. It does **not** modify the
production regex — it imports `applyRegexRules` from `../../regex` and measures
exactly what ships.

## Run

```bash
npx vitest run src/engine/__tests__/phone_eval
```

Side effect: regenerates `results.json` (full per-case detail) and `RESULTS.md`
(human-readable tables). The run is deterministic modulo the `generatedAt`
timestamp (corpus derives from fixed library metadata + fixed render rules).

## Files

| File | Role |
| --- | --- |
| `regions.ts` | EU-27 + EEA-EFTA (30) and a 15-country world sample. |
| `corpus.ts` | Renders each country's example mobile in 7 surface formats. |
| `fp_corpus.ts` | Non-phone tokens that a loose phone regex might grab. |
| `evaluator.ts` | Applies the production regex; aggregates recall + FP. |
| `report.ts` | Renders the Markdown report. |
| `phone_regex.eval.test.ts` | vitest runner; writes artifacts; locks 2 design invariants. |
| `results.json`, `RESULTS.md` | Generated outputs (committed as the "trace"). |

## Ground-truth dependency — licence note

Ground truth is **`libphonenumber-js`** (Google libphonenumber port), added as a
**devDependency**. Licence: **MIT**.

- **Eval-only.** No production module imports it. It is used solely to generate
  *valid* example mobile numbers per country, which is the de-facto benchmark
  for phone parsing.
- **MIT → AGPL-3.0 compatibility:** MIT is a permissive licence and is
  compatible with AGPL-3.0 *were* it ever vendored into production. That is a
  separate decision (see the eval report's recommendation section); this harness
  does not make it.
