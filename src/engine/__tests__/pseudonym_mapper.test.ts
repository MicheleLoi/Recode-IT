import { describe, it, expect } from 'vitest'
import { PseudonymMapper } from '../pseudonym_mapper'
import { findDeCuiusNames } from '../stoplist'
import { loadFixture } from './fixtures'

// ---------------------------------------------------------------------------
// A-1 — Shared surname collision regression suite (6 cases)
// Source: MHC-L/dev/ANONYMIZER_BUGS.md §A-1, test_drift.py Scenario B.
// ---------------------------------------------------------------------------

describe('A-1 regression — shared surname collision (PseudonymMapper.getPerson)', () => {
  it('A-1.1 doc_B_eredita: Erminia and Tarcisio Vanzetti get DISTINCT pseudonyms', () => {
    const doc = loadFixture('doc_B_eredita')
    const m = new PseudonymMapper()
    for (const name of findDeCuiusNames(doc)) m.markSkip(name)
    // Feed the canonical MHC-L NER order (test_drift.py Scenario B):
    //   Rossella Amadori, Erminia Vanzetti, Tarcisio Vanzetti, Carlo Brambilla.
    m.getPerson('Rossella Amadori')
    m.getPerson('Erminia Vanzetti')
    m.getPerson('Tarcisio Vanzetti')
    m.getPerson('Carlo Brambilla')

    const erminia = m.getPersonMap().get('erminia vanzetti')
    const tarcisio = m.getPersonMap().get('tarcisio vanzetti')
    expect(erminia).toBeDefined()
    expect(tarcisio).toBeDefined()
    expect(erminia).not.toBe(tarcisio)
  })

  it('A-1.2 doc_B_eredita: detectCollisions() is empty after a clean run', () => {
    const doc = loadFixture('doc_B_eredita')
    const m = new PseudonymMapper()
    for (const name of findDeCuiusNames(doc)) m.markSkip(name)
    m.getPerson('Rossella Amadori')
    m.getPerson('Erminia Vanzetti')
    m.getPerson('Tarcisio Vanzetti')
    m.getPerson('Carlo Brambilla')

    expect(m.detectCollisions().size).toBe(0)
  })

  it('A-1.3 doc_B_eredita: bare "la Vanzetti" resolves to the FIRST registered Vanzetti', () => {
    const m = new PseudonymMapper()
    m.getPerson('Erminia Vanzetti')
    const erminiaPseudo = m.getPersonMap().get('erminia vanzetti') as string
    m.getPerson('Tarcisio Vanzetti')

    // Bare-surname reference (single-word) → coalesces to first registered.
    // Article-prefixed surnames are handled by the Tier-2 carve-out and
    // return only the pseudonym (the article is not a TITLE_RE match, so it
    // remains as input-context, not as a stripped title that gets re-appended).
    // This mirrors the Python reference behaviour exactly.
    expect(m.getPerson('Vanzetti')).toBe(erminiaPseudo)
    expect(m.getPerson('la Vanzetti')).toBe(erminiaPseudo)
  })

  it('A-1.4 doc_A_fendipista: "la Oberti" coreferences to "Silvana Oberti"', () => {
    // The almost-broken regression: the article-prefix carve-out must preserve
    // coreference between "Silvana Oberti" and "la Oberti".
    const m = new PseudonymMapper()
    m.getPerson('Silvana Oberti')
    const silvanaPseudo = m.getPersonMap().get('silvana oberti') as string
    expect(m.getPerson('la Oberti')).toBe(silvanaPseudo)
  })

  it('A-1.5 synthetic: distinct multi-word persons sharing a surname get distinct pseudonyms', () => {
    const m = new PseudonymMapper()
    const a = m.getPerson('Mario Rossi')
    const b = m.getPerson('Luigi Rossi')
    expect(a).not.toBe(b)
  })

  it('A-1.6 synthetic: surname index is first-write only', () => {
    const m = new PseudonymMapper()
    m.getPerson('Mario Rossi') // registers surnameMap["rossi"] = pseudo_for_Mario
    const marioPseudo = m.getPersonMap().get('mario rossi') as string
    m.getPerson('Luigi Rossi') // must NOT overwrite surnameMap["rossi"]
    expect(m.getSurnameMap().get('rossi')).toBe(marioPseudo)
  })

  it('A-1 regression: "dalla Oberti" preposition-article carve-out works', () => {
    // Extra synthetic regression: confirms the 2-word + article carve-out
    // still resolves under common Italian morphology.
    const m = new PseudonymMapper()
    m.getPerson('Silvana Oberti')
    const silvanaPseudo = m.getPersonMap().get('silvana oberti') as string
    expect(m.getPerson('dalla Oberti')).toBe(silvanaPseudo)
  })
})

// ---------------------------------------------------------------------------
// A-2 — De cuius exemption regression suite (5 cases)
// Source: MHC-L/dev/ANONYMIZER_BUGS.md §A-2, GDPR Recital 27.
// ---------------------------------------------------------------------------

describe('A-2 regression — de cuius exemption (markSkip / _skipSet)', () => {
  it('A-2.1 doc_B_eredita: "Arturo Vanzetti" is in skipSet and NOT in personMap', () => {
    const doc = loadFixture('doc_B_eredita')
    const m = new PseudonymMapper()
    for (const name of findDeCuiusNames(doc)) m.markSkip(name)

    expect(m.getSkipSet().has('arturo vanzetti')).toBe(true)

    // Even when explicitly requested, the mapper returns the original.
    expect(m.getPerson('Arturo Vanzetti')).toBe('Arturo Vanzetti')
    expect(m.getPersonMap().has('arturo vanzetti')).toBe(false)
  })

  it('A-2.2 synthetic "la defunta Maria Rossi" with de cuius pattern', () => {
    const text = 'Maria Rossi, de cuius, lascia il patrimonio.'
    const m = new PseudonymMapper()
    for (const name of findDeCuiusNames(text)) m.markSkip(name)
    expect(m.getSkipSet().has('maria rossi')).toBe(true)
    expect(m.getPerson('Maria Rossi')).toBe('Maria Rossi')
  })

  it('A-2.3 synthetic "il fu Mario Bianchi" — NEGATIVE: pattern only fires on "de cuius"', () => {
    // "il fu" is NOT covered by the A-2 pattern (documented limitation). The
    // mapper must pseudonymize as usual.
    const text = 'il fu Mario Bianchi era benestante'
    const m = new PseudonymMapper()
    for (const name of findDeCuiusNames(text)) m.markSkip(name)
    expect(m.getSkipSet().has('mario bianchi')).toBe(false)
    const pseudo = m.getPerson('Mario Bianchi')
    expect(pseudo).not.toBe('Mario Bianchi')
  })

  it('A-2.4 synthetic "in qualità di erede del defunto X" — pattern silent', () => {
    const text = "in qualità di erede del defunto Luigi Verdi, agisce."
    const m = new PseudonymMapper()
    for (const name of findDeCuiusNames(text)) m.markSkip(name)
    expect(m.getSkipSet().has('luigi verdi')).toBe(false)
  })

  it('A-2.5 synthetic "de cuius Carlo Bianchi" — captured (prefix form)', () => {
    const text = 'la successione del de cuius Carlo Bianchi è aperta'
    const m = new PseudonymMapper()
    for (const name of findDeCuiusNames(text)) m.markSkip(name)
    expect(m.getSkipSet().has('carlo bianchi')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// A-3 — Elided title regression suite (6 cases)
// Source: MHC-L/dev/ANONYMIZER_BUGS.md §A-3.
// ---------------------------------------------------------------------------

describe('A-3 regression — elided title (TITLE_RE)', () => {
  it('A-3.1 doc_B_eredita: "L\'Avv. Amadori" → surnameMap["amadori"], NOT ["l\'avv"]', () => {
    const m = new PseudonymMapper()
    m.getPerson("L'Avv. Amadori")
    expect(m.getSurnameMap().has('amadori')).toBe(true)
    expect(m.getSurnameMap().has("l'avv")).toBe(false)
  })

  it('A-3.2 curly apostrophe "L’Avv. Amadori" handled identically', () => {
    const m = new PseudonymMapper()
    m.getPerson('L’Avv. Amadori')
    expect(m.getSurnameMap().has('amadori')).toBe(true)
  })

  it('A-3.3 lowercase elided article "l\'Avv. Amadori"', () => {
    const m = new PseudonymMapper()
    m.getPerson("l'Avv. Amadori")
    expect(m.getSurnameMap().has('amadori')).toBe(true)
  })

  it('A-3.4 "Notaio Brambilla" — title recognized (A-3 addition to alternation)', () => {
    const m = new PseudonymMapper()
    const result = m.getPerson('Notaio Brambilla')
    // "Notaio" stripped → bare "Brambilla" seeds personMap.
    expect(m.getPersonMap().has('brambilla')).toBe(true)
    expect(result.startsWith('Notaio ')).toBe(true)
  })

  it('A-3.5 elided title coreference: subsequent "Amadori" returns the same pseudonym', () => {
    const m = new PseudonymMapper()
    const first = m.getPerson("L'Avv. Amadori")
    const firstBarePseudo = first.replace(/^L'Avv\.\s*/, '')
    const second = m.getPerson('Amadori')
    expect(second).toBe(firstBarePseudo)
  })

  it("A-3.6 NEGATIVE: a non-title word starting with l' is NOT stripped", () => {
    // "l'attore" matches FALSE_POSITIVE_PATTERNS / LEGAL_STOPLIST elsewhere,
    // but TITLE_RE alone must not match it (no "attore" in the title list).
    const m = new PseudonymMapper()
    // Use a non-stoplist token that incidentally begins with l' — the bare
    // name must NOT be stripped to a fragment.
    m.getPerson("l'azienda Bianchi") // not a real legal title
    // After processing, personMap key should NOT collapse to "azienda bianchi"
    // alone — the input must be treated literally (no title stripped).
    // The key fact: surnameMap should have "bianchi" registered (from the
    // multi-word path), but NOT "l'az" or similar fragment.
    expect(m.getSurnameMap().has('bianchi')).toBe(true)
    for (const key of m.getSurnameMap().keys()) {
      expect(key.startsWith("l'")).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// Drift smoke (3 cases) — anonymize → recode round-trip on doc_A / doc_B /
// doc_C. The full mapping (regex layer + manually-fed person mentions) must
// round-trip back to the original text modulo regex-layer substitutions.
// Note: the drift_smoke for engine.anonymize() lives in recode.test.ts since
// it depends on the recode primitive — see DS.1 / DS.2 / DS.3 there.
// ---------------------------------------------------------------------------

describe('drift smoke (mapper-only): mapping coherence on the three docs', () => {
  it('DS.A doc_A_fendipista: feeding canonical persons → 3 distinct pseudonyms, no collisions', () => {
    const m = new PseudonymMapper()
    m.getPerson('Giorgio Pellizzon')
    m.getPerson('Silvana Oberti')
    m.getPerson('Marco Fuentes')
    expect(m.getPersonMap().size).toBe(3)
    expect(m.detectCollisions().size).toBe(0)
  })

  it('DS.B doc_B_eredita: 3 living persons + 1 de cuius exempt, no collisions', () => {
    const doc = loadFixture('doc_B_eredita')
    const m = new PseudonymMapper()
    for (const name of findDeCuiusNames(doc)) m.markSkip(name)
    m.getPerson('Rossella Amadori')
    m.getPerson('Erminia Vanzetti')
    m.getPerson('Tarcisio Vanzetti')
    m.getPerson('Carlo Brambilla')
    expect(m.getPersonMap().size).toBe(4) // 3 living + Carlo Brambilla
    expect(m.getSkipSet().has('arturo vanzetti')).toBe(true)
    expect(m.detectCollisions().size).toBe(0)
  })

  it('DS.C doc_C_il_leak: 3 persons + 2 companies (Alfa, Beta) get distinct pseudonyms', () => {
    const m = new PseudonymMapper()
    m.getPerson('Pietro Lanzafame')
    m.getPerson('Marta Colombo')
    m.getPerson('Alessandro Rinaudo')
    const c1 = m.getCompany('NovaBit S.r.l.')
    const c2 = m.getCompany('Axiom Technologies S.p.A.')
    expect(c1.endsWith('S.r.l.')).toBe(true)
    expect(c2.endsWith('S.p.A.')).toBe(true)
    const base1 = c1.replace(/\s*S\.r\.l\.$/, '')
    const base2 = c2.replace(/\s*S\.p\.A\.$/, '')
    expect(base1).not.toBe(base2)
    expect(m.detectCollisions().size).toBe(0)
  })
})
