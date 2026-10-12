#!/usr/bin/env python3
"""The imam's voice of every example the static library pages show: content/library.json `clips`
(operator, 2026-10-12: "each explanation should be followed by examples (visual + voice)", "not
only for harakah, but also for all rules"; built by build_library.py, rules in clips.py).
Standard library only; no network.

    python3 validate_clips.py              # local: with pipeline/cache (quran-align, Tanzil)
    python3 validate_clips.py --no-corpus  # CI (pipeline/cache is git-ignored): every check that
                                           # needs no cache; the skipped ones are named in the OK line

Checks (clips.problems)
  1. Every concept example, every Harakat sign's word, every parts diagram's word and each of its
     whole-word tiles has a clip; no clip is for anything else; keys in mushaf order.
  2. Each clip: url = Alafasy_128kbps's EveryAyah file of that ayah; start, end integers,
     0 ≤ start < end; length 150 ms–4 s a word (up to 7 s for a lesson ayah's last word, where the
     imam holds the madd at the pause).
  3. A lesson ayah's clip is the lesson's own Alafasy timing of that word (url and segment), and the
     lesson word at that index is the word the page shows (its loc; its bytes = library `quran`).
  4. data_versions.quran_align pins the Alafasy quran-align member of sources.json.
  With the cache:
  5. every clip equals a fresh one from the pinned quran-align file, whose single-word segments
     cover that ayah's Tanzil tokens exactly once (word index = token index);
  6. the Tanzil token(s) at the clip's index are the Arabic the page shows for that example.
The OK line counts the clips and lists the examples shown without one (a part of a word, a QAC
segment, is never recited on its own). Exit 1 on any failure.
"""
from __future__ import annotations

import json
import sys

import clips as C
from common import CONTENT_DIR, SOURCES_JSON, SURAHS, load_tanzil, require_pinned

# Paths the checks read; test_validate_clips.py points them at temporary copies.
LIBRARY = CONTENT_DIR / "library.json"
LESSON_DIR = CONTENT_DIR
SOURCES = SOURCES_JSON


def main(no_corpus: bool | None = None) -> int:
    if no_corpus is None:
        no_corpus = "--no-corpus" in sys.argv[1:]
    if not LIBRARY.exists():
        print(f"missing {LIBRARY}; run build_library.py", file=sys.stderr)
        return 1
    lib = json.loads(LIBRARY.read_text(encoding="utf-8"))
    lessons = {}
    for spec in SURAHS:
        p = LESSON_DIR / f"{spec.slug}.json"
        if p.exists():
            lessons[spec.slug] = json.loads(p.read_text(encoding="utf-8"))
    src = json.loads(SOURCES.read_text(encoding="utf-8"))
    align = T = None
    if not no_corpus:
        align, why = C.load_alignment(src)
        if align is None:
            print(f"VALIDATION FAILED:\n  - {why}", file=sys.stderr)
            return 1
        T = load_tanzil(require_pinned(src, "tanzil_uthmani"))
    errs, warns = C.problems(lib, lessons, src, align, T)
    for w in warns:
        print("WARN  " + w)
    if errs:
        print("VALIDATION FAILED:", file=sys.stderr)
        for e in errs:
            print("  - " + e, file=sys.stderr)
        return 1
    clips = lib["clips"]
    want = C.wanted(lib)
    n = {k: sum(1 for _, where in want if where.startswith(k)) for k in ("concepts", "basics", "parts")}
    ayat = {C.parse_key(k)[:2] for k in clips}
    print(f"OK: {len(clips)} clips ({len(ayat)} ayat) voice {n['concepts']} concept examples, {n['basics']} Harakat "
          f"signs and {n['parts']} parts-diagram words and tiles; Alafasy_128kbps, quran-align pinned; "
          f"lesson clips = the lessons' own timings"
          + ("" if no_corpus else "; every clip = a fresh build, its Tanzil token(s) = the bytes the page shows")
          + (".  Skipped without the cache: the fresh build and the Tanzil tokens." if no_corpus else "."))
    for where, ref, why in C.unvoiced(lib):
        print(f"  shown without a clip: {where} {ref}: {why}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
