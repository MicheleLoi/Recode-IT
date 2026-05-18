"""
Sanity-check the exported DistilBERT Italian NER ONNX model end-to-end.

The model is a standard token-classification graph (NOT span-based GLiNER):
  inputs  : input_ids [1, L], attention_mask [1, L]
  outputs : logits   [1, L, 5]  over labels {O, PER, LOC, ORG, MISC}
            IO scheme — consecutive same-label tokens form one span.

We replicate the JS worker's decoding path so this script is the Python
ground truth for the TS port:

  1. tokenizer(text, return_offsets_mapping=True, return_special_tokens_mask=True)
  2. softmax over logits axis=-1
  3. argmax → per-token label id; gather probability of that label
  4. greedy IO-span decoding using offset_mapping to reconstruct char spans,
     skipping special tokens (CLS, SEP, PAD) and subword continuations
     where the offset_mapping for a subword starts inside another token's
     offset window.
  5. MISC labels are dropped (per the JS worker mapping)
  6. PER → persona, LOC → luogo, ORG → organizzazione

Usage:
    python scripts/sanity_check_onnx.py
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import onnxruntime as ort
from transformers import AutoTokenizer

HERE = Path(__file__).parent
# Prefer the quantised int8 export (what the browser actually loads) so the
# sanity check matches production behaviour byte-for-byte. Fall back to the
# fp32 export if the q8 isn't on disk yet (e.g. fresh clone, no export run).
Q8_DIR = HERE / "distilbert_italian_ner_onnx_q8"
FP32_DIR = HERE / "distilbert_italian_ner_onnx_fp32"

Q8_ONNX = Q8_DIR / "model_quantized.onnx"
FP32_ONNX = FP32_DIR / "model.onnx"

if Q8_ONNX.exists():
    MODEL_PATH = Q8_ONNX
    TOKENIZER_DIR = FP32_DIR  # tokenizer files live with the fp32 export
elif FP32_ONNX.exists():
    MODEL_PATH = FP32_ONNX
    TOKENIZER_DIR = FP32_DIR
else:
    raise FileNotFoundError(
        f"No ONNX model found. Run `python scripts/export_distilbert_onnx.py` first.\n"
        f"  Looked for: {Q8_ONNX}  and  {FP32_ONNX}"
    )

TEXT = "Mario Rossi ha presentato ricorso al Tribunale di Milano contro la societa Acme S.r.l."

# Map DistilBERT id2label → the Italian schema the JS worker emits downstream.
# MISC is dropped (legacy WikiNER catch-all, low value for legal pseudonymisation).
LABEL_MAP = {
    "PER": "persona",
    "LOC": "luogo",
    "ORG": "organizzazione",
}

# Per-category confidence floor (must mirror the JS worker's tiers).
THRESHOLDS = {
    "persona": 0.40,
    "luogo": 0.40,
    "organizzazione": 0.55,
}


def softmax(x: np.ndarray, axis: int = -1) -> np.ndarray:
    x = x - x.max(axis=axis, keepdims=True)
    e = np.exp(x)
    return e / e.sum(axis=axis, keepdims=True)


def main() -> int:
    print(f"Loading tokenizer from {TOKENIZER_DIR} ...", flush=True)
    tok = AutoTokenizer.from_pretrained(str(TOKENIZER_DIR))

    print(f"Loading ONNX session from {MODEL_PATH} ...", flush=True)
    sess = ort.InferenceSession(str(MODEL_PATH), providers=["CPUExecutionProvider"])
    print("ONNX inputs:")
    for inp in sess.get_inputs():
        print(f"  {inp.name}: {inp.shape} {inp.type}")
    print("ONNX outputs:")
    for out in sess.get_outputs():
        print(f"  {out.name}: {out.shape} {out.type}")

    # The tokenizer is the same SentencePiece/WordPiece used at training time.
    # We need offset_mapping so we can rebuild char spans; special_tokens_mask
    # so we can skip CLS/SEP/PAD without trusting a hard-coded id list.
    enc = tok(
        TEXT,
        return_offsets_mapping=True,
        return_special_tokens_mask=True,
        return_tensors="np",
    )
    input_ids = enc["input_ids"].astype(np.int64)
    attention_mask = enc["attention_mask"].astype(np.int64)
    offsets = enc["offset_mapping"][0]
    specials = enc["special_tokens_mask"][0]

    print(f"\nText: {TEXT!r}")
    print(f"Tokens: {input_ids.shape[1]}")

    feeds = {"input_ids": input_ids, "attention_mask": attention_mask}
    logits = sess.run(None, feeds)[0]  # [1, L, 5]
    print(f"Logits shape: {logits.shape}  (expected [1, L, 5])")

    probs = softmax(logits, axis=-1)[0]   # [L, 5]
    pred_ids = probs.argmax(axis=-1)      # [L]
    pred_scores = probs[np.arange(len(pred_ids)), pred_ids]  # [L]

    # id2label from config.json — keep in sync if the model ever changes.
    id2label = {0: "O", 1: "PER", 2: "LOC", 3: "ORG", 4: "MISC"}

    # ── Greedy IO-span decoding ──────────────────────────────────────────
    #
    # IO scheme: consecutive tokens carrying the same non-O label merge
    # into one span, EVEN IF separated by whitespace in the original text.
    # We bridge whitespace gaps when the intervening characters are
    # whitespace only — this lets "Mario" + "Rossi" → "Mario Rossi" and
    # "Tribunale" + "di" + "Milano" → "Tribunale di Milano" form proper
    # multi-word entities.
    #
    # Punctuation in between (e.g. comma) closes the span. Different label
    # closes the span. End-of-sequence flushes.
    spans: list[tuple[int, int, str, float, str]] = []
    active: tuple[int, int, str, float] | None = None
    # (char_start, char_end, raw_label, min_score)

    def close_active() -> None:
        nonlocal active
        if active is None:
            return
        start_char, end_char, raw_label, min_score = active
        active = None
        mapped = LABEL_MAP.get(raw_label)
        if mapped is None:
            return
        if min_score < THRESHOLDS.get(mapped, 0.5):
            return
        text_slice = TEXT[start_char:end_char]
        spans.append((start_char, end_char, mapped, min_score, text_slice))

    for i, (lid, score) in enumerate(zip(pred_ids, pred_scores)):
        if specials[i] == 1:
            close_active()
            continue
        s_char, e_char = int(offsets[i][0]), int(offsets[i][1])
        if s_char == 0 and e_char == 0:
            close_active()
            continue

        raw_label = id2label[int(lid)]
        if raw_label == "O":
            close_active()
            continue

        if active is None:
            active = (s_char, e_char, raw_label, float(score))
            continue

        prev_start, prev_end, prev_label, prev_min = active
        # Bridge whitespace-only gap (or zero gap for WordPiece continuation).
        gap_is_whitespace = TEXT[prev_end:s_char].strip() == ""
        if prev_label == raw_label and gap_is_whitespace:
            active = (prev_start, e_char, prev_label, min(prev_min, float(score)))
            continue

        # Different label or non-whitespace gap → close prior, open new.
        close_active()
        active = (s_char, e_char, raw_label, float(score))

    close_active()

    print(f"\nAccepted spans (IO decode, per-tier thresholds):")
    for s, e, lab, sc, txt in spans:
        print(f"  [{s:3d}, {e:3d}] {lab:14s} score={sc:.3f}  text={txt!r}")

    if not spans:
        print("  (none)")
        print("\nWARNING: zero spans accepted. Check thresholds or model artefact.")
        return 1

    # Hard sanity assertions — if any of these fail, the worker port will too.
    expected_persona = {"Mario Rossi"}
    expected_luogo = {"Milano"}
    expected_org = {"Tribunale", "Acme S.r.l.", "Acme", "Tribunale di Milano"}

    found_persona = {txt for _, _, lab, _, txt in spans if lab == "persona"}
    found_luogo = {txt for _, _, lab, _, txt in spans if lab == "luogo"}
    found_org = {txt for _, _, lab, _, txt in spans if lab == "organizzazione"}

    print(f"\nPersone trovate: {found_persona}")
    print(f"Luoghi trovati:  {found_luogo}")
    print(f"Organizzazioni:  {found_org}")

    if not (expected_persona & found_persona):
        print(f"\nFAIL: expected one of {expected_persona} in persone, got {found_persona}")
        return 1
    # Luogo Milano may be absorbed by Tribunale-di-Milano ORG span — accept either.
    if not ((expected_luogo & found_luogo) or any("Milano" in t for _, _, _, _, t in spans)):
        print(f"\nFAIL: 'Milano' not found in any span")
        return 1

    print("\nOK — sanity check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
