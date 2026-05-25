---
artifact_type: capabilities_index
scope: Recode IT product capabilities (meta-index, not content)
authoritative_for: menu of capabilities + scope boundaries + delivery status snapshot
NOT_authoritative_for: architecture details (see DESIGN.md), implementation tasks (see IMPLEMENTATION_PLAN.md), risk register (see OPEN_RISKS.md), test inventory (see TEST_PLAN.md)
last_synced: 2026-05-25
maintenance: per phase status → consult git log + IMPLEMENTATION_PLAN.md; canonical answer to "cosa fa Recode IT oggi?" + "cosa esplicitamente non fa?"
---

# Recode IT — Capabilities Index

**Scopo.** Statement autoritativo di cosa Recode IT è oggi, cosa è già implementato, cosa è ancora in pianificazione. Meta-index che punta a fonti canoniche del repo (DESIGN.md, IMPLEMENTATION_PLAN.md, TEST_PLAN.md, OPEN_RISKS.md), non duplica contenuto.

**Quando usarlo:**
- "Cosa è il prodotto Recode IT oggi, su cosa posso fare claim?"
- "Questo claim è coerente con quello che Recode IT fa? esiste oversell?"
- "Cosa manca a Recode IT per il lancio pubblico?"

**Quando NON usarlo:**
- Per dettagli implementativi → DESIGN.md
- Per task per fase → IMPLEMENTATION_PLAN.md
- Per stato test → TEST_PLAN.md + commit recenti
- Per rischi → OPEN_RISKS.md

---

## 1. Cos'è Recode IT

Recode IT è uno strumento web italiano di **pseudonimizzazione e ripristino** di documenti professionali sensibili. L'avvocato (commercialista, amministrazione pubblica) trascina un documento sulla pagina, vede una versione con i dati sensibili sostituiti, la rivede, la copia, la porta nel **suo** ambiente AI a sua scelta (claude.ai, ChatGPT, Claude Code, altro), recupera la risposta, e torna su Recode IT per ricostruire i nomi reali.

**Cardine architetturale:** Recode IT non chiama mai provider AI esterni. È un tool di pre-processing privacy. L'utente porta il testo pseudonimizzato esternamente. Conseguenze: nessuna credenziale provider AI lato server, nessun costo token a carico dell'operatore, nessuna dipendenza di uptime da provider AI.

**Audience.** Avvocati e commercialisti italiani in studio (target primario). Amministrazioni comunali/regionali e welfare (target secondario). Audience consumer non targetizzata ma ammessa via self-selection.

---

## 2. Architettura — sintesi

Stack ratificato (vedi DESIGN.md §3):

- **Browser:** React + TypeScript + Vite. Pseudonimizzazione in WebAssembly via onnxruntime-web + Transformers.js. Estrazione testo: pdf.js, mammoth.js, plain.
- **Modello NER:** `osiria/distilbert-italian-cased-ner` ONNX int8 (~66 MB), distribuito come asset statico same-origin.
- **Backend:** Python + Starlette + SQLite. Auth JWT, blob storage zero-knowledge, recovery codes.
- **Cifratura mapping (tier Pro):** Argon2id (lato browser) deriva master key dalla password utente. AES-256-GCM cifra il mapping. Il server vede solo bytes opachi.
- **Domain:** SPA su subdomain dedicato (es. `recode.<host>`), landing su path WordPress (es. `<host>/recode-it/`).

**Modello dati split-knowledge** (DESIGN.md §4):
- Computer utente: documenti + pseudonimizzazione + chiave (in RAM only).
- Server: blob cifrati (tier Pro) o nulla server-side (tier Free + Test). Mai vede i nomi reali, mai vede i documenti, mai conosce la chiave.
- Provider AI esterno: solo pseudonimi (l'utente porta il testo).

---

## 3. Stato di implementazione — fasi consegnate vs piano

| Fase | Cosa prevedeva | Stato | Riferimento |
|---|---|---|---|
| 0 — Scaffold | Vite+React+TS+Vitest, fixtures, script goldens stub | **DONE** | commit `c5aca31` |
| 1 — Engine port | regex IT + stoplist + pool pseudonimi + PseudonymMapper + regressioni A-1/A-2/A-3 | **DONE** | commit `aab6961` |
| 2 — Two-panel UI | drag-drop, anteprima, recode, copy widget, entity review con flusso falso-positivo | **DONE** (Phase 5 falso-positivo assorbita qui) | commit `4fd7fb7` |
| 3 — Auth + backend + frontend wiring | signup/login JWT cookie, endpoint zero-knowledge `/recode/mappings/*`, Argon2id + AES-GCM client + UX save/open/extend mapping + recovery 3-step ELIMINA gate | **DONE** | commits `ac164ff` (backend) + `0f26c3d` `414b6a6` `939c921` `e16cc89` (frontend) |
| 4 — NER WASM + equivalence test | onnxruntime-web NER + test di equivalenza numerica vs Python | **DONE con sostituzione modello** (modello finale: DistilBERT IT int8, pivoting da GLiNER per riduzione bundle size) | commit `7dba25e` + pivot `6887387` + `7e0ff63` |
| 5 — Falso-positivo UX | tre bottoni in entity review | **FOLDED in Phase 2** | commit `4fd7fb7` |
| 6 — Launch readiness | DOCX/PDF support, OCR-Pro framing, deploy + TLS, MIME headers, end-to-end smoke | **DEPLOY DONE; END-TO-END ACCEPTANCE TEST PENDING** | commits `71078ed` `911ea3e` (DOCX/PDF) + `1b93135` (model URL fix) |
| Account zero-euro (€0, named) — IndexedDB locale + signup nome+marketing consent | tier free persistence client-side, signup esteso, banner verifica email, schema utenti backend con `name` + `marketing_consent_*` | **DONE in branch `feat/zero-euro-tier-indexeddb`** (pending merge a main + acceptance reale) | commits `d59445e..HEAD` |

**Stato empirico end-to-end:** Recode IT LIVE su `https://recode.micheleloi.pro/`. Deploy stack: nginx subdomain dedicato + TLS Let's Encrypt + COOP/COEP/CORP cross-origin isolation + MIME types corretti per `.mjs`/`.wasm`/`.onnx` + backend Starlette ASGI in systemd su `127.0.0.1:8001` proxy via nginx. Frontend bundle SPA in `/var/www/recode-it/` con worker NER + modello DistilBERT IT 67 MB int8. **ORT InferenceSession.create verificato green nel browser** (input names: `input_ids`, `attention_mask`). Pseudonimizza-recode su singolo documento in singola sessione funziona. Persistenza server-side (save/open/extend mapping cross-doc cross-session via gesto "estendi") implementata.

---

## 4. Eredità tecnica

Recode IT non è un greenfield NER. Ri-confeziona una pipeline già validata empiricamente in produzione da aprile 2026.

Ereditato (vedi DESIGN.md §2):
- Regex italiani (codici fiscali con prefissi, P.IVA, IBAN IT, CRO, PROT, EMAIL) — port letterale Python → TypeScript
- Stoplist legale italiana (LEGAL_STOPLIST, FALSE_POSITIVE_PATTERNS) — port letterale
- Pool pseudonimi tradizione legale italiana (Tizio, Caio, Sempronio, Metropoli, ecc.) — port letterale
- Logica PseudonymMapper (entity-cluster, coreference, normalizzazione corti/organizzazioni/società IT)
- Tre fix architetturali (A-1 collisione cognomi condivisi, A-2 esenzione *de cuius* per Considerando 27 GDPR, A-3 elisione articoli prima dei titoli) — documentati come test di regressione in `test-fixtures/`
- Posizione GDPR sulla pseudonimizzazione come misura tecnica Art. 32 sotto controllo del Titolare, con obbligo di revisione pre-trasmissione — eredità testuale dalla documentazione legale predecessor
- Workflow multi-step (Pass 1 PERSONA+regex / riflessione utente / Pass 2 opt-in luoghi/organizzazioni)

**Non ereditato:** runtime Python (sostituito da ONNX-in-browser), mapping solo-in-RAM (Recode IT aggiunge persistenza zero-knowledge opt-in).

I golden file di test (Python reference outputs + fixture canonici) sono inclusi in `test-fixtures/` per riproducibilità + regression testing.

---

## 5. Cosa Recode IT NON fa (boundaries autoritative)

### 5.1 Boundaries architetturali

- **Non chiama mai provider AI esterni.** È pre-processing privacy. L'utente porta il testo pseudonimizzato nel suo ambiente AI esterno. Nessuna credenziale provider AI lato server Recode IT.
- **Server zero-knowledge ma non zero-availability** (tier Pro). Il server non può decifrare i mapping (la chiave non lascia mai il browser). Ma il server è necessario per persistenza cross-session e cross-device. Se il server è giù, l'utente perde "salva e riprendi domani" (la pseudonimizzazione in-sessione resta funzionante).
- **Recovery codes sono distruttivi.** Usare un codice di recupero per resettare la password elimina permanentemente tutti i mapping salvati. Conseguenza architetturale del zero-knowledge: il server non ha modo di re-derivare la chiave vecchia. Documentato in OPEN_RISKS.md R-05 + avviso esplicito utente.

### 5.2 Boundaries di scope feature

- **NER ha recall ~70-80%.** L'utente DEVE rivedere il preview prima di copiare. La revisione è obbligo contrattuale del Titolare dei dati. Il pannello entity review è la materializzazione dell'obbligo, non cosmetica.
- **Continuità degli pseudonimi cross-document = capacità attivata.** L'architettura zero-knowledge persistente + il gesto UX "apri mapping esistente prima del drag-drop" producono coerenza fra atti della stessa causa (Mario Rossi resta Tizio in tutti gli atti). Test `extend_mode.test.ts` green (Tier-1 hit verificato sul mapper).
- **Apprendimento falso-positivi cross-document = funziona dentro lo stesso mapping di causa, NON tra cause diverse.** La memoria del flag "non è una persona" viaggia con il mapping cifrato del documento (campo `isFalsePositive: bool` per entry — DESIGN §8.7), NON con tabella server-side. Conseguenza: la marca persiste dentro un mapping; se l'utente passa a una causa diversa (mapping diverso), riparte da zero.
- **Niente OCR per PDF scannerizzati.** PDF text-extractable supportati via pdf.js. Scannerizzati: messaggio "carica come testo o usa PDF con testo incorporato — OCR in Phase 2".
- **Niente build mobile.** Detect mobile → messaggio "apri da computer desktop". Signup possibile da mobile, upload/pseudonimize/recode bloccato.
- **Niente drafting capability native.** Sprint separato post-MVP.

### 5.3 Boundaries di processo

- **Recode IT non sostituisce il controllo umano** sull'output AI. L'utente porta il testo a provider AI esternamente, gestisce il workflow nel suo ambiente, riceve la risposta, e Recode IT solo ricostruisce i nomi reali.
- **Recode IT non offre garanzie SLA** in fase prototipo — server availability è "best effort".

---

## 6. Roadmap

### Pre-MVP wiring (DONE 2026-05-18)

Wire persistenza zero-knowledge + gesto "estendi mapping". Tasks chiusi:

- [x] Client crypto module (Argon2id + AES-256-GCM via SubtleCrypto, IV fresh per call) — commit `ac164ff`
- [x] UI signup/login + persistenza JWT in `sessionStorage` (non `localStorage`)
- [x] Bottone "Salva mapping" funzionante (input label, derive master_key, encrypt, POST)
- [x] Dashboard "I miei mapping" con `[Apri]` + `[Elimina]` + bulk delete + sort by `last_accessed_at` desc
- [x] Gesto "Apri mapping esistente" → seed PseudonymMapper in stato attivo + badge "Mapping attivo: <label>"
- [x] Gesto "Estendi mapping attivo" → drop nuovo doc → mapper NON resetta, estende
- [x] Recovery codes destruction warning a 3 step (R-05 mitigation): avviso + checkbox + textbox "scrivi ELIMINA"
- [x] Beforeunload warning se mapping attivo non salvato
- [x] DOCX/PDF extraction (pdfjs-dist + mammoth) + scanned-PDF modal con framing "OCR piano Pro in arrivo"

Test suite Vitest: **208/208 green** post-wiring. Critical: `extend_mode.test.ts`, `active-mapping-context.test.tsx`, `RecoveryPage.test.tsx`.

### Deploy production (DONE 2026-05-18)

- [x] DNS A record subdomain → IP VPS
- [x] TLS Let's Encrypt cert provisioning via certbot, auto-renew schedulato
- [x] Backend `recode-it-backend.service` systemd: uvicorn `127.0.0.1:8001`, venv, DB SQLite, JWT secret env, CORS scoped
- [x] nginx server block subdomain con COOP/COEP/CORP headers + MIME `.mjs`/`.wasm`/`.onnx`/`.json` + `Cache-Control: no-cache` su asset ESM/binary
- [x] Frontend `npm run build` + upload `dist/` (preserva `models/` ONNX)
- [x] Smoke test pubblico verificato green: `GET /` → 200 + index.html + COOP/COEP headers; ORT InferenceSession.create → green

### Acceptance test end-to-end (PENDING)

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
- [ ] CSP header configurato (scoped, vedi OPEN_RISKS.md R-09)
- [ ] Sezione "Come funziona / Verificabilità privacy" nella UI (guida DevTools)
- [ ] Lighthouse audit (LCP < 3s desktop)
- [ ] `npm audit` + `pip-audit` clean — zero high/critical
- [ ] Email verification flow UX review
- [ ] Worker error message preservation (R-11 follow-up): non rebrand ogni "failed to fetch" come `ERR_MODEL_NOT_FOUND`, conservare il messaggio originale ORT per facilitare diagnostica futura

### Post-MVP (parcheggi)

- Pro tier server architecture (split-knowledge esterno) — gate ARR
- OCR per PDF scannerizzati (Tesseract.js) — feature paid Pro
- Drafting capability native (marker-injection) — sprint separato post-PMF
- Build mobile — gate evidenza uso reale post-MVP

---

## 7. Pricing tier + persistence model

Modello commerciale a **tre tier** + add-on Decodifica una tantum.

### 7.0 Struttura tier

- **Test (€0, anonymous)** — nessuna memoria. Refresh tab = mapping perso. Caso d'uso: prova singola, vedi se funziona. Permanente come accesso, ma **senza garanzie di preservazione**: l'utente sa che ogni sessione ricomincia da zero. Niente account, niente email.
- **Account zero-euro (€0, named)** — persistenza **locale** nel browser (IndexedDB), legata al signup come identifier. Cross-session SI stesso device/browser, cross-device NO. Signup richiede email + nome. **Email può essere usata per newsletter solo con consenso esplicito GDPR-compliant (double opt-in).** Niente newsletter automatica al signup.
- **Paid €25 una tantum (cloud cifrato zero-knowledge, parcheggiato)** — chiave sul server cifrata con password utente. Cross-device, cross-browser, recovery codes. **Limite di storage cloud** (cap da definire in implementazione). Parcheggiato post-pivot 2026-05-24, fuori landing principale.

### 7.1 Storage tier intermedio — IndexedDB in chiaro, no cifratura

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

### 7.2 Upgrade flow zero-euro → paid €25 una tantum

Bottone canonico: **"Trasferisci chiavi sul cloud"**. Non "Trasferisci tutto". La precisione è doctrine — l'utente capisce che si trasferisce solo il vocabolario di sostituzione, NON documenti né contenuti.

Behavior: pagamento Stripe Checkout → riceve dialog "Trasferisci chiavi sul cloud" → click → il browser deriva master_key da password+argon2_salt → cifra ogni mapping locale lato browser → POST `/recode/mappings/` per ciascuno. Dal momento dell'upgrade i mapping vivono sul server (cifrati), il locale può restare come copia ridondante o essere svuotato.

### 7.3 Claim privacy — formulazioni canoniche per i 3 tier

Tre formulazioni distinte da usare nella UI/landing:

- **Test (€0, anonymous):**
  > *"Provalo senza registrarti. Niente esce dal tuo browser. Quando chiudi questa pagina, tutto sparisce — incluso il vocabolario di sostituzione."*

- **Zero-euro account (€0, named, locale):**
  > *"Le tue chiavi di sostituzione restano nel browser di questo computer. Né noi né nessun altro le vede — nemmeno se ce le chiedono i giudici, perché non le abbiamo. Registrati per ritrovarle domani sullo stesso computer."*
  > Frase separata sulla mail: *"L'email che ci dai serve a comunicarti modifiche al servizio. Non riceverai newsletter se non ce lo chiedi esplicitamente."*

- **Paid €25 una tantum (cloud cifrato, parcheggiato):**
  > *"Le tue chiavi vengono cifrate qui nel tuo browser con la tua password e mandate sul nostro server come dati incomprensibili. Né noi né nessun altro può leggerle senza la tua password — nemmeno se ce le chiedono i giudici. Disponibili da qualsiasi computer."*

**Vocabolario: descrivere il behavior, NON nominare "zero-knowledge" come termine tecnico marketing.** L'avvocato non-tech deve capire cosa succede, non imparare un'etichetta.

### 7.4 Email policy (tier zero-euro + paid)

- Signup richiede email + nome.
- Email usata di default SOLO per comunicazioni di servizio (modifiche TOS, GDPR notifications, bug fix critici lato sito).
- Newsletter (es. novità prodotto, contenuti legal-tech) inviata SOLO previo consenso esplicito **opt-in separato** dal signup (checkbox dedicata, default OFF).
- Doppio opt-in raccomandato (conferma via email link prima di iscrivere alla lista).
- Coerente con GDPR Art. 6(1)(a) consenso + Art. 7 condizioni del consenso (free, specific, informed, unambiguous).

### 7.5 Limite storage cloud (tier paid)

Cap di storage per account paid, da definire in implementazione:
- Soft cap (es. 100 MB di blob totali) → warning UI quando l'utente si avvicina.
- Hard cap → POST `/recode/mappings/` ritorna `413 Storage limit exceeded` → UI suggerisce cleanup.

### 7.6 Cambiamenti backend

**Schema utenti** (`recode_users`) — implementato in branch `feat/zero-euro-tier-indexeddb` (commit `d59445e`):

- `tier TEXT NOT NULL DEFAULT 'free'` (`'free' | 'pro'`)
- `name TEXT NULL` — nome utente raccolto al signup (zero-euro tier)
- `marketing_consent_requested INTEGER NOT NULL DEFAULT 0` — flag opt-in al signup (checkbox dedicata, default OFF)
- `marketing_consent_verified_at TEXT NULL` — timestamp ISO 8601 settato dal verify-email endpoint, double opt-in completion

### 7.7 Scenari di failure UX

- Utente cambia browser sullo stesso PC → mapping locali non visibili dal nuovo browser.
- Utente cancella i dati del browser → mapping locali persi. Avviso onboarding free al primo salvataggio.
- Utente cambia computer → mapping non disponibili. Stessa narrazione di upgrade.
- Utente paid raggiunge il cap storage → warning soft + suggerimento cleanup; oltre cap = errore con guida.

### 7.8 Decodifica €20 una tantum (canonical post-pivot 2026-05-24)

**Comportamento user-facing.** L'utente incolla un documento, Recode IT lo riscrive con pseudonimi e tiene la mappa nel suo browser. Lavora con l'AI sul testo pseudonimizzato. Quando l'AI risponde — con quegli pseudonimi — l'utente incolla la risposta in Recode IT e riceve il testo finale con i nomi reali. Quest'ultimo passo è la **Decodifica**: un click, browser-side, eseguito dal frontend usando la mappa già locale.

**Cosa è gratis (con login Recode IT).** Codifica + mappa pseudonimi visibile + editing manuale della mappa (incluso dal day 1, no phased rollout). Mappa persistente IndexedDB tra sessioni dello stesso browser. Decodifica bloccata (servono €20 una tantum, oppure Bearer MHC, oppure Pro tier). La versione anonima senza login funziona identicamente ma la mappa è effimera (RAM session) e Decodifica resta bloccata.

**Cosa è gratis per i membri MHC.** Codifica + mappa + editing + **Decodifica sbloccata**. La membership MHC (signup ecosystem €0) emette un Bearer key che, incollato nel claim form di Recode IT, registra la permission Decodifica sul backend. Bundle synergy: chi adotta MHC ecosystem riceve Recode IT Decodifica incluso, senza ulteriore pagamento. Acquisition funnel naturale verso MHC per chi vuole sperimentare il felt moment Decodifica gratis.

**Cosa costa €20 una tantum.** L'autorizzazione a eseguire la Decodifica per chi non è membro MHC. Il backend registra che l'utente ha pagato; il replace pseudonimo→nome reale resta tutto frontend, niente documento o mappa lascia il browser. Una tantum, non subscription, attiva su tutti i browser dove l'utente è autenticato.

**Dove sta il dolore reale.** Pseudonimizzare (codifica) è il momento di disciplina — l'avvocato sa che deve farlo e accetta lo sforzo. Ri-identificare (decodifica) è il momento di noia: la risposta AI di 800 parole con quaranta occorrenze di pseudonimi da rimettere a posto a mano. Il €20 compra automazione di una tediosità ripetitiva, non fiducia in una security claim.

**Tre vie per ottenere la permission:**

1. **Stripe Payment Link €20** mode=payment → webhook `checkout.session.completed` → permission set `source='paid'`.
2. **Bearer paste** — utente con Bearer key di un servizio gemello dello stesso operatore incolla nel claim form → backend valida cross-DB read-only → `source='bearer'` + `linked_user_email`. Bundle synergy.
3. **Pro tier implies** — `tier='pro'` riceve granted computed at read time, `source='pro_tier'`. Pro €25 cloud zero-knowledge è parcheggiato (non più repositioned attivamente; resta nel codice).

**Workflow canonico end-to-end:**

1. **Codifica (gratis con login).** Utente incolla documento con nomi reali → NER browser-side estrae entità → app sostituisce con pseudonimi → utente copia testo pseudonimizzato.
2. **Lavoro esterno (fuori Recode).** Utente porta il testo pseudonimizzato in un provider AI a sua scelta. Recode non chiama nessun provider AI (architettura DESIGN §3).
3. **Decodifica (€20 una tantum).** Utente incolla la risposta AI (con pseudonimi) → app applica la mappa inversa → output con nomi reali. Backend ha già grantato la permission al checkout Stripe; la sostituzione vive nel frontend.

**Implementazione tecnica.** File `backend/reverse_substitution.py` (naming tecnico interno; "Decodifica" è il naming customer-facing UNICO usato in UI, Stripe Dashboard, fattura); endpoints `/recode/reverse-substitution/{permission,claim-bearer,claim-checkout}`; colonne DB `reverse_substitution_permitted_at`, `reverse_substitution_source`, `linked_user_email`; migrations 004 + pre-hook db.py per auto-rename colonne legacy. Env var `RECODE_IT_REVERSE_SUBSTITUTION_STRIPE_PAYMENT_LINK_URL`. 70/70 test backend passano.

Divergenza naming backend↔customer è intenzionale e accettata: backend nomina l'operazione tecnica (accuracy semantica preservata), customer-facing nomina il claim di valore. Zero refactor backend pianificato.

### 7.9 Pricing model finalizzato (post-pivot 2026-05-24)

| Tier | Mapping storage | View/edit mappa | Decodifica | Prezzo |
|---|---|---|---|---|
| Test (anonymous) | RAM session only | visibile | bloccata | €0 |
| Free (con login) | IndexedDB browser plaintext | visibile + editabile | bloccata | €0 |
| **+ Decodifica** | IndexedDB browser plaintext | visibile + editabile | **attiva** | **€20 una tantum** o free Bearer |
| Pro (parcheggiato) | Server-encrypted Argon2id+AES-256-GCM | visibile (implicit) | attiva (implicit) | €25 una tantum (deferred, fuori landing principale) |

**Coerenza con felt-not-said discipline**: il claim della landing post-pivot è *"Pseudonimizza ora. Decodifica quando serve."* — descrive un comportamento (paste → ricevi testo finito) anziché una proprietà tecnica. Vocabolario customer: "Decodifica". Vocabolario tecnico riservato a sub-section technical-internal ("sostituzione inversa" come descrizione meccanica della funzione, non come naming alternativo).

---

*Recode IT capabilities_index — last synced 2026-05-25 (post architectural cleanup: removed governance/strategic content migrated to governance counterpart; renumbered sections; kept tier description tecnica + Decodifica canonical post-pivot). Coerenza con DESIGN.md + IMPLEMENTATION_PLAN.md + commit history del repo.*
