#!/usr/bin/env python3
"""Builds content/rumus.json — the cheat sheet "Rumus singkat": a short formula per step of the basic
curriculum, each with the kitab sentences it restates, an example word and, where the kitab states
one, its limit (rumus.py has the format and the rules). Run from belajar/pipeline, after
build_curriculum.py and build_surah.py:

    python3 build_rumus.py                      # write content/rumus.json (needs pipeline/cache)
    python3 build_rumus.py --check              # exit 1 if the file differs from a fresh build (needs pipeline/cache)
    python3 build_rumus.py --check --no-corpus  # CI: the same, the quotes taken from the file itself
                                                # (each must fold to its authored anchor)
    python3 build_rumus.py --show               # print the sheet as built

Deterministic, stdlib only, no network, no LLM. A gap (an anchor not found in its page, a term before
its lesson, a page that is not pinned) writes nothing and exits 1.
"""
from __future__ import annotations

import argparse
import sys

import curriculum as CUR
import rumus as R
import terms as TM
from common import load_sources


def show(content: dict) -> None:
    for e in content["steps"]:
        print(f"{e['step']:24s} ({e['lesson']})  {TM.strip(e['rumus'])}")
        if e.get("awas"):
            print(f"{'':24s}   awas: {TM.strip(e['awas'])}")
        if e.get("example"):
            print(f"{'':24s}   contoh: {e['example']['loc']}")
        for s in e["sumber"]:
            print(f"{'':24s}   hlm. {s['hlm']} ({s['page']}): " + "  |  ".join(s["quotes"]))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--check", action="store_true", help="compare with the file on disk; write nothing")
    ap.add_argument("--no-corpus", action="store_true", help="with --check: take the quotes from the file (CI)")
    ap.add_argument("--show", action="store_true", help="print the built sheet")
    args = ap.parse_args()
    if args.no_corpus and not args.check:
        ap.error("--no-corpus goes with --check (writing the file needs the pinned pages)")
    cur = CUR.load_content()
    if cur is None:
        print("content/curriculum.json is missing: run build_curriculum.py first", file=sys.stderr)
        return 1
    authored = R.load_authored()
    sources = load_sources()
    table = TM.load_terms()
    lessons = R.load_lessons()
    on_disk = R.load_content()
    try:
        texts = None if args.no_corpus else R.texts_for(authored, sources)
        content = R.build(authored, cur, lessons, sources, table, texts=texts, previous=on_disk)
    except R.RumusError as err:
        print(f"BUILD FAILED: {err}", file=sys.stderr)
        return 1
    if args.show:
        show(content)
        return 0
    text = R.dump(content)
    if args.check:
        if on_disk is None or R.dump(on_disk) != text or R.CONTENT_JSON.read_text(encoding="utf-8") != text:
            print("out of date: content/rumus.json (run build_rumus.py)", file=sys.stderr)
            return 1
        print(f"content/rumus.json is up to date ({len(content['steps'])} steps)"
              + ("; skipped (no corpus): the quotes against the pinned pages" if args.no_corpus else ""))
        return 0
    if not R.CONTENT_JSON.exists() or R.CONTENT_JSON.read_text(encoding="utf-8") != text:
        R.CONTENT_JSON.write_text(text, encoding="utf-8")
    pages = content["data_versions"]["pages"]
    print(f"rumus        {len(content['steps']):3d} steps, {sum(len(s['quotes']) for e in content['steps'] for s in e['sumber'])} quotes "
          f"from {len(pages)} pages -> {R.CONTENT_JSON.relative_to(R.CONTENT_DIR.parent)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
