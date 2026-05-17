# Perizia e Ricorso — Incidente Sciistico (Fendipista)

**Tipo documento:** Perizia medico-legale + ricorso per risarcimento  
**Usato in:** `test_drift.py` scenario A  
**Entity pattern:** 3 persone (CTU + vittima donna + sciatore straniero), 1 azienda S.p.A., CF × 3, P.IVA

<!-- GROUND TRUTH
Persone:
  - Giorgio Pellizzon (CTU / medico legale) → test: "Dott. Pellizzon", "il Pellizzon", "del Pellizzon"
  - Silvana Oberti (vittima, donna)          → test: "la Oberti", "dalla Oberti", "della Oberti"
                                                      articoli FEMMINILI — stress test critico
  - Marco Fuentes (sciatore, cognome straniero) → test: "il Fuentes", "del Fuentes", NER su cognome non italiano
Aziende:
  - Impianti Alpini Bellunesi S.p.A.         → test: nome lungo, suffisso S.p.A. (non S.r.l.)
Codici da anonimizzare (regex):
  - CF: PLLGRG65M01F205R, BRTSVN78A41A952K, FNTMRC85E01H501Y
  - P.IVA: 02345678901
Da preservare:
  - Date: 1 febbraio 1978, 1 maggio 1985, 15 gennaio 2025
  - Importi: Euro 87.400,00 / 124.000,00 / 211.400,00
  - Percentuali: 18%, 60%, 40%
Edge case:
  - Articoli femminili: "la Oberti", "dalla Oberti" (NER e recode devono ignorare il genere grammaticale)
  - Cognome straniero "Fuentes": verifica rilevamento NER
  - S.p.A. invece di S.r.l.: verifica regex suffisso nelle misure
  - Responsabilità ripartita: più soggetti con percentuali → non anonimizzare le percentuali
-->

---

## Documento

PERIZIA MEDICO-LEGALE E RICORSO PER RISARCIMENTO DANNI

Tribunale di Belluno — Sezione Civile

Il Dott. Giorgio Pellizzon (C.F. PLLGRG65M01F205R), medico legale iscritto
all'Ordine di Venezia, nominato CTU dal Tribunale, certifica quanto segue.

Silvana Oberti (C.F. BRTSVN78A41A952K), nata a Bolzano il 1 febbraio 1978,
ha riportato frattura scomposta del femore destro sulle piste da sci di
Cortina, gestite da Impianti Alpini Bellunesi S.p.A. (P.IVA 02345678901),
in data 15 gennaio 2025.

Marco Fuentes (C.F. FNTMRC85E01H501Y), nato a Madrid il 1 maggio 1985,
sciatore responsabile del sinistro, risulta assicurato per RC terzi.

La Oberti ha riportato: frattura del femore destro, trauma cranico lieve,
prognosi di 180 giorni con postumi permanenti stimati al 18%.
Il Fuentes ha dichiarato di procedere a velocita' moderata al momento
dell'impatto, dichiarazione confutata dalla testimonianza di tre presenti.

Il Dott. Pellizzon quantifica i danni della Oberti in Euro 87.400,00 per
invalidita' temporanea e in Euro 124.000,00 per invalidita' permanente,
totale Euro 211.400,00. La responsabilita' risulta ripartita: 60% a carico
del Fuentes, 40% a carico di Impianti Alpini Bellunesi S.p.A. per carenze
nella sorveglianza delle piste.
