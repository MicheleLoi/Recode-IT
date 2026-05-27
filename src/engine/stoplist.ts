/**
 * stoplist.ts — port of the stoplist + helper regexes from
 * `MHC-L/gate-local/tools/anonymize.py`.
 *
 * Includes the A-2 (de cuius exemption) and A-3 (elided-title) fix variants
 * documented in DESIGN.md §8.5 and `MHC-L/dev/ANONYMIZER_BUGS.md`.
 */

// ---------------------------------------------------------------------------
// LEGAL_STOPLIST — legal-role phrases that must NEVER be pseudonymized.
// ---------------------------------------------------------------------------

export const LEGAL_STOPLIST: Set<string> = new Set([
  'parte attrice',
  'parte convenuta',
  'parte istante',
  'parte resistente',
  'il ricorrente',
  'la ricorrente',
  'il convenuto',
  'la convenuta',
  "l'attore",
  "l'attrice",
  'il resistente',
  'la resistente',
  'il richiedente',
  'la richiedente',
  'il debitore',
  'la debitrice',
  'il creditore',
  'la creditrice',
  'parte civile',
  'il curatore',
  'la curatrice',
  'il fallito',
  'la fallita',
  'il teste',
  'la teste',
  'il perito',
  'la perita',
])

// ---------------------------------------------------------------------------
// GENERIC_LABELS_IT — Italian form-field labels that must NEVER produce entity
// pills. These are document-structure markers (key in key:value form-fields),
// not personal data. Founder direttiva SID-20260527-181552: pill su "Nome",
// "Codice fiscale" etc. leggono come "sostituzione" e creano confusione visiva
// per audience target (avvocato non-tech).
// ---------------------------------------------------------------------------

export const GENERIC_LABELS_IT: Set<string> = new Set([
  'nome',
  'cognome',
  'nome e cognome',
  'codice fiscale',
  'cf',
  'partita iva',
  'piva',
  'p. iva',
  'contatti',
  'contatto',
  'recapiti',
  'recapito',
  'indirizzo',
  'residenza',
  'domicilio',
  'email',
  'e-mail',
  'posta elettronica',
  'telefono',
  'tel',
  'cellulare',
  'cell',
  'note',
  'nota',
  'osservazioni',
  'cliente',
  'clienti',
  'fornitore',
  'data',
  'data di nascita',
  'luogo di nascita',
])

export function isGenericLabel(text: string): boolean {
  return GENERIC_LABELS_IT.has(text.trim().toLowerCase())
}

// ---------------------------------------------------------------------------
// FALSE_POSITIVE_PATTERNS — abbreviations / titles GLiNER tends to misclassify.
// Each pattern is anchored with start/end markers; we use `^…$` semantics by
// matching against the trimmed input.
// ---------------------------------------------------------------------------

export const FALSE_POSITIVE_PATTERNS: RegExp[] = [
  /^(?:Sig\.?(?:ra)?|Dott\.?(?:ssa)?|Ill\.mo)$/i,
  /^(?:C\.?\s*F\.?|P\.?\s*IVA|PEC|R\.G\.|IBAN|n\.\s*\d+)$/i,
  /procura\s+(?:speciale\s+)?(?:alle\s+liti|generale)/i,
  /^n\.\s*\d+$/,
]

export function isStoplist(token: string): boolean {
  const trimmed = token.trim()
  const normalized = trimmed.toLowerCase()
  if (LEGAL_STOPLIST.has(normalized)) return true
  if (GENERIC_LABELS_IT.has(normalized)) return true
  for (const pat of FALSE_POSITIVE_PATTERNS) {
    // Mimic Python's `fullmatch` for anchored patterns; for the one
    // un-anchored pattern (`procura ...`), `test()` is what we want.
    if (pat.source.startsWith('^') && pat.source.endsWith('$')) {
      // Reset state defensively (none of these carry /g, but be safe).
      pat.lastIndex = 0
      const m = pat.exec(trimmed)
      if (m && m[0] === trimmed) return true
    } else {
      pat.lastIndex = 0
      if (pat.test(trimmed)) return true
    }
  }
  return false
}

// ---------------------------------------------------------------------------
// TITLE_RE — A-3 fix: optional elided-article prefix covering both the
// straight `'` and the curly `’` (U+2019). `Notaio` MUST be present.
// ---------------------------------------------------------------------------

export const TITLE_RE =
  /^(?:[Ll]['’]\s*)?(?:Avv\.?\s*|Ing\.?\s*|Geom\.?\s*|Dott\.?(?:ssa)?\s*|Notaio\s*|Sig\.?(?:ra)?\s*|Prof\.?\s*)/i

/**
 * Strip a leading title from a person string. Returns `{title, bare}`; both
 * trimmed. If no title is present, `title` is the empty string and `bare` is
 * the trimmed input.
 */
export function stripTitle(text: string): { title: string; bare: string } {
  TITLE_RE.lastIndex = 0
  const m = TITLE_RE.exec(text)
  if (m) {
    const title = m[0].trim()
    const bare = text.slice(m[0].length).trim()
    return { title, bare }
  }
  return { title: '', bare: text.trim() }
}

// ---------------------------------------------------------------------------
// _ITALIAN_ARTICLES — A-1 fix carve-out for article-prefixed bare-surname
// references ("la Vanzetti", "del Ferrari").
// ---------------------------------------------------------------------------

export const ITALIAN_ARTICLES: Set<string> = new Set([
  'il',
  'la',
  'lo',
  'i',
  'le',
  'gli',
  'del',
  'della',
  'dei',
  'delle',
  'dall',
  'dalla',
  'dai',
  'dalle',
  'al',
  'alla',
  'agli',
  'alle',
  'nel',
  'nella',
  'nei',
  'nelle',
  'sul',
  'sulla',
  'sui',
  'sulle',
])

// ---------------------------------------------------------------------------
// _DE_CUIUS_RE — A-2 fix: GDPR Recital 27 (deceased persons exempt).
// Literal port of the Python regex.
// ---------------------------------------------------------------------------

export const DE_CUIUS_RE =
  /\bde\s+cuius\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)+)|([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)+)\s*,\s*(?:il\s+)?de\s+cuius/g

/**
 * Find names of deceased persons in `de cuius` constructions. Returns a Set
 * of *lowercased* full names — the same shape the Python pipeline feeds into
 * `PseudonymMapper.mark_skip`.
 */
export function findDeCuiusNames(text: string): Set<string> {
  const out = new Set<string>()
  DE_CUIUS_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = DE_CUIUS_RE.exec(text)) !== null) {
    for (let i = 1; i < m.length; i += 1) {
      const g = m[i]
      if (g) out.add(g.trim().toLowerCase())
    }
    // Defensive: if we ever match a zero-width alternative, advance.
    if (m.index === DE_CUIUS_RE.lastIndex) {
      DE_CUIUS_RE.lastIndex += 1
    }
  }
  return out
}
