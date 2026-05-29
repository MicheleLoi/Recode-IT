/**
 * evaluator.ts — runs the PRODUCTION regex against the eval corpus and
 * aggregates recall + false positives.
 *
 * EVAL-ONLY. The point of indirection is deliberate: this file imports
 * `applyRegexRules` from the real engine (`../../regex`), so the eval measures
 * exactly what ships — no reimplementation, no drift.
 *
 * A case counts as a HIT iff `applyRegexRules` produced at least one detection
 * whose `category === 'PHONE'` AND whose matched span overlaps the phone token
 * inside the sentence. (We embed phones in sentences, so we check overlap, not
 * whole-string equality.)
 */

import { applyRegexRules } from '../../regex'
import { buildCorpus, type PhoneCase, type PhoneFormat } from './corpus'
import { FP_CASES, type FpCase } from './fp_corpus'
import type { Region } from './regions'

export interface CaseResult extends PhoneCase {
  hit: boolean
  /** The matched substring(s) of any PHONE detection, for inspection. */
  phoneMatches: string[]
}

export interface Bucket {
  total: number
  hits: number
  recall: number
}

export interface PhoneFpResult extends FpCase {
  /** PHONE-category matches the regex wrongly produced (empty = clean). */
  falseMatches: string[]
  clean: boolean
}

export interface EvalReport {
  generatedAt: string
  corpusSize: number
  global: Bucket
  byRegion: Record<Region, Bucket>
  byFormat: Record<PhoneFormat, Bucket>
  byCountry: Record<string, Bucket>
  /** All misses, for the "concrete examples" section. */
  misses: CaseResult[]
  /** Full per-case detail (for results.json; trimmed in the .md). */
  cases: CaseResult[]
  fp: {
    total: number
    clean: number
    falsePositives: PhoneFpResult[]
  }
}

function phoneDetections(text: string): { match: string; start: number; end: number }[] {
  const { detections } = applyRegexRules(text)
  return detections
    .filter((d) => d.category === 'PHONE')
    .map((d) => ({ match: d.match, start: d.start, end: d.end }))
}

/** Locate the phone substring inside the sentence; overlap test for a hit. */
function spanOf(sentence: string, phone: string): [number, number] {
  const i = sentence.indexOf(phone)
  return i < 0 ? [-1, -1] : [i, i + phone.length]
}

function overlaps(a: [number, number], b: [number, number]): boolean {
  if (a[0] < 0 || b[0] < 0) return false
  return a[0] < b[1] && b[0] < a[1]
}

function emptyBucket(): Bucket {
  return { total: 0, hits: 0, recall: 0 }
}

function bump(b: Bucket, hit: boolean) {
  b.total += 1
  if (hit) b.hits += 1
  b.recall = b.total === 0 ? 0 : b.hits / b.total
}

export function runEval(): EvalReport {
  const corpus = buildCorpus()
  const cases: CaseResult[] = []
  const misses: CaseResult[] = []

  const global = emptyBucket()
  const byRegion: Record<string, Bucket> = {}
  const byFormat: Record<string, Bucket> = {}
  const byCountry: Record<string, Bucket> = {}

  for (const c of corpus) {
    // Evaluate against the embedded sentence (real-document context), not the
    // bare token — exercises word boundaries and surrounding text.
    const dets = phoneDetections(c.sentence)
    const phoneSpan = spanOf(c.sentence, c.phone)
    const matchingDets = dets.filter((d) => overlaps([d.start, d.end], phoneSpan))
    const hit = matchingDets.length > 0

    const cr: CaseResult = {
      ...c,
      hit,
      phoneMatches: matchingDets.map((d) => d.match),
    }
    cases.push(cr)
    if (!hit) misses.push(cr)

    bump(global, hit)
    bump((byRegion[c.region] ??= emptyBucket()), hit)
    bump((byFormat[c.format] ??= emptyBucket()), hit)
    bump((byCountry[c.country] ??= emptyBucket()), hit)
  }

  // False positives.
  const fpResults: PhoneFpResult[] = FP_CASES.map((fp) => {
    const dets = phoneDetections(fp.text)
    const falseMatches = dets.map((d) => d.match)
    return { ...fp, falseMatches, clean: falseMatches.length === 0 }
  })

  return {
    generatedAt: new Date().toISOString(),
    corpusSize: corpus.length,
    global,
    byRegion: byRegion as Record<Region, Bucket>,
    byFormat: byFormat as Record<PhoneFormat, Bucket>,
    byCountry,
    misses,
    cases,
    fp: {
      total: fpResults.length,
      clean: fpResults.filter((r) => r.clean).length,
      falsePositives: fpResults.filter((r) => !r.clean),
    },
  }
}
