import { describe, it, expect } from 'vitest'
import { applyRegexRules, CF_RE } from '../regex'

function counts(detections: ReturnType<typeof applyRegexRules>['detections']) {
  const c: Record<string, number> = {}
  for (const d of detections) c[d.category] = (c[d.category] ?? 0) + 1
  return c
}

// All CF fixtures in this file carry valid CEI 12-1979 check digits — the
// post-match `validateCF` filter (SID-20260527-181552 Pacchetto A hardening)
// drops syntactic-but-checksum-invalid matches, so legacy placeholder CFs
// (RSSMRA70B03A662X et al.) were re-encoded to their canonical valid forms
// (...662E, ...501I, ...501U, ...205K, ...501S, ...501U) in this same
// commit. Real-CF semantics, no impact on the regex coverage being asserted.
describe('regex layer — CF (16-char alphanumeric)', () => {
  it('matches a canonical uppercase fiscal code', () => {
    const out = applyRegexRules('CF RSSMRA70B03A662E end')
    expect(out.text).toBe('CF <DS> end')
    expect(counts(out.detections).CF).toBe(1)
  })

  it('matches a lowercase OCR variant', () => {
    const out = applyRegexRules('cf rssmra70a01h501s')
    expect(out.text).toBe('cf <DS>')
  })

  it('matches the OCR-spaced variant', () => {
    const out = applyRegexRules('codice: RSSMRO 80A01 H501I end')
    expect(out.text).toContain('<DS>')
    expect(out.text).not.toContain('RSSMRO 80A01 H501I')
  })

  it('does NOT match a non-CF-shaped 16-char token', () => {
    const out = applyRegexRules('CONTRATTO12345678 is not a CF')
    expect(out.text).toBe('CONTRATTO12345678 is not a CF')
    expect(out.detections).toHaveLength(0)
  })

  it('does NOT report a CF-shaped token with invalid checksum', () => {
    // ABCDEF12A34H567Z is a syntactically valid CF (6L + 2D + month-letter A
    // (gennaio, valid) + 2D + letter + 3D + letter Z). Its CEI 12-1979
    // checksum however should be E, not Z — so the regex matches the shape
    // but `validateCF` drops it as a false positive (Pacchetto A hardening
    // SID-20260527-181552).
    const out = applyRegexRules('placeholder ABCDEF12A34H567Z tail')
    expect(out.text).toBe('placeholder ABCDEF12A34H567Z tail')
    expect(counts(out.detections).CF ?? 0).toBe(0)
  })
})

describe('CF regex flessibile (4-group form-field)', () => {
  // Founder direttiva SID-20260527-181552: CF readable split cognome|nome
  // (forma form-field) NON era coperto dalle precedenti due regex (canonical
  // + 3-group). La regex consolidata `\s*` ai 3 boundary copre TUTTE le forme.
  it('matches 4-group split cognome|nome (RNL LSS 84C52 H501U)', () => {
    const m = 'RNL LSS 84C52 H501U'.match(CF_RE)
    expect(m).not.toBeNull()
    expect(m).toHaveLength(1)
  })

  it('matches a second 4-group case (BLL MRC 79A11 F205K)', () => {
    const m = 'BLL MRC 79A11 F205K'.match(CF_RE)
    expect(m).not.toBeNull()
    expect(m).toHaveLength(1)
  })

  it('backward compat — canonical no-space (RNLLSS84C52H501U)', () => {
    const m = 'RNLLSS84C52H501U'.match(CF_RE)
    expect(m).not.toBeNull()
    expect(m).toHaveLength(1)
  })

  it('backward compat — 3-group readable (RNLLSS 84C52 H501U)', () => {
    const m = 'RNLLSS 84C52 H501U'.match(CF_RE)
    expect(m).not.toBeNull()
    expect(m).toHaveLength(1)
  })

  it('false positive guard — lorem ipsum does not match', () => {
    const m = 'Lorem ipsum dolor sit amet'.match(CF_RE)
    expect(m).toBeNull()
  })

  it('end-to-end via applyRegexRules — 4-group CF replaced with <DS>', () => {
    const out = applyRegexRules('Codice fiscale: RNL LSS 84C52 H501U')
    expect(out.text).toContain('<DS>')
    expect(out.text).not.toContain('RNL LSS 84C52 H501U')
  })
})

describe('CF regex — omocodia INPS (Pacchetto A SID-20260527-181552)', () => {
  // Quando 2+ persone collidono sullo stesso CF canonico, INPS sostituisce
  // cifre con lettere mappate (0→L, 1→M, 2→N, 3→P, 4→Q, 5→R, 6→S, 7→T,
  // 8→U, 9→V) nelle 3 posizioni-substituibili (anno, giorno, codice
  // catastale). Il check digit del 16° char viene RICALCOLATO sulla forma
  // omocodificata (D.M. 12 marzo 1974). Tests verificano la coppia
  // canonical / omocoded:
  //   RNLLSS84C52H501U (canonical, check digit U)
  //   RNLLSS84CR2H50LK (omocodato: posizioni 11 5→R + 15 1→L, check digit K)

  it('matches an omocoded CF with substitutions in day and city positions', () => {
    const out = applyRegexRules('CF omocodato RNLLSS84CR2H50LK end')
    expect(out.text).toBe('CF omocodato <DS> end')
    expect(counts(out.detections).CF).toBe(1)
  })

  it('matches the canonical sibling of the same omocodia case (backward compat)', () => {
    const out = applyRegexRules('CF canonico RNLLSS84C52H501U end')
    expect(out.text).toBe('CF canonico <DS> end')
    expect(counts(out.detections).CF).toBe(1)
  })

  it('matches a 4-group omocoded form (form-field readable)', () => {
    const out = applyRegexRules('Codice fiscale: RNL LSS 84CR2 H50LK')
    expect(out.text).toContain('<DS>')
    expect(out.text).not.toContain('RNL LSS 84CR2 H50LK')
  })

  it('regression guard — invalid month letter (A is NOT a valid CF month) does not match', () => {
    // 7th char (month) must be one of [ABCDEHLMPRST]. 'A' is valid (gennaio).
    // 'F' is NOT a valid month code — the regex char class excludes it.
    const m = 'RNLLSS84F52H501U'.match(CF_RE)
    expect(m).toBeNull()
  })
})

describe('regex layer — CF_NUM (11-digit with C.F. prefix)', () => {
  it('replaces the digits but preserves the prefix', () => {
    const out = applyRegexRules('C.F.: 12345678901')
    expect(out.text).toBe('C.F.: <DS>')
    expect(counts(out.detections).CF_NUM).toBe(1)
  })

  it('matches the "Codice Fiscale" long-prefix variant', () => {
    const out = applyRegexRules('Codice Fiscale 12345678901')
    expect(out.text).toBe('Codice Fiscale <DS>')
  })

  it('does NOT match bare 11-digit numbers without a CF/CodFisc prefix', () => {
    const out = applyRegexRules('numero protocollo 12345678901 senza prefisso')
    expect(out.text).toContain('12345678901')
  })
})

describe('regex layer — P.IVA', () => {
  it('matches "P. IVA 12345678901"', () => {
    const out = applyRegexRules('P. IVA 12345678901')
    expect(out.text).toBe('P. IVA <P.IVA>')
  })

  it('matches the "PIVA" (no dot) variant', () => {
    const out = applyRegexRules('PIVA12345678901 ok')
    expect(out.text).toBe('PIVA<P.IVA> ok')
  })

  it('matches "Partita IVA"', () => {
    const out = applyRegexRules('Partita IVA 12345678901')
    expect(out.text).toBe('Partita IVA <P.IVA>')
  })

  it('does NOT replace a bare 11-digit number with no IVA-shaped prefix', () => {
    const out = applyRegexRules('totale 12345678901 euro')
    expect(out.text).toBe('totale 12345678901 euro')
  })
})

describe('regex layer — IBAN', () => {
  // Both IT IBANs below carry valid MOD-97 check digits (ISO 13616) — the
  // post-match `validateIBAN` filter drops syntactic-but-checksum-invalid
  // matches, so the legacy synthetic IT11A1…X1 fixture was replaced with
  // a generator-valid sibling IT81A1234500000123456789012 in this commit.
  it('replaces an Italian IBAN', () => {
    const out = applyRegexRules('bonifico IT60X0542811101000000123456 verso')
    expect(out.text).toBe('bonifico <IBAN> verso')
    expect(counts(out.detections).IBAN).toBe(1)
  })

  it('does NOT replace a German IBAN', () => {
    const out = applyRegexRules('IBAN DE89370400440532013000')
    expect(out.text).toContain('DE89370400440532013000')
    expect(out.text).not.toContain('<IBAN>')
  })

  it('matches two distinct ITs in the same input', () => {
    const out = applyRegexRules(
      'IT60X0542811101000000123456 then IT81A1234500000123456789012',
    )
    expect((out.text.match(/<IBAN>/g) ?? []).length).toBe(2)
  })

  it('does NOT report a checksum-invalid IT-shaped IBAN', () => {
    // IT99X0000000000000000000000 has the canonical Italian IBAN shape but
    // its MOD-97 residue is not 1. With the validator hook the regex must
    // NOT report it as a detection.
    const out = applyRegexRules('IBAN finto IT99X0000000000000000000000 ok')
    expect(out.text).toBe('IBAN finto IT99X0000000000000000000000 ok')
    expect(counts(out.detections).IBAN ?? 0).toBe(0)
  })

  it('matches an IBAN with 4-char-group whitespace separators (Pacchetto C)', () => {
    // Presidio-style separator-tolerant pattern. Documentary form
    // 'IT60 X054 2811 1010 0000 0123 456' is a verbatim ISO 13616 grouping.
    const out = applyRegexRules(
      'Bonifico verso IT60 X054 2811 1010 0000 0123 456 effettuato',
    )
    expect(out.text).toBe('Bonifico verso <IBAN> effettuato')
  })

  it('matches an IBAN with dash separators', () => {
    const out = applyRegexRules(
      'IBAN IT60-X054-2811-1010-0000-0123-456 chiusura',
    )
    expect(out.text).toBe('IBAN <IBAN> chiusura')
  })
})

describe('regex layer — CRO', () => {
  it('replaces a 13-digit CRO with prefix', () => {
    const out = applyRegexRules('CRO: 1234567890123')
    expect(out.text).toBe('CRO: <CRO>')
  })

  it('does NOT replace a 12-digit string after CRO', () => {
    const out = applyRegexRules('CRO: 123456789012 ok')
    expect(out.text).toContain('123456789012')
    expect(out.text).not.toContain('<CRO>')
  })
})

describe('regex layer — PROT', () => {
  it('replaces a protocol number with "prot. n." prefix', () => {
    const out = applyRegexRules('prot. n. MI/2024/001')
    expect(out.text).toBe('prot. n. <PROT>')
  })

  it('matches without the "n." separator', () => {
    const out = applyRegexRules('prot. RM/2024/12345 inviato')
    expect(out.text).toBe('prot. <PROT> inviato')
  })

  it('does NOT match a date-like substring without alpha prefix', () => {
    const out = applyRegexRules('data 12/2024/001 isolata')
    expect(out.text).toContain('12/2024/001')
  })
})

describe('regex layer — EMAIL', () => {
  it('matches a standard email', () => {
    const out = applyRegexRules('mario.rossi@studio.it scrive')
    expect(out.text).toBe('<EMAIL> scrive')
  })

  it('matches a PEC address', () => {
    const out = applyRegexRules('studio@pec.it')
    expect(out.text).toBe('<EMAIL>')
  })

  it('does NOT match a bare domain without local part', () => {
    const out = applyRegexRules('vai su studio.it per info')
    expect(out.text).toBe('vai su studio.it per info')
  })
})

describe('regex layer — combined input integrity', () => {
  it('replaces multiple categories in one pass and counts each', () => {
    const text =
      'CF RSSMRA70B03A662E, IBAN IT60X0542811101000000123456, email a@b.it'
    const out = applyRegexRules(text)
    const c = counts(out.detections)
    expect(c.CF).toBe(1)
    expect(c.IBAN).toBe(1)
    expect(c.EMAIL).toBe(1)
    expect(out.text).not.toMatch(/[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]/)
    expect(out.text).not.toMatch(/IT\d{2}[A-Z0-9]{23}/)
    expect(out.text).not.toContain('a@b.it')
  })
})
