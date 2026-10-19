#!/usr/bin/env python3
"""Mutation tests for validate_compose.py (word compositions and the harakat primer): each case
plants one fault in a copy of content/compose/<slug>.json (or of the authored file's sha256) and
asserts that the validator fails with the expected message; the unmutated copy must pass. Faults
only the pinned corpus can catch (a Tanzil token, an attestation, the parts against QAC's
segments) are listed as skipped with --no-corpus (CI). Also unit-tests the pieces and the edits.
The imam's voice of each bentuk dasar (`examples`, plan L20) has its own faults: a base frame
without its entry, a hamzat-washal word played alone, a clip shifted to the next word or taken
from another ayah's file, a word that ends its ayah, a reason that is not true, a fixture that
drifted (a mutation may plant its fault in fixtures/compose_examples.json: `in_fixture`).
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


FIXTURE = C.load_examples_fixture()


def run_check(contents, authored=None, fixture=None):
    return VC.check(contents, LESSONS, CORPUS, authored, copy.deepcopy(FIXTURE) if fixture is None else fixture)


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


def voice(loc, fn, k=0):
    """The k-th `examples` entry of a word, rewritten."""
    return setf(lambda x: fn(x["examples"][loc][k]))


def voice_is(loc, entry, k=0):
    """The k-th `examples` entry of a word, replaced (its frame and form kept)."""
    def f(c, a):
        e = c[SLUG]["examples"][loc][k]
        c[SLUG]["examples"][loc][k] = {"frame": e["frame"], "form": e["form"], **entry}
    return f


def in_fixture(fn):
    """A fault planted in fixtures/compose_examples.json (the contents stay as built)."""
    def f(c, a):
        pass
    f.fixture = fn
    return f


def mutated_fixture(mutate):
    fx = copy.deepcopy(FIXTURE)
    getattr(mutate, "fixture", lambda d: None)(fx)
    return fx


def swap_fixture_words(d):
    """Two words of 41:9 that no base frame shows, swapped in the fixture's Tanzil line."""
    toks = d["ayat"]["41:9"]["tanzil"].split(" ")
    toks[0], toks[1] = toks[1], toks[0]
    d["ayat"]["41:9"]["tanzil"] = " ".join(toks)


def lesson_clip(loc):
    """The lesson's own Alafasy timing of a lesson word, as a clip (clips.py)."""
    s, a, w = (int(x) for x in loc.split(":"))
    rec = C.CL.lesson_recitation(LESSONS, s, a)
    seg = next(x for x in rec["segments"] if x[0] == w)
    last = C.CL.is_last(s, a, w)
    return {"url": rec["url"], "start": seg[1], "end": seg[2], **({"last": True} if last else {})}


# (name, mutation(contents, authored-sha map), expected substring, needs the corpus)
MUTATIONS = [
    ("a form's bytes not its source's", setf(lambda x: x["words"]["1:1:1"]["forms"]["ismi"].__setitem__(
        "ar", x["words"]["1:1:1"]["forms"]["ismu"]["ar"])), "its source gives", False),
    ("a word slice that is not the word's", setf(lambda x: x["words"]["1:1:1"]["forms"]["bi"].__setitem__(
        "src", {"word": "1:1:1", "pieces": [1, 2]})), "its source gives", False),
    ("an edit that does not fit its form", setf(lambda x: x["words"]["1:1:1"]["forms"]["ismi"].__setitem__(
        "src", {"from": "ismu", "ops": [{"remove": "shaddah", "piece": 0}]})), "carries no shaddah", False),
    # the `letter` op (2026-10-17: the bentuk dasar of ٱلْعَٰلَمِينَ is ٱلْعَٰلَمُونَ, the ya' back to wawu)
    ("a letter op on a letter that is not a wawu or ya'", setf(lambda x: x["words"]["1:2:4"]["forms"]["al-alamuna"].__setitem__(
        "src", {"from": "al-alamina", "ops": [{"mark": -3, "to": "dhammah"}, {"letter": -1, "to": "wawu"}]})),
     "is not one of the letters", False),
    ("a letter op to a letter it may not write", setf(lambda x: x["words"]["1:2:4"]["forms"]["al-alamuna"].__setitem__(
        "src", {"from": "al-alamina", "ops": [{"mark": -3, "to": "dhammah"}, {"letter": -2, "to": "alif"}]})),
     "'to' must name a letter", False),
    # … and the dotless final ya' (ى) of the Uthmani text written as the ya' a learner knows (2026-10-18:
    # يَهْدِى → يَهْدِي, the verb ihdi comes from), to ya' only
    ("the dotless final ya' written as a wawu", setf(lambda x: x["words"]["1:6:1"]["forms"]["yahdi"].__setitem__(
        "src", {"from": "yahdi-uthmani", "ops": [{"letter": -1, "to": "wawu"}]})), "is not one of the letters", False),
    # a letter said to be dropped is SEEN with it and without it (operator 2026-10-18: "ihdina, lose
    # 'ya' but not explained about the original word of ihdi")
    ("ihdi's ya' said to be dropped with no frame that shows it, as until 2026-10-18", setf(lambda x: (
        x["words"]["1:6:1"]["frames"][1].update({"stage": "whole"}), x["words"]["1:6:1"]["frames"][1].pop("from"),
        x["words"]["1:6:1"]["frames"][1].pop("chips"))), "says a letter is dropped or not written, and no frame up to this one", False),
    ("lillāhi's letters said not to be written over a frame that shows nothing left out", setf(lambda x: (
        x["words"]["1:2:2"]["frames"][3].update({"stage": "whole"}), x["words"]["1:2:2"]["frames"][3].pop("from"),
        x["words"]["1:2:2"]["frames"][3].pop("chips"))), "1:2:2 line 5: says a letter is dropped or not written", False),
    ("the jamak's bentuk dasar with its ya' kept", setf(lambda x: x["words"]["1:2:4"]["forms"]["al-alamuna"].__setitem__(
        "src", {"from": "al-alamina", "ops": [{"mark": -3, "to": "dhammah"}]})), "its source gives", False),
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
    # frames[2] is the fathah's mark frame since 2026-10-15 (frames[1] shows the bare ba first)
    ("a primer mark frame whose example lacks the mark", setf(lambda x: x["primer"]["frames"][2].__setitem__(
        "tiles", ["ba-i"])), "no example tile carries the fathah", False),
    # the bare letter first, then the same letter with the mark (operator 2026-10-15: "Contohnya huruf ba'" over
    # ب, then "jika dibaca kasrah, maka terdengar bi" over بِ)
    ("a bare primer letter that already carries its mark", setf(lambda x: x["primer"]["frames"][1].__setitem__(
        "tiles", ["ba-a"])), "already carries the mark it shows before", False),
    ("a bare primer frame not followed by its mark", setf(lambda x: x["primer"]["frames"][1].__setitem__(
        "marks", ["kasrah"])), "followed by the mark frame of the same marks", False),
    ("a bare primer frame as the last frame", setf(lambda x: x["primer"]["frames"][-1].update(
        {"stage": "bare", "tiles": ["ma"]})), "followed by the mark frame of the same marks", False),
    ("the mark frame after a bare one shows another letter", setf(lambda x: x["primer"]["frames"][7].__setitem__(
        "tiles", ["ba"])), "is not the bare letter 'ba' with sukun put on", False),
    ("a bare primer frame with no letter", setf(lambda x: x["primer"]["frames"][9].__setitem__(
        "tiles", [])), "shows the letter before its mark", False),
    ("the primer's highlighted words not re-derived", setf(lambda x: x["primer"]["frames"][2].__setitem__(
        "words", [2])), "the words each primer frame shows", False),
    # 2026-10-13: the primer is played by lesson zero (`lesson: "0"`), the one lesson with no ayah
    ("the primer handed to a lesson that is not lesson zero", setf(lambda x: x["primer"].__setitem__("lesson", "1:2")),
     "`lesson` is '0', the lesson with no ayah that opens the course, or is left out", False),
    # (corpus-free, the narration and the curriculum catch it: lesson zero's lines and lists go)
    ("the primer's lesson marker dropped from the built file", setf(lambda x: x["primer"].pop("lesson")),
     "differs from a fresh build_compose.py run", True),
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
     say_of("1:1:2", 1, lambda t: t.replace("dhammah, bunyi u:", "dhammah:")), "first dhammah without its sound", False),
    ("the bentuk dasar said over a whole frame",
     say_of("1:5:1", 1, lambda t: t + " Bentuk dasarnya berakhir dengan dhammah, bunyi u."), "speaks of the bentuk dasar", False),
    ("written together, said over a word without parts",
     say_of("1:1:2", 1, lambda t: t + " Lalu kedua bagian ditulis bersambung."), "parts are written together", False),
    ("a part named over a one-tile frame",
     say_of("1:1:2", 2, lambda t: "Bagian kedua adalah nama Allah."), "names a part over a change frame", False),
    ("akar instead of bentuk dasar",
     say_of("1:1:1", 3, lambda t: t.replace("Bentuk dasarnya", "Akarnya")), "never “akar”", False),
    ("a letter pin outside the composition", frame_set("1:7:9", 2, letters=[["nope", 0]]), "letters pins", False),
    # --- the imam's voice of each bentuk dasar (`examples`; operator 2026-10-12, plan L20)
    ("no examples at all", setf(lambda x: x.pop("examples")), "no `examples`", False),
    ("a base frame without its voice entry", setf(lambda x: x["examples"].pop("1:1:1")),
     "are not one entry per base frame", False),
    ("a voice entry on a frame that is not a base frame", voice("1:1:1", lambda e: e.update(frame=3)),
     "are not one entry per base frame", False),
    ("a voice entry for a word that is not composed", setf(lambda x: x["examples"].__setitem__(
        "112:1:1", x["examples"]["1:1:2"])), "is not a composed word of this file", False),
    ("a hamzat-washal base form played alone (\"ismu\" would sound \"smu\")",
     voice("1:1:1", lambda e: (e.pop("washal"), e.update(key="55:78:2", clip=dict(e["clip"], start=1060)))),
     "starts with hamzat washal mid-ayah", False),
    ("a washal run that says another heard form", voice("1:1:1", lambda e: e["washal"].update(heard="tabārakaismu")),
     "is not what the bytes give", False),
    ("a washal `before` that is not the word before", voice("1:1:1", lambda e: e["washal"].update(before="rabbika", heard="rabbikasmu")),
     "does not name the word before it", False),
    ("a washal entry that plays the word alone", voice("1:1:1", lambda e: e.update(key="55:78:2")),
     "not the run with the word before it", False),
    ("`washal` on a word without a hamzat washal", voice("1:4:2", lambda e: e.update(
        washal={"run": "37:20:3-4", "before": "hāżā", "heard": "hāżāyaumu"})), "does not start with hamzat washal mid-ayah", False),
    ("a voice that is not the place the form quotes", voice("1:2:3", lambda e: e.update(loc="41:9:12", key="41:9:12")),
     "quotes 41:9:13, but its voice is 41:9:12", False),
    ("a voice whose word is not the bentuk dasar's bytes",
     setf(lambda x: x["examples"]["1:1:3"][0].update(loc="20:5:2", key="20:5:2")), "not the bentuk dasar", False),
    ("a clip shifted to the next word", voice("1:7:3", lambda e: e["clip"].update(start=5250, end=6050)),
     "is not the clip the fixture's quran-align entry of 5:23 gives", False),
    ("a clip from another ayah's file", voice("1:7:3", lambda e: e["clip"].update(
        url=e["clip"]["url"].replace("005023", "005024"))), "is not Alafasy_128kbps's file of 5:23", False),
    ("a clip in a lesson ayah that is not the lesson's own timing",
     setf(lambda x: [x["examples"][w][0]["clip"].update(start=50) for w in ("1:1:2", "1:2:2")]),
     "is not the lesson's timing", False),
    ("one place played as two different clips", voice("1:2:2", lambda e: e["clip"].update(end=970)),
     "plays the same place as", False),
    ("an implausibly long clip", voice("1:4:2", lambda e: e["clip"].update(end=e["clip"]["start"] + 9000)),
     "is not a plausible length", False),
    ("a bentuk dasar voiced on its ayah's last word (the ending is not heard there)",
     voice_is("1:5:4", {"loc": "1:5:4", "key": "1:5:4", "clip": lesson_clip("1:5:4")}), "is its ayah's last word", False),
    ("a second voice of the lesson's own word", voice_is("1:5:2", {"loc": "1:5:2", "key": "1:5:2", "clip": lesson_clip("1:5:2")}),
     "no second voice of it", False),
    ("'own' on a form that quotes another place", voice_is("1:1:2", {"unvoiced": "own"}), "is not the lesson word itself", False),
    ("'unattested' on a form that quotes a place", voice_is("1:4:2", {"unvoiced": "unattested"}), "that place is its voice", False),
    ("'unattested' on a form the Qur'an has", voice_is("1:7:5", {"unvoiced": "unattested"}), "but the form's attested list is", False),
    ("'unheard' on a teaching form", voice_is("1:4:1", {"unvoiced": "unheard"}), "but the form's attested list is", False),
    ("a reason that is not one of the three", voice_is("1:4:1", {"unvoiced": "later"}), "an unvoiced entry is exactly", False),
    ("an entry with a stray key", voice("1:4:2", lambda e: e.update(note="x")), "a voiced entry is exactly", False),
    ("a stale quran-align pin", setf(lambda x: x["data_versions"].__setitem__("quran_align", "release sha256:" + "0" * 64)),
     "does not pin", False),
    ("the fixture without an ayah a clip uses", in_fixture(lambda d: d["ayat"].pop("74:10")), "no entry for 74:10", False),
    ("the fixture with an ayah no clip uses", in_fixture(lambda d: d["ayat"].__setitem__("2:5", d["ayat"]["74:10"])),
     "2:5 is not the ayah of any clip outside the lessons", False),
    ("a fixture timing off by one word", in_fixture(lambda d: d["ayat"]["37:20"]["segments"][3].__setitem__(2, 3560)),
     "is not the clip the fixture's quran-align entry of 37:20 gives", False),
    ("a fixture under other pins", in_fixture(lambda d: d["pins"].__setitem__("quran_align", "other")),
     "are not those of sources.json", False),
    ("a fixture line that is not the Tanzil line", in_fixture(swap_fixture_words), "41:9 is not the pinned Tanzil line", True),
    ("a derived form's voice that is not the build's choice (another place of the same bytes)",
     voice("1:7:5", lambda e: e.update(loc="4:95:6", key="4:95:6", clip={
         "url": "/belajar/media/narration/alafasy/004095.mp3", "start": 4430, "end": 5020})),
     "differs from a fresh build_compose.py run", True),
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
                errs = run_check(c, a, mutated_fixture(mutate))
                self.assertTrue(any(expect in e for e in errs), f"{name}: expected {expect!r} in {errs[:4]}")

    def test_every_base_frame_has_a_voice_or_a_true_reason(self):
        c = CONTENTS[SLUG]
        rows = {loc: [(e["frame"], e["form"]) for e in es] for loc, es in c["examples"].items()}
        base = {loc: [(k, fr["focus"]) for k, fr in enumerate(u["frames"], 1) if fr["stage"] == "base"]
                for loc, u in c["words"].items()}
        self.assertEqual(rows, {loc: b for loc, b in base.items() if b})
        voiced = {loc: e for loc, es in c["examples"].items() for e in es if "clip" in e}
        # operator 2026-10-12: "ismu (read by voice + show visual)": heard with the word before it
        self.assertEqual(voiced["1:1:1"]["key"], "55:78:1-2")
        self.assertEqual(voiced["1:1:1"]["washal"], {"run": "55:78:1-2", "before": "tabāraka", "heard": "tabārakasmu"})
        # the Konsep diagram's place (plan L19), not 4:69:8
        self.assertEqual(voiced["1:7:3"]["loc"], "5:23:6")
        for loc, e in voiced.items():
            self.assertNotIn("last", e["clip"], f"{loc}: a bentuk dasar is never voiced on an ayah's last word")
        for loc, es in c["examples"].items():
            for e in es:
                if "unvoiced" in e:
                    self.assertIn(e["unvoiced"], C.UNVOICED)

    def test_voice_library_is_what_clips_checks(self):
        fx_T = C.CL.fixture_sources(FIXTURE)[1]
        lib = C.voice_library(CONTENTS, LESSONS, fx_T)
        self.assertEqual(list(lib["clips"]), C.example_keys(CONTENTS))
        self.assertEqual([k for k, _ in C.CL.wanted(lib)], C.example_keys(CONTENTS))
        ismu = CONTENTS[SLUG]["words"]["1:1:1"]["forms"]["ismu"]["ar"]
        self.assertTrue(lib["quran"]["55:78:1-2"].endswith(" " + ismu))
        self.assertEqual(len(lib["quran"]["55:78:1-2"].split(" ")), 2)

    @unittest.skipIf(CORPUS is None, "needs the corpus")
    def test_place_voice_rules(self):
        voices = C.Voices.load(LESSONS)
        # an ayah's last word: never (the ending is not heard)
        ex, why, _ = C.place_voice("55:1:1", "ar-raḥmānu", CORPUS, voices)
        self.assertIsNone(ex)
        self.assertIn("ends its ayah", why)
        # a hamzat washal mid-ayah whose word before has no transliteration on record: not usable
        ex, why, _ = C.place_voice("2:163:8", "ar-raḥmānu", CORPUS, voices)
        self.assertIsNone(ex)
        self.assertIn("hamzat washal", why)
        # … at the start of its ayah the alif is read: the word itself
        ex, why, _ = C.place_voice("20:5:1", "ar-raḥmānu", CORPUS, voices)
        self.assertEqual((ex["key"], why, "washal" in ex), ("20:5:1", None, False))
        # … with the library's typed `before`: the run, and what is heard
        ex, why, _ = C.place_voice("55:78:2", "ismu", CORPUS, voices)
        self.assertEqual((ex["key"], ex["washal"]["heard"]), ("55:78:1-2", "tabārakasmu"))
        # a derived form: a clean alignment in the shortest ayah
        forms = CONTENTS[SLUG]["words"]["1:7:5"]["forms"]
        entry, warns = C.base_voice("1:7:5", "gairu", forms["gairu"], CORPUS, voices)
        self.assertEqual((entry["loc"], warns), ("74:10:3", []))
        # a quoted place that is not heard as shown stops the build
        bad = dict(CONTENTS[SLUG]["words"]["1:4:2"]["forms"]["yaumu"], src={"tanzil": "1:4:3"})
        with self.assertRaises(C.ComposeError):
            C.base_voice("1:4:2", "yaumu", bad, CORPUS, voices)

    def test_quoted_place(self):
        self.assertEqual(C.quoted_place({"tanzil": "55:78:2"}), "55:78:2")
        self.assertEqual(C.quoted_place({"word": "112:2:1"}), "112:2:1")
        for sp in ({"word": "1:1:1", "pieces": [0, 1]}, {"qac": "1:1:3:2"}, {"from": "ismu", "ops": []}, {"join": ["a", "b"]}, None):
            self.assertIsNone(C.quoted_place(sp))


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
        # the ya' of a jamak back to the wawu of its bentuk dasar, by name (2026-10-17), and only those letters
        j = unit(CONTENTS, "1:2:4")["forms"]
        self.assertEqual(C.apply_op(C.apply_op(j["al-alamina"]["ar"], {"mark": -3, "to": "dhammah"}), {"letter": -2, "to": "wawu"}),
                         j["al-alamuna"]["ar"])
        self.assertEqual(C.pieces(j["al-alamuna"]["ar"])[-2:], ["\u0648", "\u0646\u064e"])
        for bad in ({"letter": -2, "to": "ya"}, {"letter": -1, "to": "wawu"}, {"letter": -2, "to": "alif"}, {"letter": 9, "to": "wawu"}):
            with self.assertRaises(C.ComposeError, msg=str(bad)):
                C.apply_op(j["al-alamina"]["ar"], bad)
        r = unit(CONTENTS, "1:1:3")["forms"]
        joined = r["al"]["ar"] + r["rahman"]["ar"]
        self.assertEqual(C.apply_op(C.apply_op(joined, {"remove": "sukun", "piece": 1}), {"add": "shaddah", "piece": 2}),
                         r["ar-rahman"]["ar"])

    def test_without_marks(self):
        p = CONTENTS[SLUG]["primer"]["forms"]
        f = {n: x["ar"] for n, x in p.items()}
        self.assertEqual(C.without_marks(f["ba-i"], ["kasrah"]), f["ba"])
        self.assertEqual(C.without_marks(f["rra"], ["shaddah"]), f["ra"])
        self.assertEqual(C.without_marks(f["maa"], ["small_alif"]), f["ma"])
        self.assertEqual(C.without_marks(f["sin"], ["sukun"]), f["s-bare"])
        self.assertIsNone(C.without_marks(f["ba"], ["kasrah"]))
        self.assertIsNone(C.without_marks(f["ba-a"], ["kasrah"]))

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
        errs = run_check(c, a, mutated_fixture(mutate))
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
