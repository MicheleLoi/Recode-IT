# Recode IT — Test Plan

**Version:** 2.0  
**Date:** 2026-05-17  
**Scope:** All phases 0-6. Per-phase: what to smoke test, what automated tests to write, what security checks to run.

**Testing posture.** Recode IT inherits a validated Python pipeline from MHC-L plus its regression discipline (see DESIGN.md §2 "Heritage from MHC-L"). The TypeScript port is verified against the existing MHC-L tests, ported as Vitest equivalents, and against Python golden-output JSON files generated from the four fixture documents (`MHC-L/dev/testing_documents/{doc_A_fendipista.md, doc_B_eredita.md, doc_C_il_leak.md, doc_00_appalto_edilizio.md}`). Per-bug test mapping is documented in §"Phase 1 — MHC-L Regression Suite (Vitest port of test_drift.py / test_full_pipeline.py)" below.

---

## Phase 0 — Repo + Build

### Smoke tests (manual)
- [ ] `npm run build` completes without errors in a fresh `node_modules` (CI-equivalent).
- [ ] `npm run dev` serves the app with COOP/COEP headers; verify in Chrome DevTools → Application → Security → "Cross-Origin Isolation: Enabled".
- [ ] WASM identity test: open browser console on `localhost:5173` → import a trivial ONNX model → run inference → no error.
- [ ] Placeholder page accessible at `micheleloi.pro/recode-it/` over HTTPS.
- [ ] Python stubs return `{"status": "not_implemented"}` — verify with `curl`.

### Automated tests
- None at this phase (scaffolding only).

### Security checks
- [ ] Verify CSP header is present and correct (even in skeleton form).
- [ ] Verify TLS certificate is valid for `mhc.micheleloi.pro` (existing, but confirm during deployment).

---

## Phase 1 — Engine Port

### Smoke tests (manual)
- [ ] Run `pipeline.pseudonymize("Mario Rossi, CF: RSSMRA70B03A662X, IBAN IT60X0542811101000000123456")` in Node.js / Vitest; verify output contains no original values.
- [ ] Run with "Emilia-Romagna" as input; verify it is NOT pseudonymized (it doesn't match the regex patterns and GLiNER is not loaded yet — so it should pass through unchanged).

### Automated tests (Vitest — see Implementation Plan Phase 1 §Tasks 7)

#### Regex layer (`regex_rules.test.ts`)
- [ ] CF persona: `RSSMRA70B03A662X` → `<DS>`
- [ ] CF persona lowercase (OCR): `rssmra70a01h501z` → `<DS>`
- [ ] CF persona with OCR spaces: `RSSMRO 80A01 H501Z` → `<DS>`
- [ ] CF with "C.F.:" prefix: `C.F.: 12345678901` → `C.F.: <DS>`
- [ ] CF with "Codice Fiscale" prefix: `Codice Fiscale 12345678901` → `Codice Fiscale <DS>`
- [ ] P.IVA with "P. IVA": `P. IVA 12345678901` → `P. IVA <P.IVA>`
- [ ] P.IVA with "PIVA": `PIVA12345678901` → `PIVA<P.IVA>`
- [ ] P.IVA with "Partita IVA": `Partita IVA 12345678901` → `Partita IVA <P.IVA>`
- [ ] IBAN IT: `IT60X0542811101000000123456` → `<IBAN>`
- [ ] IBAN non-IT (e.g., DE): not replaced
- [ ] CRO: `CRO: 1234567890123` → `CRO: <CRO>`
- [ ] PROT: `prot. n. MI/2024/001` → `prot. n. <PROT>`
- [ ] EMAIL: `mario.rossi@studio.it` → `<EMAIL>`
- [ ] EMAIL: PEC address `studio@pec.it` → `<EMAIL>`
- [ ] Multiple entities in same text: all replaced, offsets correct, no overlap

#### Stoplist layer (`stoplist.test.ts`)
- [ ] `isStoplist("parte attrice")` → `true`
- [ ] `isStoplist("il ricorrente")` → `true`
- [ ] `isStoplist("Sig.")` → `true` (FALSE_POSITIVE_PATTERNS match)
- [ ] `isStoplist("Dott.ssa")` → `true`
- [ ] `isStoplist("Mario Rossi")` → `false`
- [ ] De cuius: `findDecuiusNames("Mario Rossi, de cuius")` → `Set{"mario rossi"}`
- [ ] De cuius: `findDecuiusNames("de cuius Mario Rossi")` → `Set{"mario rossi"}`

#### PseudonymMapper (`pseudonym_mapper.test.ts`)
- [ ] First person: `getPerson("Mario Rossi")` → `"Tizio"`
- [ ] Second person: `getPerson("Luigi Bianchi")` → `"Caio"`
- [ ] Coreference (surname): `getPerson("Mario Rossi")` then `getPerson("Rossi")` → both return `"Tizio"`
- [ ] No coreference for multi-word (Bug A-1): `getPerson("Mario Rossi")` then `getPerson("Luigi Rossi")` → first `"Tizio"`, second `"Caio"` (NOT same)
- [ ] Title strip: `getPerson("Avv. Mario Rossi")` → `"Avv. Tizio"`
- [ ] Title strip Dott.ssa: `getPerson("Dott.ssa Maria Rossi")` → `"Dott.ssa Caia"` (or equivalent female pseudonym)
- [ ] Article-prefixed surname: `getPerson("il Rossi")` → `"il Tizio"` (coreference with "Mario Rossi" → "Tizio")
- [ ] De cuius exempt: mark "mario rossi" as skip, then `getPerson("Mario Rossi")` → `"Mario Rossi"` unchanged
- [ ] Company suffix: `getCompany("Acme S.r.l.")` → `"Alfa S.r.l."`
- [ ] Company suffix preserved on second occurrence: `getCompany("Acme S.p.A.")` → `"Alfa S.p.A."`
- [ ] Court: `getCourt("Tribunale di Roma")` → `"Tribunale Ordinario di [pseudo_city]"`
- [ ] Court: `getCourt("Foro di Milano")` → `"Foro di [pseudo_city]"`
- [ ] City consistent: `getCity("Roma")` → same pseudonym on second call
- [ ] Pool exhaustion: generate 17 persons → 17th is `"Tizio_17"` (overflow pattern)

#### Pipeline integration (`pipeline.test.ts`)
- [ ] Two-pass replacement: full names seeded before partials → coreference consistent
- [ ] Reverse-order offset preservation: three entities in a text replaced in reverse order → all substitutions correct, no off-by-one
- [ ] De cuius pre-pass runs before person seeding: `findDecuiusNames` populates `_skipSet` before any GLiNER (or mock NER) entity is fed to the mapper

---

## Phase 1 — MHC-L Regression Suite (Vitest port of `test_drift.py` / `test_full_pipeline.py`)

These tests port the regression suite that proved out bug fixes A-1, A-2, A-3 in MHC-L (April 2026, see `MHC-L/dev/ANONYMIZER_BUGS.md` and `MHC-L/dev/traces/trace_anonymizer_ner_bug_analysis_20260416.md`). They run in regex-only mode at the end of Phase 1 (no GLiNER yet, so person detection is supplied by hand-rolled mock NER seeds matching the documented `_personMap` expectations) and re-run with real GLiNER detections in Phase 4.

Fixtures: copy `MHC-L/dev/testing_documents/doc_A_fendipista.md`, `doc_B_eredita.md`, `doc_C_il_leak.md`, `doc_00_appalto_edilizio.md` into `recode-it/frontend/test-fixtures/mhc-l/`. These are unchanged from the MHC-L versions — they are the regression contract.

File: `src/engine/__tests__/regression_mhc_l.test.ts`.

### A-1 (Shared surname collision — fixed in `PseudonymMapper.get_person`)

Covers: `MHC-L/dev/ANONYMIZER_BUGS.md` §A-1, Scenario B of `test_drift.py`.

- [ ] **A-1.1 distinct pseudonyms for shared surname (doc_B_eredita)**: feed `["Rossella Amadori", "Erminia Vanzetti", "Tarcisio Vanzetti"]` as mock NER seeds → `getPerson` calls in that order → assert `_personMap["erminia vanzetti"] !== _personMap["tarcisio vanzetti"]`.
- [ ] **A-1.2 collision detector empty (doc_B_eredita)**: after seeding, `detectCollisions()` returns no pseudonym mapped to >1 distinct full name (Arturo Vanzetti is in `_skipSet`, see A-2).
- [ ] **A-1.3 bare surname coreference (doc_B_eredita)**: `getPerson("Vanzetti")` returns the pseudonym of the first-registered Vanzetti (Erminia).
- [ ] **A-1.4 article-prefix coreference preserved (doc_A_fendipista)**: seed `"Silvana Oberti"` → `getPerson("la Oberti")` returns the same pseudonym. This is the regression that was almost broken during the original A-1 fix; the `_ITALIAN_ARTICLES` carve-out exists to preserve it.
- [ ] **A-1.5 multi-word non-coreference (synthetic)**: seed `"Mario Rossi"` → `getPerson("Luigi Rossi")` returns a DIFFERENT pseudonym (the A-1 guarantee for new persons sharing a surname).
- [ ] **A-1.6 surname index first-write only (synthetic)**: after `getPerson("Mario Rossi")` and `getPerson("Luigi Rossi")`, `_surnameMap["rossi"]` resolves to the pseudonym of the FIRST registered (Mario), not the second.

### A-2 (De cuius misclassification — fixed in `_DE_CUIUS_RE` + `mark_skip`)

Covers: `MHC-L/dev/ANONYMIZER_BUGS.md` §A-2, Scenario B of `test_drift.py`, GDPR Recital 27.

- [ ] **A-2.1 de cuius name found (doc_B_eredita)**: `findDecuiusNames(doc_B_text)` returns a Set containing `"arturo vanzetti"` (lowercased).
- [ ] **A-2.2 de cuius pattern variants**: `findDecuiusNames("de cuius Mario Rossi")` → `{"mario rossi"}`; `findDecuiusNames("Mario Rossi, de cuius")` → `{"mario rossi"}`; `findDecuiusNames("Mario Rossi, il de cuius")` → `{"mario rossi"}`.
- [ ] **A-2.3 skip set blocks pseudonymization (doc_B_eredita)**: after full pipeline run, `_personMap` does NOT contain key `"arturo vanzetti"`; pseudonymized output text contains the literal string `"Arturo Vanzetti"`.
- [ ] **A-2.4 de cuius does not pollute surname index**: after A-2.3 setup, subsequent `getPerson("Vanzetti")` resolves to the living Vanzetti (Erminia), not to anything related to Arturo.
- [ ] **A-2.5 known limitation documented as test**: `findDecuiusNames("deceduto il Mario Rossi")` returns an empty Set (the pattern only triggers on "de cuius" — documented in `ANONYMIZER_BUGS.md` §A-2, "Limitation").

### A-3 (Title elision not stripped — fixed in `TITLE_RE`)

Covers: `MHC-L/dev/ANONYMIZER_BUGS.md` §A-3.

- [ ] **A-3.1 elided article stripped (doc_B_eredita)**: `stripTitle("L'Avv. Amadori")` → `{title: "L'Avv.", bare: "Amadori"}`.
- [ ] **A-3.2 curly apostrophe stripped**: `stripTitle("L’Avv. Amadori")` (U+2019) → `{title: "L'Avv.", bare: "Amadori"}`.
- [ ] **A-3.3 lowercase elided article stripped**: `stripTitle("l'Avv. Amadori")` → `{title: "l'Avv.", bare: "Amadori"}`.
- [ ] **A-3.4 Notaio recognized as title**: `stripTitle("Notaio Bianchi")` → `{title: "Notaio", bare: "Bianchi"}`. Negative regression: would fail against the pre-A-3 TITLE_RE.
- [ ] **A-3.5 surname index uses bare name not title fragment (doc_B_eredita)**: after full pipeline, `_surnameMap` contains key `"amadori"`, NOT `"l'avv"`.
- [ ] **A-3.6 bare-surname coreference after elided-title intro (doc_B_eredita)**: after seeding `"L'Avv. Amadori"`, `getPerson("Amadori")` returns the same pseudonym.

### Drift-smoke (the `test_full_pipeline.py` equivalent)

For each of the four fixtures, regex-only mode:

- [ ] **DS.1 pipeline produces a mapping**: run the pipeline → mapping is non-empty for documents that contain detectable entities.
- [ ] **DS.2 simulated Claude output round-trip**: take a hand-rolled passage referencing each pseudonym in varied contexts → `recodeText` → assert zero pseudonym tokens survive in recoded output (drift = 0 for the entities the regex layer detected).
- [ ] **DS.3 no plaintext identifiers leak**: regex-scan pseudonymized output → zero CF / IBAN / EMAIL patterns remain.

These tests are the Vitest equivalents of `MHC-L/dev/test_full_pipeline.py` (smoke) and `MHC-L/dev/test_drift.py` Scenarios A / B / C (drift stress). The pass criterion for Phase 1 is regex-only mode; Phase 4 re-runs the same suite with real GLiNER detections (see §"Phase 4 — Numerical-Equivalence" below).

---

## Phase 2 — Two-Panel UI

### Smoke tests (manual)
- [ ] Drag a `.txt` file containing "Avv. Mario Rossi, CF RSSMRA70B03A662X" → verify pseudonymized text shows "Avv. Tizio, C.F.: <DS>" in the preview.
- [ ] Drag a `.pdf` file → text extraction completes → pseudonymization runs.
- [ ] Drag a `.docx` file → mammoth.js extracts text → pseudonymization runs.
- [ ] "Copy for Claude" button → clipboard contains pseudonymized text (verify by pasting into a text editor).
- [ ] Paste a string containing "Tizio" in the Recode panel → "Tizio" is replaced with "Mario Rossi" in the output.
- [ ] Paste a string containing no pseudonyms → output is identical to input (no corruption).
- [ ] Drag file → navigate away → browser shows unsaved-changes confirm dialog.

### Mobile detection test
- [ ] In Chrome DevTools, toggle "Responsive Design Mode" with a mobile preset (iPhone SE) → verify "Usa un computer desktop" overlay is shown and no functional UI is rendered.
- [ ] On a real mobile device (optional, but strongly recommended before Phase 6 launch).

### Automated tests (Vitest + Testing Library)
- [ ] `ExtractText` component: simulate drag-and-drop of a mock `.txt` File object → verify `onExtracted(text)` is called with correct string.
- [ ] `EntityReviewPanel`: render with mock detections → verify all three buttons present per entity.
- [ ] Recode function: `recodeText("Tizio è in ritardo", [{pseudonym: "Tizio", original: "Mario Rossi", ...}])` → `"Mario Rossi è in ritardo"`.
- [ ] Recode function: longer pseudonym before shorter (sort test) → no partial replacement artifacts.
- [ ] Recode function: pseudonym appears multiple times → all occurrences replaced.

---

## Phase 3 — Auth + Backend

### Smoke tests (manual — using curl or Postman)

#### Registration and login
- [ ] `POST /recode/auth/register` → 201 with 10 recovery codes.
- [ ] Register same email again → 409.
- [ ] `POST /recode/auth/login` with correct credentials → 200 with JWT + argon2_salt.
- [ ] `POST /recode/auth/login` with wrong password → 401.
- [ ] JWT from login is valid: `GET /recode/auth/me` with `Authorization: Bearer <jwt>` → 200.
- [ ] `GET /recode/auth/me` without token → 401.
- [ ] Expired JWT: manually create a JWT with `exp` in the past → 401.

#### Mapping storage
- [ ] `POST /recode/mappings` with valid encrypted blob → 201.
- [ ] `GET /recode/mappings` → list includes the saved mapping.
- [ ] `GET /recode/mappings/{id}` → blob matches what was sent.
- [ ] `GET /recode/mappings/{id}` for another user's mapping → 404 (no oracle).
- [ ] `DELETE /recode/mappings/{id}` → 204; subsequent GET returns 404.
- [ ] `DELETE /recode/mappings?older_than_days=0` → all mappings deleted.
- [ ] Blob too large (>2MB) → 413.

#### Recovery codes
- [ ] `POST /recode/auth/recovery-codes/verify` with valid code → 200, new argon2_salt returned.
- [ ] Attempt to use same recovery code again → 400 (code marked used).
- [ ] After recovery code reset: try to decrypt old mapping with old password → decryption fails (AES-GCM auth tag mismatch — client-side test).
- [ ] 4th recovery code attempt within 30 min → 429.

#### Rate limiting
- [ ] 6th login attempt within 15 min → 429 with `retry_after` field.
- [ ] After `retry_after` seconds pass → login succeeds again.

#### Account deletion
- [ ] `DELETE /recode/account` with correct password + confirm string → 200.
- [ ] Attempt login after deletion → 401.
- [ ] All DB rows for deleted user absent (SQLite query check).

### Automated tests (Python pytest)
- [ ] `test_register_success`: POST register → 201, 10 recovery codes in response.
- [ ] `test_register_duplicate`: two identical email registrations → second is 409.
- [ ] `test_login_correct`: login → JWT is valid HS256, contains correct `sub`.
- [ ] `test_login_wrong_password`: → 401, response body does not distinguish wrong email from wrong password.
- [ ] `test_jwt_middleware_missing`: request to `/recode/mappings` without header → 401.
- [ ] `test_jwt_middleware_expired`: expired token → 401.
- [ ] `test_mapping_create_retrieve`: create + retrieve → blob bytes identical.
- [ ] `test_mapping_cross_user_isolation`: user A cannot read user B's mapping.
- [ ] `test_mapping_blob_size_limit`: 2MB+1 → 413.
- [ ] `test_recovery_code_single_use`: use code → 200; use same code → 400.
- [ ] `test_rate_limit_login`: 6 rapid login attempts → 6th is 429.
- [ ] `test_account_delete_cascade`: delete account → all related rows in all 5 tables gone.
- [ ] `test_false_positive_patch`: PATCH false-positives with valid list → 200, rows in `user_false_positive_preferences`.

---

## Phase 4 — GLiNER ONNX (Numerical-Equivalence Port Test)

The acceptance gate is *equivalence with the Python reference* on the four MHC-L fixture documents, not a fresh-quality benchmark. The empirical quality of GLiNER on Italian legal text is settled (see `MHC-L/dev/traces/trace_anonymizer_ner_bug_analysis_20260416.md`); what we test here is whether the ONNX-int8-in-browser inference produces close-enough span output that the downstream PseudonymMapper produces equivalent mappings.

### Pre-Phase artifact: Python golden-output JSON files

Before Phase 4 begins, generate golden output by running `MHC-L/tools/anonymize.py` on the four fixture documents (`doc_A_fendipista.md`, `doc_B_eredita.md`, `doc_C_il_leak.md`, `doc_00_appalto_edilizio.md`) and serialize the structured result (mapping, skip set, NER spans with scores, pseudonymized text) into `recode-it/frontend/test-fixtures/mhc-l/golden/<doc>.json`. The format is defined in IMPLEMENTATION_PLAN.md §"Phase 4 — Pre-phase artifact". Tag each file with the `anonymize.py` git SHA so the golden output is reproducible.

### Equivalence test harness (Vitest)

File: `src/engine/__tests__/equivalence_python_ref.test.ts`. For each fixture document:

- [ ] **EQ.1 mapping-key equivalence (strict)**: browser `_personMap` keys == golden `person_map` keys; browser `_surnameMap` keys == golden `surname_map` keys; browser `_companyMap`, `_cityMap`, `_courtMap` keys == golden equivalents. Pseudonym *values* may differ (pool allocation order may vary across implementations) so long as identity structure is preserved (two keys mapping to the same value in Python map to the same value in the browser).
- [ ] **EQ.2 skip-set equivalence (strict)**: `_skipSet` == golden `skip_set` exactly.
- [ ] **EQ.3 collision check (strict)**: `detectCollisions()` returns no collisions on any fixture (matches the post-fix MHC-L state).
- [ ] **EQ.4 regex substitution counts (strict)**: per pattern (CF, CF_NUM, P.IVA, IBAN, CRO, PROT, EMAIL), browser count == golden count.
- [ ] **EQ.5 NER span equivalence (tolerant)**: for each `(start, end, label)` in golden, the browser produces a matching span within ±2 chars on boundaries with the same label. Per document: ≥95% of golden spans matched, ≤5% browser-extra spans, ≤5% golden-missed spans. (Int8 quantization tolerance band.)
- [ ] **EQ.6 mapping equivalence under tolerance (strict consequence of EQ.5)**: even if individual span scores differ, the downstream `_personMap` keys must be identical between browser and golden. If a span drift in EQ.5 causes a `_personMap` divergence, that is a Phase 4 fail — investigate as port bug.
- [ ] **EQ.7 recode round-trip (strict)**: pass golden `pseudonymized_text` through browser `recodeText` with browser-derived mapping → output equals original fixture content (modulo unimportant whitespace).
- [ ] **EQ.8 MHC-L Regression Suite (re-run with GLiNER on)**: every A-1, A-2, A-3, drift-smoke test from Phase 1 must still pass when GLiNER is providing the person detections (not mock seeds).

### Unit tests (Vitest)
- [ ] `gliner_runner.test.ts`: mock InferenceSession, verify `predictChunk` returns correct NerEntity shape with the documented threshold tiers (0.4 / 0.65 / 0.6).
- [ ] `pipeline.test.ts` (integration): with mocked GLiNER results injected → verify full pipeline output (regex + NER + mapper + replacement).
- [ ] Fallback test: simulate `InferenceSession.create()` throwing → pipeline falls back to regex-only → no exception thrown → banner state set.
- [ ] Web Worker communication: main thread sends text → worker returns NerEntity[] → no serialization errors.
- [ ] De cuius pre-pass ordering: `findDecuiusNames` runs before GLiNER seeding (verify by mocking and asserting call order in `pipeline.ts`).

### Manual smoke tests
- [ ] Drag each of the four fixture documents → GLiNER detections appear in entity review panel; mapping inspection (developer-tools panel or browser console) matches golden output.
- [ ] Verify entity score near 0.4 (threshold) still shows a "review this" visual cue.
- [ ] Model cache: close and reopen tab → model loads "instantly" (from Cache API, no download bar).
- [ ] Intentionally corrupted ONNX file: verify graceful fallback message, not crash.
- [ ] Performance: end-to-end pipeline on `doc_B_eredita.md` (~5KB) on 2022-era laptop → <30s; 10-page synthetic → <60s. Matches MHC-L Python performance.

### What fails this phase, and what does not

- **Fails**: any of EQ.1–EQ.4, EQ.6, EQ.7, EQ.8. These are port-fidelity defects.
- **Investigate, may not fail**: EQ.5 outside tolerance. If the divergence is traceable to int8 quantization noise but does not break EQ.6, document it in DESIGN.md §8.6 and proceed.
- **Not the right framing**: "GLiNER recall on Italian legal text is too low." That is settled. If you observe this, the cause is almost certainly tokenizer mismatch, ONNX export error, or wrong thresholds in the port — not a model-quality problem. See OPEN_RISKS.md R-01-NEW.

---

## Phase 5 — False Positive UX

### Manual smoke tests
- [ ] Mark entity as false positive → original text appears in pseudonymized preview (not the pseudonym).
- [ ] Save mapping with false positives → `PATCH /recode/mappings/{id}/false-positives` fires; response 200.
- [ ] False positive entity is NOT in the recode mapping → pasting Claude response with that pseudonym does not incorrectly replace it.
- [ ] [Cambia categoria] → change "luogo" to "persona" → entity gets reassigned a PERSON pseudonym (e.g., "Tizio" instead of "Metropoli") → recode works correctly with new pseudonym.
- [ ] [Accetta] button → no state change (visual feedback only — "accepted" state shown).
- [ ] Undo: mark false positive → undo → entity back in mapping → pseudonym re-appears in preview.

### Automated tests (Vitest + Testing Library)
- [ ] `EntityReviewPanel.test.tsx`: click "Falso positivo" on first entity → `mappingEntries` store update removes that entry from active mapping, sets `isFalsePositive: true`.
- [ ] `EntityReviewPanel.test.tsx`: click "Cambia categoria" → dropdown appears → select → mapping entry updated with new pseudonym.
- [ ] Recode with false positives: `recodeText("Metropoli è una città", [{pseudonym: "Metropoli", original: "Emilia-Romagna", isFalsePositive: true}])` → `"Metropoli è una città"` (no recode for false positives).

---

## Section 4 — End-to-End User Journey Test (MVP Gate)

This test must be run manually by the founder before Phase 6 sign-off. It is the canonical acceptance test for the MVP.

### Test fixture
Create a plain text file `test_doc.txt` with the following content:
```
TRIBUNALE ORDINARIO DI ROMA
Sezione Civile

Causa n. 1234/2026 RG
Avvocato Mario Rossi (CF: RSSMRA70B03A662X), dello studio Acme S.r.l.,
con sede in Via Roma 1, Milano,
per la parte attrice Maria Bianchi (P.IVA 12345678901),
nei confronti di Luigi Verdi, la parte convenuta.

IBAN del debitore: IT60X0542811101000000123456
Email: mario.rossi@studio.it

La parte civile ha presentato istanza in data 15 gennaio 2026.
Il Tribunale di Milano ha già deciso in senso conforme.
```

### Checklist

#### Pseudonymize panel
- [ ] Open `micheleloi.pro/recode-it/` on a desktop browser.
- [ ] Drag `test_doc.txt` into the drop zone.
- [ ] Verify "Avv." (title) is stripped and the lawyer's name is replaced with a pseudonym.
- [ ] Verify "Mario Rossi" and "M. Rossi" (if referenced later) map to the same pseudonym (coreference).
- [ ] Verify CF `RSSMRA70B03A662X` → `<DS>`.
- [ ] Verify IBAN `IT60X0542811101000000123456` → `<IBAN>`.
- [ ] Verify P.IVA `12345678901` (with prefix) → `<P.IVA>`.
- [ ] Verify email `mario.rossi@studio.it` → `<EMAIL>`.
- [ ] Verify "parte attrice", "parte convenuta", "parte civile" → NOT replaced (stoplist).
- [ ] Verify "Acme S.r.l." → "[Greek-letter company] S.r.l." (suffix preserved).
- [ ] Verify "Tribunale Ordinario di Roma" → "Tribunale Ordinario di [pseudo_city]".
- [ ] Verify "Il Tribunale di Milano" (second mention) maps the same pseudo city consistently.
- [ ] Verify "15 gennaio 2026" → NOT replaced (dates preserved).
- [ ] Verify "Causa n. 1234/2026 RG" → "n. XXXX/YYYY RG".
- [ ] Click [Falso positivo] on one entity → it disappears from the preview substitution.
- [ ] Click [Copy for Claude] → open any text editor, paste → verify clipboard contains the pseudonymized text with no original identifiers.

#### Claude interaction (out-of-band)
- [ ] Open Claude.ai in a different tab.
- [ ] Paste the pseudonymized text.
- [ ] Ask Claude: "Riassumi i dati principali della causa."
- [ ] Copy Claude's response (which will contain pseudonyms like "Tizio", "Alfa S.r.l.", etc.).

#### Recode panel
- [ ] Return to the Recode IT tab.
- [ ] Paste Claude's response into the Recode panel.
- [ ] Verify the recoded output shows real names where pseudonyms appeared.
- [ ] Verify the entity that was marked as false positive was NOT replaced in Claude's response.
- [ ] Click [Copy final to clipboard] → paste into text editor → verify it matches expected output.

#### DevTools verification (the DPO test)
- [ ] Open DevTools → Network tab → clear network log.
- [ ] Drag `test_doc.txt` again.
- [ ] Look at the POST request that saves the mapping (if logged in and Save was clicked).
- [ ] Inspect the request payload: verify it contains only the encrypted blob — no recognizable names, fiscal codes, or document text in plaintext.

#### Account persistence (if Phase 3 complete)
- [ ] Register an account.
- [ ] Pseudonymize the document.
- [ ] Click [Save mapping].
- [ ] Close the tab completely.
- [ ] Open a new tab, navigate to `micheleloi.pro/recode-it/`.
- [ ] Log in.
- [ ] Retrieve the saved mapping.
- [ ] Paste a Claude response containing pseudonyms → verify recode works correctly.

---

## Security Tests (Run Before Phase 6 Launch)

### Authentication
- [ ] **Timing oracle**: measure response time for login with valid email + wrong password vs. invalid email + any password. Times should be indistinguishable (bcrypt is constant-time relative to hash, but verify no early-exit path on email lookup reveals email existence).
- [ ] **Password brute force**: 6 rapid login attempts → 6th returns 429. Wait for `retry_after` → can login again.
- [ ] **JWT tampering**: change `sub` claim in JWT (without re-signing) → 401.
- [ ] **JWT algorithm confusion**: send a JWT signed with `none` algorithm → 401.

### Mapping isolation
- [ ] Register two users (A and B). User A creates a mapping. User B attempts `GET /recode/mappings/{A's_mapping_id}` → 404 (not 403, to avoid oracle).
- [ ] User B attempts `DELETE /recode/mappings/{A's_mapping_id}` → 404.

### Zero-knowledge verification
- [ ] Create a mapping with known content (e.g., `{"Tizio": "Mario Rossi"}`), encrypt it correctly, save it. Query the DB directly (`sqlite3 ~/.mhc-l-keystore.db "SELECT blob FROM encrypted_mappings LIMIT 1"`). Verify the blob bytes contain no UTF-8 substring "Mario" or "Rossi".
- [ ] Verify `user_false_positive_preferences` stores pseudonym ("Metropoli"), not original ("Emilia-Romagna").

### Input validation
- [ ] Send blob of 2MB+1 bytes → 413.
- [ ] Send `mapping_id` of 300 characters → 400 (if field length validation is implemented).
- [ ] Send `label` of 1000 characters → 400 or truncated gracefully.
- [ ] Send `false_positives` array with 1000 entries → server handles gracefully (no OOM; 400 if over limit).

### XSS
- [ ] Upload a TXT file containing `<script>alert("XSS")</script>`. Verify the React preview renders it as escaped text, not as an executed script.
- [ ] Submit a mapping label containing `<img src=x onerror=alert(1)>` → verify it is escaped in the dashboard.

### CORS
- [ ] From a different origin (e.g., `http://localhost:8888`), attempt a credentialed `fetch` to `POST /recode/mappings` → CORS policy blocks it at the browser.

### Dependencies
- [ ] `npm audit` → zero high/critical.
- [ ] `pip-audit` on backend requirements → zero high/critical.
