# Prepare the GLiNER ONNX model for Recode IT

Founder-side, one-time task. NOT auto-executable: it requires PyTorch +
`optimum` + `onnxruntime` extras that we deliberately keep out of the Recode IT
dev dependencies (browser-only stack).

The goal is to produce `gliner_multi_v2.1_q8.onnx` (≤ 120 MB int8) starting
from the HuggingFace checkpoint `urchade/gliner_multi-v2.1` and host it as a
static asset at `micheleloi.pro/recode-it/models/gliner_multi_v2.1_q8.onnx`.

For local dev / Phase 4 testing the same file can live at
`recode-it/public/models/gliner_multi_v2.1_q8.onnx` (gitignored — too large to
commit).

## 0. Environment

```bash
# In a *separate* venv (do not pollute the Recode IT npm project):
python -m venv .venv-model
source .venv-model/bin/activate     # or .venv-model\Scripts\activate on Windows
pip install \
    "optimum[onnxruntime]>=1.21" \
    "transformers>=4.41" \
    "onnxruntime>=1.18" \
    torch
```

## 1. Export the HF checkpoint to ONNX (float32)

```bash
optimum-cli export onnx \
    --model urchade/gliner_multi-v2.1 \
    --task token-classification \
    --opset 17 \
    gliner_onnx/
```

This produces `gliner_onnx/model.onnx` (~300 MB float32) plus the tokenizer
artefacts (`tokenizer.json`, `tokenizer_config.json`, `special_tokens_map.json`,
`vocab.txt`). Keep the tokenizer files alongside the ONNX — Transformers.js
needs them to load the same tokenizer in the browser.

## 2. Dynamic int8 quantization

Dynamic quantization is the right starting point for transformer NER models —
no calibration set needed, and the quality drop is typically <1 F1 point on
sequence-labeling tasks (well within the ±2-char / ≥95% recall tolerance of
EQ.6 in `TEST_PLAN.md`).

```bash
python -c "
from onnxruntime.quantization import quantize_dynamic, QuantType
quantize_dynamic(
    model_input='gliner_onnx/model.onnx',
    model_output='gliner_multi_v2.1_q8.onnx',
    weight_type=QuantType.QInt8,
)
"
```

If the resulting file is > 120 MB: switch to `QuantType.QUInt8` (smaller scale
tables on some embeddings) or try **static** quantization with a small Italian
legal calibration set sampled from `MHC-L/dev/testing_documents/`. Do not
default to int4 — see OPEN_RISKS.md R-01 for the equivalence-band rationale.

## 3. Validate against the Python reference (R-01 sanity)

Before uploading, re-run the Python golden generator with the ONNX model
swapped in and diff against the float32 goldens:

```bash
# (Manual smoke test — for the founder, not automated.)
# 1. Patch anonymize._predict_chunk to load the ONNX model via onnxruntime
#    instead of GLiNER.from_pretrained (proof-of-concept).
# 2. Run scripts/generate_python_goldens.py into a /tmp dir.
# 3. Diff against test-fixtures/mhc-l/golden/*.json.
```

If the diff fits the EQ.6 tolerance band (±2 chars on offsets, ≥95% of golden
spans matched, ≤5% drift either direction), you are clear to deploy. If not,
fall back to float32 ONNX (~300 MB) and accept the larger first-load cost
(see OPEN_RISKS.md R-02).

## 4. Deploy

```bash
# Production
scp gliner_multi_v2.1_q8.onnx \
    tokenizer.json \
    tokenizer_config.json \
    special_tokens_map.json \
    vocab.txt \
    micheleloi.pro:/var/www/recode-it/models/

# Dev (local serving via Vite — files are gitignored)
mkdir -p recode-it/public/models
cp gliner_multi_v2.1_q8.onnx recode-it/public/models/
cp tokenizer*.json recode-it/public/models/
cp special_tokens_map.json recode-it/public/models/
cp vocab.txt recode-it/public/models/
```

The browser worker (`src/workers/gliner.worker.ts`) loads from a configurable
URL (default `/models/gliner_multi_v2.1_q8.onnx`). Ensure CORS headers
(`Cross-Origin-Resource-Policy: cross-origin`) are set on the model host so the
COOP/COEP isolated context can fetch it.

## 5. Cache invalidation

The model URL must be content-addressed (or carry a `?v=<hash>` query string)
so browsers re-download when the file changes. The Cache API entry stored by
the worker is keyed by URL; without a version bump, users keep using the old
model after a deploy.

---

**Phase 4 testing without the model**: the equivalence harness ships a "mock
mode" (see `src/engine/__tests__/numerical_equivalence.test.ts`) that uses the
golden `ner_entities` list as the browser NER output. This lets EQ.1-EQ.5 and
EQ.7-EQ.8 run green even before the ONNX file is deployed. EQ.6 is marked
SKIPPED in mock mode; the founder runs it after step 4 above.
