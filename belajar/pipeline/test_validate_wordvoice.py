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
WORD_ADDALLINA = next(w["ar"] for a in json.load(open(W.CONTENT / "al-fatihah.json"))["ayat"] for w in a["words"] if w["loc"] == "1:7:9")


def sample_manifest() -> dict:
    m = W.expected(INV, None)
    for i, t in enumerate(sorted(INV)):
        if i % 3 == 0:
            m["words"][t]["audio"] = {"url": W.url_of(t, "ab" * 32), "ms": 900 + i, "sha256": "ab" * 32}
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

    def test_a_ta_marbuta_with_a_vowel_is_the_open_ta_and_a_stop_stays(self):
        self.assertEqual(W.plain("\u062C\u0650\u0646\u0651\u064E\u0629\u0650"), "\u062C\u0650\u0646\u0651\u064E\u062A\u0650")  # al-jinnati
        self.assertEqual(W.plain("\u062C\u0646\u0629\u0652"), "\u062C\u0646\u0629\u0652")  # sukun: a stop
        self.assertEqual(W.plain("\u062C\u0646\u0629"), "\u062C\u0646\u0629")  # no mark: a stop

    def test_a_final_dal_with_a_sukun_is_sent_twice_and_nothing_else_is(self):
        yalid = "\u064A\u064E\u0644\u0650\u062F\u0652"
        self.assertEqual(W.say_of(yalid), yalid + "\u062F\u0652")
        yulad = "\u064A\u064F\u0648\u0644\u064E\u062F\u0652"
        self.assertEqual(W.say_of(yulad), yulad)  # the operator found no spelling that sounded right
        self.assertEqual(W.say_of("\u062F\u064F"), "\u062F\u064F")          # a vowel: not a stop
        self.assertEqual(W.say_of("\u0642\u064F\u0644\u0652"), "\u0642\u064F\u0644\u0652")  # another letter
        ina = "\u0627\u0644\u0630\u0651\u064E\u0650\u064A\u0646\u064E"
        self.assertEqual(W.say_of(ina), ina + " \u06D4")
        self.assertEqual(W.say_of("\u0645\u0650\u0646\u064E"), "\u0645\u0650\u0646\u064E")  # mina: not -ina
        jinnati = "\u0627\u0644\u0652\u062C\u0650\u0646\u0651\u064E\u062A\u0650"
        self.assertEqual(W.say_of(jinnati), jinnati + " \u06D4")  # an open ta with a kasrah
        qala = "\u0642\u064E\u0627\u0644\u064E"
        self.assertEqual(W.say_of(qala), "\u0642\u064E\u0627\u0627\u0644\u064E")  # the operator's pick: two alifs
        self.assertEqual(W.say_of(W.plain(WORD_ADDALLINA)), "ad-dhoooolliin")  # Latin, the operator's pick (L5)
        self.assertEqual(W.seed_of("\u062A\u064E"), 1)
        self.assertEqual(W.seed_of("\u0644\u064E\u0627"), 1)
        self.assertIsNone(W.seed_of(yalid))

    def test_an_alif_wasla_after_a_long_vowel_is_not_read_and_after_a_consonantal_waw_it_is(self):
        fi_al = "\u0641\u0650\u0649 \u0671\u0644\u0652\u0639\u064F\u0642\u064E\u062F\u0650"
        self.assertEqual(W.plain(fi_al), "\u0641\u0650\u064A \u0644\u0652\u0639\u064F\u0642\u064E\u062F\u0650")
        huwa_allah = "\u0647\u064F\u0648\u064E \u0671\u0644\u0644\u0651\u064E\u0647\u064F"  # the waw has a fathah
        self.assertIn(" \u0627\u0644", W.plain(huwa_allah))

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
            ("a retaken file that kept its old url (the sum is the file's)", lambda m: m["words"][first]["audio"].update(sha256="cd" * 32), "is not"),
            ("a length no word has", lambda m: m["words"][first]["audio"].update(ms=20), "plausible length"),
            ("a checksum that is not a sha256", lambda m: m["words"][first]["audio"].update(sha256="zz"), "sha256 is not 64 hex"),
            ("an audio entry with a stray key", lambda m: m["words"][first]["audio"].update(extra=1), "keys"),
            ("the voice changed", lambda m: m["voice"].update(model="eleven_v3"), "voice block differs"),
            ("a say that is not what would be sent", lambda m: m["words"][first].update(say="x"), "say/seed"),
            ("the version changed", lambda m: m.update(version=2), "version"),
        ]
        for name, mutate, want in cases:
            with self.subTest(name):
                self.planted(name, mutate, want)


if __name__ == "__main__":
    unittest.main(verbosity=1)
