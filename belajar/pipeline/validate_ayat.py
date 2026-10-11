#!/usr/bin/env python3
"""Validator for the fact cards' ayah popup data (content/ayat/locations.json; ayat.py, build_ayat.py).

    python3 validate_ayat.py               # local: with the pinned corpus (pipeline/cache)
    python3 validate_ayat.py --no-corpus   # CI: what the committed files prove

Exit 1 on any failure. Standard library only. What it enforces:

- Coverage, both ways: every location of every fact in every lesson file (all of common.SURAHS,
  hidden ones included) has exactly one entry, in mushaf order, and there is no entry no fact
  locates.
- Arabic: Arabic script in single-spaced words; locally, the Tanzil Uthmani 1.1 line byte for byte,
  its surah-heading basmalah sliced off exactly as the lessons do (common.lesson_ayah).
- Translation: footnote markers in the text = the footnotes' markers, each footnote starting with
  its own; locally, `text` byte-identical to QuranEnc's and `footnotes` QuranEnc's field verbatim,
  in order, split as the lessons split it. The credit is QuranEnc's title and version
  (sources.json), never "Kemenag 2019".
- The same rendering as a lesson: an ayah that has a lesson (content/<slug>.json, itself checked
  against the corpus by validate.py) has the same Arabic, translation, footnotes and credit here.
- Names: one per sura with an entry; a lesson's name_id; every "<name> (<surah>:<ayah>)" the facts
  write is the popup's name; locally, QuranEnc's list folded (ayat.WRITTEN / name_id excepted),
  its ayah counts equal to Tanzil's.
- Provenance: sura_files and data_versions are sources.json's pins; the entries hash is the
  entries' (a hand edit shows without the corpus); locally, the file equals a fresh build.
"""
from __future__ import annotations

import argparse
import sys

import ayat as AY
from common import load_sources


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--no-corpus", action="store_true", help="skip the checks that need pipeline/cache (CI)")
    args = ap.parse_args()
    content = AY.load_content()
    if content is None:
        print(f"FAIL: missing {AY.AYAT_FILE}; run build_ayat.py")
        return 1
    lessons = AY.load_lessons()
    corpus = None
    if not args.no_corpus:
        corpus = AY.load_corpus({p[0] for p in map(AY.parse_loc, [e.get("loc") for e in content.get("ayat") or []]) if p})
    errs = AY.problems(content, lessons, load_sources(), corpus)
    entries = content.get("ayat") or []
    n_fn = sum(1 for e in entries if isinstance(e, dict) and (e.get("translation") or {}).get("footnotes"))
    in_lessons = {a["loc"] for L in lessons.values() for a in L.get("ayat", [])}
    print(f"{len(entries)} ayat in {len(content.get('names') or {})} suras, {n_fn} with footnotes; "
          f"{len(in_lessons & {e.get('loc') for e in entries if isinstance(e, dict)})} also lesson ayat (compared byte for byte)")
    if args.no_corpus:
        print("skipped (no corpus): Tanzil's bytes, QuranEnc's text and footnotes, the sura list, equality with a fresh build")
    if errs:
        print(f"\nFAIL: {len(errs)} problem(s)")
        for e in errs[:200]:
            print("  -", e)
        return 1
    print("\nOK: ayat popup data valid" + (" (corpus-free checks)" if args.no_corpus else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
