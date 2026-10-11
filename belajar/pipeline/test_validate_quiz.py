#!/usr/bin/env python3
"""Planted-fault tests for the quiz guard (validate_quiz.py, quiz.py): each case plants ONE fault —
in a copy of the authored Al-Fatihah plan (then rebuilt, as build_quiz.py would), of the built quiz
file, of the narration manifest or of the library — and asserts the guard fails with the expected
message; the unmutated copies must pass. Faults the operator named (2026-10-10, rule 16) come first:
a question on a case state not taught yet, a wrong option the lesson has not taught (or from an ayah
not studied yet), a question with two correct options, a wazan quiz on a form never taught. Also
unit-tests TAUGHT (a glossed term is not taught, decision 6 of 2026-10-11), the cause classes, the
Arabic labels and the port of the components' seeded shuffle. Standard library only; run from
belajar/pipeline:

    python3 test_validate_quiz.py
"""
from __future__ import annotations

import copy
import json
import sys
import unittest

import build_quiz as BQ
import quiz as Q
import validate_quiz as VQ
from common import CONTENT_DIR, SURAHS

SLUG = "al-fatihah"
LESSONS = BQ.load_lessons()
LIBRARY = json.loads((CONTENT_DIR / "library.json").read_text(encoding="utf-8"))
TERMS = Q.Terms(Q.load_terms())
AUTHORED = {sp.slug: Q.load_authored(sp.slug) for sp in SURAHS}
QUIZZES = Q.load_all_content()
MANIFESTS = {sp.slug: json.loads((CONTENT_DIR / "narration" / f"{sp.slug}.json").read_text(encoding="utf-8"))
             for sp in SURAHS}


def run(authored=None, quizzes=None, manifests=None, library=None, *, rebuild=True):
    """The guard over copies; with `rebuild`, the quiz files are built from the (mutated) plans first,
    as build_quiz.py would (so a plan fault is caught by the plan's own checks, not as a stale file)."""
    authored = copy.deepcopy(AUTHORED) if authored is None else authored
    library = LIBRARY if library is None else library
    manifests = copy.deepcopy(MANIFESTS) if manifests is None else manifests
    try:
        fresh = BQ.build_all(LESSONS, library, TERMS, authored)
    except Q.QuizError as e:
        return [f"build_quiz.py fails: {e}"]
    if quizzes is None:
        quizzes = copy.deepcopy(fresh) if rebuild else copy.deepcopy(QUIZZES)
    return VQ.check(LESSONS, library, TERMS, quizzes, manifests, fresh=fresh)


def plan(fn):
    """A fault in the authored Al-Fatihah plan."""
    def f():
        a = copy.deepcopy(AUTHORED)
        fn(a[SLUG]["ayat"])
        return run(authored=a)
    return f


def manifest(fn):
    def f():
        m = copy.deepcopy(MANIFESTS)
        fn(m[SLUG]["lines"])
        return run(manifests=m)
    return f


def quizfile(fn):
    def f():
        q = copy.deepcopy(QUIZZES)
        fn(q[SLUG])
        return run(quizzes=q)
    return f


def library(fn):
    def f():
        lib = copy.deepcopy(LIBRARY)
        fn(lib)
        return run(library=lib)
    return f


def q_of(ayat, n, key, i):
    return ayat[str(n)][key][i]


def drop_line(lid):
    def f(lines):
        lines.pop(lid)
    return f


def wazn_same_form(lib):
    lx = next(x for x in lib["lexicon"] if x["id"] == "maghdub")
    forms = {f["label"]: f for f in lx["tashrif"]["forms"]}
    forms["fi'il madhi"]["ar"] = forms["isim maf'ul"]["ar"]


# (name, run the fault → errors, expected substring)
MUTATIONS = [
    # The operator's four (2026-10-10).
    ("a sort bin of a state not taught yet (manshub at ayah 2)",
     plan(lambda a: a["2"]["sort-case"]["bins"].append("manshub")), "needs 'manshub' (the bin manshub), not taught by the end of ayah 2 (first taught in ayah 6)"),
    ("a why option from a later ayah, its state untaught (iyyāka at ayah 1)",
     plan(lambda a: q_of(a, 1, "why-harakat", 0)["distractors"].__setitem__(0, "1:5:1")), "option from 1:5:1, an ayah not studied yet"),
    ("… and its terms untaught (mabni at ayah 1)",
     plan(lambda a: q_of(a, 1, "why-harakat", 0)["distractors"].__setitem__(0, "1:5:1")), "needs 'mabni' (option from 1:5:1), not taught by the end of ayah 1 (first taught in ayah 5)"),
    ("a role option only glossed so far (badal at ayah 2)",
     plan(lambda a: q_of(a, 2, "label-role", 0)["distractors"].__setitem__(2, "1:2:3")), "needs 'badal' (option from 1:2:3), not taught by the end of ayah 2 (first taught in ayah 7)"),
    ("two correct options: a role option sharing the answer's term (na't atau badal beside badal)",
     plan(lambda a: q_of(a, 7, "label-role", 0)["distractors"].__setitem__(1, "1:2:3")), "option from 1:2:3 shares ['badal'] with the answer"),
    ("two correct options: huruf jar + majrur beside khabar (jar-majrur)",
     plan(lambda a: q_of(a, 2, "label-role", 1)["distractors"].__setitem__(2, "1:1:1")), "option from 1:1:1 shares ['huruf-jar'] with the answer"),
    ("two correct options: two reasons of the same cause (two na't)",
     plan(lambda a: q_of(a, 1, "why-harakat", 3)["distractors"].__setitem__(1, "1:1:3")), "two options give the same cause"),
    ("two correct options: two wazan forms with the same Arabic",
     library(wazn_same_form), "two options are the same Arabic form"),
    ("a wazan form never taught (mashdar at ayah 5)",
     plan(lambda a: q_of(a, 5, "wazn-factory", 0)["options"].append("mashdar")), "needs 'mashdar' (form label 'mashdar'), not taught by the end of ayah 5 (never taught)"),
    ("a wazan quiz before its forms are taught (ayah 3)",
     plan(lambda a: a["3"].__setitem__("wazn-factory", [{"lexeme": "rahman", "label": "fi'il madhi", "options": ["fi'il mudhari'"]},
                                                         {"lexeme": "rahman", "label": "fi'il mudhari'", "options": ["fi'il madhi"]}])),
     "needs \"fi'il madhi\" (form label \"fi'il madhi\"), not taught by the end of ayah 3 (first taught in ayah 7)"),
    ("a role only glossed is not taught (maf'ul bih at ayah 5, decision 6)",
     plan(lambda a: a["5"].__setitem__("label-role", [{"word": 1, "distractors": ["1:2:1"]}, {"word": 2, "distractors": ["1:2:1"]}])),
     "needs \"maf'ul bih\" (option from 1:5:1), not taught by the end of ayah 5 (first taught in ayah 6)"),
    # The teaching the plan rests on.
    ("the marfu' teaching line removed (al-ḥamdu, ayah 2)",
     manifest(drop_line("al-fatihah:2:w1:compose:8")), "needs \"marfu'\" (the bin marfu), not taught by the end of ayah 2"),
    ("the manshub teaching line removed (aṣ-ṣirāṭa, ayah 6)",
     manifest(drop_line("al-fatihah:6:w2:compose:6")), "needs 'manshub' (the bin manshub), not taught by the end of ayah 6"),
    # The structure rules.
    ("a wrong option from a later ayah, its term taught (yaumi at ayah 3)",
     plan(lambda a: q_of(a, 3, "why-harakat", 0)["distractors"].__setitem__(1, "1:4:2")), "option from 1:4:2, an ayah not studied yet"),
    ("a sort over one state (ayah 3: both majrur)",
     plan(lambda a: a["3"].__setitem__("sort-case", {"words": [1, 2], "bins": ["marfu", "majrur"]})), "nothing to sort"),
    ("a sort word outside the bins (mabni missing at ayah 5)",
     plan(lambda a: a["5"]["sort-case"]["bins"].remove("mabni")), "is mabni, not one of the bins"),
    ("a wazan lexeme of another ayah (hada at ayah 5)",
     plan(lambda a: q_of(a, 5, "wazn-factory", 0).__setitem__("lexeme", "hada")), "hada is not the lemma of a word of this ayah"),
    ("a tap word without timing", plan(lambda a: a["1"]["tap-word"]["words"].append(9)), "build_quiz.py fails"),
    ("the quiz file edited by hand", quizfile(lambda q: q["ayat"][0]["exercises"][1]["questions"][0]["options"].pop()),
     "content/quiz/al-fatihah.json is out of date"),
    ("an explanation line missing", manifest(drop_line("al-fatihah:2:ex:label-role:1:why")),
     "narration line al-fatihah:2:ex:label-role:1:why missing"),
    ("an explanation line for no question", manifest(lambda ls: ls.__setitem__("al-fatihah:2:ex:label-role:9:why", ls["al-fatihah:2:ex:label-role:1:why"])),
     "al-fatihah:2:ex:label-role:9:why has no exercise or question in the quiz"),
]


class Taught(unittest.TestCase):
    def setUp(self):
        self.t = Q.taught(MANIFESTS[SLUG], LESSONS[SLUG], TERMS)

    def test_states_where_the_lesson_names_them(self):
        first = {tid: min(n for n in self.t if tid in self.t[n]) for tid in ("majrur", "marfu", "mabni", "manshub")}
        self.assertEqual(first, {"majrur": 1, "marfu": 2, "mabni": 5, "manshub": 6})

    def test_glossed_or_mentioned_is_not_taught(self):
        self.assertNotIn("badal", self.t[2])      # "pengganti (badal)" in 2:structure
        self.assertNotIn("maful-bih", self.t[5])  # "objek (maf'ul bih)" in 5:structure
        self.assertNotIn("mashdar", self.t[7])    # "mashdar (kata benda perbuatan)" only
        self.assertIn("badal", self.t[7])

    def test_patterns(self):
        d = lambda part, text: {t for t, _ in Q.defined_terms(part, text, TERMS)}  # noqa: E731
        self.assertEqual(d("w1:compose:5", "Kata benda yang berubah seperti ini disebut majrur (مَجْرُور)."), {"majrur"})
        self.assertEqual(d("primer:3", "Fathah (فَتْحَة) adalah garis kecil miring di atas huruf."), {"fathah"})
        self.assertEqual(d("structure", "Tiga harakat utama adalah fathah, kasrah, dan dhammah."), set())
        self.assertEqual(d("structure", "maka ikut manshub, yaitu berakhiran fathah."), set())
        self.assertEqual(d("concept:x", "Konsep baru: Idhafah, yaitu sandaran kata. Idhafah adalah gabungan dua isim, dan kata "
                                        "keduanya, atau mudhaf ilaih, selalu majrur."), {"idhafah", "mudhaf-ilaih"})


class Pieces(unittest.TestCase):
    def test_cause_classes(self):
        self.assertEqual(Q.cause_class("Akhirnya kasrah karena menjadi sifat (na't) bagi lafaz Allah.", TERMS, after_karena=True), "naat")
        self.assertEqual(Q.cause_class("Akhirnya kasrah karena didahului huruf jar li-.", TERMS, after_karena=True), "huruf-jar")
        self.assertEqual(Q.term_classes("khabar (jar-majrur)", TERMS), {"khabar", "huruf-jar"})

    def test_arabic_from_the_table(self):
        self.assertEqual(TERMS.annotate("mudhaf ilaih"), "mudhaf ilaih (مُضَاف إِلَيْه)")
        self.assertEqual(TERMS.annotate("na't (sifat)"), "na't (نَعْت, sifat)")
        self.assertEqual(TERMS.annotate("isim maushul (mudhaf ilaih)"), "isim maushul (اِسْم مَوْصُول, mudhaf ilaih, مُضَاف إِلَيْه)")
        self.assertEqual(TERMS.label("marfu"), "marfu' (مَرْفُوع)")
        for tid in ("marfu", "manshub", "majrur", "mabni"):
            self.assertIn(TERMS.by_id[tid]["ar"], QUIZZES[SLUG]["states"][tid])

    def test_seeded_shuffle_matches_the_components(self):
        # src/lib/shuffle.ts seededShuffle([1..6], "1:1:1") and ("abc", "al-fatihah/2/tap"), as node prints them.
        self.assertEqual(Q.seeded_shuffle([1, 2, 3, 4, 5, 6], "1:1:1"), [1, 4, 5, 3, 6, 2])
        self.assertEqual(Q.seeded_shuffle(list("abcd"), "al-fatihah/2/tap"), ["d", "c", "b", "a"])
        self.assertEqual(Q.seeded_shuffle(list(range(1, 11)), "113:5:3/x"), [1, 5, 2, 3, 4, 6, 9, 10, 8, 7])


def main() -> int:
    width = max(len(n) for n, *_ in MUTATIONS)
    base = run(rebuild=False)
    print(f"{'unmutated copy':{width}s}  {'PASS' if not base else 'FAIL'}" + (f"  {base[:3]}" if base else ""))
    failed = bool(base)
    for name, fault, expect in MUTATIONS:
        errs = fault()
        hit = next((e for e in errs if expect in e), None)
        failed += hit is None
        print(f"{name:{width}s}  {'caught' if hit else 'MISSED'}  {hit or errs[:3]}")
    suite = unittest.TestSuite()
    for cls in (Taught, Pieces):
        suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(cls))
    res = unittest.TextTestRunner(verbosity=1, stream=sys.stdout).run(suite)
    caught = len(MUTATIONS) - (failed - bool(base))
    print(f"\n{len(MUTATIONS)} planted faults, {caught} caught")
    return 1 if failed or not res.wasSuccessful() else 0


if __name__ == "__main__":
    sys.exit(main())
