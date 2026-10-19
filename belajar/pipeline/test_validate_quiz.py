#!/usr/bin/env python3
"""Planted-fault tests for the quiz guard (validate_quiz.py, quiz.py): each case plants ONE fault —
in a copy of the authored Al-Fatihah plan (then rebuilt, as build_quiz.py would), of the built quiz
file, of the narration manifest or of the library — and asserts the guard fails with the expected
message; the unmutated copies must pass. Faults the operator named (2026-10-10, rule 16) come first:
a question on a case state not taught yet, a wrong option the lesson has not taught (or from an ayah
not studied yet), a question with two correct options, a wazan quiz on a form never taught. Since the basic
curriculum (operator-approved 2026-10-13, plan L26): a wazan exercise in a basic lesson, and the
list of questions that may still need an untaught term (authored/curriculum.pending.json `quiz`),
held both ways. Since the same day: the explanation shown after an answer is what the narrator
says (a word's `why_basic`) and its terms are held to TAUGHT; and the WARM-UP that opens every
ayah of a surah with a lesson map ("isim, fi'il, atau huruf?"), derived from the QAC tags — a
disagreement with the lesson's `pos`, a part left out, a wrong answer, a sign before its lesson,
an edited sentence; since 2026-10-17 (operator: "directly show which one") the kind's general
definition said again, a wrong class for a tag, a class said where none is taught, a class not
taught before the warm-up asks it. Also unit-tests TAUGHT (a glossed term is not taught, decision 6 of 2026-10-11),
the cause classes, the Arabic labels and the port of the components' seeded shuffle. Standard
library only; run from belajar/pipeline:

    python3 test_validate_quiz.py
"""
from __future__ import annotations

import copy
import json
import sys
import unittest

import build_quiz as BQ
import curriculum as CUR
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
# The questions that may still need an untaught term (authored/curriculum.pending.json `quiz`).
PENDING = CUR.load_pending()["quiz"]


# The curriculum and the surahs whose lesson map is switched on: what the warm-up is derived with.
CURRICULUM = CUR.load_content()
MAPPED = {sp.slug for sp in SURAHS if Q.has_map(sp.slug)}


def run(authored=None, quizzes=None, manifests=None, library=None, *, rebuild=True, pending=None, lessons=None,
        mapped=None, built_mapped=None):
    """The guard over copies; with `rebuild`, the quiz files are built from the (mutated) plans first,
    as build_quiz.py would (so a plan fault is caught by the plan's own checks, not as a stale file).
    `lessons`: mutated lesson content; `mapped`: the surahs with a lesson map as the guard sees
    them, `built_mapped`: as the files on disk were built (default: the same)."""
    authored = copy.deepcopy(AUTHORED) if authored is None else authored
    library = LIBRARY if library is None else library
    lessons = LESSONS if lessons is None else lessons
    mapped = MAPPED if mapped is None else mapped
    manifests = copy.deepcopy(MANIFESTS) if manifests is None else manifests
    try:
        fresh = BQ.build_all(lessons, library, TERMS, authored, curriculum=CURRICULUM, mapped=mapped)
        if quizzes is None and built_mapped is not None:
            quizzes = BQ.build_all(lessons, library, TERMS, authored, curriculum=CURRICULUM, mapped=built_mapped)
    except Q.QuizError as e:
        return [f"build_quiz.py fails: {e}"]
    if quizzes is None:
        quizzes = copy.deepcopy(fresh) if rebuild else copy.deepcopy(QUIZZES)
    return VQ.check(lessons, library, TERMS, quizzes, manifests, fresh=fresh,
                    pending=copy.deepcopy(PENDING) if pending is None else pending, curriculum=CURRICULUM, mapped=mapped)


def lesson(fn):
    """A fault in the Al-Fatihah lesson content (content/al-fatihah.json), then rebuilt."""
    def f():
        ls = copy.deepcopy(LESSONS)
        fn(ls[SLUG])
        return run(lessons=ls)
    return f


def word(lsn: dict, loc: str) -> dict:
    return Q.word_at(lsn, loc)


def qac_tag(loc: str, old: str, new: str):
    """PLANTED: another tag on one QAC segment of a word (the QAC line in its `sources`)."""
    def f(lsn):
        src = next(s for s in word(lsn, loc)["sources"] if s["kitab"].startswith(CUR.QAC_KITAB))
        assert old in src["ref"], (loc, old)
        src["ref"] = src["ref"].replace(old, new, 1)
    return f


def huruf_jar_taught_in_ayah_2(lines: dict) -> None:
    """PLANTED: no line of ayah 1 names or defines "huruf jar" any more; a teaching line of ayah 2
    defines it instead — taught by the END of ayah 2, so not before its warm-up."""
    for lid, _part, _text in [(lid, part, text) for a, lid, part, text in Q.teaching_lines({"lines": lines}, SLUG)
                              if a == 1 and any(tid == "huruf-jar" for tid, _how in Q.defined_terms(part, text, TERMS))]:
        for k in [k for k in lines if k == lid or k.startswith(lid + ":")]:
            lines.pop(k)
    lines["al-fatihah:2:concept:marfu"]["display"] += " Huruf jar adalah kata depan."


def warm(q: dict, n: int) -> dict:
    """The warm-up of ayah n in a built quiz file."""
    return next(ex for ex in q["ayat"][n - 1]["exercises"] if ex["key"] == Q.WARMUP)


def plan(fn, lib=None, tolerated=None):
    """A fault in the authored Al-Fatihah plan (`lib`: and one in the library with it;
    `tolerated`: and these entries in authored/curriculum.pending.json `quiz`)."""
    def f():
        a = copy.deepcopy(AUTHORED)
        fn(a[SLUG]["ayat"])
        library_ = None
        if lib is not None:
            library_ = copy.deepcopy(LIBRARY)
            lib(library_)
        pending = None
        if tolerated is not None:
            pending = copy.deepcopy(PENDING)
            pending.update(copy.deepcopy(tolerated))
        return run(authored=a, library=library_, pending=pending)
    return f


def badal_option(ayat):
    """PLANTED: a question that needs a term no lesson of Al-Fatihah teaches — ayah 2's first role
    question with the role of rabbi (1:2:3, "na't atau badal") among its wrong options. The plan
    itself has no such question since 2026-10-13 (the list of tolerated questions is empty for
    Al-Fatihah), so the faults about that list plant their own."""
    q_of(ayat, 2, "label-role", 0)["distractors"][1] = "1:2:3"


BADAL_Q = "al-fatihah:2:label-role:1"


def listed(fn):
    """A fault in authored/curriculum.pending.json `quiz`."""
    def f():
        p = copy.deepcopy(PENDING)
        fn(p)
        return run(pending=p)
    return f


# The wazan exercise left the basic lessons (decision 6, 2026-10-13), and the guard still knows its
# rules: a fault in one is planted in a plan that asks it again (which the guard refuses as well).
WAZN_5 = [{"lexeme": "abada", "label": "fi'il mudhari'", "options": ["isim fa'il"]},
          {"lexeme": "istaana", "label": "isim fa'il", "options": ["fi'il mudhari'"]}]
WAZN_7 = [{"lexeme": "anama", "label": "fi'il madhi", "options": ["fi'il mudhari'", "isim fa'il"]},
          {"lexeme": "maghdub", "label": "isim maf'ul", "options": ["fi'il madhi", "fi'il mudhari'"]}]


def with_wazn(n: int, questions: list[dict], then=lambda qs: None):
    def f(ayat):
        ayat[str(n)]["wazn-factory"] = copy.deepcopy(questions)
        then(ayat[str(n)]["wazn-factory"])
    return f


def manifest(fn):
    def f():
        m = copy.deepcopy(MANIFESTS)
        fn(m[SLUG]["lines"])
        return run(manifests=m)
    return f


def allah_list(fn):
    """A changed quiz.ALLAH_KIND_ONLY (restored after the check)."""
    def f():
        saved = dict(Q.ALLAH_KIND_ONLY)
        try:
            fn(Q.ALLAH_KIND_ONLY)
            return Q.allah_kind_only_problems(LESSONS)
        finally:
            Q.ALLAH_KIND_ONLY.clear()
            Q.ALLAH_KIND_ONLY.update(saved)
    return f


def quizfile(fn):
    def f():
        q = copy.deepcopy(QUIZZES)
        fn(q[SLUG])
        return run(quizzes=q)
    return f


def quizfile_of(slug: str, fn):
    """A fault in the built quiz file of another surah (content/quiz/<slug>.json)."""
    def f():
        q = copy.deepcopy(QUIZZES)
        fn(q[slug])
        return run(quizzes=q)
    return f


def zero_lines_dropped_for(slug: str):
    """PLANTED: the warm-up of `slug` read against its own manifest only, as until 2026-10-19 — lesson
    zero's lines are in the host's (Al-Fatihah's), so every class looks untaught."""
    def f():
        quiz = copy.deepcopy(QUIZZES[slug])
        return Q.class_problems(quiz, LESSONS[slug], MANIFESTS[slug])
    return f


def library(fn):
    def f():
        lib = copy.deepcopy(LIBRARY)
        fn(lib)
        return run(library=lib)
    return f


def q_of(ayat, n, key, i):
    return ayat[str(n)][key][i]


def drop_line(*lids):
    def f(lines):
        for lid in lids:
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
    ("a why option from a later ayah, its state untaught (iyyāka at ayah 3)",
     plan(lambda a: q_of(a, 3, "why-harakat", 0)["distractors"].__setitem__(0, "1:5:1")), "option from 1:5:1, an ayah not studied yet"),
    ("… and its terms untaught (mabni at ayah 3)",
     plan(lambda a: q_of(a, 3, "why-harakat", 0)["distractors"].__setitem__(0, "1:5:1")), "needs 'mabni' (option from 1:5:1), not taught by the end of ayah 3 (first taught in ayah 5)"),
    ("a role option only glossed so far (badal at ayah 2)", plan(badal_option),
     "needs 'badal' (option from 1:2:3), not taught by the end of ayah 2 (never taught)"),
    # The fault the plan of 2026-10-13 itself had, and the builder refused: an‘amta (fi'il madhi +
    # fa'il) with na‘budu's role among the wrong options.
    ("two correct options: a role option sharing the answer's term (a second fi'il with its fa'il)",
     plan(lambda a: q_of(a, 7, "label-role", 1)["distractors"].append("1:5:2")), "option from 1:5:2 shares ['fail'] with the answer"),
    ("two correct options: huruf jar + majrur beside khabar (jar-majrur)",
     plan(lambda a: q_of(a, 2, "label-role", 1)["distractors"].append("1:1:1")), "option from 1:1:1 shares ['huruf-jar'] with the answer"),
    ("two correct options: two reasons of the same cause (two mudhaf ilaih)",
     plan(lambda a: q_of(a, 4, "why-harakat", 0)["distractors"].__setitem__(1, "1:4:3")), "two options give the same cause"),
    ("two correct options: two wazan forms with the same Arabic",
     plan(with_wazn(7, WAZN_7), wazn_same_form), "two options are the same Arabic form"),
    ("a wazan form never taught (mashdar at ayah 5)",
     plan(with_wazn(5, WAZN_5, lambda qs: qs[0]["options"].append("mashdar"))),
     "needs 'mashdar' (form label 'mashdar'), not taught by the end of ayah 5 (never taught)"),
    # Decision 6 of the basic curriculum (2026-10-13): all sharaf is tingkat lanjut.
    ("the wazan exercise asked in a basic lesson (ayah 5)", plan(with_wazn(5, WAZN_5)),
     "al-fatihah 5 wazn-factory: a basic lesson does not ask the wazan exercise"),
    ("a wazan quiz before its forms are taught (ayah 3)",
     plan(lambda a: a["3"].__setitem__("wazn-factory", [{"lexeme": "rahman", "label": "fi'il madhi", "options": ["fi'il mudhari'"]},
                                                         {"lexeme": "rahman", "label": "fi'il mudhari'", "options": ["fi'il madhi"]}])),
     "needs \"fi'il madhi\" (form label \"fi'il madhi\"), not taught by the end of ayah 3 (first taught in ayah 7)"),
    ("a role only glossed is not taught (maf'ul bih at ayah 5, decision 6)",
     plan(lambda a: a["5"].__setitem__("label-role", [{"word": 1, "distractors": ["1:2:1"]}, {"word": 2, "distractors": ["1:2:1"]}])),
     "needs \"maf'ul bih\" (option from 1:5:1), not taught by the end of ayah 5 (first taught in ayah 6)"),
    # The teaching the plan rests on.
    # Each state is taught twice now: by its word's line ("… disebut marfu'") and by its own step of
    # the curriculum ("Konsep baru: Marfu', dan tandanya: dhammah").
    ("the marfu' teaching lines removed (al-ḥamdu and the step marfu', ayah 2)",
     manifest(drop_line("al-fatihah:2:w1:compose:7", "al-fatihah:2:concept:marfu")),
     "needs \"marfu'\" (the bin marfu), not taught by the end of ayah 2"),
    ("the manshub teaching lines removed (aṣ-ṣirāṭa and the step manshub, ayah 6)",
     manifest(drop_line("al-fatihah:6:w2:compose:6", "al-fatihah:6:concept:manshub")),
     "needs 'manshub' (the bin manshub), not taught by the end of ayah 6"),
    # The structure rules.
    ("a wrong option from a later ayah, its term taught (yaumi at ayah 3)",
     plan(lambda a: q_of(a, 3, "why-harakat", 0)["distractors"].__setitem__(1, "1:4:2")), "option from 1:4:2, an ayah not studied yet"),
    ("a sort over one state (ayah 3: both majrur)",
     plan(lambda a: a["3"].__setitem__("sort-case", {"words": [1, 2], "bins": ["marfu", "majrur"]})), "nothing to sort"),
    ("a sort word outside the bins (mabni missing at ayah 5)",
     plan(lambda a: a["5"]["sort-case"]["bins"].remove("mabni")), "is mabni, not one of the bins"),
    ("a wazan lexeme of another ayah (hada at ayah 5)",
     plan(with_wazn(5, WAZN_5, lambda qs: qs[0].__setitem__("lexeme", "hada"))), "hada is not the lemma of a word of this ayah"),
    ("a tap word without timing", plan(lambda a: a["1"]["tap-word"]["words"].append(9)), "build_quiz.py fails"),
    ("the quiz file edited by hand", quizfile(lambda q: q["ayat"][1]["exercises"][3]["questions"][0]["options"].pop()),
     "content/quiz/al-fatihah.json is out of date"),
    ("an explanation line missing", manifest(drop_line("al-fatihah:2:ex:label-role:1:why")),
     "narration line al-fatihah:2:ex:label-role:1:why missing"),
    ("an explanation line for no question", manifest(lambda ls: ls.__setitem__("al-fatihah:2:ex:label-role:9:why", ls["al-fatihah:2:ex:label-role:1:why"])),
     "al-fatihah:2:ex:label-role:9:why has no exercise or question in the quiz"),
    # A question with an untaught term passes only while authored/curriculum.pending.json `quiz`
    # lists it, both ways: not listed → fails (the badal fault above); listed without that term →
    # fails; listed with a term it does not need, or for a question that needs none → stale.
    ("a question listed, but not with the term it needs", plan(badal_option, tolerated={BADAL_Q: ["naat"]}),
     "al-fatihah 2 label-role q1: needs 'badal'"),
    ("a stale term on a listed question", plan(badal_option, tolerated={BADAL_Q: ["badal", "majrur"]}),
     f"quiz {BADAL_Q} no longer needs 'majrur' untaught (stale): remove it"),
    ("a stale entry: a question whose terms are all taught", listed(lambda p: p.__setitem__("al-fatihah:5:sort-case:1", ["mabni"])),
     "quiz al-fatihah:5:sort-case:1 no longer needs 'mabni' untaught (stale): remove it"),
    ("an entry for a question the plan does not ask", listed(lambda p: p.__setitem__("al-fatihah:1:why-harakat:1", ["naat"])),
     "quiz al-fatihah:1:why-harakat:1 no longer needs 'naat' untaught (stale): remove it"),
    # What the learner READS after answering is what the narrator SAYS (main session 2026-10-13):
    # the explanation shown is the word's `why_basic`, and its terms are held to TAUGHT.
    ("a why_basic that names a term no lesson taught, read on screen after the answer (badal at ayah 2)",
     lesson(lambda lsn: word(lsn, "1:2:2").__setitem__("why_basic", word(lsn, "1:2:2")["why_basic"] + " Kata ini badal.")),
     "al-fatihah 2 sort-case q2: needs 'badal' (the explanation shown after the answer), not taught by the end of ayah 2 (never taught)"),
    ("… and a term of a later lesson (manshub at ayah 2)",
     lesson(lambda lsn: word(lsn, "1:2:2").__setitem__("why_basic", "Akhirnya kasrah karena didahului huruf jar; kata ini tidak manshub.")),
     "needs 'manshub' (the explanation shown after the answer), not taught by the end of ayah 2 (first taught in ayah 6)"),
    # THE WARM-UP (operator 2026-10-13): derived, and it must agree with what the lesson says.
    ("the warm-up: the lesson's pos disagrees with the QAC tag (a fi'il the lesson calls an isim)",
     lesson(lambda lsn: word(lsn, "1:5:2").__setitem__("pos", "isim")),
     "build_quiz.py fails: 1:5:2: the lesson says this word is 'isim' (['isim']), its QAC line says ['V'] (['fiil'])"),
    ("the warm-up: the lesson's pos has one part more than the QAC line",
     lesson(lambda lsn: word(lsn, "1:4:2").__setitem__("pos", "huruf jar + isim")), "build_quiz.py fails: 1:4:2: the lesson says this word is 'huruf jar + isim'"),
    ("the warm-up: a QAC tag with no kind", lesson(qac_tag("1:7:8", "NEG|STEM", "XYZ|STEM")), "QAC tag 'XYZ' has no kind in quiz.QAC_KIND"),
    ("the warm-up: a word with no QAC line", lesson(lambda lsn: word(lsn, "1:3:1").__setitem__("sources", [])), "1:3:1: no QAC line in its sources"),
    ("the warm-up: a compound word whose parts the lesson does not carry",
     lesson(lambda lsn: lsn["segments"].pop("1:1:1")), "1:1:1: a word of 2 parts, and the lesson content does not carry its 2 QAC segments"),
    ("the warm-up: the lesson's parts are not the word", lesson(lambda lsn: lsn["segments"].__setitem__("1:1:1", list(reversed(lsn["segments"]["1:1:1"])))),
     "1:1:1: a word of 2 parts, and the lesson content does not carry"),
    ("the warm-up: a part left out", quizfile(lambda q: warm(q, 1)["questions"].pop(1)), "every part of every word is asked once, in order"),
    ("the warm-up: a part asked twice", quizfile(lambda q: warm(q, 3)["questions"].append(copy.deepcopy(warm(q, 3)["questions"][0]))),
     "al-fatihah 3 word-kind: asks the parts [(1, 1), (2, 1), (1, 1)]"),
    ("the warm-up: a wrong answer (a huruf jar called a fi'il)", quizfile(lambda q: warm(q, 1)["questions"][0].__setitem__("kind", "fiil")),
     "al-fatihah 1 word-kind q1 (word 1, part 1 of 2): the answer is 'fiil', and the word's QAC tag and its `pos` give 'huruf'"),
    ("the warm-up: typed Arabic instead of the lesson's bytes", quizfile(lambda q: warm(q, 1)["questions"][1].__setitem__("ar", "اسم")),
     "al-fatihah 1 word-kind q2 (word 1, part 2 of 2): shows 'اسم' as part 2 of 2"),
    ("the warm-up: a sign before the lesson that teaches it (alif lam at ayah 2)", quizfile(lambda q: warm(q, 2)["questions"][0].__setitem__("signs", ["al"])),
     "al-fatihah 2 word-kind q1 (word 1): gives the sign(s) ['al']; the data shows, and an earlier lesson taught, []"),
    ("the warm-up: a sign the data does not show (a huruf jar before a fi'il)", quizfile(lambda q: warm(q, 5)["questions"][1].__setitem__("signs", ["jar"])),
     "al-fatihah 5 word-kind q2 (word 2): gives the sign(s) ['jar']"),
    ("the warm-up: a sign left out (didahului huruf jar at ayah 2)", quizfile(lambda q: warm(q, 2)["questions"][2].__setitem__("signs", [])),
     "al-fatihah 2 word-kind q3 (word 2, part 2 of 2): gives the sign(s) []; the data shows, and an earlier lesson taught, ['jar']"),
    ("the warm-up: its sentence edited by hand", quizfile(lambda q: warm(q, 5)["questions"][1].__setitem__("why", "Kata kedua adalah fi'il (فِعْل), tandanya huruf mudhara'ah.")),
     "al-fatihah 5 word-kind q2 (word 2): its explanation is not the sentence built from the data"),
    # WHICH class, never the kind's general definition (operator 2026-10-17, on ٱلرَّحِيمِ: "no need
    # to say 'yaitu nama benda, orang, atau sifat', directly show which one").
    ("the warm-up: the general definition again, the shape of until 2026-10-17",
     quizfile(lambda q: warm(q, 1)["questions"][4].__setitem__("why", "Kata keempat adalah isim (اِسْم), yaitu nama benda, orang, atau sifat.")),
     "al-fatihah 1 word-kind q5 (word 4): its explanation restates the general definition of the kind ('yaitu nama benda, orang, atau sifat')"),
    ("the warm-up: … and beside the class (the new sentence with the old definition put back)",
     quizfile(lambda q: warm(q, 2)["questions"][4].__setitem__("why", warm(q, 2)["questions"][4]["why"].replace(
         ", karena ia nama benda.", ", yaitu nama benda, orang, atau sifat, karena ia nama benda."))),
     "al-fatihah 2 word-kind q5 (word 4): its explanation restates the general definition of the kind"),
    ("the warm-up: a word by its place and meaning, the word itself left out",
     quizfile(lambda q: warm(q, 1)["questions"][4].__setitem__("why", "Kata keempat, yang artinya “Maha Penyayang”, adalah isim (اِسْم), karena ia nama sifat.")),
     "al-fatihah 1 word-kind q5 (word 4): its explanation is not the sentence built from the data"),
    ("the warm-up: a wrong class for the tag (an adjective, ADJ, called a nama benda)",
     quizfile(lambda q: warm(q, 1)["questions"][4].__setitem__("class", "nama benda")),
     "al-fatihah 1 word-kind q5 (word 4): names the class 'nama benda', and the part's QAC tag gives 'nama sifat'"),
    ("the warm-up: a wrong class for the tag (a pronoun, PRON, called a nama benda)",
     quizfile(lambda q: warm(q, 6)["questions"][1].__setitem__("class", "nama benda")),
     "al-fatihah 6 word-kind q2 (word 1, part 2 of 2): names the class 'nama benda', and the part's QAC tag gives 'kata ganti'"),
    ("the warm-up: a class said of the Name of Allah", quizfile(lambda q: warm(q, 1)["questions"][2].__setitem__("class", "nama benda")),
     "al-fatihah 1 word-kind q3 (word 2): names the class 'nama benda', and the part's QAC tag gives None"),
    ("the warm-up: a class said of a participle noun (māliki, N ACT PCPL)",
     quizfile(lambda q: warm(q, 4)["questions"][0].__setitem__("class", "nama benda")),
     "al-fatihah 4 word-kind q1 (word 1): names the class 'nama benda', and the part's QAC tag gives None"),
    ("the warm-up: a class said of gair (“bukan”, a QAC N listed in quiz.CLASS_WITHHELD)",
     quizfile(lambda q: warm(q, 7)["questions"][6].__setitem__("class", "nama benda")),
     "al-fatihah 7 word-kind q7 (word 5): names the class 'nama benda', and the part's QAC tag gives None"),
    ("the warm-up: a class of a tag the record teaches none for (allażīna, REL)",
     quizfile(lambda q: warm(q, 7)["questions"][1].__setitem__("class", "kata ganti")),
     "al-fatihah 7 word-kind q2 (word 2): names the class 'kata ganti', and the part's QAC tag gives None"),
    ("the warm-up: the class withheld from a noun", quizfile(lambda q: warm(q, 2)["questions"][4].pop("class")),
     "al-fatihah 2 word-kind q5 (word 4): names the class None, and the part's QAC tag gives 'nama benda'"),
    # An isim that names, titles or describes Allah says the kind alone (operator 2026-10-17: "when ism
    # is related to Allah, dont say it's nama benda"; "just say, it's ism.")
    ("the warm-up: “nama benda” said of rabbi (“Tuhan”, a title of Allah), as until 2026-10-17",
     quizfile(lambda q: warm(q, 2)["questions"][3].__setitem__("class", "nama benda")),
     "al-fatihah 2 word-kind q4 (word 3): names the class 'nama benda', and the part's QAC tag gives None"),
    ("… its sentence as it was", quizfile(lambda q: warm(q, 2)["questions"][3].__setitem__(
        "why", warm(q, 2)["questions"][3]["why"].replace("adalah isim (اِسْم).", "adalah isim (اِسْم), karena ia nama benda."))),
     "al-fatihah 2 word-kind q4 (word 3): its explanation is not the sentence built from the data"),
    ("quiz.ALLAH_KIND_ONLY: an entry whose lemma the word does not have (a typo)",
     allah_list(lambda d: d.__setitem__("1:2:3", ("rabb", "typo"))),
     "quiz.ALLAH_KIND_ONLY 1:2:3 (rabbi): no isim part with the QAC lemma 'rabb'"),
    ("quiz.ALLAH_KIND_ONLY: an entry at no lesson word", allah_list(lambda d: d.__setitem__("1:9:9", ("rab~", "nowhere"))),
     "quiz.ALLAH_KIND_ONLY 1:9:9: no lesson word at that place"),
    ("quiz.ALLAH_KIND_ONLY: an entry that is no isim (a fi'il)", allah_list(lambda d: d.__setitem__("1:5:2", ("Eabada", "a verb"))),
     "quiz.ALLAH_KIND_ONLY 1:5:2 (na‘budu): no isim part with the QAC lemma 'Eabada'"),
    ("the warm-up: a Kalimah example that calls a noun a fi'il",
     library(lambda lib: next(e for e in next(c for c in lib["concepts"] if c["id"] == Q.KALIMAH_RECORD)["examples"]
                              if e["loc"] == "1:7:1").__setitem__("note", "ṣirāṭa: fi'il, nama benda.")),
     "build_quiz.py fails: the Konsep record 'kalimah-isim-fiil-huruf': example 1:7:1 calls a N (isim) a fi'il"),
    ("the warm-up: a Kalimah example whose word's QAC tag the record does not give",
     library(lambda lib: [s.__setitem__("ref", s["ref"].replace("(1:7:1) N; ", "")) for s in
                          next(c for c in lib["concepts"] if c["id"] == Q.KALIMAH_RECORD)["sources"] if s["kitab"].startswith(CUR.QAC_KITAB)]),
     "example 1:7:1 gives the class 'nama benda', and its QAC source gives that word None, not one tag"),
    # A class is plain Indonesian, no term of the table: it is held to the lessons BEFORE the warm-up
    # on its own (quiz.class_problems) — named with its kind by a line an earlier ayah plays.
    ("the warm-up: a class never taught (lesson zero's “kata ganti” example removed)",
     manifest(drop_line("al-fatihah:0:concept:kalimah-isim-fiil-huruf:ex:3")),
     "al-fatihah 5 word-kind q1: names the class 'kata ganti' of isim, not taught before ayah 5 (the warm-up opens the lesson) (never taught"),
    ("the warm-up: a class taught only by the lesson it opens (“kata ganti” moved to ayah 5)",
     manifest(lambda lines: (lines.pop("al-fatihah:0:concept:kalimah-isim-fiil-huruf:ex:3"),
                             lines["al-fatihah:5:w1"].__setitem__("display", lines["al-fatihah:5:w1"]["display"] + " Kata ini isim, yaitu kata ganti."))),
     "al-fatihah 5 word-kind q1: names the class 'kata ganti' of isim, not taught before ayah 5 (the warm-up opens the lesson) (first taught in ayah 5"),
    ("the warm-up: a class named without its kind does not teach it (lesson zero's nama sifat line without “isim”)",
     manifest(lambda lines: lines["al-fatihah:0:concept:kalimah-isim-fiil-huruf:ex:2"].__setitem__(
         "display", lines["al-fatihah:0:concept:kalimah-isim-fiil-huruf:ex:2"]["display"].replace("juga isim (اِسْم), tetapi ", ""))),
     "al-fatihah 1 word-kind q4: names the class 'nama sifat' of isim, not taught before ayah 1"),
    # Al-Ikhlas (its map switched on 2026-10-19): the same rules on another surah.
    ("the warm-up of Al-Ikhlas: a class said of aḥadun (“Yang Maha Esa”, said of Allah: quiz.ALLAH_KIND_ONLY)",
     quizfile_of("al-ikhlas", lambda q: warm(q, 1)["questions"][3].__setitem__("class", "nama benda")),
     "al-ikhlas 1 word-kind q4 (word 4): names the class 'nama benda', and the part's QAC tag gives None"),
    ("the warm-up of Al-Ikhlas: a class said of aṣ-ṣamadu (a Name of Allah)",
     quizfile_of("al-ikhlas", lambda q: warm(q, 2)["questions"][1].__setitem__("class", "nama benda")),
     "al-ikhlas 2 word-kind q2 (word 2): names the class 'nama benda', and the part's QAC tag gives None"),
    ("the warm-up of Al-Ikhlas: “nama benda” said of kufuwan (“setara”, withheld: quiz.CLASS_WITHHELD)",
     quizfile_of("al-ikhlas", lambda q: warm(q, 4)["questions"][5].__setitem__("class", "nama benda")),
     "al-ikhlas 4 word-kind q6 (word 4): names the class 'nama benda', and the part's QAC tag gives None"),
    ("the warm-up of Al-Ikhlas: the class withheld from aḥadun of ayah 4 (“sesuatu”: not about Allah)",
     quizfile_of("al-ikhlas", lambda q: warm(q, 4)["questions"][6].pop("class")),
     "al-ikhlas 4 word-kind q7 (word 5): names the class None, and the part's QAC tag gives 'nama benda'"),
    ("the warm-up of Al-Ikhlas read against its own manifest only (lesson zero's lines are Al-Fatihah's), as until 2026-10-19",
     zero_lines_dropped_for("al-ikhlas"),
     "al-ikhlas 1 word-kind q1: names the class 'kata kerja' of fi'il, not taught before ayah 1"),
    ("the warm-up: authored in the plan", plan(lambda a: a["1"].__setitem__("word-kind", [{"word": 1, "kind": "isim"}])),
     "the plan lists 'word-kind' — the warm-up is derived"),
    ("the warm-up: missing from an ayah of a surah with a lesson map", quizfile(lambda q: q["ayat"][3]["exercises"].pop(0)),
     "al-fatihah 4 word-kind: missing — every ayah lesson of a surah with a lesson map opens with the warm-up"),
    ("the warm-up: in a surah whose lesson map is not switched on", lambda: run(mapped=set(), built_mapped=MAPPED),
     "al-fatihah 1 word-kind: a warm-up in a surah whose lesson map is not switched on"),
    ("the warm-up: not first in page order", quizfile(lambda q: q["ayat"][0]["exercises"].reverse()), "are not in page order"),
    ("the warm-up: its three answers without their labels", quizfile(lambda q: q.__setitem__("kinds", {})), "`kinds` must be the three answers of the warm-up"),
    ("the warm-up: the Kalimah record no longer gives the three kinds their meanings",
     library(lambda lib: next(c for c in lib["concepts"] if c["id"] == Q.KALIMAH_RECORD).__setitem__("summary", "Kata Arab ada tiga jenis.")),
     "no longer gives the three kinds their meanings"),
    # It opens the lesson: what it asks must have been taught by EARLIER lessons (lesson zero's
    # lines are "ayah 0"), never by this one.
    ("the warm-up: the three kinds not taught before the first ayah (lesson zero's line removed)",
     manifest(drop_line("al-fatihah:0:concept:kalimah-isim-fiil-huruf")),
     "al-fatihah 1 word-kind q1: needs 'isim' (the three answers offered), not taught before ayah 1 (the warm-up opens the lesson)"),
    ("the warm-up: a sign's term taught only by this very lesson (huruf jar moved to ayah 2)",
     manifest(huruf_jar_taught_in_ayah_2),
     "al-fatihah 2 word-kind q3: needs 'huruf jar' (the explanation shown after the answer), not taught before ayah 2 (the warm-up opens the lesson)"),
]


class Taught(unittest.TestCase):
    def setUp(self):
        self.t = Q.taught(MANIFESTS[SLUG], LESSONS[SLUG], TERMS)

    def test_states_where_the_lesson_names_them(self):
        first = {tid: min(n for n in self.t if tid in self.t[n]) for tid in ("majrur", "marfu", "mabni", "manshub")}
        self.assertEqual(first, {"majrur": 1, "marfu": 2, "mabni": 5, "manshub": 6})

    def test_a_listed_question_passes_exactly_while_it_needs_the_term(self):
        # The list of tolerated questions is empty for Al-Fatihah (2026-10-13) and stays a list
        # the guard reads strictly: a planted question passes with its entry, and only with it.
        # When the explanation shown after an answer joined TAUGHT (2026-10-13) the guard found
        # three of Al-Fatihah 7 that named a term no line taught — "sukun" (1:7:3, twice) and "jar"
        # (1:7:2). Cleared with content the same day, not with an exemption: the harakat primer of
        # lesson zero now names sukun ("… disebut sukun": a teaching line of "ayah 0"), and 1:7:2
        # has a `why_basic` that says majrur. The list is empty again. Since 2026-10-15 the primer
        # shows each sign first on its letter without it, and the line over the bare sin defines it
        # ("Sukun adalah tanda huruf mati, …": primer:9), as "Fathah adalah …" defines fathah.
        self.assertEqual([k for k in PENDING if k.startswith(f"{SLUG}:")], [])
        first = Q.taught_first(MANIFESTS[SLUG], LESSONS[SLUG], TERMS)
        self.assertEqual(first["sukun"], (0, "al-fatihah:0:primer:9 (“… adalah”)"))
        self.assertIn("sukun", self.t[1])
        without = {**MANIFESTS[SLUG], "lines": {k: v for k, v in MANIFESTS[SLUG]["lines"].items() if k != "al-fatihah:0:primer:9"}}
        self.assertNotIn("sukun", Q.taught_first(without, LESSONS[SLUG], TERMS))
        self.assertTrue(any("needs 'sukun' (the explanation shown after the answer)" in e for e in run(manifests={**MANIFESTS, SLUG: without})))
        self.assertNotIn("jar", TERMS.ids(next(q for a in QUIZZES[SLUG]["ayat"] if a["ayah"] == 7 for ex in a["exercises"]
                                              if ex["key"] == "label-role" for q in ex["questions"] if q["n"] == 1)["why"]))
        # (rabbi's role is "na't atau badal": na't is taught in ayah 3, badal in An-Nas.)
        self.assertEqual(plan(badal_option, tolerated={BADAL_Q: ["naat", "badal"]})(), [])
        self.assertTrue(any("needs 'badal'" in e for e in plan(badal_option)()))
        self.assertTrue(any("needs 'badal'" in e for e in plan(badal_option, tolerated={})()))

    def test_a_structure_item_teaches_as_the_structure_line_did(self):
        # The structure told item by item (2026-10-13): its lines are teaching lines like the one
        # `structure` line. Ayah 1's first item ends "Gabungan seperti ini disebut jar-majrur."
        self.assertTrue(Q.TEACHING_PART.fullmatch("structure:1") and Q.TEACHING_PART.fullmatch("structure:12"))
        self.assertIsNone(Q.TEACHING_PART.fullmatch("structure:"))
        self.assertIn("disebut jar-majrur", MANIFESTS[SLUG]["lines"]["al-fatihah:1:structure:1"]["display"])
        self.assertIn("jar-majrur", self.t[1])
        # Without that line the term is not taught by ayah 1.
        lines = {k: v for k, v in MANIFESTS[SLUG]["lines"].items() if k != "al-fatihah:1:structure:1"}
        self.assertNotIn("jar-majrur", Q.taught({**MANIFESTS[SLUG], "lines": lines}, LESSONS[SLUG], TERMS)[1])

    def test_glossed_or_mentioned_is_not_taught(self):
        self.assertNotIn("badal", self.t[2])      # "pengganti (badal)" in 2:structure
        self.assertNotIn("maful-bih", self.t[5])  # "objek (maf'ul bih)" in 5:structure
        self.assertNotIn("mashdar", self.t[7])    # "mashdar (kata benda perbuatan)" only
        # Badal is taught at An-Nas 2 now (decision 4 of the basic curriculum): no line of
        # Al-Fatihah names it any more.
        self.assertNotIn("badal", self.t[7])
        self.assertIn("fiil-madhi", self.t[7])
        self.assertNotIn("fiil-madhi", self.t[6])

    def test_the_listed_questions_are_what_the_guard_finds(self):
        # authored/curriculum.pending.json `quiz` is exactly what TAUGHT ⊇ REQUIRED fails on today
        # (build_narration.py --write-pending writes it from the same function).
        self.assertEqual(Q.untaught(QUIZZES[SLUG], LESSONS[SLUG], TERMS, MANIFESTS[SLUG]), PENDING)
        for key in PENDING:
            slug, ayah, exercise, n = key.split(":")
            self.assertEqual(key, Q.question_key(slug, int(ayah), exercise, int(n)))
        # A mechanical plan is not taught-checked, so none of its questions is listed.
        self.assertTrue(all(k.startswith(SLUG + ":") for k in PENDING))

    def test_no_wazan_exercise_in_a_basic_lesson(self):
        # Decision 6 (2026-10-13): the authored plan has none, and the mechanical plans make none.
        for slug, content in QUIZZES.items():
            keys = {ex["key"] for a in content["ayat"] for ex in a["exercises"]}
            self.assertNotIn("wazn-factory", keys, slug)
            self.assertLessEqual(keys, set(Q.BASIC_EXERCISES), slug)
        self.assertEqual(QUIZZES[SLUG]["labels"], {})

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
        # inside the text's own bracket the Arabic follows its term after one space (operator
        # 2026-10-12; "(اِسْم مَوْصُول, mudhaf ilaih, مُضَاف إِلَيْه)" before: the commas separate items)
        self.assertEqual(TERMS.annotate("isim maushul (mudhaf ilaih)"), "isim maushul (اِسْم مَوْصُول, mudhaf ilaih مُضَاف إِلَيْه)")
        self.assertEqual(TERMS.label("marfu"), "marfu' (مَرْفُوع)")
        for tid in ("marfu", "manshub", "majrur", "mabni"):
            self.assertIn(TERMS.by_id[tid]["ar"], QUIZZES[SLUG]["states"][tid])


class Twin(unittest.TestCase):
    """render_marked is the twin of src/lib/terms.ts annotate + termDisplay (a card's scope, no
    reminders): the same cases as src/lib/terms.test.ts, so a rule changed on one side only fails
    here or there (src/lib/quiz-content.test.ts pins the built quiz to the card's rendering)."""

    QURAN = LESSONS[SLUG]["quran"] | LIBRARY["quran"]
    SEGMENTS = LESSONS[SLUG]["segments"] | LIBRARY["segments"]

    def show(self, marked: str, segments=None) -> str:
        return TERMS.annotate_marked(marked, self.QURAN, self.SEGMENTS if segments is None else segments)

    def ar(self, tid: str) -> str:
        return TERMS.by_id[tid]["ar"]

    def test_inside_brackets_one_space(self):
        self.assertEqual(self.show("([[dhammah|dhammah]], [[fathah|fathah]], [[kasrah|kasrah]])"),
                         f"(dhammah {self.ar('dhammah')}, fathah {self.ar('fathah')}, kasrah {self.ar('kasrah')})")
        self.assertEqual(self.show("[[wa|q:1:7:8/1]] ([['athaf|athaf]], penyambungan)"),
                         f"wa ({self.QURAN['1:7:8/1']}, 'athaf {self.ar('athaf')}, penyambungan)")
        self.assertEqual(self.show("[[fa'il|fail]] ([[-ta|q:1:7:3/2]])"), f"fa'il ({self.ar('fail')}, -ta {self.QURAN['1:7:3/2']})")
        # the phrase goes on: the term stays Latin, and shows its Arabic at its next use
        self.assertEqual(self.show("kedudukan [[rafa'|rafa]] ([[mahall|mahall]] raf'). [[Mahall|mahall]] itu"),
                         f"kedudukan rafa' ({self.ar('rafa')}, mahall raf'). Mahall ({self.ar('mahall')}) itu")
        self.assertEqual(self.show("(lihat: [[dhamir|dhamir]] [[munfashil|munfashil]])"), "(lihat: dhamir munfashil)")

    def test_terms_never_run(self):
        # grammar terms never form a run (terms.ts runFrom, review 2026-10-12): each its own Arabic;
        # inside a bracket the first stays Latin because another marked item follows (the phrase
        # goes on), the second has its Arabic right after it
        self.assertEqual(self.show("[[dhamir|dhamir]] [[munfashil|munfashil]] boleh"),
                         f"dhamir ({self.ar('dhamir')}) munfashil ({self.ar('munfashil')}) boleh")
        self.assertEqual(self.show("([[mahall|mahall]] [[nashb|nashab]])"), f"(mahall nashb {self.ar('nashab')})")
        self.assertEqual(self.show("kedudukan [[nashab|nashab]] ([[mahall|mahall]] [[nashb|nashab]]) di kartu ini"),
                         f"kedudukan nashab ({self.ar('nashab')}, mahall nashb) di kartu ini")
        self.assertEqual(self.show("[[jumlah|jumlah]] [[ibtida'iyyah|ibtidaiyyah]] (kalimat pembuka)"),
                         f"jumlah ({self.ar('jumlah')}) ibtida'iyyah ({self.ar('ibtidaiyyah')}, kalimat pembuka)")
        # shown once: a second use stays Latin; one already shown, the other not: only the other's
        self.assertEqual(self.show("[[dhamir|dhamir]] [[munfashil|munfashil]], lalu [[dhamir|dhamir]] [[munfashil|munfashil]]"),
                         f"dhamir ({self.ar('dhamir')}) munfashil ({self.ar('munfashil')}), lalu dhamir munfashil")
        self.assertEqual(self.show("[[dhamir|dhamir]] itu [[dhamir|dhamir]] [[muttashil|muttashil]]"),
                         f"dhamir ({self.ar('dhamir')}) itu dhamir muttashil ({self.ar('muttashil')})")

    def test_rejected_glued_phrases(self):
        # the four phrases a first version glued, from their own marked sources in the library
        # (found by their Latin), never drawn with one bracket for two terms
        for phrase in ("isimnya dirafa'kan", "Fi'il amr mabni", "menafikan mudhari'", "ta' ta'nits sukun"):
            hits = [c["marked"]["explanation"][i] for c in LIBRARY["concepts"] for i, p in enumerate(c["explanation"]) if phrase in p]
            self.assertEqual(len(hits), 1, phrase)
            marks = Q._MARKUP.findall(hits[0])
            pair = next((a, b) for a, b in zip(marks, marks[1:]) if f"{a[0]} {b[0]}" == phrase)
            ar_a, ar_b = self.ar(pair[0][1]), self.ar(pair[1][1])
            out = self.show(hits[0])
            self.assertNotIn(f"{pair[0][0]} {pair[1][0]} ({ar_a} {ar_b}", out, phrase)
            self.assertNotIn(f"{ar_a} {ar_b}", out, phrase)
            self.assertIn(f"{pair[0][0]} ({ar_a}) {pair[1][0]} ({ar_b}", out, phrase)

    def test_quranic_runs(self):
        q = self.QURAN
        self.assertEqual(self.show("[[yaum|q:1:4:2]] [[ad-dīn|q:1:4:3]], yang"), f"yaum ad-dīn ({q['1:4:2']} {q['1:4:3']}), yang")
        self.assertEqual(self.show("[[lam|q:112:3:3/2]] [[yūlad|q:112:3:4]]"), f"lam yūlad ({q['112:3:3/2']} {q['112:3:4']})")
        self.assertEqual(self.show("[[māliki|q:1:4:1]] [[yaumi|q:1:4:2]] [[ad-dīni|q:1:4:3]]"), f"māliki yaumi ad-dīni ({q['1:4:1']} {q['1:4:2']} {q['1:4:3']})")
        self.assertEqual(self.show("(seperti [[yaum|q:1:4:2]] [[ad-dīn|q:1:4:3]])"), f"(seperti yaum ad-dīn {q['1:4:2']} {q['1:4:3']})")
        self.assertEqual(self.show("([[yaum|q:1:4:2]] [[ad-dīn|q:1:4:3]] adalah hari kiamat)"), "(yaum ad-dīn adalah hari kiamat)")
        # shown once: a second use of the phrase, and of one of its words, stays Latin
        self.assertEqual(self.show("[[yaum|q:1:4:2]] [[ad-dīn|q:1:4:3]], lalu [[yaum|q:1:4:2]] [[ad-dīn|q:1:4:3]] dan [[ad-dīn|q:1:4:3]]"),
                         f"yaum ad-dīn ({q['1:4:2']} {q['1:4:3']}), lalu yaum ad-dīn dan ad-dīn")
        # one word already shown, the other not: the phrase's Arabic, whole
        self.assertEqual(self.show("[[yaum|q:1:4:2]] itu [[yaum|q:1:4:2]] [[ad-dīn|q:1:4:3]]"),
                         f"yaum ({q['1:4:2']}) itu yaum ad-dīn ({q['1:4:2']} {q['1:4:3']})")

    def test_no_run(self):
        q = self.QURAN
        # words 4 and 6 of 33:37; the first part of a word; a part whose word has no known parts
        self.assertEqual(self.show("[[an‘ama|q:33:37:4]] [[‘alaihi|q:33:37:6]]"), f"an‘ama ({q['33:37:4']}) ‘alaihi ({q['33:37:6']})")
        self.assertEqual(self.show("[[bi-|q:1:1:1/1]] [[Allāhi|q:1:1:2]]"), f"bi- ({q['1:1:1/1']}) Allāhi ({q['1:1:2']})")
        self.assertEqual(self.show("[[lam|q:112:3:3/2]] [[yūlad|q:112:3:4]]", segments={}), f"lam ({q['112:3:3/2']}) yūlad ({q['112:3:4']})")
        # punctuation, a list word, a double space, a term, a term without Arabic, a quoted gloss, an unknown ref
        self.assertEqual(self.show("[[yaum|q:1:4:2]], [[ad-dīn|q:1:4:3]]"), f"yaum ({q['1:4:2']}), ad-dīn ({q['1:4:3']})")
        self.assertEqual(self.show("[[yaum|q:1:4:2]] dan [[ad-dīn|q:1:4:3]]"), f"yaum ({q['1:4:2']}) dan ad-dīn ({q['1:4:3']})")
        self.assertEqual(self.show("[[yaum|q:1:4:2]]  [[ad-dīn|q:1:4:3]]"), f"yaum ({q['1:4:2']})  ad-dīn ({q['1:4:3']})")
        self.assertEqual(self.show("[[yaum|q:1:4:2]] [[mudhaf|mudhaf]]"), f"yaum ({q['1:4:2']}) mudhaf ({self.ar('mudhaf')})")
        self.assertEqual(self.show("[[huruf jar|huruf-jar]] [[bi-|q:1:1:1/1]] (dengan)"), f"huruf jar ({self.ar('huruf-jar')}) bi- ({q['1:1:1/1']}, dengan)")
        self.assertIsNone(self.ar("wazan-yufalilu"))
        self.assertEqual(self.show("[[berwazan|wazan]] [[yufa‘lilu|wazan-yufalilu]] [[mabni|mabni]]."),
                         f"berwazan ({self.ar('wazan')}) yufa‘lilu mabni ({self.ar('mabni')}).")
        self.assertEqual(self.show("[[bismi|q:1:1:1]] [[“nama Allah”|q:1:1:1-2]]"), f"bismi ({q['1:1:1']}) “nama Allah” ({q['1:1:1-2']})")
        self.assertEqual(self.show("[[yaum|q:1:4:2]] [[x|q:1:4:9]] [[ad-dīn|q:1:4:3]]"), f"yaum ({q['1:4:2']}) x ad-dīn ({q['1:4:3']})")
        self.assertEqual(self.show("([[huruf jar|huruf-jar]] [[bi-|q:1:1:1/1]])"), f"(huruf jar bi- {q['1:1:1/1']})")

    def test_gloss_place_citation(self):
        mabni = self.ar("mabni")
        self.assertEqual(self.show("[[qul a‘ūżu|q:113:1:1-2]] (113 dan 114)"), f"qul a‘ūżu ({self.QURAN['113:1:1-2']}, 113 dan 114)")
        self.assertEqual(self.show("[[mabni|mabni]] (Yang dimohon pertolongan-Nya)"), f"mabni ({mabni}, Yang dimohon pertolongan-Nya)")
        self.assertEqual(self.show("[[mabni|mabni]] (Abunya)"), f"mabni ({mabni}, Abunya)")
        for cite in ("Darwisy", "Darwisy; al-Jadwal", "Ibnu 'Aqil", "Abu Hayyan", "Ahmad Zaini Dahlan", "Mughni", "al-Jadwal",
                     "as-Samin: manshub", "an-Nahhas", "lihat: mu'rab"):
            self.assertEqual(self.show(f"[[mabni|mabni]] ({cite})"), f"mabni ({mabni}; {cite})", cite)
        # neither a gloss nor a citation: its own bracket
        self.assertEqual(self.show("[[mabni|mabni]] (al-mabniy)"), f"mabni ({mabni}) (al-mabniy)")

    def test_plain_text_follows_the_same_rules(self):
        # terms never form a run here either: "fi'il mudhari' majzum (فِعْل مُضَارِع مَجْزُوم)" is not one phrase
        self.assertEqual(TERMS.annotate("fi'il mudhari' majzum"), f"fi'il mudhari' ({self.ar('fiil-mudhari')}) majzum ({self.ar('majzum')})")
        self.assertEqual(TERMS.annotate("khabar (jar-majrur)"), f"khabar ({self.ar('khabar')}, jar-majrur {self.ar('jar-majrur')})")
        self.assertEqual(TERMS.annotate("mabni (Ibnu 'Aqil)"), f"mabni ({self.ar('mabni')}; Ibnu 'Aqil)")

    def test_the_cited_names_are_the_apps(self):
        ts = (Q.AUTHORED_DIR.parent.parent / "src" / "lib" / "terms.ts").read_text(encoding="utf-8")
        m = Q.re.search(r"export const CITED = \[([^\]]*)\]", ts)
        self.assertIsNotNone(m)
        self.assertEqual(tuple(Q.re.findall(r'"([^"]+)"', m.group(1))), Q.CITED)

    def test_seeded_shuffle_matches_the_components(self):
        # src/lib/shuffle.ts seededShuffle([1..6], "1:1:1") and ("abc", "al-fatihah/2/tap"), as node prints them.
        self.assertEqual(Q.seeded_shuffle([1, 2, 3, 4, 5, 6], "1:1:1"), [1, 4, 5, 3, 6, 2])
        self.assertEqual(Q.seeded_shuffle(list("abcd"), "al-fatihah/2/tap"), ["d", "c", "b", "a"])
        self.assertEqual(Q.seeded_shuffle(list(range(1, 11)), "113:5:3/x"), [1, 5, 2, 3, 4, 6, 9, 10, 8, 7])


class WarmupIkhlas(unittest.TestCase):
    """The warm-up of Al-Ikhlas (its lesson map switched on 2026-10-19), as built."""

    def test_every_part_and_its_sentence(self):
        q, lesson = QUIZZES["al-ikhlas"], LESSONS["al-ikhlas"]
        # 15 words, 3 of two parts (wa lam twice, lahū): 18 questions, 4 / 2 / 5 / 7.
        self.assertEqual([len(warm(q, n)["questions"]) for n in range(1, 5)], [4, 2, 5, 7])
        why = {(n, x["n"]): x["why"] for n in range(1, 5) for x in warm(q, n)["questions"]}
        cls = {(n, x["n"]): x.get("class") for n in range(1, 5) for x in warm(q, n)["questions"]}
        # A word about Allah says the kind alone (aḥadun 112:1:4, aṣ-ṣamadu: quiz.ALLAH_KIND_ONLY; the
        # Name twice); aḥadun of ayah 4, “sesuatu”, is not about Allah and keeps its class.
        self.assertEqual([cls[k] for k in [(1, 3), (1, 4), (2, 1), (2, 2), (4, 7)]], [None, None, None, None, "nama benda"])
        self.assertEqual(why[(1, 3)], "Kata ketiga adalah isim (اِسْم).")
        self.assertTrue(why[(1, 4)].endswith("“Yang Maha Esa”, adalah isim (اِسْم)."), why[(1, 4)])
        self.assertTrue(why[(2, 2)].endswith("adalah isim (اِسْم). Tandanya: memakai alif lam (ال)."), why[(2, 2)])
        # kufuwan, “setara”: the class withheld (quiz.CLASS_WITHHELD kufuw) — a judgement call for the operator.
        self.assertIsNone(cls[(4, 6)])
        self.assertTrue(why[(4, 6)].endswith("yang artinya “setara”, adalah isim (اِسْم)."), why[(4, 6)])
        # The parts of a word named by its composition's forms: وَ (wa), لَمْ (lam), لَّ (la), هُۥ (hū).
        self.assertIn("yaitu وَ (wa), yang artinya “dan”, adalah huruf (حَرْف), karena ia kata tugas.", why[(3, 3)])
        self.assertIn("yaitu لَمْ (lam), yang artinya “tidak”, adalah huruf (حَرْف), karena ia kata tugas.", why[(4, 2)])
        self.assertEqual(why[(4, 5)], "Bagian kedua kata ketiga, yaitu هُۥ (hū), yang artinya “Dia”, adalah isim (اِسْم), karena ia kata ganti. "
                                      "Tandanya: didahului huruf jar (حَرْف جَرّ).")
        # A heavy-letter word is named on screen (the narration leaves it unsaid, rule 5): qul.
        self.assertTrue(why[(1, 1)].startswith("Kata pertama, yaitu قُلْ (qul), yang artinya “katakanlah”, adalah fi'il"), why[(1, 1)])
        self.assertEqual(Q.class_problems(q, lesson, MANIFESTS["al-ikhlas"], Q.zero_lines(MANIFESTS)), [])
        # Every lesson zero line is "ayah 0" of the surah that hosts it; none in Al-Ikhlas's manifest.
        self.assertTrue(Q.zero_lines(MANIFESTS))
        self.assertTrue(all(k.startswith("al-fatihah:0:") for k in Q.zero_lines(MANIFESTS)))


class Warmup(unittest.TestCase):
    """The warm-up as built for Al-Fatihah, and the rules it is derived by."""

    def setUp(self):
        self.q = QUIZZES[SLUG]
        self.lesson = LESSONS[SLUG]

    def test_every_part_of_every_word_once_in_order(self):
        total = 0
        for a in self.lesson["ayat"]:
            qs = warm(self.q, a["ayah"])["questions"]
            self.assertEqual([q["n"] for q in qs], list(range(1, len(qs) + 1)))
            want = [(i, p["part"]) for i, w in enumerate(a["words"], 1) for p in Q.word_parts(self.lesson, w)]
            self.assertEqual([(q["word"], q["part"]) for q in qs], want, a["loc"])
            # A word's parts, joined, are the word as the lesson writes it.
            for i, w in enumerate(a["words"], 1):
                self.assertEqual("".join(q["ar"] for q in qs if q["word"] == i), w["ar"], w["loc"])
            total += len(qs)
        # 29 words, 8 of them of two parts (operator's lesson: "dengan" + "nama" are two questions).
        words = [w for a in self.lesson["ayat"] for w in a["words"]]
        self.assertEqual((len(words), sum(1 for w in words if " + " in w["pos"]), total), (29, 8, 37))
        self.assertEqual([len(warm(self.q, n)["questions"]) for n in range(1, 8)], [5, 5, 2, 3, 5, 4, 13])
        # The warm-up is the FIRST exercise of every ayah, and only a mapped surah has it.
        for a in self.q["ayat"]:
            self.assertEqual(a["exercises"][0]["key"], Q.WARMUP)
        for slug, quiz in QUIZZES.items():
            if slug not in MAPPED:
                self.assertFalse(any(ex["key"] == Q.WARMUP for a in quiz["ayat"] for ex in a["exercises"]), slug)
                self.assertEqual(quiz["kinds"], {})
        self.assertEqual(self.q["kinds"], {"isim": "isim (اِسْم)", "fiil": "fi'il (فِعْل)", "huruf": "huruf (حَرْف)"})

    def test_the_answer_is_the_qac_tag_and_agrees_with_pos(self):
        for a in self.lesson["ayat"]:
            for q in warm(self.q, a["ayah"])["questions"]:
                w = a["words"][q["word"] - 1]
                said = w["pos"].split(" + ")[q["part"] - 1]
                self.assertEqual(q["kind"], Q.POS_KIND[said.split(" ")[0]], f"{w['loc']} {said}")
                tags = [t for t in CUR.qac_tags(w) if t != Q.QAC_ARTICLE]
                self.assertEqual(q["kind"], Q.QAC_KIND[tags[q["part"] - 1]], w["loc"])
        kinds = [q["kind"] for n in range(1, 8) for q in warm(self.q, n)["questions"]]
        self.assertEqual({k: kinds.count(k) for k in Q.KINDS}, {"isim": 26, "fiil": 4, "huruf": 7})
        # The article is no part of its own, and it stays with the part it stands on: a huruf
        # 'athaf + an isim with alif lam (An-Nas 6, wan-nās) is two parts, the second with it.
        nas = LESSONS["an-nas"]
        w = Q.word_at(nas, "114:6:3")
        self.assertEqual(CUR.qac_tags(w), ["CONJ", "DET", "N"])
        ar = w["ar"]
        parts = Q.word_parts({**nas, "segments": {"114:6:3": [ar[:2], ar[2:5], ar[5:]]}}, w)
        self.assertEqual([(p["kind"], p["article"], p["ar"]) for p in parts], [("huruf", False, ar[:2]), ("isim", True, ar[2:])])
        # Since 2026-10-19 every lesson ships the QAC segments of its words of two or more parts
        # (build_surah.compound_segments), An-Nas's too: the same parts from the lesson's own bytes.
        self.assertEqual([(p["kind"], p["article"], p["ar"]) for p in Q.word_parts(nas, w)], [("huruf", False, ar[:2]), ("isim", True, ar[2:])])
        # Without the lesson's own parts a compound word cannot be asked (nothing is cut here).
        with self.assertRaisesRegex(Q.QuizError, "does not carry its 3 QAC segments"):
            Q.word_parts({**nas, "segments": {}}, w)

    def test_a_sign_only_where_the_data_shows_it_and_an_earlier_lesson_taught_it(self):
        signs = {(n, q["n"]): q["signs"] for n in range(1, 8) for q in warm(self.q, n)["questions"] if q["signs"]}
        # "didahului huruf jar": huruf jar is taught in ayah 1, so from ayah 2 on (lillāhi; 'alaihim twice).
        # "memakai alif lam": taught in ayah 3, so from ayah 4 on (ad-dīn; aṣ-ṣirāṭ, al-mustaqīm; al-magḍūb, aḍ-ḍāllīn).
        self.assertEqual(signs, {(2, 3): ["jar"], (4, 3): ["al"], (6, 3): ["al"], (6, 4): ["al"], (7, 6): ["jar"], (7, 8): ["al"],
                                 (7, 10): ["jar"], (7, 13): ["al"]})
        self.assertEqual(Q.sign_steps(CURRICULUM), {"jar": "1:1", "al": "1:3"})
        # The data shows both in earlier ayat too (bismi in ayah 1, ar-raḥmān in ayat 1 and 3,
        # al-ḥamdu in ayah 2): not said there, their lesson has not come.
        self.assertEqual(warm(self.q, 1)["questions"][1]["signs"], [])
        self.assertEqual([q["signs"] for q in warm(self.q, 3)["questions"]], [[], []])
        # Never for a fi'il or a huruf, and no sign but the two.
        for n in range(1, 8):
            for q in warm(self.q, n)["questions"]:
                self.assertTrue(set(q["signs"]) <= {"jar", "al"})
                if q["kind"] != "isim":
                    self.assertEqual(q["signs"], [])
        # An ayah of a lesson the curriculum does not have gets no sign at all.
        other = {**self.lesson, "surah": 99}
        self.assertTrue(all(q["signs"] == [] for q in Q.warmup_questions(other, self.lesson["ayat"][6], CURRICULUM,
                                                                          Q.kind_classes(LIBRARY))))

    def test_one_sentence_built_from_the_data(self):
        meanings = Q.kind_meanings(LIBRARY)
        self.assertEqual(meanings, {"isim": "nama benda, orang, atau sifat", "fiil": "kata kerja", "huruf": "kata tugas"})
        record = next(c for c in LIBRARY["concepts"] if c["id"] == Q.KALIMAH_RECORD)
        for text in meanings.values():
            self.assertIn(f"({text})", record["summary"])
        # WHICH class (operator 2026-10-17: "directly show which one"), the record's: an isim's from
        # its examples (ṣirāṭa N, al-mustaqīma ADJ, iyyāka PRON), a fi'il's and a huruf's from its
        # summary, for every tag of the kind. No class for PN, REL, DEM, T, LOC.
        classes = Q.kind_classes(LIBRARY)
        self.assertEqual(classes, {"N": "nama benda", "ADJ": "nama sifat", "PRON": "kata ganti", "V": "kata kerja",
                                   "P": "kata tugas", "CONJ": "kata tugas", "NEG": "kata tugas"})
        for tag in ("N", "ADJ", "PRON"):
            ex = next(e for e in record["examples"] if e["note"].endswith(f", {classes[tag]}."))
            self.assertEqual([t for t in CUR.qac_tags(Q.word_at(self.lesson, ex["loc"])) if t != Q.QAC_ARTICLE], [tag], ex["loc"])
        why = {(n, q["n"]): q["why"] for n in range(1, 8) for q in warm(self.q, n)["questions"]}
        # The named words as the content writes them (no Arabic is typed here): a lesson word, a composition form.
        comp = __import__("compose").load_content(SLUG)
        word_ = lambda loc: f"{Q.word_at(self.lesson, loc)['ar']} ({Q.word_at(self.lesson, loc)['translit']})"  # noqa: E731
        form_ = lambda loc, k: f"{comp['words'][loc]['forms'][k]['ar']} ({comp['words'][loc]['forms'][k]['translit']})"  # noqa: E731
        # The operator's own question (Al-Fatihah 1, the fourth word): the word, its meaning, its kind, its class.
        self.assertEqual(why[(1, 5)], f"Kata keempat, yaitu {word_('1:1:4')}, yang artinya “Maha Penyayang”, adalah isim (اِسْم), karena ia nama sifat.")
        # A title of Allah: the kind alone, no class (operator 2026-10-17: "just say, it's ism"; ALLAH_KIND_ONLY).
        self.assertEqual(why[(2, 4)], f"Kata ketiga, yaitu {word_('1:2:3')}, yang artinya “Tuhan”, adalah isim (اِسْم).")
        self.assertEqual(why[(5, 1)], f"Kata pertama, yaitu {word_('1:5:1')}, yang artinya “hanya kepada Engkau”, adalah isim (اِسْم), karena ia kata ganti.")
        self.assertEqual(why[(5, 2)], f"Kata kedua, yaitu {word_('1:5:2')}, yang artinya “kami menyembah”, adalah fi'il (فِعْل), karena ia kata kerja.")
        self.assertEqual(why[(4, 3)], f"Kata ketiga, yaitu {word_('1:4:3')}, yang artinya “pembalasan”, adalah isim (اِسْم), karena ia nama benda. "
                                      "Tandanya: memakai alif lam.")
        # A part: the composition's form of its bytes (bi), else its place in the composition's join (bi + ismi).
        self.assertEqual(why[(1, 1)], f"Bagian pertama kata pertama, yaitu {form_('1:1:1', 'bi')}, yang artinya “dengan”, adalah huruf (حَرْف), karena ia kata tugas.")
        self.assertEqual(why[(1, 2)], f"Bagian kedua kata pertama, yaitu {form_('1:1:1', 'ismi')}, yang artinya “nama”, adalah isim (اِسْم), karena ia nama benda.")
        self.assertNotEqual(comp["words"]["1:1:1"]["forms"]["ismi"]["ar"], warm(self.q, 1)["questions"][1]["ar"])  # by the join, not the bytes
        self.assertEqual(why[(7, 10)], f"Bagian kedua kata ketujuh, yaitu {form_('1:7:7', 'him')}, yang artinya “mereka”, adalah isim (اِسْم), karena ia kata ganti. "
                                       "Tandanya: didahului huruf jar (حَرْف جَرّ).")
        # … and a part no form names (the front عَلَيْ of ‘alaihim, 1:7:4: the composition has ‘alā, not its bytes): its
        # class, no meaning; its back هِمْ is the composition's form `him` since 2026-10-17 ("Sibling lines").
        self.assertEqual(why[(7, 5)], "Bagian pertama kata keempat adalah huruf (حَرْف), karena ia kata tugas.")
        self.assertEqual(why[(7, 6)], f"Bagian kedua kata keempat, yaitu {form_('1:7:4', 'him')}, yang artinya “mereka”, adalah isim (اِسْم), karena ia kata ganti. "
                                      "Tandanya: didahului huruf jar (حَرْف جَرّ).")
        # A heavy-letter word is named on screen too (the narration leaves it unsaid: rule 5).
        self.assertEqual(why[(7, 13)], f"Kata kesembilan, yaitu {word_('1:7:9')}, yang artinya “orang-orang yang sesat”, adalah isim (اِسْم). "
                                       "Tandanya: memakai alif lam.")
        # The Name of Allah: the kind, and nothing else, in the sentence whose subject it is (2026-10-13, unchanged).
        self.assertEqual(why[(1, 3)], "Kata kedua adalah isim (اِسْم).")
        self.assertEqual(why[(2, 3)], "Bagian kedua kata kedua adalah isim (اِسْم). Tandanya: didahului huruf jar (حَرْف جَرّ).")
        # ONE rule for which class is named (quiz.part_class): the kind alone for the Name, a participle
        # noun (māliki, al-magḍūbi, aḍ-ḍāllīna) and a relative (allażīna).
        bare = {(n, q["n"]): CUR.qac_tags(self.lesson["ayat"][n - 1]["words"][q["word"] - 1])
                for n in range(1, 8) for q in warm(self.q, n)["questions"] if not q.get("class")}
        self.assertEqual(bare, {(1, 3): ["PN"], (2, 3): ["P", "PN"],                     # the Name
                                (4, 1): ["N"], (7, 8): ["DET", "N"], (7, 13): ["DET", "N"],  # participles
                                (7, 2): ["REL"],                                          # allażīna
                                (7, 7): ["N"],                                            # gair (CLASS_WITHHELD)
                                (2, 4): ["N"]})                                           # rabbi (ALLAH_KIND_ONLY)
        # gair (“bukan”): a plain QAC N, listed by its QAC lemma with its reason — and that lemma is the
        # Kosakata entry whose sources give the reason (always annexed; negation or exception).
        self.assertEqual(list(Q.CLASS_WITHHELD), ["gayor", "kufuw"])
        gair = next(x for x in LIBRARY["lexicon"] if x["id"] == Q.word_at(self.lesson, "1:7:5")["lemma_id"])
        self.assertIn("selalu disandarkan", gair["meaning"])
        self.assertEqual(Q.word_parts(self.lesson, Q.word_at(self.lesson, "1:7:5"))[0]["lemma"], "gayor")
        self.assertEqual(why[(7, 7)], f"Kata kelima, yaitu {word_('1:7:5')}, yang artinya “bukan”, adalah isim (اِسْم).")
        self.assertEqual(why[(4, 1)], f"Kata pertama, yaitu {word_('1:4:1')}, yang artinya “Pemilik”, adalah isim (اِسْم).")
        self.assertEqual(why[(7, 2)], f"Kata kedua, yaitu {word_('1:7:2')}, yang artinya “orang-orang yang”, adalah isim (اِسْم).")
        part = lambda tag, **kw: {"tag": tag, "lafaz": False, "participle": False, **kw}  # noqa: E731
        self.assertEqual([Q.part_class(part(t), classes) for t in ("N", "PN", "ADJ", "PRON", "REL", "DEM", "T", "LOC", "V", "P", "CONJ", "NEG")],
                         ["nama benda", None, "nama sifat", "kata ganti", None, None, None, None, "kata kerja", "kata tugas", "kata tugas", "kata tugas"])
        self.assertEqual([Q.part_class(part("PN", lafaz=True), classes), Q.part_class(part("N", participle=True), classes),
                          Q.part_class(part("ADJ", participle=True), classes), Q.part_class(part("N", lemma="gayor"), classes),
                          Q.part_class(part("N", lemma="rab~"), classes)], [None, None, "nama sifat", None, "nama benda"])
        # … by PLACE: rabb at 1:2:3 is a title of Allah; aḥad at 112:1:4 is said of Allah, at 112:4:5 not;
        # ar-raḥmāni / ar-raḥīmi keep "nama sifat" (attributes, QAC ADJ; the operator's own example).
        isim = lambda tag, lemma, loc: part(tag, lemma=lemma, loc=loc, kind="isim")  # noqa: E731
        self.assertEqual([Q.part_class(isim("N", "rab~", "1:2:3"), classes), Q.part_class(isim("N", ">aHad", "112:1:4"), classes),
                          Q.part_class(isim("N", ">aHad", "112:4:5"), classes), Q.part_class(isim("ADJ", "r~aHiym", "1:1:4"), classes),
                          Q.part_class(isim("N", "<ila`h", "114:3:1"), classes)], [None, None, "nama benda", "nama sifat", None])
        self.assertEqual(Q.allah_kind_only_problems(LESSONS), [])
        self.assertNotIn("1:1:3", Q.ALLAH_KIND_ONLY)
        self.assertNotIn("112:4:5", Q.ALLAH_KIND_ONLY)
        self.assertEqual(why[(1, 5)], f"Kata keempat, yaitu {word_('1:1:4')}, yang artinya “Maha Penyayang”, adalah isim (اِسْم), karena ia nama sifat.")
        for n in range(1, 8):
            for q in warm(self.q, n)["questions"]:
                # Never the general definition; the class where there is one, in one place.
                self.assertNotIn(meanings["isim"], q["why"], (n, q["n"]))
                self.assertEqual(f", karena ia {q['class']}." in q["why"] if q.get("class") else "karena" not in q["why"], True, (n, q["n"]))
                self.assertNotIn("gloss", q)
        # What the narration says is the same sentence without its term markup; a part is named by its
        # place and by the named-word markup (the narration's Speech shows and says it), never by a
        # Qur'anic word in its prose, and no sentence carries Arabic of its own.
        for n in range(1, 8):
            ayah = self.lesson["ayat"][n - 1]
            for q in warm(self.q, n)["questions"]:
                prose = Q.warmup_prose(q, TERMS, self.lesson, ayah, comp)
                self.assertNotRegex(prose, r"[\[\]|]|[\u0600-\u06ff]")
                named = Q.warmup_named(self.lesson, ayah, q, comp)
                self.assertEqual(q["why"], Q.named_words(TERMS.annotate_marked(Q.warmup_marked(q, TERMS, named), {}), self.lesson))
                self.assertTrue(prose.startswith(("Kata ", "Bagian ")), prose)
                shown = MANIFESTS[SLUG]["lines"][f"{SLUG}:{n}:ex:{Q.WARMUP}:{q['n']}:why"]["display"]
                self.assertEqual(shown.replace("’", "'"), q["why"].replace("alif lam", "alif lam (ال)").replace("’", "'"), (n, q["n"]))

    def test_what_it_needs_was_taught_by_earlier_lessons(self):
        first = Q.taught_first(MANIFESTS[SLUG], self.lesson, TERMS)
        # The three kinds: lesson zero, whose lines are "ayah 0" of the surah that hosts it.
        self.assertEqual({k: first[k][0] for k in Q.KINDS}, {"isim": 0, "fiil": 0, "huruf": 0})
        self.assertEqual(first["huruf-jar"][0], 1)
        ex = warm(self.q, 2)
        need = Q.required(ex, ex["questions"][2], self.lesson, self.lesson["ayat"][1], TERMS, self.q)
        self.assertEqual(set(need), {"isim", "fiil", "huruf", "huruf-jar"})
        self.assertEqual(need["huruf-jar"], "the explanation shown after the answer")
        self.assertEqual(Q.untaught(self.q, self.lesson, TERMS, MANIFESTS[SLUG]).keys() & {k for k in [f"{SLUG}:{n}:{Q.WARMUP}:{q['n']}" for n in range(1, 8) for q in warm(self.q, n)["questions"]]}, set())

    def test_the_explanation_shown_is_what_the_narrator_says(self):
        # A word with a `why_basic`: the screen shows it (its terms with their Arabic), not the
        # reference `why`; a word without one still shows its `why`. The OPTIONS stay the `why`.
        by = {(a["ayah"], ex["key"], q["n"]): q for a in self.q["ayat"] for ex in a["exercises"] for q in ex["questions"]}
        basic = Q.word_at(self.lesson, "1:2:4")
        self.assertTrue(basic.get("why_basic"))
        self.assertEqual(by[(2, "sort-case", 3)]["why"], TERMS.annotate(basic["why_basic"]))
        self.assertNotIn("mudhaf ilaih", by[(2, "sort-case", 3)]["why"])
        self.assertIn("mudhaf ilaih", basic["why"])
        # (1:4:1 was the example until 2026-10-18; it has a `why_basic` since, which names the word it
        # describes and its ayah, "bagi ٱللَّهِ (Allāhi) di ayat kedua": wording rule 8.)
        plain = Q.word_at(self.lesson, "1:4:2")
        self.assertFalse(plain.get("why_basic"))
        self.assertEqual(by[(4, "why-harakat", 2)]["word"], 2)
        self.assertEqual(by[(4, "why-harakat", 2)]["why"], by[(4, "why-harakat", 2)]["options"][0]["text"])
        with_basic = Q.word_at(self.lesson, "1:2:2")
        q = by[(2, "label-role", 2)]
        self.assertEqual(q["word"], 2)
        self.assertEqual(q["why"], Q.named_words(TERMS.annotate(with_basic["why_basic"]), self.lesson))
        self.assertIn("لِ (li)", q["why"])  # its part named (2026-10-17, "Sibling lines")
        # And every word that has one is shown with it wherever it is asked.
        for (n, key, _k), q in by.items():
            if key in ("why-harakat", "sort-case", "label-role"):
                w = self.lesson["ayat"][n - 1]["words"][q["word"] - 1]
                if w.get("why_basic"):
                    self.assertEqual(q["why"], Q.named_words(TERMS.annotate(w["why_basic"]), self.lesson), w["loc"])
                    self.assertNotIn("{{", q["why"], w["loc"])

    def test_a_named_word_is_shown_not_its_markup(self):
        # Operator 2026-10-17 ("show the Arabic word"): a `why_basic` that names another word of the
        # lesson ({{!1:6:2}}) shows it as the narration's caption does — Arabic, then transliteration.
        w = Q.word_at(self.lesson, "1:7:1")
        self.assertIn("{{!1:6:2}}", w["why_basic"])  # shown only: a heavy-letter word (operator 2026-10-17)
        q = next(q for a in self.q["ayat"] if a["ayah"] == 7 for ex in a["exercises"] if ex["key"] == "sort-case"
                 for q in ex["questions"] if q["word"] == 1)
        named = Q.word_at(self.lesson, "1:6:2")
        self.assertIn(f"kata {named['ar']} ({named['translit']}) yang artinya", q["why"])
        self.assertNotIn("{{", q["why"])
        # An unknown name stops the build.
        with self.assertRaises(Q.QuizError):
            Q.named_words("bagi kata {{1:6:9}} yang artinya", self.lesson)
        with self.assertRaises(Q.QuizError):
            Q.named_words("bagi kata {{1:6:2/nope}} yang artinya", self.lesson)


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
    for cls in (Taught, Pieces, Twin, Warmup):
        suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(cls))
    res = unittest.TextTestRunner(verbosity=1, stream=sys.stdout).run(suite)
    caught = len(MUTATIONS) - (failed - bool(base))
    print(f"\n{len(MUTATIONS)} planted faults, {caught} caught")
    return 1 if failed or not res.wasSuccessful() else 0


if __name__ == "__main__":
    sys.exit(main())
