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
]



@contextlib.contextmanager
def sandbox(kind: str | None = None, mutate=None):
    """Copies of everything validate_terms reads, with one file mutated; module paths redirected."""
    saved = {k: getattr(V, k) for k in ("TERMS", "PRONUNCIATION", "CONCEPTS", "BASICS", "PARTS", "LIBRARY",
                                        "LESSON_DIR", "SOURCES")}
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        (t / "authored").mkdir()
        (t / "content").mkdir()
        for name in ("TERMS", "PRONUNCIATION", "CONCEPTS", "BASICS", "PARTS"):
            shutil.copy(saved[name], t / "authored" / saved[name].name)
            setattr(V, name, t / "authored" / saved[name].name)
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
                      "lesson": V.LESSON_DIR / "al-fatihah.json"}[kind]
            data = json.loads(target.read_text(encoding="utf-8"))
            mutate(data)
            target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
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
    print(f"\n{len(CASES)} planted faults; {'all caught' if not bad else f'{bad} problem(s)'}"
          + (f"; skipped without the cache: {', '.join(sorted(NEEDS_CORPUS))}" if NO_CORPUS else ""))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(table())
