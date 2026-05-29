/**
 * phone_regex.eval.test.ts — reproducible accuracy eval for the production
 * phone regex, packaged as a vitest test so it runs via the existing toolchain
 * (`npx vitest run src/engine/__tests__/phone_eval`).
 *
 * EVAL-ONLY. Does NOT modify the production regex. Side effect: writes
 * `results.json` + `RESULTS.md` next to this file so the run "leaves a trace".
 *
 * The assertions are intentionally LOOSE — this is a measurement harness, not a
 * spec. They exist only to (a) prove the corpus is non-empty and the production
 * import is wired, and (b) lock the two things the regex was actually DESIGNED
 * to do (catch +39/0039-prefixed numbers, and not fire on a German IBAN). Any
 * regression in those two would be a real bug; everything else is reported as a
 * number, not enforced.
 */

import { describe, it, expect } from 'vitest'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { runEval } from './evaluator'
import { renderMarkdown } from './report'

const HERE = dirname(fileURLToPath(import.meta.url))

describe('phone regex accuracy eval (EVAL-ONLY, no production change)', () => {
  const report = runEval()

  it('writes results.json + RESULTS.md trace artifacts', () => {
    // Trim per-case detail out of the .json a touch? No — keep full detail for
    // reproducibility / auditing; it is small (hundreds of rows).
    writeFileSync(
      join(HERE, 'results.json'),
      JSON.stringify(report, null, 2),
      'utf8',
    )
    writeFileSync(join(HERE, 'RESULTS.md'), renderMarkdown(report), 'utf8')

    // eslint-disable-next-line no-console
    console.log(
      `\n[phone-eval] corpus=${report.corpusSize} | ` +
        `GLOBAL recall=${(report.global.recall * 100).toFixed(1)}% | ` +
        `EU/EEA=${(report.byRegion.EU_EEA.recall * 100).toFixed(1)}% | ` +
        `world=${(report.byRegion.WORLD_SAMPLE.recall * 100).toFixed(1)}% | ` +
        `FP clean=${report.fp.clean}/${report.fp.total}\n`,
    )
    expect(report.corpusSize).toBeGreaterThan(100)
  })

  it('the corpus actually covers the EU/EEA surface (>=29 cases)', () => {
    // Every EU/EEA country contributes multiple rendered cases; the total must
    // comfortably exceed the 30-country count.
    expect(report.byRegion.EU_EEA.total).toBeGreaterThan(29)
  })

  it('DESIGN INVARIANT: Italian +39 / 0039-prefixed mobiles are caught', () => {
    // This is the documented purpose of PHONE_IT_PREFIX_RE. If this breaks, the
    // regex regressed.
    const itPrefixCases = report.cases.filter(
      (c) =>
        c.country === 'IT' &&
        (c.format === 'e164' || c.format === 'intl_spaced' || c.format === 'intl_00'),
    )
    expect(itPrefixCases.length).toBeGreaterThan(0)
    for (const c of itPrefixCases) {
      expect(c.hit, `IT ${c.format} "${c.phone}" should be caught`).toBe(true)
    }
  })

  it('DESIGN INVARIANT: no PHONE false positive on a German IBAN', () => {
    const ibanProbe = report.fp.falsePositives.find((f) => f.label === 'iban_it')
    expect(ibanProbe, 'IBAN must not produce a PHONE false positive').toBeUndefined()
  })
})
