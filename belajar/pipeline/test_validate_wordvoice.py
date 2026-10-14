#!/usr/bin/env python3
"""Planted-fault tests of the word-voice manifest (pipeline/wordvoice.py, build_wordvoice.py).

Every check must catch the fault planted for it, and the unmutated manifest must pass: a check that
cannot fail proves nothing. Arabic is built from code points (no Arabic is typed here); the real
words come from the content."""
from __future__ import annotations

import copy
import json
import unittest

import wordvoice as W

ALIF_WASLA, DAGGER, SMALL_SUKUN, STOP = "ٱ", "ٰ", "ۡ", "ۖ"
INV, UNRESOLVED = W.inventory()


def sample_manifest() -> dict:
    m = W.expected(INV, None)
    for i, t in enumerate(sorted(INV)):
        if i % 3 == 0:
            m["words"][t]["audio"] = {"url": W.url_of(t), "ms": 900 + i, "sha256": "ab" * 32}
    return m


class PlainLetters(unittest.TestCase):
    def test_the_marks_the_model_does_not_know_become_plain_letters(self):
        self.assertEqual(W.plain(f"{ALIF_WASLA}ل"), "ال")
        self.assertEqual(W.plain(f"م{DAGGER}"), "ما")
        self.assertEqual(W.plain(f"ل{SMALL_SUKUN}"), "لْ")
        self.assertEqual(W.plain(f"ل{STOP}م"), "لم")  # a stop sign is dropped

    def test_the_dotless_ya_is_a_long_i_after_a_kasrah_and_a_long_a_after_a_fathah(self):
        self.assertEqual(W.plain("\u0630\u0650\u0649"), "\u0630\u0650\u064A")  # alladhī: ى -> ي
        self.assertEqual(W.plain("\u0647\u064F\u062F\u064E\u0649"), "\u0647\u064F\u062F\u064E\u0649")  # hudā stays

    def test_ordinary_harakat_are_untouched_and_the_rule_is_idempotent(self):
        w = "بِسْمِ"
        self.assertEqual(W.plain(w), w)
        for t in INV:
            self.assertEqual(W.plain(t), t, "an inventory text is already in plain letters")

    def test_no_text_keeps_a_mark_the_rule_removes(self):
        for t in INV:
            for c in t:
                self.assertNotIn(ord(c), W._DROP | set(W._TO_LETTER), repr(t))


class Inventory(unittest.TestCase):
    def test_every_word_of_every_lesson_surah_is_voiced(self):
        n = 0
        for f in sorted(W.CONTENT.glob("*.json")):
            d = json.loads(f.read_text(encoding="utf-8"))
            for a in (d.get("ayat") or []) if isinstance(d, dict) else []:
                for w in a.get("words") or []:
                    n += 1
                    self.assertIn(W.plain(w["ar"]), INV, w["loc"])
        self.assertGreater(n, 80)

    def test_every_form_of_a_composition_is_voiced_and_no_run_is_left_unresolved(self):
        self.assertEqual(UNRESOLVED, [])
        origins = {o for s in INV.values() for o in s}
        self.assertTrue({"lesson-word", "konsep-word", "compose-form"} <= origins, origins)

    def test_a_run_the_library_cites_is_a_text(self):
        lib = json.loads((W.CONTENT / "library.json").read_text(encoding="utf-8"))
        run = lib["quran"]["92:1:1-3"]
        self.assertIn(W.plain(run), INV)


class Manifest(unittest.TestCase):
    def test_the_unmutated_manifest_passes_with_and_without_the_audio_requirement(self):
        m = sample_manifest()
        self.assertEqual(W.problems(m, INV), [])
        self.assertTrue(any("no recording" in p for p in W.problems(m, INV, require_audio=True)))

    def test_expected_keeps_the_recordings_it_had(self):
        m = sample_manifest()
        again = W.expected(INV, m)
        self.assertEqual(again, m)

    def planted(self, name, mutate, want):
        m = copy.deepcopy(sample_manifest())
        mutate(m)
        p = "\n".join(W.problems(m, INV))
        self.assertIn(want, p, f"{name}: not caught ({p[:200]!r})")

    def test_planted_faults_are_caught(self):
        first = next(t for t, e in sample_manifest()["words"].items() if e.get("audio"))
        cases = [
            ("a text the content shows is missing", lambda m: m["words"].pop(first), "has no entry"),
            ("an entry no content shows", lambda m: m["words"].update({"اب": {}}), "no content shows any more"),
            ("a text with a mark the model misreads", lambda m: m["words"].update({ALIF_WASLA + "ل": {}}), "not in plain letters"),
            ("a url that is not the text's hash", lambda m: m["words"][first]["audio"].update(url="/belajar/media/x.mp3"), "is not"),
            ("a length no word has", lambda m: m["words"][first]["audio"].update(ms=20), "plausible length"),
            ("a checksum that is not a sha256", lambda m: m["words"][first]["audio"].update(sha256="zz"), "sha256 is not 64 hex"),
            ("an audio entry with a stray key", lambda m: m["words"][first]["audio"].update(extra=1), "keys"),
            ("the voice changed", lambda m: m["voice"].update(model="eleven_v3"), "voice block differs"),
            ("the version changed", lambda m: m.update(version=2), "version"),
        ]
        for name, mutate, want in cases:
            with self.subTest(name):
                self.planted(name, mutate, want)


if __name__ == "__main__":
    unittest.main(verbosity=1)
