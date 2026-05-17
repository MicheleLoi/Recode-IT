# Atto di Citazione — Appalto Edilizio

**Tipo documento:** Atto di citazione  
**Usato in:** `test_full_pipeline.py` (smoke test pipeline completa)  
**Entity pattern:** 3 persone (avv. + cliente + controparte), 1 azienda S.r.l., 4 città, CF × 2, P.IVA, IBAN

<!-- GROUND TRUTH
Persone:
  - Marco Ferrari (avvocato)     → test: "Avv. Ferrari", "il Ferrari", "Il Ferrari"
  - Giulia Romano (parte attrice) → test: "Romano", "della Romano", "in favore della Romano"
  - Paolo Bianchi (controparte)   → test: "Bianchi", "sig. Bianchi", "del Bianchi"
Aziende:
  - Costruzioni Meridionali S.r.l. → test: con/senza suffisso S.r.l.
Codici da anonimizzare (regex):
  - CF: FRRMRC80A01L219Z, RMNGLI85M41L219K
  - P.IVA: 01234567890
  - IBAN: IT60X0542811101000000123456
Da preservare:
  - Date: 15 agosto 1985, 15 gennaio 2025, 10 luglio 2025, 5 agosto 2025
  - Importi: Euro 3.500,00 / 21.000,00 / 7.000,00 / 14.000,00
  - Articolo: art. 1284 c.c.
Edge case: surname-only refs ("Romano", "Ferrari", "Bianchi") dopo prima intro completa
-->

---

## Documento

ATTO DI CITAZIONE

Tribunale di Torino — Sezione II Civile

L'Avv. Marco Ferrari (C.F. FRRMRC80A01L219Z), del Foro di Torino,
con studio in Via Garibaldi 12, Torino, difensore di:

Giulia Romano (C.F. RMNGLI85M41L219K), nata a Milano il 15 agosto 1985,
residente in Via Mazzini 5, Genova,

— di seguito "parte attrice" —

CITA

Costruzioni Meridionali S.r.l. (P.IVA 01234567890), con sede in Via Roma 10,
Torino, in persona del legale rappresentante sig. Paolo Bianchi,

— di seguito "parte convenuta" —

IN FATTO

1. In data 15 gennaio 2025, Romano e Costruzioni Meridionali S.r.l. stipulavano
   un contratto di locazione commerciale per un importo di Euro 3.500,00 mensili.

2. Il Ferrari, quale difensore di Romano, diffidava formalmente Costruzioni Meridionali
   a pagare il canone arretrato di Euro 21.000,00 con raccomandata del 10 luglio 2025.

3. Bianchi, in rappresentanza della convenuta, rispondeva negativamente.

4. La Costruzioni Meridionali versò un acconto di Euro 7.000,00 tramite
   bonifico (IBAN IT60X0542811101000000123456) in data 5 agosto 2025.

CONCLUSIONI

Si chiede che il Tribunale di Torino condanni Costruzioni Meridionali S.r.l. al pagamento
di Euro 14.000,00 in favore della Romano, oltre interessi ex art. 1284 c.c.
