"""
Sanity-check the exported ONNX model end-to-end, mirroring the JS worker's
preprocessing algorithm step-for-step. If this script identifies "Mario Rossi"
as `persona` on the Italian test sentence, the worker's TS port should as well
(modulo numerical drift from int8 quantization, which is negligible for the
threshold tiers we use).

Usage:
    python scripts/sanity_check_onnx.py
"""
from __future__ import annotations

import re
from pathlib import Path

import numpy as np
import onnxruntime as ort
from transformers import AutoTokenizer

MODEL_DIR = Path(__file__).parent / "gliner_onnx_fp32"
MODEL_PATH = MODEL_DIR / "model_quantized.onnx"

TEXT = "Mario Rossi ha presentato ricorso al Tribunale di Milano."
LABELS = ["persona", "luogo"]  # tier 1 from the worker
THRESHOLD = 0.4
MAX_WIDTH = 12
ENT_TOKEN = "<<ENT>>"
SEP_TOKEN = "<<SEP>>"

# Same regex as the TS worker's splitWords()
WORD_RE = re.compile(r"\w+(?:[-_]\w+)*|\S", re.UNICODE)


def split_words(text):
    return [(m.group(), m.start(), m.end()) for m in WORD_RE.finditer(text)]


def build_feeds(text, labels, tokenizer):
    words = split_words(text)
    cls_id = tokenizer.cls_token_id
    sep_id = tokenizer.sep_token_id
    ent_id = tokenizer.convert_tokens_to_ids(ENT_TOKEN)
    sep_prompt_id = tokenizer.convert_tokens_to_ids(SEP_TOKEN)

    input_ids = []
    words_mask = []

    if cls_id is not None:
        input_ids.append(cls_id)
        words_mask.append(0)

    for label in labels:
        input_ids.append(ent_id)
        words_mask.append(0)
        for tid in tokenizer.encode(label, add_special_tokens=False):
            input_ids.append(tid)
            words_mask.append(0)

    input_ids.append(sep_prompt_id)
    words_mask.append(0)

    for i, (word, _, _) in enumerate(words):
        word_ids = tokenizer.encode(word, add_special_tokens=False)
        if not word_ids:
            input_ids.append(tokenizer.unk_token_id or 0)
            words_mask.append(i + 1)
        else:
            for s, tid in enumerate(word_ids):
                input_ids.append(tid)
                words_mask.append(i + 1 if s == 0 else 0)

    if sep_id is not None:
        input_ids.append(sep_id)
        words_mask.append(0)

    num_subs = len(input_ids)
    num_words = len(words)

    # span_idx / span_mask
    num_spans = num_words * MAX_WIDTH
    span_idx = np.zeros((1, num_spans, 2), dtype=np.int64)
    span_mask = np.zeros((1, num_spans), dtype=bool)
    idx = 0
    for s in range(num_words):
        for w in range(MAX_WIDTH):
            span_idx[0, idx, 0] = s
            span_idx[0, idx, 1] = s + w
            span_mask[0, idx] = (s + w) <= num_words - 1
            idx += 1

    feeds = {
        "input_ids": np.array([input_ids], dtype=np.int64),
        "attention_mask": np.ones((1, num_subs), dtype=np.int64),
        "words_mask": np.array([words_mask], dtype=np.int64),
        "text_lengths": np.array([[num_words]], dtype=np.int64),
        "span_idx": span_idx,
        "span_mask": span_mask,
    }
    return feeds, words


def sigmoid(x):
    return 1 / (1 + np.exp(-x))


def main():
    print(f"Loading tokenizer from {MODEL_DIR} ...")
    tok = AutoTokenizer.from_pretrained(str(MODEL_DIR))

    print(f"Loading ONNX session from {MODEL_PATH} ...")
    sess = ort.InferenceSession(str(MODEL_PATH), providers=["CPUExecutionProvider"])
    print("ONNX inputs:")
    for inp in sess.get_inputs():
        print(f"  {inp.name}: {inp.shape} {inp.type}")
    print("ONNX outputs:")
    for out in sess.get_outputs():
        print(f"  {out.name}: {out.shape} {out.type}")

    feeds, words = build_feeds(TEXT, LABELS, tok)
    print(f"\nText: {TEXT!r}")
    print(f"Words: {[w[0] for w in words]}")
    print(f"Feed shapes:")
    for k, v in feeds.items():
        print(f"  {k}: {v.shape} {v.dtype}")

    out = sess.run(None, feeds)
    logits = out[0]
    print(f"\nLogits shape: {logits.shape} (expected [1, num_words={len(words)}, K=12, C={len(LABELS)}])")

    probs = sigmoid(logits)
    found = []
    L, K, C = probs.shape[1], probs.shape[2], probs.shape[3]
    for s in range(L):
        for k in range(K):
            end = s + k
            if end >= len(words):
                break
            for c in range(C):
                score = probs[0, s, k, c]
                if score >= THRESHOLD:
                    start_char = words[s][1]
                    end_char = words[end][2]
                    found.append(
                        (start_char, end_char, LABELS[c], TEXT[start_char:end_char], float(score))
                    )

    print(f"\nRaw spans above threshold ({THRESHOLD}):")
    for span in sorted(found, key=lambda x: -x[4]):
        print(f"  {span}")

    # Greedy overlap dedup
    found.sort(key=lambda x: -x[4])
    accepted = []
    for span in found:
        if not any(span[0] < a[1] and span[1] > a[0] for a in accepted):
            accepted.append(span)

    print(f"\nAccepted spans (greedy non-overlap):")
    for span in sorted(accepted, key=lambda x: x[0]):
        print(f"  [{span[0]:3d}, {span[1]:3d}] {span[2]:8s} score={span[4]:.3f}  text={span[3]!r}")


if __name__ == "__main__":
    main()
