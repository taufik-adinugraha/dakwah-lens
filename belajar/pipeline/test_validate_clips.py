#!/usr/bin/env python3
"""Mutation tests for validate_clips.py (the imam's voice of every Konsep example; operator
2026-10-12: "each explanation should be followed by examples (visual + voice)"). Each case plants
one fault in a copy of content/library.json, a lesson file or sources.json and asserts
validate_clips.py fails with the expected message; the unmutated copies must pass. Plus unit
checks of the clip keys (clips.key_of), the last-word rule and the examples shown without a clip.
Standard library only; run from belajar/pipeline after build_library.py:

    python3 test_validate_clips.py              # table of faults and the message that caught each
    python3 test_validate_clips.py --no-corpus  # CI: the faults only the cache can catch
                                                # (NEEDS_CORPUS) are listed as skipped, by name
    python3 -m unittest test_validate_clips     # the same as a unittest run (CLIPS_NO_CORPUS=1 for CI)
"""
from __future__ import annotations

import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

import clips as C
import validate_clips as V

NO_CORPUS = "--no-corpus" in sys.argv[1:] or os.environ.get("CLIPS_NO_CORPUS") == "1"
# Faults in an ayah without a lesson (QS 55:78, the bentuk dasar ٱسْمُ): only quran-align and
# Tanzil can tell (CI checks the lesson ayat against the lessons' own timings).
NEEDS_CORPUS = {"tile-clip-next-word", "tile-bytes-another-token", "tile-clip-other-ayah-file"}


def concept(d, cid):
    return next(c for c in d["concepts"] if c["id"] == cid)


def shift(d, key, to):
    """Clip `key` given the timing of clip `to` (the next word of the same ayah)."""
    d["clips"][key].update(start=d["clips"][to]["start"], end=d["clips"][to]["end"])


def reorder(d):
    items = list(d["clips"].items())
    d["clips"] = dict(items[1:2] + items[:1] + items[2:])


# (name, file, mutate(data), expected message fragment)
CASES = [
    # --- 1. coverage: every example has a voice, nothing else does
    ("example-without-clip", "library", lambda d: d["clips"].pop("1:1:2"), "has no clip (an example with no voice"),
    ("new-example-without-clip", "library",
     lambda d: concept(d, "idhafah")["examples"].append({"loc": "113:3:2", "note": "contoh baru tanpa suara"}),
     "113:3:2 has no clip"),
    ("sign-word-without-clip", "library", lambda d: d["clips"].pop("1:5:2"), "basics[harakat].signs[0]: 1:5:2 has no clip"),
    ("parts-word-without-clip", "library", lambda d: d["clips"].pop("113:1:3"), "parts[113:1:3].word: 113:1:3 has no clip"),
    ("parts-tile-without-clip", "library", lambda d: d["clips"].pop("55:78:2"), "parts[1:1:1].tiles[1]: 55:78:2 has no clip"),
    ("unwanted-clip", "library",
     lambda d: d["clips"].__setitem__("2:255:1", {"url": "https://everyayah.com/data/Alafasy_128kbps/002255.mp3",
                                                  "start": 0, "end": 900}),
     "no page shows this example"),
    ("keys-out-of-order", "library", reorder, "not in mushaf order"),
    ("malformed-key", "library",
     lambda d: d["clips"].__setitem__("1:1", d["clips"]["1:1:1"]), "key must be s:a:w"),
    # --- 2. each clip
    ("url-of-another-ayah", "library",
     lambda d: d["clips"]["1:1:2"].update(url="https://everyayah.com/data/Alafasy_128kbps/001002.mp3"),
     "is not Alafasy_128kbps's file of 1:1"),
    ("url-of-another-reciter", "library",
     lambda d: d["clips"]["1:1:2"].update(url="https://everyayah.com/data/Husary_Muallim_128kbps/001001.mp3"),
     "is not Alafasy_128kbps's file of 1:1"),
    ("url-of-another-host", "library",
     lambda d: d["clips"]["1:1:2"].update(url="https://example.com/data/Alafasy_128kbps/001001.mp3"),
     "is not Alafasy_128kbps's file of 1:1"),
    ("start-after-end", "library", lambda d: d["clips"]["1:1:2"].update(start=1400), "must be ≥ 0 and before end"),
    ("negative-start", "library", lambda d: d["clips"]["1:1:2"].update(start=-10), "must be ≥ 0 and before end"),
    ("float-timing", "library", lambda d: d["clips"]["1:1:2"].update(start=620.5), "must be integers"),
    ("too-short", "library", lambda d: d["clips"]["1:1:2"].update(end=700), "not a plausible length"),
    ("too-long-mid-ayah", "library", lambda d: d["clips"]["1:1:2"].update(end=5000), "not a plausible length"),
    ("too-long-last-word", "library", lambda d: d["clips"]["1:7:9"].update(end=d["clips"]["1:7:9"]["start"] + 7200),
     "the ayah’s last word"),
    ("extra-field", "library", lambda d: d["clips"]["1:1:2"].update(reciter="Alafasy_128kbps"),
     "must be exactly {url, start, end}"),
    # --- 3. a lesson ayah: the lesson's own timing, the lesson's word
    ("lesson-clip-next-word", "library", lambda d: shift(d, "1:1:2", "1:1:3"), "is not the lesson's timing of word(s) 2..2 of 1:1"),
    ("lesson-clip-off-by-10ms", "library", lambda d: d["clips"]["112:1:3"].update(end=d["clips"]["112:1:3"]["end"] + 10),
     "is not the lesson's timing"),
    ("lesson-segment-drifted", "lesson",
     lambda d: d["ayat"][0]["recitation"][1]["segments"][1].__setitem__(1, 700),
     "is not the lesson's timing of word(s) 2..2 of 1:1"),
    ("lesson-has-no-alafasy", "lesson", lambda d: d["ayat"][0]["recitation"].pop(1),
     "has no Alafasy_128kbps recitation entry"),
    ("page-bytes-not-the-lesson-word", "library",
     lambda d: d["quran"].__setitem__("1:1:1", d["quran"]["1:1:2"]),
     "the page shows"),
    # --- 4. the pin
    ("stale-quran-align-pin", "library",
     lambda d: d["data_versions"].__setitem__("quran_align", "release-2016-11-24 Alafasy_128kbps.json sha256:0000"),
     "does not pin Alafasy_128kbps.json"),
    ("no-quran-align-pin", "library", lambda d: d["data_versions"].pop("quran_align"), "does not pin Alafasy_128kbps.json"),
    # --- 5–6. with the cache: an ayah without a lesson (QS 55:78, ٱسْمُ the bentuk dasar of bismi)
    ("tile-clip-next-word", "library", lambda d: d["clips"]["55:78:2"].update(start=1500, end=2400),
     "differs from a fresh build from quran-align"),
    ("tile-clip-other-ayah-file", "library",
     lambda d: d["clips"]["55:78:2"].update(url="https://everyayah.com/data/Alafasy_128kbps/055077.mp3"),
     "differs from a fresh build"),
    ("tile-bytes-another-token", "library", lambda d: d["quran"].__setitem__("55:78:2", d["quran"]["1:1:1"]),
     "but the Tanzil token(s) at the clip's index are"),
]


@contextlib.contextmanager
def sandbox(kind: str | None = None, mutate=None):
    """Copies of everything validate_clips reads, with one file mutated; module paths redirected."""
    saved = {k: getattr(V, k) for k in ("LIBRARY", "LESSON_DIR", "SOURCES")}
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        (t / "content").mkdir()
        for f in saved["LESSON_DIR"].glob("*.json"):
            shutil.copy(f, t / "content" / f.name)
        shutil.copy(saved["SOURCES"], t / "sources.json")
        V.LIBRARY, V.LESSON_DIR, V.SOURCES = t / "content" / "library.json", t / "content", t / "sources.json"
        if kind:
            target = {"library": V.LIBRARY, "lesson": V.LESSON_DIR / "al-fatihah.json", "sources": V.SOURCES}[kind]
            data = json.loads(target.read_text(encoding="utf-8"))
            mutate(data)
            target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        try:
            yield
        finally:
            for k, v in saved.items():
                setattr(V, k, v)


def run(no_corpus: bool) -> tuple[int, str]:
    err = io.StringIO()
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
        rc = V.main(no_corpus=no_corpus)
    return rc, err.getvalue()


class TestClipRules(unittest.TestCase):
    def test_keys(self):
        self.assertEqual(C.key_of("1:1:1"), "1:1:1")
        self.assertEqual(C.key_of("q:55:78:2"), "55:78:2")
        self.assertEqual(C.key_of("q:1:5:2#1"), "1:5:2")  # a sign's letter: its word is recited
        self.assertEqual(C.key_of("q:112:1:2-4"), "112:1:2-4")
        self.assertIsNone(C.key_of("q:1:1:1/1"))  # bi-: a part of a word, never recited alone
        self.assertIsNone(C.key_of("bismi"))
        self.assertEqual(C.parse_key("112:1:2-4"), (112, 1, 2, 4))
        self.assertIsNone(C.parse_key("112:1:4-2"))
        self.assertIsNone(C.parse_key("1:1"))

    def test_last_word_rule_reads_the_lessons_word_counts(self):
        self.assertTrue(C.is_last(1, 7, 9))  # ad-ḍāllīna
        self.assertFalse(C.is_last(1, 7, 8))
        self.assertTrue(C.is_last(114, 6, 3))
        self.assertFalse(C.is_last(55, 78, 6))  # no lesson: the MAX_MS cap stays, in every mode

    def test_plausible_lengths(self):
        url = "https://everyayah.com/data/Alafasy_128kbps/001007.mp3"
        self.assertEqual(C.clip_problems("1:7:9", {"url": url, "start": 6640, "end": 12320}), [])  # 5,680 ms, last word
        self.assertTrue(C.clip_problems("1:7:8", {"url": url, "start": 6330, "end": 11000}))  # 4,670 ms mid-ayah
        self.assertTrue(C.clip_problems("1:7:8", {"url": url, "start": 6330, "end": 6430}))  # 100 ms
        self.assertEqual(C.clip_problems("1:7:1-2", {"url": url, "start": 0, "end": 7000}), [])  # a run: per word

    def test_segment_tiles_are_the_only_examples_without_a_voice(self):
        lib = json.loads(V.LIBRARY.read_text(encoding="utf-8"))
        refs = [ref for _, ref, _ in C.unvoiced(lib)]
        # bi- (bismi), li- (lillāhi), -hum (‘alaihim), li- and -hū (lahū), bi- (birabbi), -ta (an‘amta)
        self.assertEqual(refs, ["q:1:1:1/1", "q:1:2:2/1", "q:2:3:7/3", "q:1:2:2/1", "q:112:4:3/2", "q:113:1:3/1",
                                "q:1:7:3/2"])
        self.assertTrue(all("/" in r for r in refs))


class TestValidateClips(unittest.TestCase):
    def test_clean_copies_pass(self):
        with sandbox():
            rc, out = run(NO_CORPUS)
        self.assertEqual(rc, 0, out)

    def test_planted_faults(self):
        for name, kind, mutate, want in CASES:
            if NO_CORPUS and name in NEEDS_CORPUS:
                continue
            with self.subTest(name):
                with sandbox(kind, mutate):
                    rc, out = run(NO_CORPUS)
                self.assertEqual(rc, 1, f"{name}: not caught")
                self.assertIn(want, out, f"{name}: caught, but not by the expected check:\n{out}")


def table() -> int:
    bad = 0
    with sandbox():
        rc, out = run(NO_CORPUS)
    print(f"{'clean copies':32s} {'pass' if rc == 0 else 'FAIL'}")
    if rc:
        print(out)
        bad += 1
    for name, kind, mutate, want in CASES:
        if NO_CORPUS and name in NEEDS_CORPUS:
            print(f"{name:32s} SKIPPED (needs pipeline/cache)")
            continue
        with sandbox(kind, mutate):
            rc, out = run(NO_CORPUS)
        line = next((ln.strip() for ln in out.splitlines() if want in ln), "")
        ok = rc == 1 and line
        bad += not ok
        print(f"{name:32s} {'caught' if ok else 'MISSED'}  {line[:150]}")
    rules = unittest.TextTestRunner(stream=io.StringIO(), verbosity=0).run(
        unittest.defaultTestLoader.loadTestsFromTestCase(TestClipRules))
    print(f"{'clip rules (clips.py)':32s} {rules.testsRun} unit checks " + ("pass" if rules.wasSuccessful() else "FAIL"))
    bad += 0 if rules.wasSuccessful() else 1
    print(f"\n{len(CASES)} planted faults; {'all caught' if not bad else f'{bad} problem(s)'}"
          + (f"; skipped without the cache: {', '.join(sorted(NEEDS_CORPUS))}" if NO_CORPUS else ""))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(table())
