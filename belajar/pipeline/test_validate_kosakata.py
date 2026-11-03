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

import kosakata as K
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

    def test_homograph_numbers_are_not_shown(self):
        self.assertEqual(K.headword(">awofaY`2"), K.headword(">awofaY`"))

    def test_search_folding(self):
        self.assertEqual(K.fold("Raḥīm"), "rahim")
        self.assertEqual(K.fold("‘ālamīn"), "alamin")
        self.assertEqual(K.fold("رَحِيم"), "رحيم")
        self.assertEqual(K.fold("ٱللَّه"), K.fold("الله"))


if __name__ == "__main__":
    unittest.main(verbosity=1)
