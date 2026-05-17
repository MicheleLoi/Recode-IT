# Recode IT — Architecture Design Document

**Version:** 1.0  
**Date:** 2026-05-17  
**Status:** Ratified by founder — do not revisit architecture decisions marked as such  
**Intended audience:** Coding agent executing implementation phases

---

## 1. Product Description

Recode IT is a web-based tool that lets Italian legal professionals (lawyers, accountants, public administrations) pseudonymize sensitive documents before sending them to Claude, then "recode" (un-pseudonymize) Claude's response. The pseudonymization engine runs entirely inside the user's browser using WebAssembly, so no real names, fiscal codes, IBANs, or identifying information ever reach Recode IT's server or Anthropic. The server stores only AES-256-GCM encrypted mapping blobs that it cannot read (zero-knowledge). Users bring their own Claude accounts; Recode IT never calls the Anthropic API.

Core UX in one sentence: drag document → inspect & correct pseudonymized preview → copy to Claude → paste Claude response → get original names restored.

---

## 2. Heritage from MHC-L (Reuse Inventory)

Recode IT is not a greenfield NLP project. It is a browser repackaging of a pseudonymization pipeline that has been built, tested, debugged on real Italian legal documents, and operated as a production component of MHC-L since April 2026. Three classes of work are inherited unchanged in their intent and re-implemented in TypeScript:

### 2.1 Validated NER pipeline (engineering)

The Python pipeline in `MHC-L/tools/anonymize.py` uses `urchade/gliner_multi-v2.1` with the threshold tiers `0.4` (persona / luogo), `0.65` (organizzazione), `0.6` (numero di causa / tribunale / avvocato / email / telefono / iban). These thresholds were empirically tuned on Italian legal text over ~5 months. Three bugs that surfaced on real documents have been diagnosed, fixed, and regression-tested. The fixes are part of the asset Recode IT inherits — they MUST be ported faithfully, with their regression tests:

| Bug | Where | Fix | Regression fixture |
|---|---|---|---|
| **A-1 — Shared surname collision** | `PseudonymMapper.get_person()` collapsed all persons sharing a surname into one pseudonym (Erminia / Tarcisio / Arturo Vanzetti → all "Caio"). | Three-tier lookup: (1) exact full-name match; (2) surname lookup restricted to single-word inputs and article-prefixed 2-word spans (`_ITALIAN_ARTICLES` carve-out for "la Vanzetti", "del Ferrari"); (3) multi-word names not in exact map → always new person. Surname index written only on first occurrence. | `dev/testing_documents/doc_B_eredita.md` (Scenario B in `test_drift.py`). Source: `MHC-L/dev/ANONYMIZER_BUGS.md` §A-1. |
| **A-2 — De cuius misclassification** | GLiNER detected deceased persons as PERSON entities and pseudonymized them, contrary to GDPR Recital 27 (Regulation does not apply to data of deceased persons). | Pattern-based pre-pass via `_DE_CUIUS_RE` matching `"de cuius [Name]"` and `"[Name], de cuius"`. Matched names go through `PseudonymMapper.mark_skip()` → real name preserved in output. | `dev/testing_documents/doc_B_eredita.md` (Arturo Vanzetti). Source: `MHC-L/dev/ANONYMIZER_BUGS.md` §A-2. |
| **A-3 — Title elision** | `TITLE_RE` matched `Avv.` but not `L'Avv.` (Italian elided article before vowel-initial titles); surname index keyed on `"l'avv"` instead of the actual surname. | Prepend `^(?:[Ll]['’]\s*)?` to `TITLE_RE` to cover straight and curly apostrophe; `Notaio` added to the title set. | `dev/testing_documents/doc_B_eredita.md` ("L'Avv. Amadori"). Source: `MHC-L/dev/ANONYMIZER_BUGS.md` §A-3. |

The empirical work behind these fixes is captured in `MHC-L/dev/traces/trace_anonymizer_ner_bug_analysis_20260416.md`. The validation infrastructure is in `MHC-L/dev/test_full_pipeline.py` (smoke test on one document, 7 drift patterns) and `MHC-L/dev/test_drift.py` (3 scenarios × 3 simulated artifacts, ~134 pseudonym references) — both PASS in their post-fix state. The Recode IT port treats these tests as a fixed contract: the TypeScript implementation must produce equivalent mappings on the same input documents (`doc_A_fendipista.md`, `doc_B_eredita.md`, `doc_C_il_leak.md`, `doc_00_appalto_edilizio.md`).

The methodological finding from the trace also transfers: drift = 0 is necessary but not sufficient. Mapping inspection (distinct persons → distinct pseudonyms) is a required check, not an optional one. Recode IT inherits the collision-detection alert pattern.

### 2.2 Multi-step pseudonymization workflow (UX)

The single-pass GUI was promoted in commit `22f9c8d` to a two-pass workflow with a user reflection point between passes. The design rationale is in `MHC-Work/notes/research/mhc-l/multi_step_pseudonimization_design_20260501.md` and is described user-facing in `MHC-L/privacy.md` §"State 1 — Pseudonymization routine active":

- **Pass 1** (always): PERSONA NER + regex (CF, P.IVA, IBAN, email, court case numbers) + manual generic category `DS`.
- **Reflection point**: user decides whether contextual re-identification is a concern.
- **Pass 2** (opt-in): extend NER to places, organizations, tribunals.

The MHC-L position is that removing organizations and places by default destroys legal reasoning (jurisdiction, applicable law, procedural elements). Recode IT inherits this position: the entity review panel exposes per-category control rather than defaulting to maximum redaction.

### 2.3 GDPR / privacy position (legal architecture)

The pseudonymized-text-to-Anthropic data path has a documented position in MHC-L that Recode IT inherits. Key references:

- **`MHC-L/legal/DPA.md` §2.2.2** ("Architettura del servizio e flusso dei contenuti"): the document contents flow directly between the user's environment and Anthropic on the basis of a separate, direct contractual relationship between user and Anthropic — to which the MHC-L processor is extraneous. The MHC-L processor never receives the document contents. The same architectural separation holds for Recode IT: the encrypted-blob server is structurally distinct from the user↔Anthropic content path.
- **`MHC-L/legal/DPA.md` §2.2.3** ("Pseudonimizzazione locale come misura tecnica"): local pseudonymization is an Art. 32 GDPR technical measure that operates on the user's machine before any transmission. The Controller (user) is responsible for activating and verifying it. Recode IT's browser-side pipeline is the direct analogue.
- **`MHC-L/legal/DPA.md` §2.2.4** ("Limite tecnologico e obbligo di revisione del Titolare"): the pipeline is *best-effort*. The Controller is contractually obligated to review the pseudonymized file before transmission and to refrain from sending material whose contextual references still allow re-identification. Recode IT inherits this position verbatim — the entity review panel is the operationalization of this obligation.
- **`MHC-L/privacy.md` §"What MHC-L does NOT do"**: the data path from the user's machine to Anthropic is governed by the user's Anthropic agreement, not by MHC-L. The same holds for Recode IT.
- **GDPR Recital 27** (deceased persons): foundation for Bug A-2 fix (de cuius exemption). Recode IT preserves this behavior.

The consequence for Recode IT design and marketing: the privacy framing in `MHC-L/privacy.md` is the canonical template. Recode IT does NOT claim "no personal data reaches Anthropic" — that claim is legally fragile. It claims, with `MHC-L/privacy.md` precision, that the pseudonymization is a high-quality Art. 32 technical measure operated under the user's control, with mandatory user review before transmission. The recipient of the pseudonymized text (Anthropic) is governed by the user's direct relationship with Anthropic, not by Recode IT. No new GDPR consultation is required to ship the landing-page copy; the DPA / privacy text is already drafted and reviewable.

### 2.4 What is NOT inherited

Three pieces of MHC-L are deliberately not carried over:

- **MCP transport** — Recode IT is a browser SPA, not an MCP server. No `mhc_create_artifact`, no session formalization, no `.mhc-config.json`.
- **In-RAM mapping only** — MHC-L's pipeline keeps the mapping in RAM and discards it. Recode IT additionally offers an opt-in zero-knowledge persistence layer (encrypted blobs on the server) so the recode step survives a tab close. The default mode is still ephemeral (session-only).
- **Python runtime** — replaced by ONNX-in-browser via onnxruntime-web + Transformers.js (see §7).

### 2.5 Port-fidelity discipline

Because the Python pipeline has been empirically validated, the TypeScript port is a *fidelity* problem rather than a *quality discovery* problem. The risk to manage is whether the browser implementation behaves equivalently to the reference Python implementation on the same inputs — not whether the underlying model approach works on Italian legal text. This reframes the testing strategy (see TEST_PLAN.md §Phase 4 and OPEN_RISKS.md R-01-NEW). Golden-file equivalence tests against the Python reference output on `doc_A_fendipista.md`, `doc_B_eredita.md`, `doc_C_il_leak.md`, `doc_00_appalto_edilizio.md` are the canonical acceptance gate.

---

## 3. Stack Decision

### Frontend

| Technology | Choice | Rationale |
|---|---|---|
| Framework | **React 18 + TypeScript** | Component model suits the two-panel + entity-review UX; TypeScript gives type safety for the entity/mapping data structures that are security-critical. SvelteKit or Vue would also work but React has the widest Sonnet-session familiarity for implementation. |
| Build tool | **Vite** | Native ESM, fast HMR, WASM/worker support out-of-the-box. |
| State management | **Zustand** (small) | The app has a clear unidirectional session state; Redux is overkill. Zustand is 1KB and tree-shakable. |
| Styling | **Tailwind CSS** | Utility-first avoids class-name collisions; no design-system overhead for MVP. |
| WASM NER | **onnxruntime-web** + **@huggingface/transformers (Transformers.js)** | onnxruntime-web runs ONNX models in browser. Transformers.js provides the GLiNER tokenizer and pipeline wrapper. Together they replicate the Python `GLiNER.from_pretrained` + `predict_entities` call. |
| PDF extraction | **pdf.js** (Mozilla) | Industry standard, runs in browser, handles most court-produced PDFs. Scanned PDFs (no text layer) → Phase 2 only. |
| DOCX extraction | **mammoth.js** | Converts DOCX to plain text/markdown in browser; 0 server contact. |
| WASM threading | Enable **SharedArrayBuffer** via COOP/COEP headers | Required for multi-threaded onnxruntime-web; reduces inference time 3-5x. Server must send `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. |

### Backend

| Technology | Choice | Rationale |
|---|---|---|
| Language | **Python 3.11+** | Reuses MHC-L server codebase; all existing auth/Stripe/webhook handlers are Python ASGI. |
| Framework | **Starlette** (bare ASGI, same as MHC-L) | No FastAPI overhead; the existing MHC-L server uses Starlette routing with bare ASGI handlers. Adding Recode IT routes means adding new Route() entries, not a new framework. |
| Server | **Uvicorn** (same as MHC-L) | Already deployed on `mhc.micheleloi.pro`. |
| DB | **SQLite** with WAL mode (same as MHC-L) | Reuses `db.py` connection logic. Add two new tables. Migration to Postgres if >500 users (inherit MHC-L's migration threshold). |
| Auth (new) | **JWT (HS256)** via `python-jose` or `PyJWT` | MHC-L Phase 1 uses static Bearer API keys delivered by email. Recode IT needs email+password login via browser form → short-lived JWT. The new auth layer is additive; MHC-L's `BearerAuthMiddleware` is unchanged. |
| Password hashing | **bcrypt** (12 rounds) | Industry standard; `passlib[bcrypt]` available. |
| KDF for mapping encryption key | **Argon2id** (via `argon2-cffi`) | Best-practice KDF for browser-derived secrets in 2026; defeats GPU attacks better than PBKDF2 or bcrypt for this use case. Parameters: memory_cost=65536 (64MB), time_cost=3, parallelism=1. |
| Email | **Resend** (same SDK as MHC-L) | Already integrated and authenticated in MHC-L. Reuse `resend.Emails.send()`. |
| Stripe | **Stripe SDK** (same as MHC-L) | Webhook and checkout infrastructure already running. Discriminate Recode IT plans by `price_id` prefix. |

### Domain & Hosting (ratified)

- Landing: `micheleloi.pro/recode-it/`
- Backend: `mhc.micheleloi.pro` (same server as MHC-L)
- All Stripe/webhook/email infra already operational — reuse unchanged

---

## 4. Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│  USER BROWSER (trusted, sandboxed)                                      │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  React App (HTTPS, micheleloi.pro/recode-it/)                    │   │
│  │                                                                  │   │
│  │  [1] User drags PDF/DOCX/TXT                                     │   │
│  │       │                                                          │   │
│  │       ▼                                                          │   │
│  │  [2] File API reads bytes (stays in RAM, never sent)             │   │
│  │       │ pdf.js / mammoth.js / plain read                         │   │
│  │       ▼                                                          │   │
│  │  [3] Raw text (RAM only)                                         │   │
│  │       │                                                          │   │
│  │       ▼                                                          │   │
│  │  [4] PseudonymEngine (WASM)                                      │   │
│  │       ├─ apply_regex_rules() → CF, IBAN, P.IVA, EMAIL…          │   │
│  │       ├─ GLiNER ONNX (onnxruntime-web)                           │   │
│  │       │   model file: ~100MB ONNX, cached in Cache API           │   │
│  │       │   input: raw text chunks (≤800 chars)                    │   │
│  │       │   output: entity spans + labels + scores                 │   │
│  │       └─ PseudonymMapper → Tizio/Caio/Alfa/Metropoli…            │   │
│  │       │                                                          │   │
│  │       ▼                                                          │   │
│  │  [5] Entity review panel                                         │   │
│  │       each detection: [Accept] [Change category] [False positive]│   │
│  │       user corrects → updates mapping in RAM                     │   │
│  │       │                                                          │   │
│  │       ▼                                                          │   │
│  │  [6] mapping_object = { "Tizio": "Mario Rossi", … }              │   │
│  │      pseudonymized_text (in RAM)                                 │   │
│  │      NOTHING SENT YET                                            │   │
│  │       │                                                          │   │
│  │       ▼                                                          │   │
│  │  [7] User clicks [Copy for Claude]                               │   │
│  │      → clipboard.writeText(pseudonymized_text)                   │   │
│  │      User goes to their own Claude tab, pastes, gets response    │   │
│  │                                                                  │   │
│  │  [8] OPTIONAL: Save mapping to server                            │   │
│  │      encrypt_mapping(mapping_object, user_master_key)            │   │
│  │      → encrypted_blob (AES-256-GCM)                              │   │
│  │      POST /recode/mappings  ← only blob sent, never plaintext    │   │
│  │       │                                                          │   │
│  │  [9] Recode page: user pastes Claude response                    │   │
│  │      auto_recode(response_text, mapping_object)                  │   │
│  │      → restored text with real names                             │   │
│  │      [Copy final to clipboard]                                   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
          │ (8) Only encrypted blobs travel
          │ POST /recode/mappings { encrypted_blob, mapping_id }
          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  SERVER: mhc.micheleloi.pro (Python/Starlette/SQLite)                   │
│                                                                         │
│  Recode IT routes (additive to MHC-L):                                  │
│  POST/GET/DELETE /recode/mappings/<id>  ← stores/retrieves blobs only  │
│  PATCH /recode/mappings/<id>/false-positives                            │
│  POST /recode/auth/register                                             │
│  POST /recode/auth/login  → JWT                                         │
│  POST /recode/auth/recovery-codes/verify                                │
│                                                                         │
│  What the server KNOWS:                                                 │
│    - user_id (from JWT)                                                 │
│    - mapping_id (UUID, generated client-side)                           │
│    - encrypted_blob (opaque bytes)                                      │
│    - created_at, last_accessed_at                                       │
│                                                                         │
│  What the server CANNOT KNOW:                                           │
│    - the mapping key (derived from user password client-side)           │
│    - the mapping contents (real names, fiscal codes, etc.)              │
│    - the original document                                              │
│    - the Claude prompt or response                                      │
└─────────────────────────────────────────────────────────────────────────┘

ANTHROPIC API: never contacted by Recode IT.
User pastes pseudonymized text into their own Claude.ai or Claude desktop.
Anthropic sees only: "Tizio è amministratore di Alfa S.r.l., con sede a Metropoli…"
```

### Session-only vs. persisted mapping

Two modes depending on user choice:

- **Session-only (ephemeral)**: mapping lives in JS memory, deleted when tab closes. Maximum privacy, no server contact for the mapping. Recode in the same session only.
- **Persisted**: user triggers "Save mapping" → client encrypts → sends blob → server stores. User can retrieve on any device (with correct password). Server sees only ciphertext.

---

## 5. Security Model

### 5.1 Zero-Knowledge Mapping Storage

The server is explicitly **not trusted** with mapping contents. The design enforces this technically:

1. **Key derivation**: the user's password never leaves the browser. On first use, the browser derives a `master_key` using Argon2id:
   ```
   master_key = Argon2id(
       password = user_password_utf8,
       salt = user_salt_from_server,   // 16 bytes, random, stored in users table
       memory_cost = 65536,            // 64 MB
       time_cost = 3,
       parallelism = 1,
       hash_length = 32
   )
   ```
   The salt is public (stored in the DB, returned at login). The password is not.

2. **Mapping encryption**: each mapping gets a unique `mapping_key`:
   ```
   mapping_key = HKDF-SHA256(master_key, info="recode-it-mapping-v1", salt=mapping_salt)
   encrypted_blob = AES-256-GCM(
       key = mapping_key,
       plaintext = JSON.stringify(mapping_object),
       iv = random_12_bytes,           // prepended to ciphertext
       aad = mapping_id_bytes          // authenticated but not encrypted
   )
   ```
   The `encrypted_blob` sent to the server = `iv (12 bytes) || ciphertext || auth_tag (16 bytes)`.

3. **What the server stores**: `user_id`, `mapping_id`, `encrypted_blob`, timestamps. The server cannot decrypt without the password.

4. **Password loss**: if the user forgets their password and exhausts their 10 recovery codes, all mappings are permanently inaccessible. This is by design. **Explicit warning shown at signup and in the dashboard.**

### 5.2 Recovery Codes

- 10 one-time recovery codes generated at signup, shown once.
- Each code: `base32(random_10_bytes)` → 16 uppercase characters, formatted as XXXX-XXXX-XXXX-XXXX.
- Stored server-side as `bcrypt(code)` per row (not the plaintext).
- On use: code is verified against bcrypt hash, then the row is deleted (one-time).
- Recovery codes do NOT decrypt mappings directly. They are used to authenticate a password-reset flow:
  - User submits recovery code + new password.
  - Server verifies code (bcrypt), deletes code row, updates password hash, regenerates Argon2id salt.
  - **All existing mappings become permanently inaccessible** (new salt = new master_key = cannot decrypt old blobs).
  - User is warned of this consequence at every step of the recovery flow.

### 5.3 JWT Authentication

- Login: `POST /recode/auth/login` with `{email, password}`.
- Server verifies bcrypt(password). Issues JWT:
  ```json
  {
    "sub": "user_id",
    "email": "user@example.com",
    "iat": 1716000000,
    "exp": 1716086400,
    "jti": "unique_token_id"
  }
  ```
  - Expiry: 24 hours (browser session).
  - Signing: HS256 with `RECODE_IT_JWT_SECRET` env var (32+ random bytes).
  - Storage: `sessionStorage` (tab-scoped, not `localStorage` — survives page refresh but not tab close).
- Token refresh: silent re-issue within 1 hour of expiry (optional, Phase 3).
- All `/recode/*` endpoints require `Authorization: Bearer <jwt>` except `/recode/auth/register` and `/recode/auth/login`.

### 5.4 HTTPS / Transport Security

- All traffic over TLS (already enforced on `mhc.micheleloi.pro`).
- COOP/COEP headers required for SharedArrayBuffer (WASM threading). Server must serve:
  ```
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  ```
  on the frontend origin (`micheleloi.pro`). This is a CDN/nginx config, not a Python change.

### 5.5 Threat Model Summary

| Threat | Mitigation | Residual risk |
|---|---|---|
| Server breach: attacker reads DB | AES-256-GCM encrypted blobs; cannot decrypt without user password | Low — password not stored |
| Network interception | TLS everywhere | Negligible |
| Malicious JS injection (XSS) | React escapes by default; no `dangerouslySetInnerHTML`; strict CSP | Low |
| Browser zero-day / Spectre | Out of scope for this threat model; browser security team's responsibility | Residual — disclose in DPIA |
| Brute-force login | bcrypt (12 rounds) + rate limiting (5 attempts / 15 min per IP) | Low |
| Recovery code enumeration | bcrypt per code + rate limiting + single-use | Low |
| Mapping_id enumeration | UUIDs v4; auth required for all operations | Low |

---

## 6. Database Schema

The Recode IT tables are **additive to the existing MHC-L schema** (`db.py`). They live in the same SQLite file. All existing MHC-L tables (`applications`, `api_keys`, `stripe_events_processed`) remain untouched.

### New tables

```sql
-- Recode IT users (separate from MHC-L api_keys; different auth model)
CREATE TABLE IF NOT EXISTS recode_users (
  id                     TEXT PRIMARY KEY,           -- UUID v4
  email                  TEXT NOT NULL UNIQUE,
  password_hash          TEXT NOT NULL,              -- bcrypt(password, 12 rounds)
  argon2_salt            TEXT NOT NULL,              -- hex(random_16_bytes); public; used client-side for Argon2id KDF
  tier                   TEXT DEFAULT 'free'
                         CHECK (tier IN ('free', 'pro')),
  status                 TEXT DEFAULT 'active'
                         CHECK (status IN ('active', 'suspended', 'deleted')),
  stripe_customer_id     TEXT,                       -- NULL until first payment; prep for billing
  stripe_subscription_id TEXT,                       -- NULL until first payment
  created_at             TIMESTAMP NOT NULL,
  last_login_at          TIMESTAMP,
  email_verified         INTEGER DEFAULT 0           -- 0=unverified, 1=verified
                         CHECK (email_verified IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_recode_users_email ON recode_users(email);
CREATE INDEX IF NOT EXISTS idx_recode_users_status ON recode_users(status);

-- Recovery codes (one-to-many with recode_users)
CREATE TABLE IF NOT EXISTS recode_recovery_codes (
  id          TEXT PRIMARY KEY,     -- UUID v4
  user_id     TEXT NOT NULL REFERENCES recode_users(id) ON DELETE CASCADE,
  code_hash   TEXT NOT NULL,        -- bcrypt(recovery_code)
  used        INTEGER DEFAULT 0 CHECK (used IN (0, 1)),
  created_at  TIMESTAMP NOT NULL,
  used_at     TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_recovery_codes_user ON recode_recovery_codes(user_id);

-- Encrypted mapping blobs (zero-knowledge)
CREATE TABLE IF NOT EXISTS encrypted_mappings (
  id               TEXT PRIMARY KEY,   -- UUID v4, generated client-side
  user_id          TEXT NOT NULL REFERENCES recode_users(id) ON DELETE CASCADE,
  blob             BLOB NOT NULL,      -- iv(12B) || ciphertext || auth_tag(16B), AES-256-GCM
  label            TEXT,               -- user-provided label, e.g. "Causa Rossi vs Bianchi"
  doc_type         TEXT,               -- 'pdf', 'docx', 'txt' — metadata only
  created_at       TIMESTAMP NOT NULL,
  last_accessed_at TIMESTAMP,
  size_bytes       INTEGER             -- len(blob); for quota enforcement
);

CREATE INDEX IF NOT EXISTS idx_mappings_user ON encrypted_mappings(user_id);
CREATE INDEX IF NOT EXISTS idx_mappings_user_created ON encrypted_mappings(user_id, created_at);

-- False positive preferences (server-side signal for future model improvement)
-- NOTE: stores the PSEUDONYM (e.g. "Metropoli"), NOT the original value.
-- The server never sees original values.
CREATE TABLE IF NOT EXISTS user_false_positive_preferences (
  id                          TEXT PRIMARY KEY,  -- UUID v4
  user_id                     TEXT NOT NULL REFERENCES recode_users(id) ON DELETE CASCADE,
  pseudonym                   TEXT NOT NULL,     -- what was flagged as false positive in the pseudonymized text
  originally_detected_category TEXT NOT NULL,   -- e.g. 'persona', 'luogo', 'organizzazione'
  marked_at                   TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fp_user ON user_false_positive_preferences(user_id);

-- Email verification tokens (short-lived, single-use)
CREATE TABLE IF NOT EXISTS recode_email_tokens (
  token_hash  TEXT PRIMARY KEY,     -- SHA-256(token)
  user_id     TEXT NOT NULL REFERENCES recode_users(id) ON DELETE CASCADE,
  purpose     TEXT NOT NULL         -- 'email_verification'
              CHECK (purpose IN ('email_verification')),
  expires_at  TIMESTAMP NOT NULL,
  used        INTEGER DEFAULT 0 CHECK (used IN (0, 1))
);
```

### Schema notes

- `recode_users.argon2_salt`: stored in hex, returned to the client at login. Never a secret; knowing the salt without the password gains nothing.
- `encrypted_mappings.blob`: the server treats this as opaque bytes. No attempt to parse or validate contents beyond `len(blob)`.
- `user_false_positive_preferences.pseudonym`: by design this stores the **pseudonymized** form (e.g., "Metropoli"), not the original place name. The server receives this from the client's false-positive marking UX. The original is never sent.
- `recode_users` intentionally not linked to `applications`/`api_keys`. Recode IT users have a separate identity from MHC-L API key holders. The Stripe integration is additive (nullable columns) to remain schema-compatible with future paid tiers.

---

## 7. API Endpoints

Base: `https://mhc.micheleloi.pro`  
All `/recode/*` endpoints except `/recode/auth/register` and `/recode/auth/login` require `Authorization: Bearer <jwt>`.  
All responses: `Content-Type: application/json`.

### 7.1 Authentication

#### POST /recode/auth/register
Register a new Recode IT account.

**Request:**
```json
{
  "email": "avvocato@studio.it",
  "password": "min8chars"
}
```

**Success 201:**
```json
{
  "user_id": "uuid",
  "email": "avvocato@studio.it",
  "argon2_salt": "hex16bytes",
  "recovery_codes": [
    "ABCD-EFGH-IJKL-MNOP",
    "QRST-UVWX-YZ12-3456",
    ... (10 total)
  ],
  "message": "Account creato. Salva i codici di recupero — non verranno mostrati di nuovo."
}
```

Server actions:
1. Validate email format + password length (≥8 chars).
2. Check email not already registered → 409 if duplicate.
3. Generate `user_id` (UUID v4), `argon2_salt` (random 16 bytes, hex-encoded).
4. Hash password with bcrypt (12 rounds).
5. Generate 10 recovery codes; store `bcrypt(code)` per row in `recode_recovery_codes`.
6. Insert `recode_users` row.
7. Send email verification link (async, non-blocking for response).
8. Return 201 with recovery codes in plaintext (only time they are returned).

**Errors:**
- 400: `{"error": "invalid_email"}` or `{"error": "password_too_short", "min_length": 8}`
- 409: `{"error": "email_already_registered"}`
- 500: `{"error": "server_error"}`

---

#### POST /recode/auth/login
Exchange credentials for JWT.

**Request:**
```json
{
  "email": "avvocato@studio.it",
  "password": "mypassword"
}
```

**Success 200:**
```json
{
  "token": "eyJ...",
  "expires_at": "2026-05-18T12:00:00Z",
  "user_id": "uuid",
  "argon2_salt": "hex16bytes"
}
```

`argon2_salt` is returned here so the client can immediately derive the `master_key` to decrypt mappings.

**Errors:**
- 401: `{"error": "invalid_credentials"}` (same message for wrong email and wrong password — no oracle)
- 429: `{"error": "rate_limit_exceeded", "retry_after": 900}`

---

#### GET /recode/auth/me
Returns current user info.

**Success 200:**
```json
{
  "user_id": "uuid",
  "email": "avvocato@studio.it",
  "tier": "free",
  "email_verified": true,
  "created_at": "2026-05-17T10:00:00Z"
}
```

---

#### POST /recode/auth/recovery-codes/verify
Use a recovery code to reset password. Destroys all existing mappings (user warned).

**Request:**
```json
{
  "email": "avvocato@studio.it",
  "recovery_code": "ABCD-EFGH-IJKL-MNOP",
  "new_password": "newpassword"
}
```

**Success 200:**
```json
{
  "message": "Password aggiornata. Tutti i mapping salvati sono stati eliminati perché non decriptabili con la nuova chiave.",
  "new_argon2_salt": "hex16bytes"
}
```

Server actions:
1. Look up user by email.
2. Rate-limit check (3 attempts / 30 min per IP).
3. Scan user's unused recovery codes; verify each with bcrypt. If match: mark used, proceed.
4. Generate new `argon2_salt`.
5. Update password hash + argon2_salt in `recode_users`.
6. Hard-delete all rows in `encrypted_mappings` for this user.
7. Return new salt.

**Errors:**
- 400: `{"error": "invalid_recovery_code"}`
- 429: `{"error": "rate_limit_exceeded", "retry_after": 1800}`

---

### 7.2 Mappings

#### POST /recode/mappings
Store a new encrypted mapping blob.

**Request:**
```json
{
  "mapping_id": "client-generated-uuid",
  "blob": "base64(iv||ciphertext||tag)",
  "label": "Causa Rossi vs Bianchi",
  "doc_type": "pdf"
}
```

**Success 201:**
```json
{
  "mapping_id": "client-generated-uuid",
  "created_at": "2026-05-17T10:05:00Z"
}
```

Server validation: `len(decoded blob) <= 2_000_000` (2MB limit — generous for a text mapping). Reject oversized blobs with 413.

**Errors:**
- 400: `{"error": "missing_fields"}`
- 409: `{"error": "mapping_id_conflict"}` (UUID already exists for this user)
- 413: `{"error": "blob_too_large", "max_bytes": 2000000}`

---

#### GET /recode/mappings
List user's mappings (metadata only — no blobs).

**Success 200:**
```json
{
  "mappings": [
    {
      "mapping_id": "uuid",
      "label": "Causa Rossi vs Bianchi",
      "doc_type": "pdf",
      "created_at": "2026-05-17T10:05:00Z",
      "last_accessed_at": "2026-05-17T14:00:00Z",
      "size_bytes": 1240
    }
  ]
}
```

---

#### GET /recode/mappings/{mapping_id}
Retrieve a specific encrypted blob.

**Success 200:**
```json
{
  "mapping_id": "uuid",
  "blob": "base64(iv||ciphertext||tag)",
  "label": "Causa Rossi vs Bianchi",
  "created_at": "2026-05-17T10:05:00Z"
}
```

Server updates `last_accessed_at` on retrieval.

**Errors:**
- 404: `{"error": "mapping_not_found"}` (also returned if mapping belongs to different user — no oracle)

---

#### DELETE /recode/mappings/{mapping_id}
Delete a single mapping.

**Success 204:** (no body)

---

#### DELETE /recode/mappings
Bulk delete by age or all. Query param: `?older_than_days=90` or `?all=true`.

**Success 200:**
```json
{
  "deleted_count": 12
}
```

---

#### PATCH /recode/mappings/{mapping_id}/false-positives
Record false positive signals (stores pseudonym, not original).

**Request:**
```json
{
  "false_positives": [
    {
      "pseudonym": "Metropoli",
      "originally_detected_category": "luogo"
    },
    {
      "pseudonym": "Tizio",
      "originally_detected_category": "persona"
    }
  ]
}
```

**Success 200:**
```json
{
  "recorded": 2
}
```

---

### 7.3 Account Management

#### DELETE /recode/account
Hard delete account + all mappings (GDPR Art. 17). Requires password confirmation.

**Request:**
```json
{
  "password": "mypassword",
  "confirm": "DELETE MY ACCOUNT"
}
```

**Success 200:**
```json
{
  "message": "Account e tutti i dati eliminati."
}
```

Server: bcrypt verify password, check `confirm == "DELETE MY ACCOUNT"`, then cascade-delete all data.

---

#### GET /recode/auth/verify-email/{token}
Email verification link handler. Returns HTML redirect (not JSON).

---

### 7.4 Stripe Webhook Extension

The existing `POST /webhooks/stripe` handler in `webhook_handler.py` is **not modified**. Recode IT Stripe events are discriminated by price ID prefix in a new handler function added to `webhook_handler.py`:

```python
if price_id.startswith(RECODE_IT_PRICE_PREFIX):
    _handle_recode_it_checkout_completed(conn, event)
else:
    # existing MHC-L logic
```

This updates `recode_users.tier`, `recode_users.stripe_customer_id`, `recode_users.stripe_subscription_id`.

---

## 8. Client-Side Pseudonymization Engine

This section describes the TypeScript port of the validated Python pipeline. The source of truth for the *behavior* of every component is the Python implementation in `MHC-L/tools/anonymize.py` plus the three bug fixes documented in `MHC-L/dev/ANONYMIZER_BUGS.md` and the regression-test fixtures in `MHC-L/dev/testing_documents/`. The port preserves logic, thresholds, fix details, and edge-case handling. Where this section omits detail, the Python reference is canonical.

### 8.1 Module Structure (TypeScript)

```
src/
  engine/
    regex_rules.ts        # Port of gate-local/tools/regex_rules.py
    stoplist.ts           # LEGAL_STOPLIST + FALSE_POSITIVE_PATTERNS (port)
    pools.ts              # PERSON_POOL, COMPANY_POOL, CITY_POOL, STREET_POOL (port from anonymize.py + vocabolario_pseudonimi_it.json)
    pseudonym_mapper.ts   # PseudonymMapper class (port of anonymize.py:126-410)
    gliner_runner.ts      # GLiNER ONNX via onnxruntime-web
    chunk_splitter.ts     # _split_into_chunks() port
    pipeline.ts           # Orchestrator: regex → GLiNER → mapper → detections
    recode.ts             # Reverse substitution: pseudonymized + mapping → original
  extraction/
    extract_pdf.ts        # pdf.js wrapper
    extract_docx.ts       # mammoth.js wrapper
    extract_text.ts       # plain text / markdown
  crypto/
    argon2_client.ts      # Argon2id via argon2-browser WASM package
    mapping_crypto.ts     # AES-256-GCM encrypt/decrypt via SubtleCrypto API
    recovery_codes.ts     # Client-side generation of recovery code display (server generates)
```

### 8.2 Porting Map (Python → TypeScript)

| Python source | TypeScript target | Port note |
|---|---|---|
| `regex_rules.py` REGEX_RULES (9 patterns) | `regex_rules.ts` | Literal: `re.compile(...)` → `new RegExp(...)`. Flags: `re.I` → `i`, `\b` works identically in JS. Lambda replacements → arrow functions. The internal `\s+` whitespace tolerance for OCR variants of CF/IBAN must be preserved. |
| `anonymize.py` LEGAL_STOPLIST | `stoplist.ts` | Literal: `set` → `Set<string>`. |
| `anonymize.py` FALSE_POSITIVE_PATTERNS | `stoplist.ts` | Literal. |
| `anonymize.py` TITLE_RE | `stoplist.ts` | **Includes the A-3 fix**: `^(?:[Ll]['’]\s*)?(?:Avv\.?\s*\|Ing\.?\s*\|Geom\.?\s*\|Dott\.?(?:ssa)?\s*\|Notaio\s*\|Sig\.?(?:ra)?\s*\|Prof\.?\s*)`, with `re.I` (→ JS `i` flag). The elided-article prefix `[Ll]['’]` covers both straight `'` and curly `’` (U+2019). `Notaio` MUST be present. |
| `anonymize.py` `_ITALIAN_ARTICLES` | `stoplist.ts` | **Used by the A-1 fix**: Python `frozenset` → `new Set<string>` (18 articles: il/lo/la/i/gli/le/del/dello/della/dei/degli/delle/al/allo/alla/dal/dello/della…). Used to identify article-prefixed 2-word surname references that are coreference targets, distinct from multi-word full names. |
| `anonymize.py` `_DE_CUIUS_RE` | `stoplist.ts` | **A-2 fix**: literal port of the regex matching `"de cuius [Name]"` and `"[Name], de cuius"` (with optional `"il "` before `de cuius`). |
| `anonymize.py` PERSON_POOL + `vocabolario_pseudonimi_it.json` | `pools.ts` | Literal. Use the vocab JSON file's `persona` list (16 entries). |
| `anonymize.py` COMPANY_POOL, CITY_POOL, STREET_POOL | `pools.ts` | Literal. |
| `anonymize.py` PseudonymMapper | `pseudonym_mapper.ts` | **Includes A-1 and A-2 fixes.** All `dict` → `Map<string, string>`. `re.search` → `.test()` / `.exec()`. The `getPerson()` three-tier lookup and the `markSkip()` / `_skip_set` mechanism MUST be ported exactly as documented in §8.4. |
| `anonymize.py` `_split_into_chunks` | `chunk_splitter.ts` | Literal: `re.split(r'(\n\s*\n)', text)` → `text.split(/(\n\s*\n)/)`. |
| `anonymize.py` `_predict_chunk` / `apply_gliner_with_pseudonyms` | `gliner_runner.ts` + `pipeline.ts` | Replace Python GLiNER with onnxruntime-web + Transformers.js. **Thresholds preserved exactly**: 0.4 for `[persona, luogo]`, 0.65 for `[organizzazione]`, 0.6 for `[numero di causa, tribunale, avvocato, email, telefono, iban]`. The de cuius pre-pass (`_find_decuius_names` → `mark_skip`) runs **before** the GLiNER seeding step. |
| `anonymize.py` `apply_regex_rules` | `regex_rules.ts` | Port with detection-list output. |
| `scripts/_vocab.py` VocabAllocator | Inline in `pseudonym_mapper.ts` | Literal. |

### 8.3 PseudonymMapper — The A-1 Fix (Three-Tier Person Lookup)

The single most behaviorally load-bearing part of the port. The Python `get_person()` resolves an input name string to a pseudonym via three tiers, in order:

1. **Exact key match.** If the lowercased input (after title stripping) is already in `_person_map`, return its pseudonym. This handles repeated mentions of the same full name.
2. **Surname lookup — restricted.** Only applies when the input is:
   - a single word (bare surname reference like `"Vanzetti"`), or
   - a 2-word input whose first word is in `_ITALIAN_ARTICLES` (article-prefixed surname like `"la Vanzetti"`, `"del Ferrari"`).
   In both cases the surname is extracted (word 1, or word 2 after stripping the article) and looked up in `_surname_map`. If found, return the registered pseudonym. **Multi-word inputs not matching this pattern do NOT fall back to surname lookup** — this is the A-1 fix.
3. **Allocate new pseudonym** from `PERSON_POOL`. Register the new entry in `_person_map` keyed on the lowercased full input. Register `_surname_map[surname] = pseudonym` **only if `_surname_map` does not already contain that surname** (first occurrence wins; subsequent persons with the same surname get their own pseudonym but do NOT overwrite the surname index).

Documented consequence: `"la Vanzetti"` (bare reference) resolves to the first-registered Vanzetti. This is intended behavior, not a bug.

### 8.4 PseudonymMapper — The A-2 Fix (De cuius Exemption)

Before the GLiNER seeding step, the orchestrator calls `findDecuiusNames(text)` which applies `_DE_CUIUS_RE` and returns a `Set<string>` of names adjacent to "de cuius" phrases. Each name is passed to `mapper.markSkip(name)`, which inserts the lowercased name into `_skip_set`. When `getPerson()` is called with a name whose lowercased form is in `_skip_set`, it returns the original input unchanged (no pseudonymization).

The exemption is grounded in GDPR Recital 27 (the Regulation does not apply to data of deceased persons). The decision rationale — exempt entirely vs. assign distinct pseudonym vs. role label — is documented in `MHC-L/dev/traces/trace_anonymizer_ner_bug_analysis_20260416.md` §A-2.

Known limitation, inherited verbatim: only the "de cuius" phrase triggers the exemption. "deceduto il [Name]" without "de cuius" does not. This is sufficient for canonical Italian procedural language; expanding the pattern is a future enhancement.

### 8.5 TITLE_RE — The A-3 Fix (Elided Article)

`TITLE_RE` strips a leading title (`Avv.`, `Ing.`, `Geom.`, `Dott.`, `Dott.ssa`, `Notaio`, `Sig.`, `Sig.ra`, `Prof.`) from a GLiNER span so the mapper sees the bare name. The fix prepends an optional elided-article matcher `^(?:[Ll]['’]\s*)?` covering both straight apostrophe `'` and the curly apostrophe `’` (U+2019, common in typeset Italian). Without this, GLiNER spans like `"L'Avv. Amadori"` keyed the surname index as `"l'avv"` and corrupted coreference.

`Notaio` MUST be in the title set (was absent in the pre-fix regex). The fix is documented at `MHC-L/dev/ANONYMIZER_BUGS.md` §A-3.

### 8.6 GLiNER ONNX in Browser

Model: `urchade/gliner_multi-v2.1` converted to ONNX format — the same model used by the Python reference pipeline. The thresholds (§8.2 row 12) are the empirically tuned values from MHC-L Phase 1, not new hyperparameters to discover.

Distribution: served from `micheleloi.pro/recode-it/models/gliner_multi_v2.1_quantized_int8.onnx`.  
Size target: 80-120MB (int8 quantized from the ~300MB float32 Python model).  
Cache: `Cache API` (`caches.open('recode-it-models-v1')`). Survives tab close; invalidated only on version bump.  
Loading: Web Worker to avoid blocking UI thread.

The port-correctness concern at this layer is *numerical fidelity*: does ONNX-int8 inference in onnxruntime-web on the same input produce a span list close enough to the Python `GLiNER.predict_entities` output that the downstream PseudonymMapper produces equivalent mappings? This is verified by golden-file tests against the Python reference output on the `dev/testing_documents/` fixtures (see TEST_PLAN.md Phase 4 and OPEN_RISKS.md R-01-NEW).

```typescript
// gliner_runner.ts sketch
import { InferenceSession, Tensor } from 'onnxruntime-web'
import { AutoTokenizer } from '@huggingface/transformers'

const MODEL_URL = '/recode-it/models/gliner_multi_v2.1_q8.onnx'
const TOKENIZER_ID = 'urchade/gliner_multi-v2.1'

export async function loadModel(): Promise<{session: InferenceSession, tokenizer: any}> {
  const cached = await caches.open('recode-it-models-v1')
  let modelBuffer: ArrayBuffer
  const cached_response = await cached.match(MODEL_URL)
  if (cached_response) {
    modelBuffer = await cached_response.arrayBuffer()
  } else {
    const resp = await fetch(MODEL_URL)
    await cached.put(MODEL_URL, resp.clone())
    modelBuffer = await resp.arrayBuffer()
  }
  const session = await InferenceSession.create(modelBuffer, { executionProviders: ['wasm'] })
  const tokenizer = await AutoTokenizer.from_pretrained(TOKENIZER_ID)
  return { session, tokenizer }
}
```

### 8.7 Recode (Reverse Substitution)

The `mapping_object` structure (in memory):

```typescript
interface MappingEntry {
  pseudonym: string       // e.g. "Tizio"
  original: string        // e.g. "Mario Rossi"
  category: string        // e.g. "persona"
  source: 'gliner' | 'regex'
  isFalsePositive: boolean
}

type MappingObject = MappingEntry[]
```

Recode algorithm:
1. Sort entries by `pseudonym.length` descending (longest first — prevents "Alfa" matching inside "Alfa S.r.l.").
2. For each entry where `!isFalsePositive`: `responseText = responseText.split(entry.pseudonym).join(entry.original)`.
3. Return restored text.

Note: regex replacements use structured tags (`<DS>`, `<IBAN>`, `<EMAIL>`) not Tizio/Caio names. These are stored in the mapping with `source: 'regex'` and recoded the same way.

---

## 9. False Positive UX

Each detected entity in the review panel shows three action buttons:

```
┌─────────────────────────────────────────────────────────────┐
│ "Emilia" → Tizio    [✓ Accetta]  [↕ Cambia cat.]  [✗ Falso positivo]  │
└─────────────────────────────────────────────────────────────┘
```

- **[Accetta]**: keep pseudonym as assigned.
- **[Cambia categoria...]**: dropdown (persona / luogo / organizzazione / altro); reassigns pseudonym from appropriate pool.
- **[Falso positivo — ripristina originale]**: removes entry from mapping; the original token appears unchanged in the output text. Sets `isFalsePositive: true` on the entry.

When user clicks "Falso positivo":
1. The entity is removed from the active pseudonym → original mapping.
2. The pseudonymized text preview is updated to show the original token in place.
3. The entry is stored locally with `isFalsePositive: true` and its pseudonym for server reporting.
4. If user saves the mapping, false positive pseudonyms are batched and sent via `PATCH /recode/mappings/{id}/false-positives`.

The three-button pattern is the browser equivalent of the multi-step reflection workflow described in `MHC-L/privacy.md` §"State 1 — Pseudonymization routine active" and `MHC-Work/notes/research/mhc-l/multi_step_pseudonimization_design_20260501.md`. The user-review step is not cosmetic; it is the contractual hinge of the DPA §2.2.4 obligation (the Controller's duty to verify before transmission).

---

## 10. Error Handling and Edge Cases

| Scenario | Handling |
|---|---|
| PDF with no text layer (scanned) | pdf.js returns empty string → show banner: "PDF scannerizzato rilevato — carica come testo o usa PDF con testo incorporato. OCR disponibile in Phase 2." |
| File too large (>10MB) | Client-side check before parsing → error banner |
| Model not yet loaded (user acts too fast) | Show loading spinner; queue the drag-and-drop; process when model ready |
| GLiNER inference error | Fall back to regex-only mode; show banner "NER non disponibile — solo regex attivi" |
| ONNX model fails to load | Same fallback; log to console |
| AES-GCM decryption failure (wrong password) | Show: "Impossibile decriptare il mapping. Verifica di usare la stessa password con cui è stato salvato." |
| Server returns 401 on mapping save | Redirect to login; store mapping in sessionStorage temporarily |
| Server 503/timeout on save | Retry with exponential backoff (3 attempts); show inline error after failure |
| Tab closed before save | Session-only mapping is lost. If user hasn't explicitly saved, show "Unsaved changes" banner when they navigate away. |
| Mobile device detected | Show dedicated message: "Recode IT funziona su desktop — aprilo da un computer. Il supporto mobile è in programma." (no functional UI rendered) |
| Clipboard API blocked | Show modal with pseudonymized text in a textarea for manual copy |
