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
| 3 — Auth + backend + frontend wiring | signup/login JWT cookie, endpoint zero-knowledge `/recode/mappings/*`, Argon2id + AES-GCM client + UX save/open/extend mapping + recovery 3-step ELIMINA gate | **DONE** | commits `ac164ff` (backend) + `0f26c3d` `414b6a6` `939c921` `e16cc89` (frontend) |
| 4 — NER WASM + equivalence test | onnxruntime-web GLiNER + test di equivalenza numerica vs Python | **DONE con sostituzione modello** — vedi §5 delta D1 | commit `7dba25e` + pivot `6887387` + `7e0ff63` |
| 5 — Falso-positivo UX | tre bottoni in entity review | **FOLDED in Phase 2** | commit `4fd7fb7` |
| 6 — Launch readiness | DOCX/PDF support, OCR-Pro framing, deploy + TLS, MIME headers, end-to-end smoke | **DEPLOY DONE; END-TO-END ACCEPTANCE TEST PENDING FOUNDER** | commits `71078ed` `911ea3e` (DOCX/PDF) + `1b93135` (model URL fix) — vedi §5 D7 + D8 |
| Account zero-euro (€0, named) — IndexedDB locale + signup nome+marketing consent | tier free persistence client-side, signup esteso, banner verifica email, schema utenti backend con `name` + `marketing_consent_*` | **DONE in branch `feat/zero-euro-tier-indexeddb`** (pending merge a main + acceptance founder) | commits `d59445e..HEAD` (backend tier=free + storage IDB + auth tier-aware + UI signup+banner + tests cleanup) — vedi §9 |

**Stato empirico end-to-end (2026-05-18 SID-20260518-143605):** Recode IT LIVE su `https://recode.micheleloi.pro/`. Deploy stack: nginx subdomain dedicato + TLS Let's Encrypt + COOP/COEP/CORP cross-origin isolation + MIME types corretti per `.mjs`/`.wasm`/`.onnx` + backend Starlette ASGI in systemd su `127.0.0.1:8001` proxy via nginx. Frontend bundle SPA in `/var/www/recode-it/` con worker NER + modello DistilBERT IT 67 MB int8. **ORT InferenceSession.create verificato green nel browser** (input names: `input_ids`, `attention_mask`). Pseudonimizza-recode su singolo documento in singola sessione funziona. Persistenza server-side (save/open/extend mapping cross-doc cross-session via gesto "estendi") implementata e in attesa di acceptance test founder.

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

### D7 — Deploy topology: subdomain dedicato `recode.micheleloi.pro` + landing WordPress su `micheleloi.pro/recode-it/`

Ratificato dal founder durante la sessione di deploy 2026-05-18 (SID-20260518-143605). Il **prodotto vero** (la SPA con drag-drop, pseudonimize, recoda) vive su `recode.micheleloi.pro` (nginx VPS, TLS Let's Encrypt). Il **sito che descrive il prodotto** (landing, istruzioni, copy marketing) vive su `micheleloi.pro/recode-it/` (WordPress, founder gestisce in Elementor).

Le due superfici sono collegate da un CTA "Apri Recode IT" sulla landing. Razionale per il subdomain dedicato (anziché subpath WordPress): COOP/COEP/CORP headers richiesti per WebAssembly multi-thread sono incompatibili con WordPress globale — un subdomain isola lo scope. Vedi `OPEN_RISKS.md` R-09 resolution.

### D8 — Model URL: same-origin relative (was hardcoded cross-origin)

Bug fixato durante deploy (commit `1b93135`). Il codice pre-deploy aveva `PRODUCTION_MODEL_URL` hardcoded a `'https://mhc.micheleloi.pro/recode-it/models/distilbert_italian_ner_q8.onnx'` — sbagliato per due ragioni: (a) il subdomain corretto è `recode.`, non `mhc.` (`mhc.` è infrastruttura interna MHC-L); (b) anche se fosse stato `recode.`, un fetch cross-origin sarebbe bloccato da COEP `require-corp` mancando CORP cross-origin sul lato `mhc.`.

Fix: path relativo `/models/distilbert_italian_ner_q8.onnx`, valido in dev (Vite serve `public/models/`) e in prod (nginx serve `/var/www/recode-it/models/`). Same-origin enforce architettonicamente il claim "nulla esce dal computer dell'utente": ogni risorsa caricata dalla pagina vive sullo stesso server, niente terze parti, niente CDN esterni.

### D9 — nginx MIME types per ESM `.mjs` (lesson learned deploy 2026-05-18)

nginx default `mime.types` NON include `.mjs` come `application/javascript` — di default serve `.mjs` come `application/octet-stream`. I browser rifiutano di eseguire moduli ESM con MIME non-JS. Conseguenza: ORT `InferenceSession.create()` fallisce con `"Failed to fetch dynamically imported module: ...jsep.mjs"`, il worker rebrand come `ERR_MODEL_NOT_FOUND` (misleading). Fix server-side: `types{}` block nel nginx server context con mapping esplicito `application/javascript js mjs;` + `application/wasm wasm;` + `Cache-Control: no-cache, must-revalidate` su `.mjs`/`.wasm`/`.onnx`/`.json` (location regex) per prevenire stick-cache di risposte vecchie. Dettaglio completo in `OPEN_RISKS.md` R-11.

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
- **Continuità degli pseudonimi cross-document = capacità attivata.** L'architettura zero-knowledge persistente + il gesto UX "apri mapping esistente prima del drag-drop" producono coerenza fra atti della stessa causa (Mario Rossi resta Tizio in tutti gli atti). Wiring completato 2026-05-18 nei commit `0f26c3d` (engine EXTEND mode) + `414b6a6` (active-mapping context) + `939c921` (UI). Test `extend_mode.test.ts` green (Tier-1 hit verificato sul mapper).
- **Apprendimento falso-positivi cross-document = funziona dentro lo stesso mapping di causa, NON tra cause diverse.** Vedi §5 delta D6.
- **Niente OCR per PDF scannerizzati.** PDF text-extractable supportati via pdf.js. Scannerizzati: messaggio "carica come testo o usa PDF con testo incorporato — OCR in Phase 2". (PDL Q8 risolta.)
- **Niente build mobile.** Detect mobile → messaggio "apri da computer desktop". Signup possibile da mobile, upload/pseudonimize/recode bloccato. (PDL Q9 risolta.)
- **Niente drafting capability native.** Sprint separato post-MVP. Pattern marker-injection ispirato a Mike-redline (AGPL escluso da import diretto).

### 6.3 Boundaries di processo

- **Recode IT non sostituisce il controllo umano** sull'output AI. L'utente porta il testo a Claude esternamente, gestisce il workflow nel suo ambiente, riceve la risposta, e Recode IT solo ricostruisce i nomi reali.
- **Recode IT non offre garanzie SLA** in fase prototipo — server availability è "best effort".

---

## 7. Roadmap

### Pre-MVP wiring (DONE 2026-05-18)

Wire persistenza zero-knowledge + gesto "estendi mapping" — risolto il blocco "dopo pseudonimizzato refresh perde chiave" segnalato dal founder. Tasks chiusi:

- [x] Client crypto module (Argon2id + AES-256-GCM via SubtleCrypto, IV fresh per call) — commit storico `ac164ff`
- [x] UI signup/login + persistenza JWT in `sessionStorage` (non `localStorage` per DESIGN §5.3)
- [x] Bottone "Salva mapping" funzionante (input label, derive master_key, encrypt, POST)
- [x] Dashboard "I miei mapping" con `[Apri]` + `[Elimina]` + bulk delete + sort by `last_accessed_at` desc
- [x] Gesto "Apri mapping esistente" → seed PseudonymMapper in stato attivo + badge "Mapping attivo: <label>"
- [x] Gesto "Estendi mapping attivo" → drop nuovo doc → mapper NON resetta, estende (Mario Rossi → Tizio in entrambi Doc1+Doc2)
- [x] Recovery codes destruction warning a 3 step (R-05 mitigation): avviso + checkbox + textbox "scrivi ELIMINA"
- [x] Beforeunload warning se mapping attivo non salvato
- [x] DOCX/PDF extraction (pdfjs-dist + mammoth) + scanned-PDF modal con framing "OCR piano Pro in arrivo"

Test suite Vitest: **208/208 green** post-wiring. Critical: `extend_mode.test.ts` (cross-doc Tier-1 hit), `active-mapping-context.test.tsx` (blob round-trip preservazione `isFalsePositive`), `RecoveryPage.test.tsx` (3-step gate non bypassabile).

### Deploy production (DONE 2026-05-18)

- [x] DNS A record `recode.micheleloi.pro` → IP VPS Vienna (easyname)
- [x] TLS Let's Encrypt cert provisioning via certbot, auto-renew schedulato
- [x] Backend `recode-it-backend.service` systemd: uvicorn `127.0.0.1:8001`, venv `/opt/recode-it-backend/`, DB SQLite `/opt/recode-it-backend/recode-it.db`, JWT secret env, CORS scoped
- [x] nginx server block subdomain con COOP/COEP/CORP headers + MIME `.mjs`/`.wasm`/`.onnx`/`.json` + `Cache-Control: no-cache` su asset ESM/binary
- [x] Frontend `npm run build` + upload `dist/` → `/var/www/recode-it/` (preserva `models/` ONNX)
- [x] Smoke test pubblico verificato green: `GET /` → 200 + index.html + COOP/COEP headers; `GET /recode/me` → 401; ORT InferenceSession.create → green (input names `input_ids`, `attention_mask`)

### Acceptance test end-to-end (PENDING founder)

Test canonico in ambiente reale (browser fresh / incognito):
- [ ] Signup nuovo account → email Resend con 10 recovery codes ricevuta
- [ ] Login con credenziali
- [ ] Drop Doc1 (Mario Rossi) → preview pseudonimizzato con Tizio
- [ ] Save mapping con label "Causa Test" → badge attivo
- [ ] Chiudi tab + login fresh + apri mapping "Causa Test"
- [ ] Drop Doc2 (Mario Rossi) → verifica STESSO pseudonimo Tizio (NON Caio random)
- [ ] Bonus: marca "Emilia" falso positivo Doc1 → estendi con Doc2 → Emilia verbatim
- [ ] DOCX upload reale: drop `.docx` → estrazione testo mammoth → preview pseudonimizzato
- [ ] PDF text-extractable: drop `.pdf` testuale → estrazione pdf.js → preview
- [ ] PDF scannerizzato: drop scanned PDF → modal "OCR piano Pro in arrivo" + bottone Capito

### Phase 6 launch readiness — residui (pending)

- [ ] Mobile detection overlay (DESIGN.md §10)
- [ ] CSP header configurato (scoped, vedi OPEN_RISKS.md R-09 e D7)
- [ ] Sezione "Come funziona / Verificabilità privacy" nella UI (guida DevTools per pitch DPO)
- [ ] Landing page `micheleloi.pro/recode-it/` su WordPress (founder Elementor)
- [ ] Lighthouse audit (LCP < 3s desktop)
- [ ] `npm audit` + `pip-audit` clean — zero high/critical
- [ ] Email verification flow UX (backend `GET /recode/auth/verify-email/{token}` ritorna HTML, browser gestisce direttamente — confermare con founder se UX intenzionale)
- [ ] Worker error message preservation (R-11 follow-up): non rebrand ogni "failed to fetch" come `ERR_MODEL_NOT_FOUND`, conservare il messaggio originale ORT per facilitare diagnostica futura

### Post-MVP (parcheggi)

- Pro tier server architecture (split-knowledge esterno, consulente DPO) — gate ARR
- Cowork bridge conversazionale (skill bundled in meta-skill MHC-L) — gate validazione MVP
- OCR per PDF scannerizzati (Tesseract.js) — feature paid Pro, gate pricing decision settled
- Drafting capability native (marker-injection) — sprint separato post-PMF
- Build mobile — gate evidenza uso reale post-MVP
- Local persistence free tier (IndexedDB, §9 specifica) — gate pricing decision se Branch X freemium

---

## 8. Integrazione portfolio

- **Brand ombrello.** RegIA vende Recode IT come prodotto di punta. Cowork meta-skill MHC-L è prodotto separato con stessa filosofia ma audience diversa (avvocati che usano cowork Anthropic). Pitch unificato: privacy *abbastanza* per sbloccare paralisi GDPR — NON privacy paranoica.
- **Backend co-hosting.** `mhc.micheleloi.pro` ospita anche Recode IT (riuso Stripe/email/webhook MHC-L). Discriminazione `recode_users` vs `applications` (MHC-L) via schema additivo.
- **Coesistenza con MHC-L Phase 1 desktop.** I 2-3 tester legacy restano in vita. Indipendenti tecnicamente. Phase 2 cowork bridge conversazionale = integrazione opt-in futura.
- **Governance MHC-Work.** Decisioni cross-prodotto registrate in `MHC-Work/_org/decision_log.md`. Lavorazione dialettica in `MHC-Work/_org/synthesis/`. Questo capabilities_index è il pendant Recode-IT di `MHC-L/capabilities_index.md` — entrambi viventi nei rispettivi repo prodotto per coerenza con la routing rule `adapt.md`.

---

## 9. Pricing tier + persistence model (ratificato 2026-05-18)

Modello commerciale ratificato dal founder 2026-05-18 SID-20260518-143605 post strategist round-2. Struttura a **tre tier**:

### 9.0 Struttura tier

- **Test (€0, anonymous)** — nessuna memoria. Refresh tab = mapping perso. Caso d'uso: prova singola, vedi se funziona. Permanente come accesso, ma **senza garanzie di preservazione**: l'utente sa che ogni sessione ricomincia da zero. Niente account, niente email.
- **Account zero-euro (€0, named)** — persistenza **locale** nel browser (IndexedDB), legata al signup come identifier. Cross-session SI stesso device/browser, cross-device NO. Signup richiede email + nome. **Email può essere usata per newsletter solo con consenso esplicito GDPR-compliant (double opt-in).** Niente newsletter automatica al signup.
- **Paid €25 una tantum (cloud cifrato zero-knowledge)** — chiave sul server cifrata con password utente (architettura DESIGN §5.1). Cross-device, cross-browser, recovery codes. **Limite di storage cloud** (cap da definire in implementazione, es. N MB di blob totali per account; oltre il cap = errore + upgrade opzionale o cleanup utente).

### 9.1 Storage tier intermedio — IndexedDB in chiaro, no cifratura

Storage del tier zero-euro via IndexedDB nel browser (no `localStorage` — IndexedDB scala oltre 5 MB e supporta blob strutturati). Database privato del browser ("recode-it"), letture/scritture async, dato in cartella privata del browser sul disco utente.

**Decisione: dato in chiaro, niente cifratura aggiuntiva.**

Razionale: il browser dell'avvocato vive sullo stesso PC dove sta il file Word originale con i nomi veri. La chiave (Mario Rossi → Tizio) ha lo stesso livello di sensibilità del file originale e vive nello stesso luogo. Cifrarla con una password aggiuntiva sarebbe sicurezza teatrale — chi entra nel browser ha già accesso al file originale a portata di mano. Sicurezza coerente con il modello fisico del computer privato dell'avvocato.

**Schema IndexedDB canonico** (implementato in `feat/zero-euro-tier-indexeddb`):

- **Database name**: `recode-it`
- **Schema version**: `v1` (bump + `onupgradeneeded` handler per migration future)
- **Object store**: `mappings`
- **keyPath**: `id` — UUID v4 client-generato via `crypto.randomUUID()`
- **Indice secondario**: `updatedAt` — per sort ordinato lista mapping (lavoro più recente in cima)
- **Shape record**: `{ id, name, mappingBlob, createdAt, updatedAt, userEmail }` (`mappingBlob` = serializzazione JSON del PseudonymMapper, in chiaro).

Dispatcher tier-aware (`src/storage/mapping-store.ts`): se `auth.tier === 'free'` → IndexedDB; se `tier === 'pro'` → endpoint server cifrato esistente. Il `ClipboardWidget` e `active-mapping-context` delegano tutti i CRUD a `mapping-store`, mai direttamente a IDB o fetch.

### 9.2 Upgrade flow zero-euro → paid €25 una tantum

Bottone canonico: **"Trasferisci chiavi sul cloud"**. Non "Trasferisci tutto". La precisione è doctrine — l'utente capisce che si trasferisce solo il vocabolario di sostituzione, NON documenti né contenuti.

Behavior: pagamento Stripe Checkout → riceve dialog "Trasferisci chiavi sul cloud" → click → il browser deriva master_key da password+argon2_salt → cifra ogni mapping locale lato browser → POST `/recode/mappings/` per ciascuno. Dal momento dell'upgrade i mapping vivono sul server (cifrati), il locale può restare come copia ridondante o essere svuotato (decisione UX da raffinare).

### 9.3 Claim privacy — formulazioni canoniche per i 3 tier

Tre formulazioni distinte da usare nella UI/landing:

- **Test (€0, anonymous):**
  > *"Provalo senza registrarti. Niente esce dal tuo browser. Quando chiudi questa pagina, tutto sparisce — incluso il vocabolario di sostituzione."*

- **Zero-euro account (€0, named, locale):**
  > *"Le tue chiavi di sostituzione restano nel browser di questo computer. Né noi né nessun altro le vede — nemmeno se ce le chiedono i giudici, perché non le abbiamo. Registrati per ritrovarle domani sullo stesso computer."*
  > Frase separata sulla mail: *"L'email che ci dai serve a comunicarti modifiche al servizio. Non riceverai newsletter se non ce lo chiedi esplicitamente."*

- **Paid €25 una tantum (cloud cifrato):**
  > *"Le tue chiavi vengono cifrate qui nel tuo browser con la tua password e mandate sul nostro server come dati incomprensibili. Né noi né nessun altro può leggerle senza la tua password — nemmeno se ce le chiedono i giudici. Disponibili da qualsiasi computer."*

**Vocabolario: descrivere il behavior, NON nominare "zero-knowledge" come termine tecnico marketing.** L'avvocato non-tech deve capire cosa succede, non imparare un'etichetta.

### 9.4 Email policy (tier zero-euro + paid)

- Signup richiede email + nome.
- Email usata di default SOLO per comunicazioni di servizio (modifiche TOS, GDPR notifications, bug fix critici lato sito).
- Newsletter (es. novità prodotto, contenuti legal-tech, aggiornamenti feature Pro) inviata SOLO previo consenso esplicito **opt-in separato** dal signup (checkbox dedicata, default OFF).
- Doppio opt-in raccomandato (conferma via email link prima di iscrivere alla lista).
- Coerente con GDPR Art. 6(1)(a) consenso + Art. 7 condizioni del consenso (free, specific, informed, unambiguous).

### 9.5 Limite storage cloud (tier paid)

Cap di storage per account paid, da definire in implementazione. Modello probabile:
- Soft cap (es. 100 MB di blob totali) → warning UI quando l'utente si avvicina (es. "Hai usato 85 MB su 100. Considera di cancellare vecchi mapping").
- Hard cap → POST `/recode/mappings/` ritorna `413 Storage limit exceeded` → UI suggerisce cleanup (bulk delete più vecchi di X mesi) o passaggio a tier superiore se in futuro esisterà.

Razionale: prezzo una tantum di €25 non sostiene storage illimitato perpetuo a economia di scala. Cap previene abuse e mantiene il modello economicamente sostenibile per il founder.

### 9.6 Cambiamenti backend

**Schema utenti** (`recode_users`) — implementato in branch `feat/zero-euro-tier-indexeddb` (commit `d59445e`):

- `tier TEXT NOT NULL DEFAULT 'free'` (`'free' | 'pro'`, già previsto in DESIGN §6)
- `name TEXT NULL` — nome utente raccolto al signup (zero-euro tier)
- `marketing_consent_requested INTEGER NOT NULL DEFAULT 0` — flag opt-in al signup (checkbox dedicata, default OFF; GDPR Art. 6(1)(a))
- `marketing_consent_verified_at TEXT NULL` — timestamp ISO 8601 settato dal verify-email endpoint quando il token aveva flag marketing, a chiusura del double opt-in. `NULL` = consenso non ancora confermato via email link (oppure utente non ha mai chiesto newsletter).

**Endpoint nuovo (futuro)**: `POST /recode/me/marketing-consent` per opt-out post-signup.

**Storage tracking (tier paid)**: query aggregata `SELECT SUM(size_bytes) FROM encrypted_mappings WHERE user_id = ?` per controllare cap. Aggiungere index su `(user_id, size_bytes)` per performance.

### 9.7 Scenari di failure UX

- Utente cambia browser sullo stesso PC → mapping locali non visibili dal nuovo browser. Messaggio: *"Non trovi le tue chiavi? Sono nel browser dove le hai salvate. Per averle dappertutto, considera l'upgrade a €25 una tantum."*
- Utente cancella i dati del browser → mapping locali persi. Avviso onboarding free al primo salvataggio: *"Le chiavi vivono nel browser di questo computer. Se cancelli i dati del browser, vanno perse. Per averle al sicuro su cloud, considera l'upgrade."*
- Utente cambia computer → mapping non disponibili. Stessa narrazione di upgrade.
- Utente paid raggiunge il cap storage → warning soft + suggerimento cleanup; oltre cap = errore con guida.

### 9.8 Status

**Ratificato 2026-05-18.** Implementazione del tier intermedio (IndexedDB local persistence) pending — è la "second iteration of coding" già menzionata nei plan precedenti, da delegare a coding agent quando il founder vuole. Implementazione del tier paid €25 = wiring Stripe Checkout per pagamento una tantum (riusa infrastruttura MHC-L Phase 1) + cap storage + email policy backend.

Authority: dialogo founder ↔ chief_of_staff SID-20260518-143605 + strategist round 1 (raccomandazione c locale) + strategist round 2 (validazione struttura 3 tier) + ratifiche founder verbatim "test: niente memoria di sessione; solo nome (acquisto a zero euro) memoria di sessione interno; 25 euro chiave sul server e diversi computer" + "email anche per newsletter, chiedendo il consenso; limite storage cloud; test permanente ma senza garanzie".

---

*Recode IT capabilities_index — last synced SID-20260518-143605 (post-deploy 2026-05-18) + aggiornamento `feat/zero-euro-tier-indexeddb` (schema IDB canonico §9.1 + `marketing_consent_verified_at` §9.6 + stato §3 zero-euro tier implementato). Authored by MHC-Work portfolio governance. Coerenza con PDL ratificato 2026-05-17 + decision_log 2026-05-17 §"Pivot architetturale" + ratifica founder in-session 2026-05-18 §9 (persistenza locale design + struttura 3 tier strategist round 2) + deploy ratifica §3 stato + §5 deltas D7 D8 D9 + lessons learned in `OPEN_RISKS.md` R-09 resolution + R-11. Le ex-sezioni §9.1–§9.6 v1 (pre-strategist round 2) sono state rimosse perché duplicate da §9.0–§9.8 v2 sopra.*
