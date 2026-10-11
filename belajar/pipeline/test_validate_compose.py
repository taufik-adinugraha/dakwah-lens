#!/usr/bin/env python3
"""Mutation tests for validate_compose.py (word compositions and the harakat primer): each case
plants one fault in a copy of content/compose/<slug>.json (or of the authored file's sha256) and
asserts that the validator fails with the expected message; the unmutated copy must pass. Faults
only the pinned corpus can catch (a Tanzil token, an attestation, the parts against QAC's
segments) are listed as skipped with --no-corpus (CI). Also unit-tests the pieces and the edits.
Standard library only; run from belajar/pipeline after build_compose.py:

    python3 test_validate_compose.py               # with pipeline/cache (local)
    python3 test_validate_compose.py --no-corpus   # CI
"""
from __future__ import annotations

import copy
import sys
import unittest

import compose as C
import validate_compose as VC
from build_compose import load_lessons

NO_CORPUS = "--no-corpus" in sys.argv
if NO_CORPUS:
    sys.argv.remove("--no-corpus")
CORPUS = None if NO_CORPUS else C.Corpus()
LESSONS = load_lessons()
CONTENTS = C.load_all_content()
SLUG = "al-fatihah"


def run_check(contents, authored=None):
    return VC.check(contents, LESSONS, CORPUS, authored)


def unit(c, loc):
    return c[SLUG]["words"][loc]


def setf(fn):
    def f(c, a):
        fn(c[SLUG])
    return f


def say_of(loc, k, fn):
    """A composition's k-th line, rewritten (the frames and the lines are compared, not rebuilt)."""
    def f(c, a):
        ln = c[SLUG]["words"][loc]["lines"][k - 1]
        ln["say"] = fn(ln["say"])
    return f


def frame_set(loc, k, **kv):
    return setf(lambda x: x["words"][loc]["frames"][k - 1].update(kv))


# (name, mutation(contents, authored-sha map), expected substring, needs the corpus)
MUTATIONS = [
    ("a form's bytes not its source's", setf(lambda x: x["words"]["1:1:1"]["forms"]["ismi"].__setitem__(
        "ar", x["words"]["1:1:1"]["forms"]["ismu"]["ar"])), "its source gives", False),
    ("a word slice that is not the word's", setf(lambda x: x["words"]["1:1:1"]["forms"]["bi"].__setitem__(
        "src", {"word": "1:1:1", "pieces": [1, 2]})), "its source gives", False),
    ("an edit that does not fit its form", setf(lambda x: x["words"]["1:1:1"]["forms"]["ismi"].__setitem__(
        "src", {"from": "ismu", "ops": [{"remove": "shaddah", "piece": 0}]})), "carries no shaddah", False),
    ("a Tanzil token from the wrong place", setf(lambda x: x["words"]["1:1:1"]["forms"]["ismu"].__setitem__(
        "src", {"tanzil": "55:78:3"})), "its source gives", True),
    ("an attestation the corpus does not have", setf(lambda x: x["words"]["1:1:1"]["forms"]["ismu"].__setitem__(
        "attested", ["1:1:1"])), "≠ the corpus", True),
    ("parts that are not QAC's segments", setf(lambda x: x["words"]["1:1:1"]["frames"][0].__setitem__(
        "tiles", ["bi", "bismi"])), "is not QAC's segment", True),
    ("the last frame is not the word", setf(lambda x: x["words"]["1:1:1"]["frames"][-1].__setitem__(
        "tiles", ["bi+ismi"])), "the last frame shows", False),
    ("a change of a letter, not a mark", setf(lambda x: x["words"]["1:1:1"]["frames"][2].__setitem__(
        "from", "bi")), "change must", False),
    ("a cut chip that is not the forms'", setf(lambda x: x["words"]["1:1:1"]["frames"][2].__setitem__(
        "chips", [{"from": "x", "to": "y", "marks": [None, None]}])), "chips", False),
    ("a frame nothing is said over", setf(lambda x: x["words"]["1:1:2"].__setitem__(
        "lines", [ln for ln in x["words"]["1:1:2"]["lines"] if ln["frame"] != 2])), "every frame is explained", False),
    ("lines out of the frames' order", setf(lambda x: x["words"]["1:1:3"]["lines"].reverse()),
     "lines must be the frames' says in order", False),
    ("a base form that does not end in a vowel", setf(lambda x: x["words"]["1:1:3"]["frames"][2].update(
        {"tiles": ["al"], "focus": "al"})), "must end in a vowel mark", False),
    ("an unknown stage", setf(lambda x: x["words"]["1:1:4"]["frames"][0].__setitem__("stage", "merge")),
     "is not one of", False),
    ("Arabic in an on-screen note", setf(lambda x: x["words"]["1:1:1"]["frames"][3].__setitem__(
        "note", x["words"]["1:1:1"]["ar"])), "note must be short Indonesian", False),
    ("a status other than draft", setf(lambda x: x["words"]["1:1:2"].__setitem__("status", "reviewed")),
     "status must be 'draft'", False),
    ("no sources", setf(lambda x: x["words"]["1:1:2"].__setitem__("sources", [])), "sources must be", False),
    ("a form shown nowhere", setf(lambda x: x["words"]["1:1:2"]["forms"].__setitem__(
        "spare", dict(x["words"]["1:1:2"]["forms"]["allahu"]))), "never shown nor used", False),
    ("a primer example from another ayah", setf(lambda x: x["primer"]["forms"]["ba-i"].__setitem__(
        "src", {"word": "1:2:1", "pieces": [3, 4]})), "not from ayah 1:1", False),
    ("a primer mark frame whose example lacks the mark", setf(lambda x: x["primer"]["frames"][1].__setitem__(
        "tiles", ["ba-i"])), "no example tile carries the fathah", False),
    ("the primer's highlighted words not re-derived", setf(lambda x: x["primer"]["frames"][2].__setitem__(
        "words", [2])), "the words each primer frame shows", False),
    ("a composition on a word of another surah", setf(lambda x: x["words"].__setitem__(
        "112:1:1", dict(x["words"]["1:1:2"], loc="112:1:1"))), "not a word of this surah's lesson", False),
    ("the mark table edited by hand", setf(lambda x: x["marks"]["kasrah"].__setitem__("sound", "e")),
     "marks differ", False),
    ("built from an older authored file", lambda c, a: a.__setitem__(SLUG, "0" * 64), "another version of authored", False),
    # --- what the lines say against what the frames show (review findings, 2026-10-10)
    ("a bentuk dasar that is not the marfu' form", frame_set("1:1:2", 1, tiles=["allahi"], focus="allahi"),
     "the marfu' form ends in dhammah", False),
    ("a base_mark that is not the base form's ending", frame_set("1:7:3", 2, base_mark="kasrah"),
     "base_mark 'kasrah' is not the ending", False),
    ("a harakah named over a base frame that shows another",
     say_of("1:4:2", 1, lambda t: t.replace("dhammah, bunyi u", "fathah, bunyi a")), "names ['fathah'] over a base frame", False),
    ("a change line naming marks the change does not show",
     say_of("1:6:2", 4, lambda t: "Di sini akhirnya menjadi kasrah, tanda bunyi i di bawah huruf."), "over a change frame", False),
    ("a transliteration whose vowel is not the bytes'", setf(lambda x: x["words"]["1:1:1"]["forms"]["ismu"].__setitem__(
        "translit", "ismi")), "does not end in 'u'", False),
    ("the word's first harakah without its sound",
     say_of("1:1:2", 1, lambda t: t.replace("dhammah, bunyi u,", "dhammah,")), "first dhammah without its sound", False),
    ("the bentuk dasar said over a whole frame",
     say_of("1:5:1", 1, lambda t: t + " Bentuk dasarnya berakhir dengan dhammah, bunyi u."), "speaks of the bentuk dasar", False),
    ("written together, said over a word without parts",
     say_of("1:1:2", 1, lambda t: t + " Lalu kedua bagian ditulis bersambung."), "parts are written together", False),
    ("a part named over a one-tile frame",
     say_of("1:1:2", 2, lambda t: "Bagian kedua adalah nama Allah."), "names a part over a change frame", False),
    ("akar instead of bentuk dasar",
     say_of("1:1:1", 3, lambda t: t.replace("Dalam bentuk dasarnya", "Dalam akarnya")), "never “akar”", False),
    ("a letter pin outside the composition", frame_set("1:7:9", 2, letters=[["nope", 0]]), "letters pins", False),
]


class ComposeValidation(unittest.TestCase):
    def test_unmutated_passes(self):
        self.assertEqual(run_check(copy.deepcopy(CONTENTS)), [])

    def test_mutations_fail(self):
        for name, mutate, expect, needs in MUTATIONS:
            if needs and CORPUS is None:
                continue
            with self.subTest(name):
                c = copy.deepcopy(CONTENTS)
                a = {s: VC.sha256_file(VC.AUTHORED_DIR / f"{s}.compose.json") for s in C.authored_slugs()}
                mutate(c, a)
                errs = run_check(c, a)
                self.assertTrue(any(expect in e for e in errs), f"{name}: expected {expect!r} in {errs[:4]}")


class PiecesAndEdits(unittest.TestCase):
    def test_pieces(self):
        w = {x["loc"]: x["ar"] for a in LESSONS[SLUG]["ayat"] for x in a["words"]}
        ps = C.pieces(w["1:1:3"])
        self.assertEqual(len(ps), 6)
        self.assertEqual("".join(ps), w["1:1:3"])
        # the small upright alif rides on the mim (U+0670, a mark of its letter): the primer shows it
        self.assertEqual([C.marks_of(p) for p in ps],
                         [[], [], ["shaddah", "fathah"], ["sukun"], ["fathah", "small_alif"], ["kasrah"]])

    def test_edits(self):
        bismi = unit(CONTENTS, "1:1:1")
        f = {n: x["ar"] for n, x in bismi["forms"].items()}
        self.assertEqual(C.apply_op(f["ismu"], {"mark": -1, "to": "kasrah"}), f["ismi"])
        self.assertEqual(C.apply_op(f["bi"] + f["ismi"], {"drop": 1}), bismi["ar"])
        with self.assertRaises(C.ComposeError):
            C.apply_op(f["bi"], {"drop": 0})
        with self.assertRaises(C.ComposeError):
            C.apply_op(f["bi"], {"add": "kasrah", "piece": 0})
        r = unit(CONTENTS, "1:1:3")["forms"]
        joined = r["al"]["ar"] + r["rahman"]["ar"]
        self.assertEqual(C.apply_op(C.apply_op(joined, {"remove": "sukun", "piece": 1}), {"add": "shaddah", "piece": 2}),
                         r["ar-rahman"]["ar"])

    def test_chips(self):
        ch = unit(CONTENTS, "1:1:1")["frames"][2]["chips"]
        self.assertEqual([c["marks"] for c in ch], [["dhammah", "kasrah"]])
        join = unit(CONTENTS, "1:1:3")["frames"][1]["chips"]
        self.assertEqual([c["marks"] for c in join], [["sukun", None], [None, "shaddah"], [None, None]])
        # the mid-ayah article's alif, written but not read (silent: [0]; integration 2026-10-10)
        self.assertEqual([bool(c.get("silent")) for c in join], [False, False, True])


def main() -> int:
    width = max(len(n) for n, *_ in MUTATIONS)
    failed = 0
    base = run_check(copy.deepcopy(CONTENTS))
    print(f"{'unmutated copy':{width}s}  {'PASS' if not base else 'FAIL'}" + (f"  {base[:3]}" if base else ""))
    failed += bool(base)
    skipped = []
    for name, mutate, expect, needs in MUTATIONS:
        if needs and CORPUS is None:
            skipped.append(name)
            print(f"{name:{width}s}  skipped (needs the corpus)")
            continue
        c = copy.deepcopy(CONTENTS)
        a = {s: VC.sha256_file(VC.AUTHORED_DIR / f"{s}.compose.json") for s in C.authored_slugs()}
        mutate(c, a)
        errs = run_check(c, a)
        hit = next((e for e in errs if expect in e), None)
        failed += hit is None
        print(f"{name:{width}s}  {'caught' if hit else 'MISSED'}  {hit or errs[:2]}")
    suite = unittest.TestSuite()
    for cls in (ComposeValidation, PiecesAndEdits):
        suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(cls))
    res = unittest.TextTestRunner(verbosity=1, stream=sys.stdout).run(suite)
    n = len(MUTATIONS) - len(skipped)
    print(f"\n{n} planted faults, {n - failed + bool(base)} caught" + (f"; {len(skipped)} skipped without the corpus" if skipped else ""))
    return 1 if failed or not res.wasSuccessful() else 0


if __name__ == "__main__":
    sys.exit(main())
