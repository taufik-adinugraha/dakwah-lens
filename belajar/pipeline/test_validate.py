#!/usr/bin/env python3
"""Mutation tests for validate.py: each case plants one deliberate fault in a copy of
content/al-fatihah.json or content/library.json and asserts that validate.py fails with the
expected message. The unmutated copies must pass. Standard library only; run from belajar/pipeline:

    python3 test_validate.py          # table of faults and the message that caught each
    python3 -m unittest test_validate # the same as a unittest run

Run build_library.py and build_fatihah.py first (the copies are taken from content/).
"""
from __future__ import annotations

import contextlib
import copy
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

import validate as V
from common import CONTENT_DIR

SURAH = json.loads((CONTENT_DIR / "al-fatihah.json").read_text(encoding="utf-8"))
LIB = json.loads((CONTENT_DIR / "library.json").read_text(encoding="utf-8"))


def word(d, loc):
    return next(w for a in d["ayat"] for w in a["words"] if w["loc"] == loc)


def ayah(d, n):
    return d["ayat"][n - 1]


def rec(lib, kind, rid):
    return next(x for x in lib[kind] if x["id"] == rid)


def set_(obj, key, val):
    obj[key] = val


# (name, file the fault goes into, mutation, substring the failure message must contain)
MUTATIONS = [
    # --- the lesson's links into the library
    ("lemma_id names no lexeme", "surah",
     lambda d: set_(word(d, "1:1:2"), "lemma_id", "no-such-lemma"), "is not a lexicon id"),
    ("lemma_id names the wrong lexeme", "surah",
     lambda d: set_(word(d, "1:1:2"), "lemma_id", "rabb"), "but the word's QAC lemma/root is"),
    ("lemma_id dropped from a word with a lemma", "surah",
     lambda d: set_(word(d, "1:4:1"), "lemma_id", None), "has a QAC lemma but no lemma_id"),
    ("word concept id unknown", "surah",
     lambda d: word(d, "1:2:1")["concepts"].append("isim-isyarah"), "'isim-isyarah' is not a concept id"),
    ("word drops a concept it is an example of", "surah",
     lambda d: set_(word(d, "1:1:2"), "concepts", []), "does not list this concept"),
    ("word lists a concept that does not cite it", "surah",
     lambda d: word(d, "1:3:1")["concepts"].append("badal"), "which does not give 1:3:1 as an example"),
    ("word concept id has uppercase (schema regex)", "surah",
     lambda d: set_(word(d, "1:1:3"), "concepts", ["Naat"]), "does not match schema.ts"),
    ("word role removed", "surah",
     lambda d: set_(word(d, "1:5:2"), "role", None), "word 1:5:2: no role"),
    # --- structure
    ("structure group index outside the ayah", "surah",
     lambda d: set_(ayah(d, 3)["structure"]["groups"][0], "words", [1, 3]), "within 1..2"),
    ("structure group indices out of reading order", "surah",
     lambda d: set_(ayah(d, 4)["structure"]["groups"][0], "words", [3, 2, 1]), "must be ascending"),
    ("structure group of one word (schema min 2)", "surah",
     lambda d: set_(ayah(d, 6)["structure"]["groups"][0], "words", [2]), "< schema.ts min(2)"),
    ("structure group concept unknown", "surah",
     lambda d: set_(ayah(d, 5)["structure"]["groups"][0], "concept", "taqdim-mafuul"),
     "concept 'taqdim-mafuul' is not a concept id"),
    ("structure missing on an ayah", "surah",
     lambda d: ayah(d, 4).pop("structure"), "ayah 1:4: no structure"),
    ("structure status not draft", "surah",
     lambda d: set_(ayah(d, 2)["structure"], "status", "reviewed"), "structure: status 'reviewed'"),
    ("structure required key missing", "surah",
     lambda d: ayah(d, 7)["structure"].pop("summary"), "required key 'summary' missing"),
    ("structure source without kitab", "surah",
     lambda d: set_(ayah(d, 1)["structure"], "sources", [{"ref": "hlm. 9"}]), "required key 'kitab' missing"),
    ("structure label quotes Arabic not in Tanzil", "surah",
     lambda d: set_(ayah(d, 2)["structure"]["groups"][0], "label", "al-ḥamdu «الحمد لله» mubtada'"),
     "is not a byte-exact substring of Tanzil"),
    ("structure file changed after the build", "surah",
     lambda d: set_(d["data_versions"], "authored_structure", "authored/al-fatihah.structure.json sha256:0"),
     "authored_structure is stale"),
    # --- library: references
    ("concept example loc is in no lesson", "library",
     lambda l: set_(rec(l, "concepts", "naat")["examples"][0], "loc", "1:8:1"),
     "example 1:8:1 is not a word of any lesson"),
    ("concept related id unknown", "library",
     lambda l: rec(l, "concepts", "naat")["related"].append("sifat"), "related 'sifat' is not another concept id"),
    ("root lists an unknown lemma id", "library",
     lambda l: rec(l, "roots", "r-hh-m")["lemmas"].append("rahmah"), "lemma 'rahmah' is not a lexicon id"),
    ("root stops listing one of its lexemes", "library",
     lambda l: rec(l, "roots", "r-hh-m")["lemmas"].remove("rahim"), "lexicon[rahim]: listed by 0 roots"),
    ("root lists a lexeme of another root", "library",
     lambda l: rec(l, "roots", "r-hh-m")["lemmas"].append("hamd"), "lemma 'hamd' has root"),
    ("lexeme id used twice", "library",
     lambda l: set_(rec(l, "lexicon", "rahim"), "id", "rahman"), "id 'rahman' used twice"),
    # --- library: sources, status, schema
    ("lexeme without sources", "library",
     lambda l: set_(rec(l, "lexicon", "hamd"), "sources", []), "lexicon[hamd]: no sources"),
    ("lexeme status not draft", "library",
     lambda l: set_(rec(l, "lexicon", "hamd"), "status", "reviewed"), "status 'reviewed' (must be draft)"),
    ("concept status outside the enum", "library",
     lambda l: set_(rec(l, "concepts", "idhafah"), "status", "approved"), "'approved' not in schema.ts enum"),
    ("concept kind outside the enum", "library",
     lambda l: set_(rec(l, "concepts", "idhafah"), "kind", "balaghah"), "'balaghah' not in schema.ts enum"),
    ("concept with five paragraphs (schema max 4)", "library",
     lambda l: rec(l, "concepts", "idhafah")["explanation"].extend(["Paragraf tambahan yang cukup panjang."] * 3),
     "> schema.ts max(4)"),
    ("concept key misspelt", "library",
     lambda l: set_(rec(l, "concepts", "idhafah"), "titel", "Idhafah"), "key 'titel' is not in schema.ts"),
    ("root with one letter (schema min 2)", "library",
     lambda l: set_(rec(l, "roots", "r-hh-m"), "letters", ["ر"]), "< schema.ts min(2)"),
    ("Darwisy cited under another title", "library",
     lambda l: rec(l, "lexicon", "hamd")["sources"].append({"kitab": "Darwish, I'rab al-Qur'an", "ref": "1/14"}),
     "Darwisy cited as"),
    # --- library: QAC-derived values and typed Arabic
    ("lemma_ar not the QAC lemma (a harakah changed)", "library",
     lambda l: set_(rec(l, "lexicon", "hamd"), "lemma_ar", rec(l, "lexicon", "hamd")["lemma_ar"].replace("ْ", "َ")),
     "is not byte-identical to any QAC 0.4 lemma"),
    ("lexeme root letters not QAC's", "library",
     lambda l: set_(rec(l, "lexicon", "hamd"), "root", ["ح", "م", "ل"]), "!= QAC 0.4 root"),
    ("lexeme occurrence count off by one", "library",
     lambda l: rec(l, "lexicon", "hamd")["occurrences"].__setitem__("count", rec(l, "lexicon", "hamd")["occurrences"]["count"] + 1),
     "occurrences"),
    ("root occurrence count off by one", "library",
     lambda l: rec(l, "roots", "r-hh-m")["occurrences"].__setitem__("count", rec(l, "roots", "r-hh-m")["occurrences"]["count"] + 1),
     "occurrences.count"),
    ("tashrif form with tatweel", "library",
     lambda l: set_(rec(l, "lexicon", "istaana")["tashrif"]["forms"][0], "ar", "اِسْتَعَـانَ"), "U+0640"),
    ("tashrif form with alif wasla (Uthmani)", "library",
     lambda l: set_(rec(l, "lexicon", "istaana")["tashrif"]["forms"][0], "ar", "ٱسْتَعَانَ"), "U+0671"),
    ("tashrif form with superscript alif", "library",
     lambda l: set_(rec(l, "lexicon", "istaana")["tashrif"]["forms"][1], "ar", "يَسْتَعِيٰنُ"), "U+0670"),
    ("tashrif form with an empty side of the comma", "library",
     lambda l: set_(rec(l, "lexicon", "malik")["tashrif"]["forms"][2], "ar", "مِلْكًا،"), "empty or letterless form"),
    ("i'lal form in Latin letters", "library",
     lambda l: set_(rec(l, "lexicon", "istaana")["ilal"][0], "to", "nasta'inu"), "has an empty or letterless form"),
    ("Arabic in bab outside the typed set", "library",
     lambda l: set_(rec(l, "lexicon", "istaana")["tashrif"], "bab", "wazan ٱسْتَفْعَلَ"), "tashrif.bab"),
    # --- library: prose
    ("concept prose with an unquoted Arabic word", "library",
     lambda l: rec(l, "concepts", "idhafah")["explanation"].__setitem__(0, "Contoh: بِسْمِ اللَّهِ adalah idhafah."),
     "unquoted Arabic"),
    ("lexeme prose with ASCII spelling of an SKB word", "library",
     lambda l: set_(rec(l, "lexicon", "istaana"), "meaning", "memohon pertolongan, seperti pada nasta'inu."),
     "is an ASCII spelling of the transliteration"),
    ("library concepts file changed after the build", "library",
     lambda l: set_(l["data_versions"], "authored_concepts", "authored/library.concepts.json sha256:0"),
     "authored_concepts is stale"),
    # --- library vs lesson agreement and record sanity (added after the verifier's D2 report)
    ("lexeme pos disagrees with its word cards", "library",
     lambda l: set_(rec(l, "lexicon", "ism"), "pos", "fi'il"), "does not agree with lexeme 'ism'"),
    ("word pos override disagrees with its lexeme (the D2 case)", "surah",
     lambda d: set_(word(d, "1:2:4"), "pos", "isim (isim jam')"), "does not agree with lexeme 'alamin'"),
    ("concept related repeats an id", "library",
     lambda l: rec(l, "concepts", "naat")["related"].append("idhafah"), "related repeats an id"),
    ("i'lal whose before and after are the same", "library",
     lambda l: set_(rec(l, "lexicon", "istaana")["ilal"][0], "to", rec(l, "lexicon", "istaana")["ilal"][0]["from"]),
     "from and to are the same form"),
    # --- an existing check, to show it still runs
    ("word Arabic not the Tanzil token (existing check 1)", "surah",
     lambda d: set_(word(d, "1:2:1"), "ar", word(d, "1:2:1")["ar"][:-1]), "is not Tanzil token"),
]


def run_validate(surah: dict, lib: dict) -> tuple[int, list[str]]:
    with tempfile.TemporaryDirectory() as tmp:
        out, libp = Path(tmp) / "al-fatihah.json", Path(tmp) / "library.json"
        out.write_text(json.dumps(surah, ensure_ascii=False), encoding="utf-8")
        libp.write_text(json.dumps(lib, ensure_ascii=False), encoding="utf-8")
        saved = V.OUT, V.LIBRARY
        V.OUT, V.LIBRARY = out, libp
        V.fails.clear()
        try:
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                rc = V.main()
        finally:
            V.OUT, V.LIBRARY = saved
        return rc, list(V.fails)


def apply(name: str):
    _, target, fn, expect = next(m for m in MUTATIONS if m[0] == name)
    surah, lib = copy.deepcopy(SURAH), copy.deepcopy(LIB)
    fn(surah if target == "surah" else lib)
    rc, fails = run_validate(surah, lib)
    hit = next((f for f in fails if expect in f), None)
    return rc, fails, hit


class TestValidateMutations(unittest.TestCase):
    def test_clean_copies_pass(self):
        rc, fails = run_validate(copy.deepcopy(SURAH), copy.deepcopy(LIB))
        self.assertEqual((rc, fails), (0, []))

    def test_each_fault_is_caught(self):
        for name, *_ in MUTATIONS:
            with self.subTest(fault=name):
                rc, fails, hit = apply(name)
                self.assertEqual(rc, 1, f"{name}: validate passed")
                self.assertIsNotNone(hit, f"{name}: failed, but not with the expected message: {fails[:3]}")


if __name__ == "__main__" and sys.argv[1:] == []:
    rc0, f0 = run_validate(copy.deepcopy(SURAH), copy.deepcopy(LIB))
    print(f"clean copies: exit {rc0}, {len(f0)} failures")
    missed = 0
    for i, (name, target, _, _) in enumerate(MUTATIONS, 1):
        rc, fails, hit = apply(name)
        ok = rc == 1 and hit
        missed += not ok
        print(f"{i:2d}. {'CAUGHT' if ok else 'MISSED'} [{target}] {name}\n      -> {hit or fails[:2]}")
    print(f"\n{len(MUTATIONS) - missed}/{len(MUTATIONS)} faults caught; clean copies "
          f"{'pass' if rc0 == 0 and not f0 else 'FAIL'}")
    sys.exit(1 if missed or rc0 or f0 else 0)
elif __name__ == "__main__":
    unittest.main()
