/**
 * regression_substitution_offset_20260518.test.ts — regression gate for the
 * substitution-offset bug surfaced by the founder's acceptance test on
 * 2026-05-18 against `test-fixtures/registro_anagrafico_dimostrativo.txt`.
 *
 * Symptom observed in production:
 *   - "Marco Bellini" pseudonym ("Tizio") was injected INSIDE the 16-char
 *     codice fiscale token in the output, producing strings like
 *     `BLL MRC 7TizioEMAIL>+39 347 551 2093`.
 *   - "Giulia Ferraro" pseudonym ("Caia") landed at mid-telephone:
 *     `<EMAIL>+3Caia`.
 *   - "Davide Conti" pseudonym ("Sempronio") was injected inside the
 *     preserved street name "Corso Levante" (toggle β OFF by default):
 *     `Corso LevSempronio33 Palermo`.
 *
 * Root cause: NER detections carry offsets into the ORIGINAL text, but the
 * engine applies them to the post-regex text (after CFs have been
 * shrunk from 16 chars to "<DS>" = 4 chars, after emails have been shrunk
 * from `name@host.it` to `<EMAIL>`, etc.). Every regex substitution shifts
 * downstream offsets by `(replacement.length - match.length)`. Applying a
 * raw NER offset to a shifted text writes the pseudonym at the wrong
 * column — almost always landing inside an adjacent token.
 *
 * Fix gate: detections from the NER layer must be re-anchored against the
 * post-regex text BEFORE the substitution loop runs. This test reproduces
 * the failure with hand-crafted detections (since the real NER is mocked in
 * unit tests) and asserts the post-fix behaviour:
 *   (a) the chosen pseudonym replaces the original name verbatim;
 *   (b) regex masks (`<DS>`, `<EMAIL>`) are intact, never bisected;
 *   (c) preserved addresses (toggle β OFF) survive verbatim in the output;
 *   (d) no pseudonym appears inside another token.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { anonymize } from '../engine'
import type { NerDetection } from '../../types/engine'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = resolve(
  HERE,
  '../../..',
  'test-fixtures/registro_anagrafico_dimostrativo.txt',
)

function loadFixture(): string {
  return readFileSync(FIXTURE_PATH, 'utf-8')
}

/**
 * Build NER detections referencing positions in the ORIGINAL text — the exact
 * shape `NerRunner.predict()` returns. The engine is responsible for
 * re-anchoring them against the post-regex text before substituting.
 */
function buildDetections(text: string): NerDetection[] {
  const names = [
    'Alessia Rinaldi',
    'Marco Bellini',
    'Giulia Ferraro',
    'Davide Conti',
  ]
  const places = ['Milano', 'Torino', 'Napoli', 'Palermo']
  const streets = [
    'Via Roma',
    'Via Garibaldi',
    'Piazza Dante',
    'Corso Levante',
  ]
  const dets: NerDetection[] = []
  for (const name of names) {
    const idx = text.indexOf(name)
    if (idx < 0) continue
    dets.push({
      start: idx,
      end: idx + name.length,
      label: 'persona',
      text: name,
      score: 0.95,
    })
  }
  for (const place of places) {
    const idx = text.indexOf(place)
    if (idx < 0) continue
    dets.push({
      start: idx,
      end: idx + place.length,
      label: 'luogo',
      text: place,
      score: 0.9,
    })
  }
  for (const street of streets) {
    const idx = text.indexOf(street)
    if (idx < 0) continue
    dets.push({
      start: idx,
      end: idx + street.length,
      label: 'luogo',
      text: street,
      score: 0.9,
    })
  }
  return dets
}

describe('Regression: substitution offset alignment (founder fixture 2026-05-18)', () => {
  it('applies each person pseudonym verbatim at the name position (no offset drift)', () => {
    const text = loadFixture()
    const detections = buildDetections(text)
    const result = anonymize(text, {
      nerDetections: detections,
      // Default behaviour: toggle β OFF, places/orgs/courts are preserved.
      includeCategoriesPass2: false,
    })
    const out = result.pseudonymizedText

    // For every original name we expect:
    //   (a) the original surface no longer appears,
    //   (b) the allocated pseudonym DOES appear,
    //   (c) the pseudonym is NEVER welded to an adjacent token: it must be
    //       flanked by whitespace, line breaks, or punctuation.
    for (const name of [
      'Alessia Rinaldi',
      'Marco Bellini',
      'Giulia Ferraro',
      'Davide Conti',
    ]) {
      const entry = result.mappingEntries.find((e) => e.realValue === name)
      expect(entry, `missing mapping entry for ${name}`).toBeDefined()
      const pseudo = entry!.pseudonym
      expect(out, `original "${name}" leaked into output`).not.toContain(name)
      expect(out, `pseudonym "${pseudo}" for ${name} not in output`).toContain(
        pseudo,
      )
      // The pseudonym must sit between non-alphanumeric chars (so it isn't
      // wedged inside a CF / telephone / email token). Use Unicode word
      // boundaries via regex on the rendered text.
      const idx = out.indexOf(pseudo)
      const before = idx > 0 ? out[idx - 1] : ' '
      const after =
        idx + pseudo.length < out.length ? out[idx + pseudo.length] : ' '
      // "before" can be a space, newline, or " " — never a digit/letter that
      // would indicate the pseudonym was glued to another token.
      expect(
        before && !/[A-Za-z0-9]/.test(before),
        `pseudonym ${pseudo} for ${name} is glued to "${before}" on the left → offset drift`,
      ).toBe(true)
      expect(
        after && !/[A-Za-z0-9]/.test(after),
        `pseudonym ${pseudo} for ${name} is glued to "${after}" on the right → offset drift`,
      ).toBe(true)
    }
  })

  it('regex masks (<DS>, <EMAIL>) are intact and never bisected by an injected pseudonym', () => {
    const text = loadFixture()
    const detections = buildDetections(text)
    const result = anonymize(text, {
      nerDetections: detections,
      includeCategoriesPass2: false,
    })
    const out = result.pseudonymizedText

    // 4 codici fiscali in the fixture → 4 <DS> masks (regex layer).
    const dsCount = (out.match(/<DS>/g) ?? []).length
    expect(dsCount).toBe(4)

    // 4 emails → 4 <EMAIL> masks.
    const emailCount = (out.match(/<EMAIL>/g) ?? []).length
    expect(emailCount).toBe(4)

    // No partial mask shapes: substrings like "<D" or "DS>" should appear ONLY
    // as part of a clean "<DS>" / "<EMAIL>". The simplest invariant: there
    // are no opening "<" without matching ">" in the same line.
    const stray = out.match(/<[A-Z.]+(?![A-Z.]*>)/g)
    expect(stray, `stray bisected mask fragments: ${stray}`).toBeNull()

    // None of the allocated pseudonyms should appear inside the mask windows.
    // Build a regex that scans for ANY pseudonym wedged inside "<...>".
    const personPseudos = result.mappingEntries
      .filter((e) => e.category === 'persona')
      .map((e) => e.pseudonym)
    for (const p of personPseudos) {
      // The pseudonym must never appear adjacent to a "<" or ">" with no
      // whitespace between — that would be the signature of the offset bug.
      const wedged = new RegExp(`<[^>]*${p}[^<]*>`)
      expect(
        wedged.test(out),
        `pseudonym ${p} is wedged inside a mask: ${out.match(wedged)?.[0]}`,
      ).toBe(false)
    }
  })

  it('preserved street addresses (toggle β OFF) survive verbatim in the output text', () => {
    const text = loadFixture()
    const detections = buildDetections(text)
    const result = anonymize(text, {
      nerDetections: detections,
      includeCategoriesPass2: false,
    })
    const out = result.pseudonymizedText

    // With toggle β OFF, all four streets must appear verbatim — no
    // pseudonym injected inside them.
    for (const street of [
      'Via Roma 12',
      'Via Garibaldi 5',
      'Piazza Dante 18',
      'Corso Levante 33',
    ]) {
      expect(out, `preserved street "${street}" was modified`).toContain(street)
    }

    // Same for the four city names.
    for (const city of ['Milano', 'Torino', 'Napoli', 'Palermo']) {
      expect(out, `preserved city "${city}" was modified`).toContain(city)
    }
  })

  it('telephone numbers stay intact (no pseudonym wedged between digits)', () => {
    const text = loadFixture()
    const detections = buildDetections(text)
    const result = anonymize(text, {
      nerDetections: detections,
      includeCategoriesPass2: false,
    })
    const out = result.pseudonymizedText

    // All four phone numbers (regex doesn't cover phones in Recode-IT today,
    // so they pass through verbatim) must appear unmodified.
    for (const phone of [
      '+39 340 123 4567',
      '+39 347 551 2093',
      '+39 333 998 7766',
      '+39 348 222 1100',
    ]) {
      expect(out, `phone "${phone}" was modified`).toContain(phone)
    }
  })
})
