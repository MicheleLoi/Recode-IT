import { describe, it, expect } from 'vitest'
import { applyRegexRules } from '../regex'

function counts(detections: ReturnType<typeof applyRegexRules>['detections']) {
  const c: Record<string, number> = {}
  for (const d of detections) c[d.category] = (c[d.category] ?? 0) + 1
  return c
}

describe('regex layer — CF (16-char alphanumeric)', () => {
  it('matches a canonical uppercase fiscal code', () => {
    const out = applyRegexRules('CF RSSMRA70B03A662X end')
    expect(out.text).toBe('CF <DS> end')
    expect(counts(out.detections).CF).toBe(1)
  })

  it('matches a lowercase OCR variant', () => {
    const out = applyRegexRules('cf rssmra70a01h501z')
    expect(out.text).toBe('cf <DS>')
  })

  it('matches the OCR-spaced variant', () => {
    const out = applyRegexRules('codice: RSSMRO 80A01 H501Z end')
    expect(out.text).toContain('<DS>')
    expect(out.text).not.toContain('RSSMRO 80A01 H501Z')
  })

  it('does NOT match a non-CF-shaped 16-char token', () => {
    const out = applyRegexRules('CONTRATTO12345678 is not a CF')
    expect(out.text).toBe('CONTRATTO12345678 is not a CF')
    expect(out.detections).toHaveLength(0)
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
    // Both IBANs are syntactically valid Italian forms (27 chars: IT + 2
    // digits + 23 alphanumerics).
    const out = applyRegexRules(
      'IT60X0542811101000000123456 then IT11A11111111111111111111X1',
    )
    expect((out.text.match(/<IBAN>/g) ?? []).length).toBe(2)
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
      'CF RSSMRA70B03A662X, IBAN IT60X0542811101000000123456, email a@b.it'
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
