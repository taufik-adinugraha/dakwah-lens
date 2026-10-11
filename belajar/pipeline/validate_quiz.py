#!/usr/bin/env python3
"""The quiz guard (operator 2026-10-10, narration rule 16: "make sure all questions in quiz already
have lesson beforehand when exploring ayat" — enforced at build time, so it cannot regress).
Standard library only, no network; run from belajar/pipeline:

    python3 validate_quiz.py

Checks (quiz.py has the rules and their reasons):
  1. content/quiz/<slug>.json equals a fresh build_quiz.py run (no hand edits);
  2. every plan's structure: page order, numbering, answers first, distinct options, wrong options
     only from the ayat studied so far, tap words timed, sort words inside their bins, wazn forms
     from the lemma's own table;
  3. for an AUTHORED plan (Al-Fatihah): no two options of one question give the same cause, no
     wrong role option shares a term with the answer (two correct options), no sort over one state,
     and TAUGHT(ayah) ⊇ REQUIRED(question) for every question of every ayah — TAUGHT derived from
     the narration lines the lesson plays before the exercises (content/narration/<slug>.json),
     never a hand list;
  4. the narration has the intro of every exercise and one explanation line per question
     ("<slug>:<ayah>:ex:<key>:<n>:why"), and nothing for an exercise the plan does not have.
Prints the per-ayah quiz and what each ayah teaches. Exit 1 on any failure.
"""
from __future__ import annotations

import json
import re
import sys

import build_quiz as BQ
import quiz as Q
from common import CONTENT_DIR, SURAHS


def narration_problems(content: dict, manifest: dict | None) -> list[str]:
    """Check 4: the plan's lines are in the manifest, and no exercise line is left over."""
    if manifest is None:
        return [f"{content['slug']}: narration manifest missing"]
    slug = content["slug"]
    lines = manifest.get("lines") or {}
    base = {re.sub(r":[a-z]$", "", k) if re.search(r":[a-z]$", k) and not k.endswith(":why") else k for k in lines}
    want = set()
    for a in content["ayat"]:
        for ex in a["exercises"]:
            want.add(f"{slug}:{a['ayah']}:ex:{ex['key']}:intro")
            want |= {f"{slug}:{a['ayah']}:ex:{ex['key']}:{q['n']}:why" for q in ex["questions"]}
    have = {k for k in base if re.match(rf"^{re.escape(slug)}:\d+:ex:[a-z-]+:(?:intro|\d+:why)$", k)}
    return ([f"{slug}: narration line {k} missing (build_narration.py)" for k in sorted(want - have)]
            + [f"{slug}: narration line {k} has no exercise or question in the quiz" for k in sorted(have - want)])


def check(lessons: dict[str, dict], library: dict, terms: Q.Terms, quizzes: dict[str, dict],
          manifests: dict[str, dict], *, fresh: dict[str, dict] | None = None) -> list[str]:
    """Every check above; `fresh`: the quiz files a build produces now (default: built here)."""
    errs: list[str] = []
    if fresh is None:
        try:
            fresh = BQ.build_all(lessons, library, terms)
        except Q.QuizError as e:
            return [f"build_quiz.py fails: {e}"]
    for sp in SURAHS:
        if sp.slug not in lessons:
            continue
        content = quizzes.get(sp.slug)
        if content is None:
            errs.append(f"{sp.slug}: content/quiz/{sp.slug}.json missing (build_quiz.py)")
            continue
        if Q.dump(content) != Q.dump(fresh.get(sp.slug) or {}):
            errs.append(f"{sp.slug}: content/quiz/{sp.slug}.json is out of date with build_quiz.py (rebuild, do not hand-edit)")
        errs += Q.plan_problems(content, lessons[sp.slug], library, terms, manifests.get(sp.slug))
        errs += narration_problems(content, manifests.get(sp.slug))
    return errs


def report(content: dict, lesson: dict, terms: Q.Terms, manifest: dict | None) -> list[str]:
    """The per-ayah quiz as built, and what each ayah teaches (authored plans)."""
    out = []
    taught = Q.taught(manifest, lesson, terms) if (content.get("authored") and manifest) else None
    prev: set[str] = set()
    for a in content["ayat"]:
        n = a["ayah"]
        parts = []
        for ex in a["exercises"]:
            extra = f" bins {'/'.join(ex['bins'])}" if ex.get("bins") else ""
            parts.append(f"{ex['key']} {len(ex['questions'])}{extra}")
        line = f"  {lesson['slug']} {n}: " + (", ".join(parts) or "no exercise")
        if taught is not None:
            new = sorted(set(taught[n]) - prev)
            prev = set(taught[n])
            line += f"\n      taught here: {', '.join(new) or '—'}"
        out.append(line)
    return out


def main() -> int:
    lessons = BQ.load_lessons()
    library = json.loads((CONTENT_DIR / "library.json").read_text(encoding="utf-8"))
    terms = Q.Terms(Q.load_terms())
    quizzes = Q.load_all_content()
    manifests = {sp.slug: json.loads(p.read_text(encoding="utf-8")) for sp in SURAHS
                 if (p := CONTENT_DIR / "narration" / f"{sp.slug}.json").exists()}
    errs = check(lessons, library, terms, quizzes, manifests)
    for sp in SURAHS:
        if sp.slug in quizzes and sp.slug in lessons:
            c = quizzes[sp.slug]
            n_q = sum(len(ex["questions"]) for a in c["ayat"] for ex in a["exercises"])
            kind = "authored, taught-checked" if c.get("authored") else "mechanical (wrong options from the ayat so far), not taught-checked"
            print(f"{sp.slug}: {n_q} questions — {kind}")
            if c.get("authored"):
                print("\n".join(report(c, lessons[sp.slug], terms, manifests.get(sp.slug))))
    if errs:
        print(f"\nFAIL: {len(errs)} problem(s)")
        for e in errs:
            print("  -", e)
        return 1
    print("\nOK: every quiz question was taught before it is asked")
    return 0


if __name__ == "__main__":
    sys.exit(main())
