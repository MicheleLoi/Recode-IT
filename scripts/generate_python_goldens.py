#!/usr/bin/env python3
"""
generate_python_goldens.py — Phase 4 deliverable, scaffolded in Phase 0.

Purpose
-------
Produce the Python golden-output JSON files that Phase 4 of the Recode IT
implementation uses as the equivalence contract for the browser-side TS port.
See IMPLEMENTATION_PLAN.md §Phase 4 and OPEN_RISKS.md R-01 / R-07.

In Phase 0 this script ships as a *stub*: the full golden-generation pipeline is
documented as TODOs and raises NotImplementedError. What IS implemented now is
the R-07 source-grep check (`--check-signatures`), which verifies that the
canonical MHC-L `anonymize.py` still contains the A-1 / A-2 / A-3 fix markers
that DESIGN.md §2.1 and the regression suite depend on. That check is pure
file-reading + regex, so it costs nothing to ship early and protects future
work from silent drift.

Usage
-----
    # R-07 pre-flight (works now, in Phase 0):
    python scripts/generate_python_goldens.py --check-signatures

    # Full golden generation (Phase 4 — raises NotImplementedError today):
    python scripts/generate_python_goldens.py
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths (absolute, Windows-friendly). Adjust MHC_L_ROOT if the sibling repo
# moves; everything else is computed from it.
# ---------------------------------------------------------------------------

MHC_L_ROOT = Path(
    r"C:\Users\loimi\switchdrive\CURRENTLY WORKING ON\AI - assisted papers\MHC-L"
)
ANONYMIZE_PY = MHC_L_ROOT / "gate-local" / "tools" / "anonymize.py"

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
# ---------------------------------------------------------------------------

# Marker patterns derived from DESIGN.md §2.1 (the A-1 / A-2 / A-3 fix table)
# and OPEN_RISKS.md R-07 (the 15-minute pre-flight grep).
SIGNATURE_CHECKS: list[tuple[str, str, str]] = [
    # (fix_id, human_label, regex)
    (
        "A-1",
        "_ITALIAN_ARTICLES referenced in get_person",
        r"_ITALIAN_ARTICLES",
    ),
    (
        "A-1",
        "_surname_map first-write guard (setdefault or 'not in' check)",
        r"_surname_map\.setdefault|if\s+\w+\s+not\s+in\s+self\._surname_map",
    ),
    (
        "A-2",
        "_DE_CUIUS_RE defined",
        r"_DE_CUIUS_RE\s*=",
    ),
    (
        "A-2",
        "mark_skip method present",
        r"def\s+mark_skip\b",
    ),
    (
        "A-2",
        "_skip_set referenced",
        r"_skip_set",
    ),
    (
        "A-3",
        "TITLE_RE elided-article prefix [Ll]['...] (straight or curly apostrophe; \\u2019 escape accepted)",
        r"\[Ll\]\[(?:['’]|'\\u2019|\\u2019')\]",
    ),
    (
        "A-3",
        "Notaio in title alternation",
        r"Notaio",
    ),
]


def check_signatures() -> int:
    """Grep anonymize.py for the A-1/A-2/A-3 fix markers. Return process exit code."""
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
# Phase 4 main loop — stubbed.
# ---------------------------------------------------------------------------


def generate_one_golden(fixture_path: Path) -> None:
    """Run anonymize.py on a single fixture and write the golden JSON."""
    # TODO Phase 4: read fixture text from fixture_path
    # TODO Phase 4: call anonymize() / apply_gliner_with_pseudonyms() with full pipeline
    # TODO Phase 4: serialize {person_map, surname_map, skip_set, collisions,
    #               regex_substitutions, ner_entities, pseudonymized_text,
    #               pipeline_version=anonymize.py@<git-sha>} to GOLDEN_DIR / f"{stem}.json"
    raise NotImplementedError(
        "Phase 4 — see IMPLEMENTATION_PLAN.md §Phase 4 and DESIGN.md §8 for the golden format."
    )


def generate_all_goldens() -> int:
    """Iterate the four canonical fixtures and produce golden JSONs."""
    # TODO Phase 4: sys.path.insert(0, str((MHC_L_ROOT / "gate-local" / "tools").resolve()))
    # TODO Phase 4: from anonymize import anonymize, apply_gliner_with_pseudonyms, ...
    # TODO Phase 4: compute pipeline_version = git rev-parse --short HEAD in MHC-L
    # TODO Phase 4: ensure GOLDEN_DIR exists; for fixture in FIXTURES: generate_one_golden(fixture)
    # TODO Phase 4: in-generator R-07 assertion (DESIGN.md §OPEN_RISKS.md R-07 step 2)
    raise NotImplementedError(
        "Phase 4 — see IMPLEMENTATION_PLAN.md §Phase 4 and OPEN_RISKS.md R-07 step 2."
    )


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--check-signatures",
        action="store_true",
        help="Run only the R-07 source-grep on MHC-L/gate-local/tools/anonymize.py (works in Phase 0).",
    )
    args = parser.parse_args()

    if args.check_signatures:
        return check_signatures()

    return generate_all_goldens()


if __name__ == "__main__":
    sys.exit(main())
