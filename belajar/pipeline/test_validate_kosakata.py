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
import pathlib
import re
import sys
import unittest
from unittest import mock

import host_media as H
import kosakata as K
import kosakata_path as P
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

    def path(self):
        return self.f["path.json"]

    def test_a_word_missing_from_a_level(self):
        self.path()["levels"][1]["batches"][0].pop()
        self.assertCaught("does not hold each of words 1 to 100 once")

    def test_a_word_in_two_batches(self):
        b = self.path()["levels"][1]["batches"]
        b[0][0] = b[1][0]
        self.assertCaught("does not hold each of words 1 to 100 once")

    def test_a_batch_of_the_wrong_size(self):
        b = self.path()["levels"][1]["batches"]
        b[1].append(b[0].pop())
        self.assertCaught("holds 9 words")

    def test_two_words_that_clash_in_one_batch(self):
        b = self.path()["levels"][1]["batches"]
        x, y = next((x, y) for x in b[0] for y in b[1] if P.clash(self.word_by_rank(x), self.word_by_rank(y)))
        z = next(r for r in b[0] if r != x)
        b[0][b[0].index(z)], b[1][b[1].index(y)] = y, z
        self.assertCaught("clash")

    def word_by_rank(self, rank):
        return self.f[K.file_for_rank(rank)]["words"][(rank - 1) % K.WORDS_PER_FILE]

    def test_a_level_0_part_with_no_batch(self):
        self.path()["levels"][0]["batches"][0].pop()
        self.assertCaught("Level 0's batches and its parts differ")

    def test_a_part_whose_example_is_not_its_word(self):
        self.path()["parts"]["wa"]["examples"][0]["word"][2] = "x"
        self.assertCaught("does not join back")

    def test_a_part_with_another_recording(self):
        self.path()["parts"]["wa"]["examples"][0]["voice"]["sha256"] = "b" * 64
        self.assertCaught("differs from pipeline/kosakata_voice.json")

    def test_a_word_of_another_kind_in_the_index(self):
        self.f["index.json"]["rows"][2]["k"] = "name" if self.word(3)["kind"] != "name" else "verb"
        self.assertCaught("kind")

    def test_an_example_the_word_does_not_cite(self):
        self.word(3)["example"]["loc"] = "112:1"
        self.assertCaught("is not an ayah it cites")

    def test_a_mark_past_the_end_of_the_ayah(self):
        self.word(3)["example"]["hi"] = [999]
        self.assertCaught("marks a word")

    # The test's ayah question plays the marked word (operator 2026-11-04: "the screen highlight
    # 'wa man' but the sound only 'man'"): the word's own recording where that says it, else the
    # recording of the marked place. Each way that can go wrong:

    def tested(self):
        no_test = set(self.path()["no_test"])
        return [w for n in sorted(self.f) if n.startswith("words-") for w in self.f[n]["words"] if w["rank"] <= 2000 and w["rank"] not in no_test]

    def own_recording(self):
        """A tested word whose ayah question plays the marked place's own recording."""
        return next(w for w in self.tested() if (w.get("example") or {}).get("voice"))

    def says_it_already(self):
        """A tested word whose own recording already says its example's marked tokens."""
        ayat = {e["loc"]: e for n, f in self.f.items() if n.startswith("ayat-") for e in f["ayat"]}
        pins = V.load_pins()["words"]
        for w in self.tested():
            ex = w.get("example")
            if ex and not ex.get("voice") and V.says_marked(ayat[ex["loc"]]["ar"].split(" "), ex["hi"], pins[w["lemma"]]) and len(ayat[ex["loc"]]["ar"]) <= V.SHORT_AYAH_CHARS:
                return w
        raise AssertionError("no such word")

    def test_an_ayah_question_that_needs_its_own_recording_and_has_none(self):
        del self.own_recording()["example"]["voice"]
        self.assertCaught("needs the recording of")

    def test_a_recording_on_an_example_the_words_own_recording_already_says(self):
        self.says_it_already()["example"]["voice"] = copy.deepcopy(self.own_recording()["example"]["voice"])
        self.assertCaught("does not need")

    def test_an_example_recording_of_another_place(self):
        self.own_recording()["example"]["voice"]["loc"] = "1:1:1"
        self.assertCaught("differs from pipeline/kosakata_voice.json")

    def test_an_example_recording_edited_by_hand(self):
        self.own_recording()["example"]["voice"]["start"] += 1
        self.assertCaught("differs from pipeline/kosakata_voice.json")

    def planted_pins(self, change):
        pins = copy.deepcopy(V.load_pins())
        change(pins)
        with mock.patch.object(V, "load_pins", return_value=pins):
            return check(self.f)

    def test_an_example_recording_with_no_pin(self):
        place = self.own_recording()["example"]["voice"]["loc"]
        errs = self.planted_pins(lambda pins: pins["examples"].pop(place))
        self.assertTrue(any("no recording pinned for the example's place" in e for e in errs), errs[:5])

    def test_an_example_pin_no_ayah_question_uses(self):
        def add(pins):
            pins["examples"]["1:1:1"] = {**next(iter(pins["examples"].values())), "loc": "1:1:1"}

        errs = self.planted_pins(add)
        self.assertTrue(any("no word's ayah question uses it" in e for e in errs), errs[:5])

    def test_an_example_pin_filed_under_another_place(self):
        def move(pins):
            loc = next(iter(pins["examples"]))
            pins["examples"][loc]["loc"] = "1:1:1"

        errs = self.planted_pins(move)
        self.assertTrue(any("the pin is for" in e for e in errs), errs[:5])

    def test_a_semicolon_inside_a_gloss(self):
        lem = next(iter(self.a["lemmas"]))
        self.a["lemmas"][lem]["senses"][0]["id"] = "dari; ke"
        self.assertCaught("has a semicolon")

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

    def example_caught(self, fragment, pins, wanted):
        errs = V.pin_problems({"words": {}, **pins}, None, wanted)
        self.assertTrue(any(fragment in e for e in errs), f"{fragment!r} not in {errs}")

    def test_a_sound_example_pin_passes(self):
        self.assertEqual(V.pin_problems({"words": {}, "examples": {"2:30:2": self.GOOD}}, None, {"2:30:2": "قَالَ"}), [])

    def test_an_example_pin_whose_file_is_another_word(self):
        self.example_caught("the file is another word", {"examples": {"2:30:2": {**self.GOOD, "qc_text": "يَقُولُ"}}}, None)

    def test_an_ayah_question_that_needs_a_recording_nobody_pinned(self):
        self.example_caught("no recording pinned", {"examples": {}}, {"2:30:2": "قَالَ"})

    def test_an_example_pin_no_ayah_question_needs(self):
        self.example_caught("no ayah question needs it", {"examples": {"2:30:2": self.GOOD}}, {})

    def test_an_example_pin_of_another_form_than_the_question_marks(self):
        self.example_caught("the ayah question marks", {"examples": {"2:30:2": self.GOOD}}, {"2:30:2": "وَقَالَ"})

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


class ExampleRule(unittest.TestCase):
    """What the test's ayah question may play (operator 2026-11-04: "the screen highlight 'wa man'
    but the sound only 'man'"): the strings are the report's own."""

    TOKS = ["قَالَ", "وَمَن", "فِى"]

    def test_wa_man_is_not_man(self):
        self.assertFalse(V.says_marked(self.TOKS, [1], {"form": "مَن"}))
        self.assertTrue(V.says_marked(self.TOKS, [1], {"form": "وَمَن"}))

    def test_every_marked_token_must_be_the_recording(self):
        self.assertFalse(V.says_marked(["مَن", "وَمَن"], [0, 1], {"form": "مَن"}))
        self.assertTrue(V.says_marked(["مَن", "x", "مَن"], [0, 2], {"form": "مَن"}))

    def test_a_stop_form_is_the_marked_word_only_where_that_ends_its_ayah_too(self):
        stop = {"form": "أَحَدٌ", "final": True}
        self.assertTrue(V.says_marked(["كُفُوًا", "أَحَدٌ"], [1], stop))
        self.assertFalse(V.says_marked(["أَحَدٌ", "كُفُوًا"], [0], stop))
        self.assertTrue(V.says_marked(["أَحَدٌ", "كُفُوًا"], [0], {"form": "أَحَدٌ"}))

    def test_one_recording_says_marks_spelt_alike(self):
        self.assertTrue(V.one_spelling(["مَن", "x", "مَن"], [0, 2]))
        self.assertFalse(V.one_spelling(["مَن", "وَمَن"], [0, 1]))

    def test_the_place_to_record(self):
        voice = {"form": "مَن"}
        self.assertEqual(K.recording_place("26:65", [1], self.TOKS, voice, True), "26:65:2")
        self.assertEqual(K.recording_place("26:65", [0, 2], ["مَن", "x", "مَن"], {"form": "غَيْر"}, True), "26:65:1")

    def test_no_place_to_record_when_it_is_not_needed_or_cannot_help(self):
        voice = {"form": "مَن"}
        self.assertIsNone(K.recording_place("26:65", [1], self.TOKS, voice, False), "a word the path does not test")
        self.assertIsNone(K.recording_place("26:65", [1], self.TOKS, {"form": "وَمَن"}, True), "the word's own recording says it")
        self.assertIsNone(K.recording_place("26:65", [0, 1], ["مَن", "وَمَن"], {"form": "غَيْر"}, True), "marks spelt differently")
        self.assertIsNone(K.recording_place("26:65", [0], ["x" * 100, "y" * 100], voice, True), "an ayah too long to be asked")

    def test_the_apps_limit_on_a_long_ayah_is_this_ones(self):
        ts = (pathlib.Path(__file__).resolve().parents[1] / "src/lib/kosakata-path-data.ts").read_text(encoding="utf-8")
        m = re.search(r"const SHORT_AYAH_CHARS = (\d+);", ts)
        self.assertIsNotNone(m, "SHORT_AYAH_CHARS not found in src/lib/kosakata-path-data.ts")
        self.assertEqual(int(m.group(1)), V.SHORT_AYAH_CHARS)


@unittest.skipIf(NO_CORPUS, "needs pipeline/cache")
class ExampleChoice(unittest.TestCase):
    """The verse a word is shown in, chosen against the real corpus."""

    @classmethod
    def setUpClass(cls):
        cls.corpus, cls.segs = K.load_corpus_and_qac()
        cls.table = {e["rank"]: e for e in K.lemma_table(cls.segs, cls.corpus.T)}
        cls.tokens, _ = V.counted_alike(cls.corpus.T, cls.segs)
        cls.positions = K.lemma_positions(cls.segs)
        cls.pins = V.load_pins()["words"]

    def pick(self, rank, tested):
        lem = self.table[rank]["lemma"]
        ex = K.example_of({"senses": AUTHORED["lemmas"][lem]["senses"]}, self.positions[lem], self.corpus, self.tokens, self.pins[lem], tested)
        return lem, ex, self.tokens[tuple(int(x) for x in ex["loc"].split(":"))]

    def test_man_is_shown_where_man_is_heard(self):
        lem, ex, toks = self.pick(12, True)
        self.assertEqual(self.table[12]["translit"], "man")
        self.assertTrue(V.says_marked(toks, ex["hi"], self.pins[lem]), "the ayah question can speak")

    def test_man_was_shown_as_wa_man_before_the_path_chose_by_sound(self):
        lem, ex, toks = self.pick(12, False)
        self.assertFalse(V.says_marked(toks, ex["hi"], self.pins[lem]))
        self.assertTrue(toks[ex["hi"][0]].endswith(self.pins[lem]["form"]))

    def test_a_word_the_path_does_not_test_keeps_the_shortest_verse(self):
        rank = 2500
        lem, ex, _ = self.pick(rank, False)
        senses = AUTHORED["lemmas"][lem]["senses"]
        self.assertEqual(ex, K.example_of({"senses": senses}, self.positions[lem], self.corpus, self.tokens, self.pins[lem], False))
        self.assertFalse(P.tested(rank, lem))

    def test_what_the_builder_wants_recorded_is_what_is_pinned(self):
        wanted = K.example_recordings(list(self.table.values()), AUTHORED["lemmas"], self.positions, self.corpus, self.tokens, self.pins)
        self.assertEqual(sorted(wanted), sorted(V.load_pins()["examples"]))


class Path(unittest.TestCase):
    def test_the_most_frequent_tag_decides_the_kind(self):
        self.assertEqual(P.kind_of({"V": 5, "N": 1}), "verb")
        self.assertEqual(P.kind_of({"N": 5, "V": 1}), "noun")
        self.assertEqual(P.kind_of({"PN": 3}), "name")
        self.assertEqual(P.kind_of({"P": 3}), "particle")

    def test_look_alikes_and_synonyms_clash(self):
        word = lambda ar, gloss: {"ar": ar, "senses": [{"id": gloss, "en": gloss, "ayat": []}]}
        self.assertTrue(P.clash(word("مِن", "dari"), word("مَن", "orang yang")))
        self.assertTrue(P.clash(word("مِن", "dari"), word("عَن", "dari")))
        self.assertTrue(P.clash(word("قَد", "sungguh (penegasan)"), word("إِنّ", "sungguh (penegas)")))
        self.assertFalse(P.clash(word("يَوْم", "hari"), word("أَرْض", "bumi")))

    def test_a_batch_holds_no_clash_when_there_is_room(self):
        word = lambda r, g: {"rank": r, "ar": f"ا{chr(0x0628 + r)}", "senses": [{"id": g, "en": g, "ayat": []}]}
        words = [word(i, f"g{i}") for i in range(1, 21)]
        words[5]["senses"][0]["id"] = "g1"
        out = P.batches(words)
        self.assertEqual([len(b) for b in out], [10, 10])
        self.assertEqual(sorted(w["rank"] for b in out for w in b), list(range(1, 21)))
        self.assertNotIn(words[5], out[0])

    def test_a_part_splits_on_letters_with_their_marks(self):
        self.assertEqual(P.split_part("وَلَا", "prefix", 1), ["", "وَ", "لَا"])
        self.assertEqual(P.split_part("رَبِّهِمْ", "suffix", 2), ["رَبِّ", "هِمْ", ""])
        self.assertEqual(P.split_part("رَبِّهِۦ", "suffix", 1), ["رَبِّ", "هِۦ", ""])

    def test_the_real_parts_are_well_formed(self):
        parts = P.load_parts()
        self.assertEqual(len(parts), 17)
        self.assertEqual({p["side"] for p in parts}, {"prefix", "suffix"})
        for p in parts:
            self.assertNotEqual(p["card"], p["test"], p["key"])

    @unittest.skipIf(NO_CORPUS, "needs pipeline/cache")
    def test_a_part_at_the_end_of_an_ayah_is_refused(self):
        corpus, segs = K.load_corpus_and_qac()
        tokens, count = V.counted_alike(corpus.T, segs)
        part = {**P.load_parts()[0], "card": "1:7:9"}
        with self.assertRaises(ValueError):
            P.part_table([part], segs, tokens, count, AUTHORED["lemmas"], V.load_pins())

    @unittest.skipIf(NO_CORPUS, "needs pipeline/cache")
    def test_a_part_the_word_does_not_have_is_refused(self):
        corpus, segs = K.load_corpus_and_qac()
        tokens, count = V.counted_alike(corpus.T, segs)
        part = {**P.load_parts()[0], "card": "2:10:10"}  # bi-, not wa-
        with self.assertRaises(ValueError):
            P.part_table([part], segs, tokens, count, AUTHORED["lemmas"], V.load_pins())


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
