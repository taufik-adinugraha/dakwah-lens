#!/usr/bin/env python3
"""Planted-fault tests for the cheat sheet checks (rumus.py, validate_rumus.py): each case plants ONE
fault in a copy of authored/rumus.json, of content/rumus.json, of the curriculum, the lessons or the
pins, and asserts that the checks fail with the expected message; the unmutated copies must pass.
The faults the operator's rules name come first: a formula without a kitab sentence, a quote that
is not in its page (or was typed), a term before its lesson, a source without its address, a pin
that moved. Faults only the pinned pages can catch are skipped with --no-corpus (CI). Also
unit-tests the folding, the quote finder, the pointers, the example and what the sheet covers today.
Standard library only; run from belajar/pipeline after build_rumus.py:

    python3 test_validate_rumus.py               # with pipeline/cache (local)
    python3 test_validate_rumus.py --no-corpus   # CI
"""
from __future__ import annotations

import copy
import sys
import unittest

import curriculum as CUR
import rumus as R
import terms as TM
from common import load_sources

NO_CORPUS = "--no-corpus" in sys.argv
if NO_CORPUS:
    sys.argv.remove("--no-corpus")
CONTENT = R.load_content()
AUTHORED = R.load_authored()
CURRICULUM = CUR.load_content()
LESSONS = R.load_lessons()
SRC = load_sources()
TABLE = TM.load_terms()
TEXTS = None if NO_CORPUS else R.texts_for(AUTHORED, SRC)


def run_check(content, authored=None, cur=None, lessons=None, src=None):
    authored = AUTHORED if authored is None else authored
    cur = CURRICULUM if cur is None else cur
    src = SRC if src is None else src
    return (R.authored_problems(authored, cur, src, TABLE)
            + R.problems(content, authored, cur, LESSONS if lessons is None else lessons, src, TABLE, texts=TEXTS))


def row(c, sid):
    return next(e for e in c["steps"] if e["step"] == sid)


def entry(a, sid):
    return a["steps"][sid]


# A mutation takes (content, authored, curriculum, sources) copies and changes them in place.
def content_quote(sid, page, fn):
    def f(c, a, cur, s):
        src = next(x for x in row(c, sid)["sumber"] if x["page"] == page)
        src["quotes"][0] = fn(src["quotes"][0])
    return f


def authored_set(sid, field, value):
    def f(c, a, cur, s):
        entry(a, sid)[field] = value
    return f


def append_text(sid, field, extra):
    def f(c, a, cur, s):
        entry(a, sid)[field] = entry(a, sid)[field] + extra
    return f


def drop_key(sid, key):
    def f(c, a, cur, s):
        del entry(a, sid)[key]
    return f


def built_source_without(sid, key):
    def f(c, a, cur, s):
        del row(c, sid)["sumber"][0][key]
    return f


def pin_drift(c, a, cur, s):
    s["inputs"]["shamela_istilah"]["pages"]["11371/6"]["text_sha256"] = "0" * 64


def unpinned(c, a, cur, s):
    entry(a, "majrur")["sumber"][0]["page"] = "11371/99"


def new_step(c, a, cur, s):
    a["steps"]["no-such-step"] = copy.deepcopy(entry(a, "kalimah"))


def swap_order(c, a, cur, s):
    c["steps"][0], c["steps"][1] = c["steps"][1], c["steps"][0]


def dropped_from_authored(c, a, cur, s):
    del a["steps"]["badal"]


def extra_key(c, a, cur, s):
    row(c, "badal")["review"] = "x"


def lesson_changed(c, a, cur, s):
    row(c, "badal")["lesson"] = "1:1"


def example_moved(c, a, cur, s):
    row(c, "majrur")["example"] = {"loc": "1:1:2"}


def example_gone(c, a, cur, s):
    del row(c, "majrur")["example"]


def kitab_renamed(c, a, cur, s):
    row(c, "badal")["sumber"][0]["kitab"] = "Kitab Lain"


def url_changed(c, a, cur, s):
    row(c, "badal")["sumber"][0]["url"] = "https://shamela.ws/book/11371/1"


def rumus_edited(c, a, cur, s):
    row(c, "badal")["rumus"] = row(c, "badal")["rumus"].replace("seluruh", "sebagian")


def rumus_arabic(c, a, cur, s):
    row(c, "badal")["rumus"] += " اسم"


def anchor_wrong(c, a, cur, s):
    entry(a, "majrur")["sumber"][1]["match"][0] = R.fold("وكلها تُرفَعُ بالضمة، وتُنصَبُ بالكسرة، وتُخفَضُ بالفتحة، وتُجزَمُ بالسكون")


def anchor_twice(c, a, cur, s):
    entry(a, "marfu")["sumber"][0]["match"] = ["علامة للرفع في"]


def vowels_changed(c, a, cur, s):
    q = row(c, "marfu")["sumber"][0]["quotes"][0]
    row(c, "marfu")["sumber"][0]["quotes"][0] = q.replace("َ", "ُ", 1)


def to_unfolded(c, a, cur, s):
    entry(a, "majrur")["sumber"][0]["match"][0] = "فأما الكسرةُ: فتكونُ علامةً للخفضِ في ثلاثة مواضع"


def short_anchor(c, a, cur, s):
    entry(a, "majrur")["sumber"][0]["match"][0] = "فتكون علامة"


def typed_quote(c, a, cur, s):
    entry(a, "badal")["sumber"][0]["quote"] = "إذا أُبدِلَ اسمٌ مِن اسم"


def both_pages(c, a, cur, s):
    entry(a, "majrur")["sumber"].append(copy.deepcopy(entry(a, "majrur")["sumber"][0]))


# (name, mutation(content, authored, curriculum, sources), expected substring, needs the corpus)
MUTATIONS = [
    # The operator's rules.
    ("a formula without a kitab sentence", drop_key("badal", "sumber"), "no `sumber`", False),
    ("a formula whose sources are empty", authored_set("badal", "sumber", []), "no `sumber`", False),
    ("a quote that is none of the authored anchors (a hand-edited quote)",
     content_quote("badal", "11371/18", lambda q: "إذا أُبدِلَ اسمٌ مِن اسم أو فعلٌ مِن فعلٍ تَبِعَهُ في بعض إعرابِهِ"),
     "is none of the authored anchors of page 11371/18", False),
    ("a quote with the page's words and other vowels", vowels_changed, "differs from the page's own bytes", True),
    ("an anchor that is not in its page (words swapped)", anchor_wrong, "the match", False),
    ("an anchor found twice in its page", anchor_twice, "times: lengthen the match", True),
    ("a quote typed in the authored file", typed_quote, "a typed quote", False),
    ("Arabic typed in a formula", append_text("badal", "rumus", " dari kata اسم"), "Arabic typed in a formula", False),
    ("Arabic in the built formula", rumus_arabic, "Arabic in a formula's text", False),
    ("a term of a later lesson (majzum, taught at 112:3, in lesson zero)",
     append_text("kalimah", "rumus", " Ini [[majzum]]."), "uses the term 'majzum' before the lesson that teaches it", False),
    ("a later term written without markup (idhafah in lesson 1:1)",
     append_text("majrur", "rumus", " Seperti idhafah."), "term 'idhafah' is in library.terms.json but written without", False),
    ("an ambiguous form that is a term of a later lesson (sifat is na't, taught at 1:3)",
     append_text("majrur", "rumus", " Ia sifat."), "uses the term 'naat' before the lesson that teaches it", False),
    ("a term of the step's own lesson is allowed (mudhaf ilaih at 1:4)",
     lambda c, a, cur, s: None, "", False),  # placeholder replaced below
    ("a source without its address", built_source_without("badal", "url"), "keys must be", False),
    ("a source without its print page", built_source_without("badal", "hlm"), "keys must be", False),
    ("a source whose address is another page's", url_changed, "url 'https://shamela.ws/book/11371/1' is not the pin's", False),
    ("a source whose kitab is not the pin's", kitab_renamed, "kitab 'Kitab Lain' is not the pin's", False),
    ("a source without its kitab", built_source_without("badal", "kitab"), "keys must be", False),
    ("a pin whose sha256 drifted", pin_drift, "data_versions.pages[11371/6]", False),
    ("a page that is not pinned", unpinned, "is not pinned in sources.json", False),
    # The sheet's shape.
    ("a step that is no step of the curriculum", new_step, "no step with this id in the curriculum", False),
    ("steps out of the curriculum's teaching order", swap_order, "teaching order", False),
    ("a built step that is no longer authored", dropped_from_authored, "are not the authored steps", False),
    ("a key the built step does not have", extra_key, "unknown key(s) ['review']", False),
    ("a step filed under another lesson", lesson_changed, "is not the step's lesson", False),
    ("an example that is not the first word the step occurs on", example_moved, "is not the first word the step occurs on", False),
    ("an example left out", example_gone, "no example, and the step occurs on 1:1:1", False),
    ("a formula edited by hand in the built file", rumus_edited, "out of date with a fresh build", False),
    ("an anchor that is not folded (harakat in an anchor)", to_unfolded, "not folded", False),
    ("an anchor of fewer than three words", short_anchor, "fewer than 3 words", False),
    ("a page listed twice for one step", both_pages, "listed twice", False),
    # The formulas themselves.
    ("a pointer to a step taught in the same lesson", append_text("majrur", "rumus", " Lihat {{di:huruf-jar}}."), "names a step taught in or before this lesson", False),
    ("a pointer to a step taught earlier", append_text("majrur", "rumus", " Lihat {{di:kalimah}}."), "names a step taught in or before this lesson", False),
    ("a pointer to a step that does not exist", append_text("majrur", "rumus", " Lihat {{di:tidak-ada}}."), "no such step in the curriculum", False),
    ("a stray pointer bracket", append_text("majrur", "rumus", " {{ ini"), "a stray", False),
    ("a Qur'anic word in a formula", append_text("majrur", "rumus", " Seperti [[bismi|q:1:1:1]]."), "a Qur'anic word in a formula", False),
    ("an ALL CAPS emphasis", append_text("majrur", "rumus", " JANGAN lupa."), "ALL CAPS", False),
    ("a formula that is not short", append_text("majrur", "rumus", " " + ("Kalimat tambahan yang panjang. " * 14).rstrip()), "a cheat sheet is short", False),
    ("'ketuk' for a click", append_text("majrur", "rumus", " Ketuk tombolnya."), "ketuk", False),
    ("an awas that uses a later term (mudhaf ilaih at 1:1)", append_text("majrur", "awas", " Juga [[mudhaf ilaih]]."),
     "uses the term 'mudhaf-ilaih' before the lesson that teaches it", False),
    ("a key the authored entry may not have", authored_set("badal", "contoh", "x"), "keys must be among", False),
]
# The placeholder above is the positive control, kept as a unit test below, not a fault.
MUTATIONS = [m for m in MUTATIONS if m[2]]


def mutated(mutate):
    c, a, cur, s = copy.deepcopy(CONTENT), copy.deepcopy(AUTHORED), copy.deepcopy(CURRICULUM), copy.deepcopy(SRC)
    mutate(c, a, cur, s)
    return c, a, cur, s


def check_mutated(mutate):
    c, a, cur, s = mutated(mutate)
    return run_check(c, a, cur, None, s)


class Validation(unittest.TestCase):
    def test_unmutated_passes(self):
        self.assertEqual(run_check(copy.deepcopy(CONTENT)), [])

    def test_mutations_fail(self):
        for title, mutate, expect, needs in MUTATIONS:
            if needs and TEXTS is None:
                continue
            with self.subTest(title):
                errs = check_mutated(mutate)
                self.assertTrue(any(expect in e for e in errs), f"{title}: expected {expect!r} in {errs[:4]}")

    def test_a_term_of_the_steps_own_lesson_is_allowed(self):
        # The same lesson counts ("up to and including its own": idhafah teaches mudhaf ilaih), and
        # an earlier lesson's term is free to use; only a LATER lesson's is refused.
        a = copy.deepcopy(AUTHORED)
        a["steps"]["idhafah"]["rumus"] += " Ia [[mudhaf]] dan [[isim]]."
        self.assertEqual(R.authored_problems(a, CURRICULUM, SRC, TABLE), [])


class Folding(unittest.TestCase):
    def test_fold(self):
        self.assertEqual(R.fold("فالاسم يُعرَفُ: بالخَفضِ"), "فالاسم يعرف بالخفض")
        # alif forms unified, alif maqsurah as ya', the dagger alif and tatweel dropped
        self.assertEqual(R.fold("إلى ٱلرَّحْمَٰنِ أنتَ آمن"), "الي الرحمن انت امن")
        self.assertEqual(R.fold("مـــن"), "من")
        # punctuation and footnote digits are no word
        self.assertEqual(R.fold_tokens("أنواع١: مخفوضٌ، و"), ["انواع", "مخفوض", "و"])

    def test_find_quote_takes_the_pages_bytes(self):
        page = "المخفوضات ثلاثة أنواع ١: مخفوضٌ بالحَرفِ، ومخفوضٌ بالإضافة"
        got = R.find_quote(page, R.fold_tokens("ثلاثة انواع مخفوض بالحرف"))
        # the footnote marker is the editor's: dropped, and no space is left before the colon
        self.assertEqual(got, "ثلاثة أنواع: مخفوضٌ بالحَرفِ")
        with self.assertRaisesRegex(R.RumusError, "not found"):
            R.find_quote(page, R.fold_tokens("ثلاثة انواع مخفوض بالاضافة"))
        with self.assertRaisesRegex(R.RumusError, "2 times"):
            R.find_quote("قال زيد ثم قال زيد", R.fold_tokens("قال زيد"))
        # whole words only: a prefix of a word is not the word
        with self.assertRaises(R.RumusError):
            R.find_quote("فالاسم يعرف", R.fold_tokens("الاسم يعرف"))

    def test_a_quotation_closes_with_its_sentence(self):
        page = 'وأما ما يُخفَضُ بالإضافة , فنحو قولك: "غلامُ زيدٍ" وهو على قسمين'
        got = R.find_quote(page, R.fold_tokens("وأما ما يخفض بالإضافة فنحو قولك غلام زيد"))
        self.assertEqual(got, 'وأما ما يُخفَضُ بالإضافة, فنحو قولك: "غلامُ زيدٍ"')

    def test_the_quote_of_a_real_page(self):
        if TEXTS is None:
            self.skipTest("needs the corpus")
        q = R.find_quote(TEXTS["11371/18"], R.fold_tokens(AUTHORED["steps"]["badal"]["sumber"][0]["match"][0]))
        self.assertEqual(q, "إذا أُبدِلَ اسمٌ مِن اسم أو فعلٌ مِن فعلٍ تَبِعَهُ في جميع إعرابِهِ")

    def test_the_section_comes_from_the_pins_title(self):
        pins = R.pages_of(SRC)
        self.assertEqual(R.bab_of(pins["11371/6"]), "باب معرفة علامات الإعراب")
        self.assertEqual(R.bab_of(pins["11371/1"]), "مدخل")
        self.assertEqual(R.bab_of(pins["6970/15"]), "الفعل الماضي")
        with self.assertRaises(R.RumusError):
            R.bab_of({"print_page": "9", "title": "ص10 - كتاب - باب - المكتبة"})


class Terms(unittest.TestCase):
    def test_every_use_counts_the_ambiguous_forms_too(self):
        ids = R.terms_in("[[Isim]] yang memakai sifat, huruf ba' dan [[min]] {{di:majrur}}", TABLE)
        self.assertEqual(ids, ["isim", "naat", "huruf", "min"])
        # the pointer's step id is no use of the term of the same name
        self.assertNotIn("majrur", ids)

    def test_a_form_with_nya_is_a_use(self):
        self.assertIn("khabar", R.terms_in("[[khabarnya|khabar]] dan khabarnya", TABLE))

    def test_the_rule_is_the_lessons_own(self):
        # idhafah is taught at 1:4: too early at 1:1 and at lesson zero, fine at 1:4 and after.
        self.assertEqual(CUR.too_early(CURRICULUM, "1:1", ["idhafah"]), ["idhafah"])
        self.assertEqual(CUR.too_early(CURRICULUM, "1:4", ["idhafah"]), [])
        self.assertEqual(CUR.too_early(CURRICULUM, "114:1", ["idhafah"]), [])
        self.assertEqual(CUR.too_early(CURRICULUM, "0", ["nahwu"]), [])  # free


class Pointers(unittest.TestCase):
    def test_a_pointer_says_where_from_the_curriculum(self):
        self.assertEqual(R.place_phrase(CURRICULUM, "idhafah"), "di Al-Fatihah ayat 4")
        self.assertEqual(R.place_phrase(CURRICULUM, "nafi-lam"), "di Al-Ikhlas ayat 3")
        self.assertEqual(R.place_phrase(CURRICULUM, "kalimah"), "di pelajaran pengantar")
        self.assertEqual(R.place_phrase(CURRICULUM, "zharaf"), "di Ayat Kursi penggalan 5")
        with self.assertRaises(R.RumusError):
            R.place_phrase(CURRICULUM, "tidak-ada")

    def test_the_shipped_text_has_no_pointer_left(self):
        for e in CONTENT["steps"]:
            for f in ("rumus", "awas"):
                self.assertNotIn("{{", e.get(f, ""), e["step"])
        self.assertIn("kita pelajari di Al-Fatihah ayat 4", row(CONTENT, "majrur")["rumus"])


class Example(unittest.TestCase):
    def test_the_first_word_the_step_occurs_on(self):
        steps = {s["id"]: s for s in CURRICULUM["steps"]}
        got = {sid: R.example_loc(CURRICULUM, LESSONS, steps[sid]) for sid in steps}
        self.assertEqual(got["majrur"], "1:1:1")
        self.assertEqual(got["marfu"], "1:2:1")
        self.assertEqual(got["jamak-mudzakkar-salim"], "1:2:4")
        self.assertEqual(got["kana"], "112:4:2")
        # the lesson's own line has no words for it: the rule (case majzum) finds yalid
        self.assertEqual(got["majzum"], "112:3:2")
        # tanwin pada isim has the rule `indefinite` since 2026-10-21 (a tanwin mark or QAC INDEF): gasiqin
        self.assertEqual(got["tanwin-nakirah"], "113:3:3")
        # no ayah on disk (Ayat Kursi), lesson zero, a step with no rule: no example
        for sid in ("kalimah", "harakat", "zharaf", "mutsanna", "jamak-taksir"):
            self.assertIsNone(got[sid], sid)

    def test_every_example_is_a_word_of_its_own_lesson(self):
        for e in CONTENT["steps"]:
            if "example" not in e:
                continue
            s, a, _w = (int(x) for x in e["example"]["loc"].split(":"))
            self.assertEqual(CUR.ayah_lesson(s, a), e["lesson"], e["step"])


class Coverage(unittest.TestCase):
    """What the sheet covers today: a row that appears or goes is a decision, so it is pinned."""

    LEFT_OUT = {"harakat", "murab-mabni", "isim-maushul", "mudzakkar-muannats", "istitsna", "la-nafi", "istifham"}

    def test_the_steps_with_and_without_a_formula(self):
        every = {s["id"] for s in CURRICULUM["steps"]}
        have = {e["step"] for e in CONTENT["steps"]}
        self.assertEqual(len(every), 36)
        self.assertEqual(every - have, self.LEFT_OUT)
        self.assertEqual(len(have), 29)

    def test_nothing_is_shown_that_has_no_kitab_sentence(self):
        for e in CONTENT["steps"]:
            self.assertTrue(e["sumber"], e["step"])
            for s in e["sumber"]:
                self.assertTrue(s["quotes"] and s["url"].startswith("https://shamela.ws/book/") and s["hlm"], e["step"])

    def test_the_awas_of_fiil_madhi_has_its_own_sentence(self):
        # The matn says "always fathah"; the limit (sukun, dhammah) is Ibnu Hisyam's sentence,
        # pinned: it stands among the step's sources.
        pages = [s["page"] for s in row(CONTENT, "fiil-madhi")["sumber"]]
        self.assertEqual(pages, ["11371/7", "6970/15"])

    def test_no_arabic_is_typed_but_the_anchors(self):
        for sid, e in AUTHORED["steps"].items():
            for f in ("rumus", "awas"):
                self.assertIsNone(R._ANY_ARABIC.search(e.get(f, "")), (sid, f))


def main() -> int:
    width = max(len(n) for n, *_ in MUTATIONS)
    failed = 0
    base = run_check(copy.deepcopy(CONTENT))
    print(f"{'unmutated copy':{width}s}  {'PASS' if not base else 'FAIL'}" + (f"  {base[:3]}" if base else ""))
    failed += bool(base)
    skipped = []
    for title, mutate, expect, needs in MUTATIONS:
        if needs and TEXTS is None:
            skipped.append(title)
            print(f"{title:{width}s}  skipped (needs the corpus)")
            continue
        errs = check_mutated(mutate)
        hit = next((e for e in errs if expect in e), None)
        failed += hit is None
        print(f"{title:{width}s}  {'caught' if hit else 'MISSED'}  {hit or errs[:2]}")
    suite = unittest.TestSuite()
    for cls in (Validation, Folding, Terms, Pointers, Example, Coverage):
        suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(cls))
    res = unittest.TextTestRunner(verbosity=1, stream=sys.stdout).run(suite)
    n = len(MUTATIONS) - len(skipped)
    print(f"\n{n} planted faults, {n - (failed - bool(base))} caught" + (f"; {len(skipped)} skipped without the corpus" if skipped else ""))
    return 1 if failed or not res.wasSuccessful() else 0


if __name__ == "__main__":
    sys.exit(main())
