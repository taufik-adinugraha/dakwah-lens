#!/usr/bin/env python3
"""Planted-fault tests for the lesson map guard (validate_map.py, lessonmap.py, build_map.py;
operator 2026-10-13, docs/belajar-plan.md L23): each case plants ONE fault — in a copy of the built
map file, of the authored file, of the library or of a lesson — and asserts the guard fails with
the expected message; the unmutated copies must pass. Also pins the derivation (the new / review /
later table of Al-Fatihah, measured on 2026-10-13) and unit-tests the name cut and the lessons'
order. Standard library only; run from belajar/pipeline, after build_map.py and build_narration.py:

    python3 test_validate_map.py          # table of faults and the message that caught each
    python3 -m unittest test_validate_map # the same as a unittest run
"""
from __future__ import annotations

import copy
import json
import sys
import unittest

import build_map as BM
import lessonmap as LM
import validate_map as VM
import validate_narration as V
from common import CONTENT_DIR, SURAHS

SLUG = "al-fatihah"
LESSONS = BM.load_lessons()
LIBRARY = json.loads((CONTENT_DIR / "library.json").read_text(encoding="utf-8"))
MANIFESTS = {sp.slug: json.loads((CONTENT_DIR / "narration" / f"{sp.slug}.json").read_text(encoding="utf-8"))
             for sp in SURAHS}
AUTHORED = {slug: LM.load_authored(slug) for slug in LM.authored_slugs()}
CONTENTS = LM.load_all_content()
LEX = V.load_lexicon()


def run(contents=None, *, authored=None, library=None, lessons=None):
    return VM.check(copy.deepcopy(CONTENTS) if contents is None else contents,
                    LESSONS if lessons is None else lessons, LIBRARY if library is None else library, MANIFESTS,
                    authored=copy.deepcopy(AUTHORED) if authored is None else authored, lex=LEX)


def entry(content: dict, ayah: int) -> dict:
    return next(a for a in content["ayat"] if a["ayah"] == ayah)


def built(fn):
    """A fault in the built file content/map/al-fatihah.json."""
    def f():
        c = copy.deepcopy(CONTENTS)
        fn(c[SLUG])
        return run(c)
    return f


def in_authored(fn):
    """A fault in authored/al-fatihah.map.json (the file is then built from it, as build_map.py does)."""
    def f():
        a = copy.deepcopy(AUTHORED)
        fn(a[SLUG])
        return run(authored=a)
    return f


def in_library(fn):
    def f():
        lib = copy.deepcopy(LIBRARY)
        fn({c["id"]: c for c in lib["concepts"]})
        return run(library=lib)
    return f


def in_lesson(fn):
    def f():
        ls = copy.deepcopy(LESSONS)
        fn(ls[SLUG]["ayat"])
        return run(lessons=ls)
    return f


def move(ayah: int, cid: str, src: str, dst: str):
    def f(c):
        e = entry(c, ayah)
        e[src].remove(cid)
        e[dst].append(cid)
    return f


def other_surah():
    c = copy.deepcopy(CONTENTS)
    c["al-ikhlas"] = {**copy.deepcopy(c[SLUG]), "slug": "al-ikhlas", "surah": 112}
    return run(c)


def no_built_file():
    return run({})


def topic(**changes):
    """The authored later item of Al-Fatihah 1 (marfu') with fields changed."""
    def f(a):
        a["later"][0].update(changes)
    return f


def retitle(title: str):
    def f(concepts):
        concepts["naat"]["title"] = title
    return f


def first_example(cid: str, loc: str):
    def f(concepts):
        ex = concepts[cid]["examples"]
        ex.insert(0, {**ex[0], "loc": loc})
    return f


def tag(ayah: int, word: int, cid: str):
    def f(ayat):
        ayat[ayah - 1]["words"][word - 1]["concepts"].append(cid)
    return f


# (name, run() → the guard's problems, substring the failure must contain)
MUTATIONS = [
    # --- what each group may hold (the operator's rules)
    ("a new concept left out", built(lambda c: entry(c, 1)["new"].remove("naat")), "is not the concepts introduced here"),
    ("a concept of another ayah listed as new", built(lambda c: entry(c, 1)["new"].append("badal")),
     "is not the concepts introduced here"),
    ("the new concepts in another order", built(lambda c: entry(c, 1)["new"].reverse()), "is not the concepts introduced here"),
    ("review: a concept the ayah does not carry", built(lambda c: entry(c, 4)["review"].insert(0, "huruf-jar")),
     "review lists huruf-jar, which no word or structure group of the ayah carries"),
    ("review: a concept that is taught later", built(move(1, "syibhul-jumlah", "later", "review")),
     "review lists syibhul-jumlah, which is not taught earlier (it is taught in 1:2)"),
    ("later: a concept that was taught earlier", built(move(3, "naat", "review", "later")),
     "later lists naat, which is not taught later (it is taught in 1:1)"),
    ("later: a concept the ayah does not carry", built(lambda c: entry(c, 1)["later"].append("badal")),
     "later lists badal, which no word or structure group of the ayah carries"),
    ("a concept of the ayah in no group", built(lambda c: entry(c, 2)["review"].remove("idhafah")),
     "['idhafah'] are on the ayah's words and in none of new / review / later"),
    ("a concept listed twice", built(lambda c: entry(c, 2)["review"].append("jumlah-ismiyyah")), "a concept is listed twice"),
    ("review not in the order taught", built(lambda c: entry(c, 7)["review"].reverse()),
     "review is not in the order the concepts are taught"),
    ("a concept that is no Konsep", built(lambda c: entry(c, 1)["later"].append("tidak-ada")),
     "are not Konsep with a lesson that introduces them"),
    ("an ayah without its entry", built(lambda c: c["ayat"].pop()), "ayat must be the lesson's ayat, each once, in order"),
    # --- the concepts table
    ("a concept placed in another ayah", built(lambda c: c["concepts"]["naat"].__setitem__("ayah", 2)),
     "naat is taught in 1:1, not 1:2"),
    ("a listed concept without its record", built(lambda c: c["concepts"].pop("ilal")), "concepts must be exactly"),
    ("a record no ayah lists", built(lambda c: c["concepts"].__setitem__("hal", dict(c["concepts"]["naat"]))),
     "concepts must be exactly"),
    ("a name longer than four words", built(lambda c: c["concepts"]["naat"].__setitem__("latin", "Sifat yang mengikuti kata sebelumnya")),
     "is longer than 4 words"),
    ("a name its caption does not open with", built(lambda c: c["concepts"]["naat"].__setitem__("name", "Sifat (نَعْت)")),
     "its caption (al-fatihah:1:concept:naat) does not open with that name"),
    ("a hand-edited file", built(lambda c: c["concepts"]["naat"].__setitem__("latin", "Na'at")), "out of date with build_map.py"),
    ("another format version", built(lambda c: c.__setitem__("version", 2)), "version must be 1"),
    ("a key the format does not have", built(lambda c: c.__setitem__("note", "x")), "exactly {version, slug, surah, concepts, ayat}"),
    # --- the per-surah switch
    ("a map for a surah that is not switched on", other_surah, "no authored/al-ikhlas.map.json behind it"),
    ("switched on, never built", no_built_file, "authored/al-fatihah.map.json has no built file"),
    # --- the authored names
    ("a name for a concept the surah does not list", in_authored(lambda a: a["names"].__setitem__("hal", "Hal")),
     "which no ayah of al-fatihah lists"),
    ("a Qur'anic word in an explicit name", in_authored(lambda a: a["names"].__setitem__("naat", "Sifat rabbi")),
     "names the Qur'anic word(s)"),
    ("an explicit name longer than four words",
     in_authored(lambda a: a["names"].__setitem__("naat", "Sifat yang mengikuti kata sebelumnya")), "is longer than 4 words"),
    # --- authored later items, or topics (operator 2026-10-13: marfu' is shown in ayah 1 and taught in ayah 2)
    ("a topic whose teaching line does not exist", in_authored(topic(line="al-fatihah:2:w1:compose:99")),
     "its teaching line al-fatihah:2:w1:compose:99 is not in the narration"),
    ("a topic taught by a line of the same ayah", in_authored(topic(line="al-fatihah:1:w1:compose:5")),
     "which is not in a later ayah than ayah 1"),
    ("a topic whose line is no narration line of the surah", in_authored(topic(line="al-ikhlas:1:w1")),
     "is not a narration line of al-fatihah"),
    ("a topic whose line does not name it", in_authored(topic(line="al-fatihah:2:w1:compose:6")),
     "its teaching line al-fatihah:2:w1:compose:6 does not name “Marfu’ (مَرْفُوع)”"),
    ("a topic with the id of a Konsep", in_authored(topic(id="badal")), "must be a new id"),
    ("a topic for an ayah the surah does not have", in_authored(topic(ayah=9)), "al-fatihah has no ayah 9"),
    ("a Qur'anic word in a topic's note", in_authored(topic(note="mengapa rabbi berakhir kasrah")), "names the Qur'anic word(s)"),
    ("a topic without its note", in_authored(lambda a: a["later"][0].pop("note")), "must be exactly {ayah, id, name, note, line}"),
    ("a topic listed as repeated", built(move(1, "marfu", "later", "review")), "topic marfu is listed as new or repeated"),
    ("a topic listed in the ayah that teaches it", built(lambda c: entry(c, 2)["later"].insert(0, "marfu")),
     "later lists marfu, which is not taught later (it is taught in 1:2)"),
    ("a topic's record in another ayah than its line", built(lambda c: c["concepts"]["marfu"].__setitem__("ayah", 3)),
     "its teaching line 'al-fatihah:2:w1:compose:8' is not a line of ayah 3"),
    ("a topic's record without its teaching line", built(lambda c: c["concepts"]["marfu"].pop("line")),
     "topic marfu must be {name, latin, from, surah, ayah, note, line}"),
    ("a topic dropped from the built file", built(lambda c: entry(c, 1)["later"].remove("marfu")), "concepts must be exactly"),
    # --- the content moved under the file
    ("a title that opens with no name", in_library(retitle("Sifat yang mengikuti kata benda sebelumnya dalam i'rab")),
     "opens with no name of at most 4 words"),
    ("a concept now introduced in another ayah", in_library(first_example("idhafah", "1:2:4")),
     "is not the concepts introduced here"),
    ("a word newly tagged with a concept", in_lesson(tag(3, 1, "huruf-jar")),
     "['huruf-jar'] are on the ayah's words and in none of new / review / later"),
]

# Al-Fatihah, measured on 2026-10-13 (the task's table; the sets and counts are the operator's
# measurement, the order within review and later is the order taught): ayah → (new, review, later).
# What the DERIVATION gives; the built file adds the authored later items (TOPICS below).
FATIHAH = {
    1: (["kalimah-isim-fiil-huruf", "tanda-irab", "huruf-jar", "idhafah", "naat"], [], ["syibhul-jumlah"]),
    2: (["jumlah-ismiyyah", "syibhul-jumlah", "jamak-mudzakkar-salim"], ["tanda-irab", "huruf-jar", "idhafah", "naat"],
        ["wazan-dan-tashrif", "badal"]),
    3: (["wazan-dan-tashrif"], ["naat"], []),
    4: (["isim-fail"], ["idhafah", "naat", "wazan-dan-tashrif"], []),
    5: (["murab-mabni", "dhamir", "taqdim-maful", "fiil-mudhari", "jumlah-filiyyah", "athaf", "bab-istifal", "ilal"],
        ["kalimah-isim-fiil-huruf"], ["maful-bih"]),
    6: (["fiil-amr", "maful-bih"], ["tanda-irab", "naat", "isim-fail", "dhamir", "bab-istifal", "ilal"], []),
    7: (["badal", "isim-maushul", "fiil-madhi", "bab-ifal", "isim-maful", "naib-fail"],
        ["kalimah-isim-fiil-huruf", "huruf-jar", "idhafah", "jamak-mudzakkar-salim", "isim-fail", "murab-mabni", "dhamir",
         "jumlah-filiyyah", "athaf"], []),
}
LATER_AT = {"syibhul-jumlah": 2, "wazan-dan-tashrif": 3, "badal": 7, "maful-bih": 6}
# ayah → the authored later items it gets (after the concepts taught in the same ayah).
TOPICS = {1: ["marfu"]}


class LessonMap(unittest.TestCase):
    def test_unmutated_passes(self):
        self.assertEqual(run(), [])

    def test_mutations_fail(self):
        for name, fault, expect in MUTATIONS:
            with self.subTest(name):
                errs = fault()
                self.assertTrue(any(expect in e for e in errs), f"{name}: expected {expect!r} in {errs[:5]}")

    def test_fatihah_table(self):
        got = {a["ayah"]: (a["new"], a["review"], a["later"]) for a in LM.derive(LESSONS[SLUG], LESSONS, LIBRARY)}
        self.assertEqual(got, FATIHAH)
        self.assertEqual({n: tuple(len(x) for x in v) for n, v in got.items()},
                         {1: (5, 0, 1), 2: (3, 4, 2), 3: (1, 1, 0), 4: (1, 3, 0), 5: (8, 1, 1), 6: (2, 6, 0), 7: (6, 9, 0)})
        content = CONTENTS[SLUG]
        self.assertEqual({a["ayah"]: (a["new"], a["review"], a["later"]) for a in content["ayat"]},
                         {n: (new, review, later + TOPICS.get(n, [])) for n, (new, review, later) in FATIHAH.items()})
        for cid, ayah in LATER_AT.items():
            self.assertEqual((content["concepts"][cid]["surah"], content["concepts"][cid]["ayah"]), (1, ayah))

    def test_marfu_is_shown_in_ayah_1_and_taught_in_ayah_2(self):
        # Operator 2026-10-13: "in ayat-1, it mentions 'bentuk tertentu' but no explanation about
        # marfu' itself, better to inform it will be learnt later". Not a Konsep: an authored item.
        c = CONTENTS[SLUG]["concepts"]["marfu"]
        self.assertEqual(c, {"name": "Marfu’ (مَرْفُوع)", "latin": "Marfu'", "from": "topic",
                             "note": "mengapa bentuk dasar berakhir dhammah (ضَمَّة)", "surah": 1, "ayah": 2,
                             "line": "al-fatihah:2:w1:compose:8"})
        self.assertNotIn("marfu", {x["id"] for x in LIBRARY["concepts"]})
        lines = MANIFESTS[SLUG]["lines"]
        self.assertTrue(LM.names_it(lines[c["line"]]["display"], c["name"]))
        # No line of ayah 1 names it, and the ayah's base-form line now points ahead.
        for lid, ln in lines.items():
            if lid.startswith("al-fatihah:1:"):
                self.assertFalse(LM.names_it(ln["display"], c["name"]), lid)
                if not lid.endswith(":map"):
                    self.assertNotIn("marfu", ln["display"].lower(), lid)
        self.assertTrue(lines["al-fatihah:1:w1:compose:3"]["display"].endswith("Mengapa dhammah (ضَمَّة), kita pelajari di ayat kedua."))
        # A mention is not a naming.
        self.assertFalse(LM.names_it("Kata ini marfu’ (مَرْفُوع) karena menjadi pokok kalimat.", c["name"]))
        self.assertTrue(LM.names_it("Marfu’ (مَرْفُوع) adalah keadaan kata yang akhirnya dhammah.", c["name"]))

    def test_new_is_the_concept_lines(self):
        # new(ayah) is the rule the narration already uses for its "Konsep baru" lines.
        for slug, lesson in LESSONS.items():
            for entry_, a in zip(LM.derive(lesson, LESSONS, LIBRARY), lesson["ayat"]):
                self.assertEqual(entry_["new"], [c["id"] for c in V.introduced_concepts(a["loc"], LIBRARY)], a["loc"])

    def test_every_surah_derives(self):
        # The other surahs have no map file, and the derivation still holds for them: every
        # concept on a word is new, repeated or postponed, across surahs (Al-Ikhlas repeats
        # Al-Fatihah's concepts).
        rank = LM.lesson_order(LESSONS)
        self.assertEqual([rank[(1, 1)], rank[(1, 7)], rank[(112, 1)], rank[(114, 6)]], [0, 6, 7, 21])
        taught = {c["id"]: LM.taught_at(c) for c in LIBRARY["concepts"]}
        for slug, lesson in LESSONS.items():
            for entry_, a in zip(LM.derive(lesson, LESSONS, LIBRARY), lesson["ayat"]):
                here = rank[(lesson["surah"], a["ayah"])]
                self.assertTrue(all(rank[taught[c]] < here for c in entry_["review"]), a["loc"])
                self.assertTrue(all(rank[taught[c]] > here for c in entry_["later"]), a["loc"])
                self.assertEqual(set(LM.present_ids(a)) - set(entry_["new"]), set(entry_["review"]) | set(entry_["later"]), a["loc"])
        ikhlas = LM.derive(LESSONS["al-ikhlas"], LESSONS, LIBRARY)[0]
        self.assertIn("fiil-amr", ikhlas["review"])  # taught in Al-Fatihah 6

    def test_structure_groups_count(self):
        # A concept only a structure group names is present too (today every one is also on a word).
        ayah = copy.deepcopy(LESSONS[SLUG]["ayat"][0])
        tagged = LM.present_ids(ayah)
        self.assertEqual([g["concept"] for g in ayah["structure"]["groups"] if g.get("concept") not in tagged], [])
        ayah["structure"]["groups"].append({"words": [1], "label": "x", "concept": "badal"})
        self.assertEqual(LM.present_ids(ayah), tagged + ["badal"])

    def test_cut_name(self):
        for title, want in [
            ("Huruf jar (kata depan) dan isim majrur", "Huruf jar"),
            ("Tiga jenis kalimah, atau kata: isim, fi'il, dan huruf", "Tiga jenis kalimah"),
            ("I'rab dan tandanya (dhammah, fathah, kasrah)", "I'rab dan tandanya"),
            ("Dhamir (kata ganti): muttashil dan munfashil", "Dhamir"),
            ("Isim fa'il, yaitu kata pelaku", "Isim fa'il"),
            ("Hal (keterangan keadaan)", "Hal"),
            ("Badal", "Badal"),
            ("Huruf yang menafikan dan menjazmkan fi'il mudhari'", None),  # a description
            ("(kata depan)", None),
        ]:
            with self.subTest(title):
                self.assertEqual(LM.cut_name(title), want)

    def test_names_are_the_captions(self):
        # Every Al-Fatihah concept is named from its title, as its own caption names it.
        namer = BM.Namer(LESSONS, LEX)
        lines = MANIFESTS[SLUG]["lines"]
        for cid, c in CONTENTS[SLUG]["concepts"].items():
            if c["from"] == LM.TOPIC:
                continue  # an authored later item: named by the line that teaches it (above)
            with self.subTest(cid):
                self.assertEqual(c["from"], "title")
                shown = V._field_of(lines, f"{SLUG}:{c['ayah']}:concept:{cid}", "display")
                self.assertTrue(shown.startswith(f"{V.TITLE_LEAD} {c['name']}"), shown[:60])
                self.assertEqual(namer.shown(c["latin"]), c["name"])
        # A title that names a Qur'anic word, or opens with a description, gets no guessed name.
        by_id = {c["id"]: c for c in LIBRARY["concepts"]}
        for cid in ("jazm-lam", "zharaf-idza"):
            with self.subTest(cid), self.assertRaises(LM.MapError):
                namer(by_id[cid], *LM.taught_at(by_id[cid]), None)

    def test_other_surahs_are_off(self):
        self.assertEqual(LM.authored_slugs(), [SLUG])
        self.assertEqual(list(CONTENTS), [SLUG])


def main() -> int:
    width = max(len(n) for n, _, _ in MUTATIONS)
    base = run()
    print(f"{'unmutated copies':{width}s}  {'PASS' if not base else 'FAIL'}" + (f"  {base[:3]}" if base else ""))
    failed = bool(base)
    for name, fault, expect in MUTATIONS:
        errs = fault()
        hit = next((e for e in errs if expect in e), None)
        failed += hit is None
        print(f"{name:{width}s}  {'caught' if hit else 'MISSED'}  {hit or errs[:2]}")
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(LessonMap)
    res = unittest.TextTestRunner(verbosity=1, stream=sys.stdout).run(suite)
    print(f"\n{len(MUTATIONS)} planted faults, {len(MUTATIONS) - failed + bool(base)} caught" if not base else "\nunmutated copies fail")
    return 1 if failed or not res.wasSuccessful() else 0


if __name__ == "__main__":
    sys.exit(main())
