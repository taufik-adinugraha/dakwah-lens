#!/usr/bin/env python3
"""Planted-fault tests of the word-voice manifest (pipeline/wordvoice.py, build_wordvoice.py).

Every check must catch the fault planted for it, and the unmutated manifest must pass: a check that
cannot fail proves nothing. Arabic is built from code points (no Arabic is typed here); the real
words come from the content."""
from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path

import wordvoice as W

ALIF_WASLA, DAGGER, SMALL_SUKUN, STOP = "ٱ", "ٰ", "ۡ", "ۖ"
INV, UNRESOLVED = W.inventory()
WORD_ADDALLINA = next(w["ar"] for a in json.load(open(W.CONTENT / "al-fatihah.json"))["ayat"] for w in a["words"] if w["loc"] == "1:7:9")


QC = W.load_qc()
CHOICE = W.quran_com_choice(INV, QC)


def sample_manifest() -> dict:
    """The manifest the content gives, every Quran.com entry with a well-formed pin and every third
    narrator's entry with a recording (the rest not recorded yet)."""
    m = W.expected(INV, None, QC)
    for i, t in enumerate(sorted(INV)):
        e = m["words"][t]
        if e["source"] == "quran.com":
            up = W.qc_upstream(QC, e["loc"])
            e["audio"] = {"url": W.qc_url(up), "upstream": up, "ms": 1200 + i, "sha256": "cd" * 32, "start": 40, "end": 1100}
        elif i % 3 == 0:
            e["audio"] = {"url": W.url_of(t, "ab" * 32), "ms": 900 + i, "sha256": "ab" * 32}
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
        self.assertEqual(W.problems(m, INV, qc=QC), [])
        self.assertTrue(any("no recording" in p for p in W.problems(m, INV, require_audio=True, qc=QC)))

    def test_expected_keeps_the_recordings_it_had(self):
        m = sample_manifest()
        again = W.expected(INV, m, QC)
        self.assertEqual(again, m)

    def test_the_committed_manifest_and_fixture_pass(self):
        m = W.load_manifest()
        self.assertEqual(W.fixture_problems(QC, INV), [])
        self.assertEqual(W.problems(m, INV, require_audio=True, qc=QC), [])
        self.assertEqual(m, W.expected(INV, m, QC))

    def planted(self, name, mutate, want, qc=None):
        m = copy.deepcopy(sample_manifest())
        mutate(m)
        p = "\n".join(W.problems(m, INV, qc=qc or QC))
        self.assertIn(want, p, f"{name}: not caught ({p[:200]!r})")

    def test_planted_faults_are_caught(self):
        words = sample_manifest()["words"]
        first = next(t for t, e in words.items() if e.get("source") == "elevenlabs" and e.get("audio"))
        qc = next(t for t, e in words.items() if e.get("source") == "quran.com")
        part = next(t for t, e in words.items() if e.get("source") == "elevenlabs" and " " not in t)
        run = next(t for t, e in words.items() if " " in t)
        other = next(t for t, e in words.items() if e.get("source") == "quran.com" and e["loc"] != words[qc]["loc"])
        def to_qc(t):
            def f(m):
                m["words"][t] = {"source": "quran.com", "loc": "1:1:1", "audio": dict(m["words"][qc]["audio"])}
            return f
        cases = [
            ("a text the content shows is missing", lambda m: m["words"].pop(first), "has no entry"),
            ("a Quran.com text is missing", lambda m: m["words"].pop(qc), "has no entry"),
            ("an entry no content shows", lambda m: m["words"].update({"اب": {"source": "elevenlabs"}}), "no content shows any more"),
            ("a text with a mark the model misreads", lambda m: m["words"].update({ALIF_WASLA + "ل": {"source": "elevenlabs"}}), "not in plain letters"),
            ("a url that is not the text's hash", lambda m: m["words"][first]["audio"].update(url="/belajar/media/x.mp3"), "is not"),
            ("a retaken file that kept its old url (the sum is the file's)", lambda m: m["words"][first]["audio"].update(sha256="cd" * 32), "is not"),
            ("a length no word has", lambda m: m["words"][first]["audio"].update(ms=20), "plausible length"),
            ("a checksum that is not a sha256", lambda m: m["words"][first]["audio"].update(sha256="zz"), "sha256 is not 64 hex"),
            ("an audio entry with a stray key", lambda m: m["words"][first]["audio"].update(extra=1), "keys"),
            ("the voice changed", lambda m: m["voice"].update(model="eleven_v3"), "voice block differs"),
            ("a say that is not what would be sent", lambda m: m["words"][first].update(say="x"), "say/seed"),
            ("the version changed", lambda m: m.update(version=1), "version"),
            ("an entry with no source", lambda m: m["words"][first].pop("source"), "is not one of"),
            # Quran.com's recordings (operator 2026-10-15)
            ("a quran.com entry for a part of a word (no place)", to_qc(part), "a word at no place"),
            ("a quran.com entry for a run of words", to_qc(run), "a word at no place"),
            ("a word at a place left the narrator's", lambda m: m["words"].update({qc: {"source": "elevenlabs"}}), "the narrator's, but the text is a word at"),
            ("a quran.com entry at another place than the rule's", lambda m: m["words"][qc].update(loc=words[other]["loc"]), "is not the place the rule chooses"),
            ("an upstream on another host", lambda m: m["words"][qc]["audio"].update(upstream="https://example.org/wbw/001_001_001.mp3"), "is not a word file on"),
            ("an upstream file of another word", lambda m: m["words"][qc]["audio"].update(upstream=words[other]["audio"]["upstream"]), "is not Quran.com's file of"),
            ("our copy streamed from Quran.com's host instead", lambda m: m["words"][qc]["audio"].update(url=m["words"][qc]["audio"]["upstream"]), "is not under /belajar/media/narration/quran-com/wbw/"),
            ("a quran.com url under the narrator's media prefix", lambda m: m["words"][qc]["audio"].update(url=W.DELIVERY_PREFIX + m["words"][qc]["audio"]["upstream"].rsplit("/", 1)[1]), "is not under /belajar/media/narration/quran-com/wbw/"),
            ("our copy under another name than upstream's", lambda m: m["words"][qc]["audio"].update(url=W.QC_PREFIX + "999_999_999.mp3"), "is not the upstream file's name"),
            ("a word that ends after its file", lambda m: m["words"][qc]["audio"].update(end=m["words"][qc]["audio"]["ms"] + 5), "is not a plausible word inside its file"),
            ("a word that starts after it ends", lambda m: m["words"][qc]["audio"].update(start=1100, end=1000), "is not a plausible word inside its file"),
            ("a quran.com audio without its markers", lambda m: m["words"][qc]["audio"].pop("start"), "audio has keys"),
            ("a quran.com entry with what is sent to ElevenLabs", lambda m: m["words"][qc].update(say="x"), "has no 'say'"),
            ("a narrator's entry with a loc", lambda m: m["words"][first].update(loc="1:1:1"), "a narrator's recording has no loc"),
            ("the credit changed", lambda m: m["quran_com"].update(credit="x"), "quran_com block"),
        ]
        for name, mutate, want in cases:
            with self.subTest(name):
                self.planted(name, mutate, want)


class QuranComPlaces(unittest.TestCase):
    """The rule that gives a text its place (wordvoice.quran_com_choice) and the fixture it reads."""

    def test_every_lesson_word_is_a_place_and_parts_letters_runs_built_forms_are_not(self):
        lessons = [w for f in sorted(W.CONTENT.glob("*.json")) for a in (json.loads(f.read_text(encoding="utf-8")).get("ayat") or [])
                   if isinstance(a, dict) for w in a.get("words") or []]
        self.assertGreater(len(lessons), 80)
        for w in lessons:
            self.assertIn(W.plain(w["ar"]), CHOICE, w["loc"])
        self.assertTrue(all(" " not in t for t in CHOICE), "a run has no place")
        lib = json.loads((W.CONTENT / "library.json").read_text(encoding="utf-8"))
        # bi- (a part of bismi), a letter, ismi (built by an edit, operator 2026-10-15: stays the narrator's)
        self.assertNotIn(W.plain(lib["quran"]["1:1:1/1"]), CHOICE)
        self.assertNotIn(W.plain(lib["quran"]["1:1:1#1"]), CHOICE)
        comp = json.loads((W.CONTENT / "compose" / "al-fatihah.json").read_text(encoding="utf-8"))
        self.assertNotIn(W.plain(comp["words"]["1:1:1"]["forms"]["ismi"]["ar"]), CHOICE)
        self.assertNotIn(W.plain(comp["words"]["1:1:1"]["forms"]["bi+ismi"]["ar"]), CHOICE)
        self.assertEqual(CHOICE[W.plain(comp["words"]["1:1:1"]["forms"]["ismu"]["ar"])], "55:78:2")

    def test_an_ayah_final_place_wins_over_one_inside_an_ayah(self):
        fake = copy.deepcopy(QC)
        t = W.plain(next(w["ar"] for a in json.loads((W.CONTENT / "al-ikhlas.json").read_text(encoding="utf-8"))["ayat"] for w in a["words"] if w["loc"] == "112:1:4"))
        self.assertEqual(W.quran_com_choice({t: {"lesson-word"}}, QC), {t: "112:1:4"})  # first in lesson order, and ayah-final
        # were 112:1 two words longer, 112:1:4 would stand inside it, and 112:4:5 (also aḥadun, ayah-final) wins
        fake["ayat"]["112:1"] = fake["ayat"]["112:1"] + [{"text_uthmani": "x", "audio_url": "wbw/112_001_005.mp3"}]
        self.assertEqual(W.quran_com_choice({t: {"lesson-word"}}, fake), {t: "112:4:5"})
        self.assertTrue(any(t in c for c in W.choice_conflicts({t: {"lesson-word"}}, fake)))

    def test_the_file_is_the_word_position_not_the_apis_audio_url(self):
        # 41:9: the API counts a rub' al-hizb sign and a pause mark; the CDN holds one file per word
        self.assertEqual(QC["ayat"]["41:9"][12]["audio_url"], "wbw/041_009_015.mp3")
        self.assertEqual(W.qc_upstream(QC, "41:9:13"), "https://audio.qurancdn.com/wbw/041_009_013.mp3")
        self.assertTrue(any(n.startswith("41:9:") for n in W.qc_numbering_notes(QC)))

    def test_the_fixture_checks_catch_a_missing_ayah_and_another_word(self):
        self.assertEqual(W.fixture_problems(QC, INV), [])
        gone = copy.deepcopy(QC)
        gone["ayat"].pop("55:78")
        self.assertTrue(any("no word list of 55:78" in p for p in W.fixture_problems(gone, INV)))
        moved = copy.deepcopy(QC)
        moved["ayat"]["1:1"] = list(reversed(moved["ayat"]["1:1"]))
        self.assertTrue(any("another word" in p for p in W.fixture_problems(moved, INV)))
        host = copy.deepcopy(QC)
        host["ayat"]["1:1"][0]["audio_url"] = "wbw/002_001_001.mp3"
        self.assertTrue(any("is not a wbw file of 1:1" in p for p in W.fixture_problems(host, INV)))
        self.assertIn("missing", W.fixture_problems(None, INV)[0])


class LocalPins(unittest.TestCase):
    def test_a_stale_pin_is_caught_against_the_downloaded_copy(self):
        import tempfile
        import build_wordvoice as B
        m = copy.deepcopy(W.load_manifest())
        t = next(t for t, e in m["words"].items() if e["source"] == "quran.com")
        with tempfile.TemporaryDirectory() as d:
            name = m["words"][t]["audio"]["upstream"].rsplit("/", 1)[1]
            (Path(d) / name).write_bytes(b"upstream changed this file")
            errs = B.measure_qc({"words": {t: m["words"][t]}}, QC, download=False, cache=Path(d))
        self.assertTrue(any("a stale pin" in e for e in errs), errs)

    def test_no_copy_on_this_machine_is_not_a_fault_once_pinned(self):
        import tempfile
        import build_wordvoice as B
        m = copy.deepcopy(W.load_manifest())
        t = next(t for t, e in m["words"].items() if e["source"] == "quran.com")
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(B.measure_qc({"words": {t: m["words"][t]}}, QC, download=False, cache=Path(d)), [])


class HostedMedia(unittest.TestCase):
    """host_media.py: every hosted file the content references is pinned, and a delivery holds each
    byte for byte (planted faults on copies; no network)."""

    def setUp(self):
        import host_media as H
        self.H = H
        self.pins = H.load_pins()
        self.manifest = W.load_manifest()

    def test_the_committed_pins_cover_the_content(self):
        self.assertEqual(self.H.problems(self.pins, self.manifest, local=False), [])

    def test_planted_faults(self):
        H = self.H
        def caught(name, pins, manifest, want):
            p = "\n".join(H.problems(pins, manifest, local=False))
            self.assertIn(want, p, f"{name}: not caught ({p[:200]!r})")
        pins = copy.deepcopy(self.pins)
        name = sorted(pins["alafasy"])[0]
        pins["alafasy"].pop(name)
        caught("an imam's file referenced but not pinned", pins, self.manifest, "no pin")
        pins = copy.deepcopy(self.pins)
        pins["alafasy"]["999999.mp3"] = dict(pins["alafasy"][name])
        caught("a pin no content references", pins, self.manifest, "no content references it")
        pins = copy.deepcopy(self.pins)
        pins["alafasy"][name]["upstream"] = pins["alafasy"][name]["upstream"].replace("Alafasy_128kbps", "Husary_Muallim_128kbps")
        caught("a pin of another reciter's file", pins, self.manifest, "is not EveryAyah's Alafasy file")
        pins = copy.deepcopy(self.pins)
        pins["alafasy"]["001001.mp3"]["sha256"] = "0" * 64
        caught("a lesson ayah's pin that is not sources.json's", pins, self.manifest, "is not sources.json's")
        m = copy.deepcopy(self.manifest)
        t = next(t for t, e in m["words"].items() if e["source"] == "quran.com")
        m["words"][t]["audio"]["url"] = H.NARRATION_PREFIX + "quran-com/wbw/999_999_999.mp3"
        caught("a Quran.com copy referenced with no pin", self.pins, m, "no pin")

    def test_a_delivery_holds_every_file_byte_for_byte(self):
        import tempfile
        H = self.H
        refs, _ = H.referenced()
        with tempfile.TemporaryDirectory() as d:
            out = Path(d)
            self.assertTrue(any("not in" in p for p in H.delivery_problems(out, self.pins, self.manifest)))
            # every file written with the bytes its pin names would need the real files: a planted
            # wrong byte is enough to show the check reads the bytes
            rel = sorted(r for r in refs if r.startswith("alafasy/"))[0]
            f = out / "delivery" / rel
            f.parent.mkdir(parents=True)
            f.write_bytes(b"not the upstream file")
            self.assertTrue(any(f"{rel}: the delivered file is not its pin" in p for p in H.delivery_problems(out, self.pins, self.manifest)))


if __name__ == "__main__":
    unittest.main(verbosity=1)
