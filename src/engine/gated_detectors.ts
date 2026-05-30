/**
 * gated_detectors.ts — opt-in structured detectors (Date + CAP).
 *
 * Founder criterio canonico `_org/decision_log.md` MHC-Work 2026-05-30
 * SID-20260530-095254: il flusso standard (always-on `REGEX_RULES`) maschera
 * gli identificativi di persona SENZA trade-off giuridico (CF, IBAN, email,
 * telefono, numero prenotazione). Date e CAP hanno un trade-off IMPORTANTE col
 * ragionamento giuridico (cronologia, geografia / giurisdizione), quindi NON
 * stanno nel flusso standard: sono rilevatori OPT-IN, applicati solo quando il
 * rispettivo toggle del dropdown "Sostituisci anche" è ON.
 *
 * Questo modulo è deliberatamente SEPARATO da `regex.ts` (che documenta
 * `_org/decision_log.md` 2026-05-26 SID-20260526-011753 §Item 7 C:
 * "Date/importi/CAP esplicitamente NON inclusi" nel flusso standard). Tenendo
 * i due detector qui, il canone 2026-05-26 (fuori dal flusso standard) e il
 * canone 2026-05-30 (disponibili come opt-in) restano entrambi onorati.
 *
 * Round-trip: ogni valore distinto rilevato riceve un token NUMERATO
 * (`<DATA_1>`, `<DATA_2>`, `<CAP_1>`, …) — NON un tag costante condiviso —
 * così che la Decodifica (reverse substitution in `DecodificaPanel`, guidata
 * dalla mappa pseudonimo→realValue) ripristini ogni occorrenza al suo valore
 * originale senza collisioni. Mirror della convenzione dei pseudonimi persona
 * (`Tizio`, `Caio`), non dei tag deterministici regex (`<DS>`, `<EMAIL>`).
 */

/** A detector hit over the input text (offsets into the text it was run on). */
export type GatedSpan = {
  start: number
  end: number
  match: string
  /** UI-facing + mapping category: 'data' | 'cap'. */
  category: 'data' | 'cap'
  /** Numbered pseudonym token, e.g. '<DATA_1>' / '<CAP_1>'. */
  token: string
}

// Canonical detector keys (mirror the dropdown keys in WireframeWorkArea).
export const DETECTOR_DATE = 'date'
export const DETECTOR_CAP = 'cap'

// ---------------------------------------------------------------------------
// Date detector
// ---------------------------------------------------------------------------

/**
 * Italian month names — full + common abbreviations (with/without trailing
 * dot). Used by the textual-date pattern. Ordered longest-first inside the
 * alternation so "settembre" wins over a hypothetical "set".
 */
const ITALIAN_MONTHS = [
  'gennaio',
  'febbraio',
  'marzo',
  'aprile',
  'maggio',
  'giugno',
  'luglio',
  'agosto',
  'settembre',
  'ottobre',
  'novembre',
  'dicembre',
  // Abbreviations (longest-first within each month so the alternation never
  // settles for a shorter prefix when the longer form is present — e.g. 'sett'
  // before 'set', 'genn' before 'gen'). Deduped.
  'genn',
  'gen',
  'febb',
  'feb',
  'mar',
  'apr',
  'magg',
  'mag',
  'giu',
  'lug',
  'ago',
  'sett',
  'set',
  'ott',
  'nov',
  'dic',
]

const MONTHS_ALT = ITALIAN_MONTHS.join('|')

/**
 * Numeric dates: `12/03/2024`, `12-03-2024`, `12.03.2024`, `2024-03-12`,
 * `12/3/24`. Day/month 1-2 digits, year 2 or 4 digits. ISO form (year-first)
 * handled by the second alternative. Separator must be consistent within a
 * date (we don't require it via backreference for simplicity — mixed
 * separators are rare and a tolerant match here is acceptable, the value is
 * round-tripped verbatim regardless).
 *
 * `\b` boundaries keep us from biting into longer digit runs (a CF or IBAN
 * surface would already be masked to `<DS>`/`<IBAN>` by the time this runs).
 */
const DATE_NUMERIC_RE =
  /\b(?:\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}|\d{4}[/\-.]\d{1,2}[/\-.]\d{1,2})\b/g

/**
 * Textual Italian dates: `12 marzo 2024`, `1° gennaio 2025`, `5 set 2023`.
 * Optional ordinal degree sign on the day. Month from the alternation. Year
 * 4 digits (textual dates virtually always carry a full year).
 */
const DATE_TEXTUAL_RE = new RegExp(
  String.raw`\b\d{1,2}°?\s+(?:${MONTHS_ALT})\.?\s+\d{4}\b`,
  'gi',
)

/**
 * Detect date spans in `text`. Numeric + textual patterns, de-overlapped
 * (textual takes precedence when both match the same region — it carries the
 * month word and is more specific). Spans are returned sorted ascending.
 */
export function detectDates(text: string): Array<Omit<GatedSpan, 'token'>> {
  const raw: Array<Omit<GatedSpan, 'token'>> = []
  for (const re of [DATE_TEXTUAL_RE, DATE_NUMERIC_RE]) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      raw.push({
        start: m.index,
        end: m.index + m[0].length,
        match: m[0],
        category: 'data',
      })
      if (m.index === re.lastIndex) re.lastIndex += 1
    }
  }
  return dedupeOverlaps(raw)
}

// ---------------------------------------------------------------------------
// CAP detector (context-aware — 5 bare digits are ambiguous)
// ---------------------------------------------------------------------------

/**
 * A bare 5-digit run is indistinguishable from many other numbers (importi,
 * codici, anni concatenati). To keep false positives low we require ONE of two
 * contexts:
 *
 *   (1) Keyword: an adjacent "CAP" / "C.A.P." token immediately before the
 *       digits, e.g. "CAP 20100", "C.A.P.: 00185".
 *   (2) Address shape: the 5 digits IMMEDIATELY FOLLOWED by a capitalised
 *       word (the town/city), the canonical Italian postal line
 *       "20100 Milano", "00185 Roma". Optionally preceded by a province
 *       parenthetical is not required here — the city suffix is the anchor.
 *
 * Only the 5-digit run itself is captured as the value (the keyword / city are
 * preserved verbatim in the output — masking the city is the job of the
 * separate "Luoghi" toggle, not the CAP detector).
 */
const CAP_KEYWORD_RE =
  /\b(?:C\.?\s*A\.?\s*P\.?)\s*:?\s*(\d{5})\b/gi

const CAP_ADDRESS_RE =
  /\b(\d{5})\s+(?=[A-ZÀ-Ý][a-zà-ÿ'’]+)/g

/**
 * Detect CAP spans in `text`. Captures only the 5-digit group (group 1 of each
 * pattern). De-overlapped, sorted ascending.
 */
export function detectCaps(text: string): Array<Omit<GatedSpan, 'token'>> {
  const raw: Array<Omit<GatedSpan, 'token'>> = []

  CAP_KEYWORD_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = CAP_KEYWORD_RE.exec(text)) !== null) {
    const g = m[1]
    if (!g) continue
    // Group offset: the 5-digit run sits at the END of the full match (the
    // keyword prefix never contains its own 5-digit run), so lastIndexOf is
    // robust against a keyword that happens to embed digits.
    const gStart = m.index + m[0].lastIndexOf(g)
    raw.push({
      start: gStart,
      end: gStart + g.length,
      match: g,
      category: 'cap',
    })
    if (m.index === CAP_KEYWORD_RE.lastIndex) CAP_KEYWORD_RE.lastIndex += 1
  }

  CAP_ADDRESS_RE.lastIndex = 0
  while ((m = CAP_ADDRESS_RE.exec(text)) !== null) {
    const g = m[1]
    if (!g) continue
    const gStart = m.index + m[0].indexOf(g)
    raw.push({
      start: gStart,
      end: gStart + g.length,
      match: g,
      category: 'cap',
    })
    if (m.index === CAP_ADDRESS_RE.lastIndex) CAP_ADDRESS_RE.lastIndex += 1
  }

  return dedupeOverlaps(raw)
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Drop overlapping spans, keeping the FIRST-seen (callers pass the
 * higher-precedence pattern first). Returns ascending by start.
 */
function dedupeOverlaps(
  spans: Array<Omit<GatedSpan, 'token'>>,
): Array<Omit<GatedSpan, 'token'>> {
  const accepted: Array<Omit<GatedSpan, 'token'>> = []
  for (const s of spans) {
    const overlaps = accepted.some((a) => s.start < a.end && s.end > a.start)
    if (!overlaps) accepted.push(s)
  }
  return accepted.sort((a, b) => a.start - b.start)
}

/**
 * Run the enabled gated detectors over `text`, assigning a numbered token to
 * each DISTINCT real value (so repeated mentions of the same date share one
 * token and the reverse pass is unambiguous). Returns spans (with token) ready
 * to splice into the text + the deduped mapping entries.
 *
 * @param text         the text to scan (already post-`applyRegexRules`).
 * @param enabled      set of detector keys (`'date'`, `'cap'`).
 */
export function detectGated(
  text: string,
  enabled: ReadonlySet<string>,
): {
  spans: GatedSpan[]
  entries: Array<{ pseudonym: string; realValue: string; category: string }>
} {
  if (!enabled || enabled.size === 0) {
    return { spans: [], entries: [] }
  }

  const hits: Array<Omit<GatedSpan, 'token'>> = []
  if (enabled.has(DETECTOR_DATE)) hits.push(...detectDates(text))
  if (enabled.has(DETECTOR_CAP)) hits.push(...detectCaps(text))

  // Global de-overlap across detectors (a date and a CAP can't normally
  // overlap, but defend anyway — keep earliest start).
  const ordered = hits.sort((a, b) => a.start - b.start)
  const deduped: Array<Omit<GatedSpan, 'token'>> = []
  for (const s of ordered) {
    const overlaps = deduped.some((a) => s.start < a.end && s.end > a.start)
    if (!overlaps) deduped.push(s)
  }

  // Assign numbered tokens — stable per distinct (category, value). Counter is
  // per-category so dates get <DATA_1..> and CAPs get <CAP_1..> independently.
  const tokenByKey = new Map<string, string>()
  const counters: Record<string, number> = { data: 0, cap: 0 }
  const prefix: Record<string, string> = { data: 'DATA', cap: 'CAP' }

  const spans: GatedSpan[] = []
  const entries: Array<{
    pseudonym: string
    realValue: string
    category: string
  }> = []
  const seenEntry = new Set<string>()

  for (const s of deduped) {
    const key = `${s.category}::${s.match}`
    let token = tokenByKey.get(key)
    if (token === undefined) {
      counters[s.category] = (counters[s.category] ?? 0) + 1
      token = `<${prefix[s.category]}_${counters[s.category]}>`
      tokenByKey.set(key, token)
    }
    spans.push({ ...s, token })
    if (!seenEntry.has(key)) {
      seenEntry.add(key)
      entries.push({
        pseudonym: token,
        realValue: s.match,
        category: s.category,
      })
    }
  }

  return { spans, entries }
}

/**
 * Splice the detector tokens into `text` (right-to-left so offsets stay
 * valid). Pure — returns the substituted string.
 */
export function applyGatedSpans(text: string, spans: GatedSpan[]): string {
  let out = text
  for (const s of [...spans].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, s.start) + s.token + out.slice(s.end)
  }
  return out
}
