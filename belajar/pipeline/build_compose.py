#!/usr/bin/env python3
"""Builds content/compose/<slug>.json (word compositions and the harakat primer) from
authored/<slug>.compose.json, the lesson content (content/<slug>.json) and the pinned corpus
(Tanzil Uthmani 1.1, QAC 0.4; sha256-checked) — and, for every bentuk dasar a `base` frame shows,
the imam's voice of it (`examples`: a clip from the pinned quran-align timings, chosen by what is
heard; compose.py "THE IMAM'S VOICE OF A BENTUK DASAR"; content/library.json, built first, gives
the transliteration typed for a word outside the lessons), with fixtures/compose_examples.json:
the ayat of those clips outside the lessons, so CI can check them without the cache.
Deterministic, stdlib only, no network, no LLM.
Run from belajar/pipeline (fetch.py first, for pipeline/cache; after build_library.py and
build_surah.py):

    python3 build_compose.py                  # build every authored/<slug>.compose.json
    python3 build_compose.py --check          # exit 1 if a built file differs from a fresh build
    python3 build_compose.py --show 1:2:1     # a word's pieces (indices for "pieces"/ops) and QAC segments
    python3 build_compose.py --find 2:163:8   # where else in the Qur'an that exact token stands

The format, the stages and every check are described in compose.py; the narration lines
(`say`) become lines of content/narration/<slug>.json in build_narration.py, which runs after
this. A build that breaks a check writes nothing and exits 1.
"""
from __future__ import annotations

import argparse
import json
import sys

import compose as C
from common import CONTENT_DIR, SURAHS


def load_lessons() -> dict[str, dict]:
    return {sp.slug: json.loads((CONTENT_DIR / f"{sp.slug}.json").read_text(encoding="utf-8"))
            for sp in SURAHS if (CONTENT_DIR / f"{sp.slug}.json").exists()}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--check", action="store_true", help="compare with the files on disk; write nothing")
    ap.add_argument("--show", metavar="LOC", help="print a word's pieces and QAC segments")
    ap.add_argument("--find", metavar="LOC", help="print every place the token at LOC stands in the Qur'an")
    args = ap.parse_args()
    corpus = C.Corpus()
    if args.show:
        print(C.show(args.show, corpus))
        return 0
    if args.find:
        tok = corpus.token(args.find)
        print(f"{args.find} {tok}: {', '.join(corpus.attested(tok, 200))}")
        return 0
    lessons = load_lessons()
    C.COMPOSE_DIR.mkdir(parents=True, exist_ok=True)
    failed = False
    try:
        voices = C.Voices.load(lessons)
    except C.ComposeError as e:
        print(f"BUILD FAILED: {e}", file=sys.stderr)
        return 1
    warnings: list[str] = []
    built: dict[str, dict] = {}
    for slug in C.authored_slugs():
        try:
            built[slug] = C.build(slug, lessons, corpus, voices=voices, warnings=warnings)
        except C.ComposeError as e:
            print(f"{slug}: BUILD FAILED: {e}", file=sys.stderr)
            failed = True
    # The example clips' ayat outside the lessons, as the pinned files have them (CI checks the
    # clips against it), then every check: a build that breaks one writes nothing.
    fixture = C.examples_fixture(built, corpus, voices)
    fixture_text = C.CL.fixture_text(fixture)
    for slug, content in built.items():
        errs = C.problems(content, lessons, corpus, voices=voices, fixture=fixture)
        if errs:
            print(f"{slug}: BUILD FAILED:\n  " + "\n  ".join(errs), file=sys.stderr)
            failed = True
    verrs, vwarns = C.voice_problems(built, lessons, corpus, fixture, voices)
    for w in [*warnings, *vwarns]:
        print("WARN  " + w)
    if verrs:
        print("BUILD FAILED:\n  " + "\n  ".join(verrs), file=sys.stderr)
        failed = True
    if failed:
        return 1
    stale = lambda path, text: not path.exists() or path.read_text(encoding="utf-8") != text  # noqa: E731
    differ = [slug for slug, content in built.items() if stale(C.COMPOSE_DIR / f"{slug}.json", C.dump(content))]
    if stale(C.EXAMPLES_FIXTURE, fixture_text):
        differ.append(f"fixtures/{C.EXAMPLES_FIXTURE.name}")
    if args.check:
        if differ:
            print("out of date:", ", ".join(differ))
            return 1
        print("composition files are up to date")
        return 0
    for slug, content in built.items():
        path = C.COMPOSE_DIR / f"{slug}.json"
        if stale(path, C.dump(content)):
            path.write_text(C.dump(content), encoding="utf-8")
        n_lines = sum(len(u["lines"]) for u in content["words"].values()) + len((content["primer"] or {}).get("lines", []))
        voiced = sum(1 for rows in content["examples"].values() for e in rows if "clip" in e)
        n_base = sum(len(rows) for rows in content["examples"].values())
        print(f"{slug:12s} {len(content['words']):3d} words  primer: {'yes' if content['primer'] else 'no '}  "
              f"{n_lines:3d} lines  {voiced} of {n_base} bentuk dasar voiced  -> {path.relative_to(CONTENT_DIR.parent)}")
    if stale(C.EXAMPLES_FIXTURE, fixture_text):
        C.EXAMPLES_FIXTURE.parent.mkdir(parents=True, exist_ok=True)
        C.EXAMPLES_FIXTURE.write_text(fixture_text, encoding="utf-8")
    for line in C.example_summary(built):
        print("  " + line)
    return 0

if __name__ == "__main__":
    sys.exit(main())
