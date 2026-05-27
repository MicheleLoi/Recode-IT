# Atto di Opposizione — Successione Ereditaria (L'Eredità)

**Tipo documento:** Atto di opposizione a testamento olografo  
**Usato in:** `test_drift.py` scenario B  
**Entity pattern:** 4 persone, nessuna azienda, CF × 4 — edge case: cognome condiviso tra due parti

<!-- GROUND TRUTH
Persone:
  - Rossella Amadori (avvocato)          → test: "Avv. Amadori", "l'Amadori", "dell'Amadori"
  - Erminia Vanzetti (vedova/opponente)  → test: articoli femminili, "la Vanzetti"
  - Tarcisio Vanzetti (figlio/resistente) → EDGE CASE: stesso cognome di Erminia Vanzetti
                                           Il mapper assegnerà lo stesso pseudonimo?
                                           Questo è il bug da rilevare.
  - Carlo Brambilla (notaio)             → test: "Notaio Brambilla", "il Brambilla", "del Brambilla"
Non-PII ma referenziato: "de cuius / Arturo Vanzetti" — terzo non parte, potrebbe essere rilevato da NER
Codici da anonimizzare (regex):
  - CF: MDRRSL79D41F205Z, VNZRMN52C67F205E, VNZTRS78H01F205A, BRMCRL55D01F205A
Da preservare:
  - Date: 27 marzo 1952, 1 giugno 1978, 12 agosto 2024, 3 marzo 2024
  - Articoli: artt. 536 c.c., art. 116 c.p.c.
Edge case CRITICI:
  1. Cognome condiviso: Erminia e Tarcisio ENTRAMBI Vanzetti.
     Il mapper registra "vanzetti" → primo pseudonimo assegnato.
     Tarcisio dovrebbe ricevere un pseudonimo DIVERSO ma potrebbe collisionare.
     QUESTO TEST RILEVA SE IL MAPPER HA UN BUG DI COLLISIONE SU COGNOMI CONDIVISI.
  2. De cuius "Arturo Vanzetti": è terzo (non parte), NER lo rileva ma non dovrebbe
     essere confuso con le parti processuali.
  3. 4 persone con nessuna azienda: test di scenario person-only.
-->

---

## Documento

ATTO DI OPPOSIZIONE AL TESTAMENTO OLOGRAFO

Tribunale di Milano — Sezione Successioni

L'Avv. Rossella Amadori (C.F. MDRRSL79D41F205Z), del Foro di Milano,
difensore di:

Erminia Vanzetti (C.F. VNZRMN52C67F205E), nata a Lecco il 27 marzo 1952,
vedova del de cuius Arturo Vanzetti, deceduto il 12 agosto 2024,

— di seguito "opponente" —

contro:

Tarcisio Vanzetti (C.F. VNZTRS78H01F205A), nato a Milano il 1 giugno 1978,
figlio del de cuius, beneficiario esclusivo del testamento olografo
datato 3 marzo 2024,

— di seguito "resistente" —

IN FATTO

1. Il de cuius, con testamento olografo del 3 marzo 2024, redatto senza
   assistenza del Notaio Carlo Brambilla (C.F. BRMCRL55D01F205A),
   ha disposto di lasciare l'intero patrimonio al figlio Tarcisio Vanzetti,
   escludendo la moglie Erminia Vanzetti.

2. L'Avv. Amadori ritiene il testamento nullo: il sig. Arturo Vanzetti,
   all'epoca della redazione, era affetto da decadimento cognitivo certificato.

3. Il Notaio Brambilla, interpellato dall'Avv. Amadori, ha dichiarato
   di non aver assistito alla redazione del testamento impugnato.

4. Tarcisio Vanzetti si e' rifiutato di fornire all'Amadori la documentazione
   medica relativa allo stato di salute del defunto padre.

CONCLUSIONI

L'Avv. Amadori chiede che sia dichiarata la nullita' del testamento,
ripristinando i diritti successori di Erminia Vanzetti ai sensi degli
artt. 536 e ss. c.c. Si chiede l'audizione del Notaio Brambilla come teste.
