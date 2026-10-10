#!/usr/bin/env python3
"""Mutation tests for validate_waris.py: each case plants one deliberate fault in a copy of
content/waris/{dalil.json, dalil-gaps.json, dalil-provenance.json, rules.json} (or in a copy of a
docs research file, of the engine registry source, or in the validator's acknowledged-defect list)
and asserts that validate_waris.py fails with the expected message. The unmutated copies must
pass, with and without the research-phase parity check, and in --rules-only mode. Standard
library only; run from belajar/pipeline:

    python3 test_validate_waris.py              # table of faults and the message that caught each
    python3 -m unittest test_validate_waris     # the same as a unittest run
    python3 test_validate_waris.py --no-corpus  # CI (api/data and pipeline/cache absent): validate_waris
                                                # runs with --no-corpus; the faults only a corpus check can
                                                # catch (NEEDS_CORPUS) are listed as skipped, by name
    WARIS_NO_CORPUS=1 python3 -m unittest test_validate_waris   # the same, as a unittest run

A full (corpus) run also proves the NEEDS_CORPUS partition exact: every other fault is caught by
the --no-corpus validator too, and no NEEDS_CORPUS fault is.

Run build_waris.py first (the copies are taken from content/waris/).
"""
from __future__ import annotations

import contextlib
import copy
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

import validate_waris as V

NO_CORPUS = "--no-corpus" in sys.argv[1:] or os.environ.get("WARIS_NO_CORPUS") == "1"

DALIL_BYTES = V.DALIL.read_bytes()
VEC_BYTES = V.VECTORS.read_bytes()
DALIL = json.loads(DALIL_BYTES)
GAPS = json.loads(V.GAPS.read_text(encoding="utf-8"))
PROV = json.loads(V.PROV.read_text(encoding="utf-8"))
RULES = json.loads(V.RULES.read_text(encoding="utf-8"))
REGISTRY_TEXT = V.REGISTRY_TS.read_text(encoding="utf-8")
REAL_DOCS = (V.DOCS_DALIL, V.DOCS_VECTORS)


def rec(data, rid):
    return next(r for r in data if r["id"] == rid)


def set_(obj, key, val):
    obj[key] = val


def drop(data, rid):
    data.remove(rec(data, rid))


def source_ar(fname, key):
    C = V.corpus()
    return (C["fiqh"].get(fname) or C["tafsir"][fname])[key]["ar"]


def shift_start(r, src, by):
    a, b = r["char_range"]
    r["char_range"] = [a + by, b]
    r["ar"] = V.shown_excerpt(src, a + by, b, r.get("omit", []), r.get("source_truncated", False))


def shift_end(r, src, by):
    a, b = r["char_range"]
    r["char_range"] = [a, b + by]
    r["ar"] = V.shown_excerpt(src, a, b + by, r.get("omit", []), r.get("source_truncated", False))


def cut_real_words(r, src):
    """Widen an omit span 30 characters back into the kitab's own words, ar re-cut to match."""
    a, b = r["char_range"]
    x, y = r["omit"][0]
    r["omit"] = [[x - 30, y]] + r["omit"][1:]
    r["ar"] = V.shown_excerpt(src, a, b, r["omit"], False)


def mark_truncated(r):
    r["source_truncated"] = True
    r["ar"] = r["ar"] + " " + V.ELISION


def first_footnote_item(r):
    """Extend a Bulugh matn span to 10 characters past the start of the editor's footnote."""
    ar = r["ar"]
    r["ar_matn_and_ibn_hajar_attribution"] = ar[:len(ar) - len(r["ar_tahqiq_footnote"]) + 10]


def rename_muslim(d):
    r = rec(d, "H-MUSLIM-1615a")
    r["id"], r["citation"] = "H-MUSLIM-1615b", "Sahih Muslim 1615b"


def bump_sha(prov, rid, i, key="sha256"):
    prov["records"][rid]["copies"][i][key] = "0" * 64


def span_plus_one(prov, rid):
    e = prov["records"][rid]["copies"][0]
    e["span"] = [e["span"][0], e["span"][1] + 1]


def forget_markers(_):
    V.KNOWN_INTEXT_MARKERS = set()


def note(rules, rid):
    return next(n for n in rules["rules"] if n["rule_id"] == rid)


def drop_note(rules, rid):
    rules["rules"].remove(note(rules, rid))


def strip_basis(rules, rid):
    n = note(rules, rid)
    n["dalil"], n["legal"] = [], []


def dodge_with_method(rules, rid):
    n = note(rules, rid)
    n["dalil"], n["legal"] = [], []
    n["method"] = {"summary_id": "Ini cara menghitung, bukan hukum tersendiri, jadi tanpa dalil.",
                   "source_doc": "docs/waris-research/engine.md §9.3"}


def add_registry_note(text):
    marker = '"wasiat_ahli_waris_diabaikan",'
    assert marker in text
    return text.replace(marker, marker + '\n  "catatan_baru",', 1)


# (name, target, mutation, substring the failure message must contain)
# targets: dalil / gaps / prov = that file; docs_dalil / docs_vectors = the docs research copy;
# config = the validator's acknowledged-defect list.
MUTATIONS = [
    # --- Qur'an bytes
    ("Qur'an Arabic: one fathah dropped", "dalil",
     lambda d: set_(rec(d, "Q-4-11"), "ar", rec(d, "Q-4-11")["ar"].replace("َ", "", 1)), "is not the Tanzil line"),
    ("Qur'an Arabic taken from quran.json instead of Tanzil", "dalil",
     lambda d: set_(rec(d, "Q-4-12"), "ar", rec(d, "Q-4-12")["ar_quran_json"]), "is not the Tanzil line"),
    ("QuranEnc translation edited (gap ayah)", "gaps",
     lambda g: rec(g, "Q-33-4")["translations"]["id_quranenc_indonesian_affairs"].__setitem__(
         "text", rec(g, "Q-33-4")["translations"]["id_quranenc_indonesian_affairs"]["text"].replace("anak angkatmu", "anak asuhmu")),
     "QuranEnc translation/footnotes"),
    ("QuranEnc footnotes dropped", "dalil",
     lambda d: rec(d, "Q-4-11")["translations"]["id_quranenc_indonesian_affairs"].__setitem__("footnotes", ""),
     "QuranEnc translation/footnotes"),
    # --- hadith bytes and numbering
    ("Bukhari Arabic truncated", "dalil",
     lambda d: set_(rec(d, "H-BUKHARI-6732"), "ar", rec(d, "H-BUKHARI-6732")["ar"][:-5]),
     "not byte-identical to api/data/bukhari.json"),
    ("Muslim canonical number with the wrong letter", "dalil", rename_muslim, "canonical number is 1615a"),
    ("Muslim in-house Indonesian edited", "dalil",
     lambda d: rec(d, "H-MUSLIM-1614")["translations"]["id"].__setitem__(
         "text", rec(d, "H-MUSLIM-1614")["translations"]["id"]["text"] + " (diringkas)"), "en/id translation"),
    ("Bulugh shown span runs on into the editor footnote", "dalil",
     lambda d: set_(rec(d, "H-BULUGH-1107"), "ar_matn_and_ibn_hajar_attribution", rec(d, "H-BULUGH-1107")["ar"]),
     "overlap"),
    ("Bulugh shown span holds the first footnote item", "gaps",
     lambda g: first_footnote_item(rec(g, "H-BULUGH-649")), "contains an editor footnote item"),
    ("Bulugh in-text footnote marker no longer acknowledged", "config", forget_markers,
     "carries an editor in-text footnote marker"),
    ("Bulugh grade word not in the tahqiq footnote", "dalil",
     lambda d: rec(d, "H-BULUGH-1101")["grades_from_tahqiq_footnotes"][0].__setitem__("text", "متواتر"),
     "is not a substring of the tahqiq footnote"),
    # --- excerpt spans
    ("kitab excerpt starts one letter into a word", "dalil",
     lambda d: shift_start(rec(d, "F-FQARIB-116-heirs"), source_ar("fath-al-qarib.json", "116"), 1),
     "does not sit on word boundaries"),
    ("gap excerpt ends one letter short of a word end", "gaps",
     lambda g: shift_end(rec(g, "F-FSUNNAH-864-takharuj"), source_ar("fiqh-as-sunnah.json", "864"), -1),
     "does not sit on word boundaries"),
    ("tafsir excerpt text edited, char_range unchanged", "dalil",
     lambda d: set_(rec(d, "T-IK-4-11-dayn"), "ar", rec(d, "T-IK-4-11-dayn")["ar"].replace("الدين", "الدَّين", 1)),
     "ar != source[char_range]"),
    ("running head left inside a kitab excerpt", "dalil",
     lambda d: set_(rec(d, "F-FQARIB-117-furudh"), "ar", rec(d, "F-FQARIB-117-furudh")["ar"].replace(V.ELISION, V.RUNNING_HEADS[0], 1)),
     "carries the printed edition's running head"),
    ("page-break digit run inside a kitab excerpt", "dalil",
     lambda d: set_(rec(d, "F-FMUIN-35-awl"), "ar", rec(d, "F-FMUIN-35-awl")["ar"].replace(V.ELISION, V.ELISION + " " + "0" * 33, 1)),
     "digit run of 33 digits"),
    ("omit span widened into the kitab's own words", "dalil",
     lambda d: cut_real_words(rec(d, "F-FMUIN-35-awl"), source_ar("fath-al-muin.json", "35")), "is not a running head"),
    ("excerpt marked source_truncated in the middle of its record", "dalil",
     lambda d: mark_truncated(rec(d, "F-FQARIB-116-asabah")), "not at the end of the source record"),
    ("section pointer char_count off by one", "dalil",
     lambda d: set_(rec(d, "S-AL-UMM-556"), "char_count", rec(d, "S-AL-UMM-556")["char_count"] + 1),
     "anchor/title/qism/char_count disagree"),
    # --- prose
    ("Arabic word in an Indonesian gist", "dalil",
     lambda d: set_(rec(d, "Q-4-7"), "gist_id", rec(d, "Q-4-7")["gist_id"] + " (نصيب)"),
     "Arabic script in prose field 'gist_id'"),
    ("Arabic honorific sign in a rule statement", "dalil",
     lambda d: set_(rec(d, "R-parents"), "statement_id", rec(d, "R-parents")["statement_id"] + " Nabi ﷺ"),
     "Arabic script in prose field 'statement_id'"),
    ("Arabic in a gap record's text", "gaps",
     lambda g: set_(rec(g, "G-E3-first-awl-umar"), "corpus_has", "Fiqh as-Sunnah 852: وروي"),
     "Arabic script in prose field 'corpus_has'"),
    # --- references and the plan §8 gap list
    ("rule names an unknown record", "dalil",
     lambda d: rec(d, "R-awl")["supporting"].append("F-NOPE"), "is unknown in dalil.json"),
    ("external gap record removed", "gaps", lambda g: drop(g, "G-E4-funeral-first"), "G-E4-funeral-first missing"),
    ("extracted gap ayah removed", "gaps", lambda g: drop(g, "Q-33-4"), "Q-33-4 missing"),
    ("gap record id collides with a dalil.json id", "gaps",
     lambda g: set_(rec(g, "G-E7-learn-faraid"), "id", "R-learn-faraid"), "used twice"),
    ("extracted record marked reviewed", "gaps",
     lambda g: set_(rec(g, "H-BULUGH-649"), "status", "reviewed"), "must be draft"),
    ("would_ground names an unknown rule", "gaps",
     lambda g: rec(g, "T-IK-4-11-jahiliyyah")["would_ground"].append("R-nope"), "would_ground names unknown rule"),
    # --- provenance
    ("provenance hash of the source record changed", "prov",
     lambda p: bump_sha(p, "H-BUKHARI-6732", 0), "sha256 of the source record field differs"),
    ("provenance entry missing for an excerpt", "prov",
     lambda p: p["records"].pop("F-FMUIN-35-awl"), "no provenance entry"),
    ("provenance span one character longer", "prov",
     lambda p: span_plus_one(p, "F-ALUMM-572"), "is not the provenance-named source bytes slice"),
    ("provenance copied_sha256 wrong", "prov",
     lambda p: bump_sha(p, "Q-60-8", 2, "copied_sha256"), "copied_sha256 != sha256 of the record's bytes"),
    # --- META pins and research-phase parity
    ("META names an api/data hash the corpus no longer has", "dalil",
     lambda d: set_(d[0]["sources"]["bukhari.json"], "sha256", "f" * 64), "the corpus changed since the build"),
    ("META QuranEnc pin differs from sources.json", "dalil",
     lambda d: d[0]["sources"]["quranenc"]["sha256"].__setitem__("4", "0" * 64), "QuranEnc sura 4 sha256"),
    ("docs dalil.json differs from the belajar copy", "docs_dalil",
     lambda b: b.replace(b"Tanzil Project", b"Tanzil project", 1), "parity: belajar/content/waris/dalil.json"),
    ("docs test-vectors.json differs from the belajar copy", "docs_vectors",
     lambda b: b + b" ", "parity: belajar/content/waris/test-vectors.json"),
    # --- RuleNotes (rules.json) against the engine registry, the dalil files and legal_sources
    ("RuleNote missing for an engine rule id", "rules", lambda r: drop_note(r, "aul"),
     "engine rule id aul has no RuleNote"),
    ("RuleNote for an id the registry lacks", "rules",
     lambda r: set_(note(r, "fardh.suami_1_2"), "rule_id", "fardh.paman_1_6"), "is not in the engine registry"),
    ("two RuleNotes for one rule id", "rules", lambda r: r["rules"].append(copy.deepcopy(note(r, "aul"))),
     "has more than one RuleNote"),
    ("registry gains a note id that has no RuleNote", "registry", add_registry_note,
     "catatan.catatan_baru has no RuleNote"),
    ("RuleNote cites an unknown dalil id", "rules", lambda r: note(r, "fardh.ibu_1_3")["dalil"].append("Q-4-99"),
     "names unknown dalil record 'Q-4-99'"),
    ("RuleNote cites a rule record as its dalil", "rules", lambda r: note(r, "aul")["dalil"].append("R-awl"),
     "dalil must cite an evidence or gap record"),
    ("RuleNote cites a section pointer (no text) as its dalil", "rules",
     lambda r: note(r, "musytarakah")["dalil"].append("S-AL-UMM-559"), "dalil must cite an evidence or gap record"),
    ("RuleNote with neither dalil nor legal source", "rules", lambda r: strip_basis(r, "fardh.suami_1_2"),
     "has no dalil and no legal source"),
    ("method block used to dodge the dalil requirement", "rules", lambda r: dodge_with_method(r, "tashih"),
     "a method block is allowed only on"),
    ("RuleNote marked reviewed before any sign-off", "rules", lambda r: set_(note(r, "aul"), "status", "reviewed"),
     "must be draft"),
    ("Arabic word in a RuleNote summary", "rules",
     lambda r: set_(note(r, "aul"), "summary_id", note(r, "aul")["summary_id"] + " (عول)"),
     "Arabic script in summary_id"),
    ("paraphrase dressed as a quotation", "rules",
     lambda r: set_(note(r, "asabah.bin_nafs"), "summary_id", 'Nabi bersabda "berikan sisa kepada laki-laki terdekat".'),
     "quotation marks"),
    ("ALL-CAPS emphasis in a summary", "rules",
     lambda r: set_(note(r, "mani.anak_tiri"), "summary_id", note(r, "mani.anak_tiri")["summary_id"].replace("tidak", "TIDAK", 1)),
     "ALL-CAPS words"),
    ("gap-only note that does not say the source is pending", "rules",
     lambda r: set_(note(r, "akdariyyah"), "summary_id", "Kasus khusus ketika ahli warisnya tepat suami, ibu, kakek, dan satu saudara perempuan."),
     "does not say the source is pending"),
    ("legal cite names an unknown legal source", "rules",
     lambda r: note(r, "khi.pengganti")["legal"][0].__setitem__("source", "khi-2099"), "unknown legal source"),
    ("rules.json edited by hand (drift from the authored file)", "rules",
     lambda r: set_(note(r, "aul"), "title_id", note(r, "aul")["title_id"] + " (diedit)"),
     "differs from pipeline/authored/waris.rules.json"),
]

# Faults that only a corpus check (api/data, pipeline/cache) catches with the expected message, or
# whose mutation reads the corpus itself. Skipped under --no-corpus; a full run checks the list exact.
NEEDS_CORPUS = {
    "Qur'an Arabic: one fathah dropped",
    "Qur'an Arabic taken from quran.json instead of Tanzil",
    "QuranEnc translation edited (gap ayah)",
    "QuranEnc footnotes dropped",
    "Bukhari Arabic truncated",
    "Muslim canonical number with the wrong letter",
    "Muslim in-house Indonesian edited",
    "Bulugh shown span runs on into the editor footnote",
    "Bulugh shown span holds the first footnote item",
    "Bulugh in-text footnote marker no longer acknowledged",
    "Bulugh grade word not in the tahqiq footnote",
    "kitab excerpt starts one letter into a word",
    "gap excerpt ends one letter short of a word end",
    "tafsir excerpt text edited, char_range unchanged",
    "omit span widened into the kitab's own words",
    "excerpt marked source_truncated in the middle of its record",
    "section pointer char_count off by one",
    "provenance hash of the source record changed",
    "META names an api/data hash the corpus no longer has",
}
assert NEEDS_CORPUS <= {m[0] for m in MUTATIONS}, "NEEDS_CORPUS names a fault that is not in MUTATIONS"


def run_validate(dalil, gaps, prov, dalil_bytes: bytes | None = None, docs_dalil: bytes | None = None,
                 docs_vectors: bytes | None = None, rules=None, registry_text: str | None = None,
                 rules_only: bool = False, no_corpus: bool | None = None,
                 api_data: Path | None = None) -> tuple[int, list[str]]:
    if no_corpus is None:
        no_corpus = NO_CORPUS
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        paths = {k: t / f"{k}.json" for k in ("dalil", "gaps", "prov", "vectors", "docs_dalil", "docs_vectors", "rules")}
        paths["registry"] = t / "registry.ts"
        paths["rules"].write_text(json.dumps(RULES if rules is None else rules, ensure_ascii=False, indent=1),
                                  encoding="utf-8")
        paths["registry"].write_text(REGISTRY_TEXT if registry_text is None else registry_text, encoding="utf-8")
        paths["dalil"].write_bytes(dalil_bytes if dalil_bytes is not None else
                                   json.dumps(dalil, ensure_ascii=False, indent=1).encode("utf-8"))
        paths["gaps"].write_text(json.dumps(gaps, ensure_ascii=False), encoding="utf-8")
        paths["prov"].write_text(json.dumps(prov, ensure_ascii=False), encoding="utf-8")
        paths["vectors"].write_bytes(VEC_BYTES)
        if docs_dalil is not None:
            paths["docs_dalil"].write_bytes(docs_dalil)
        if docs_vectors is not None:
            paths["docs_vectors"].write_bytes(docs_vectors)
        saved = (V.DALIL, V.GAPS, V.PROV, V.VECTORS, V.DOCS_DALIL, V.DOCS_VECTORS, V.KNOWN_INTEXT_MARKERS,
                 V.RULES, V.REGISTRY_TS, V.API_DATA)
        V.DALIL, V.GAPS, V.PROV, V.VECTORS = paths["dalil"], paths["gaps"], paths["prov"], paths["vectors"]
        V.RULES, V.REGISTRY_TS = paths["rules"], paths["registry"]
        V.DOCS_DALIL = paths["docs_dalil"] if docs_dalil is not None else None
        V.DOCS_VECTORS = paths["docs_vectors"] if docs_vectors is not None else None
        if api_data is not None:
            V.API_DATA = api_data
        V.fails.clear()
        try:
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                rc = V.main(rules_only=rules_only, no_corpus=no_corpus)
        finally:
            (V.DALIL, V.GAPS, V.PROV, V.VECTORS, V.DOCS_DALIL, V.DOCS_VECTORS, V.KNOWN_INTEXT_MARKERS,
             V.RULES, V.REGISTRY_TS, V.API_DATA) = saved
        return rc, list(V.fails)


def apply(name: str, no_corpus: bool | None = None):
    _, target, fn, expect = next(m for m in MUTATIONS if m[0] == name)
    dalil, gaps, prov = copy.deepcopy(DALIL), copy.deepcopy(GAPS), copy.deepcopy(PROV)
    kw: dict = {"no_corpus": no_corpus}
    if target == "dalil":
        fn(dalil)
    elif target == "gaps":
        fn(gaps)
    elif target == "prov":
        fn(prov)
    elif target == "docs_dalil":
        kw.update(dalil_bytes=DALIL_BYTES, docs_dalil=fn(DALIL_BYTES))
    elif target == "docs_vectors":
        kw.update(dalil_bytes=DALIL_BYTES, docs_dalil=DALIL_BYTES, docs_vectors=fn(VEC_BYTES))
    elif target == "rules":
        rules = copy.deepcopy(RULES)
        fn(rules)
        kw.update(rules=rules, rules_only=True)
    elif target == "registry":
        kw.update(registry_text=fn(REGISTRY_TEXT), rules_only=True)
    if target == "config":
        saved = V.KNOWN_INTEXT_MARKERS
        try:
            fn(V)
            rc, fails = run_validate(dalil, gaps, prov, **kw)
        finally:
            V.KNOWN_INTEXT_MARKERS = saved
    else:
        rc, fails = run_validate(dalil, gaps, prov, **kw)
    hit = next((f for f in fails if expect in f), None)
    return rc, fails, hit


def runnable(name: str) -> bool:
    return not (NO_CORPUS and name in NEEDS_CORPUS)


def partition_problems() -> list[str]:
    """Full (corpus) runs only: NEEDS_CORPUS must be exactly the faults --no-corpus cannot catch."""
    out = []
    for name, *_ in MUTATIONS:
        rc, _, hit = apply(name, no_corpus=True)
        caught = rc == 1 and hit is not None
        if name in NEEDS_CORPUS and caught:
            out.append(f"{name!r} is in NEEDS_CORPUS but --no-corpus catches it (move it out, so CI runs it)")
        if name not in NEEDS_CORPUS and not caught:
            out.append(f"{name!r} is not caught by --no-corpus (add it to NEEDS_CORPUS or fix the check)")
    return out


def missing_corpus_problems() -> list[str]:
    """Without --no-corpus, an absent api/data must fail with a message, not crash or pass."""
    with tempfile.TemporaryDirectory() as empty:
        try:
            rc, fails = run_validate(copy.deepcopy(DALIL), copy.deepcopy(GAPS), copy.deepcopy(PROV),
                                     no_corpus=False, api_data=Path(empty))
        except Exception as e:  # noqa: BLE001 - a crash is the failure being tested for
            return [f"absent api/data crashed validate_waris: {type(e).__name__}: {e}"]
    if rc != 1 or not any("--no-corpus" in f for f in fails):
        return [f"absent api/data without --no-corpus: exit {rc}, {fails[:2]} (expected a failure naming --no-corpus)"]
    return []


def corpus_missing_message() -> str | None:
    """Full mode needs api/data (git-ignored): say so plainly instead of a FileNotFoundError traceback."""
    missing = [] if NO_CORPUS else V.missing_api_files()
    if missing:
        return (f"{V.API_DATA} lacks {missing}: the full mutation run needs the corpus. "
                f"Run with --no-corpus (or WARIS_NO_CORPUS=1) for the corpus-free faults only.")
    return None


class TestValidateWarisMutations(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        msg = corpus_missing_message()
        if msg:
            raise AssertionError(msg)

    def test_clean_copies_pass(self):
        rc, fails = run_validate(copy.deepcopy(DALIL), copy.deepcopy(GAPS), copy.deepcopy(PROV))
        self.assertEqual((rc, fails), (0, []))

    def test_clean_copies_pass_with_parity(self):
        rc, fails = run_validate(copy.deepcopy(DALIL), copy.deepcopy(GAPS), copy.deepcopy(PROV),
                                 dalil_bytes=DALIL_BYTES, docs_dalil=DALIL_BYTES, docs_vectors=VEC_BYTES)
        self.assertEqual((rc, fails), (0, []))

    def test_clean_rules_only_pass(self):
        rc, fails = run_validate(copy.deepcopy(DALIL), copy.deepcopy(GAPS), copy.deepcopy(PROV), rules_only=True)
        self.assertEqual((rc, fails), (0, []))

    def test_serialisation_round_trip_is_byte_exact(self):
        self.assertEqual(json.dumps(DALIL, ensure_ascii=False, indent=1).encode("utf-8"), DALIL_BYTES)

    def test_each_fault_is_caught(self):
        for name, *_ in MUTATIONS:
            with self.subTest(fault=name):
                if not runnable(name):
                    self.skipTest(f"{name}: needs the corpus (--no-corpus)")
                rc, fails, hit = apply(name)
                self.assertEqual(rc, 1, f"{name}: validate passed")
                self.assertIsNotNone(hit, f"{name}: failed, but not with the expected message: {fails[:3]}")

    def test_absent_corpus_fails_loudly(self):
        self.assertEqual(missing_corpus_problems(), [])

    @unittest.skipIf(NO_CORPUS, "the partition check needs the corpus")
    def test_needs_corpus_partition_is_exact(self):
        self.assertEqual(partition_problems(), [])


if __name__ == "__main__" and [a for a in sys.argv[1:] if a != "--no-corpus"] == []:
    if corpus_missing_message():
        print(f"FAIL: {corpus_missing_message()}", file=sys.stderr)
        sys.exit(1)
    mode = "--no-corpus" if NO_CORPUS else "full (corpus)"
    rc0, f0 = run_validate(copy.deepcopy(DALIL), copy.deepcopy(GAPS), copy.deepcopy(PROV))
    rc1, f1 = run_validate(copy.deepcopy(DALIL), copy.deepcopy(GAPS), copy.deepcopy(PROV),
                           dalil_bytes=DALIL_BYTES, docs_dalil=DALIL_BYTES, docs_vectors=VEC_BYTES)
    rc2, f2 = run_validate(copy.deepcopy(DALIL), copy.deepcopy(GAPS), copy.deepcopy(PROV), rules_only=True)
    rc1, f1 = (rc1 or rc2), (f1 + f2)
    rt = json.dumps(DALIL, ensure_ascii=False, indent=1).encode("utf-8") == DALIL_BYTES
    print(f"mode: {mode}")
    print(f"clean copies: exit {rc0}, {len(f0)} failures; with parity and in --rules-only mode: exit {rc1}, "
          f"{len(f1)} failures; serialisation round-trip byte-exact: {rt}")
    missed = skipped = 0
    for i, (name, target, _, _) in enumerate(MUTATIONS, 1):
        if not runnable(name):
            skipped += 1
            print(f"{i:2d}. SKIPPED [{target}] {name} (needs api/data + pipeline/cache)")
            continue
        rc, fails, hit = apply(name)
        ok = rc == 1 and hit
        missed += not ok
        print(f"{i:2d}. {'CAUGHT' if ok else 'MISSED'} [{target}] {name}\n      -> {hit or fails[:2]}")
    extra = missing_corpus_problems() + ([] if NO_CORPUS else partition_problems())
    for x in extra:
        print(f"FAIL: {x}")
    run = len(MUTATIONS) - skipped
    print(f"\n{run - missed}/{run} faults caught ({skipped} skipped by name: need the corpus); absent api/data "
          f"fails loudly: {'yes' if not missing_corpus_problems() else 'NO'}; "
          + ("" if NO_CORPUS else f"NEEDS_CORPUS partition exact: {'yes' if not extra else 'NO'}; ")
          + f"clean copies {'pass' if rc0 == 0 and not f0 and rc1 == 0 and not f1 and rt else 'FAIL'}")
    sys.exit(1 if missed or extra or rc0 or f0 or rc1 or f1 or not rt else 0)
elif __name__ == "__main__":
    sys.argv = [a for a in sys.argv if a != "--no-corpus"]
    unittest.main()
