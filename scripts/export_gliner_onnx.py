"""
Export a GLiNER model to ONNX (fp32 + int8 quantized) using GLiNER's native
`export_to_onnx` method (gliner >= 0.2.x).

The active variant is `urchade/gliner_small-v2.1` — picked over
`urchade/gliner_multi-v2.1` because (a) the int8 file size is roughly 1/4
(important for browser WASM cold-load), and (b) GLiNER's zero-shot scoring
generalises across languages even from an English-primary checkpoint thanks to
the underlying DeBERTa-v3-small encoder. Italian-language support is therefore
"good enough for v1" — if quality on IT legal text degrades materially, the
fallback is `urchade/gliner_multi-v2.1` (re-run this script with MODEL_NAME
flipped back).

Output layout under `scripts/`:
  gliner_onnx_fp32/model.onnx                  fp32 export (kept for reference)
  gliner_onnx_fp32/model_quantized.onnx        int8 quantised export
  + tokenizer + gliner_config.json + spm.model artefacts (saved by gliner)

The quantised file is then copied to `scripts/<FINAL_Q8_NAME>` for upload to
the VPS / for placement under `public/models/` for the Vite dev server.
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

from gliner import GLiNER

# --- variant selection -----------------------------------------------------
MODEL_NAME = "urchade/gliner_small-v2.1"
FINAL_Q8_NAME = "gliner_small_v2.1_q8.onnx"

OUT_DIR = Path(__file__).parent / "gliner_onnx_fp32"
OUT_DIR.mkdir(exist_ok=True)
FINAL_Q8 = Path(__file__).parent / FINAL_Q8_NAME

print(f"Loading {MODEL_NAME} ...", flush=True)
model = GLiNER.from_pretrained(MODEL_NAME)
model.eval()

print(f"Running export_to_onnx(quantize=True) -> {OUT_DIR} ...", flush=True)
result = model.export_to_onnx(
    save_dir=str(OUT_DIR),
    onnx_filename="model.onnx",
    quantized_filename="model_quantized.onnx",
    quantize=True,
    opset=17,
)
print(f"export_to_onnx result: {result}", flush=True)

fp32 = OUT_DIR / "model.onnx"
q8 = OUT_DIR / "model_quantized.onnx"

if fp32.exists():
    print(f"fp32 ONNX: {fp32} ({fp32.stat().st_size/1e6:.1f} MB)", flush=True)
if q8.exists():
    print(f"int8 ONNX: {q8} ({q8.stat().st_size/1e6:.1f} MB)", flush=True)
    shutil.copy2(q8, FINAL_Q8)
    print(f"Copied -> {FINAL_Q8} ({FINAL_Q8.stat().st_size/1e6:.1f} MB)", flush=True)
else:
    print("ERROR: quantized model not produced", flush=True)
    sys.exit(2)

# Save tokenizer / gliner_config alongside the ONNX so the worker can fetch
# them from the same directory (transformers.js AutoTokenizer.from_pretrained
# expects tokenizer.json / spm.model / etc. next to the model).
try:
    model.save_pretrained(str(OUT_DIR))
    print(f"Tokenizer/config saved to {OUT_DIR}", flush=True)
except Exception as e:
    print(f"Tokenizer save warning: {e}", flush=True)

print("DONE.", flush=True)
