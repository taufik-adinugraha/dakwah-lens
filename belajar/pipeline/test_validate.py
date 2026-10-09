#!/usr/bin/env python3
"""Mutation tests for validate.py: each case plants one deliberate fault in a copy of the lessons
in content/ (al-fatihah.json and every other built surah), content/library.json or the app's
src/lib/content.ts / routes.ts, and asserts that validate.py fails with the expected message. The
unmutated copies must pass. Standard library only; run from belajar/pipeline:

    python3 test_validate.py          # table of faults and the message that caught each
    python3 -m unittest test_validate # the same as a unittest run

Run build_library.py and build_surah.py <slug> for every authored surah first (the copies are
taken from content/). The multi-surah cases plant their faults in the first and the last lesson
after Al-Fatihah ("second", "last"); they are reported as skipped only while no such lesson
exists (validate.py itself fails when a surah has authored input but no built lesson).
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
from common import CONTENT_DIR, CONTENT_TS, ROUTES_TS, SURAHS, load_sources, load_tanzil, require_pinned

LESSONS = {sp.slug: json.loads((CONTENT_DIR / f"{sp.slug}.json").read_text(encoding="utf-8"))
           for sp in SURAHS if (CONTENT_DIR / f"{sp.slug}.json").exists()}
SURAH = LESSONS["al-fatihah"]
LIB = json.loads((CONTENT_DIR / "library.json").read_text(encoding="utf-8"))
OTHER = [slug for slug in LESSONS if slug != "al-fatihah"]
SECOND = OTHER[0] if OTHER else None  # first lesson after Al-Fatihah (mushaf order)
LAST = OTHER[-1] if OTHER else None
TANZIL = load_tanzil(require_pinned(load_sources(), "tanzil_uthmani"))


def word(d, loc):
    return next(w for a in d["ayat"] for w in a["words"] if w["loc"] == loc)


def ayah(d, n):
    return d["ayat"][n - 1]


def rec(lib, kind, rid):
    return next(x for x in lib[kind] if x["id"] == rid)


def set_(obj, key, val):
    obj[key] = val


def rc_of(ay, reciter):
    return next(r for r in ay["recitation"] if r["reciter"] == reciter)


def foreign_concept(loc):
    """A Konsep id that does not give `loc` as an example (and the word does not list)."""
    return next(c["id"] for c in LIB["concepts"] if loc not in {e["loc"] for e in c["examples"]})


def drop_load(ts: str, slug: str) -> str:
    return "\n".join(ln for ln in ts.split("\n") if f'"{slug}")' not in ln)


def swap_slugs(ts: str) -> str:
    """routes.ts with the last two SURAH_SLUGS entries swapped."""
    a, b = OTHER[-2:] if len(OTHER) >= 2 else ("al-fatihah", SECOND)
    return ts.replace(f'"{a}"', "@@").replace(f'"{b}"', f'"{a}"').replace("@@", f'"{b}"')


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

# Multi-surah faults: planted in the first ("second") or last ("last") lesson after Al-Fatihah,
# across lesson files ("lessons": the dict of all lesson copies), or in the app's wiring.
MULTI = [
    ("ayah 1 keeps the surah-heading basmalah Tanzil prepends", "second",
     lambda d: set_(ayah(d, 1), "ar", TANZIL.verses[(d["surah"], 1)]), "ar differs from the Tanzil ayah"),
    ("a word dropped from an ayah (count vs registry/QAC)", "last",
     lambda d: ayah(d, 2)["words"].pop(), "word counts"),
    ("an ayah missing from a later surah", "last",
     lambda d: d["ayat"].pop(), "ayat are not 1.."),
    ("translation copied from Al-Fatihah 1:1", "second",
     lambda d: set_(ayah(d, 1)["translation"], "text", ayah(SURAH, 1)["translation"]["text"]),
     "not byte-identical to the cached QuranEnc text"),
    ("data_versions.quranenc pins sura 1 in another sura's lesson", "lessons",
     lambda ls: set_(ls[SECOND]["data_versions"], "quranenc", SURAH["data_versions"]["quranenc"]),
     "data_versions.quranenc does not carry the pinned sha256"),
    ("Alafasy timings replaced by Husary's", "last",
     lambda d: set_(rc_of(ayah(d, 1), "Alafasy_128kbps"), "segments",
                    copy.deepcopy(rc_of(ayah(d, 1), "Husary_Muallim_128kbps")["segments"])),
     "segments differ from the pinned quran-align entry"),
    ("recitation streams the Al-Fatihah file of the same ayah", "second",
     lambda d: set_(ayah(d, 1)["recitation"][0], "url",
                    ayah(d, 1)["recitation"][0]["url"][:-10] + "001001.mp3"), "unexpected url"),
    ("lesson file under an unregistered slug", "lessons",
     lambda ls: ls.__setitem__(SECOND + "x", ls.pop(SECOND)), "is not a surah registered in common.SURAHS"),
    ("lesson slug field names another surah", "second",
     lambda d: set_(d, "slug", "al-fatihah"), "slug 'al-fatihah' !="),
    ("authored words of a later surah changed after the build", "second",
     lambda d: set_(d["data_versions"], "authored_words", f"authored/{d['slug']}.words.json sha256:0"),
     "authored_words is stale"),
    ("word of a later surah lists a concept that does not cite it", "second",
     lambda d: word(d, f"{d['surah']}:1:1")["concepts"].append(foreign_concept(f"{d['surah']}:1:1")),
     "which does not give"),
    ("hadith with a Latin placeholder as its Arabic", "second",
     lambda d: d["hadith"].append({"citation": "Sahih al-Bukhari 5013", "ar": "TODO matn", "id": "terjemah",
                                   "grade": "sahih", "status": "draft"}), "ar must be Arabic text only"),
    ("fact basis note names a surah that has no lesson", "surah",
     lambda d: set_(next(f for f in d["facts"] if "QAC" in f["method"]), "method",
                    next(f for f in d["facts"] if "QAC" in f["method"])["method"]
                    .replace("surah 1 identik", "surah 1 dan 2 identik")), "basis note names surah [2]"),
    ("library occurrence method without the QAC basis note", "library",
     lambda l: rec(l, "lexicon", "hamd")["occurrences"].__setitem__("method", "jumlah segmen STEM di QAC"),
     "lacks the basis note"),
    ("content.ts stops loading a built lesson", "content.ts",
     lambda ts: drop_load(ts, SECOND), "src/lib/content.ts SURAHS loads"),
    ("routes.ts SURAH_SLUGS out of mushaf order", "routes.ts",
     swap_slugs, "src/lib/routes.ts SURAH_SLUGS"),
]
ALL = MUTATIONS + MULTI
NEEDS_OTHER = {"second", "last", "lessons", "content.ts", "routes.ts"}


def run_validate(lessons: dict, lib: dict, content_ts: str | None = None,
                 routes_ts: str | None = None) -> tuple[int, list[str]]:
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        for slug, d in lessons.items():
            (t / f"{slug}.json").write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
        libp, cts, rts = t / "library.json", t / "content.ts", t / "routes.ts"
        libp.write_text(json.dumps(lib, ensure_ascii=False), encoding="utf-8")
        cts.write_text(content_ts if content_ts is not None else CONTENT_TS.read_text(encoding="utf-8"),
                       encoding="utf-8")
        rts.write_text(routes_ts if routes_ts is not None else ROUTES_TS.read_text(encoding="utf-8"),
                       encoding="utf-8")
        saved = V.LESSON_DIR, V.LIBRARY, V.CONTENT_TS_PATH, V.ROUTES_TS_PATH
        V.LESSON_DIR, V.LIBRARY, V.CONTENT_TS_PATH, V.ROUTES_TS_PATH = t, libp, cts, rts
        V.fails.clear()
        try:
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                rc = V.main()
        finally:
            V.LESSON_DIR, V.LIBRARY, V.CONTENT_TS_PATH, V.ROUTES_TS_PATH = saved
        return rc, list(V.fails)


def runnable(target: str) -> bool:
    return target not in NEEDS_OTHER or bool(OTHER)


def apply(name: str):
    _, target, fn, expect = next(m for m in ALL if m[0] == name)
    lessons, lib = copy.deepcopy(LESSONS), copy.deepcopy(LIB)
    content_ts = routes_ts = None
    if target == "surah":
        fn(lessons["al-fatihah"])
    elif target == "library":
        fn(lib)
    elif target in ("second", "last"):
        fn(lessons[SECOND if target == "second" else LAST])
    elif target == "lessons":
        fn(lessons)
    elif target == "content.ts":
        content_ts = fn(CONTENT_TS.read_text(encoding="utf-8"))
    elif target == "routes.ts":
        routes_ts = fn(ROUTES_TS.read_text(encoding="utf-8"))
    else:
        raise ValueError(target)
    rc, fails = run_validate(lessons, lib, content_ts, routes_ts)
    hit = next((f for f in fails if expect in f), None)
    return rc, fails, hit


class TestValidateMutations(unittest.TestCase):
    def test_clean_copies_pass(self):
        rc, fails = run_validate(copy.deepcopy(LESSONS), copy.deepcopy(LIB))
        self.assertEqual((rc, fails), (0, []))

    def test_each_fault_is_caught(self):
        for name, target, *_ in ALL:
            with self.subTest(fault=name):
                if not runnable(target):
                    self.skipTest("no lesson after Al-Fatihah in content/")
                rc, fails, hit = apply(name)
                self.assertEqual(rc, 1, f"{name}: validate passed")
                self.assertIsNotNone(hit, f"{name}: failed, but not with the expected message: {fails[:3]}")


if __name__ == "__main__" and sys.argv[1:] == []:
    rc0, f0 = run_validate(copy.deepcopy(LESSONS), copy.deepcopy(LIB))
    print(f"lessons: {', '.join(LESSONS)}; multi-surah faults go into {SECOND} (second) and {LAST} (last)")
    print(f"clean copies: exit {rc0}, {len(f0)} failures" + "".join(f"\n  - {f}" for f in f0[:10]))
    missed = skipped = 0
    for i, (name, target, _, _) in enumerate(ALL, 1):
        if not runnable(target):
            skipped += 1
            print(f"{i:2d}. SKIPPED [{target}] {name} (no lesson after Al-Fatihah in content/)")
            continue
        rc, fails, hit = apply(name)
        ok = rc == 1 and hit
        missed += not ok
        print(f"{i:2d}. {'CAUGHT' if ok else 'MISSED'} [{target}] {name}\n      -> {hit or fails[:2]}")
    ran = len(ALL) - skipped
    print(f"\n{ran - missed}/{ran} faults caught ({len(MUTATIONS)} single-lesson/library + {len(MULTI)} multi-surah"
          f"{f', {skipped} skipped' if skipped else ''}); clean copies {'pass' if rc0 == 0 and not f0 else 'FAIL'}")
    sys.exit(1 if missed or rc0 or f0 else 0)
elif __name__ == "__main__":
    unittest.main()
