#!/usr/bin/env python3
"""Mutation tests for validate_clips.py (the imam's voice of every Konsep example; operator
2026-10-12: "each explanation should be followed by examples (visual + voice)"). Each case plants
one fault in a copy of content/library.json, a lesson file, sources.json or the fixture of the ayat
outside the lessons, and asserts validate_clips.py fails with the expected message; the unmutated
copies must pass. Plus unit checks of the clip keys (clips.key_of), the length caps, what a pause
drops (clips.pause_drop), the hamzat-washal run (clips.washal_of) and the examples shown without a
clip. Standard library only; run from belajar/pipeline after build_library.py:

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
# Faults only the pinned files can tell: the fixture and the clip moved TOGETHER (CI checks the
# clips of the ayat outside the lessons against the fixture, and the lesson ayat against the
# lessons' own timings; the cache holds the fixture itself to the pinned files).
NEEDS_CORPUS = {"fixture-drifted-with-its-clip", "fixture-line-not-the-tanzil-line"}


def concept(d, cid):
    return next(c for c in d["concepts"] if c["id"] == cid)


def shift(d, key, to):
    """Clip `key` given the timing of clip `to` (the next word of the same ayah)."""
    d["clips"][key].update(start=d["clips"][to]["start"], end=d["clips"][to]["end"])


def reorder(d):
    items = list(d["clips"].items())
    d["clips"] = dict(items[1:2] + items[:1] + items[2:])


def sign(d, mark):
    return next(s for s in d["basics"][0]["signs"] if s["marks"] == [mark])


def tile(d, loc, i):
    return next(p for p in d["parts"] if p["loc"] == loc)["tiles"][i]


def fathatain_ending(d):
    """The last word of Al-Fatihah 1 given an ending the waqf note has no wording for (in the
    lesson and in the library's bytes of it, as a real lesson word would be)."""
    w = d["lesson"]["ayat"][0]["words"][3]
    w["ar"] = w["ar"][:-1] + "\u064B"  # its kasrah replaced by a fathatain
    d["library"]["quran"]["1:1:4"] = w["ar"]


def drift_together(d):
    """The fixture's timing of 97:5 word 1 and its clip moved by the same 100 ms."""
    d["fixture"]["ayat"]["97:5"]["segments"][0][3] += 100
    d["library"]["clips"]["97:5:1"]["end"] += 100


def swap_fixture_words(d):
    """Two words of 26:24 that no page shows, swapped in the fixture's Tanzil line."""
    toks = d["ayat"]["26:24"]["tanzil"].split(" ")
    toks[4], toks[5] = toks[5], toks[4]
    d["ayat"]["26:24"]["tanzil"] = " ".join(toks)


# (name, file, mutate(data), expected message fragment)
CASES = [
    # --- 1. coverage: every example has a voice, nothing else does
    ("example-without-clip", "library", lambda d: d["clips"].pop("1:1:2"), "has no clip (an example with no voice"),
    ("new-example-without-clip", "library",
     lambda d: concept(d, "idhafah")["examples"].append({"loc": "113:3:2", "note": "contoh baru tanpa suara"}),
     "113:3:2 has no clip"),
    ("sign-word-without-clip", "library", lambda d: d["clips"].pop("1:5:2"), "basics[harakat].signs[0]: 1:5:2 has no clip"),
    ("parts-word-without-clip", "library", lambda d: d["clips"].pop("113:1:3"), "parts[113:1:3].word: 113:1:3 has no clip"),
    ("parts-tile-without-clip", "library", lambda d: d["clips"].pop("55:78:1-2"),
     "parts[1:1:1].tiles[1]: 55:78:1-2 has no clip"),
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
     "for the ayah’s last word"),
    ("run-too-long", "library", lambda d: d["clips"]["55:78:1-2"].update(end=d["clips"]["55:78:1-2"]["start"] + 9000),
     "9000 ms is not a plausible length for 2 word(s) (300–8000 ms"),
    ("extra-field", "library", lambda d: d["clips"]["1:1:2"].update(reciter="Alafasy_128kbps"),
     "must be exactly {url, start, end}"),
    # --- 3. a lesson ayah: the lesson's own timing, the lesson's word
    ("lesson-clip-next-word", "library", lambda d: shift(d, "1:1:2", "1:1:3"), "is not the lesson's timing of word(s) 2..2 of 1:1"),
    ("lesson-clip-off-by-10ms", "library", lambda d: d["clips"]["112:1:3"].update(end=d["clips"]["112:1:3"]["end"] + 10),
     "is not the lesson's timing"),
    ("lesson-run-off-by-10ms", "library", lambda d: d["clips"]["112:1:2-3"].update(start=d["clips"]["112:1:2-3"]["start"] + 10),
     "is not the lesson's timing of word(s) 2..3 of 112:1"),
    ("lesson-segment-drifted", "lesson",
     lambda d: d["ayat"][0]["recitation"][1]["segments"][1].__setitem__(1, 700),
     "is not the lesson's timing of word(s) 2..2 of 1:1"),
    ("lesson-has-no-alafasy", "lesson", lambda d: d["ayat"][0]["recitation"].pop(1),
     "has no Alafasy_128kbps recitation entry"),
    ("page-bytes-not-the-lesson-word", "library",
     lambda d: d["quran"].__setitem__("1:1:1", d["quran"]["1:1:2"]),
     "the page shows"),
    # --- 4. an ayah without a lesson: the committed fixture (corpus-free, so CI catches these too)
    ("outside-clip-next-word", "library", lambda d: d["clips"]["5:23:6"].update(start=5250, end=6050),
     "clips[5:23:6]: {'url': 'https://everyayah.com/data/Alafasy_128kbps/005023.mp3', 'start': 5250, 'end': 6050} is not "
     "the clip the fixture's quran-align entry of 5:23 gives"),
    ("outside-run-shifted", "library", lambda d: d["clips"]["55:78:1-2"].update(start=1060),
     "is not the clip the fixture's quran-align entry of 55:78 gives"),
    ("outside-clip-off-by-10ms", "library", lambda d: d["clips"]["97:5:1"].update(end=d["clips"]["97:5:1"]["end"] + 10),
     "is not the clip the fixture's quran-align entry of 97:5 gives"),
    ("outside-clip-other-ayah-file", "library",
     lambda d: d["clips"]["26:24:2"].update(url="https://everyayah.com/data/Alafasy_128kbps/026023.mp3"),
     "is not Alafasy_128kbps's file of 26:24"),
    ("outside-bytes-another-token", "library", lambda d: d["quran"].__setitem__("2:5:2", d["quran"]["1:1:1"]),
     "but the fixture's Tanzil token(s) at the clip's index are"),
    ("outside-word-before-wrong-bytes", "library", lambda d: d["quran"].__setitem__("55:78:1", d["quran"]["1:1:1"]),
     "library quran[55:78:1]"),
    ("fixture-without-an-ayah", "fixture", lambda d: d["ayat"].pop("97:5"), "no entry for 97:5"),
    ("fixture-with-an-unused-ayah", "fixture", lambda d: d["ayat"].__setitem__("2:6", d["ayat"]["2:5"]),
     "2:6 is not the ayah of any clip outside the lessons"),
    ("fixture-stale-pins", "fixture", lambda d: d["pins"].update(tanzil_uthmani="1.1 sha256:0000"),
     "are not those of sources.json"),
    ("fixture-timing-moved", "fixture", lambda d: d["ayat"]["2:5"]["segments"][1].__setitem__(2, 2600),
     "is not the clip the fixture's quran-align entry of 2:5 gives"),
    ("fixture-not-a-fixture", "fixture", lambda d: d.pop("ayat"), "missing or not a fixture"),
    # --- 5. what is HEARD (review 2026-10-12)
    #   a. a Harakat sign card: its sign is heard where its example is
    ("sign-tanwin-on-an-ayahs-last-word", "library",
     lambda d: sign(d, "dhammatain").update(example="q:112:1:4#3", reading="d + un"),
     "is its ayah's last word: the imam stops there (waqf), so the tanwin (dhammatain) is not heard"),
    ("sign-tanwin-before-a-letter-that-hides-the-n", "library",
     lambda d: sign(d, "fathatain").update(example="q:2:5:3#2", reading="d + an"),
     "the n of the tanwin (fathatain) is not clearly heard"),
    ("sign-on-the-last-letter-of-an-ayah", "library",
     lambda d: sign(d, "dhammah").update(example="q:112:2:2#5"),
     "sits on the last letter of"),
    ("sign-in-an-ayah-nobody-can-read", "library",
     lambda d: sign(d, "dhammatain").update(example="q:101:11:1#3", reading="r + un"),
     "the ayah's words are not known"),
    #   b. a clip on an ayah's last word says so: `last`, from the ayah's word count
    ("ayah-end-without-last", "library", lambda d: d["clips"]["1:1:4"].pop("last"),
     "clips[1:1:4]: `last` must be true exactly on the ayah's last word (1:1 has 4 words)"),
    ("last-on-a-mid-ayah-word", "library", lambda d: d["clips"]["1:1:2"].update(last=True),
     "clips[1:1:2]: `last` must be true exactly on the ayah's last word"),
    ("last-false", "library", lambda d: d["clips"]["1:1:2"].update(last=False), "`last` is true or absent"),
    ("last-on-a-word-outside-the-lessons", "library", lambda d: d["clips"]["97:5:1"].update(last=True),
     "a wrong `last`"),
    ("ayah-end-the-note-cannot-describe", "lesson+library", fathatain_ending, "the waqf note has no wording for"),
    #   c. hamzat washal: a base-form tile mid-ayah plays the run with the word before it
    ("washal-tile-plays-the-word-alone", "library", lambda d: tile(d, "1:1:1", 1).pop("washal"),
     "starts with hamzat washal mid-ayah, where the imam does not read its alif"),
    ("washal-heard-form-wrong", "library", lambda d: tile(d, "1:1:1", 1)["washal"].update(heard="tabārakaismu"),
     "is not what the tile's bytes give"),
    ("washal-before-another-word", "library",
     lambda d: tile(d, "1:1:1", 1)["washal"].update(before="qāla", heard="qālasmu"),
     "does not name the word before it"),
    ("washal-run-of-another-word", "library", lambda d: tile(d, "1:1:1", 1)["washal"].update(run="55:78:2-3"),
     "is not what the tile's bytes give"),
    ("washal-before-not-the-lessons-word", "library",
     lambda d: tile(d, "1:2:2", 1)["washal"].update(before="Huwa", heard="Huwallāhu"),
     "is not the lesson's transliteration of 112:1:2"),
    ("washal-on-a-word-that-has-none", "library",
     lambda d: tile(d, "113:1:3", 1).update(washal={"run": "26:24:1-2", "before": "qāla", "heard": "qālarabbu"}),
     "is not what the tile's bytes give, None"),
    ("washal-on-a-part-of-a-word", "library",
     lambda d: tile(d, "1:1:1", 0).update(washal={"run": "1:1:1-2", "before": "bi", "heard": "bismi"}),
     "`washal` on a tile that is not one whole word"),
    ("base-form-tile-on-an-ayahs-last-word", "library", lambda d: d["clips"]["26:24:2"].update(last=True),
     "so the ending the diagram shows is not heard"),
    # --- 6. the pin
    ("stale-quran-align-pin", "library",
     lambda d: d["data_versions"].__setitem__("quran_align", "release-2016-11-24 Alafasy_128kbps.json sha256:0000"),
     "does not pin Alafasy_128kbps.json"),
    ("no-quran-align-pin", "library", lambda d: d["data_versions"].pop("quran_align"), "does not pin Alafasy_128kbps.json"),
    # --- 7–9. with the cache only: the fixture itself against the pinned files
    ("fixture-drifted-with-its-clip", "fixture+library", drift_together, "97:5 is not the pinned quran-align entry"),
    ("fixture-line-not-the-tanzil-line", "fixture", swap_fixture_words, "26:24 is not the pinned Tanzil line"),
]


@contextlib.contextmanager
def sandbox(kind: str | None = None, mutate=None):
    """Copies of everything validate_clips reads, with one file mutated (or two, "a+b": mutate gets
    {"a": …, "b": …}); module paths redirected."""
    saved = {k: getattr(V, k) for k in ("LIBRARY", "LESSON_DIR", "SOURCES", "FIXTURE")}
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        (t / "content").mkdir()
        for f in saved["LESSON_DIR"].glob("*.json"):
            shutil.copy(f, t / "content" / f.name)
        shutil.copy(saved["SOURCES"], t / "sources.json")
        shutil.copy(saved["FIXTURE"], t / saved["FIXTURE"].name)
        V.LIBRARY, V.LESSON_DIR, V.SOURCES = t / "content" / "library.json", t / "content", t / "sources.json"
        V.FIXTURE = t / saved["FIXTURE"].name
        if kind:
            paths = {"library": V.LIBRARY, "lesson": V.LESSON_DIR / "al-fatihah.json", "sources": V.SOURCES,
                     "fixture": V.FIXTURE}
            kinds = kind.split("+")
            data = {k: json.loads(paths[k].read_text(encoding="utf-8")) for k in kinds}
            mutate(data if len(kinds) > 1 else data[kinds[0]])
            for k in kinds:
                paths[k].write_text(json.dumps(data[k], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
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

    def test_a_tile_with_washal_is_keyed_by_its_run(self):
        self.assertEqual(C.tile_key({"q": "q:55:78:2"}), "55:78:2")
        self.assertEqual(C.tile_key({"q": "q:55:78:2", "washal": {"run": "55:78:1-2"}}), "55:78:1-2")
        self.assertIsNone(C.tile_key({"q": "q:1:1:1/1"}))
        self.assertIsNone(C.tile_key({"q": "q:1:1:1/1", "washal": {"run": "1:1:1-2"}}))

    def test_last_word_rule_reads_the_lessons_word_counts(self):
        self.assertTrue(C.is_last(1, 7, 9))  # ad-ḍāllīna
        self.assertFalse(C.is_last(1, 7, 8))
        self.assertTrue(C.is_last(114, 6, 3))
        self.assertFalse(C.is_last(55, 78, 6))  # no lesson: its count comes from the Tanzil line

    def test_plausible_lengths(self):
        url = "https://everyayah.com/data/Alafasy_128kbps/001007.mp3"
        ok = lambda key, start, end, **kw: C.clip_problems(key, {"url": url, "start": start, "end": end, **kw}) == []
        self.assertTrue(ok("1:7:9", 6640, 12320, last=True))  # 5,680 ms, the ayah's last word
        self.assertFalse(ok("1:7:9", 6640, 12320))  # the same length without `last`: the 4 s cap
        self.assertFalse(ok("1:7:8", 6330, 11000))  # 4,670 ms mid-ayah
        self.assertFalse(ok("1:7:8", 6330, 6430))  # 100 ms
        self.assertTrue(ok("1:7:1-2", 0, 7000))  # a run of two: 300–8,000 ms
        self.assertFalse(ok("1:7:1-2", 0, 8500))
        self.assertFalse(ok("1:7:1-2", 0, 250))  # under 150 ms a word
        # A run's cap is the sum of its words' caps: only its LAST word can be the ayah's last
        # (review 2026-10-12: the 7 s allowance was multiplied by the run's word count).
        self.assertEqual((C.max_ms(1, False), C.max_ms(1, True), C.max_ms(2, False), C.max_ms(2, True), C.max_ms(3, True)),
                         (4000, 7000, 8000, 11000, 15000))
        self.assertTrue(ok("1:7:8-9", 0, 11000, last=True))
        self.assertFalse(ok("1:7:8-9", 0, 11500, last=True))  # 14,000 ms passed before

    def test_what_a_pause_drops(self):
        """clips.pause_drop on the lessons' own bytes (src/lib/heard.test.ts checks the same words)."""
        lessons = {f.stem: json.loads(f.read_text(encoding="utf-8")) for f in V.LESSON_DIR.glob("a*.json")}
        word = lambda s, a, w: C.lesson_word(lessons, s, a, w)["ar"]
        for loc, want in [((1, 5, 4), "harakat"),   # nasta‘īnu: heard "nasta‘īn"
                          ((113, 2, 4), "harakat"),  # khalaqa: heard "khalaq"
                          ((112, 1, 4), "harakat"),  # aḥadun: heard "aḥad"
                          ((112, 4, 5), "harakat"),  # aḥadun with the mushaf's small mim after the tanwin
                          ((1, 7, 9), "harakat"),    # aḍ-ḍāllīna
                          ((112, 3, 4), "none"),     # yūlad: a sukun, nothing to drop
                          ((1, 6, 1), "none"),       # ihdinā: a long vowel
                          ((112, 4, 4), "other"),    # kufuwan: fathatain, read ā at a pause
                          ((112, 4, 3), "other")]:   # lahū: the pronoun's long vowel
            self.assertEqual(C.pause_drop(word(*loc)), want, loc)

    def test_every_lesson_ayah_ends_in_something_the_note_describes(self):
        lessons = {f.stem: json.loads(f.read_text(encoding="utf-8")) for f in V.LESSON_DIR.glob("a*.json")}
        drops = {}
        for les in lessons.values():
            for ay in les["ayat"]:
                drops[ay["words"][-1]["loc"]] = C.pause_drop(ay["words"][-1]["ar"])
        self.assertEqual(len(drops), 22)
        self.assertEqual([k for k, v in drops.items() if v != "harakat"], ["112:3:4"])
        self.assertEqual(drops["112:3:4"], "none")

    def test_washal_run(self):
        lib = json.loads(V.LIBRARY.read_text(encoding="utf-8"))
        q = lib["quran"]
        ws, errs = C.washal_of("ismu", q["55:78:2"], (55, 78, 2), q["55:78:1"], "tabāraka")
        self.assertEqual((ws, errs), ({"run": "55:78:1-2", "before": "tabāraka", "heard": "tabārakasmu"}, []))
        ws, errs = C.washal_of("Allāhu", q["112:1:3"], (112, 1, 3), q["112:1:2"], "huwa")
        self.assertEqual((ws, errs), ({"run": "112:1:2-3", "before": "huwa", "heard": "huwallāhu"}, []))
        # not needed: the ayah's first word (the alif IS read there), a word without hamzat washal
        self.assertEqual(C.washal_of("Allāhu", q["112:2:1"], (112, 2, 1), None, None), (None, []))
        self.assertEqual(C.washal_of("rabbu", q["26:24:2"], (26, 24, 2), "قَالَ", "qāla"), (None, []))
        # needed, but the word before is not given, is another word, or does not end in a short vowel
        self.assertIn("needs `before`", C.washal_of("ismu", q["55:78:2"], (55, 78, 2), q["55:78:1"], None)[1][0])
        self.assertIn("does not name the word before it", C.washal_of("ismu", q["55:78:2"], (55, 78, 2), q["55:78:1"], "qāla")[1][0])
        self.assertIn("does not end in one short vowel", C.washal_of("Allāhu", q["112:1:3"], (112, 1, 3), q["112:1:1"], "qul")[1][0])
        self.assertIn("does not end in one short vowel", C.washal_of("Allāhu", q["112:1:3"], (112, 1, 3), q["112:1:4"], "aḥadun")[1][0])

    def test_the_fixture_is_what_the_pipeline_writes(self):
        fx = json.loads(V.FIXTURE.read_text(encoding="utf-8"))
        self.assertEqual(C.fixture_text(fx), V.FIXTURE.read_text(encoding="utf-8"))
        align, T = C.fixture_sources(fx)
        self.assertEqual(sorted(align), sorted(T.verses))
        lib = json.loads(V.LIBRARY.read_text(encoding="utf-8"))
        self.assertEqual(sorted(align), C.outside_ayat(lib["clips"]))
        self.assertGreaterEqual(len(align), 5)
        for key in lib["clips"]:
            s, a, _w, _w2 = C.parse_key(key)
            if (s, a) in align:
                self.assertEqual(C.clip_from(key, align, T)[0], lib["clips"][key], key)

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

    def test_the_cache_only_faults_pass_without_it(self):
        """NEEDS_CORPUS is honest: without the cache those two are invisible (so CI skips them by name)."""
        for name, kind, mutate, _want in CASES:
            if name in NEEDS_CORPUS:
                with sandbox(kind, mutate):
                    rc, out = run(True)
                self.assertEqual(rc, 0, f"{name}: caught without the cache; take it out of NEEDS_CORPUS\n{out}")


def table() -> int:
    bad = 0
    with sandbox():
        rc, out = run(NO_CORPUS)
    print(f"{'clean copies':44s} {'pass' if rc == 0 else 'FAIL'}")
    if rc:
        print(out)
        bad += 1
    for name, kind, mutate, want in CASES:
        if NO_CORPUS and name in NEEDS_CORPUS:
            print(f"{name:44s} SKIPPED (needs pipeline/cache)")
            continue
        with sandbox(kind, mutate):
            rc, out = run(NO_CORPUS)
        line = next((ln.strip() for ln in out.splitlines() if want in ln), "")
        ok = rc == 1 and line
        bad += not ok
        print(f"{name:44s} {'caught' if ok else 'MISSED'}  {line[:150]}")
        if not ok:
            print(out)
    for case in (TestClipRules, ):
        rules = unittest.TextTestRunner(stream=io.StringIO(), verbosity=0).run(
            unittest.defaultTestLoader.loadTestsFromTestCase(case))
        print(f"{'clip rules (clips.py)':44s} {rules.testsRun} unit checks " + ("pass" if rules.wasSuccessful() else "FAIL"))
        for _t, tb in rules.failures + rules.errors:
            print(tb)
        bad += 0 if rules.wasSuccessful() else 1
    quiet = unittest.TextTestRunner(stream=io.StringIO(), verbosity=0).run(
        unittest.defaultTestLoader.loadTestsFromName("test_the_cache_only_faults_pass_without_it", TestValidateClips))
    print(f"{'cache-only faults pass without the cache':44s} " + ("pass" if quiet.wasSuccessful() else "FAIL"))
    for _t, tb in quiet.failures + quiet.errors:
        print(tb)
    bad += 0 if quiet.wasSuccessful() else 1
    print(f"\n{len(CASES)} planted faults; {'all caught' if not bad else f'{bad} problem(s)'}"
          + (f"; skipped without the cache: {', '.join(sorted(NEEDS_CORPUS))}" if NO_CORPUS else ""))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(table())
