#!/usr/bin/env python3
"""Validator for the word compositions and the harakat primer (content/compose/<slug>.json).

    python3 validate_compose.py               # local: with the pinned corpus (pipeline/cache)
    python3 validate_compose.py --no-corpus   # CI: what the content and the lesson files prove

Exit 1 on any failure. Standard library only. What it enforces (compose.py has the format):

- Every Arabic byte on the stage is sourced. A form's `ar` equals what its source gives: a lesson
  word or a slice of it in whole pieces (content/<slug>.json, itself Tanzil-verified by
  validate.py), a Tanzil token or a QAC segment (local only), or a deterministic edit of another
  form (replayed in both modes: a vowel swapped, a mark taken off or put on, a piece dropped,
  parts written together). Locally, `attested` (where the form stands as a token in the Qur'an)
  is recomputed.
- The stages say what they show: `parts` has two or more parts (locally: QAC's segments of the
  word, letter for letter); `base` rings a tile that ends in a vowel; `change` changes exactly one
  vowel mark of one piece; `join` writes the parts' letters as one tile; `drop` leaves pieces out;
  the primer's `mark` frames show an example carrying each mark, taken from the ayah itself when
  it is a slice of a lesson word. The last frame of a word shows the word exactly as the ayah
  writes it. The cut pieces (chips) and the primer's highlighted words equal a fresh cut.
- Every frame is narrated, lines follow the frames in order, sources are ≥1 SourceRef, status
  draft, Indonesian notes/labels without Arabic script.
- The content is current: built from the authored file whose sha256 it records (both modes), and,
  locally, equal to a fresh build_compose.py run.

The narration lines themselves (what the narrator may say) are checked with every other line by
validate_narration.py.
"""
from __future__ import annotations

import argparse
import json
import sys

import compose as C
from build_compose import load_lessons
from common import AUTHORED_DIR, SURAH_BY_SLUG, sha256_file


def check(contents: dict[str, dict], lessons: dict[str, dict], corpus: C.Corpus | None,
          authored: dict[str, str] | None = None) -> list[str]:
    """`contents`: slug → built file; `authored`: slug → the authored file's sha256 (default: disk)."""
    errs: list[str] = []
    if authored is None:
        authored = {s: sha256_file(AUTHORED_DIR / f"{s}.compose.json") for s in C.authored_slugs()}
    for slug in sorted(set(authored) - set(contents)):
        errs.append(f"compose/{slug}: authored/{slug}.compose.json has no built file (run build_compose.py)")
    for slug, content in contents.items():
        if slug not in SURAH_BY_SLUG:
            errs.append(f"compose/{slug}: not a lesson surah")
            continue
        errs += C.problems(content, lessons, corpus)
        dv = (content.get("data_versions") or {}).get("authored_compose", "") if isinstance(content, dict) else ""
        if slug not in authored:
            errs.append(f"compose/{slug}: no authored/{slug}.compose.json behind it")
        elif not dv.endswith(f"sha256:{authored[slug]}"):
            errs.append(f"compose/{slug}: built from another version of authored/{slug}.compose.json (rebuild: "
                        "build_compose.py)")
        if corpus is not None and slug in authored:
            try:
                fresh = C.build(slug, lessons, corpus)
            except C.ComposeError as e:
                errs.append(f"compose/{slug}: build fails: {e}")
                continue
            if C.dump(fresh) != C.dump(content):
                errs.append(f"compose/{slug}: differs from a fresh build_compose.py run (rebuild, do not hand-edit)")
    return errs


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--no-corpus", action="store_true", help="skip the checks that need pipeline/cache (CI)")
    args = ap.parse_args()
    corpus = None if args.no_corpus else C.Corpus()
    contents = C.load_all_content()
    errs = check(contents, load_lessons(), corpus)
    for slug, c in contents.items():
        n = len(c.get("words") or {})
        lines = sum(len(u.get("lines") or []) for u in (c.get("words") or {}).values()) + len((c.get("primer") or {}).get("lines") or [])
        print(f"{slug:12s} {n:3d} compositions  primer: {'yes' if c.get('primer') else 'no '}  {lines:3d} narration lines")
    if args.no_corpus:
        print("skipped (no corpus): Tanzil/QAC bytes of tanzil/qac forms, attestations, parts against QAC segments, "
              "equality with a fresh build")
    if errs:
        print(f"\nFAIL: {len(errs)} problem(s)")
        for e in errs:
            print("  -", e)
        return 1
    print("\nOK: compositions valid" + (" (corpus-free checks)" if args.no_corpus else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
