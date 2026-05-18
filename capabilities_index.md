---
artifact_type: capabilities_index
scope: Recode IT product capabilities (meta-index, not content)
authoritative_for: menu of capabilities + scope boundaries + delivery status snapshot + deltas from ratified PDL
NOT_authoritative_for: architecture details (see DESIGN.md), implementation tasks (see IMPLEMENTATION_PLAN.md), risk register (see OPEN_RISKS.md), test inventory (see TEST_PLAN.md)
last_synced: 2026-05-18
authored_by: MHC-Work portfolio governance
originated_in_session: SID-20260518-143605
related_pdl: ../MHC-Work/notes/pdl/pdl_recode_it_web_architecture_buildplan_20260517.md
maintenance: per phase status → consult git log + IMPLEMENTATION_PLAN.md; per delta from PDL → consult MHC-Work/_org/decision_log.md; canonical answer to "cosa fa Recode IT oggi?" + "cosa esplicitamente non fa?"
---

# Recode IT — Capabilities Index

**Scopo.** Statement autoritativo (per MHC-Work strategy + comm + roadmap) di cosa Recode IT è oggi, cosa è già implementato, cosa è ancora in pianificazione, e dove l'implementazione diverge dal PDL ratificato. Specchia il pattern di `MHC-L/capabilities_index.md`: meta-index che punta a fonti canoniche, non duplica contenuto.

**Quando usarlo:**
- Strategy session: "cosa è il prodotto Recode IT oggi, su cosa posso fare claim?"
- Comm review: "questo claim è coerente con quello che Recode IT fa? esiste oversell?"
- Roadmap planning: "cosa manca a Recode IT per il lancio pubblico?"

**Quando NON usarlo:**
- Per dettagli implementativi → DESIGN.md
- Per task per fase → IMPLEMENTATION_PLAN.md
- Per stato test → TEST_PLAN.md + commit recenti
- Per rischi → OPEN_RISKS.md

---

## 1. Cos'è Recode IT

Recode IT è uno strumento web italiano di **pseudonimizzazione e ripristino** di documenti professionali sensibili. L'avvocato (commercialista, amministrazione pubblica) trascina un documento sulla pagina, vede una versione con i dati sensibili sostituiti, la rivede, la copia, la porta nel **suo** Claude (claude.ai, Claude Code, o altro ambiente AI a sua scelta), recupera la risposta, e torna su Recode IT per ricostruire i nomi reali.

**Cardine architetturale:** Recode IT non chiama mai Claude/Anthropic. È un tool di pre-processing privacy. L'utente porta il testo pseudonimizzato esternamente. Conseguenze: nessuna credenziale Anthropic lato server, nessun costo token a carico del founder, nessuna dipendenza di uptime da Anthropic.

**Audience.** Avvocati e commercialisti italiani in studio (target primario). Amministrazioni comunali/regionali e welfare (target secondario). Audience consumer non targetizzata ma ammessa via self-selection.

**Brand.** RegIA è il brand ombrello che vende Recode IT come prodotto di punta.

---

## 2. Architettura — sintesi

Stack ratificato (DESIGN.md §3 + commit `7dba25e` + pivot modello `6887387`):

- **Browser:** React + TypeScript + Vite. Pseudonimizzazione in WebAssembly via onnxruntime-web + Transformers.js. Estrazione testo: pdf.js, mammoth.js, plain.
- **Modello NER:** `osiria/distilbert-italian-cased-ner` ONNX int8 (~66 MB), distribuito come asset statico. **Sostituisce GLiNER del PDL** — vedi §5 delta D1.
- **Backend:** Python + Starlette + SQLite, co-ospitato su `mhc.micheleloi.pro` (riuso infrastruttura MHC-L). Auth JWT, blob storage zero-knowledge, recovery codes.
- **Cifratura mapping:** Argon2id (lato browser) deriva master key dalla password utente. AES-256-GCM cifra il mapping. Il server vede solo bytes opachi.
- **Domain:** `micheleloi.pro/recode-it/` (landing + SPA).

**Modello dati split-knowledge** (DESIGN.md §4):
- Computer utente: documenti + pseudonimizzazione + chiave (in RAM only).
- Server: blob cifrati. Mai vede i nomi reali, mai vede i documenti, mai conosce la chiave.
- Anthropic: solo pseudonimi (l'utente porta il testo).

---

## 3. Stato di implementazione — fasi consegnate vs piano

PDL ratificato 2026-05-17 articola la costruzione in 7 fasi (Phase 0–6 in `IMPLEMENTATION_PLAN.md`). Stato al 2026-05-18:

| Fase | Cosa prevedeva | Stato | Riferimento |
|---|---|---|---|
| 0 — Scaffold | Vite+React+TS+Vitest, fixtures MHC-L copiate, script goldens stub | **DONE** | commit `c5aca31` |
| 1 — Engine port | regex IT + stoplist + pool pseudonimi + PseudonymMapper + regressioni A-1/A-2/A-3 | **DONE** | commit `aab6961` |
| 2 — Two-panel UI | drag-drop, anteprima, recode, copy widget, entity review con flusso falso-positivo | **DONE** (Phase 5 falso-positivo assorbita qui) | commit `4fd7fb7` |
| 3 — Auth + backend | signup/login JWT cookie, endpoint zero-knowledge `/recode/mappings/*`, Argon2id + AES-GCM client | **DONE backend; UX wiring frontend PENDING** — vedi §6 | commit `ac164ff` |
| 4 — NER WASM + equivalence test | onnxruntime-web GLiNER + test di equivalenza numerica vs Python | **DONE con sostituzione modello** — vedi §5 delta D1 | commit `7dba25e` + pivot `6887387` + `7e0ff63` |
| 5 — Falso-positivo UX | tre bottoni in entity review | **FOLDED in Phase 2** | commit `4fd7fb7` |
| 6 — Launch readiness | mobile detect, CSP, landing page, lighthouse audit, dependency audit, end-to-end smoke | **NON INIZIATA** | — |

**Stato empirico end-to-end (2026-05-18):** dopo i 4 bug infrastrutturali fissati (commit `52d3967`) e il fix del decoder (commit `3eded98`), la pipeline browser riconosce 6/6 entità sul test canonico e ha cold start veloce. Il flusso pseudonimizza-recode su **singolo documento in singola sessione** funziona.

---

## 4. Eredità da MHC-L

Recode IT non è un greenfield NER. Ri-confeziona una pipeline già validata empiricamente in produzione MHC-L da aprile 2026.

Ereditato (vedi DESIGN.md §2):
- Regex italiani (codici fiscali con prefissi, P.IVA, IBAN IT, CRO, PROT, EMAIL) — port letterale Python → TypeScript
- Stoplist legale italiana (LEGAL_STOPLIST, FALSE_POSITIVE_PATTERNS) — port letterale
- Pool pseudonimi tradizione legale italiana (Tizio, Caio, Sempronio, Metropoli, ecc.) — port letterale
- Logica PseudonymMapper (entity-cluster, coreference, normalizzazione corti/organizzazioni/società IT)
- Tre fix architetturali documentati in `MHC-L/dev/ANONYMIZER_BUGS.md`: A-1 (collisione cognomi condivisi), A-2 (esenzione *de cuius* per Considerando 27 GDPR), A-3 (elisione articoli prima dei titoli)
- Posizione GDPR / DPA — `MHC-L/legal/DPA.md` §2.2.2–§2.2.4: pseudonimizzazione come misura tecnica Art. 32 sotto controllo del Titolare, con obbligo di revisione pre-trasmissione. **Recode IT eredita questa posizione verbatim — niente nuova consultazione legale richiesta pre-lancio.**
- Workflow multi-step (Pass 1 PERSONA+regex / riflessione utente / Pass 2 opt-in luoghi/organizzazioni)

**Non ereditato:** trasporto MCP (Recode IT è SPA, non MCP server), runtime Python (sostituito da ONNX-in-browser), mapping solo-in-RAM (Recode IT aggiunge persistenza zero-knowledge opt-in).

---

## 5. Deltas dal PDL — decisioni post-ratifica

Cinque scostamenti rispetto al PDL del 2026-05-17, da documentare per coerenza:

### D1 — Modello NER: GLiNER → DistilBERT IT

Il PDL §"Architettura corretta" e DESIGN.md v1.0 §3 prevedevano `urchade/gliner_multi-v2.1` ONNX quantizzato come engine NER browser. **Decisione founder ratificata 2026-05-18** (Ockham + sunk-cost avoidance) ha pivotato a [`osiria/distilbert-italian-cased-ner`](https://huggingface.co/osiria/distilbert-italian-cased-ner):
- Modello IT-nativo addestrato su testo italiano (vs GLiNER multilingue)
- ~66 MB int8 vs ~80-120 MB GLiNER int8 — 3× più piccolo
- Conseguenza: il test di equivalenza golden-file vs Python `anonymize.py` GLiNER NON è più il contratto di accettazione. Validazione empirica via test 6/6 entità sul fixture canonico.
- DESIGN.md §8.6 (descrizione GLiNER ONNX in browser) ha bisogno di propagation update — deferred fino a stabilizzazione completa del nuovo modello.

### D2 — Phase 5 (falso-positivo UX) assorbita in Phase 2

Il PDL prevedeva Phase 5 separata (1 Sonnet-settimana) per i tre bottoni `[Accetta] [Cambia categoria] [Falso positivo]`. Eseguita all'interno del commit Phase 2 (`4fd7fb7`). Riordinamento esecuzione, niente scope change.

### D3 — Q4 obsoleta confermata in build

Il PDL aveva dichiarato OBSOLETA la Q4 ("backend proxy Anthropic API") pre-build. Onorata architetturalmente nell'implementazione: il server Recode IT non ha credenziali Anthropic, non spende token, non dipende dall'uptime API Anthropic.

### D4 — Pro tier server (enhancement futuro PDL)

Il PDL faceva riferimento a [`recode_it_pro_tier_server_architecture_20260518.md`](../MHC-Work/notes/research/mhc-l/recode_it_pro_tier_server_architecture_20260518.md) — architettura split-knowledge Master/Slave/Storage con consulente esterno (~€50-120k/anno operating cost). Fuori scope MVP. **Parcheggiato indefinitamente** fino a product-market-fit dimostrato + ARR ≥ €500k/anno (criteri PDL).

### D5 — Cowork bridge conversazionale (enhancement futuro PDL)

Il PDL Phase 2 prevedeva skill bundled nella meta-skill MHC-L cowork con paste-once API key, fetch/recode conversazionale ("carica il mio ultimo lavoro su Recode IT"). Fuori scope MVP. **Parcheggiato indefinitamente** fino a validazione del core hypothesis con tester reali.

### D6 — Schema falso-positivi server-side: `term` → `pseudonym`

Il PDL Q proponeva schema `user_false_positive_preferences(user_id, term, originally_detected_category)`, dove `term` è il termine originale ("Emilia"). Il DESIGN.md §6 del build ha modificato a `pseudonym` (es. "Metropoli") con la motivazione che il server non deve mai vedere nomi originali.

**Implicazione operativa:** la memoria dei falsi-positivi viaggia con il **mapping cifrato del documento** (campo `isFalsePositive: bool` per entry — DESIGN §8.7), NON con la tabella server-side. La tabella server-side resta come segnale aggregato per il futuro miglioramento del modello, non come meccanismo di re-learning lato utente.

Conseguenza per l'utente: la marca "Emilia non è una persona" persiste **dentro un mapping**. Se l'utente apre il mapping della Causa X (gesto §6 "estendi mapping esistente") e ci aggiunge un nuovo documento della stessa causa, la marca segue. Se passa a una causa diversa (mapping diverso), riparte da zero — comportamento ragionevole perché cause diverse hanno contesti diversi e ciò che è falso-positivo in una potrebbe non esserlo in un'altra.

Da verificare retroattivamente con il founder se questa modifica fosse intenzionale o drift autonomo del build agent.

---

## 6. Cosa Recode IT NON fa (boundaries autoritative)

### 6.1 Boundaries architetturali

- **Non chiama mai Claude/Anthropic.** È pre-processing privacy. L'utente porta il testo pseudonimizzato nel suo ambiente Claude esterno. Nessuna credenziale Anthropic lato server Recode IT.
- **Server zero-knowledge ma non zero-availability.** Il server non può decifrare i mapping (la chiave non lascia mai il browser). Ma il server è necessario per persistenza cross-session e cross-device. Se il server è giù, l'utente perde "salva e riprendi domani" (la pseudonimizzazione in-sessione resta funzionante).
- **Recovery codes sono distruttivi.** Usare un codice di recupero per resettare la password elimina permanentemente tutti i mapping salvati. Conseguenza architetturale del zero-knowledge: il server non ha modo di re-derivare la chiave vecchia. Documentato in OPEN_RISKS.md R-05 + avviso esplicito utente.

### 6.2 Boundaries di scope feature

- **NER ha recall ~70-80%.** L'utente DEVE rivedere il preview prima di copiare. La revisione è obbligo contrattuale del Titolare (DPA §2.2.4 ereditato). Il pannello entity review è la materializzazione dell'obbligo, non cosmetica.
- **Continuità degli pseudonimi cross-document = capacità latente.** L'architettura zero-knowledge persistente + il gesto UX "apri mapping esistente prima del drag-drop" producono coerenza fra atti della stessa causa (Mario Rossi resta Tizio in tutti gli atti). **Il gesto UX non è ancora wired nel frontend** — vedi §7 priorità pre-MVP.
- **Apprendimento falso-positivi cross-document = funziona dentro lo stesso mapping di causa, NON tra cause diverse.** Vedi §5 delta D6.
- **Niente OCR per PDF scannerizzati.** PDF text-extractable supportati via pdf.js. Scannerizzati: messaggio "carica come testo o usa PDF con testo incorporato — OCR in Phase 2". (PDL Q8 risolta.)
- **Niente build mobile.** Detect mobile → messaggio "apri da computer desktop". Signup possibile da mobile, upload/pseudonimize/recode bloccato. (PDL Q9 risolta.)
- **Niente drafting capability native.** Sprint separato post-MVP. Pattern marker-injection ispirato a Mike-redline (AGPL escluso da import diretto).

### 6.3 Boundaries di processo

- **Recode IT non sostituisce il controllo umano** sull'output AI. L'utente porta il testo a Claude esternamente, gestisce il workflow nel suo ambiente, riceve la risposta, e Recode IT solo ricostruisce i nomi reali.
- **Recode IT non offre garanzie SLA** in fase prototipo — server availability è "best effort".

---

## 7. Roadmap

### Pre-MVP — priorità: wire UX persistenza (CRITICAL)

Empirica founder 2026-05-18: *"dopo aver pseudonimizzato un documento il flusso si blocca, e facendo refresh la chiave si perde."* Il backend Phase 3 esiste; ciò che manca è il wiring frontend del save/open/extend di mapping. Senza questo, Recode IT è un tool single-doc single-session — capacità tecniche presenti, esperienza utente bloccata.

Tasks (delegati a coding agent in sessione separata):
- [ ] Wire UI signup/login (se non già completo) + persistenza JWT in sessionStorage
- [ ] Wire bottone "Salva mapping" → derive master key → encrypt → POST `/recode/mappings/` con label utente
- [ ] Wire dashboard "I miei mapping" → lista da GET `/recode/mappings` ordinata per `last_accessed_at`
- [ ] Wire click su mapping in dashboard → GET blob → decrypt → seed engine in stato "attivo" (mapping caricato in memoria)
- [ ] Wire gesto "estendi mapping esistente": quando un mapping è in stato attivo e l'utente droppa un nuovo documento, l'engine estende invece di resettare. Coerenza pseudonimi e marche falso-positivo persistono attraverso documenti della stessa causa.
- [ ] Avviso explicit pre-recovery-code: warning a tre step + checkbox "scrivi ELIMINA per confermare" (OPEN_RISKS.md R-05 mitigation)
- [ ] Acceptance: round-trip cross-doc verde — pseudonimizza Doc1 stessa-causa, salva, refresh tab, login, apri mapping, droppa Doc2, verifica Mario Rossi → Tizio in entrambi i documenti

### MVP gate — Phase 6 launch readiness (post-persistenza)

Per IMPLEMENTATION_PLAN.md §"Phase 6":
- [ ] Mobile detection overlay implementato + testato
- [ ] Audit error states (DESIGN §10 walk-through)
- [ ] CSP header configurato (scoped a `/recode-it/`, NON globale, vedi OPEN_RISKS.md R-09)
- [ ] Sezione "Come funziona / Verificabilità privacy" nella UI (guida DevTools per pitch DPO)
- [ ] End-to-end smoke test (TEST_PLAN.md §4) — esecuzione founder
- [ ] Landing page `micheleloi.pro/recode-it/` scritta + deployata
- [ ] Lighthouse audit (LCP < 3s desktop)
- [ ] `npm audit` + `pip-audit` clean — zero high/critical

### Post-MVP (parcheggi)

- Pro tier server architecture (split-knowledge esterno, consulente DPO) — gate ARR
- Cowork bridge conversazionale (skill bundled in meta-skill MHC-L) — gate validazione MVP
- OCR per PDF scannerizzati — gate evidenza domanda
- Drafting capability native (marker-injection) — sprint separato post-PMF
- Build mobile — gate evidenza uso reale post-MVP

---

## 8. Integrazione portfolio

- **Brand ombrello.** RegIA vende Recode IT come prodotto di punta. Cowork meta-skill MHC-L è prodotto separato con stessa filosofia ma audience diversa (avvocati che usano cowork Anthropic). Pitch unificato: privacy *abbastanza* per sbloccare paralisi GDPR — NON privacy paranoica.
- **Backend co-hosting.** `mhc.micheleloi.pro` ospita anche Recode IT (riuso Stripe/email/webhook MHC-L). Discriminazione `recode_users` vs `applications` (MHC-L) via schema additivo.
- **Coesistenza con MHC-L Phase 1 desktop.** I 2-3 tester legacy restano in vita. Indipendenti tecnicamente. Phase 2 cowork bridge conversazionale = integrazione opt-in futura.
- **Governance MHC-Work.** Decisioni cross-prodotto registrate in `MHC-Work/_org/decision_log.md`. Lavorazione dialettica in `MHC-Work/_org/synthesis/`. Questo capabilities_index è il pendant Recode-IT di `MHC-L/capabilities_index.md` — entrambi viventi nei rispettivi repo prodotto per coerenza con la routing rule `adapt.md`.

---

## 9. Local persistence design (free tier — pending pricing decision)

Specifica tecnica + UX ratificata in dialogo founder ↔ chief_of_staff durante SID-20260518-143605, **pending decisione pricing del founder**. Se la decisione approda a Branch X (freemium con persistenza locale device-singolo + paid €X cross-device), questa sezione è il canon implementativo per la seconda iterazione di coding (post completion dell'agent server-side attualmente in background).

### 9.1 Storage — IndexedDB in chiaro, no cifratura

Persistenza locale via **IndexedDB** (non `localStorage` — IndexedDB scala oltre 5MB e supporta blob strutturati). Database privato del browser ("recode-it"), letture/scritture async, dato in cartella privata del browser sul disco utente.

**Decisione: dato in chiaro, niente cifratura aggiuntiva.**

Razionale: il browser dell'avvocato vive sullo stesso PC dove sta il file Word originale con i nomi veri. La chiave (Mario Rossi → Tizio) ha lo stesso livello di sensibilità del file originale e vive nello stesso luogo. Cifrarla con una password aggiuntiva sarebbe sicurezza teatrale — chi entra nel browser ha già accesso al file originale a portata di mano. Sicurezza coerente con il modello fisico del computer privato dell'avvocato.

### 9.2 Upgrade flow free → paid — bottone "Trasferisci chiavi sul cloud"

Formulazione esatta: **"Trasferisci chiavi sul cloud"**. Non "Trasferisci tutto". La precisione è doctrine — l'utente capisce che si trasferisce solo il vocabolario di sostituzione, NON documenti né contenuti.

Behavior: l'utente firma per il paid, riceve dialog "Trasferisci chiavi sul cloud", click → il browser deriva master_key da password+argon2_salt → cifra ogni mapping locale lato browser → POST `/recode/mappings/` per ciascuno. Da quel momento i mapping vivono sul server (cifrati), il locale può essere svuotato o restare come copia ridondante (decisione UX da raffinare).

### 9.3 Claim zero-knowledge — dove va chiarito nella UI

Tre punti specifici, non uno solo:

1. **Dialog del trasferimento** (frase canonica candidata):
   > *"Le tue chiavi vengono cifrate qui nel tuo browser con la tua password, e mandate sul nostro server come dati incomprensibili. Né noi né nessun altro può leggerle senza la tua password — nemmeno se ce le chiedono i giudici."*
   
   La chiusa *"nemmeno se ce le chiedono i giudici"* è cruciale: materializza il claim invece di lasciarlo astratto, e parla la lingua di un avvocato.

2. **Landing page del paid** (banner sopra il fold):
   > *"Le chiavi del tuo studio, cifrate nel tuo browser prima di partire. Sul nostro server arrivano già illeggibili."*

3. **Dashboard "I miei mapping" del paid** (riga sotto il titolo):
   > *"Tutte le chiavi qui sono cifrate end-to-end. Il server vede solo bytes incomprensibili."*

Vocabolario: si descrive il behavior, NON si nomina "zero-knowledge" come termine tecnico marketing. L'avvocato non-tech deve capire cosa succede, non imparare un'etichetta.

### 9.4 Cambiamenti backend

**Zero.** Il free locale non parla mai col server. Il backend esistente (commit `ac164ff` Phase 3) serve solo il paid.

### 9.5 Scenari di failure UX

Da gestire nella implementazione di seconda iterazione:
- Utente cambia browser sullo stesso PC → mapping locali non visibili dal nuovo browser. Messaggio: *"Non trovi le tue chiavi? Sono nel browser dove le hai salvate. Per averle dappertutto, considera l'upgrade."*
- Utente cancella i dati del browser ("cancella cronologia / cookie / dati siti") → mapping locali persi. Avviso onboarding free al primo salvataggio: *"Le chiavi vivono nel browser di questo computer. Se cancelli i dati del browser, vanno perse. Per averle al sicuro su cloud, considera l'upgrade."*
- Utente cambia computer → mapping non disponibili. Stessa narrazione di upgrade.

### 9.6 Status

**Pending decisione pricing.** Implementazione attivata solo se Branch X (freemium con local). Se Branch Y (single-session free pura) o altra configurazione, questa sezione resta come specifica archiviata, non eseguita.

Authority: dialogo founder ↔ chief_of_staff SID-20260518-143605, ratifica founder verbatim "cifrare: no, assurdità" + bottone "Trasferisci chiavi sul cloud" + chiarire subito la cifratura zero knowledge.

---

*Recode IT capabilities_index — last synced SID-20260518-143605. Authored by MHC-Work portfolio governance. Coerenza con PDL ratificato 2026-05-17 + decision_log 2026-05-17 §"Pivot architetturale" + ratifica founder in-session 2026-05-18 §9 (persistenza locale design).*
