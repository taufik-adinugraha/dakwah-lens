#!/usr/bin/env python3
"""Builds content/compose/<slug>.json (word compositions and the harakat primer) from
authored/<slug>.compose.json, the lesson content (content/<slug>.json) and the pinned corpus
(Tanzil Uthmani 1.1, QAC 0.4; sha256-checked). Deterministic, stdlib only, no network, no LLM.
Run from belajar/pipeline (fetch.py first, for pipeline/cache):

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
    failed, differ = False, []
    for slug in C.authored_slugs():
        try:
            content = C.build(slug, lessons, corpus)
        except C.ComposeError as e:
            print(f"{slug}: BUILD FAILED: {e}", file=sys.stderr)
            failed = True
            continue
        errs = C.problems(content, lessons, corpus)
        if errs:
            print(f"{slug}: BUILD FAILED:\n  " + "\n  ".join(errs), file=sys.stderr)
            failed = True
            continue
        path = C.COMPOSE_DIR / f"{slug}.json"
        text = C.dump(content)
        n_lines = sum(len(u["lines"]) for u in content["words"].values()) + len((content["primer"] or {}).get("lines", []))
        if args.check:
            if not path.exists() or path.read_text(encoding="utf-8") != text:
                differ.append(slug)
            continue
        if not path.exists() or path.read_text(encoding="utf-8") != text:
            path.write_text(text, encoding="utf-8")
        print(f"{slug:12s} {len(content['words']):3d} words  primer: {'yes' if content['primer'] else 'no '}  "
              f"{n_lines:3d} lines  -> {path.relative_to(CONTENT_DIR.parent)}")
    if failed:
        return 1
    if args.check:
        if differ:
            print("out of date:", ", ".join(differ))
            return 1
        print("composition files are up to date")
    return 0


if __name__ == "__main__":
    sys.exit(main())
