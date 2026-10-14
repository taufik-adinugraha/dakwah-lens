#!/usr/bin/env python3
"""Validator for the cheat sheet (content/rumus.json; rumus.py, build_rumus.py).

    python3 validate_rumus.py               # local: with the pinned pages (pipeline/cache)
    python3 validate_rumus.py --no-corpus   # CI: what the committed files prove

Exit 1 on any failure. Standard library only. What it enforces:

- The authored file (authored/rumus.json): every key is a step of the curriculum; a formula (and its
  awas) is short, in the records' markup with no term form left unmarked, with no Arabic typed and no
  Qur'anic word; every term it uses belongs to a step up to and including its own lesson, or is free
  (the lessons' own rule, curriculum.too_early) — a later one is pointed to with {{di:<step id>}},
  which must name a later step; every step has a `sumber`: a page pinned in sources.json, and per
  sentence a folded anchor of at least three words; a typed `quote` is refused.
- The built file: the steps are the authored ones in the curriculum's teaching order; per source the
  kitab, print page, section and address are the pin's; each quote folds to an authored anchor and,
  locally, is the pinned page's own bytes (found, once, as a run of whole words in the matn, the
  page's sha256 held to the pin); the example is the first word the step occurs on; the pages the
  file was built from are the pins' text hashes; the file equals a fresh build.
Skipped with --no-corpus: the quotes against the pinned pages' text.
"""
from __future__ import annotations

import argparse
import sys

import curriculum as CUR
import rumus as R
import terms as TM
from common import load_sources


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--no-corpus", action="store_true", help="skip the checks that need pipeline/cache (CI)")
    args = ap.parse_args()
    content = R.load_content()
    if content is None:
        print(f"FAIL: missing {R.CONTENT_JSON}; run build_rumus.py")
        return 1
    cur = CUR.load_content()
    if cur is None:
        print("FAIL: content/curriculum.json is missing; run build_curriculum.py")
        return 1
    authored = R.load_authored()
    sources = load_sources()
    table = TM.load_terms()
    lessons = R.load_lessons()
    errs = R.authored_problems(authored, cur, sources, table)
    texts = None
    if not args.no_corpus:
        try:
            texts = R.texts_for(authored, sources)
        except R.RumusError as x:
            errs.append(str(x))
    if not errs or texts is not None or args.no_corpus:
        errs += R.problems(content, authored, cur, lessons, sources, table, texts=texts)
    have = {e["step"] for e in content.get("steps") or [] if isinstance(e, dict)}
    units = {u["id"]: u for u in cur.get("units") or []}
    lesson_unit = {l["id"]: l.get("unit") for l in cur.get("lessons") or []}
    per: dict[str, list[int]] = {}
    for s in cur.get("steps") or []:
        row = per.setdefault(lesson_unit.get(s["lesson"], "?"), [0, 0])
        row[0 if s["id"] in have else 1] += 1
    print(f"{len(have)} of {len(cur.get('steps') or [])} steps have a formula, {sum(len(e.get('sumber') or []) for e in content.get('steps') or [])} "
          f"sources, {sum(len(s.get('quotes') or []) for e in content.get('steps') or [] for s in e.get('sumber') or [])} quotes")
    for uid, (a, b) in per.items():
        print(f"  {(units.get(uid) or {}).get('name', uid):12s} {a} with a formula, {b} without")
    if args.no_corpus:
        print("skipped (no corpus): the quotes against the pinned pages' text")
    if errs:
        print(f"\nFAIL: {len(errs)} problem(s)")
        for e in errs[:200]:
            print("  -", e)
        return 1
    print("\nOK: cheat sheet valid" + (" (corpus-free checks)" if args.no_corpus else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
