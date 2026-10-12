#!/usr/bin/env python3
"""Mutation tests for validate_terms.py (Konsep: terms in Arabic script, Qur'anic words from
content bytes, the inline markup; operator 2026-10-10). Each case plants one fault in a copy of
the authored term/concept/basics/parts files, content/library.json or a lesson file, and asserts
validate_terms.py fails with the expected message. The unmutated copies must pass. Standard
library only; run from belajar/pipeline:

    python3 test_validate_terms.py              # table of faults and the message that caught each
    python3 test_validate_terms.py --no-corpus  # CI: the faults only the cache can catch
                                                # (NEEDS_CORPUS) are listed as skipped, by name
    python3 -m unittest test_validate_terms     # the same as a unittest run (TERMS_NO_CORPUS=1 for CI)

Run build_library.py first (library.json is copied from content/).
"""
from __future__ import annotations

import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

import validate_terms as V

NO_CORPUS = "--no-corpus" in sys.argv[1:] or os.environ.get("TERMS_NO_CORPUS") == "1"
NEEDS_CORPUS = {"excerpt-not-in-page", "outside-token-wrong"}


def concept(d, cid):
    return next(c for c in d if c["id"] == cid)


def term(d, tid):
    return next(t for t in d["terms"] if t["id"] == tid)


# (name, file, mutate(data), expected message fragment)
CASES = [
    # --- the term table
    ("retyped-term-spelling", "terms", lambda d: term(d, "fathah").update(ar="فَتْحَه"),
     "differs from the pronunciation dictionary"),
    ("unattested-term-spelling", "terms", lambda d: term(d, "khabar").update(ar="خَبَار"),
     "not attested in"),
    ("uthmani-mark-in-term", "terms", lambda d: term(d, "khabar").update(ar="خَبَرۡ"),
     "outside typed Arabic"),
    ("term-without-source", "terms", lambda d: term(d, "khabar").update(attest=[]),
     "no attestation"),
    ("unverified-without-reason", "terms", lambda d: term(d, "lam-doa").pop("unverified"),
     "ar is null but no `unverified` reason"),
    ("excerpt-too-long", "terms",
     lambda d: term(d, "khabar")["attest"][0].update(text=" ".join([term(d, "khabar")["attest"][0]["text"]] * 2)),
     "excerpt longer than 12 words"),
    ("harakah-term-without-reminder", "terms", lambda d: term(d, "kasrah").pop("hint"),
     "needs its short reminder"),
    ("excerpt-not-in-page", "terms",
     lambda d: term(d, "khabar")["attest"][0].update(text="هذا خبر لا يوجد في الصفحة"),
     "not a verbatim substring of the pinned page"),
    # --- the authored markup
    ("term-without-markup", "concepts",
     lambda d: concept(d, "huruf-jar")["explanation"].__setitem__(
         0, concept(d, "huruf-jar")["explanation"][0].replace("[[majrur]]", "majrur", 1)),
     "is in library.terms.json but written without [[…]] markup"),
    ("unknown-term-in-markup", "concepts",
     lambda d: concept(d, "huruf-jar")["examples"][0].update(note="[[majrurr]]: dengan kasrah."),
     "names no term in library.terms.json"),
    ("ketuk", "concepts",
     lambda d: concept(d, "naat")["explanation"].__setitem__(0, concept(d, "naat")["explanation"][0] + " Ketuk katanya."),
     "klik, never ketuk"),
    ("yang-berarti", "concepts",
     lambda d: concept(d, "badal")["explanation"].__setitem__(0, concept(d, "badal")["explanation"][0] + " Ia yang berarti pengganti."),
     "yang artinya"),
    # --- library.json is a fresh build, and its Qur'anic bytes are the content's
    ("stale-build", "concepts",
     lambda d: concept(d, "hal")["examples"][0].update(note=concept(d, "hal")["examples"][0]["note"] + " Lagi."),
     "is stale or missing"),
    ("example-arabic-not-its-loc", "library", lambda d: d["quran"].update({"1:1:1": d["quran"]["1:1:2"]}),
     "does not match the lesson content bytes of 1:1:1"),
    ("letter-not-the-ayahs", "library", lambda d: d["quran"].update({"1:1:1#1": d["quran"]["1:1:1#2"]}),
     "does not match the lesson content bytes of 1:1:1"),
    ("segments-do-not-join", "library", lambda d: d["segments"].update({"1:1:1": ["بِ"]}),
     "do not join to the lesson word's content bytes"),
    ("markup-left-in-plain", "library",
     lambda d: concept(d["concepts"], "naat").update(title=concept(d["concepts"], "naat")["marked"]["title"]),
     "markup left in a plain field"),
    ("plain-drifted-from-marked", "library",
     lambda d: concept(d["concepts"], "naat").update(summary=concept(d["concepts"], "naat")["summary"] + " x"),
     "the plain text is not the marked text"),
    ("shipped-term-differs", "library", lambda d: term(d, "majrur").update(ar="مجرور"),
     "does not equal the term table"),
    ("ref-without-bytes", "library", lambda d: d["quran"].pop("2:5:2"),
     "has no bytes for q:2:5:2"),
    ("outside-token-wrong", "library", lambda d: d["quran"].update({"55:78:2": d["quran"]["1:1:1"]}),
     "is not the pinned Tanzil/QAC bytes"),
    ("example-not-a-lesson-word", "lesson",
     lambda d: d["ayat"][0]["words"].__setitem__(0, {**d["ayat"][0]["words"][0], "gloss": ""}),
     "lacks Arabic, transliteration or gloss"),
    # --- review 2026-10-10: a ref's Latin against what it names; the marked text against the authored
    ("term-ref-names-another-term", "concepts",
     lambda d: concept(d, "huruf-jar").update(summary=concept(d, "huruf-jar")["summary"].replace("[[majrur]]", "[[majrur|marfu]]", 1)),
     "does not name the term 'marfu'"),
    ("segment-ref-shows-another-part", "library",
     lambda d: (concept(d["concepts"], "huruf-jar")["marked"].update(
         summary=concept(d["concepts"], "huruf-jar")["marked"]["summary"].replace("[[bi-|q:1:1:1/1]]", "[[bi-|q:1:1:1/2]]", 1)),
         d["quran"].update({"1:1:1/2": d["segments"]["1:1:1"][1]})),
     "'bi-' does not name"),
    ("parts-step-ref-shows-another-word", "library",
     lambda d: (d["parts"][0]["steps"].__setitem__(0, d["parts"][0]["steps"][0].replace("q:55:78:2", "q:55:78:3")),
                d["quran"].update({"55:78:3": d["quran"]["1:2:3"]})),
     "'ismu' does not name"),
    ("marked-text-hand-edited", "library",
     lambda d: concept(d["concepts"], "huruf-jar")["marked"].update(
         summary=concept(d["concepts"], "huruf-jar")["marked"]["summary"].replace("[[majrur|majrur]]", "[[majrur|marfu]]", 1)),
     "the marked text differs from the authored markup"),
    ("bare-quote-meaning", "concepts",
     lambda d: concept(d, "jumlah-filiyyah")["examples"][1].update(
         note=concept(d, "jumlah-filiyyah")["examples"][1]["note"].replace(" yang artinya “Engkau”", " “Engkau”")),
     "meaning in bare quotes"),
    ("akar-for-bentuk-dasar", "parts",
     lambda d: d["parts"][0]["steps"].__setitem__(1, d["parts"][0]["steps"][1].replace("Bentuk dasar", "Akar", 1)),
     "says 'akar'"),
    ("harakah-sign-wrong-sound", "library",
     lambda d: next(sg for sg in d["basics"][0]["signs"] if sg["term"] == "kasrah").update(sound="a", place="di atas huruf"),
     "kasrah sounds 'i'"),
    ("harakah-reminder-wrong", "terms", lambda d: term(d, "kasrah").update(hint="tanda bunyi u di atas huruf"),
     "should say 'i'"),
    ("parts-do-not-spell-word", "library", lambda d: d["parts"][0].update(drops=[]),
     "the tiles spell"),
    ("tile-translit-not-its-bytes", "library", lambda d: d["parts"][0]["tiles"][1].update(translit="rabbu"),
     "does not name the tile's bytes"),
    # --- 2026-10-12: the gloss variant ([[“nama Allah”|q:1:1:1-2]]), typed Arabic, the marked
    # lessons (word cards, ayah structure, facts) and the Kosakata prose
    ("gloss-ref-does-not-resolve", "library",
     lambda d: (concept(d["concepts"], "idhafah")["marked"].update(
         summary=concept(d["concepts"], "idhafah")["marked"]["summary"].replace("|q:1:1:1-2]]", "|q:1:1:1-9]]")),
         d["quran"].update({"1:1:1-9": d["quran"]["1:1:1-2"]})),
     "does not match the lesson content bytes of 1:1:1"),
    ("gloss-on-unquoted-surface", "library",
     lambda d: (concept(d["concepts"], "idhafah")["marked"].update(
         summary=concept(d["concepts"], "idhafah")["marked"]["summary"].replace("[[“nama Allah”|", "[[nama Allah|")),
         concept(d["concepts"], "idhafah").update(summary=concept(d["concepts"], "idhafah")["summary"].replace("“nama Allah”", "nama Allah"))),
     "'nama Allah' does not name"),
    ("gloss-half-quoted", "concepts",
     lambda d: concept(d, "idhafah").update(summary=concept(d, "idhafah")["summary"].replace("[[“nama Allah”|", "[[“nama Allah|").replace("q:1:1:1-2]],", "q:1:1:1-2]]”,")),
     "must be one quoted Indonesian gloss"),
    ("gloss-names-a-term", "concepts",
     lambda d: concept(d, "idhafah").update(summary=concept(d, "idhafah")["summary"].replace("|q:1:1:1-2]]", "|idhafah]]")),
     "names the Qur'anic words it translates"),
    ("arabic-typed-by-hand", "concepts",
     lambda d: concept(d, "idhafah").update(summary=concept(d, "idhafah")["summary"].replace(
         "[[“nama Allah”|q:1:1:1-2]]", "“nama Allah” (" + "بِسْمِ" + ")")),
     "typed Arabic"),
    ("lesson-arabic-typed-by-hand", "words",
     lambda d: d["words"]["1:7:4"].update(why=d["words"]["1:7:4"]["why"].replace("[[‘Alā|q:2:5:2]]", "‘Alā (" + "عَلَى" + ")")),
     "typed Arabic"),
    ("lesson-term-without-markup", "words",
     lambda d: d["words"]["1:7:4"].update(why=d["words"]["1:7:4"]["why"].replace("[[huruf jar]]", "huruf jar", 1)),
     "written without [[…]] markup"),
    ("lesson-marked-hand-edited", "lesson",
     lambda d: d["ayat"][6]["words"][3]["marked"].update(why=d["ayat"][6]["words"][3]["marked"]["why"].replace("|q:2:5:2]]", "|q:1:7:4/1]]")),
     "differs from the authored markup"),
    ("lesson-plain-drifted", "lesson",
     lambda d: d["ayat"][6]["words"][3].update(why=d["ayat"][6]["words"][3]["why"] + " Lagi."),
     "the plain text is not the marked text"),
    ("lesson-ref-without-bytes", "lesson", lambda d: d["quran"].pop("2:5:2"),
     "has no bytes in the lesson's quran"),
    ("lesson-part-shows-another-part", "lesson", lambda d: d["quran"].update({"1:7:4/2": d["quran"]["1:1:1/1"]}),
     "does not match the lesson content bytes of 1:7:4"),
    ("lesson-word-shows-another-word", "lesson", lambda d: d["quran"].update({"1:7:3": d["quran"]["1:7:2"]}),
     "does not match the lesson content bytes of 1:7:3"),
    ("lesson-translit-names-another-word", "lesson",
     lambda d: (d["ayat"][3]["words"][1]["marked"].update(why=d["ayat"][3]["words"][1]["marked"]["why"].replace("[[māliki|q:1:4:1]]", "[[māliki|q:1:4:2]]")),
                d["quran"].update({"1:4:2": d["quran"]["1:4:2"]})),
     "the word's transliteration is 'yaumi'"),
    ("unmarked-lesson-ships-markup", "lesson2",
     lambda d: d["ayat"][0]["words"][0].update(marked={"why": d["ayat"][0]["words"][0]["why"], "ikhtilaf": []}),
     "is not a marked lesson"),
    ("facts-overlay-names-no-fact", "facts", lambda d: d["facts"].update({"no-such-fact": {"title": "x"}}),
     "is not a fact of al-fatihah"),
    ("kosakata-marked-hand-edited", "library",
     lambda d: next(x for x in d["lexicon"] if x["id"] == "anama")["marked"].update(
         meaning=next(x for x in d["lexicon"] if x["id"] == "anama")["marked"]["meaning"].replace("|q:33:37:6]]", "|q:9:128:7]]")),
     "differs from the authored markup"),
    ("kosakata-term-without-markup", "lexicon",
     lambda d: next(x for x in d["lexicon"] if x["id"] == "ism")["ilal"][0].update(
         rule=next(x for x in d["lexicon"] if x["id"] == "ism")["ilal"][0]["rule"].replace("[[sukun|sukun]]", "sukun")),
     "written without [[…]] markup"),
    ("kosakata-pos-unmarked", "library",
     lambda d: next(x for x in d["lexicon"] if x["id"] == "ism")["marked"].update(pos="isim"),
     "differs from the authored markup"),
]


class TestGlossRules(unittest.TestCase):
    """terms.py's gloss variant, directly (the builds run q_problems on every q-ref)."""

    TOKENS = {(1, 1, 1): "بِسْمِ", (1, 1, 2): "ٱللَّهِ"}

    def tok(self, s, a, w):
        return self.TOKENS.get((s, a, w))

    def problems(self, surface, ref):
        import terms as TM
        return TM.q_problems(surface, ref, "x", {"1:1:1": "bismi", "1:1:2": "Allāhi"}, self.tok, lambda s, a, w: [])

    def test_a_quoted_gloss_resolves_and_is_not_compared_with_its_bytes(self):
        self.assertEqual(self.problems("“nama Allah”", "q:1:1:1-2"), [])

    def test_a_gloss_whose_ref_does_not_resolve(self):
        self.assertTrue(any("has fewer than 9 words" in p for p in self.problems("“nama Allah”", "q:1:1:1-9")))

    def test_an_unquoted_or_half_quoted_surface_is_no_gloss(self):
        self.assertTrue(any("does not name" in p for p in self.problems("nama Allah", "q:1:1:1-2")))
        self.assertTrue(any("one quoted Indonesian gloss" in p for p in self.problems("“nama Allah", "q:1:1:1-2")))

    def test_a_gloss_of_a_letter(self):
        self.assertTrue(any("not a letter" in p for p in self.problems("“b”", "q:1:1:1#1")))



@contextlib.contextmanager
def sandbox(kind: str | None = None, mutate=None):
    """Copies of everything validate_terms reads, with one file mutated; module paths redirected."""
    saved = {k: getattr(V, k) for k in ("TERMS", "PRONUNCIATION", "CONCEPTS", "BASICS", "PARTS", "LEXICON", "LIBRARY",
                                        "LESSON_DIR", "LESSON_AUTHORED", "SOURCES")}
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        (t / "authored").mkdir()
        (t / "content").mkdir()
        for name in ("TERMS", "PRONUNCIATION", "CONCEPTS", "BASICS", "PARTS", "LEXICON"):
            shutil.copy(saved[name], t / "authored" / saved[name].name)
            setattr(V, name, t / "authored" / saved[name].name)
        for f in saved["LESSON_AUTHORED"].glob("al-fatihah.*.json"):
            shutil.copy(f, t / "authored" / f.name)
        V.LESSON_AUTHORED = t / "authored"
        shutil.copy(saved["LIBRARY"], t / "content" / "library.json")
        V.LIBRARY = t / "content" / "library.json"
        for f in saved["LESSON_DIR"].glob("*.json"):
            if f.name != "library.json":
                shutil.copy(f, t / "content" / f.name)
        V.LESSON_DIR = t / "content"
        shutil.copy(saved["SOURCES"], t / "sources.json")
        V.SOURCES = t / "sources.json"
        if kind:
            target = {"terms": V.TERMS, "concepts": V.CONCEPTS, "parts": V.PARTS, "library": V.LIBRARY,
                      "lesson": V.LESSON_DIR / "al-fatihah.json", "lesson2": V.LESSON_DIR / "al-ikhlas.json",
                      "words": V.LESSON_AUTHORED / "al-fatihah.words.json",
                      "facts": V.LESSON_AUTHORED / "al-fatihah.facts.marked.json", "lexicon": V.LEXICON}[kind]
            data = json.loads(target.read_text(encoding="utf-8"))
            mutate(data)
            target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            # keep the pin of a mutated authored file current, so the case tests what it plants
            pin = {"words": (V.LESSON_DIR / "al-fatihah.json", "authored_words"),
                   "facts": (V.LESSON_DIR / "al-fatihah.json", "authored_facts_marked"),
                   "lexicon": (V.LIBRARY, "authored_lexicon")}.get(kind)
            if pin:
                content = json.loads(pin[0].read_text(encoding="utf-8"))
                content["data_versions"][pin[1]] = f"authored/{target.name} sha256:{V.sha256_file(target)}"
                pin[0].write_text(json.dumps(content, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            if kind == "concepts" and "stale" not in mutate.__name__:
                # keep library.json's pin of the concepts file current, so the case tests what it plants
                lib = json.loads(V.LIBRARY.read_text(encoding="utf-8"))
                lib["data_versions"]["authored_concepts"] = f"authored/library.concepts.json sha256:{V.sha256_file(V.CONCEPTS)}"
                V.LIBRARY.write_text(json.dumps(lib, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            if kind in ("terms", "parts"):
                key, f = ("authored_terms", V.TERMS) if kind == "terms" else ("authored_parts", V.PARTS)
                lib = json.loads(V.LIBRARY.read_text(encoding="utf-8"))
                lib["data_versions"][key] = f"authored/{f.name} sha256:{V.sha256_file(f)}"
                V.LIBRARY.write_text(json.dumps(lib, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        try:
            yield
        finally:
            for k, v in saved.items():
                setattr(V, k, v)


def run(no_corpus: bool) -> tuple[int, str]:
    err = io.StringIO()
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
        rc = V.main(no_corpus=no_corpus)
    return rc, err.getvalue()


class TestValidateTerms(unittest.TestCase):
    def test_clean_copies_pass(self):
        with sandbox():
            rc, out = run(NO_CORPUS)
        self.assertEqual(rc, 0, out)

    def test_planted_faults(self):
        for name, kind, mutate, want in CASES:
            if NO_CORPUS and name in NEEDS_CORPUS:
                continue
            mutate.__name__ = name
            with self.subTest(name):
                with sandbox(kind, mutate):
                    rc, out = run(NO_CORPUS)
                self.assertEqual(rc, 1, f"{name}: not caught")
                self.assertIn(want, out, f"{name}: caught, but not by the expected check:\n{out}")


def table() -> int:
    bad = 0
    with sandbox():
        rc, out = run(NO_CORPUS)
    print(f"{'clean copies':32s} {'pass' if rc == 0 else 'FAIL'}")
    if rc:
        print(out)
        bad += 1
    for name, kind, mutate, want in CASES:
        if NO_CORPUS and name in NEEDS_CORPUS:
            print(f"{name:32s} SKIPPED (needs pipeline/cache)")
            continue
        mutate.__name__ = name
        with sandbox(kind, mutate):
            rc, out = run(NO_CORPUS)
        line = next((ln.strip() for ln in out.splitlines() if want in ln), "")
        ok = rc == 1 and line
        bad += not ok
        print(f"{name:32s} {'caught' if ok else 'MISSED'}  {line[:150]}")
    gloss = unittest.TextTestRunner(stream=io.StringIO(), verbosity=0).run(
        unittest.defaultTestLoader.loadTestsFromTestCase(TestGlossRules))
    print(f"{'gloss variant rules (terms.py)':32s} {gloss.testsRun} unit checks "
          + ("pass" if gloss.wasSuccessful() else "FAIL"))
    bad += 0 if gloss.wasSuccessful() else 1
    print(f"\n{len(CASES)} planted faults; {'all caught' if not bad else f'{bad} problem(s)'}"
          + (f"; skipped without the cache: {', '.join(sorted(NEEDS_CORPUS))}" if NO_CORPUS else ""))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(table())
