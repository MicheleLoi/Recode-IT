import { describe, it, expect } from 'vitest'
import {
  findDeCuiusNames,
  isGenericLabel,
  isStoplist,
  ITALIAN_ARTICLES,
  stripTitle,
  TITLE_RE,
} from '../stoplist'

describe('LEGAL_STOPLIST', () => {
  it('flags a canonical legal role phrase (case-insensitive)', () => {
    expect(isStoplist('parte attrice')).toBe(true)
    expect(isStoplist('Parte Attrice')).toBe(true)
    expect(isStoplist('PARTE CIVILE')).toBe(true)
  })

  it('does NOT flag a regular person name', () => {
    expect(isStoplist('Mario Rossi')).toBe(false)
    expect(isStoplist('Erminia Vanzetti')).toBe(false)
  })
})

describe('FALSE_POSITIVE_PATTERNS', () => {
  it('flags isolated honorifics / abbreviations', () => {
    expect(isStoplist('Sig.')).toBe(true)
    expect(isStoplist('Dott.ssa')).toBe(true)
    expect(isStoplist('Ill.mo')).toBe(true)
  })

  it('flags identifier-label abbreviations', () => {
    expect(isStoplist('C.F.')).toBe(true)
    expect(isStoplist('P.IVA')).toBe(true)
    expect(isStoplist('IBAN')).toBe(true)
    expect(isStoplist('n. 12')).toBe(true)
  })

  it('flags "procura alle liti"', () => {
    expect(isStoplist('procura speciale alle liti')).toBe(true)
    expect(isStoplist('procura generale')).toBe(true)
  })

  it('does NOT flag a generic phrase', () => {
    expect(isStoplist('contratto firmato')).toBe(false)
  })
})

describe('TITLE_RE / stripTitle — A-3 fix', () => {
  it('strips a bare title', () => {
    expect(stripTitle('Avv. Amadori')).toEqual({
      title: 'Avv.',
      bare: 'Amadori',
    })
  })

  it('strips the elided "L\'Avv." (straight apostrophe)', () => {
    expect(stripTitle("L'Avv. Amadori")).toEqual({
      title: "L'Avv.",
      bare: 'Amadori',
    })
  })

  it('strips the elided "L’Avv." (curly apostrophe U+2019)', () => {
    expect(stripTitle('L’Avv. Amadori')).toEqual({
      title: 'L’Avv.',
      bare: 'Amadori',
    })
  })

  it('strips a lowercase elided article ("l\'Avv. ...")', () => {
    expect(stripTitle("l'Avv. Amadori")).toEqual({
      title: "l'Avv.",
      bare: 'Amadori',
    })
  })

  it('recognizes "Notaio" as a title (A-3 addition)', () => {
    expect(stripTitle('Notaio Brambilla')).toEqual({
      title: 'Notaio',
      bare: 'Brambilla',
    })
  })

  it('strips "Dott.ssa"', () => {
    expect(stripTitle('Dott.ssa Maria Rossi')).toEqual({
      title: 'Dott.ssa',
      bare: 'Maria Rossi',
    })
  })

  it('returns empty title for non-title input', () => {
    expect(stripTitle('Mario Rossi')).toEqual({
      title: '',
      bare: 'Mario Rossi',
    })
  })

  it('TITLE_RE has the elided-article prefix in its source', () => {
    expect(TITLE_RE.source).toContain("[Ll]['’]")
  })
})

describe('findDeCuiusNames — A-2 fix', () => {
  it('matches "de cuius [Nome Cognome]"', () => {
    const out = findDeCuiusNames('vedova del de cuius Arturo Vanzetti deceduto')
    expect(out.has('arturo vanzetti')).toBe(true)
  })

  it('matches "[Nome Cognome], de cuius"', () => {
    const out = findDeCuiusNames('Mario Rossi, de cuius, lascia eredità')
    expect(out.has('mario rossi')).toBe(true)
  })

  it('matches "[Nome Cognome], il de cuius"', () => {
    const out = findDeCuiusNames(
      'la successione di Mario Rossi, il de cuius, è aperta',
    )
    expect(out.has('mario rossi')).toBe(true)
  })

  it('returns an empty set on "deceduto il [Nome]" (documented limitation)', () => {
    const out = findDeCuiusNames('deceduto il Mario Rossi nel 2024')
    expect(out.size).toBe(0)
  })

  it('returns an empty set when no de cuius phrase is present', () => {
    expect(findDeCuiusNames('contratto di compravendita ordinario').size).toBe(
      0,
    )
  })
})

describe('GENERIC_LABELS_IT — form-field labels (founder SID-20260527-181552)', () => {
  it('flags single-word labels (Nome, Cognome, Indirizzo)', () => {
    expect(isGenericLabel('Nome')).toBe(true)
    expect(isGenericLabel('Cognome')).toBe(true)
    expect(isGenericLabel('Indirizzo')).toBe(true)
    expect(isGenericLabel('Contatti')).toBe(true)
    expect(isGenericLabel('Note')).toBe(true)
    expect(isGenericLabel('Cliente')).toBe(true)
  })

  it('flags multi-word labels (Codice fiscale, Data di nascita)', () => {
    expect(isGenericLabel('Codice fiscale')).toBe(true)
    expect(isGenericLabel('Data di nascita')).toBe(true)
    expect(isGenericLabel('Luogo di nascita')).toBe(true)
    expect(isGenericLabel('Nome e cognome')).toBe(true)
  })

  it('flags case variants (NOME, codice FISCALE)', () => {
    expect(isGenericLabel('NOME')).toBe(true)
    expect(isGenericLabel('codice FISCALE')).toBe(true)
  })

  it('flags leading/trailing whitespace (trim)', () => {
    expect(isGenericLabel('  nome  ')).toBe(true)
    expect(isGenericLabel('\tcodice fiscale\n')).toBe(true)
  })

  it('does NOT flag personal names', () => {
    expect(isGenericLabel('Alessia')).toBe(false)
    expect(isGenericLabel('Marco Bellini')).toBe(false)
    expect(isGenericLabel('Erminia Vanzetti')).toBe(false)
  })

  it('does NOT flag empty string', () => {
    expect(isGenericLabel('')).toBe(false)
    expect(isGenericLabel('   ')).toBe(false)
  })

  it('isStoplist integrates GENERIC_LABELS_IT (NER post-filter hook)', () => {
    // Hook diretto in `isStoplist()` => filtra entrambi i punti
    // (engine.ts NER post-process + ner.worker.ts worker output).
    expect(isStoplist('Nome')).toBe(true)
    expect(isStoplist('Codice fiscale')).toBe(true)
    expect(isStoplist('Indirizzo')).toBe(true)
    expect(isStoplist('Marco Bellini')).toBe(false) // real name still passes
  })
})

describe('ITALIAN_ARTICLES set (A-1 carve-out)', () => {
  it('contains the canonical 18 articles + prepositions', () => {
    for (const a of [
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
      'al',
      'alla',
      'agli',
      'alle',
      'nel',
      'nella',
      'sul',
      'sulla',
    ]) {
      expect(ITALIAN_ARTICLES.has(a)).toBe(true)
    }
  })

  it('does NOT contain non-article words', () => {
    for (const word of ['mario', 'erminia', 'vanzetti', 'studio']) {
      expect(ITALIAN_ARTICLES.has(word)).toBe(false)
    }
  })
})
