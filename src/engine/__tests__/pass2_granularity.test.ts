/**
 * pass2_granularity.test.ts — per-label granularity of the "Sostituisci anche"
 * dropdown (fix of the all-or-nothing bug).
 *
 * Founder criterio canonico `_org/decision_log.md` MHC-Work 2026-05-30
 * SID-20260530-095254 §Decisione 2: spuntare UNA voce (es. "Luoghi") deve
 * mascherare SOLO quella categoria NER (`luogo`), lasciando preservate le
 * altre (`organizzazione`, `tribunale`). Prima, `includeCategoriesPass2`
 * collassava le 3 categorie in un toggle unico.
 *
 * Le detection NER sono sintetizzate (come in extend_mode.test.ts) per girare
 * in node senza il backend WASM.
 */

import { describe, it, expect } from 'vitest'
import { anonymize } from '../engine'
import type { NerDetection } from '../../types/engine'

function det(text: string, surface: string, label: string): NerDetection {
  const start = text.indexOf(surface)
  if (start < 0) throw new Error(`fixture mismatch: '${surface}' not in text`)
  return { start, end: start + surface.length, label, text: surface, score: 0.95 }
}

const TEXT =
  'Causa radicata presso il Tribunale di Milano, parte la Acme S.r.l. con ' +
  'sede a Bologna.'

function detections(): NerDetection[] {
  return [
    det(TEXT, 'Tribunale di Milano', 'tribunale'),
    det(TEXT, 'Acme S.r.l.', 'organizzazione'),
    det(TEXT, 'Bologna', 'luogo'),
  ]
}

describe('Pass-2 per-label granularity (enabledPass2Labels)', () => {
  it('enabling ONLY "luogo" masks the place but preserves org + court', () => {
    const r = anonymize(TEXT, {
      nerDetections: detections(),
      enabledPass2Labels: new Set(['luogo']),
    })
    // Bologna substituted (no longer present).
    expect(r.pseudonymizedText).not.toContain('Bologna')
    // Court + org preserved verbatim.
    expect(r.pseudonymizedText).toContain('Tribunale di Milano')
    expect(r.pseudonymizedText).toContain('Acme S.r.l.')
    // Mapping reflects: luogo substituted, others preserved.
    const cityEntry = r.mappingEntries.find((e) => e.realValue === 'Bologna')
    expect(cityEntry?.isPreserved).not.toBe(true)
    const courtEntry = r.mappingEntries.find(
      (e) => e.realValue === 'Tribunale di Milano',
    )
    expect(courtEntry?.isPreserved).toBe(true)
  })

  it('enabling ONLY "organizzazione" masks the org but preserves place + court', () => {
    const r = anonymize(TEXT, {
      nerDetections: detections(),
      enabledPass2Labels: new Set(['organizzazione']),
    })
    expect(r.pseudonymizedText).not.toContain('Acme')
    expect(r.pseudonymizedText).toContain('Bologna')
    expect(r.pseudonymizedText).toContain('Tribunale di Milano')
  })

  it('enabling ONLY "tribunale" masks the court but preserves place + org', () => {
    const r = anonymize(TEXT, {
      nerDetections: detections(),
      enabledPass2Labels: new Set(['tribunale']),
    })
    expect(r.pseudonymizedText).not.toContain('Tribunale di Milano')
    expect(r.pseudonymizedText).toContain('Bologna')
    expect(r.pseudonymizedText).toContain('Acme S.r.l.')
  })

  it('empty set preserves all three Pass-2 categories', () => {
    const r = anonymize(TEXT, {
      nerDetections: detections(),
      enabledPass2Labels: new Set(),
    })
    expect(r.pseudonymizedText).toContain('Bologna')
    expect(r.pseudonymizedText).toContain('Tribunale di Milano')
    expect(r.pseudonymizedText).toContain('Acme S.r.l.')
  })

  it('full set substitutes all three (parity with legacy includeCategoriesPass2=true)', () => {
    const r = anonymize(TEXT, {
      nerDetections: detections(),
      enabledPass2Labels: new Set(['luogo', 'organizzazione', 'tribunale']),
    })
    expect(r.pseudonymizedText).not.toContain('Bologna')
    expect(r.pseudonymizedText).not.toContain('Acme')
    expect(r.pseudonymizedText).not.toContain('Tribunale di Milano')
  })

  it('persone are ALWAYS substituted regardless of Pass-2 selection', () => {
    const text = 'Il sig. Carlo Verdi vive a Bologna.'
    const r = anonymize(text, {
      nerDetections: [
        det(text, 'Carlo Verdi', 'persona'),
        det(text, 'Bologna', 'luogo'),
      ],
      enabledPass2Labels: new Set(), // nothing opted-in
    })
    // Person masked (flusso standard), place preserved (opt-in OFF).
    expect(r.pseudonymizedText).not.toContain('Carlo Verdi')
    expect(r.pseudonymizedText).toContain('Bologna')
  })
})

describe('Backward compat — legacy includeCategoriesPass2 boolean still works', () => {
  it('includeCategoriesPass2:false preserves all Pass-2 (no enabledPass2Labels)', () => {
    const r = anonymize(TEXT, {
      nerDetections: detections(),
      includeCategoriesPass2: false,
    })
    expect(r.pseudonymizedText).toContain('Bologna')
    expect(r.pseudonymizedText).toContain('Acme S.r.l.')
  })

  it('includeCategoriesPass2:true substitutes all Pass-2', () => {
    const r = anonymize(TEXT, {
      nerDetections: detections(),
      includeCategoriesPass2: true,
    })
    expect(r.pseudonymizedText).not.toContain('Bologna')
    expect(r.pseudonymizedText).not.toContain('Acme')
  })

  it('enabledPass2Labels takes precedence over includeCategoriesPass2', () => {
    // Granular set says "only luogo"; legacy boolean says "all". Granular wins.
    const r = anonymize(TEXT, {
      nerDetections: detections(),
      includeCategoriesPass2: true,
      enabledPass2Labels: new Set(['luogo']),
    })
    expect(r.pseudonymizedText).not.toContain('Bologna')
    expect(r.pseudonymizedText).toContain('Acme S.r.l.')
    expect(r.pseudonymizedText).toContain('Tribunale di Milano')
  })
})
