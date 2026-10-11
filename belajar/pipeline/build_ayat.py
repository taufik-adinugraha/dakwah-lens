#!/usr/bin/env python3
"""Builds content/ayat/locations.json: every ayah a "Tahukah Anda?" fact card locates, for the
popup its location chip opens (operator 2026-10-12: Arabic + translation + the imam's recitation,
instead of quran.com in a new tab or app). ayat.py has the format and the rules. Run from
belajar/pipeline after fetch.py, and again whenever a fact's locations change:

    python3 build_ayat.py                     # write content/ayat/locations.json
    python3 build_ayat.py --check             # exit 1 if the file differs from a fresh build (needs pipeline/cache)
    python3 build_ayat.py --check --no-corpus # CI: exit 1 unless the file still covers exactly the facts'
                                              # locations with sources.json's pins (no cache needed)

Deterministic, stdlib only, no network, no LLM. A gap (a location that is no ayah, a sura not
fetched, QuranEnc footnote markers that do not match) writes nothing and exits 1.
"""
from __future__ import annotations

import argparse
import sys

import ayat as AY
from common import load_sources


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--check", action="store_true", help="compare with the file on disk; write nothing")
    ap.add_argument("--no-corpus", action="store_true", help="with --check: only what the committed files prove (CI)")
    args = ap.parse_args()
    if args.no_corpus and not args.check:
        ap.error("--no-corpus goes with --check (writing the file needs the corpus)")
    lessons = AY.load_lessons()
    on_disk = AY.load_content()
    if args.check and args.no_corpus:
        if on_disk is None:
            print(f"missing {AY.AYAT_FILE.relative_to(AY.CONTENT_DIR.parent)}; run build_ayat.py", file=sys.stderr)
            return 1
        errs = AY.currency_problems(on_disk, lessons, load_sources())
        if errs:
            print("out of date:\n  " + "\n  ".join(errs), file=sys.stderr)
            return 1
        print(f"content/ayat/locations.json is up to date with the facts ({len(on_disk['ayat'])} ayat) "
              "and sources.json; skipped (no corpus): equality with a fresh build")
        return 0
    try:
        cited = AY.fact_locations(lessons)
        corpus = AY.load_corpus({AY.parse_loc(loc)[0] for loc in cited})
        content = AY.build(lessons, corpus)
    except AY.AyatError as err:
        print(f"BUILD FAILED: {err}", file=sys.stderr)
        return 1
    text = AY.dump(content)
    if args.check:
        if on_disk is None or AY.dump(on_disk) != text or AY.AYAT_FILE.read_text(encoding="utf-8") != text:
            print("out of date: content/ayat/locations.json (run build_ayat.py)", file=sys.stderr)
            return 1
        print(f"content/ayat/locations.json is up to date ({len(content['ayat'])} ayat)")
        return 0
    AY.AYAT_DIR.mkdir(parents=True, exist_ok=True)
    if not AY.AYAT_FILE.exists() or AY.AYAT_FILE.read_text(encoding="utf-8") != text:
        AY.AYAT_FILE.write_text(text, encoding="utf-8")
    n_fn = sum(1 for e in content["ayat"] if e["translation"]["footnotes"])
    print(f"{len(content['ayat'])} ayat in {len(content['names'])} suras ({n_fn} with QuranEnc footnotes), "
          f"{len(text.encode('utf-8')):,} bytes -> {AY.AYAT_FILE.relative_to(AY.CONTENT_DIR.parent)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
