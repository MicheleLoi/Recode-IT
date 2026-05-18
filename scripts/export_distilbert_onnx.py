"""
Export `osiria/distilbert-italian-cased-ner` to ONNX (fp32 + int8 quantised)
using HuggingFace Optimum's ONNX exporter.

Replaces the previous GLiNER pipeline. Rationale (per the NER rewrite brief,
2026-05-18): GLiNER small-v2.1 was English-primary and generalised badly on
Italian legal text. The osiria distilbert checkpoint is Italian-native,
WikiNER-trained, ~66 MB quantised (3x smaller than the GLiNER export), with
a standard token-classification head over 5 labels: O / PER / LOC / ORG / MISC
(IO scheme — consecutive same-label tokens form one entity span).

Output layout under `scripts/`:
  distilbert_italian_ner_onnx_fp32/model.onnx           fp32 export (Optimum)
  distilbert_italian_ner_onnx_fp32/<tokenizer files>    saved alongside
  distilbert_italian_ner_q8.onnx                        int8 quantised, copied
                                                        to scripts/ root

The quantised .onnx + tokenizer artefacts are then copied to
`public/models/` (see `--copy-to-public` flag) so the Vite dev server picks
them up at `/models/...`.

Usage:
    python scripts/export_distilbert_onnx.py
    python scripts/export_distilbert_onnx.py --copy-to-public
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

from optimum.onnxruntime import ORTModelForTokenClassification, ORTQuantizer
from optimum.onnxruntime.configuration import AutoQuantizationConfig
from transformers import AutoTokenizer

# --- variant selection -----------------------------------------------------
MODEL_NAME = "osiria/distilbert-italian-cased-ner"
FINAL_Q8_NAME = "distilbert_italian_ner_q8.onnx"

HERE = Path(__file__).parent
FP32_DIR = HERE / "distilbert_italian_ner_onnx_fp32"
Q8_DIR = HERE / "distilbert_italian_ner_onnx_q8"
FINAL_Q8 = HERE / FINAL_Q8_NAME

PUBLIC_MODELS_DIR = HERE.parent / "public" / "models"

# Tokenizer artefacts the JS worker needs alongside the .onnx file.
TOKENIZER_FILES = (
    "tokenizer.json",
    "tokenizer_config.json",
    "vocab.txt",
    "special_tokens_map.json",
    "config.json",  # carries id2label / label2id — worker reads this
)


def export(model_name: str = MODEL_NAME) -> Path:
    """Export fp32 ONNX + tokenizer artefacts; return the fp32 directory."""
    print(f"Loading + exporting {model_name} to ONNX fp32 ...", flush=True)
    FP32_DIR.mkdir(exist_ok=True)

    # ORTModelForTokenClassification.from_pretrained with export=True triggers
    # an on-the-fly transformers->ONNX export and persists it via save_pretrained.
    model = ORTModelForTokenClassification.from_pretrained(model_name, export=True)
    model.save_pretrained(str(FP32_DIR))

    tokenizer = AutoTokenizer.from_pretrained(model_name)
    tokenizer.save_pretrained(str(FP32_DIR))

    onnx_path = FP32_DIR / "model.onnx"
    if not onnx_path.exists():
        # Optimum sometimes names it differently — locate the first .onnx file.
        candidates = list(FP32_DIR.glob("*.onnx"))
        if not candidates:
            raise FileNotFoundError(f"No .onnx produced in {FP32_DIR}")
        onnx_path = candidates[0]

    size_mb = onnx_path.stat().st_size / 1e6
    print(f"fp32 ONNX: {onnx_path} ({size_mb:.1f} MB)", flush=True)
    return FP32_DIR


def quantize(fp32_dir: Path) -> Path:
    """Apply dynamic int8 quantisation; return the quantised .onnx file."""
    print(f"Quantising fp32 ONNX in {fp32_dir} to int8 ...", flush=True)
    Q8_DIR.mkdir(exist_ok=True)

    quantizer = ORTQuantizer.from_pretrained(str(fp32_dir))
    # Dynamic int8 quantisation, AVX-512 baseline (matches the CPU profile of
    # Optimum's defaults; the WASM runtime in-browser is happy with this).
    qconfig = AutoQuantizationConfig.avx512_vnni(is_static=False, per_channel=False)
    quantizer.quantize(save_dir=str(Q8_DIR), quantization_config=qconfig)

    # Optimum writes `model_quantized.onnx`.
    q_onnx = Q8_DIR / "model_quantized.onnx"
    if not q_onnx.exists():
        candidates = list(Q8_DIR.glob("*quantized*.onnx"))
        if not candidates:
            raise FileNotFoundError(f"No quantised .onnx produced in {Q8_DIR}")
        q_onnx = candidates[0]

    size_mb = q_onnx.stat().st_size / 1e6
    print(f"int8 ONNX: {q_onnx} ({size_mb:.1f} MB)", flush=True)

    shutil.copy2(q_onnx, FINAL_Q8)
    print(f"Copied -> {FINAL_Q8} ({FINAL_Q8.stat().st_size/1e6:.1f} MB)", flush=True)
    return FINAL_Q8


def copy_artefacts_to_public(fp32_dir: Path, q8_file: Path) -> None:
    """Copy the int8 ONNX + tokenizer files into public/models/ for Vite dev."""
    PUBLIC_MODELS_DIR.mkdir(parents=True, exist_ok=True)
    target_onnx = PUBLIC_MODELS_DIR / FINAL_Q8_NAME
    shutil.copy2(q8_file, target_onnx)
    print(f"Copied -> {target_onnx}", flush=True)
    for fname in TOKENIZER_FILES:
        src = fp32_dir / fname
        if not src.exists():
            print(f"  (skipping missing {fname})", flush=True)
            continue
        shutil.copy2(src, PUBLIC_MODELS_DIR / fname)
        print(f"  copied {fname}", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--copy-to-public",
        action="store_true",
        help="Also copy the quantised ONNX + tokenizer files to public/models/.",
    )
    args = parser.parse_args()

    fp32_dir = export()
    q8_file = quantize(fp32_dir)

    if args.copy_to_public:
        copy_artefacts_to_public(fp32_dir, q8_file)

    print("DONE.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
