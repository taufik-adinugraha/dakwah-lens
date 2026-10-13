#!/usr/bin/env python3
"""Planted-fault tests for the lesson map guard (validate_map.py, lessonmap.py, build_map.py;
operator 2026-10-13, docs/belajar-plan.md L23 and L26): each case plants ONE fault — in a copy of
the built map file, of the authored switch file, of the curriculum, of the library or of the
narration — and asserts the guard fails with the expected message; the unmutated copies must pass.
Also pins the map of Al-Fatihah (version 2: new / learnt-and-here / later / lanjut, measured on
2026-10-13) and unit-tests the name cut, where a step is taught, and what switching another surah
on asks for. Standard library only; run from belajar/pipeline, after build_curriculum.py,
build_map.py and build_narration.py:

    python3 test_validate_map.py          # table of faults and the message that caught each
    python3 -m unittest test_validate_map # the same as a unittest run
"""
from __future__ import annotations

import copy
import json
import sys
import unittest

import build_map as BM
import curriculum as CUR
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
CURRICULUM = CUR.load_content()
LEX = V.load_lexicon()


def run(contents=None, *, authored=None, library=None, lessons=None, curriculum=None, manifests=None):
    return VM.check(copy.deepcopy(CONTENTS) if contents is None else contents,
                    LESSONS if lessons is None else lessons, LIBRARY if library is None else library,
                    MANIFESTS if manifests is None else manifests,
                    authored=copy.deepcopy(AUTHORED) if authored is None else authored, lex=LEX,
                    curriculum=CURRICULUM if curriculum is None else curriculum)


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


def in_curriculum(fn):
    """A fault in content/curriculum.json (what the map is copied from)."""
    def f():
        c = copy.deepcopy(CURRICULUM)
        fn({s["id"]: s for s in c["steps"]})
        return run(curriculum=c)
    return f


def in_library(fn):
    def f():
        lib = copy.deepcopy(LIBRARY)
        fn({c["id"]: c for c in lib["concepts"]})
        return run(library=lib)
    return f


def in_narration(fn):
    def f():
        m = copy.deepcopy(MANIFESTS)
        fn(m[SLUG]["lines"])
        return run(manifests=m)
    return f


def learnt_to_later(ayah: int, sid: str):
    def f(c):
        e = entry(c, ayah)
        e["learnt"] = [x for x in e["learnt"] if x["id"] != sid]
        e["later"].append(sid)
    return f


def later_to_learnt(ayah: int, sid: str):
    def f(c):
        e = entry(c, ayah)
        e["later"].remove(sid)
        e["learnt"].append({"id": sid, "here": True})
    return f


def other_surah():
    c = copy.deepcopy(CONTENTS)
    c["al-ikhlas"] = {**copy.deepcopy(c[SLUG]), "slug": "al-ikhlas", "surah": 112}
    return run(c)


def version_one():
    """The file as it was before the curriculum: {version, slug, surah, concepts, ayat}."""
    c = copy.deepcopy(CONTENTS)
    old = c[SLUG]
    c[SLUG] = {"version": 1, "slug": SLUG, "surah": 1, "concepts": {}, "ayat": [{"ayah": a["ayah"], "new": a["new"], "review": [], "later": a["later"]} for a in old["ayat"]]}
    return run(c)


def no_text(steps):
    steps["marfu"].pop("teach")
    steps["marfu"]["line"] = None


# (name, run() → the guard's problems, substring the failure must contain)
MUTATIONS = [
    # --- what each group may hold
    ("a new step left out", built(lambda c: entry(c, 1)["new"].remove("huruf-jar")), "ayah 1: new is not what the curriculum gives for lesson 1:1"),
    ("a step of another ayah listed as new", built(lambda c: entry(c, 4)["new"].append("badal")),
     "ayah 4: new lists badal, which is taught in 114:2, not here"),
    ("the new steps in another order", built(lambda c: entry(c, 2)["new"].reverse()), "ayah 2: new is not what the curriculum gives"),
    ("four new steps", built(lambda c: entry(c, 2)["new"].append("kana")), "ayah 2: 4 new steps, more than 3"),
    ("learnt: a step that is taught later", built(later_to_learnt(1, "naat")),
     "ayah 1: learnt lists naat, which is not taught earlier (it is taught in 1:3)"),
    ("later: a step that was taught earlier", built(learnt_to_later(3, "majrur")),
     "ayah 3: later lists majrur, which is not taught later (it is taught in 1:1)"),
    ("a step in two groups (new and learnt are always apart)", built(lambda c: entry(c, 3)["later"].append("naat")),
     "ayah 3: a step is listed twice"),
    ("learnt that is not the whole list so far", built(lambda c: entry(c, 5)["learnt"].pop(0)),
     "ayah 5: learnt is not what the curriculum gives for lesson 1:5"),
    ("a learnt step marked here that does not occur", built(lambda c: entry(c, 1)["learnt"][0].__setitem__("here", True)),
     "ayah 1: learnt is not what the curriculum gives"),
    ("a postponed step left out", built(lambda c: entry(c, 1)["later"].remove("naat")), "ayah 1: later is not what the curriculum gives"),
    ("later not in teaching order", built(lambda c: entry(c, 5)["later"].reverse()), "ayah 5: later is not what the curriculum gives"),
    ("lanjut: a record that is taught at this level", built(lambda c: entry(c, 1)["lanjut"].append("naat")),
     "ayah 1: lanjut lists naat, which is not a next-level record of the curriculum"),
    ("lanjut: a record the ayah does not carry", built(lambda c: entry(c, 1)["lanjut"].append("hal")),
     "ayah 1: lanjut is not what the curriculum gives"),
    ("a step that is no step of the curriculum", built(lambda c: entry(c, 1)["later"].append("tidak-ada")),
     "ayah 1: ['tidak-ada'] are no steps of the curriculum"),
    ("a learnt step without its `here`", built(lambda c: entry(c, 2)["learnt"].__setitem__(0, "harakat")),
     "ayah 2: an entry is exactly {ayah, new, learnt, later, lanjut}"),
    ("an ayah without its entry", built(lambda c: c["ayat"].pop()), "ayat must be the lesson's ayat, each once, in order"),
    # --- the names tables
    ("a step placed in another lesson", built(lambda c: c["steps"]["naat"].__setitem__("lesson", "1:1")),
     "step naat is taught in 1:3, not 1:1"),
    ("a step named otherwise than the curriculum names it", built(lambda c: c["steps"]["naat"].__setitem__("name", "Sifat (نَعْت)")),
     "step naat is named “Na’t (نَعْت)” by the curriculum, not “Sifat (نَعْت)”"),
    ("a listed step without its record", built(lambda c: c["steps"].pop("badal")), "steps must be exactly the steps its ayat list"),
    ("a step record no ayah lists", built(lambda c: c["steps"].__setitem__("kana", {"name": "Kana", "latin": "Kana", "lesson": "112:4"})),
     "steps must be exactly the steps its ayat list"),
    ("the steps not in teaching order", built(lambda c: c.__setitem__("steps", dict(reversed(list(c["steps"].items()))))),
     "steps must be exactly the steps its ayat list, in teaching order"),
    ("a listed next-level record without its name", built(lambda c: c["lanjut"].pop("ilal")), "lanjut must be exactly the next-level records"),
    ("a next-level name longer than four words", built(lambda c: c["lanjut"]["ilal"].__setitem__("latin", "Perubahan huruf yang lemah itu")),
     "is longer than 4 words"),
    ("a hand-edited file", built(lambda c: c["lanjut"]["ilal"].__setitem__("latin", "I'lall")), "out of date with build_map.py"),
    ("another format version", built(lambda c: c.__setitem__("version", 1)), "version must be 2"),
    ("a key the format does not have", built(lambda c: c.__setitem__("note", "x")), "exactly {version, slug, surah, steps, lanjut, ayat}"),
    ("a file of the format before the curriculum", version_one, "exactly {version, slug, surah, steps, lanjut, ayat}"),
    # --- the per-surah switch
    ("a map for a surah that is not switched on", other_surah, "no authored/al-ikhlas.map.json behind it"),
    ("switched on, never built", lambda: run({}), "authored/al-fatihah.map.json has no built file"),
    # --- the authored file
    ("a name for a record the surah does not list", in_authored(lambda a: a["names"].__setitem__("hal", "Hal")),
     "which no ayah of al-fatihah lists as a next-level topic"),
    ("a Qur'anic word in an explicit name", in_authored(lambda a: a["names"].__setitem__("ilal", "I'lal rabbi")),
     "names the Qur'anic word(s)"),
    ("an explicit name longer than four words",
     in_authored(lambda a: a["names"].__setitem__("ilal", "Perubahan huruf yang lemah itu")), "is longer than 4 words"),
    ("the authored later item of version 1 (superseded by the curriculum)",
     in_authored(lambda a: a.__setitem__("later", [{"ayah": 1, "id": "marfu", "name": "Marfu'", "note": "x", "line": "al-fatihah:2:w1:compose:8"}])),
     "`later` (an authored item an ayah postpones) was superseded by the curriculum"),
    # --- the curriculum under the map
    ("a step whose name the narrator cannot say", in_curriculum(lambda s: s["naat"].__setitem__("latin", "Sifat rabbi")),
     "step naat is named “Sifat rabbi”, which the narrator cannot say"),
    ("a new step with no text to teach it", in_curriculum(no_text),
     "al-fatihah 2: step marfu is new here and has no text to teach it"),
    ("the curriculum moved under the file (a step renamed)", in_curriculum(lambda s: s["badal"].__setitem__("name", "Pengganti")),
     "step badal is named “Pengganti” by the curriculum"),
    # --- the content moved under the file
    ("a next-level title that opens with no name",
     in_library(lambda c: c["ilal"].__setitem__("title", "Perubahan huruf yang lemah supaya ringan diucapkan")),
     "opens with no name of at most 4 words"),
    # --- the card, the caption and the narrator name a step alike
    ("a step named otherwise than its own caption opens",
     in_narration(lambda ls: ls["al-fatihah:3:concept:naat"].__setitem__("display", "Konsep baru: Sifat yang mengikuti.")),
     "naat is named “Na’t (نَعْت)”, and its caption (al-fatihah:3:concept:naat) does not open with that name"),
    ("a step of this surah with no line that teaches it", in_narration(lambda ls: ls.pop("al-fatihah:1:concept:majrur")),
     "majrur: no narration line al-fatihah:1:concept:majrur to teach it"),
]

# Al-Fatihah, measured on 2026-10-13: ayah → (new, the learnt steps that occur here, later, lanjut).
# kurikulum-dasar.md E gives the New column and how many steps were learnt before each ayah.
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


class LessonMap(unittest.TestCase):
    def test_unmutated_passes(self):
        self.assertEqual(run(), [])

    def test_mutations_fail(self):
        for name, fault, expect in MUTATIONS:
            with self.subTest(name):
                errs = fault()
                self.assertTrue(any(expect in e for e in errs), f"{name}: expected {expect!r} in {errs[:5]}")

    def test_fatihah_table(self):
        content = CONTENTS[SLUG]
        self.assertEqual({a["ayah"]: (a["new"], LM.here_ids(a), a["later"], a["lanjut"]) for a in content["ayat"]}, FATIHAH)
        self.assertEqual({a["ayah"]: len(a["learnt"]) for a in content["ayat"]}, LEARNT_BEFORE)
        self.assertEqual([LM.learnt_total(a) for a in content["ayat"]], [4, 7, 9, 10, 13, 16, 19])
        # new 2 / 3 / 2 / 1 / 3 / 3 / 3 — never more than three (the map of version 1 had 5, 3, 1, 1, 8, 2, 6).
        self.assertEqual([len(a["new"]) for a in content["ayat"]], [2, 3, 2, 1, 3, 3, 3])
        # Every list is the curriculum's own.
        for a in content["ayat"]:
            self.assertEqual({g: a[g] for g in LM.GROUPS}, CUR.lesson_of(CURRICULUM, f"1:{a['ayah']}")["map"], a["ayah"])
        # 19 steps are learnt by the end of the surah (2 of them in the lesson with no ayah), and
        # two more are seen and taught in An-Nas.
        self.assertEqual(len(content["steps"]), 21)
        self.assertEqual([sid for sid, s in content["steps"].items() if CUR.place(s["lesson"])[0] not in (None, 1)], ["fiil-amr", "badal"])
        self.assertEqual(list(content["lanjut"]), ["syibhul-jumlah", "wazan-dan-tashrif", "isim-fail", "taqdim-maful", "bab-istifal",
                                                  "ilal", "bab-ifal", "isim-maful", "naib-fail"])

    def test_marfu_is_a_step_now(self):
        # Operator 2026-10-13: "in ayat-1, it mentions 'bentuk tertentu' but no explanation about
        # marfu' itself, better to inform it will be learnt later". Then an authored item of the
        # map; now a step of the curriculum, taught in ayah 2 from its own text.
        s = CONTENTS[SLUG]["steps"]["marfu"]
        self.assertEqual(s, {"name": "Marfu’ (مَرْفُوع)", "latin": "Marfu'", "lesson": "1:2"})
        self.assertNotIn("later", AUTHORED[SLUG])
        lines = MANIFESTS[SLUG]["lines"]
        self.assertTrue(lines["al-fatihah:2:concept:marfu"]["display"].startswith("Konsep baru: Marfu’ (مَرْفُوع), dan tandanya: dhammah (ضَمَّة)."))
        # Ayah 1 has no marfu' word, so its card no longer lists it; the sentence that points ahead
        # there stays, and no line of ayah 1 names the term (the curriculum's own rule holds that).
        self.assertNotIn("marfu", entry(CONTENTS[SLUG], 1)["later"])
        self.assertTrue(lines["al-fatihah:1:w1:compose:3"]["display"].endswith("Mengapa dhammah (ضَمَّة), kita pelajari di ayat kedua."))
        for lid, ln in lines.items():
            if lid.startswith("al-fatihah:1:"):
                self.assertNotIn("marfu", ln["display"].lower(), lid)
        # From ayah 3 on it is learnt, and marked wherever a word is marfu' (the two verbs of ayah 5).
        self.assertIn({"id": "marfu", "here": False}, entry(CONTENTS[SLUG], 3)["learnt"])
        self.assertIn({"id": "marfu", "here": True}, entry(CONTENTS[SLUG], 5)["learnt"])

    def test_where_a_step_is_taught(self):
        steps = CONTENTS[SLUG]["steps"]
        self.assertEqual(LM.taught_ayah(steps["naat"], 1), 3)
        self.assertIsNone(LM.taught_ayah(steps["fiil-amr"], 1))   # An-Nas 1: the narrator says "nanti"
        self.assertEqual(LM.taught_ayah(steps["fiil-amr"], 114), 1)
        self.assertIsNone(LM.taught_ayah(steps["kalimah"], 1))    # the lesson with no ayah
        self.assertIsNone(LM.taught_ayah({"lesson": "2:255/4"}, 2))  # a segment is no ayah to name

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

    def test_names(self):
        namer = BM.Namer(LESSONS, LEX)
        # A step is named by the curriculum, and its caption opens with that name.
        by = {s["id"]: s for s in CURRICULUM["steps"]}
        lines = MANIFESTS[SLUG]["lines"]
        for sid, s in CONTENTS[SLUG]["steps"].items():
            with self.subTest(sid):
                self.assertEqual((s["name"], s["latin"], s["lesson"]), (by[sid]["name"], by[sid]["latin"], by[sid]["lesson"]))
                self.assertEqual(namer.shown(s["latin"]), s["name"])
                self.assertEqual(namer.step_problems(sid, s["latin"]), [])
                surah, ayah, _seg = CUR.place(s["lesson"])
                if surah == 1:
                    shown = V._field_of(lines, f"{SLUG}:{ayah}:{by[sid]['line']}", "display")
                    self.assertTrue(shown.startswith(f"{V.TITLE_LEAD} {s['name']}"), shown[:60])
        # A next-level record is named as its Konsep title opens.
        concepts = {c["id"]: c for c in LIBRARY["concepts"]}
        for cid, c in CONTENTS[SLUG]["lanjut"].items():
            with self.subTest(cid):
                self.assertEqual(c["from"], "title")
                self.assertEqual(namer.shown(c["latin"]), c["name"])
                self.assertEqual(LM.cut_name(namer.title(concepts[cid], *LM.first_example(concepts[cid]))), c["latin"])
        # A title that names a Qur'anic word, or opens with a description, gets no guessed name.
        for cid in ("jazm-lam", "zharaf-idza"):
            with self.subTest(cid), self.assertRaises(LM.MapError):
                namer(concepts[cid], *LM.first_example(concepts[cid]), None)

    def test_other_surahs_are_off(self):
        self.assertEqual(LM.authored_slugs(), [SLUG])
        self.assertEqual(list(CONTENTS), [SLUG])

    def test_switching_another_surah_on_asks_for_what_it_lacks(self):
        # An-Nas: two of its steps have no text yet (jamak taksir, mudzakkar dan mu'annats).
        with self.assertRaises(LM.MapError) as e:
            BM.build_all(LESSONS, LIBRARY, LEX, {**AUTHORED, "an-nas": {"slug": "an-nas", "names": {}}}, CURRICULUM)
        self.assertIn("an-nas 5: step jamak-taksir is new here and has no text to teach it", str(e.exception))
        # Al-Ikhlas: a step's name holds a Qur'anic word ("Lam nafi": lam is its first word of ayah 3).
        with self.assertRaises(LM.MapError) as e:
            BM.build_all(LESSONS, LIBRARY, LEX, {**AUTHORED, "al-ikhlas": {"slug": "al-ikhlas", "names": {}}}, CURRICULUM)
        self.assertIn("al-ikhlas: step nafi-lam is named “Lam nafi”, which the narrator cannot say", str(e.exception))
        # Al-Fatihah's own map is untouched by another switch.
        self.assertEqual(BM.build_all(LESSONS, LIBRARY, LEX, copy.deepcopy(AUTHORED), CURRICULUM)[SLUG], CONTENTS[SLUG])


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
