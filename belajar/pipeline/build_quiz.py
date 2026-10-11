#!/usr/bin/env python3
"""Builds content/quiz/<slug>.json for every lesson surah — the questions each ayah's exercises
ask, with their answers and wrong options (quiz.py has the format and the rules) — from
authored/<slug>.quiz.json where one exists (Al-Fatihah: taught before tested, operator
2026-10-10, narration rule 16), else the mechanical plan (the components' old rules, wrong
options only from the ayat studied so far). Deterministic, stdlib only, no network. Run from
belajar/pipeline, before build_narration.py (whose exercise intros and explanation lines read it):

    python3 build_quiz.py            # write content/quiz/*.json
    python3 build_quiz.py --check    # exit 1 if a file on disk differs from a fresh build
    python3 build_quiz.py --show al-fatihah 2   # print one ayah's questions

A plan that breaks a rule of quiz.plan_problems (all but the taught check, which needs the
narration and runs in validate_quiz.py) writes nothing and exits 1.
"""
from __future__ import annotations

import argparse
import json
import sys

import quiz as Q
from common import CONTENT_DIR, SURAHS


def load_lessons() -> dict[str, dict]:
    return {sp.slug: json.loads((CONTENT_DIR / f"{sp.slug}.json").read_text(encoding="utf-8"))
            for sp in SURAHS if (CONTENT_DIR / f"{sp.slug}.json").exists()}


def build_all(lessons: dict[str, dict], library: dict, terms: Q.Terms,
              authored: dict[str, dict | None] | None = None) -> dict[str, dict]:
    """slug → content/quiz/<slug>.json. `authored`: the plans by slug (default: from disk)."""
    out = {}
    for sp in SURAHS:
        if sp.slug not in lessons:
            continue
        plan = (authored or {}).get(sp.slug) if authored is not None else Q.load_authored(sp.slug)
        out[sp.slug] = Q.build(lessons[sp.slug], library, terms, plan)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--check", action="store_true", help="compare with the files on disk; write nothing")
    ap.add_argument("--show", nargs=2, metavar=("SLUG", "AYAH"), help="print one ayah's questions")
    args = ap.parse_args()
    lessons = load_lessons()
    library = json.loads((CONTENT_DIR / "library.json").read_text(encoding="utf-8"))
    terms = Q.Terms(Q.load_terms())
    try:
        built = build_all(lessons, library, terms)
    except Q.QuizError as e:
        print(f"BUILD FAILED: {e}", file=sys.stderr)
        return 1
    if args.show:
        slug, n = args.show[0], int(args.show[1])
        for ex in Q.ayah_plan(built.get(slug), n):
            print(f"{ex['key']}" + (f"  bins {ex['bins']}" if "bins" in ex else ""))
            for q in ex["questions"]:
                print(f"  {json.dumps(q, ensure_ascii=False)}")
        return 0
    failed = False
    for slug, content in built.items():
        errs = Q.plan_problems(content, lessons[slug], library, terms, None)
        if errs:
            print(f"{slug}: BUILD FAILED:\n  " + "\n  ".join(errs), file=sys.stderr)
            failed = True
    if failed:
        return 1
    Q.QUIZ_DIR.mkdir(parents=True, exist_ok=True)
    differ = []
    for slug, content in built.items():
        path = Q.QUIZ_DIR / f"{slug}.json"
        text = Q.dump(content)
        n_q = sum(len(ex["questions"]) for a in content["ayat"] for ex in a["exercises"])
        n_ex = sum(len(a["exercises"]) for a in content["ayat"])
        if args.check:
            if not path.exists() or path.read_text(encoding="utf-8") != text:
                differ.append(slug)
            continue
        if not path.exists() or path.read_text(encoding="utf-8") != text:
            path.write_text(text, encoding="utf-8")
        kind = "authored" if content["authored"] else "mechanical"
        print(f"{slug:12s} {kind:10s} {n_ex:3d} exercises {n_q:4d} questions  -> {path.relative_to(CONTENT_DIR.parent)}")
    if args.check:
        if differ:
            print("out of date:", ", ".join(differ))
            return 1
        print("quiz files are up to date")
    return 0


if __name__ == "__main__":
    sys.exit(main())
