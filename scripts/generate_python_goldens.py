#!/usr/bin/env python3
"""
generate_python_goldens.py — Phase 4 deliverable (full implementation).

Purpose
-------
Produce the Python golden-output JSON files that Phase 4 of the Recode IT
implementation uses as the equivalence contract for the browser-side TS port.
See IMPLEMENTATION_PLAN.md §Phase 4, OPEN_RISKS.md R-01 / R-07, and
TEST_PLAN.md §Phase 4 (EQ.1-EQ.8).

Two modes
---------
    # R-07 pre-flight (cheap source-grep on anonymize.py):
    python scripts/generate_python_goldens.py --check-signatures

    # Full golden generation (default): runs the MHC-L pipeline on each of the
    # four fixture documents and writes a JSON contract to
    # test-fixtures/mhc-l/golden/<basename>.json.
    python scripts/generate_python_goldens.py

Run from the MHC-L .venv (it provides gliner + onnxruntime + spacy). Example:
    "../MHC-L/.venv/Scripts/python.exe" scripts/generate_python_goldens.py
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Paths — MHC_L_ROOT è un sibling repo privato che ospita la reference
# pipeline `anonymize.py`. Lo script lo legge da ENV var `MHC_L_ROOT` per
# evitare hardcoding di path personali nel codice pubblico (AGPL release
# 2026-05-26). Default fallback a current directory placeholder; lo script
# fallirà fast se ANONYMIZE_PY non esiste, segnalando la config mancante.
# Set localmente prima dell'invocazione: es. su Windows
#   set MHC_L_ROOT=C:\path\to\MHC-L
# oppure su Unix
#   export MHC_L_ROOT=/path/to/MHC-L
# ---------------------------------------------------------------------------

MHC_L_ROOT = Path(os.environ.get("MHC_L_ROOT", "."))
ANONYMIZE_PY = MHC_L_ROOT / "gate-local" / "tools" / "anonymize.py"
GATE_LOCAL = MHC_L_ROOT / "gate-local"

RECODE_IT_ROOT = Path(__file__).resolve().parent.parent
FIXTURES_DIR = RECODE_IT_ROOT / "test-fixtures" / "mhc-l" / "documents"
GOLDEN_DIR = RECODE_IT_ROOT / "test-fixtures" / "mhc-l" / "golden"

FIXTURES = [
    FIXTURES_DIR / "doc_A_fendipista.md",
    FIXTURES_DIR / "doc_B_eredita.md",
    FIXTURES_DIR / "doc_C_il_leak.md",
    FIXTURES_DIR / "doc_00_appalto_edilizio.md",
]


# ---------------------------------------------------------------------------
# R-07 signature check — implementable in Phase 0, runs against anonymize.py.
# Kept verbatim from the Phase-0 stub; still gates Phase 4 generation.
# ---------------------------------------------------------------------------

SIGNATURE_CHECKS: list[tuple[str, str, str]] = [
    ("A-1", "_ITALIAN_ARTICLES referenced in get_person", r"_ITALIAN_ARTICLES"),
    (
        "A-1",
        "_surname_map first-write guard (setdefault or 'not in' check)",
        r"_surname_map\.setdefault|if\s+\w+\s+not\s+in\s+self\._surname_map",
    ),
    ("A-2", "_DE_CUIUS_RE defined", r"_DE_CUIUS_RE\s*="),
    ("A-2", "mark_skip method present", r"def\s+mark_skip\b"),
    ("A-2", "_skip_set referenced", r"_skip_set"),
    (
        "A-3",
        "TITLE_RE elided-article prefix [Ll]['...] (straight or curly/\\u2019 apostrophe)",
        # Accept literal char-class containing straight quote, curly U+2019,
        # or the Python escape sequence ’.
        r"\[Ll\]\['(?:\\u2019|’)?\]|\[Ll\]\[’'\]",
    ),
    ("A-3", "Notaio in title alternation", r"Notaio"),
]


def check_signatures() -> int:
    if not ANONYMIZE_PY.exists():
        print(f"[FAIL] anonymize.py not found at: {ANONYMIZE_PY}", file=sys.stderr)
        return 2
    source = ANONYMIZE_PY.read_text(encoding="utf-8")
    failed: list[tuple[str, str]] = []
    for fix_id, label, pattern in SIGNATURE_CHECKS:
        if re.search(pattern, source):
            print(f"[ OK ] {fix_id}  {label}")
        else:
            print(f"[FAIL] {fix_id}  {label}  (pattern: {pattern!r})")
            failed.append((fix_id, label))
    if failed:
        print(
            f"\n{len(failed)} signature check(s) failed — anonymize.py may have drifted "
            f"from ANONYMIZER_BUGS.md. See OPEN_RISKS.md R-07.",
            file=sys.stderr,
        )
        return 1
    print(f"\nAll {len(SIGNATURE_CHECKS)} signature checks passed (R-07 pre-flight green).")
    return 0


# ---------------------------------------------------------------------------
# Phase 4 main loop — full golden generation.
# ---------------------------------------------------------------------------

def _git_sha() -> str:
    try:
        sha = subprocess.check_output(
            ["git", "-C", str(MHC_L_ROOT), "rev-parse", "--short", "HEAD"],
            stderr=subprocess.DEVNULL,
        ).decode("ascii").strip()
        return sha or "unknown"
    except Exception:
        return "unknown"


def _import_pipeline() -> tuple[Any, Any, Any, Any]:
    """Import the MHC-L anonymize module + dependencies, returning callables.

    Returns (anonymize, _get_model, PseudonymMapper, _find_decuius_names).
    """
    # gate-local needs to be on path so `from tools.regex_rules import ...`
    # inside anonymize.py resolves.
    sys.path.insert(0, str(GATE_LOCAL.resolve()))
    from tools import anonymize as anon_mod  # type: ignore  # noqa: E402

    return (
        anon_mod.anonymize,
        anon_mod._get_model,
        anon_mod.PseudonymMapper,
        anon_mod._find_decuius_names,
    )


def _count_regex_substitutions(detections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Per-category counts of regex detections. Pattern field == category."""
    counts: dict[str, int] = {}
    for d in detections:
        if d.get("source") != "regex":
            continue
        cat = d.get("category", "UNKNOWN")
        counts[cat] = counts.get(cat, 0) + 1
    return [{"pattern": k, "count": v} for k, v in sorted(counts.items())]


def _extract_ner_entities(detections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Project GLiNER detections onto the {start,end,label,text,score} contract."""
    out = []
    for d in detections:
        if d.get("source") != "gliner":
            continue
        out.append({
            "start": int(d["start"]),
            "end": int(d["end"]),
            "label": d["label"],
            "text": d["text"],
            "score": float(d.get("score", 0.0)),
        })
    out.sort(key=lambda e: (e["start"], e["end"]))
    return out


def _detect_collisions_from_summary(summary: dict[str, Any]) -> dict[str, list[str]]:
    """Reverse-index person_map → pseudonym; pseudonyms with >1 names are collisions."""
    person_map = summary.get("persona", {})
    inverse: dict[str, list[str]] = {}
    for name, pseudo in person_map.items():
        inverse.setdefault(pseudo, []).append(name)
    return {p: sorted(ns) for p, ns in inverse.items() if len(ns) > 1}


def generate_one_golden(
    fixture_path: Path,
    anonymize_fn,
    get_model_fn,
    find_decuius_fn,
    pipeline_version: str,
) -> Path:
    """Run anonymize() on a single fixture and write the golden JSON. Returns the output path."""
    text = fixture_path.read_text(encoding="utf-8")
    model = get_model_fn()
    result = anonymize_fn(text, model)

    detections = result.get("detections", [])
    summary = result.get("mapping_summary", {})

    # Reconstruct the skip_set the same way the live pipeline does — by re-running
    # the de-cuius detector on the raw text. (The mapper instance is internal to
    # anonymize(); we reconstruct skip_set without re-instantiating it.)
    skip_set = sorted(find_decuius_fn(text))

    golden = {
        "source": fixture_path.name,
        "pipeline_version": f"anonymize.py@{pipeline_version}",
        "person_map": dict(summary.get("persona", {})),
        "surname_map": dict(summary.get("surname_index", {})),
        "skip_set": skip_set,
        "collisions": _detect_collisions_from_summary(summary),
        "regex_substitutions": _count_regex_substitutions(detections),
        "ner_entities": _extract_ner_entities(detections),
        "pseudonymized_text": result["anonymized_text"],
    }

    out = GOLDEN_DIR / f"{fixture_path.stem}.json"
    GOLDEN_DIR.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(golden, indent=2, ensure_ascii=False), encoding="utf-8")
    print(
        f"[ OK ] {fixture_path.name}  -> {out.relative_to(RECODE_IT_ROOT)}"
        f"  ({len(text)} chars, {len(golden['ner_entities'])} NER ents, "
        f"{len(golden['person_map'])} persons, {len(golden['skip_set'])} skipped)"
    )
    return out


def generate_all_goldens() -> int:
    # R-07 in-generator assertion: re-run the signature check; bail out if drifted.
    rc = check_signatures()
    if rc != 0:
        print("R-07 pre-flight failed — refusing to generate goldens.", file=sys.stderr)
        return rc

    print(f"\nMHC-L git SHA: {_git_sha()}")
    print(f"Fixtures dir : {FIXTURES_DIR}")
    print(f"Golden dir   : {GOLDEN_DIR}\n")

    try:
        anonymize_fn, get_model_fn, _Mapper, find_decuius_fn = _import_pipeline()
    except Exception as exc:
        print(f"[FAIL] Could not import MHC-L pipeline: {exc}", file=sys.stderr)
        print(
            "       Make sure you are running this with the MHC-L venv "
            "(gliner + onnxruntime + spacy required).",
            file=sys.stderr,
        )
        return 3

    pipeline_version = _git_sha()
    written: list[Path] = []
    for fixture in FIXTURES:
        if not fixture.exists():
            print(f"[SKIP] fixture missing: {fixture}", file=sys.stderr)
            continue
        try:
            written.append(
                generate_one_golden(
                    fixture, anonymize_fn, get_model_fn, find_decuius_fn, pipeline_version
                )
            )
        except Exception as exc:
            print(f"[FAIL] {fixture.name}: {exc}", file=sys.stderr)
            return 4

    print(f"\nWrote {len(written)} golden files to {GOLDEN_DIR}")
    for p in written:
        print(f"  - {p.relative_to(RECODE_IT_ROOT)}  ({p.stat().st_size} bytes)")
    return 0


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--check-signatures",
        action="store_true",
        help="Run only the R-07 source-grep on MHC-L/gate-local/tools/anonymize.py.",
    )
    args = parser.parse_args()

    if args.check_signatures:
        return check_signatures()

    return generate_all_goldens()


if __name__ == "__main__":
    sys.exit(main())
