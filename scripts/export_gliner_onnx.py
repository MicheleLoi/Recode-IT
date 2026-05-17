"""
Export urchade/gliner_multi-v2.1 to ONNX (fp32 + int8 quantized) using GLiNER's
native export_to_onnx method (gliner >= 0.2.x).

Output:
  scripts/gliner_onnx_fp32/model.onnx                 (~300 MB)
  scripts/gliner_onnx_fp32/model_quantized.onnx       (~120 MB)  -- copied to scripts/gliner_multi_v2.1_q8.onnx
  + tokenizer + gliner_config.json + spm.model

The quantized file is renamed/copied to scripts/gliner_multi_v2.1_q8.onnx for
upload to the VPS.
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

from gliner import GLiNER

OUT_DIR = Path(__file__).parent / "gliner_onnx_fp32"
OUT_DIR.mkdir(exist_ok=True)
FINAL_Q8 = Path(__file__).parent / "gliner_multi_v2.1_q8.onnx"

print("Loading urchade/gliner_multi-v2.1 ...", flush=True)
model = GLiNER.from_pretrained("urchade/gliner_multi-v2.1")
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

# Save tokenizer artefacts alongside (for completeness — VPS deployment focuses
# on the .onnx file per the task spec)
try:
    model.save_pretrained(str(OUT_DIR))
    print(f"Tokenizer/config saved to {OUT_DIR}", flush=True)
except Exception as e:
    print(f"Tokenizer save warning: {e}", flush=True)

print("DONE.", flush=True)
