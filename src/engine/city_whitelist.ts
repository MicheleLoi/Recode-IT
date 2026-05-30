/**
 * city_whitelist.ts — deterministic Italian-city detector (NER fallback).
 *
 * Founder criterio canonico 2026-05-30 SID-20260530-095254. Il modello WikiNER
 * (`Xenova/...italian-cased-ner`, LABEL_MAP `LOC→luogo`, threshold 0.4) ha
 * recall ~85-90% su capoluoghi italiani ma può MANCARE in liste enumerative
 * o context impoveriti (es. "Capitalia ha sedi a Roma, Milano, Firenze,
 * Torino, Palermo" → Firenze talvolta sfugge). Senza una rete deterministica,
 * il toggle "Luoghi" del dropdown produce risultati intermittenti — disastro
 * per la demo founder LinkedIn.
 *
 * Strategia: word-boundary regex deterministica sulla lista canonica dei
 * capoluoghi italiani (regione + provincia + città metropolitane). Produce
 * `NerDetection[]` con label `luogo`, score 1.0 (priorità massima), che vengono
 * MERGED con le predictions del NER in `anonymize()` PRIMA del Pass-2. La
 * pipeline esistente (`applyNerWithPseudonyms` → mapper.getCity → review panel)
 * non cambia: rispetta `enabledPass2Labels.has('luogo')` (toggle "Luoghi" OFF
 * → city whitelist NON gira), de-overlap con altre detection, dedup.
 *
 * Limiti deliberati:
 *   - Case-sensitive (\b<Word>\b): "ROMA" all-caps in un'intestazione NON
 *     viene catturata. Trade-off accettato — minor false-positive (parole
 *     comuni in maiuscolo come "ROMA" header, log "TORINO" timestamp) >
 *     minor false-negative su rare maiuscolo-only.
 *   - "L'Aquila" e "Reggio Calabria" / "Reggio Emilia" gestiti come literal
 *     multi-word: l'apice tipografico `’` E quello dritto `'` accettati;
 *     spazio interno preservato.
 *   - Niente normalizzazione accenti: "Forlì" sì, "Forli" no (resta a NER).
 */

import type { NerDetection } from '../types/engine'

/**
 * Capoluoghi di regione (20) + capoluoghi di provincia (~90) + città
 * metropolitane principali e città storiche frequenti in atti giudiziari IT.
 * Lista ordinata alfabeticamente per leggibilità — l'alternation regex sarà
 * ricostruita LONGEST-FIRST (sotto) così "Reggio Calabria" vince su "Reggio".
 *
 * Fonte: ISTAT capoluoghi 2024 + città metropolitane (D.Lgs. 56/2014).
 */
const ITALIAN_CITIES: ReadonlyArray<string> = [
  // A
  'Agrigento', 'Alessandria', 'Ancona', 'Aosta', 'Arezzo', 'Ascoli Piceno',
  'Asti', 'Avellino',
  // B
  'Bari', 'Barletta', 'Belluno', 'Benevento', 'Bergamo', 'Biella', 'Bologna',
  'Bolzano', 'Brescia', 'Brindisi',
  // C
  'Cagliari', 'Caltanissetta', 'Campobasso', 'Carbonia', 'Carrara', 'Caserta',
  'Catania', 'Catanzaro', 'Chieti', 'Como', 'Cosenza', 'Cremona', 'Crotone',
  'Cuneo',
  // E - F
  'Enna', 'Fermo', 'Ferrara', 'Firenze', 'Foggia', 'Forlì', 'Frosinone',
  // G - I
  'Genova', 'Gorizia', 'Grosseto', 'Imperia', 'Isernia',
  // L
  "L'Aquila", 'La Spezia', 'Latina', 'Lecce', 'Lecco', 'Livorno', 'Lodi', 'Lucca',
  // M
  'Macerata', 'Mantova', 'Massa', 'Matera', 'Messina', 'Milano', 'Modena',
  'Monza',
  // N - O
  'Napoli', 'Novara', 'Nuoro', 'Oristano',
  // P
  'Padova', 'Palermo', 'Parma', 'Pavia', 'Perugia', 'Pesaro', 'Pescara',
  'Piacenza', 'Pisa', 'Pistoia', 'Pordenone', 'Potenza', 'Prato',
  // R
  'Ragusa', 'Ravenna', 'Reggio Calabria', 'Reggio Emilia', 'Rieti', 'Rimini',
  'Roma', 'Rovigo',
  // S
  'Salerno', 'Sassari', 'Savona', 'Siena', 'Siracusa', 'Sondrio',
  // T
  'Taranto', 'Teramo', 'Terni', 'Torino', 'Trani', 'Trapani', 'Trento',
  'Treviso', 'Trieste',
  // U - V - Z
  'Udine', 'Urbino', 'Varese', 'Venezia', 'Verbania', 'Vercelli', 'Verona',
  'Vibo Valentia', 'Vicenza', 'Viterbo',
]

/**
 * Build the alternation regex LONGEST-FIRST so "Reggio Calabria" wins over
 * "Reggio" (no standalone Reggio in the list anyway, but the discipline is
 * cheap and protects future additions). Each city is regex-escaped; the apex
 * in `L'Aquila` becomes `L['’]Aquila` to accept both straight and typographic
 * apostrophes (real documents mix them).
 */
function escapeForAlternation(s: string): string {
  // Replace ASCII apostrophe with `['’]` so both forms match; escape other
  // regex metacharacters (none expected in city names, but defend).
  return s
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/'/g, "['’]")
}

const SORTED_LONGEST_FIRST = [...ITALIAN_CITIES].sort(
  (a, b) => b.length - a.length,
)

const CITY_RE = new RegExp(
  `\\b(?:${SORTED_LONGEST_FIRST.map(escapeForAlternation).join('|')})\\b`,
  'g',
)

/**
 * Scan `text` for Italian-city mentions and emit `NerDetection`-shaped spans
 * with label `luogo`, score `1.0` (deterministic detector → max confidence).
 *
 * Score 1.0 ensures these survive the overlap-dedup pass in
 * `applyNerWithPseudonyms` (which keeps the higher-score span when two
 * overlap). If the NER also caught the same city, the whitelist hit wins on
 * tie-or-higher score AND the dedup keeps a single replacement — net effect:
 * coverage gain on misses, no regression on catches.
 *
 * No-op when `text` is empty. Pure (regex `lastIndex` is reset).
 */
export function detectItalianCities(text: string): NerDetection[] {
  if (!text) return []
  const hits: NerDetection[] = []
  CITY_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = CITY_RE.exec(text)) !== null) {
    hits.push({
      start: m.index,
      end: m.index + m[0].length,
      text: m[0],
      label: 'luogo',
      score: 1.0,
    })
    if (m.index === CITY_RE.lastIndex) CITY_RE.lastIndex += 1
  }
  return hits
}

/**
 * Merge whitelist hits with NER detections. Whitelist hits are ADDED only
 * when they don't overlap an existing NER span — the NER may have classified
 * the same surface as `persona` (rare false positive, e.g. "Modena" as a
 * surname) and we don't want to silently retag. The downstream
 * overlap-dedup-by-score in `applyNerWithPseudonyms` is the second line of
 * defence; this first cut keeps the mapping intent obvious.
 *
 * Returns a NEW array (does not mutate `ner`).
 */
export function mergeWhitelistWithNer(
  ner: ReadonlyArray<NerDetection>,
  whitelist: ReadonlyArray<NerDetection>,
): NerDetection[] {
  const merged: NerDetection[] = [...ner]
  for (const w of whitelist) {
    const overlaps = merged.some((n) => w.start < n.end && w.end > n.start)
    if (!overlaps) merged.push(w)
  }
  return merged
}

/**
 * Exposed for tests so we can assert coverage of canonical capitals without
 * cracking the regex from the outside.
 */
export const __test__ = {
  ITALIAN_CITIES,
  CITY_RE,
}
