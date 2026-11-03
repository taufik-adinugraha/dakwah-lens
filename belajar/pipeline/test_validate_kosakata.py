#!/usr/bin/env python3
"""Planted-fault tests for the vocabulary list's checks (kosakata.py): each case plants one fault in
a copy of the files or the meanings and asserts the checks fail with the expected message; the
unmutated copies must pass. Also unit-tests the transliteration rule and the search folding. Faults
only a fresh build can catch are skipped with --no-corpus (CI). Standard library only; run from
belajar/pipeline after build_kosakata.py:

    python3 test_validate_kosakata.py               # with pipeline/cache (local)
    python3 test_validate_kosakata.py --no-corpus   # CI
"""
from __future__ import annotations

import copy
import sys
import unittest

import host_media as H
import kosakata as K
import kosakata_voice as V
from common import load_sources

NO_CORPUS = "--no-corpus" in sys.argv
if NO_CORPUS:
    sys.argv.remove("--no-corpus")
FILES = K.load_files()
AUTHORED = K.load_authored()
SHA = K.authored_sha()
SRC = load_sources()


def check(files=None, authored=None):
    return K.problems(FILES if files is None else files, AUTHORED if authored is None else authored, SHA, SRC)


class Clean(unittest.TestCase):
    def test_the_real_files_pass(self):
        self.assertEqual(check(), [])


class PlantedFaults(unittest.TestCase):
    def setUp(self):
        self.f = copy.deepcopy(FILES)
        self.a = copy.deepcopy(AUTHORED)

    def assertCaught(self, fragment, files=None, authored=None):
        errs = check(self.f if files is None else files, self.a if authored is None else authored)
        self.assertTrue(any(fragment in e for e in errs), f"{fragment!r} not in {errs[:5]}")

    def word(self, rank=1):
        return self.f[K.file_for_rank(rank)]["words"][(rank - 1) % K.WORDS_PER_FILE]

    def test_a_row_out_of_rank_order(self):
        rows = self.f["index.json"]["rows"]
        rows[0], rows[1] = rows[1], rows[0]
        self.assertCaught("ranks are not 1..N")

    def test_counts_that_do_not_add_up(self):
        self.f["index.json"]["total_tokens"] += 1
        self.assertCaught("do not add up")

    def test_a_count_that_breaks_the_order(self):
        self.f["index.json"]["rows"][5]["count"] = 999999
        self.assertCaught("not most frequent first")

    def test_coverage_that_never_reaches_all(self):
        self.f["index.json"]["rows"][-1]["cum"] = 9000
        self.assertCaught("does not climb to 100%")

    def test_a_meaning_edited_by_hand_in_the_output(self):
        self.word(3)["senses"][0]["id"] = "diubah"
        self.assertCaught("differ from the authored file")

    def test_the_index_showing_another_meaning(self):
        self.f["index.json"]["rows"][2]["id"] = "diubah"
        self.assertCaught("index shows other meanings")

    def test_a_typed_headword(self):
        self.word(4)["ar"] = "لا"
        self.f["index.json"]["rows"][3]["ar"] = "لا"
        self.assertCaught("was typed, not derived")

    def test_a_transliteration_that_cannot_be_read(self):
        self.word(5)["translit"] = "nabīī"
        self.f["index.json"]["rows"][4]["translit"] = "nabīī"
        self.assertCaught("cannot be read")

    def test_a_cited_ayah_with_no_entry(self):
        loc = self.word(1)["senses"][0]["ayat"][0]
        name = K.file_for_sura(int(loc.split(":")[0]))
        self.f[name]["ayat"] = [e for e in self.f[name]["ayat"] if e["loc"] != loc]
        self.assertCaught(f"{loc} is cited but has no entry")

    def test_an_ayah_nobody_cites(self):
        cited = {loc for n, f in self.f.items() if n.startswith("words-") for w in f["words"] for s in w["senses"] for loc in s["ayat"]}
        name = next(n for n in self.f if n.startswith("ayat-"))
        spare = next(f"{self.f[name]['sura']}:{a}" for a in range(1, 300) if f"{self.f[name]['sura']}:{a}" not in cited)
        self.f[name]["ayat"].append({"loc": spare, "ar": "ٱللَّهُ", "translation": {"text": "x", "footnotes": []}})
        self.assertCaught(f"{spare} has an ayat entry that no word cites")

    def test_a_footnote_marker_without_its_footnote(self):
        name = next(n for n in self.f if n.startswith("ayat-"))
        self.f[name]["ayat"][0]["translation"]["text"] += " [999]"
        self.assertCaught("QuranEnc")

    def test_a_drifted_data_version(self):
        self.f["index.json"]["data_versions"]["tanzil"] = "uthmani-0 sha256:0"
        self.assertCaught("data_versions out of date")

    def test_a_status_that_promises_a_review(self):
        self.f["index.json"]["status"] = "reviewed"
        self.assertCaught("no review step")

    def test_a_word_with_no_recording(self):
        del self.word(3)["voice"]
        self.assertCaught("differs from pipeline/kosakata_voice.json")

    def test_a_recording_of_another_place(self):
        self.word(3)["voice"]["loc"] = "1:1:1"
        self.assertCaught("differs from pipeline/kosakata_voice.json")

    def test_a_list_row_that_plays_another_place(self):
        self.f["index.json"]["rows"][2]["v"] = "1:1:1 0 500"
        self.assertCaught("the index plays another recording")

    def test_too_many_senses(self):
        lem = next(iter(self.a["lemmas"]))
        s = self.a["lemmas"][lem]["senses"][0]
        self.a["lemmas"][lem]["senses"] = [s] * 5
        self.assertCaught("5 senses")

    def test_arabic_in_a_gloss(self):
        lem = next(iter(self.a["lemmas"]))
        self.a["lemmas"][lem]["senses"][0]["id"] = "مِن"
        self.assertCaught("Arabic script")

    def test_capitals_for_emphasis(self):
        lem = next(iter(self.a["lemmas"]))
        self.a["lemmas"][lem]["senses"][0]["en"] = "FROM here"
        self.assertCaught("capitals for emphasis")

    def test_a_sense_with_no_ayah(self):
        lem = next(iter(self.a["lemmas"]))
        self.a["lemmas"][lem]["senses"][0]["ayat"] = []
        self.assertCaught("a sense with no ayah")

    def test_the_operators_nasiya_decision_undone(self):
        for s in self.a["lemmas"]["nasiYa"]["senses"]:
            if s["en"] == "abandon, disregard":
                s["id"], s["en"] = "lupa", "forget"
        self.assertCaught("the operator's sense")

    @unittest.skipIf(NO_CORPUS, "needs pipeline/cache")
    def test_a_citation_where_the_word_does_not_occur(self):
        corpus, segs = K.load_corpus_and_qac()
        self.a["lemmas"]["min"]["senses"][0]["ayat"] = ["112:1"]  # no min in Al-Ikhlas 1
        errs = K.corpus_problems(FILES, self.a, SHA, corpus, segs, K.lexeme_ids())
        self.assertTrue(any("where QAC does not have it" in e for e in errs), errs[:3])

    @unittest.skipIf(NO_CORPUS, "needs pipeline/cache")
    def test_ayah_text_that_was_altered(self):
        corpus, segs = K.load_corpus_and_qac()
        name = next(n for n in self.f if n.startswith("ayat-"))
        self.f[name]["ayat"][0]["ar"] += "x"
        errs = K.corpus_problems(self.f, AUTHORED, SHA, corpus, segs, K.lexeme_ids())
        self.assertTrue(any("differs from a fresh build" in e for e in errs), errs[:3])


class Pins(unittest.TestCase):
    GOOD = {"loc": "2:30:2", "form": "قَالَ", "qc_text": "قَالَ", "sha256": "a" * 64, "bytes": 100, "ms": 900, "start": 30, "end": 700}

    def caught(self, fragment, wanted=None, **change):
        pin = {**self.GOOD, **change}
        errs = V.pin_problems({"words": {"qaAla": pin}}, wanted)
        self.assertTrue(any(fragment in e for e in errs), f"{fragment!r} not in {errs}")

    def test_a_sound_pin_passes(self):
        self.assertEqual(V.pin_problems({"words": {"qaAla": self.GOOD}}), [])

    def test_the_real_pins_pass(self):
        self.assertEqual(V.pin_problems(V.load_pins()), [])

    def test_a_file_number_that_names_another_word(self):
        self.caught("the file is another word", qc_text="يَقُولُ")

    def test_a_word_longer_than_its_file(self):
        self.caught("not a plausible word", end=5000)

    def test_a_word_too_short_to_be_one(self):
        self.caught("not a plausible word", start=690)

    def test_a_malformed_checksum(self):
        self.caught("sha256", sha256="abc")

    def test_a_malformed_place(self):
        self.caught("not a word's place", loc="2:30")

    def test_a_pin_the_rule_would_not_choose(self):
        self.caught("the rule chooses", {"qaAla": {"loc": "7:5:1", "form": "قَالَ", "final": False}})

    def test_a_word_with_no_pin(self):
        self.caught("no recording pinned", {"qaAla": {"loc": "2:30:2", "form": "قَالَ", "final": False}, "kaAna": {"loc": "2:75:6", "form": "كَانَ", "final": False}})

    def test_a_pin_for_no_word(self):
        self.caught("no such lemma", {})

    def test_the_address_is_the_place(self):
        self.assertEqual(V.url_of("2:30:2"), "/belajar/media/narration/quran-com/wbw/002_030_002.mp3")
        self.assertEqual(V.upstream_of("114:6:3"), "https://audio.qurancdn.com/wbw/114_006_003.mp3")

    def test_the_row_carries_the_word_files_place(self):
        self.assertEqual(V.row_voice(self.GOOD), "2:30:2 30 700")
        self.assertNotIn("final", V.word_voice(self.GOOD))
        self.assertIs(V.word_voice({**self.GOOD, "final": True})["final"], True)

    def test_a_first_letter_doubled_by_the_word_before(self):
        self.assertTrue(V.assimilated("مُّبِينٌ"))
        self.assertFalse(V.assimilated("مُبِينٌ"))
        self.assertFalse(V.assimilated("رَبِّ"))
        self.assertFalse(V.assimilated("ٱلَّذِى"))

    def test_the_media_check_knows_every_word(self):
        refs, bad = H.referenced()
        self.assertEqual(bad, [])
        for w in FILES[K.file_for_rank(1)]["words"]:
            rel = w["voice"]["url"][len(H.NARRATION_PREFIX):]
            self.assertIn(rel, refs, w["lemma"])
            self.assertEqual(H.pin_of(rel, H.load_pins(), None)["sha256"], w["voice"]["sha256"], w["lemma"])


@unittest.skipIf(NO_CORPUS, "needs pipeline/cache")
class PlaceRule(unittest.TestCase):
    """The faults found by reading the first choices: they must not come back."""

    @classmethod
    def setUpClass(cls):
        corpus, segs = K.load_corpus_and_qac()
        cls.places = V.places(segs, corpus.T, K.headword)

    def test_every_word_has_a_place(self):
        self.assertEqual(sorted(set(AUTHORED["lemmas"]) - set(self.places)), [])

    def test_a_word_qac_groups_with_another_plays_itself(self):
        self.assertEqual(V.skeleton(self.places["EaZiym"]["form"]), V.skeleton("عَظِيم"))

    def test_an_active_verb_does_not_play_its_passive(self):
        self.assertNotIn("أُوتِ", self.places["A^taY"]["form"])

    def test_the_headword_beats_a_more_frequent_form(self):
        self.assertEqual(V.skeleton(self.places["{l~a*iY"]["form"]), V.skeleton(K.headword("{l~a*iY")))

    def test_inside_an_ayah_before_at_its_end(self):
        self.assertFalse(self.places["qaAla"]["final"])

    def test_no_ayah_that_tanzil_and_qac_count_differently(self):
        for lem, p in self.places.items():
            self.assertNotIn(":".join(p["loc"].split(":")[:2]), {"2:181", "8:6", "13:37", "37:130"}, lem)


class Rules(unittest.TestCase):
    def test_transliteration(self):
        cases = {
            "{ll~ah": "Allāh", "r~aHiym": "raḥīm", "yawom": "yaum", "$aYo'": "syai’", "Salaw`p": "ṣalāh",
            "{sotagofara": "istagfara", "{sotawaY`^": "istawā", "{som": "ism", "EaAlamiyn": "‘ālamīn",
        }
        for bw, want in cases.items():
            self.assertEqual(K.translit(bw), want, bw)

    def test_final_shaddah_particles_get_their_vowel_and_nouns_do_not(self):
        self.assertEqual(K.translit("<in~", {"ACC"}), "inna")
        self.assertEqual(K.translit("vum~", {"CONJ"}), "ṡumma")
        self.assertEqual(K.translit("rab~", {"N"}), "rabb")

    def test_a_dotless_ya_that_is_a_consonant(self):
        cases = {
            "n~abiY~": "nabiyy", "waliY~": "waliyy", "bunaY~": "bunayy", ">aY~": "ayy", "HaY~a": "ḥayya",
            "nasiYa": "nasiya", "xa$iYa": "khasyiya", "r~aDiYa": "raḍiya",
            "waHoY": "waḥy", "ra>oY": "ra’y", "$aYo'": "syai’", "yasotaHoYi.^": "yastaḥyī",
        }
        for bw, want in cases.items():
            self.assertEqual(K.translit(bw), want, bw)

    def test_a_dotless_ya_that_is_a_long_vowel_stays_one(self):
        cases = {"fiY": "fī", "EalaY`": "‘alā", "hadaY": "hadā", "bariY^'": "barī’", "majorY`": "majrā", "t~aworaY`p": "taurāh"}
        for bw, want in cases.items():
            self.assertEqual(K.translit(bw), want, bw)

    def test_letters_that_are_written_but_not_read(self):
        cases = {
            "hudFY": "hudan", ">abadFA": "abadan", "m~usam~FY": "musamman", "TuwFY": "ṭuwan", "{moru&NA": "imru’un",
            "yarojuwA@": "yarjū", "yadora&uA@": "yadra’u", "SaAluwA": "ṣālū", "miA}ap": "mi’ah", "r~ibaw`A": "ribā",
            "wu,riYa": "wūriya",
        }
        for bw, want in cases.items():
            self.assertEqual(K.translit(bw), want, bw)

    def test_a_hamzat_wasl_before_lam(self):
        cases = {
            "{l~a*iY": "allażī", "{ll~a`t": "allāt", "{ll~ahum~a": "Allāhumma", "{ll~ah": "Allāh",
            "{lotaqaY": "iltaqā", "{lotaf~ati": "iltaffati", "{loga": "ilga",
            "{loyasaEa": "alyasa‘a", "{loEuz~aY`": "al‘uzzā",
        }
        for bw, want in cases.items():
            self.assertEqual(K.translit(bw), want, bw)

    def test_homograph_numbers_are_not_shown(self):
        self.assertEqual(K.headword(">awofaY`2"), K.headword(">awofaY`"))

    def test_search_folding(self):
        self.assertEqual(K.fold("Raḥīm"), "rahim")
        self.assertEqual(K.fold("‘ālamīn"), "alamin")
        self.assertEqual(K.fold("رَحِيم"), "رحيم")
        self.assertEqual(K.fold("ٱللَّه"), K.fold("الله"))


if __name__ == "__main__":
    unittest.main(verbosity=1)
