#!/usr/bin/env python3
"""Planted-fault tests for the ayah popup data checks (ayat.problems, validate_ayat.py): each case
plants one fault in a copy of content/ayat/locations.json (or of the lessons, or of sources.json)
and asserts that the checks fail with the expected message; the unmutated copy must pass. After a
fault the entries hash is recomputed (as by someone who knew to), so every check is shown to catch
its fault on its own; the one case that leaves the hash stale proves the hash catches a hand edit.
Faults only the pinned corpus can catch (Tanzil's bytes, QuranEnc's text, a fresh build) are
listed as skipped with --no-corpus (CI). Also unit-tests the name folding and the sura list.
Standard library only; run from belajar/pipeline after build_ayat.py:

    python3 test_validate_ayat.py               # with pipeline/cache (local)
    python3 test_validate_ayat.py --no-corpus   # CI
"""
from __future__ import annotations

import copy
import sys
import unittest

import ayat as AY
from common import load_sources

NO_CORPUS = "--no-corpus" in sys.argv
if NO_CORPUS:
    sys.argv.remove("--no-corpus")
CONTENT = AY.load_content()
LESSONS = AY.load_lessons()
SRC = load_sources()
CORPUS = None if NO_CORPUS else AY.load_corpus({AY.parse_loc(e["loc"])[0] for e in CONTENT["ayat"]})


def run_check(content, lessons=None, src=None):
    return AY.problems(content, lessons or LESSONS, src or SRC, CORPUS)


def entry(c, loc):
    return next(e for e in c["ayat"] if e["loc"] == loc)


def first_with_footnotes(c, lesson=False):
    lesson_locs = {a["loc"] for L in LESSONS.values() for a in L["ayat"]}
    return next(e for e in c["ayat"] if e["translation"]["footnotes"] and ((e["loc"] in lesson_locs) == lesson))


def rehash(c):
    c["data_versions"]["entries"] = f"sha256:{AY.entries_sha256(c)}"


def on_entry(loc, fn):
    def f(c, L, S):
        fn(entry(c, loc))
    return f


# A non-lesson ayah with an ayah-1 basmalah heading in Tanzil, and one far from any lesson.
HEADED = next(e["loc"] for e in CONTENT["ayat"] if e["loc"].endswith(":1") and AY.parse_loc(e["loc"])[0] not in (1, 9, 112, 113, 114))
FAR = "2:282" if any(e["loc"] == "2:282" for e in CONTENT["ayat"]) else CONTENT["ayat"][10]["loc"]
BASMALAH = entry(CONTENT, "1:1")["ar"]


def drop(loc):
    def f(c, L, S):
        c["ayat"] = [e for e in c["ayat"] if e["loc"] != loc]
    return f


def add_extra(c, L, S):
    # No fact locates Al-'Asr; the entry is put in its mushaf place.
    c["ayat"].append({"loc": "103:2", "ar": BASMALAH, "translation": {"text": "x", "footnotes": []}})
    c["ayat"].sort(key=lambda x: AY.parse_loc(x["loc"]))


def swap_order(c, L, S):
    c["ayat"][3], c["ayat"][4] = c["ayat"][4], c["ayat"][3]


def duplicate(c, L, S):
    c["ayat"].insert(5, copy.deepcopy(c["ayat"][4]))


def fact_gains_location(c, L, S):
    L["al-fatihah"]["facts"][0]["locations"].append("103:1")


def lesson_translation(c, L, S):
    entry(c, "1:2")["translation"]["text"] = entry(c, "1:3")["translation"]["text"]


def footnote_marker_missing(c, L, S):
    e = first_with_footnotes(c)
    e["translation"]["text"] = AY.MARKER.sub("", e["translation"]["text"])


def footnote_unmarked(c, L, S):
    e = first_with_footnotes(c)
    e["translation"]["footnotes"][0] = AY.MARKER.sub("", e["translation"]["footnotes"][0], count=1).strip()


def footnote_dropped_lesson(c, L, S):
    entry(c, "1:4")["translation"]["footnotes"] = []
    entry(c, "1:4")["translation"]["text"] = AY.MARKER.sub("", entry(c, "1:4")["translation"]["text"])


def label(value):
    def f(c, L, S):
        c["translation"]["source_label"] = value
    return f


def pin_drift(c, L, S):
    c["sura_files"]["2"] = "0" * 64


def sura_file_missing(c, L, S):
    del c["sura_files"]["2"]


def stale_version(c, L, S):
    c["data_versions"]["tanzil"] = "uthmani-1.0 sha256:" + "0" * 64


def name(n, value):
    def f(c, L, S):
        c["names"][str(n)] = value
    return f


def extra_name(c, L, S):
    c["names"]["103"] = "Al-'Asr"


def extra_key(c, L, S):
    c["review_notes"] = "x"


def no_hash(c, L, S):
    """Left stale: the case this hash exists for."""


# (name, mutation(content, lessons, sources), expected substring, needs the corpus, rehash after)
MUTATIONS = [
    ("a fact location without an entry", drop(FAR), f"no entry for {FAR}", False, True),
    ("a fact gains a location, file not rebuilt", fact_gains_location, "no entry for 103:1", False, True),
    ("an entry no fact locates", add_extra, "no fact locates it", False, True),
    ("entries out of mushaf order", swap_order, "not in mushaf order", False, True),
    ("an entry listed twice", duplicate, "listed twice", False, True),
    ("Latin in the Arabic", on_entry(FAR, lambda e: e.__setitem__("ar", e["ar"] + " (2:282)")), "not Arabic script", False, True),
    ("a double space in the Arabic", on_entry(FAR, lambda e: e.__setitem__("ar", e["ar"].replace(" ", "  ", 1))), "not Arabic script", False, True),
    ("a lesson ayah's Arabic not the lesson's", on_entry("1:2", lambda e: e.__setitem__("ar", BASMALAH)), "the Arabic differs from content/al-fatihah.json", False, True),
    ("a lesson ayah's translation not the lesson's", lesson_translation, "the translation differs from content/al-fatihah.json", False, True),
    ("a lesson ayah's footnote dropped", footnote_dropped_lesson, "the translation differs from content/al-fatihah.json", False, True),
    ("a footnote marker gone from the text", footnote_marker_missing, "footnote markers in the text", False, True),
    ("a footnote without its [n] marker", footnote_unmarked, "does not start with its [n] marker", False, True),
    ("the credit relabelled Kemenag 2019", label("Terjemahan Kemenag 2019"), "never 'Kemenag 2019'", False, True),
    ("the credit not QuranEnc's title", label("Terjemahan Kementerian Agama"), "not QuranEnc's title", False, True),
    ("a sura file's pin not sources.json's", pin_drift, "is not the sources.json pin", False, True),
    ("a sura file missing from sura_files", sura_file_missing, "suras with entries but none here ['2']", False, True),
    ("a stale data version", stale_version, "data_versions.tanzil", False, True),
    ("a name the fact cards spell otherwise", name(35, "Fatir"), "fact alhamdulillah writes 'Fathir'", False, True),
    ("a lesson surah renamed", name(112, "Al-Ikhlash"), "the lesson's name_id", False, True),
    ("a name in another script", name(2, "Al-Baqarah البقرة"), "not a plain-letter name", False, True),
    ("a name for a sura with no entry", extra_name, "suras without an entry ['103']", False, True),
    ("an unexpected top-level key", extra_key, "top-level keys", False, True),
    ("a hand-edited translation, hash left stale", on_entry(FAR, lambda e: e["translation"].__setitem__("text", e["translation"]["text"] + " ")), "data_versions.entries", False, False),
    ("the hand-edited translation, rehashed", on_entry(FAR, lambda e: e["translation"].__setitem__("text", e["translation"]["text"].replace("Allah", "Tuhan", 1))), "not byte-identical to QuranEnc", True, True),
    ("another ayah's Arabic", on_entry(FAR, lambda e: e.__setitem__("ar", entry(CONTENT, "2:1")["ar"] if any(x["loc"] == "2:1" for x in CONTENT["ayat"]) else BASMALAH)), "not Tanzil's bytes", True, True),
    ("the surah-heading basmalah kept", on_entry(HEADED, lambda e: e.__setitem__("ar", BASMALAH + " " + e["ar"])), "not Tanzil's bytes", True, True),
    ("a footnote not QuranEnc's verbatim", lambda c, L, S: first_with_footnotes(c)["translation"]["footnotes"].__setitem__(0, first_with_footnotes(c)["translation"]["footnotes"][0] + " (catatan)"), "verbatim", True, True),
    ("a name not QuranEnc's", name(2, "Al-Baqara"), "QuranEnc's name, folded", True, True),
]


def mutated(mutate, rehash_after):
    c, L, S = copy.deepcopy(CONTENT), copy.deepcopy(LESSONS), copy.deepcopy(SRC)
    mutate(c, L, S)
    if rehash_after:
        rehash(c)
    return c, L, S


class AyatValidation(unittest.TestCase):
    def test_unmutated_passes(self):
        self.assertEqual(run_check(copy.deepcopy(CONTENT)), [])

    def test_mutations_fail(self):
        for title, mutate, expect, needs, again in MUTATIONS:
            if needs and CORPUS is None:
                continue
            with self.subTest(title):
                errs = run_check(*mutated(mutate, again))
                self.assertTrue(any(expect in e for e in errs), f"{title}: expected {expect!r} in {errs[:4]}")


class Names(unittest.TestCase):
    def test_fold(self):
        self.assertEqual(AY.fold_name("Al-Fātiḥah"), "Al-Fatihah")
        self.assertEqual(AY.fold_name("Āli 'Imrān"), "Ali 'Imran")
        self.assertEqual(AY.fold_name("An-Nisā`"), "An-Nisa'")
        self.assertEqual(AY.fold_name("Aż-Żāriyāt"), "Az-Zariyat")
        self.assertEqual(AY.fold_name("Al-Muddaṡṡir"), "Al-Muddassir")

    def test_loose_key(self):
        self.assertEqual(AY.loose_key("Fathir"), AY.loose_key("Fāṭir"))
        self.assertEqual(AY.loose_key("Al-Infithar"), AY.loose_key("Al-Infiṭār"))
        self.assertNotEqual(AY.loose_key("Al-Falaq"), AY.loose_key("Al-Fil"))

    def test_lesson_names_win(self):
        listing = {n: {"ayat": 1, "ar": "x", "name": "X"} for n in range(1, 115)}
        listing.update({1: {"ayat": 7, "ar": "x", "name": "Al-Fātiḥah"}, 35: {"ayat": 45, "ar": "x", "name": "Fāṭir"},
                        82: {"ayat": 19, "ar": "x", "name": "Al-Infiṭār"}, 112: {"ayat": 4, "ar": "x", "name": "Al-Ikhlāṣ"},
                        113: {"ayat": 5, "ar": "x", "name": "Al-Falaq"}, 114: {"ayat": 6, "ar": "x", "name": "An-Nās"}})
        names = AY.display_names(listing)
        self.assertEqual([names[n] for n in (1, 35, 82, 112, 113, 114)],
                         ["Al-Fatihah", "Fathir", "Al-Infithar", "Al-Ikhlas", "Al-Falaq", "An-Nas"])
        listing[35] = {"ayat": 45, "ar": "x", "name": "Yāsīn"}
        with self.assertRaises(AY.AyatError):
            AY.display_names(listing)

    def test_sura_list_text(self):
        page = "".join(
            f'<span class="surah_number">{n}</span><span class="hidden">{n} س</span>'
            f'<span class="fs14 text_secondary">{n + 2} Ayat</span><h2 class="fs20 fw-bolder">Sūrah&#39;{n}</h2>'
            for n in range(1, 115))
        text = AY.extract_sura_names(page)
        self.assertTrue(text.startswith("1|3|س|Sūrah'1\n"))
        self.assertEqual(AY.parse_sura_names(text)[114]["ayat"], 116)
        with self.assertRaises(AY.AyatError):
            AY.extract_sura_names(page.split('<span class="surah_number">114')[0])

    def test_fact_locations_are_mushaf_ordered(self):
        locs = list(AY.fact_locations(LESSONS))
        self.assertEqual(locs, sorted(locs, key=AY.parse_loc))
        self.assertEqual(len(locs), len(set(locs)))


def main() -> int:
    width = max(len(n) for n, *_ in MUTATIONS)
    failed = 0
    base = run_check(copy.deepcopy(CONTENT))
    print(f"{'unmutated copy':{width}s}  {'PASS' if not base else 'FAIL'}" + (f"  {base[:3]}" if base else ""))
    failed += bool(base)
    skipped = []
    for title, mutate, expect, needs, again in MUTATIONS:
        if needs and CORPUS is None:
            skipped.append(title)
            print(f"{title:{width}s}  skipped (needs the corpus)")
            continue
        errs = run_check(*mutated(mutate, again))
        hit = next((e for e in errs if expect in e), None)
        failed += hit is None
        print(f"{title:{width}s}  {'caught' if hit else 'MISSED'}  {hit or errs[:2]}")
    suite = unittest.TestSuite()
    for cls in (AyatValidation, Names):
        suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(cls))
    res = unittest.TextTestRunner(verbosity=1, stream=sys.stdout).run(suite)
    n = len(MUTATIONS) - len(skipped)
    print(f"\n{n} planted faults, {n - (failed - bool(base))} caught" + (f"; {len(skipped)} skipped without the corpus" if skipped else ""))
    return 1 if failed or not res.wasSuccessful() else 0


if __name__ == "__main__":
    sys.exit(main())
