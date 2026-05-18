# Recode IT — Open Risks

**Version:** 2.0
**Date:** 2026-05-17
**Audience:** Founder. Read this before writing the first line of production code.
**Format:** Each risk has: Description, Likelihood, Severity, Mitigation, When to decide.

**Scope note.** This register contains only risks that are *not* already addressed by inherited MHC-L work. Two risks that the v1 of this document carried — "GLiNER quality on Italian legal text" and "GDPR consultation needed on pseudonymized text to Anthropic" — have been removed because the work in question has already been done in MHC-L and is reused by Recode IT. See DESIGN.md §2 "Heritage from MHC-L" for the reuse inventory. The empirical NER work is captured in `MHC-L/dev/traces/trace_anonymizer_ner_bug_analysis_20260416.md` and `MHC-L/dev/ANONYMIZER_BUGS.md`; the legal position is captured in `MHC-L/legal/DPA.md` §2.2.2–§2.2.4 and `MHC-L/privacy.md`. The Recode-IT-specific residual risks of those areas are R-01 (port fidelity) and R-06 (operational fidelity of user review) below.

---

## R-01 — ONNX-in-browser numerical fidelity vs Python reference

**Description.** The Python pseudonymizer in MHC-L uses `GLiNER.from_pretrained("urchade/gliner_multi-v2.1")` in float32 with full model weights (~300MB) and has been empirically validated on Italian legal text with thresholds 0.4 / 0.65 / 0.6 (see `MHC-L/dev/ANONYMIZER_BUGS.md` and the trace at `MHC-L/dev/traces/trace_anonymizer_ner_bug_analysis_20260416.md`). The browser variant uses an int8-quantized ONNX export (~80-120MB) running on onnxruntime-web's WASM backend with the Transformers.js tokenizer.

The risk is *port fidelity*, narrow and specific: given the same input text, does the browser pipeline produce a span list close enough to the Python reference output that the downstream PseudonymMapper produces equivalent mappings (same `_personMap` keys, same `_skipSet`, no new collisions)? Three sources of divergence are possible: (1) int8 quantization rounding (small score shifts near threshold boundaries); (2) ONNX export graph differences from `optimum-cli export onnx`; (3) tokenizer mismatch between Transformers.js and the Python HuggingFace tokenizer (different special-token handling, different BPE splits on Italian morphology).

What is NOT in scope of this risk: whether GLiNER works on Italian legal text. It works. The thresholds are tuned. The bug fixes A-1 / A-2 / A-3 are in place. The Python pipeline is in production on the MHC-L VPS.

**Likelihood:** Medium. Int8 quantization of transformer NER models routinely preserves >95% of float32 entity-detection agreement. The risk is concentrated on the marginal cases near threshold boundaries — and on a handful of Italian-specific tokenizer edge cases.

**Severity:** Medium. A 5% NER divergence may cause a small fraction of mappings to differ from the Python reference, which is acceptable so long as: (a) the A-1 / A-2 / A-3 fixes still hold in the browser implementation, (b) no new collisions are introduced, (c) the regex layer (which has perfect parity by construction — same regex strings) still catches all structured identifiers. If divergence is large enough to cause `_personMap` key differences from the golden output, that is a port bug and must be diagnosed.

**Mitigation path:**

1. **Golden-file equivalence tests** (Phase 4 acceptance gate, see TEST_PLAN.md §"Phase 4 — Equivalence test harness"). The four fixtures from `MHC-L/dev/testing_documents/` are run through both the Python reference (golden JSON) and the browser pipeline; equivalence is asserted at the mapping-key level (strict) and at the span level (±2 chars, ≥95% match — tolerant of quantization noise but intolerant of structural drift).
2. **Re-run MHC-L Regression Suite with GLiNER on** (Phase 4 gate, see TEST_PLAN.md §"EQ.8"). The A-1 / A-2 / A-3 tests that passed in regex-only mode at end of Phase 1 must still pass when real GLiNER detections feed the mapper. This is the structural guarantee that the bug fixes are preserved across the port.
3. **If equivalence fails on a specific fixture**: diagnose as port bug. Most likely causes in order of probability: (a) tokenizer mismatch on `'` (curly vs straight apostrophe), (b) ONNX export quantization scale on rare-token embeddings, (c) Web Worker message serialization corrupting Unicode in long texts. Threshold re-tuning is permitted ONLY if a documented numerical-quantization effect is the proximate cause; the values 0.4 / 0.65 / 0.6 are otherwise canonical and must not be casually adjusted.
4. **Fallback to float32 ONNX** if int8 cannot pass the equivalence gate after one round of debugging (cost: ~3x model file size, longer first-load, but eliminates the quantization source of divergence). The decision threshold: if EQ.1–EQ.4 fail, escalate to float32; if only EQ.5 fails outside the tolerance, document and proceed.

**When to decide:** Phase 4 gate. The four golden JSON files must be produced before Phase 4 code starts. If golden generation surfaces a problem with the Python reference (e.g., the production `anonymize.py` SHA has drifted from what `ANONYMIZER_BUGS.md` claims is fixed), pause Phase 4 and reconcile MHC-L state first. See R-07 below.

---

## R-02 — Model bundle size makes first-load unusable for target users

**Description.** The target user is a non-tech Italian lawyer, often working on WiFi in a court building or a studio legale with slow or shared connections. First-visit download of the GLiNER ONNX model (~80-120MB int8) + onnxruntime-web WASM (~3MB) + React app bundle (~1MB) totals ~85-125MB.

At 10Mbps (optimistic court WiFi): 70-100 seconds.
At 5Mbps (more realistic): 135-200 seconds (~2-3 minutes).
At 4G (50% of tribunals have poor 4G): 1-4 minutes.

The browser will cache after the first visit. But the first visit is the product's first impression.

**Likelihood:** High. Most court/tribunal buildings have poor connectivity. This is not a speculative risk — it is a documented characteristic of Italian public buildings.

**Severity:** Medium-High. A 2-3 minute blank or spinner screen on first use will cause a large fraction of non-tech users to close the tab. This is an adoption blocker, not a correctness issue.

**Mitigation path:**

1. **Progress bar with explicit byte counter and estimated time**: "Scaricando il motore NER: 43MB di 118MB — circa 45 secondi". Users tolerate waits they can measure.
2. **"Loading screen is one-time" messaging**: clearly communicate that subsequent visits are instant (model is cached).
3. **Regex-first UX**: render the regex-only detection immediately (sub-second) while GLiNER loads. Users can work with regex results and the entity review panel; GLiNER results are added when ready. This completely avoids the "blank screen" problem and aligns with the Phase 2 deliverable (regex-only mode is what Phase 2 ships).
4. **Model size reduction**: int8 quantization alone should achieve 70-80% reduction. If still too large: consider int4 quantization (higher quality loss — assess against R-01 equivalence band before adopting).
5. **CDN with HTTP/2 push**: serve the model from a CDN geographically close to Italy. CloudFlare free tier covers this; the model file is static and immutable.

**When to decide:** Phase 0 (defer the model-loading UX details to Phase 4, but build the regex-first scaffolding into Phase 2).

---

## R-03 — WASM compilation and SharedArrayBuffer reliability across browsers

**Description.** Recode IT relies on:
- `onnxruntime-web` with WASM threading (requires SharedArrayBuffer + COOP/COEP headers).
- `pdf.js` WASM for PDF parsing.
- `argon2-browser` WASM for Argon2id key derivation.
- Web Workers for off-thread inference.

These work reliably in Chrome and Edge. Firefox has occasional issues with WASM threading and SharedArrayBuffer (the situation improves with each release). Safari on iOS is explicitly excluded (mobile detection → redirect). Safari on macOS: SharedArrayBuffer was re-enabled in Safari 15.2+ with COOP/COEP, but older macOS installations (common in Italian legal offices that don't update) may have Safari 14 or older.

**Likelihood:** Medium. ~15-20% of desktop browsers in Italy are Safari (StatCounter 2025 data). A subset of those will have old Safari versions.

**Severity:** Medium. These users see an error or a non-functional app. They are not the primary target (most Italian lawyers use Chrome or Firefox), but the founder should know the exposure.

**Mitigation path:**

1. **Multi-threaded WASM is optional**: onnxruntime-web works without SharedArrayBuffer in single-threaded mode (slower, but functional). Detect SAB support at startup: `typeof SharedArrayBuffer !== 'undefined'`. Use single-threaded mode as fallback.
2. **Browser compatibility banner**: detect unsupported configurations (e.g., WASM not supported, SharedArrayBuffer unavailable) and show a specific message: "Recode IT richiede un browser moderno. Usa Chrome, Firefox o Edge aggiornati." Do NOT show a generic error.
3. **Explicitly test** Chrome 120+, Firefox 121+, Safari 17+ before Phase 6 launch.
4. For the MVP, accepting incompatibility with Safari < 15.2 is reasonable — document it.

**When to decide:** During Phase 0 WASM smoke test. Determine the fallback strategy (single-threaded mode) at that point.

---

## R-04 — Zero-knowledge encryption scheme: implementation correctness

**Description.** The zero-knowledge claim rests on the correctness of:
1. Argon2id KDF in the browser (`argon2-browser` WASM package).
2. AES-256-GCM via the Web Crypto API (`SubtleCrypto`).
3. The HKDF derivation of per-mapping keys from the master key.

Any implementation error — wrong parameter passing, IV reuse, incorrect AAD, subtle JS type coercion — silently invalidates the security guarantee. The most common error is **IV reuse in AES-GCM**, which completely breaks confidentiality (two messages encrypted with the same IV allow key recovery).

Additionally, the `argon2-browser` npm package (the most common choice) has not been formally audited. It wraps a WASM build of the reference Argon2 C implementation; the WASM build integrity depends on the package's build pipeline.

**Likelihood:** Low for production-grade errors, but medium for subtle bugs in custom implementation code.

**Severity:** Critical. A silent encryption bug undermines the entire zero-knowledge architecture without the user knowing.

**Mitigation path:**

1. **IV generation**: always use `crypto.getRandomValues(new Uint8Array(12))` for each new encryption. Never reuse. This is the highest-priority correctness check.
2. **Use the Web Crypto API for AES-GCM** (not a JS library): `SubtleCrypto.encrypt({name: "AES-GCM", iv, additionalData}, key, plaintext)`. The Web Crypto API is browser-native, reviewed by browser vendors, and constant-time where relevant. Do not use a JS-land AES library.
3. **Use the Web Crypto API for HKDF**: `SubtleCrypto.deriveBits({name: "HKDF", ...})` for key derivation from the Argon2id output.
4. **Verify `argon2-browser` package integrity**: check the npm package's SHA integrity against the published hash; prefer pinned versions. Consider using the `@noble/argon2` pure-JS alternative (audited by Least Authority 2023) if WASM integrity is a concern.
5. **Write a round-trip test**: encrypt a known plaintext, decrypt it, verify identity. This does not prove the scheme is secure, but it proves the implementation is not trivially broken.
6. **Do not roll custom crypto primitives**: use only browser-native SubtleCrypto for symmetric operations.
7. **Before public launch**: have the crypto module (100-150 lines of TypeScript) reviewed by a security engineer or cryptographer. This is the highest-leverage security review possible for this product.

**Recommended scheme (confirm before implementing):**

```
Argon2id(password, server_salt, m=65536, t=3, p=1) → master_key (32 bytes)
HKDF-SHA256(master_key, salt=mapping_salt, info="recode-it-mapping-v1") → mapping_key (32 bytes)
AES-256-GCM(mapping_key, random_iv_12B, plaintext=JSON(mapping), aad=mapping_id) → iv||ciphertext||tag
```

This scheme is standard and defensible. The main alternative (bcrypt-based KDF) is weaker than Argon2id for this use case and should be rejected.

**When to decide:** Before Phase 3 crypto implementation begins. The scheme is described in DESIGN.md §5.1 and should be treated as final unless a cryptographer finds a flaw.

---

## R-05 — Recovery codes destroy all mappings on use — this is surprising and must be communicated clearly

**Description.** The recovery code flow is designed to be zero-knowledge: the server never knows the Argon2id derivation of the user's password, so it cannot re-derive the master key after a password change. This means changing the password (via recovery code) necessarily generates a new Argon2id salt, which generates a new master key, which cannot decrypt mappings encrypted with the old master key. All existing mappings are permanently inaccessible after a password reset.

This is the correct design choice given the zero-knowledge constraint, but it is **highly counterintuitive** for users who expect "password reset = recover access to all my data." An Italian lawyer who forgets their password, uses a recovery code to reset it, and then finds all their saved mappings gone will likely be very upset — and may write a negative review or complain to a GDPR regulator.

**Likelihood:** Certain (this is how it works by design).

**Severity:** Medium for product reputation. The data loss is not a bug — it is a design consequence. But perception is reality.

**Mitigation path:**

1. **Show warning at signup** (recovery codes display): "Se usi un codice di recupero per reimpostare la password, TUTTI i mapping salvati saranno eliminati definitivamente. Questo è una conseguenza della nostra architettura zero-knowledge: il server non può decriptare i tuoi dati senza la tua password." Make this unambiguous, not fine print.
2. **Show warning at every recovery code use** (before the reset is committed): three-step confirmation: (a) "Stai per usare un codice di recupero." (b) "ATTENZIONE: tutti i mapping salvati saranno eliminati. Questa operazione è irreversibile." (c) Text input: "Scrivi ELIMINA per confermare." Only then proceed.
3. **Export before reset**: offer a "Esporta tutti i mapping" button on the account page. This exports the encrypted blobs as a ZIP file that the user can store locally. Before recovery code use, remind the user they should export first if they want to attempt manual recovery.
4. **Document the limitation clearly in ToS and FAQ**: this is also relevant for GDPR Art. 17 right to erasure documentation.

**When to decide:** Phase 3 UX. The warning copy should be reviewed by the founder before implementation.

---

## R-06 — Operational fidelity: the user must actually review before sending

**Description.** The MHC-L privacy / DPA position that Recode IT inherits (DPA §2.2.4) places a contractual obligation on the user/Controller to verify the pseudonymized text before transmitting it to Anthropic. The legal architecture treats the user-review step as a *primary* protection, not a fallback. The product's privacy claim is structurally dependent on this review actually happening.

If the UX is too frictionless — one-click "Copy for Claude" without forcing a glance at the entity review panel — users will copy and paste without reviewing. Real personal data may then leak to Anthropic that the NER missed (Italian surnames not in training data, unusual contexts, compound names with particles like "De Filippis" / "D'Amico" / "Lo Bianco", appositive constructions). The product would technically be functioning as designed (the user did not review) while practically failing the user (real data sent to a third party).

This is the *operational fidelity* counterpart to R-01's *port fidelity*. Both have to hold for the privacy architecture to deliver in practice.

**Likelihood:** High for the specific cases listed above. NER at 70-80% recall means 20-30% of person entities may be missed per document; this is unchanged from the Python pipeline and is the reason the MHC-L architecture mandates user review.

**Severity:** High for the user's GDPR obligations (the user is the Controller). Low for Recode IT's liability (the product provides the review panel and documents the obligation — this is the DPA §2.2.4 allocation: "in caso di omessa o insufficiente revisione del file pseudonimizzato da parte del Titolare, ogni conseguenza pregiudizievole derivante dal mancato oscuramento di identificativi residui è imputabile al Titolare").

**Mitigation path:**

1. **The entity review panel IS the primary mitigation**. It is not cosmetic. Make this explicit in the UI: "Rivedi il testo evidenziato prima di copiare. Le entità rilevate sono indicate — verifica che nessun dato personale sia rimasto." This wording inherits directly from `MHC-L/privacy.md` §"State 1" and §"Current limitations".
2. **Friction-by-design before "Copy for Claude"**: require an explicit "Ho rivisto il testo" checkbox or equivalent affirmative confirmation. The friction is the price of the privacy guarantee, not a UX bug.
3. **Visual diff**: consider showing a diff view (original | pseudonymized) so users can scan for unhighlighted proper names.
4. **Regex-first guarantee**: the structured identifier regex layer (CF, IBAN, P.IVA, EMAIL, CRO, PROT) has near-100% recall for its specific targets. These are the highest-risk identifiers. The "missed entities" problem mainly affects person names, not codes.
5. **DPIA template**: ship a one-page DPIA template that mirrors `MHC-L/legal/DPA.md` §2.2.4 language so DPO-facing users can hand it to their compliance function. This is the artifact that operationalizes the contractual allocation.
6. **Future**: fine-tune the GLiNER model on Italian legal text (post-MVP initiative). This requires collecting an annotated corpus — expensive but worth it if the product has PMF.
7. **Do NOT ship without the entity review panel.** It is an MVP requirement (IMPLEMENTATION_PLAN.md Phase 2 §Tasks 3, Phase 5).

**When to decide:** Permanent operational reality, not a decision to defer. Phase 2 UX must include the friction-by-design step; Phase 6 launch checklist verifies it is present.

---

## R-07 — MHC-L `gate-local/tools/anonymize.py` drift vs `ANONYMIZER_BUGS.md` documentation

**Description.** Recode IT treats `MHC-L/gate-local/tools/anonymize.py` plus `MHC-L/dev/ANONYMIZER_BUGS.md` as the canonical reference. The TypeScript port assumes the documented fixes A-1 / A-2 / A-3 are actually in the current `anonymize.py`. If the production Python code has drifted from the documentation since 2026-04-16 (e.g., a refactor that broke the A-1 surname carve-out, or a TITLE_RE change that lost the A-3 elision), the golden output produced for the Phase 4 equivalence test will encode the drift, and the TypeScript port will inherit the drift too — silently.

This is a heritage-integrity risk, not a port risk.

**Likelihood: Low.** Two empirical signals make silent regression unlikely: (a) the founder ran the pseudonymize flow manually on a test file in 2026-05-17 and confirmed it works as expected; (b) reading `anonymize.py` directly confirms the fix signatures listed below are still present. The dev test harness (`dev/test_full_pipeline.py`, `dev/test_drift.py`) was last updated before the 2026-05-06 X1 unification and currently imports from the pre-X1 path (`tools/` rather than `gate-local/tools/`); it does not run as-is. This is documented MHC-L technical debt (see `STATE.md` parking list) and is NOT a Recode IT blocker — the source-level signature grep below is sufficient pre-Phase-4 confirmation.

**Severity:** Medium if it ever materialized — silent drift means Recode IT inherits a regression that the trace and bug tracker say is fixed.

**Mitigation path (Phase 4 pre-flight, 15 minutes total):**

1. **Source-level signature grep on `MHC-L/gate-local/tools/anonymize.py`** for the three fix signatures:
   - A-1: `_surname_map` is populated only on first-occurrence (no unconditional overwrite); `_ITALIAN_ARTICLES` is referenced in `get_person()`.
   - A-2: `_DE_CUIUS_RE` is defined; `_find_decuius_names()` is called in `apply_gliner_with_pseudonyms()` BEFORE GLiNER seeding; `mark_skip` / `_skip_set` is referenced in `get_person()`.
   - A-3: `TITLE_RE` regex source string contains `[Ll]['']` or equivalent elision prefix; `Notaio` is in the title alternation.
2. **Spot-check the generated goldens** during the golden-generation run (`recode-it/scripts/generate_python_goldens.py`): for `doc_B_eredita`, assert that the `person_map` contains two distinct entries for `"erminia vanzetti"` and `"tarcisio vanzetti"` (A-1 working) and that `arturo vanzetti` is in `skip_set` (A-2 working); for `doc_A_fendipista` or `doc_00_appalto_edilizio`, assert that elided titles (`l'avv.`, `L'Ing.`) and `Notaio` references are correctly stripped (A-3 working). These assertions live in the generator script itself and fail the run if violated.
3. **If drift detected**: pause Phase 4. Either re-apply the fix in `gate-local/tools/anonymize.py` (working through MHC-L's modlog discipline via `@pm`) or document the divergence in `ANONYMIZER_BUGS.md` so the new state is the reference, then re-generate golden files. Do NOT proceed with Phase 4 against a Python reference whose state is ambiguous.

**When to decide:** Pre-Phase 4 golden generation. 15-minute check baked into the generator script — not a project gate.

---

## R-08 — Recode IT server becomes a new single point of trust for session continuity

**Description.** The original MHC-L architecture is fully zero-server for content: the Python pseudonymizer runs locally, and no web server is involved in the content path. Recode IT introduces a web server that stores encrypted blobs.

The server is zero-knowledge (cannot read mappings), but it is NOT zero-availability. If `mhc.micheleloi.pro` is down, users cannot:
- Retrieve previously saved mappings.
- Save new mappings.

Users can still do session-only pseudonymize/recode (client-side only, no server contact needed). But the "save and continue tomorrow" workflow breaks.

Additionally, the server is now a target for DoS attacks. The existing MHC-L server has low traffic. Recode IT could attract significantly higher traffic (web product vs. MCP tool), potentially impacting MHC-L's own uptime.

**Likelihood:** Low for outages (the VPS hosting is stable); Medium for the DoS scenario if Recode IT grows rapidly.

**Severity:** Medium. Downtime frustrates users but does not expose private data.

**Mitigation path:**

1. **Communicate the two modes clearly**: "Session-only: nessun server richiesto, massima privacy. Salva mapping: richiede account, richiede connessione." Users understand the tradeoff.
2. **Graceful degradation**: if the server is unreachable, show "Server temporaneamente non disponibile. I tuoi mapping in sessione sono ancora accessibili." The in-session workflow continues.
3. **Rate limiting on all endpoints** (already in design): protects against simple DoS.
4. **Monitor server uptime separately** for Recode IT vs. MHC-L traffic (nginx access logs, uptime robot).
5. **Future**: if Recode IT scales, move to a separate server/process to isolate failure domains from MHC-L. This is not necessary for MVP.

**When to decide:** Before Phase 6 launch — ensure the server has basic uptime monitoring.

---

## R-09 — Cross-origin isolation headers may break third-party integrations or static hosting

**Description.** To enable SharedArrayBuffer (needed for multi-threaded onnxruntime-web), the server must send:
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

These headers, when set on a WordPress page or via a CDN, have the following side effects:
- **Embedded YouTube/Vimeo iframes**: break (they do not send `Cross-Origin-Resource-Policy: cross-origin`).
- **Google Analytics, Facebook Pixel, Intercom, Hotjar**: many third-party scripts are not COEP-compatible and will be blocked by the browser.
- **WordPress admin bar**: may be affected if the same-origin policy is applied broadly.

For `micheleloi.pro` (a WordPress site), adding COEP/COOP globally would be destructive. The headers must be applied **only** to the Recode IT single-page app path (`/recode-it/`), not the WordPress root.

**Likelihood:** High if headers are applied broadly. Low if applied with correct nginx location block scoping.

**Severity:** Medium. Wrong headers = multi-threaded WASM doesn't work, or the WordPress site breaks.

**Mitigation path:**

1. **Scope headers to the SPA path** in nginx:
   ```nginx
   location /recode-it/ {
       add_header Cross-Origin-Opener-Policy "same-origin";
       add_header Cross-Origin-Embedder-Policy "require-corp";
       # ... other headers
   }
   ```
2. **Do NOT add these headers at the global `server {}` level**.
3. **Test the WordPress pages** after adding headers to verify nothing breaks on the main site.
4. **Alternative**: deploy the Recode IT SPA on a separate subdomain (`recode.micheleloi.pro`) where headers can be set freely. This is cleaner architecturally and avoids any WordPress interaction.
5. **If multi-threaded WASM is not strictly required**: run onnxruntime-web in single-threaded WASM mode (slower but no COOP/COEP needed). This is the safest MVP choice — optimize threading only if performance tests show it is necessary.

**When to decide:** Phase 0 deployment (first nginx config). Determine threading vs. no-threading strategy and its header implication before deploying to production.

**Resolution (2026-05-18)**: Option 4 adopted. SPA deployed on dedicated subdomain `recode.micheleloi.pro` (DNS A record + Let's Encrypt cert + nginx server block scoped to subdomain). COOP/COEP/CORP applied freely without WordPress interaction. `micheleloi.pro/recode-it/` reserved for the marketing landing on WordPress. See R-11 below for an ESM module MIME-type gotcha that surfaced during this deploy.

---

## R-11 — ESM module MIME-type cache trap (discovered during deploy 2026-05-18)

**Description.** When serving the SPA via nginx, ESM `.mjs` files (specifically the onnxruntime-web WASM loaders at `/ort/*.mjs`) must be served with `Content-Type: application/javascript`. nginx's default `mime.types` does NOT include `.mjs` — files are served as `application/octet-stream`. Browsers refuse to execute dynamically-imported modules with non-JS MIME, ORT's `InferenceSession.create()` fails with `"Failed to fetch dynamically imported module: ...jsep.mjs"`, and the worker rebrands this fairly opaque underlying error as `ERR_MODEL_NOT_FOUND` (misleading — the model file is fine; the WASM loader module is the failure).

Worse: once a browser has cached the wrong-MIME response (no `Cache-Control` headers set → heuristic freshness applies), the cache sticks across regular reloads and even some hard reloads. Server-side fix is necessary but not sufficient; existing visitors need a cache invalidation.

**Likelihood:** Certain on default nginx setups serving ESM modules from disk. Hits every new deploy of any project using onnxruntime-web (or similar WASM-bundled libs) until fixed.

**Severity:** High when latent. Founder cannot smoke-test the product because of an opaque "model not available" message; misdirected debugging chases the model files when the problem is the WASM loader.

**Mitigation (applied 2026-05-18 to `recode.micheleloi.pro`):**

1. nginx `types{}` block in the server context overrides the global `mime.types` for the SPA: `application/javascript js mjs; application/wasm wasm; application/json json; application/octet-stream onnx;`.
2. `Cache-Control: no-cache, must-revalidate` on `.mjs`/`.wasm`/`.onnx`/`.json` via a `location ~* \.(mjs|wasm|onnx|json)$` block. This forces browsers to revalidate the asset on every navigation — at a small bandwidth cost we trade for guaranteed correctness after server-side fixes.
3. `systemctl restart nginx` (NOT just `reload`) — some MIME-type changes only take effect on restart.
4. After server fix, existing visitors must clear site data (DevTools → Application → Clear site data) or use an Incognito window for the very next visit. The `Cache-Control: no-cache` header protects against future recurrence.

**Forward defense:** the surfaced error inside the worker (`ner.worker.ts`) labels any error matching `/404|not.?found|failed to fetch/i` as `ERR_MODEL_NOT_FOUND`. This made debugging slower. Consider preserving the original ORT error message in the worker `error` payload (or at least appending it) so future "model not found" reports can be diagnosed without manually intercepting fetch inside the worker. Tracked as follow-up.

**When to decide:** Already enforced on `recode.micheleloi.pro`. Pattern documented here so future Recode-IT-style projects (or migration of the SPA to another host) don't rediscover it.

---

## R-10 — The mapping data format evolves, invalidating old encrypted blobs

**Description.** The mapping blob format is `JSON.stringify(MappingEntry[])`, encrypted with AES-256-GCM. If the `MappingEntry` TypeScript interface changes (e.g., new fields are added, old fields renamed), old blobs may fail to parse after decryption, or may parse with missing fields that cause the recode to fail silently.

**Likelihood:** High. The mapping data model will almost certainly evolve as the product iterates (new entity categories, metadata fields for GLiNER score, new false positive flags).

**Severity:** Low for data loss (blobs are not lost — they just parse differently), but High for user experience (recoding fails unexpectedly).

**Mitigation path:**

1. **Include a `version` field in the mapping JSON**: `{"version": 1, "entries": [...]}`. The recode engine checks the version and applies the appropriate parsing logic.
2. **Backwards compatibility contract**: always parse old versions. If `version` field is missing, assume version 0 and apply migration.
3. **Serialize only `original`, `pseudonym`, `category`, `source`, `isFalsePositive`** — the minimal set needed for recode. Do not encrypt GLiNER scores or display metadata (those are ephemeral).
4. **Test mapping round-trip** as part of Phase 3 gate condition.

**When to decide:** Phase 1 engine design (define the mapping JSON format once and version it from the start).

---

## Summary Risk Register

| # | Risk | Likelihood | Severity | Decision deadline |
|---|---|---|---|---|
| R-01 | ONNX-in-browser numerical fidelity vs Python reference | Medium | Medium | Phase 4 gate (after golden files produced) |
| R-02 | Model bundle size / first-load time | High | Medium-High | Phase 0 + Phase 4 |
| R-03 | WASM/SharedArrayBuffer browser compatibility | Medium | Medium | Phase 0 |
| R-04 | Encryption scheme implementation correctness | Low | Critical | Before Phase 3 |
| R-05 | Recovery codes destroy mappings — user surprise | Certain | Medium | Phase 3 UX |
| R-06 | Operational fidelity: user must actually review | High | High (user) / Low (Recode IT) | Permanent — mitigated by friction-by-design |
| R-07 | MHC-L gate-local/tools/anonymize.py drift vs ANONYMIZER_BUGS.md | Low | Medium | Pre-Phase 4 golden generation (15-min source grep + in-generator assertions) |
| R-08 | Server availability as new dependency | Low | Medium | Phase 6 |
| R-09 | COOP/COEP headers breaking WordPress or integrations | High (if misapplied) | Medium | Phase 0 deployment |
| R-10 | Mapping format evolution invalidating old blobs | High | Low | Phase 1 |

**Removed since v1 (rationale documented in scope note at top):**

- *v1 R-01 "GLiNER ONNX quality on Italian legal text"* — collapsed into R-01-NEW (port fidelity). The empirical quality question was already settled in MHC-L Phase 1 (April 2026); see `MHC-L/dev/traces/trace_anonymizer_ner_bug_analysis_20260416.md` and `MHC-L/dev/ANONYMIZER_BUGS.md`. No new spike is required before Phase 4.
- *v1 R-07 "GDPR: pseudonymized text still personal data?"* — position settled in `MHC-L/legal/DPA.md` §2.2.2-§2.2.4 and `MHC-L/privacy.md` §"State 1" / §"What MHC-L does NOT do" / §"Current limitations". Recode IT inherits the position. The residual operational concern (user must actually review before sending) is captured as R-06 above. No new GDPR consultation is required before launch; a specialist legal review remains on the MHC-L roadmap pre-Phase-2 and Recode IT is naturally in scope of that review when it happens.

**Highest priority before writing the first commit:**

1. R-04 — confirm the crypto scheme with a security-aware reviewer.
2. R-07 — 15-minute source-grep + in-generator assertions on `MHC-L/gate-local/tools/anonymize.py` vs `ANONYMIZER_BUGS.md`. Quick to do, prevents heritage-drift cascade.
3. R-09 — pick the COOP/COEP strategy (scoped nginx vs separate subdomain vs single-threaded WASM) before any production deployment.
