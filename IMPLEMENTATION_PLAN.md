# Recode IT — Implementation Plan

**Version:** 2.0  
**Date:** 2026-05-17  
**Effort unit:** "engineer-week" = one capable Sonnet session (full context, focused implementation). For the founder+Sonnet operating mode, multiply by ~2 (context-switching, review, debugging cycles not in the estimate). The estimates below use Sonnet-session weeks.

**Reuse posture.** This plan ports the validated Python pipeline from MHC-L (see DESIGN.md §2 "Heritage from MHC-L"). The empirical quality of GLiNER on Italian legal text is a settled question — established with three documented bug fixes (A-1, A-2, A-3) and regression suites (`test_drift.py`, `test_full_pipeline.py`). What this plan engineers is *port fidelity* (equivalence between the TypeScript-in-browser and Python-on-server implementations), not quality discovery. The implications for sequencing are: (a) Phase 1 ports the bug-fix regression tests alongside the engine code; (b) Phase 4 is a numerical-equivalence test against the Python reference, not a quality spike; (c) no legal-consultation gate before launch (the DPA/privacy position transfers from MHC-L).

---

## Phase Dependencies Overview

```
Phase 0 (Repo + Build)
    │
    ├──→ Phase 1 (Engine Port + Bug-Fix Regression Suite, no UI)
    │         │
    │         ├──→ Phase 2 (Two-panel UI, regex-only)
    │         │         │
    │         │         └──→ Phase 5 (False positive UX) — can start after Phase 2
    │         │
    │         └──→ Phase 4 (GLiNER ONNX + Numerical-Equivalence Port Test)
    │                      depends on Phase 1 engine + the regression fixtures
    │
    └──→ Phase 3 (Auth + Backend) — can start in parallel with Phase 1
              │
              └──→ Phase 6 (MVP Smoke Test + Mobile Detection) — gate for public launch
```

Phases 1 and 3 can run in parallel (no dependency).  
Phase 4 requires the Phase 1 engine scaffolding AND the regression fixtures (the four `dev/testing_documents/*.md` files plus their Python golden outputs).  
Phase 5 requires Phase 2 UI.  
Phase 6 requires all prior phases complete and passing their gates.

There is no separate empirical-quality gate before Phase 4. The quality work was done in MHC-L Phase 1 (April 2026); Phase 4 here confirms the browser implementation matches the reference.

---

## Phase 0 — Repo Setup + Build Pipeline + Hello World

**Delivers:** A working Vite + React + TypeScript project that renders a placeholder page at `micheleloi.pro/recode-it/`, with WASM enabled and COOP/COEP headers verified.

**Estimated effort:** 0.5 Sonnet-weeks

### Tasks

1. **Init repo**: `recode-it/` as a new sibling repo (not inside MHC-Work or MHC-L).
   ```
   recode-it/
     frontend/       # Vite + React + TypeScript
     backend/        # New Python modules added to mhc.micheleloi.pro
     README.md
   ```

2. **Frontend scaffold**:
   ```bash
   npm create vite@latest frontend -- --template react-ts
   cd frontend
   npm install onnxruntime-web @huggingface/transformers zustand
   npm install -D tailwindcss @types/react
   ```

3. **COOP/COEP headers**: Configure Vite dev server + nginx (production):
   ```javascript
   // vite.config.ts
   server: {
     headers: {
       'Cross-Origin-Opener-Policy': 'same-origin',
       'Cross-Origin-Embedder-Policy': 'require-corp',
     }
   }
   ```

4. **WASM smoke test**: Load a tiny ONNX model (e.g., identity model 1KB) in a Web Worker; verify inference completes without error in Chrome, Firefox, Safari.

5. **Placeholder page**: "Recode IT — in arrivo" with Tailwind styles; deploy to `micheleloi.pro/recode-it/` via the existing deployment mechanism.

6. **Backend project structure**: Create `backend/recode_it/` Python package with `__init__.py`, `routes.py`, `auth.py`, `mappings.py`, `db_recode.py`. No logic yet — just stub handlers returning `{"status": "not_implemented"}`.

7. **CI/CD baseline**: Add a `Makefile` with `make build`, `make test`, `make deploy` targets. Verify build pipeline produces a `dist/` that can be served.

### Gate condition

- Frontend builds without errors.
- COOP/COEP headers verified in browser DevTools (Application → Security tab shows "isolated" context).
- WASM smoke test passes in at least Chrome + Firefox.
- Placeholder page live at `micheleloi.pro/recode-it/`.

---

## Phase 1 — Pseudonymization Engine Port + MHC-L Regression Suite (No GLiNER)

**Delivers:** A tested TypeScript module that reproduces the regex + PseudonymMapper behavior of `anonymize.py` and `regex_rules.py`, *including the three production bug fixes A-1 / A-2 / A-3 and their regression tests*. No UI. No WASM NER yet. Input: plain text string + optional pre-supplied NER detections. Output: `{pseudonymized_text, detections, mapping_entries}`. The TypeScript regression suite ports the Python `test_drift.py` / `test_full_pipeline.py` discipline (run pipeline → inspect mapping for collisions and de cuius exemption → recode → assert drift = 0).

**Estimated effort:** 2 Sonnet-weeks (was 1.5 — added for porting the regression fixtures and the inspection-discipline tests).

### Tasks

1. **Port `regex_rules.py` → `src/engine/regex_rules.ts`**:
   - 9 regex patterns: CF (two variants), CF_NUM (two variants), P.IVA, IBAN IT, CRO, PROT, EMAIL.
   - Port note: Python `re.compile(r'...', re.I)` → `new RegExp('...', 'gi')`. Lambda replacements → arrow functions. Python `\b` boundary → works identically in JS.
   - Implement `applyRegexRules(text: string): {text: string, detections: Detection[]}`.
   - Key gotcha: Python regex `.sub()` with a callable replaces once per match; JS `.replace()` with `/g` flag does the same. Test that CF patterns with OCR whitespace variants work (the `\s+` internal pattern).

2. **Port stoplists → `src/engine/stoplist.ts`** (incorporating fixes A-2 and A-3):
   - `LEGAL_STOPLIST` (Set of ~20 phrases).
   - `FALSE_POSITIVE_PATTERNS` (4 compiled regexes).
   - **`TITLE_RE` — the A-3 fix variant**: must include the optional elided-article prefix `^(?:[Ll]['’]\s*)?` and must include `Notaio`. See DESIGN.md §8.5 and `MHC-L/dev/ANONYMIZER_BUGS.md` §A-3.
   - **`_ITALIAN_ARTICLES`** — the 18-word Set used by the A-1 surname-lookup carve-out.
   - **`_DE_CUIUS_RE`** — the A-2 regex, literal port.
   - Exports: `isStoplist(text)`, `findDecuiusNames(text): Set<string>`, `stripTitle(name): {title, bare}`.

3. **Port pools → `src/engine/pools.ts`**:
   - Inline pools from `anonymize.py`: PERSON_POOL (16), COMPANY_POOL (10), CITY_POOL (12), STREET_POOL (12).
   - Cross-check with `vocabolario_pseudonimi_it.json` — use the union, with vocab JSON taking precedence for `persona` and `luogo`.

4. **Port PseudonymMapper → `src/engine/pseudonym_mapper.ts`** (incorporating fix A-1):
   - Class `PseudonymMapper` with all maps as `Map<string, string>` (`_personMap`, `_surnameMap`, `_companyMap`, `_cityMap`, `_streetMap`, `_courtMap`, `_orgMap`) plus `_skipSet: Set<string>`.
   - Methods: `getPerson()`, `getCompany()`, `getCity()`, `getStreet()`, `getCourt()`, `getOrg()`, `markSkip()`, `summary()`, `detectCollisions()`.
   - **`getPerson()` — the A-1 three-tier lookup**, ported per DESIGN.md §8.3:
     - Tier 1: exact full-name match in `_personMap`.
     - Tier 2: surname lookup restricted to (a) single-word input or (b) 2-word input where word 1 ∈ `_ITALIAN_ARTICLES`.
     - Tier 3: allocate new pseudonym; register in `_personMap`; register in `_surnameMap` ONLY if the surname is not already present.
   - **`markSkip()` + `_skipSet` — the A-2 hook**: when `getPerson()` finds the lowercased input in `_skipSet`, return the original input unchanged.
   - `getCompany()` suffix stripping (S.r.l., S.p.A., S.n.c., S.a.s.) → port directly.
   - `getCourt()`: Tribunale/Foro pattern → port directly.
   - `detectCollisions()`: returns `{pseudonym: [fullNames]}` for any pseudonym mapped to >1 distinct full name in `_personMap`. This is the inspection check from MHC-L's `test_drift.py`. Used by Phase 4 equivalence tests.

5. **Port chunk splitter → `src/engine/chunk_splitter.ts`**:
   - `splitIntoChunks(text: string, maxChars: number): {start: number, text: string}[]`.

6. **Pipeline orchestrator → `src/engine/pipeline.ts`**:
   - `pseudonymize(text: string, nerResults?: NerEntity[]): PseudonymizeResult`.
   - Pipeline order (matches Python `apply_gliner_with_pseudonyms`):
     1. `findDecuiusNames(text)` → seed `mapper.markSkip()` for each name (A-2 pre-pass — MUST run before person seeding).
     2. `applyRegexRules(text)` → first-pass structured identifier substitution.
     3. If `nerResults` supplied (Phase 4+): seed mapper from NER entities, two-pass replacement (full names first), filter via `isStoplist`.
     4. Return `{pseudonymized_text, detections, mappingEntries, collisions}`.
   - When `nerResults` is absent: regex-only mode (Phase 1 and Phase 2 pre-GLiNER).

7. **Recode primitive → `src/engine/recode.ts`**:
   - `recodeText(input, mappingEntries)`: sort entries by `pseudonym.length` desc, skip `isFalsePositive`, perform literal substring substitution.
   - This is the equivalent of `MHC-L/scripts/recode_gui.py:recode_text`.

8. **Vitest unit tests** (per-module):
   - `regex_rules.test.ts`: CF (16-char, OCR-spaced, lowercase, prefixed); P.IVA variants; IBAN IT vs DE; CRO; PROT; EMAIL (including PEC).
   - `stoplist.test.ts`: `isStoplist("parte attrice")` → true; FALSE_POSITIVE_PATTERNS hits; `findDecuiusNames` for "Mario Rossi, de cuius" and "de cuius Mario Rossi"; `stripTitle("L'Avv. Amadori")` → `{title: "L'Avv.", bare: "Amadori"}` (A-3 fixture); `stripTitle("Notaio Bianchi")` → `{title: "Notaio", bare: "Bianchi"}`.
   - `pseudonym_mapper.test.ts`: enumerate every A-1 / A-2 case (see Tasks 9 below).

9. **MHC-L Regression Suite (the bug-fix tests)** — `src/engine/__tests__/regression_mhc_l.test.ts`. These reproduce the MHC-L drift discipline in Vitest. Source fixtures: copy `MHC-L/dev/testing_documents/{doc_A_fendipista.md, doc_B_eredita.md, doc_C_il_leak.md, doc_00_appalto_edilizio.md}` into `recode-it/frontend/test-fixtures/mhc-l/`. Tests:
   - **A-1 regression** (doc_B_eredita): pipeline (regex-only, then later in Phase 4 with NER) → assert mapping contains distinct pseudonyms for `"erminia vanzetti"`, `"tarcisio vanzetti"`; assert `detectCollisions()` returns empty for these; assert bare `"la Vanzetti"` resolves to the first-registered Vanzetti.
   - **A-1 regression — coreference preserved** (doc_A_fendipista): assert `"la Oberti"` (article-prefixed surname) resolves to the same pseudonym as `"Silvana Oberti"`. This is the regression that was almost broken during the original A-1 fix.
   - **A-2 regression** (doc_B_eredita): assert `"Arturo Vanzetti"` (the de cuius) is **not** in `_personMap`; assert his real name appears verbatim in the pseudonymized output.
   - **A-3 regression** (doc_B_eredita): assert `"L'Avv. Amadori"` becomes `"L'Avv. <pseudo>"`; assert `_surnameMap` has key `"amadori"` (not `"l'avv"`); assert subsequent bare `"Amadori"` resolves to the same pseudonym.
   - **Drift smoke** (all four docs, regex-only mode): pipeline → simulate a pseudonymized passage as Claude output → recode → assert recoded output contains zero pseudonym tokens (drift = 0 on regex-detected entities).
   - **Title set completeness**: `Notaio` is recognized as a title (negative test: would have failed against the pre-A-3 regex).

### Gate condition

- All Vitest unit tests pass.
- All five regression tests in the MHC-L Regression Suite pass.
- `detectCollisions()` returns empty for `doc_A_fendipista`, `doc_C_il_leak`, `doc_00_appalto_edilizio`. For `doc_B_eredita`: empty in regex-only mode (no person collision possible without NER); the NER-on collision check is a Phase 4 gate.
- Regex scan on pseudonymized outputs: zero CF / IBAN / EMAIL patterns survive (per-document automated check).

---

## Phase 2 — Two-Panel UI (Regex-Only, No GLiNER Yet)

**Delivers:** The core UX working end-to-end with regex-only pseudonymization. User can drag a document, see the pseudonymized preview, correct entities, copy to clipboard, paste Claude's response, and see recoded output. No account needed (session-only mapping).

**Estimated effort:** 2 Sonnet-weeks

### Tasks

1. **Layout: Two-panel app**:
   ```
   ┌─────────────────────────────┬──────────────────────────────┐
   │  Pseudonymize               │  Recode                      │
   │  [drag drop area]           │  [paste area]                │
   │  Original text (read-only)  │  Pseudonymized               │
   │  Pseudonymized preview      │  → recoded on paste          │
   │  [Copy for Claude] [Save*]  │  [Copy final]                │
   └─────────────────────────────┴──────────────────────────────┘
   ```
   * Save is disabled until Phase 3 (auth). Show tooltip: "Salva richiede account — disponibile presto."

2. **Drag-and-drop zone**: Accept `.pdf`, `.docx`, `.txt`, `.md`.
   - `pdf.js` for PDF text extraction.
   - `mammoth.js` for DOCX.
   - Plain `FileReader` for text files.
   - Mobile detection: if `navigator.maxTouchPoints > 1` and screen width < 1024px → render "Usa un computer desktop" full-screen overlay.

3. **Entity review panel**: Below the pseudonymized preview, render a list of detected entities with three buttons each (see Design §8). In Phase 2, entities come from regex only. In Phase 4, GLiNER entities are added to this list.

4. **Mapping state** (Zustand store):
   ```typescript
   interface AppState {
     originalText: string
     pseudonymizedText: string
     mappingEntries: MappingEntry[]
     claudeResponse: string
     recodedResponse: string
     sessionId: string  // UUID, generated per session
   }
   ```

5. **Recode panel**: Textarea that auto-recodes on paste event using the in-memory mapping. `useEffect` watching `claudeResponse` → calls `recodeText()` → sets `recodedResponse`.

6. **Clipboard widget**: `[Copy for Claude]` button → `navigator.clipboard.writeText(pseudonymizedText)`. Show ✓ confirmation for 2s. `[Copy final]` similarly for recoded response.

7. **[Falso positivo] button**: Implemented in Phase 5 — placeholder button that shows a toast "disponibile a breve" in Phase 2.

8. **[Cambia categoria] button**: Dropdown with `persona / luogo / organizzazione`. On select: reassigns pseudonym from pool (calls `pseudonymMapper.getX()` for the new category), updates mapping, refreshes preview.

9. **Unsaved changes warning**: `beforeunload` event → confirm dialog if mapping has entries and hasn't been saved.

### Gate condition

- End-to-end manual test: drag a plain `.txt` file containing an Italian fiscal code, IBAN, and email → verify they are pseudonymized correctly → copy → simulate pasting response containing pseudonyms → verify recode restores originals.
- "Open on desktop" overlay displays correctly on a mobile device (or Chrome DevTools mobile emulation).
- No functional buttons are broken (disabled buttons show tooltip, not 404s).

---

## Phase 3 — Auth + Account + Mapping Server Endpoints

**Delivers:** Complete backend for user registration, login, JWT auth, recovery codes, encrypted mapping storage/retrieval/deletion, and account deletion. Database schema deployed.

**Estimated effort:** 2 Sonnet-weeks

### Tasks

1. **`db_recode.py`**: Add schema migration to create the 5 new tables (`recode_users`, `recode_recovery_codes`, `encrypted_mappings`, `user_false_positive_preferences`, `recode_email_tokens`). Extend `init_db()` in the existing `db.py` to call `init_recode_db()`, or add a separate migration script.

2. **`auth_recode.py`**: JWT generation/validation (`python-jose` or `PyJWT`). Middleware for `/recode/*` routes: extract Bearer JWT, verify signature + expiry, attach `user_id` to scope. Bcrypt password hashing (`passlib[bcrypt]`).

3. **`recode_users.py`**: Handler functions for `POST /recode/auth/register`, `POST /recode/auth/login`, `GET /recode/auth/me`, `DELETE /recode/account`.
   - Register: validate input, check email uniqueness, generate Argon2id salt (Python `secrets.token_bytes(16)`), hash password with bcrypt, generate 10 recovery codes (each `base32(secrets.token_bytes(10))`), store `bcrypt(code)` per row, send verification email via Resend.
   - Login: bcrypt verify, issue JWT, return `argon2_salt`.
   - Recovery code reset: `POST /recode/auth/recovery-codes/verify` — verify code against bcrypt hashes, update password + salt, cascade-delete all `encrypted_mappings`.

4. **`mappings.py`**: Handlers for all `/recode/mappings/*` endpoints. Validate blob size (2MB limit). Store/retrieve opaque bytes. Update `last_accessed_at` on GET. `PATCH` false-positives endpoint.

5. **Rate limiting**: Reuse/adapt the sliding-window rate limiter from `signup_handler.py` (`_rate_limit_check`). Apply to: login (5/15min per IP), recovery code verify (3/30min per IP), register (3/hour per IP).

6. **Route wiring**: Add all new routes to the Starlette router in `server.py`. Add `/recode/` prefix skip to `BearerAuthMiddleware`'s `skip_path_prefixes` for the auth endpoints (login/register). JWT middleware is a separate middleware applied only to `/recode/mappings/*` and `/recode/account`.

7. **Frontend: Login/Register flow**: Add a login/register modal (React). On successful login, store JWT in `sessionStorage`. Wire up "Save mapping" button to `POST /recode/mappings` with encrypted blob.

8. **Frontend: Mapping encryption** (`src/crypto/`):
   - `argon2_client.ts`: use `argon2-browser` npm package (WASM-based Argon2id in browser). Derive `master_key` from password + salt returned by `/recode/auth/login`.
   - `mapping_crypto.ts`: `encryptMapping(mapping: MappingEntry[], master_key: CryptoKey, mapping_id: string): Promise<Uint8Array>` using `SubtleCrypto.encrypt()` with AES-GCM.
   - `mapping_crypto.ts`: `decryptMapping(blob: Uint8Array, master_key: CryptoKey, mapping_id: string): Promise<MappingEntry[]>`.

9. **Frontend: Dashboard page**: `/recode-it/account` — list saved mappings (label, date, size), delete single, bulk delete by age, link to account deletion.

10. **Email verification flow**: Send verification link on register; `GET /recode/auth/verify-email/{token}` marks `email_verified = 1`. Unverified accounts can still use the tool (MVP — don't gate on verification, just show banner).

### Gate condition

- Register → receive recovery codes email → login → derive master_key → save mapping → logout → login again → retrieve and decrypt mapping correctly.
- Recovery code flow: use a recovery code → password reset → verify old mappings are inaccessible (decryption fails with new key) → verify recovery code is consumed (cannot use same code again).
- Account deletion: DELETE /recode/account → all DB rows for user confirmed absent.
- JWT expiry: expired token returns 401.
- Rate limiting: 6th login attempt within 15 minutes returns 429 with `retry_after`.

---

## Phase 4 — WASM Port + Numerical-Equivalence Test Against Python Reference

**Delivers:** The full pseudonymization pipeline with GLiNER NER running in the browser via ONNX-int8. Equivalence is verified against the Python reference output on the four canonical fixtures (`doc_A_fendipista.md`, `doc_B_eredita.md`, `doc_C_il_leak.md`, `doc_00_appalto_edilizio.md`). The acceptance criterion is not a fresh-quality benchmark; it is *matching the production Python behavior already validated in MHC-L*.

**Estimated effort:** 2.5 Sonnet-weeks (no preceding spike — the spike was done in MHC-L Phase 1 in April 2026 and is captured in `MHC-L/dev/traces/trace_anonymizer_ner_bug_analysis_20260416.md`).

### Pre-phase artifact: Python golden-output file

Before Phase 4 code begins, a minimal golden-output generator script is written as part of Recode IT (target location: `recode-it/scripts/generate_python_goldens.py`). The script imports `anonymize` directly from `MHC-L/gate-local/tools/anonymize.py`, runs it on each of the four fixture documents, and writes the structured output to `recode-it/frontend/test-fixtures/mhc-l/golden/`. The generator is ~50-80 lines and is a Recode IT deliverable — it does NOT depend on the MHC-L `dev/test_full_pipeline.py` test harness (which is stale post-X1 unification and parked as MHC-L technical debt; not a blocker for Recode IT). The golden output per document is a JSON file:

```json
{
  "source": "doc_B_eredita.md",
  "pipeline_version": "anonymize.py@<git-sha>",
  "person_map": { "erminia vanzetti": "Caio", "tarcisio vanzetti": "Sempronio", ... },
  "surname_map": { "vanzetti": "Caio", "amadori": "Tizio", ... },
  "skip_set": [ "arturo vanzetti" ],
  "collisions": {},
  "regex_substitutions": [ { "pattern": "CF_PERSONA", "count": 4 }, ... ],
  "ner_entities": [ { "start": 124, "end": 138, "label": "persona", "text": "Erminia Vanzetti", "score": 0.91 }, ... ],
  "pseudonymized_text": "..."
}
```

This is the contract the browser implementation must match (with the equivalence tolerances defined in the gate condition).

### Tasks

1. **Model preparation** (run once, not in the browser):
   - Download `urchade/gliner_multi-v2.1` PyTorch model.
   - Export to ONNX: `optimum-cli export onnx --model urchade/gliner_multi-v2.1 gliner_onnx/`.
   - Quantize int8: `python -m onnxruntime.quantization.quantize_static` or use `optimum` quantization.
   - Target: ≤120MB file.
   - Host as static asset at `micheleloi.pro/recode-it/models/gliner_multi_v2.1_q8.onnx`.
   - **This is a one-time setup task, done by the founder before Phase 4 code begins.**

2. **`src/engine/gliner_runner.ts`**:
   - Web Worker (`gliner.worker.ts`) that loads the ONNX model + tokenizer.
   - Main thread ↔ Worker communication via `postMessage`/`onmessage`.
   - Implement `predictChunk(text: string): NerEntity[]` replicating Python `_predict_chunk()` with the three threshold tiers (preserved exactly):
     - `threshold 0.4`: `["persona", "luogo"]`
     - `threshold 0.65`: `["organizzazione"]`
     - `threshold 0.6`: `["numero di causa", "tribunale", "avvocato", "email", "telefono", "iban"]`
   - Overlap resolution (sort by score desc, skip overlapping spans) — port from `_predict_chunk`.
   - Apply `isStoplist()` filter before returning.

3. **Model loading UX**:
   - On first visit: show progress bar during model download (use `fetch` with `ReadableStream` progress tracking).
   - After first load: model is in Cache API; subsequent visits skip download (show "NER pronto" indicator).
   - Loading time estimate (shown to user): "Prima visita: 15-60 secondi a seconda della connessione. Visite successive: immediato."

4. **Integrate GLiNER results into `pipeline.ts`** (the Python order is canon):
   - Pipeline: `findDecuiusNames` (A-2 pre-pass) → `applyRegexRules` → `splitIntoChunks` → `predictChunk` per chunk (in Worker) → merge spans → dedup overlaps → filter stoplist → seed PseudonymMapper (two-pass: full names before partials).

5. **GLiNER fallback**: If `InferenceSession.create()` throws (browser too old, WASM disabled), fall back to regex-only mode with user-visible warning. Same behavior as the Python reference when GLiNER fails to load.

6. **Entity review panel update**: GLiNER detections now appear alongside regex detections in the review panel. Each GLiNER entity shows its `score` (e.g., "0.87") as a small badge to help users decide.

7. **Numerical-equivalence test harness** → `src/engine/__tests__/equivalence_python_ref.test.ts`:
   - For each of the four fixture documents: load the corresponding golden JSON; run the browser pipeline (regex + GLiNER + mapper); compare:
     - **Mapping equivalence (strict)**: `person_map`, `surname_map`, `skip_set`, `_companyMap`, `_cityMap` keys MUST match exactly. Pseudonym *values* may differ if pool allocation order differs across implementations (acceptable, as long as the structure of identity is preserved — i.e., persons that share a pseudonym in Python share one in TS).
     - **Collision equivalence (strict)**: `detectCollisions()` set must equal the golden `collisions` set.
     - **De cuius exemption (strict)**: every name in golden `skip_set` must be in browser `_skipSet`; the corresponding real names must appear verbatim in the browser pseudonymized output.
     - **Regex substitution counts (strict)**: per pattern, browser count == golden count.
     - **NER span equivalence (tolerant)**: for each `(start, end, label)` in golden, the browser must produce a span with the same `(start, end)` and `label` within ±2 character tolerance on boundaries (allows for tokenizer drift) and the same label. Per-document: ≥95% of golden spans matched; ≤5% browser-extra spans; ≤5% golden-missed spans. This is the int8-quantization tolerance band — these spans must still produce equivalent mappings after the PseudonymMapper runs, even if individual span scores differ.
     - **Recode round-trip (strict)**: take golden `pseudonymized_text`, pass through browser `recodeText` with browser-derived mapping → assert the result == the original fixture document content (modulo unimportant whitespace).

### Gate condition

- All four fixture documents pass the equivalence test harness (Task 7) at the stated tolerances.
- All Phase 1 MHC-L Regression Suite tests pass with GLiNER on (not just regex-only).
- Performance: end-to-end pipeline on `doc_B_eredita.md` (~5KB) completes in <30s on a 2022-era laptop; on a 10-page synthetic document in <60s. (These are the same performance targets as MHC-L; the Python reference meets them.)
- Fallback test: ONNX disabled → regex-only mode still passes drift-smoke checks.
- If equivalence fails on a fixture: the failure is investigated as a *port bug*, not a quality issue. Re-tuning thresholds is permitted only if the issue is traced to a documented numerical-quantization effect (which then becomes a documented divergence in DESIGN.md §8.6 and a new risk in OPEN_RISKS.md). The thresholds 0.4 / 0.65 / 0.6 are otherwise canonical.

---

## Phase 5 — False Positive UX

**Delivers:** The full three-button entity review UX (`[Accetta]`, `[Cambia categoria...]`, `[Falso positivo]`) with correct preview updates and server reporting of false positives.

**Estimated effort:** 1 Sonnet-week

### Tasks

1. **Replace Phase 2 placeholder buttons** with full implementations:
   - `[Accetta]`: marks entity as accepted (no-op on the mapping — it's already accepted by default).
   - `[Cambia categoria...]`: as implemented in Phase 2, but now also applies to GLiNER entities.
   - `[Falso positivo — ripristina originale]`:
     - Sets `isFalsePositive: true` on the `MappingEntry`.
     - Removes the pseudonym → original mapping from the recode table.
     - Replaces the pseudonym with the original in `pseudonymized_text` (string replacement).
     - Updates the entity list visual state (grayed out, "rimosso").

2. **Preview live update**: The pseudonymized preview text must update in real-time as user accepts/changes/marks false positives. Use the Zustand store to trigger re-renders on mapping state changes.

3. **False positive server reporting**: When user saves mapping, batch all `isFalsePositive` entries and send `PATCH /recode/mappings/{id}/false-positives`. This is a best-effort fire-and-forget (failure silently ignored — the pseudonymization still works).

4. **Undo**: "Annulla" button per entity that reverts the most recent action on that entity (accept/change/false-positive). Implement as a simple per-entity action stack (max 1 level of undo is sufficient for MVP).

### Gate condition

- Manual test: document containing "Emilia-Romagna" → GLiNER flags "Emilia" as PERSON → user clicks [Falso positivo] → "Emilia-Romagna" appears unchanged in output → recode panel does not attempt to restore "Emilia" → server receives false positive report when mapping is saved.
- Undo: mark false positive → click undo → entity is back in mapping → pseudonym appears in output.

---

## Phase 6 — MVP Smoke Test + Mobile Detection + Launch Readiness

**Delivers:** A hardened MVP that passes the end-to-end user journey test, with mobile detection, error state coverage, and DPIA-ready architecture documentation.

**Estimated effort:** 1 Sonnet-week

### Tasks

1. **Mobile detection**: Implement `isMobileDevice()` check at app root:
   ```typescript
   const isMobile = navigator.maxTouchPoints > 1 && window.innerWidth < 1024
   ```
   If true, render full-screen: "Recode IT funziona su computer desktop. Aprilo dal browser del tuo computer."

2. **Error state audit**: Walk through every error case in Design §9 and verify each shows an appropriate UI message (no silent failures, no raw error objects in the UI).

3. **CSP header**: Add a strict Content Security Policy to the nginx/CDN config:
   ```
   Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' https://mhc.micheleloi.pro; object-src 'none';
   ```
   Adjust `connect-src` if the GLiNER model is fetched from a separate CDN.

4. **Privacy verifiability**: Add a "Come funziona" section to the UI that includes a screenshot guide showing how to use browser DevTools to verify that no real names are sent. This is the DPO pitch artifact.

5. **End-to-end smoke test** (manual, by founder): Full user journey (see TEST_PLAN.md §4 for script).

6. **Landing page**: Write and deploy the landing page at `micheleloi.pro/recode-it/`. Minimum content: product description, how it works (3 steps), privacy claim + verification guide, CTA to create account.

7. **Performance check**: Lighthouse audit on the app page. Target: LCP < 3s on desktop (excluding model load — that's gated on the progress bar). No layout shifts during model loading.

8. **Dependency audit**: `npm audit` + `pip-audit`. No high-severity vulnerabilities in production dependencies.

### Gate condition

- Full end-to-end test passes (TEST_PLAN.md §4 checklist).
- Mobile overlay visible on Chrome DevTools mobile emulation.
- `npm audit` reports zero high/critical vulnerabilities.
- CSP header set and no CSP violations in browser console on normal usage.
- DPIA-relevant architecture section complete in DESIGN.md (this document serves that purpose).

---

## Sequencing Summary

| Phase | Depends on | Parallelizable with | Sonnet-weeks |
|---|---|---|---|
| 0 — Repo + Build | Nothing | Nothing | 0.5 |
| 1 — Engine Port + Regression Suite | Phase 0 | Phase 3 | 2.0 |
| 2 — Two-panel UI | Phase 1 | Phase 3 | 2.0 |
| 3 — Auth + Backend | Phase 0 | Phase 1 | 2.0 |
| 4 — WASM Port + Numerical-Equivalence Test | Phase 1 + Python golden files | Phase 3 (backend done) | 2.5 |
| 5 — False Positive UX | Phase 2 | — | 1.0 |
| 6 — MVP Launch | All phases | — | 1.0 |
| **Total** | | | **11.0** |

With founder+Sonnet operating mode multiplier (~2x): **~5-6 months** to public MVP.  
With 7-tester private beta gate at Phase 4 completion: ~3-4 months.

The 0.5-week increase vs. the prior plan reflects the regression-suite porting work in Phase 1. The Phase 4 estimate is unchanged in magnitude but its content has shifted: from "build NER + spike to validate quality" to "build NER + assert equivalence with the validated reference." The total schedule is comparable; the *risk profile* is much smaller because the quality unknown has been collapsed into a fidelity check with an explicit acceptance contract.

---

## Key Architectural Decisions Per Phase (Gate Decisions)

### Before Phase 1 begins
- **Copy the MHC-L test fixtures** (`dev/testing_documents/doc_A_fendipista.md`, `doc_B_eredita.md`, `doc_C_il_leak.md`, `doc_00_appalto_edilizio.md`) into `recode-it/frontend/test-fixtures/mhc-l/`. These are not new fixtures — they are the same ones that revealed and proved out the A-1 / A-2 / A-3 bug fixes in MHC-L. They become the contract for the TypeScript port.
- **GLiNER ONNX model export**: the ONNX export and int8 quantization must be completed and the model served as a static asset before Phase 4 code starts. This is not a coding task — it requires running Python scripts in a local environment with PyTorch + optimum installed. **Schedule this in parallel with Phase 0–1.**

### Before Phase 4 begins
- **Produce Python golden-output JSON files** for the four fixtures by running `recode-it/scripts/generate_python_goldens.py` (the minimal generator that imports directly from `MHC-L/gate-local/tools/anonymize.py`) and committing the outputs to `test-fixtures/mhc-l/golden/`. Tag with the `anonymize.py` git SHA so re-runs are deterministic. This is the canonical contract Phase 4 must match.
- **No quality spike is required.** The empirical validation was done in MHC-L Phase 1 (April 2026). The Recode IT port is a fidelity exercise. If the equivalence test fails, the failure mode is "port bug" not "model unsuitable."

### Before Phase 6 (launch)
- **Inherit the MHC-L privacy / DPA position**: the architectural / legal position on pseudonymized text sent to Anthropic is documented in `MHC-L/legal/DPA.md` §2.2.2–§2.2.4 and `MHC-L/privacy.md` §"What MHC-L does NOT do" / §"State 1". Recode IT's landing-page copy, ToS, and Privacy Policy can be drafted directly from these templates. No new GDPR consultation is required pre-launch — the position is already drafted and was reviewed at the MHC-L DPA v1.0 milestone (2026-05-07). A specialist legal review remains on the MHC-L roadmap pre-Phase-2 (DPA frontmatter `status`), and Recode IT is naturally in scope of that review when it happens; it is not a blocker for the Recode IT MVP launch.
- **ToS / Privacy Policy**: draft Terms of Service and Privacy Policy for `micheleloi.pro/recode-it/`. The zero-knowledge architecture significantly simplifies the Privacy Policy (the server stores only ciphertext blobs it cannot read). The text of `MHC-L/privacy.md` "What MHC-L does NOT do" and §"For deeper review" is reusable almost verbatim.
- **DPIA template for prospective DPO-facing clients**: prepare a one-page DPIA template anchored on the Heritage section (DESIGN.md §2.3) so professional users can hand it to their DPO. This is a marketing artifact more than a compliance one.
