#!/usr/bin/env python3
"""Planted-fault tests for the curriculum guard (validate_curriculum.py, curriculum.py,
build_curriculum.py; operator-approved 2026-10-13, docs/belajar-research/kurikulum-dasar.md, plan
L26): each case plants ONE fault — in a copy of the authored curriculum, of the built file, of a
lesson or of the library — and asserts the guard fails with the expected message; the unmutated
copies must pass. Also pins the derivation on Al-Fatihah (new / learnt-and-here / later / lanjut,
measured on 2026-10-13), the totals kurikulum-dasar.md E gives, the lesson order (An-Nas before
Al-Falaq before Al-Ikhlas), where each kind of step occurs, who owns a term, and the tolerated
list's rule both ways. Standard library only; run from belajar/pipeline, after build_curriculum.py:

    python3 test_validate_curriculum.py          # table of faults and the message that caught each
    python3 -m unittest test_validate_curriculum # the same as a unittest run
"""
from __future__ import annotations

import copy
import json
import sys
import unittest

import build_curriculum as BC
import curriculum as CUR
import terms as TERMS
import validate_curriculum as VC
import validate_narration as V
from common import CONTENT_DIR

LESSONS = BC.load_lessons()
LIBRARY = json.loads((CONTENT_DIR / "library.json").read_text(encoding="utf-8"))
TABLE = TERMS.load_terms()
AUTHORED = CUR.load_authored()
CONTENT = CUR.load_content()
LEX = V.load_lexicon()
SWITCHED = ["al-fatihah"]


def run(authored=None, content=None, *, lessons=None, library=None, switched=None, missing=False):
    errs, _notes = VC.check(copy.deepcopy(AUTHORED) if authored is None else authored,
                            None if missing else (copy.deepcopy(CONTENT) if content is None else content),
                            LESSONS if lessons is None else lessons, LIBRARY if library is None else library, TABLE,
                            lex=LEX, switched=SWITCHED if switched is None else switched)
    return errs


def auth(fn):
    """A fault in authored/curriculum.json."""
    def f():
        a = copy.deepcopy(AUTHORED)
        fn(a)
        return run(authored=a)
    return f


def built(fn):
    """A fault in the built file content/curriculum.json."""
    def f():
        c = copy.deepcopy(CONTENT)
        fn(c)
        return run(content=c)
    return f


def in_lesson(slug, fn):
    """A fault in a lesson (the built file then lags behind it)."""
    def f():
        ls = copy.deepcopy(LESSONS)
        fn(ls[slug]["ayat"])
        return run(lessons=ls)
    return f


def in_library(fn):
    def f():
        lib = copy.deepcopy(LIBRARY)
        fn(lib)
        return run(library=lib)
    return f


def step(cur: dict, sid: str) -> dict:
    return next(s for s in cur["steps"] if s["id"] == sid)


def lesson(cur: dict, lid: str) -> dict:
    return next(x for x in cur["lessons"] if x["id"] == lid)


def on_step(sid, fn):
    return auth(lambda a: fn(step(a, sid)))


def move_lesson(a, lid, after):
    x = lesson(a, lid)
    a["lessons"].remove(x)
    a["lessons"].insert(a["lessons"].index(lesson(a, after)) + 1, x)


def swap_steps(a, one, two):
    i, j = a["steps"].index(step(a, one)), a["steps"].index(step(a, two))
    a["steps"][i], a["steps"][j] = a["steps"][j], a["steps"][i]


def teach(sid, key, old, new):
    def f(a):
        t = step(a, sid)["teach"]
        assert old in t[key], f"{sid} teach.{key} has no {old!r}"
        t[key] = t[key].replace(old, new, 1)
    return auth(f)


def a_map(c, lid):
    return lesson(c, lid)["map"]


# (name, run() → the guard's problems, substring the failure must contain)
MUTATIONS = [
    # --- 1. units and lessons
    ("a lesson id in no documented form", auth(lambda a: lesson(a, "1:3").__setitem__("id", "1-3")),
     "lesson id '1-3' is not \"0\", \"S:A\" or \"S:A/N\""),
    ("a lesson listed twice", auth(lambda a: a["lessons"].insert(3, dict(lesson(a, "1:2")))), "lesson 1:2 is listed twice"),
    ("a lesson of a unit that does not exist", auth(lambda a: lesson(a, "1:3").__setitem__("unit", "al-baqarah")),
     "belongs to unit 'al-baqarah', which is not a unit"),
    ("a unit's lessons apart", auth(lambda a: move_lesson(a, "114:1", "113:2")), "the lessons of unit an-nas do not stand together"),
    ("the units' lessons not in the units' order (Al-Falaq before An-Nas)",
     auth(lambda a: a["lessons"].__setitem__(slice(None), [x for x in a["lessons"] if x["unit"] != "al-falaq"][:8]
                                             + [x for x in a["lessons"] if x["unit"] == "al-falaq"]
                                             + [x for x in a["lessons"] if x["unit"] != "al-falaq"][8:])),
     "the units' lessons are not in the order the units are listed"),
    ("a lesson of another surah than its unit's", auth(lambda a: lesson(a, "113:5").__setitem__("unit", "al-ikhlas")),
     "lesson 113:5 is not a lesson of unit al-ikhlas"),
    ("a segment whose words leave a gap", auth(lambda a: lesson(a, "2:255/2").__setitem__("words", [9, 12])),
     "lesson 2:255/2: its words start at 9, not at 8"),
    ("a segment without its words", auth(lambda a: lesson(a, "2:255/3").pop("words")), "a segment, and only a segment, has `words`"),
    ("a surah on disk with an ayah that is no lesson", auth(lambda a: a["lessons"].remove(lesson(a, "114:3"))),
     "the lessons of surah 114 (an-nas) must be its ayat on disk"),
    ("a unit without a lesson", auth(lambda a: a["units"].append({"id": "al-kautsar", "name": "Al-Kautsar", "surah": 108})),
     "unit al-kautsar has no lesson"),
    # --- 2. steps
    ("a step in a lesson that does not exist", on_step("naat", lambda s: s.__setitem__("lesson", "1:9")),
     "step naat is taught in lesson '1:9', which is not a lesson"),
    ("a step taught in two lessons", auth(lambda a: a["steps"].append({**step(a, "naat"), "lesson": "114:4"})),
     "step naat is listed twice (a step is taught in exactly one lesson)"),
    ("four new steps in one lesson", on_step("alif-lam", lambda s: s.__setitem__("lesson", "1:2")),
     "lesson 1:2 teaches 4 new steps, more than 3"),
    ("the steps not listed in teaching order", auth(lambda a: swap_steps(a, "idhafah", "dhamir")),
     "is listed after a step of a later lesson"),
    ("a step without a name", on_step("badal", lambda s: s.__setitem__("name", " ")), "step badal needs a name"),
    ("another format version", auth(lambda a: a.__setitem__("version", 2)), "version must be 1"),
    ("a key the format does not have", auth(lambda a: a.__setitem__("notes", [])), "a file is {version, units, lessons, steps, free, lanjut}"),
    # --- 3. records: whole, split, or next level — never two, never none
    ("a concept that is no Konsep", on_step("badal", lambda s: s.__setitem__("concept", "tidak-ada")),
     "concept 'tidak-ada' is not a Konsep of the library"),
    ("a basics record that does not exist", on_step("harakat", lambda s: s.__setitem__("basics", "tajwid")),
     "basics 'tajwid' is not a Dasar membaca record"),
    ("a record taught and next-level", auth(lambda a: a["lanjut"].append("naat")),
     "the Konsep record naat is taught whole and in lanjut — one of these, never two"),
    ("a record placed nowhere", auth(lambda a: a["lanjut"].remove("hal")), "the Konsep record hal is placed nowhere"),
    ("a record taught whole by two steps", on_step("badal", lambda s: s.__setitem__("concept", "naat")),
     "the Konsep record naat is taught whole by ['naat', 'badal'] — by one step"),
    ("a record taught whole and split", on_step("huruf-jar", lambda s: s.__setitem__("concept", "tanda-irab")),
     "the Konsep record tanda-irab is taught whole and split into parts"),
    ("the parts of a record not numbered 1…n", on_step("majzum", lambda s: s.__setitem__("part", 5)),
     "the parts of tanda-irab must be numbered 1…4, each once"),
    ("the parts of a record taught out of order",
     auth(lambda a: (step(a, "majrur").__setitem__("part", 2), step(a, "marfu").__setitem__("part", 1))),
     "the parts of tanda-irab are not taught in their order"),
    ("a part of a record without `occurs`", on_step("manshub", lambda s: s.pop("occurs")),
     "step manshub is a part of tanda-irab and needs `occurs`"),
    ("a whole record with a text of its own", auth(lambda a: step(a, "naat").__setitem__("teach", copy.deepcopy(step(a, "marfu")["teach"]))),
     "step naat: a whole record is taught by its own title and summary"),
    ("a step with its own text and the id of a record", on_step("alif-lam", lambda s: s.__setitem__("id", "hal")),
     "step hal has its own text and the id of a Konsep record"),
    ("a lanjut record that is no Konsep", auth(lambda a: a["lanjut"].append("tidak-ada")), "lanjut lists 'tidak-ada'"),
    # --- 4. terms
    ("a term that is not in the term table", on_step("naat", lambda s: s["terms"].append("tidak-ada")),
     "term 'tidak-ada' is not in authored/library.terms.json"),
    ("a term owned by two steps", on_step("naat", lambda s: s["terms"].append("mudhaf-ilaih")),
     "the term mudhaf-ilaih is owned by naat and by idhafah"),
    ("a free term that a step owns", auth(lambda a: a["free"].append("isim")), "the free term isim is owned by step kalimah"),
    ("a free term that does not exist", auth(lambda a: a["free"].append("tidak-ada")), "free term 'tidak-ada' is not in"),
    # --- 5. a step's own text
    ("teach without a source", on_step("marfu", lambda s: s["teach"].__setitem__("sources", [])),
     "step marfu: teach needs at least one source"),
    ("a source without its url", on_step("marfu", lambda s: s["teach"]["sources"][0].pop("url")),
     "step marfu: teach needs at least one source, each with kitab, ref and url"),
    ("teach without a summary", on_step("marfu", lambda s: s["teach"].pop("summary")),
     "step marfu: teach must be {title, summary, sources}"),
    ("markup that names no term", teach("marfu", "summary", "[[dhammah]]", "[[dhamah]]"), "[[dhamah]] names no term in library.terms.json"),
    ("a term left unmarked", teach("marfu", "summary", "[[dhammah]]", "dhammah"),
     "term 'dhammah' is in library.terms.json but written without [[…]] markup"),
    ("a Qur'anic word by reference", teach("majrur", "summary", "kita pelajari di ayat ini.", "kita pelajari pada [[bismi|q:1:1:1]]."),
     "[[bismi|q:1:1:1]] names a Qur'anic word"),
    ("a Qur'anic word in transliteration", teach("majrur", "summary", "kita pelajari di ayat ini.", "kita pelajari pada kata rabbi."),
     "steps[majrur] teach.summary: names the Qur'anic word(s) ['rabbi']"),
    # --- 6. occurs
    ("occurs with a state that is none", on_step("majrur", lambda s: s.__setitem__("occurs", {"case": "mabni"})),
     "step majrur: occurs must be one of"),
    ("occurs with two rules", on_step("alif-lam", lambda s: s.__setitem__("occurs", {"qac": "DET", "always": True})),
     "step alif-lam: occurs must be one of"),
    ("occurs with a tag that is no QAC tag", on_step("alif-lam", lambda s: s.__setitem__("occurs", {"qac": "det"})),
     "step alif-lam: occurs must be one of"),
    # --- 7. a switched-on surah
    ("a step of a switched-on surah with no text", on_step("marfu", lambda s: s.pop("teach")),
     "step marfu is taught in lesson 1:2, whose surah (al-fatihah) has a lesson map, and has no text"),
    ("a Qur'anic word in a name a lesson map says", on_step("naat", lambda s: s.__setitem__("name", "Sifat rabbi")),
     "steps[naat] name: names the Qur'anic word(s) ['rabbi']"),
    ("a name of more than four words", on_step("naat", lambda s: s.__setitem__("name", "Sifat yang mengikuti kata sebelumnya")),
     "is longer than 4 words"),
    # --- 8. the built file
    ("the built file missing", lambda: run(missing=True), "content/curriculum.json: missing"),
    ("a hand-edited file", built(lambda c: step(c, "majrur")["teach"].__setitem__("summary", "Diubah.")),
     "out of date with build_curriculum.py"),
    ("a key the built file does not have", built(lambda c: c.__setitem__("notes", [])), "a file is exactly {version, units, lessons, steps, free, lanjut}"),
    ("a lesson dropped from the built file", built(lambda c: c["lessons"].pop()), "its lessons are not the authored lessons"),
    ("a step dropped from the built file", built(lambda c: c["steps"].remove(step(c, "badal"))), "its steps are not the authored steps"),
    ("a step placed in another lesson", built(lambda c: step(c, "naat").__setitem__("lesson", "1:1")),
     "step naat is taught in lesson 1:3, not '1:1'"),
    ("a step with another narration line", built(lambda c: step(c, "majrur").__setitem__("line", "concept:tanda-irab")),
     "step majrur: its narration line is 'concept:majrur', not 'concept:tanda-irab'"),
    ("Arabic in a step's prose name", built(lambda c: step(c, "naat").__setitem__("latin", "Na't (نَعْت)")), "latin carries Arabic script"),
    # --- 9. the derived lists
    ("the new steps in another order", built(lambda c: a_map(c, "1:2")["new"].reverse()), "lesson 1:2: new"),
    ("a new step of another lesson", built(lambda c: a_map(c, "1:4")["new"].append("badal")), "lesson 1:4: new"),
    ("learnt without one earlier step (not cumulative)", built(lambda c: a_map(c, "1:5")["learnt"].pop(3)),
     "lesson 1:5: learnt must be every step of every earlier lesson, in teaching order (10 steps)"),
    ("learnt in another order", built(lambda c: a_map(c, "1:5")["learnt"].reverse()),
     "lesson 1:5: learnt must be every step of every earlier lesson"),
    ("a learnt step marked here that does not occur", built(lambda c: a_map(c, "1:1")["learnt"][0].__setitem__("here", True)),
     "lesson 1:1: learnt says harakat occurs in this ayah; it does not"),
    ("a learnt step that occurs, not marked", built(lambda c: a_map(c, "1:3")["learnt"][2].__setitem__("here", False)),
     "lesson 1:3: learnt says majrur does not occur in this ayah; it does"),
    ("later: a step that does not occur here", built(lambda c: a_map(c, "1:3")["later"].append("idhafah")),
     "lesson 1:3: later lists idhafah, which does not occur in this ayah"),
    ("later: a step taught earlier", built(lambda c: a_map(c, "1:3")["later"].append("majrur")),
     "lesson 1:3: later lists majrur, which is not taught in a later lesson"),
    ("later: a postponed step left out", built(lambda c: a_map(c, "1:1")["later"].remove("naat")),
     "lesson 1:1: later must be the steps of later lessons that occur here"),
    ("lanjut: a record the ayah does not carry", built(lambda c: a_map(c, "1:1")["lanjut"].append("hal")),
     "lesson 1:1: lanjut ['syibhul-jumlah', 'hal'] is not the next-level records tagged on this ayah"),
    ("a line with other words than the step occurs on", built(lambda c: lesson(c, "1:1")["lines"][0].__setitem__("words", [1])),
     "lesson 1:1: lines must be the steps that have a text"),
    ("a line dropped", built(lambda c: lesson(c, "1:3")["lines"].pop()), "lesson 1:3: lines must be the steps that have a text"),
    ("the running count off by one", built(lambda c: lesson(c, "1:4").__setitem__("before", 8)), "lesson 1:4: learnt before / after is 9 / 10"),
    ("derived lists on a lesson with no ayah on disk", built(lambda c: lesson(c, "0").update(lines=[], map={"new": [], "learnt": [], "later": [], "lanjut": []})),
     "lesson 0: a lesson whose ayah is on disk, and only such a lesson"),
    # --- the content moved under the file
    ("a word newly tagged with a taught record", in_lesson("al-fatihah", lambda ayat: ayat[2]["words"][0]["concepts"].append("huruf-jar")),
     "lesson 1:3: learnt says huruf-jar does not occur in this ayah; it does"),
    ("a word whose case state changed", in_lesson("al-fatihah", lambda ayat: ayat[1]["words"][0]["case"].__setitem__("state", "manshub")),
     "lesson 1:2: later must be the steps of later lessons that occur here"),
    ("a word tagged with a record the curriculum does not place",
     in_library(lambda lib: lib["concepts"].append({**copy.deepcopy(lib["concepts"][0]), "id": "konsep-baru"})),
     "the Konsep record konsep-baru is placed nowhere"),
]

# Al-Fatihah as derived, measured on 2026-10-13 (kurikulum-dasar.md E gives the New column and the
# running count; "here", later and lanjut are what the words' records and tags give): ayah →
# (new, the learnt steps that occur here, later, lanjut).
FATIHAH = {
    1: (["majrur", "huruf-jar"], ["kalimah"], ["alif-lam", "naat", "idhafah"], ["syibhul-jumlah"]),
    2: (["jumlah-ismiyyah", "marfu", "jamak-mudzakkar-salim"], ["kalimah", "majrur", "huruf-jar"],
        ["alif-lam", "naat", "idhafah", "badal"], ["syibhul-jumlah", "wazan-dan-tashrif"]),
    3: (["alif-lam", "naat"], ["kalimah", "majrur"], [], ["wazan-dan-tashrif"]),
    4: (["idhafah"], ["kalimah", "majrur", "alif-lam", "naat"], [], ["wazan-dan-tashrif", "isim-fail"]),
    5: (["dhamir", "fiil-mudhari", "murab-mabni"], ["kalimah", "marfu"], ["jumlah-filiyyah", "maful-bih", "athaf"],
        ["taqdim-maful", "bab-istifal", "ilal"]),
    6: (["jumlah-filiyyah", "maful-bih", "manshub"], ["kalimah", "alif-lam", "naat", "dhamir"], ["fiil-amr"],
        ["isim-fail", "bab-istifal", "ilal"]),
    7: (["isim-maushul", "fiil-madhi", "athaf"],
        ["kalimah", "majrur", "huruf-jar", "jamak-mudzakkar-salim", "alif-lam", "idhafah", "dhamir", "murab-mabni", "jumlah-filiyyah",
         "manshub"], ["badal"], ["isim-fail", "bab-ifal", "isim-maful", "naib-fail"]),
}
LEARNT_BEFORE = {1: 2, 2: 4, 3: 7, 4: 9, 5: 10, 6: 13, 7: 16}


class Curriculum(unittest.TestCase):
    def test_unmutated_passes(self):
        self.assertEqual(run(), [])

    def test_mutations_fail(self):
        for name, fault, expect in MUTATIONS:
            with self.subTest(name):
                errs = fault()
                self.assertTrue(any(expect in e for e in errs), f"{name}: expected {expect!r} in {errs[:5]}")

    def test_totals(self):
        # kurikulum-dasar.md E, and the task's own count of the terms.
        self.assertEqual(VC.totals(AUTHORED, TABLE), {
            "lessons": 32, "steps": 36, "lessons without a new step": 10, "owned terms": 86, "free terms": 4,
            "next-level terms": 76, "next-level records": 18})
        self.assertEqual(len(LIBRARY["concepts"]), 37)
        per_unit = {u["id"]: sum(len(l["steps"]) for l in CONTENT["lessons"] if l["unit"] == u["id"]) for u in CONTENT["units"]}
        self.assertEqual(per_unit, {"pengantar": 2, "al-fatihah": 17, "an-nas": 4, "al-falaq": 2, "al-ikhlas": 3, "ayat-kursi": 8})
        self.assertTrue(all(len(l["steps"]) <= CUR.MAX_STEPS for l in CONTENT["lessons"]))
        self.assertEqual([len(lesson(CONTENT, f"1:{n}")["steps"]) for n in range(1, 8)], [2, 3, 2, 1, 3, 3, 3])

    def test_fatihah_table(self):
        got = {}
        for n in range(1, 8):
            m = a_map(CONTENT, f"1:{n}")
            got[n] = (m["new"], [x["id"] for x in m["learnt"] if x["here"]], m["later"], m["lanjut"])
            self.assertEqual(len(m["learnt"]), LEARNT_BEFORE[n], n)
            self.assertEqual((lesson(CONTENT, f"1:{n}")["before"], lesson(CONTENT, f"1:{n}")["after"]),
                             (LEARNT_BEFORE[n], LEARNT_BEFORE[n] + len(m["new"])), n)
        self.assertEqual(got, FATIHAH)
        # What the built file holds is the derivation.
        self.assertEqual({lid: {k: v for k, v in lesson(CONTENT, lid).items() if k in ("lines", "map")}
                          for lid in CUR.derive(AUTHORED, LESSONS, LIBRARY)},
                         CUR.derive(AUTHORED, LESSONS, LIBRARY))
        self.assertEqual(sum(1 for l in CONTENT["lessons"] if "map" in l), 22)  # 7 + 6 + 5 + 4 ayat on disk

    def test_new_and_learnt_are_always_apart_and_learnt_is_cumulative(self):
        # Decision 9: "separate new vs already knows concept" — and "learnt so far" is everything
        # taught before, each lesson's list the one before it plus that lesson's new steps.
        seen: list[str] = []
        for l in CONTENT["lessons"]:
            m = l.get("map")
            if m:
                learnt = [x["id"] for x in m["learnt"]]
                self.assertEqual(learnt, seen, l["id"])
                groups = m["new"] + learnt + m["later"]
                self.assertEqual(len(set(groups)), len(groups), l["id"])
                self.assertEqual(len(learnt), l["before"], l["id"])
            seen += l["steps"]
        self.assertEqual(len(seen), 36)

    def test_teaching_order_is_the_curriculums_not_the_mushafs(self):
        # Decision 2: An-Nas, Al-Falaq, Al-Ikhlas after Al-Fatihah, then Ayat al-Kursi.
        rank = CUR.ranks(CONTENT)
        self.assertLess(rank["0"], rank["1:1"])
        self.assertLess(rank["1:7"], rank["114:1"])
        self.assertLess(rank["114:6"], rank["113:1"])
        self.assertLess(rank["113:5"], rank["112:1"])
        self.assertLess(rank["112:4"], rank["2:255/1"])
        # Fi'il amr is taught on qul in An-Nas (decision 3): Al-Falaq and Al-Ikhlas REPEAT it,
        # and Al-Fatihah 6 only sees it coming.
        self.assertEqual(step(CONTENT, "fiil-amr")["lesson"], "114:1")
        self.assertIn("fiil-amr", a_map(CONTENT, "1:6")["later"])
        for lid in ("113:1", "112:1"):
            self.assertIn({"id": "fiil-amr", "here": True}, a_map(CONTENT, lid)["learnt"], lid)
        # Badal at 114:2 (decision 4); idhafah at 1:4 and na't at 1:3 (decision 1).
        self.assertEqual([step(CONTENT, s)["lesson"] for s in ("badal", "idhafah", "naat")], ["114:2", "1:4", "1:3"])

    def test_how_a_step_is_taught(self):
        kinds = {s["id"]: CUR.kind(s) for s in AUTHORED["steps"]}
        self.assertEqual(kinds["harakat"], "basics")
        self.assertEqual(kinds["kalimah"], "record")
        self.assertEqual([kinds[s] for s in ("majrur", "marfu", "manshub", "alif-lam")], ["teach"] * 4)
        self.assertIsNone(kinds["majzum"])       # a part of i'rab with no text yet
        self.assertIsNone(kinds["jamak-taksir"])  # no record, no text yet
        self.assertEqual(sum(1 for k in kinds.values() if k == "record"), 18)
        # A whole record keeps the line id it always had; a step with its own text has its own.
        self.assertEqual(step(CONTENT, "naat")["line"], "concept:naat")
        self.assertEqual(step(CONTENT, "nafi-lam")["line"], "concept:jazm-lam")
        self.assertEqual(step(CONTENT, "majrur")["line"], "concept:majrur")
        self.assertIsNone(step(CONTENT, "harakat")["line"])
        self.assertIsNone(step(CONTENT, "majzum")["line"])
        # No line for a next-level record, anywhere; a lesson says at most three.
        said = [t["line"] for l in CONTENT["lessons"] for t in l.get("lines") or []]
        self.assertEqual(len(set(said)), len(said))
        for cid in CONTENT["lanjut"]:
            self.assertNotIn(f"concept:{cid}", said, cid)
        self.assertTrue(all(len(l.get("lines") or []) <= CUR.MAX_STEPS for l in CONTENT["lessons"]))
        # Lesson zero has no ayah: the kalimah record has a text and no lesson to say it in yet.
        self.assertNotIn("concept:kalimah-isim-fiil-huruf", said)
        self.assertEqual(lesson(CONTENT, "0")["steps"], ["harakat", "kalimah"])
        self.assertNotIn("lines", lesson(CONTENT, "0"))

    def test_where_a_step_occurs(self):
        a1, a2, a3 = (LESSONS["al-fatihah"]["ayat"][i] for i in range(3))
        by = {s["id"]: s for s in AUTHORED["steps"]}
        self.assertEqual(CUR.occurs(by["majrur"], a1), [1, 2, 3, 4])   # case.state
        self.assertEqual(CUR.occurs(by["marfu"], a1), [])
        self.assertEqual(CUR.occurs(by["marfu"], a2), [1])
        self.assertEqual(CUR.occurs(by["alif-lam"], a1), [3, 4])        # a QAC segment tagged DET
        self.assertEqual(CUR.occurs(by["alif-lam"], a2), [1, 4])        # not lillāhi: QAC has no DET there
        self.assertEqual(CUR.occurs(by["kalimah"], a3), [1, 2])         # always: every word is one of the three kinds
        self.assertEqual(CUR.occurs(by["harakat"], a1), [])             # a basics step is never marked here
        self.assertEqual(CUR.occurs(by["idhafah"], a1), [1, 2])         # tagged, and the words of its structure group
        self.assertEqual(CUR.occurs(by["jamak-taksir"], a1), [])        # no record, no rule: nowhere yet
        self.assertEqual(CUR.qac_tags(a3["words"][0]), ["DET", "ADJ"])
        self.assertEqual(CUR.qac_tags({"sources": []}), [])
        # kurikulum-dasar.md C: alif lam in Al-Fatihah, per ayah: 2, 2, 2, 1, 0, 2, 2.
        self.assertEqual([len(CUR.occurs(by["alif-lam"], a)) for a in LESSONS["al-fatihah"]["ayat"]], [2, 2, 2, 1, 0, 2, 2])
        # … and majrur: 4, 3, 2, 3, 0, 0, 3.
        self.assertEqual([len(CUR.occurs(by["majrur"], a)) for a in LESSONS["al-fatihah"]["ayat"]], [4, 3, 2, 3, 0, 0, 3])
        # Majzum exists only at 112:3-4.
        hits = {f"{s}:{a['ayah']}" for s, l in LESSONS.items() for a in l["ayat"] if CUR.occurs(by["majzum"], a)}
        self.assertEqual(hits, {"al-ikhlas:3", "al-ikhlas:4"})

    def test_the_lines_light_the_words_the_step_occurs_on(self):
        # The narration validator reads the same words back (validate_narration.line_view).
        for slug, les in LESSONS.items():
            for a in les["ayat"]:
                for t in V.taught_lines(a, CONTENT):
                    self.assertEqual(V.line_view(a, t["line"], None, CONTENT), (t["words"], None), f"{a['loc']} {t['line']}")
        a1 = LESSONS["al-fatihah"]["ayat"][0]
        self.assertEqual([(t["line"], t["words"]) for t in V.taught_lines(a1, CONTENT)],
                         [("concept:majrur", [1, 2, 3, 4]), ("concept:huruf-jar", [1])])

    def test_who_owns_a_term(self):
        own = CUR.owners(AUTHORED)
        self.assertEqual((own["mudhaf-ilaih"], own["marfu"], own["kasrah"], own["jazim"]), ("idhafah", "marfu", "harakat", "nafi-lam"))
        self.assertEqual(CUR.term_home(AUTHORED, "mudhaf-ilaih"), "1:4")
        self.assertEqual(CUR.term_home(AUTHORED, "kasrah"), "0")
        self.assertEqual(CUR.term_home(AUTHORED, "wazan"), CUR.NEXT_LEVEL)
        self.assertIsNone(CUR.term_home(AUTHORED, "nahwu"))  # free
        uses = ["majrur", "mudhaf-ilaih", "kasrah", "wazan", "nahwu", "mudhaf-ilaih", "naat"]
        self.assertEqual(CUR.too_early(AUTHORED, "1:1", uses), ["mudhaf-ilaih", "wazan", "naat"])
        self.assertEqual(CUR.too_early(AUTHORED, "1:3", uses), ["mudhaf-ilaih", "wazan"])
        self.assertEqual(CUR.too_early(AUTHORED, "1:4", uses), ["wazan"])          # the next level never arrives
        self.assertEqual(CUR.too_early(AUTHORED, "114:1", uses), ["wazan"])        # a later SURAH in teaching order
        self.assertEqual(CUR.too_early(AUTHORED, "1:1", uses, allowed={"naat"}), ["mudhaf-ilaih", "wazan"])
        # An-Nas comes before Al-Falaq: a term taught in An-Nas is known there, one of Al-Ikhlas is not.
        self.assertEqual(CUR.too_early(AUTHORED, "113:1", ["badal", "jazim"]), ["jazim"])
        # The narrated terms map onto the term table through their Arabic; a letter's name is free.
        ids = V.term_ids(LEX)
        self.assertEqual(ids["نَعْت"], "naat")
        self.assertEqual(ids["مَعْرِفَة"], "marifah")
        self.assertNotIn("بَاء", ids)
        self.assertNotIn("Allah", ids)
        self.assertEqual(V.prose_terms("Huruf jar membuat isim sesudahnya majrur, lalu lafaz Allah dan huruf ba'.", LEX, ids),
                         ["huruf-jar", "isim", "majrur"])

    def test_the_tolerated_list_both_ways(self):
        home = lambda t: CUR.term_home(AUTHORED, t)  # noqa: E731
        found = {"al-fatihah:1:w2:compose:2": ["mudhaf-ilaih"], "al-fatihah:1:structure": ["idhafah", "naat"]}
        self.assertEqual(CUR.pending_problems("line", found, copy.deepcopy(found), home), [])
        # A violation that is not listed fails, and says where the term is taught.
        errs = CUR.pending_problems("line", found, {"al-fatihah:1:structure": ["idhafah", "naat"]}, home)
        self.assertEqual(len(errs), 1)
        self.assertIn("al-fatihah:1:w2:compose:2: uses the term 'mudhaf-ilaih' before the lesson that teaches it (taught in 1:4)", errs[0])
        errs = CUR.pending_problems("line", {"x:1:w1": ["wazan"]}, {}, home)
        self.assertIn("(taught in tingkat lanjut)", errs[0])
        # A listed entry that no longer violates fails as stale: the whole line, or one of its terms.
        errs = CUR.pending_problems("line", {"al-fatihah:1:structure": ["idhafah"]}, found, home)
        self.assertEqual(sorted(errs), sorted([
            "authored/curriculum.pending.json: al-fatihah:1:w2:compose:2 no longer uses 'mudhaf-ilaih' too early (stale): remove it",
            "authored/curriculum.pending.json: al-fatihah:1:structure no longer uses 'naat' too early (stale): remove it"]))
        self.assertIn("remove an empty one", CUR.pending_problems("line", {}, {"x": []}, home)[0])
        # The file, emptied, is still a file the checks read strictly.
        self.assertEqual(json.loads(CUR.dump_pending({}, {}))["lines"], {})
        self.assertEqual(CUR.pending_problems("line", {}, {}, home), [])

    def test_names(self):
        namer = BC.Namer(LESSONS, LEX)
        for s in CONTENT["steps"]:
            named, _ = namer.step(step(AUTHORED, s["id"]))
            self.assertEqual((s["name"], s["latin"]), (named["name"], named["latin"]), s["id"])
            self.assertEqual(namer.shown(s["latin"]), s["name"], s["id"])
        self.assertEqual(step(CONTENT, "majrur")["name"], "Majrur (مَجْرُور)")
        self.assertEqual(step(CONTENT, "murab-mabni")["name"], "Mu’rab (مُعْرَب) dan mabni (مَبْنِيّ)")
        self.assertEqual(step(CONTENT, "kalimah")["name"], "Tiga jenis kata")
        # No name holds a Qur'anic word (2026-10-13: "Lam nafi" and "Lā nafi" were renamed "Huruf
        # nafi yang menjazmkan" and "Huruf nafi") …
        errs, notes = VC.speech_problems(AUTHORED, LESSONS, LIBRARY, namer, SWITCHED)
        self.assertEqual((errs, notes), ([], []))
        # … and the rule still reads one. PLANTED: the old name on its step. Listed, not refused,
        # while no lesson map says it …
        named = copy.deepcopy(AUTHORED)
        step(named, "nafi-lam")["name"] = "Lam nafi"
        errs, notes = VC.speech_problems(named, LESSONS, LIBRARY, namer, SWITCHED)
        self.assertEqual(errs, [])
        self.assertEqual([n.split(" ")[1] for n in notes], ["nafi-lam"])
        self.assertIn("names the Qur'anic word(s) ['Lam']", notes[0])
        # … and refused the day its surah is switched on.
        errs, _notes = VC.speech_problems(named, LESSONS, LIBRARY, namer, ["al-fatihah", "al-ikhlas"])
        self.assertTrue(any("steps[nafi-lam] name: names the Qur'anic word(s) ['Lam']" in e for e in errs), errs)
        # A step of a surah that IS switched on, so named: refused at once.
        step(named, "naat")["name"] = "Sifat seperti rabbi"
        errs, _notes = VC.speech_problems(named, LESSONS, LIBRARY, namer, SWITCHED)
        self.assertTrue(any("steps[naat] name: names the Qur'anic word(s)" in e for e in errs), errs)

    def test_a_steps_own_text(self):
        t = step(CONTENT, "alif-lam")["teach"]
        self.assertEqual(t["title"], "Alif lam, penanda isim yang tertentu")
        self.assertEqual(t["marked"]["title"], "Alif lam, penanda [[isim|isim]] yang tertentu")
        self.assertIn("[[ma'rifah|marifah]]", t["marked"]["summary"])
        self.assertTrue(all(set(x) == {"kitab", "ref", "url"} for x in t["sources"]))
        self.assertEqual(CUR.taught_text(CONTENT, LIBRARY, "alif-lam"), (t["title"], t["summary"]))
        rec = next(c for c in LIBRARY["concepts"] if c["id"] == "naat")
        self.assertEqual(CUR.taught_text(CONTENT, LIBRARY, "naat"), (rec["title"], rec["summary"]))
        self.assertIsNone(CUR.taught_text(CONTENT, LIBRARY, "harakat"))
        # The Name, a surah's name and the letter lam are no Qur'anic word to the narration.
        namer = BC.Namer(LESSONS, LEX)
        self.assertEqual(namer.quranic_words("Nama diri, seperti lafaz Allah, tanpa alif lam; lihat Surah An-Nas."), [])
        self.assertEqual(namer.quranic_words("Seperti rabbi dan lam."), ["rabbi", "lam"])


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
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(Curriculum)
    res = unittest.TextTestRunner(verbosity=1, stream=sys.stdout).run(suite)
    print(f"\n{len(MUTATIONS)} planted faults, {len(MUTATIONS) - failed + bool(base)} caught" if not base else "\nunmutated copies fail")
    return 1 if failed or not res.wasSuccessful() else 0


if __name__ == "__main__":
    sys.exit(main())
