/**
 * mock-ner.ts — DEV-ONLY deterministic NER stub for the e2e-test-build branch.
 *
 * PURPOSE: make the full PSEUDONIMIZZA → substitution → Mappa → Decodifica
 * workflow exercisable on the Vite dev server WITHOUT the real ONNX model.
 *
 * The real NER path spins up a Web Worker (`src/workers/ner.worker.ts`) whose
 * dynamic import of `onnxruntime-web` + `@xenova/transformers` stalls on the
 * dev server, so the end-to-end flow cannot be reached. This module returns a
 * small fixed set of entity detections INSTANTLY, with no worker, so the rest
 * of the pipeline (regex layer, pseudonym mapping, bridge map, reverse
 * substitution, key/account flows) can be tested as input-output plumbing.
 *
 * NER QUALITY IS EXPLICITLY NOT THE POINT. This is a plumbing fixture, not a
 * model. It detects four hard-coded strings by exact `indexOf` scan.
 *
 * ACTIVATION: callers gate every reference to this module behind
 *   import.meta.env.DEV && import.meta.env.VITE_MOCK_FULL === '1'
 * Both conditions are required. A production build sets `import.meta.env.DEV`
 * to a static `false` at compile time, so the guarded branches become dead
 * code and Vite tree-shakes this entire file out of the prod bundle — exactly
 * like `mock-auth-provider.tsx`. A fake pseudonymizer must NEVER reach prod.
 *
 * REMOVAL: drop this file + revert the ner_runner.ts guard and the
 * WireframeWorkArea "Carica testo di prova" control when the dev e2e test is
 * complete. The branch mock/e2e-test-build is use-and-discard — never merge
 * to main.
 */

import type { NerDetection } from '../types/engine'

/**
 * Unique marker proving the stub (not the real worker) produced a result.
 * Surfaced to the console by {@link mockNerPredict} and exported so a verifier
 * can grep for it in the page / build to confirm whether the mock path is
 * live. Deliberately ugly + unmistakable.
 */
export const MOCK_NER_SENTINEL = '__RECODE_MOCK_NER_STUB__'

/**
 * Fixed (target, label) pairs the stub recognises. Labels are the EXACT
 * mapped-label strings the real pipeline emits — the worker's `LABEL_MAP`
 * (src/workers/ner.worker.ts) maps PER → 'persona', LOC → 'luogo',
 * ORG → 'organizzazione'. Keep these in sync with that map if it ever changes.
 */
const MOCK_TARGETS: ReadonlyArray<{ target: string; label: string }> = [
  { target: 'Mario Rossi', label: 'persona' },
  { target: 'Giuseppe Verdi', label: 'persona' },
  { target: 'Milano', label: 'luogo' },
  { target: 'Acme S.r.l.', label: 'organizzazione' },
]

/** Confidence assigned to every stub detection (NER quality is not the point). */
const MOCK_SCORE = 0.99

/**
 * Predefined Italian legal-style sample document containing all four targets.
 * Loadable with one click via the dev-only "Carica testo di prova" control in
 * `WireframeWorkArea`. 4–5 sentences; deliberately plain so the resulting
 * substitution/Decodifica round-trip is easy to eyeball.
 *
 * Targets present (and how many times each occurs, for offset-scan coverage):
 *   - "Mario Rossi"     ×2  (persona)
 *   - "Giuseppe Verdi"  ×1  (persona)
 *   - "Milano"          ×2  (luogo)
 *   - "Acme S.r.l."     ×2  (organizzazione)
 */
export const MOCK_SAMPLE_DOCUMENT = [
  'Il Tribunale di Milano ha fissato l’udienza per la causa promossa dal',
  'sig. Mario Rossi nei confronti della Acme S.r.l., con sede legale in Milano.',
  'Il ricorrente Mario Rossi, assistito dall’avv. Giuseppe Verdi, chiede',
  'la risoluzione del contratto stipulato con la Acme S.r.l. e il risarcimento',
  'dei danni patiti.',
].join(' ')

/**
 * Deterministic mock NER pass.
 *
 * For every predefined target, scans `text` with `indexOf` and emits one
 * {@link NerDetection} per occurrence (ALL occurrences), with correct
 * start/end offsets, the mapped label, the matched substring as `text`, and a
 * fixed score. Output is sorted by start offset to mirror the ordering the
 * real `NerRunner.predict()` returns (it sorts accepted spans by `a.start`).
 *
 * No worker, no async, no model — returns synchronously-computed detections.
 * The caller wraps the value in a resolved promise to match the real
 * `predict()` signature.
 *
 * @param text — the full input document (un-chunked offsets, like the real
 *   `predict()` which re-bases chunk offsets back onto the input text).
 */
export function mockNerPredict(text: string): NerDetection[] {
  const detections: NerDetection[] = []
  for (const { target, label } of MOCK_TARGETS) {
    let from = 0
    // indexOf scan → every occurrence (not just the first).
    for (;;) {
      const idx = text.indexOf(target, from)
      if (idx === -1) break
      const start = idx
      const end = idx + target.length
      detections.push({
        start,
        end,
        label,
        text: text.slice(start, end), // matched substring, mirrors worker shape
        score: MOCK_SCORE,
      })
      from = end // continue past this match (targets don't self-overlap)
    }
  }
  detections.sort((a, b) => a.start - b.start)
  // Console breadcrumb so it is obvious in DevTools that the STUB ran, not the
  // real worker. Single-arg form so single-arg console capture tools see it.
  // eslint-disable-next-line no-console
  console.log(`${MOCK_NER_SENTINEL} mockNerPredict → ${detections.length} detections`)
  return detections
}
