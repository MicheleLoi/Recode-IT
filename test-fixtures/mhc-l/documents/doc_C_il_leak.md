# Citazione — Violazione NDA e Furto di Segreti Aziendali (Il Leak)

**Tipo documento:** Atto di citazione per violazione NDA e IP theft  
**Usato in:** `test_drift.py` scenario C  
**Entity pattern:** 3 persone (avv. + Ing. + ex-dipendente), 2 aziende (S.r.l. + S.p.A.), CF × 3, P.IVA × 2

<!-- GROUND TRUTH
Persone:
  - Pietro Lanzafame (avvocato)         → test: "Avv. Lanzafame", "il Lanzafame", "dell'Avv. Lanzafame"
  - Marta Colombo (Ing., CTO, donna)    → test: "Ing. Colombo", "l'Ing. Colombo", "della Colombo"
                                                  titolo tecnico + femminile
  - Alessandro Rinaudo (ex-dipendente)  → test: "il Rinaudo", "del Rinaudo", cognome solo
Aziende:
  - NovaBit S.r.l. (startup attrice)        → test: con/senza suffisso, "di NovaBit", "la NovaBit"
  - Axiom Technologies S.p.A. (convenuta)  → test: nome lungo, S.p.A. (non S.r.l.), azienda #2 → "Beta"
Codici da anonimizzare (regex):
  - CF: LNZPTR75H01H501Z, CLBMRT82D49H501V, RNDSND90A01H501W
  - P.IVA: 09876543210, 11223344556
Da preservare:
  - Date: 15 marzo 2021, 30 settembre 2024, 15 novembre 2024
  - Importi: Euro 2.400.000,00, Euro 400.000,00
  - Numeri: 847 file
Edge case:
  1. Due aziende → Alfa/Beta mapping: verifica che NovaBit e Axiom Technologies ricevano
     pseudonimi DIVERSI e coerenti nel documento.
  2. Titolo tecnico "Ing." su persona donna: il mapper strip-titolo funziona su "Ing."?
  3. Nome lungo con spazio: "Axiom Technologies S.p.A." — il PseudonymMapper gestisce
     il base name "axiom technologies" correttamente?
  4. Contesto tech: NER potrebbe ignorare termini come "Senior Developer", "machine learning",
     "algoritmi", "codice sorgente" — da verificare che non vengano anonimizzati
     (falsi positivi tecnici).
-->

---

## Documento

CITAZIONE PER VIOLAZIONE NDA E SOTTRAZIONE DI SEGRETI AZIENDALI

Tribunale di Roma — Sezione Specializzata Imprese

Avv. Pietro Lanzafame (C.F. LNZPTR75H01H501Z), del Foro di Roma,
difensore di:

NovaBit S.r.l. (P.IVA 09876543210), startup tecnologica con sede in Roma,
in persona della legale rappresentante Ing. Marta Colombo (C.F. CLBMRT82D49H501V),

— di seguito "parte attrice" —

CITA

Alessandro Rinaudo (C.F. RNDSND90A01H501W), ex-dipendente di NovaBit S.r.l.,
assunto attualmente presso:

Axiom Technologies S.p.A. (P.IVA 11223344556), con sede in Milano,

— di seguito "parte convenuta" —

IN FATTO

1. Il Rinaudo ha lavorato come Senior Developer presso NovaBit S.r.l.
   dal 15 marzo 2021 al 30 settembre 2024, con accesso privilegiato al codice
   sorgente e agli algoritmi ML sviluppati sotto la direzione dell'Ing. Colombo.

2. Prima di dimettersi, il Rinaudo ha copiato illegittimamente 847 file
   riservati su dispositivi personali, come documentato dall'analisi forense
   commissionata dall'Avv. Lanzafame a una societa' terza.

3. L'Ing. Colombo ha rilevato le anomalie entro due settimane dall'uscita
   del Rinaudo, constatando che algoritmi identici a quelli di NovaBit S.r.l.
   erano stati presentati da Axiom Technologies S.p.A. a una fiera di settore.

4. Il Lanzafame ha inviato diffida stragiudiziale sia al Rinaudo sia ad
   Axiom Technologies S.p.A. il 15 novembre 2024, rimasta senza risposta.

CONCLUSIONI

NovaBit S.r.l., tramite l'Avv. Lanzafame, chiede la condanna del Rinaudo
e di Axiom Technologies S.p.A. al risarcimento di Euro 2.400.000,00 e
l'inibitoria all'uso dei segreti sottratti. L'Ing. Colombo sara' teste principale.
