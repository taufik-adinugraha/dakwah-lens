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
     0 ≤ start < end; `last` absent or true; length 150 ms–4 s a word, up to 7 s for an ayah's
     last word, where the imam holds the madd at the pause (a run: the sum of its words' caps).
  3. A lesson ayah's clip is the lesson's own Alafasy timing of that word (url and segment), `last`
     is the lessons' word count, and the lesson word at that index is the word the page shows (its
     loc; its bytes = library `quran`).
  4. An ayah without a lesson (a bentuk dasar tile, a sign's word): the clip is the one the
     committed fixture gives (fixtures/clips_outside_lessons.json: those ayat's Tanzil lines and
     quran-align entries), its `last` is the fixture line's word count, and every word, run and
     letter the library resolves there is the fixture's bytes. The fixture holds exactly those
     ayat, under the pins of sources.json.
  5. What is HEARD (clips.py; review 2026-10-12): a Harakat sign on its word's last letter never
     uses an ayah's last word, and a tanwin's word is followed in its ayah by an izhar letter
     (ء ه ع ح غ خ); a base-form tile that starts with hamzat washal mid-ayah plays the run with
     the word before it and ships the heard form (`washal`, exactly as derived), and is never an
     ayah's last word; every clip that ends its ayah has an ending the page's waqf note can
     describe (a short vowel or tanwin that is dropped, or nothing dropped).
  6. data_versions.quran_align pins the Alafasy quran-align member of sources.json.
  With the cache:
  7. every clip equals a fresh one from the pinned quran-align file, whose single-word segments
     cover that ayah's Tanzil tokens exactly once (word index = token index);
  8. the Tanzil token(s) at the clip's index are the Arabic the page shows for that example;
  9. the fixture equals the pinned Tanzil lines and quran-align entries.
The OK line counts the clips, those that end their ayah (with the waqf note, and without: nothing
is dropped there) and the tiles played with the word before them, and lists the examples shown
without a clip (a part of a word, a QAC segment, is never recited on its own). Exit 1 on any
failure.
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
FIXTURE = C.FIXTURE


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
    fixture = None
    if FIXTURE.exists():
        try:
            fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
        except ValueError:
            fixture = None
    align = T = None
    if not no_corpus:
        align, why = C.load_alignment(src)
        if align is None:
            print(f"VALIDATION FAILED:\n  - {why}", file=sys.stderr)
            return 1
        T = load_tanzil(require_pinned(src, "tanzil_uthmani"))
    errs, warns = C.problems(lib, lessons, src, align, T, fixture)
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
    last = [k for k, c in clips.items() if c.get("last")]
    drop = {k: C.pause_drop((C.shown_bytes(k, lib, lessons) or "").split(" ")[-1]) for k in last}
    quiet = [k for k in last if drop[k] == "none"]
    rows = [x["loc"] for c in lib.get("concepts", []) for x in c.get("examples", [])]
    rows_last = [loc for loc in rows if loc in drop]
    washal = [(t["washal"]["run"], t["washal"]["heard"]) for p in lib.get("parts", []) for t in p.get("tiles", [])
              if t.get("washal")]
    outside = C.outside_ayat(clips)
    print(f"OK: {len(clips)} clips ({len(ayat)} ayat) voice {n['concepts']} concept examples, {n['basics']} Harakat "
          f"signs and {n['parts']} parts-diagram words and tiles; Alafasy_128kbps, quran-align pinned; "
          f"lesson clips = the lessons' own timings; the {len(outside)} ayat outside the lessons "
          f"({', '.join(f'{s}:{a}' for s, a in outside)}) = {FIXTURE.name}"
          + ("" if no_corpus else "; every clip = a fresh build, its Tanzil token(s) = the bytes the page shows, "
                                  "the fixture = the pinned files")
          + (".  Skipped without the cache: the fresh build, the Tanzil tokens and the fixture against the "
             "pinned files." if no_corpus else "."))
    print(f"  heard: {len(last)} clips end their ayah (waqf) — {len(last) - len(quiet)} with a final harakah or "
          f"tanwin that is not pronounced there (the page's note), {len(quiet)} with nothing to drop "
          f"({', '.join(quiet) or '-'}); {len(rows_last)} of {len(rows)} concept example rows are such words, "
          f"{sum(1 for loc in rows_last if drop[loc] == 'harakat')} with the note; every Harakat sign is heard "
          f"where its example is; {len(washal)} base-form tile(s) start with hamzat washal mid-ayah and play the "
          f"run with the word before: {', '.join(f'{run} “{heard}”' for run, heard in washal) or '-'}.")
    for where, ref, why in C.unvoiced(lib):
        print(f"  shown without a clip: {where} {ref}: {why}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
