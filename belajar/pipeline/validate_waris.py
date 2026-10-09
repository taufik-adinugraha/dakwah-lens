#!/usr/bin/env python3
"""Stage 6 (Ilmu Waris): re-check belajar/content/waris/{dalil.json, dalil-gaps.json,
dalil-provenance.json, test-vectors.json} against their sources. Exit 1 on any failure. Stdlib only.

Independent of build_dalil.py / build_waris.py: it reads the pinned inputs and api/data itself.

Checks
  1. Pins: the Tanzil file, the QuranEnc suras and the fawazahmed0 Muslim sections match their
     sources.json sha256; META.sources of both dalil files repeat those pins, and every api/data
     file named there still has the sha256 recorded at build time (else the corpus changed).
  2. Parity (research phase): while docs/waris-research/{dalil,test-vectors}.json exist, the
     belajar copies are byte-identical to them.
  3. Qur'an: `ar` equals the Tanzil line byte for byte; ar_quran_json and the quran.json
     translations equal api/data/quran.json; the QuranEnc text and footnotes equal the pinned
     QuranEnc file; citation, ref and url agree.
  4. Hadith: Bukhari, Muslim and Bulugh `ar` and translations equal the api/data record; Muslim
     canonical numbers are re-derived from fawazahmed0 arabicnumber and the Arabic is identical;
     a Bulugh matn span is a prefix of `ar` ending on a word boundary, the footnote is the suffix,
     nothing but the in-text marker lies between them, the span holds no footnote item and no
     in-text footnote marker (two known research records excepted, reported as warnings), and
     every grade word is a substring of the footnote.
  5. Kitab and tafsir excerpts: `ar` equals source[char_range] and both ends sit on word
     boundaries; anchor/title/qism agree. Where the span crosses the printed edition's running
     head, each `omit` span must hold exactly a running head (plus a junk digit run) and `ar` is the
     span with those cut out, each cut shown as '…'; `source_truncated` (a trailing ' …') only where
     the span ends at the end of the source record. Section pointers: anchor/title/qism/char_count
     agree.
  5b. Shown Arabic (corpus-free): no Arabic field of any record carries a running head or a run of
     6+ ASCII digits (page-break debris; real takhrij numbers have at most 5 digits).
  6. Provenance: every record that copies or points at corpus bytes has entries for all of its
     copied fields; each entry's sha256 equals the sha256 of the source field recomputed here, its
     copied_sha256 the sha256 of the record's field, and a span slices exactly that field.
  7. Prose: no Arabic script in Indonesian prose (gist_id, statement_id, display_label) nor in any
     text of a gap-file record outside its copied fields.
  8. References: ids unique across both files; rule strongest/supporting/grounds resolve; gap-file
     `would_ground`, `rules`, `related` resolve; extracted records are draft with empty `grounds`.
  9. The plan §8 gap list (docs/waris-plan.md §8, "Gaps to extract in M1" and "Still external",
     plus the External cells of the table) is present in dalil-gaps.json, each item as the record
     kind it must be.
 10. RuleNotes (content/waris/rules.json, plan §9.2 / M1.6): exactly one note per engine rule id
     (RULE_IDS parsed from src/lib/waris/registry.ts on its own, not via build_waris.py) and no
     note for an id the registry lacks; every cited dalil id exists in dalil.json or
     dalil-gaps.json and is an evidence record (quran/hadith/fiqh/tafsir) or a gap record;
     dalil_rule ids are rule records, related_gaps ids gap records; every legal cite names a
     legal_sources entry; every note has >= 1 dalil or legal source (only METHOD_ONLY_RULES may
     instead carry a `method` block); a note citing only gap records says the source is pending;
     every note is draft; no Arabic script anywhere, and no quotation marks, bare QS/HR
     citations or ALL-CAPS words in the learner-facing prose; rules.json equals the authored file
     (sha256 and content) in registry order.

    python3 validate_waris.py               # all checks (needs api/data and the pipeline cache)
    python3 validate_waris.py --no-corpus   # CI: every check that needs neither (2, 7, 8, 9, 10,
                                            # the sources.json half of the META pins and the
                                            # record half of 6); prints what it skipped
    python3 validate_waris.py --rules-only  # check 10 only (needs no corpus)

Without --no-corpus a missing api/data file is a failure (never a silent skip): api/data is
git-ignored, so CI runs --no-corpus and the corpus checks (1, 3, 4, 5, source half of 6) stay
a local step before any dalil change is committed.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
import unicodedata
from pathlib import Path

from common import CONTENT_DIR, PIPELINE, load_sources

REPO = PIPELINE.parents[1]
API_DATA = REPO / "api" / "data"
WARIS = CONTENT_DIR / "waris"
DALIL = WARIS / "dalil.json"
GAPS = WARIS / "dalil-gaps.json"
PROV = WARIS / "dalil-provenance.json"
VECTORS = WARIS / "test-vectors.json"
DOCS_DALIL: Path | None = REPO / "docs" / "waris-research" / "dalil.json"
DOCS_VECTORS: Path | None = REPO / "docs" / "waris-research" / "test-vectors.json"

# plan §8 "Gaps to extract in M1": the record id each item must have in dalil-gaps.json, with its kind
EXPECTED_EXTRACTED = {
    "Q-33-4": "quran", "Q-33-5": "quran", "Q-4-34": "quran", "Q-4-128": "quran", "Q-49-10": "quran",
    "Q-42-38": "quran", "Q-2-188": "quran", "Q-4-10": "quran", "Q-60-8": "quran",
    "H-BUKHARI-2586": "hadith", "H-BUKHARI-2587": "hadith", "H-BUKHARI-5986": "hadith", "H-BUKHARI-5987": "hadith",
    "H-MUSLIM-1623e": "hadith", "H-BULUGH-649": "hadith",
    "T-IK-4-11-mother-siblings": "tafsir", "T-IK-4-11-jahiliyyah": "tafsir",
    "F-ALUMM-556-jadd": "fiqh", "F-ALUMM-559-musyarakah": "fiqh",
    "F-FSUNNAH-843-syarat": "fiqh", "F-FSUNNAH-847-mutallaqa": "fiqh", "F-FSUNNAH-860-mafqud": "fiqh",
    "F-FSUNNAH-861-mafqud-mirath": "fiqh", "F-FSUNNAH-862-khuntsa": "fiqh", "F-FSUNNAH-863-ibn-zina": "fiqh",
    "F-FSUNNAH-864-takharuj": "fiqh",
}
# plan §8 "Still external" (dalil.md §7 E1-E8, E10, E11, Akdariyyah), the External (review) cell for
# 'Umariyyatain with the grandfather, and E9 (Legal rows): explicit gap records
EXPECTED_GAPS = {
    "G-E1-sad-ibn-ar-rabi", "G-E2-grandmother-abu-bakr", "G-E3-first-awl-umar", "G-E4-funeral-first",
    "G-E5-bulugh-canonical-numbers", "G-E6-bulugh-primary-collections", "G-E7-learn-faraid",
    "G-E8-id-translation-bukhari-bulugh", "G-E9-indonesian-provisions", "G-E10-zayd-husband-sister",
    "G-E11-newborn-wording", "G-AKDARIYYAH", "G-UMARIYYATAIN-JADD",
    # added by the 2026-10-09 review (radd.semua RuleNote), not a plan §8 item
    "G-RADD-SEMUA-UTSMAN",
}
# The printed editions' running heads that the corpus text carries at page breaks (independent of
# build_dalil / ar.py on purpose). An excerpt that crosses one cuts it out ('omit') and shows '…'.
RUNNING_HEADS = (
    "فتح القريب المجيب في شرح ألفاظ التقريب = القول المختار في شرح غاية الاختصار",
    "فتح المعين بشرح قرة العين بمهمات الدين",
)
ELISION = "…"
OMITTABLE = re.compile("(?:" + "|".join(re.escape(h) for h in RUNNING_HEADS) + r")(?:\s+[0-9]{6,})?")
DIGIT_RUN = re.compile(r"[0-9]{6,}")

# Research records whose Bulugh matn span carries the editor's in-text footnote marker (a digit +
# RLM inside the matn). Known defects of the canonical research file, reported as warnings; any
# other record with such a marker fails.
KNOWN_INTEXT_MARKERS = {"H-BULUGH-1114", "H-BULUGH-1116"}

KINDS = {"meta", "quran", "hadith", "fiqh", "tafsir", "section_index", "rule", "gap"}
RULE_STATUS = {"found", "partial", "external"}
PROSE_ID = ("gist_id", "statement_id", "display_label")
GAP_TEXT = ("source_doc", "plan_ref", "item", "corpus_has", "needed", "display", "closes_gap", "gist_id")
FIQH_FILES = {"Fath al-Qarib": "fath-al-qarib.json", "Fath al-Mu'in": "fath-al-muin.json",
              "Fiqh as-Sunnah": "fiqh-as-sunnah.json", "al-Umm": "al-umm.json"}
TAFSIR_FILES = {"Tafsir Ibn Kathir": "tafsir-ibn-kathir.json", "Tafsir al-Tabari": "tafsir-al-tabari.json"}
SURAH_NAMES = {2: "Al-Baqarah", 4: "An-Nisa'", 8: "Al-Anfal", 33: "Al-Ahzab", 42: "Asy-Syura", 49: "Al-Hujurat",
               60: "Al-Mumtahanah"}

fails: list[str] = []
warns: list[str] = []


def fail(msg: str) -> None:
    fails.append(msg)


def sha_text(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def sha_file(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def is_arabic_script(ch: str) -> bool:
    o = ord(ch)
    return (0x0600 <= o <= 0x06FF or 0x0750 <= o <= 0x077F or 0x08A0 <= o <= 0x08FF
            or 0xFB50 <= o <= 0xFDFF or 0xFE70 <= o <= 0xFEFF)


def word_char(ch: str) -> bool:
    return unicodedata.category(ch)[0] in "LMN"


def on_word_boundary(text: str, i: int) -> bool:
    return i <= 0 or i >= len(text) or not (word_char(text[i - 1]) and word_char(text[i]))


# ---------------------------------------------------------------- inputs (cached across main() calls)
_CACHE: dict = {}


API_FILES = ("quran.json", "bukhari.json", "muslim.json", "bulugh-al-maram.json",
             *FIQH_FILES.values(), *TAFSIR_FILES.values())
# what --no-corpus leaves out (named in its OK line, so a CI pass never reads as a full pass)
NO_CORPUS_SKIPPED = ("1 pin files in pipeline/cache and api/data hashes", "3 Qur'an bytes", "4 hadith bytes",
                     "5 kitab/tafsir spans and section pointers", "6 source-side provenance hashes and slices")


def missing_api_files() -> list[str]:
    return [f for f in API_FILES if not (API_DATA / f).exists()]


def corpus() -> dict:
    if _CACHE:
        return _CACHE
    src = load_sources()
    I = src["inputs"]
    pp: list[str] = []
    tz = I["tanzil_uthmani"]
    tp = PIPELINE / tz["cache_path"]
    if not tp.exists() or sha_file(tp) != tz["sha256"]:
        pp.append(f"[pins] {tz['cache_path']}: missing or sha256 != sources.json pin")
    tanzil = {}
    if tp.exists():
        for line in tp.read_text(encoding="utf-8").split("\n"):
            p = line.split("|")
            if len(p) == 3 and p[0].isdigit():
                tanzil[(int(p[0]), int(p[1]))] = p[2]
    qe, qe_files = {}, {}
    w = I["quranenc_indonesian_affairs_waris"]
    for name, f in w["files"].items():
        p = PIPELINE / w["cache_dir"] / name
        if not p.exists() or sha_file(p) != f["sha256"]:
            pp.append(f"[pins] {name}: missing or sha256 != sources.json pin")
            continue
        rows = json.loads(p.read_text(encoding="utf-8"))["result"]
        s = int(rows[0]["sura"])
        qe_files[s] = name
        for r in rows:
            qe[(int(r["sura"]), int(r["aya"]))] = r
    fz = {}
    m = I["fawazahmed0_muslim_sections"]
    for name, f in m["files"].items():
        p = PIPELINE / m["cache_dir"] / name
        if not p.exists() or sha_file(p) != f["sha256"]:
            pp.append(f"[pins] {name}: missing or sha256 != sources.json pin")
            continue
        for h in json.loads(p.read_text(encoding="utf-8"))["hadiths"]:
            fz[h["hadithnumber"]] = h

    def load(f):
        return json.loads((API_DATA / f).read_text(encoding="utf-8"))

    api_sha = {f.name: sha_file(f) for f in API_DATA.glob("*.json")}
    _CACHE.update({
        "src": src, "pin_problems": pp, "tanzil": tanzil, "qe": qe, "qe_files": qe_files, "fz": fz, "api_sha": api_sha,
        "quran": {(int(r["surah"]), int(r["ayah"])): r for r in load("quran.json")},
        "bukhari": {str(r["hadithnumber"]): r for r in load("bukhari.json")},
        "muslim": {int(r["hadithnumber"]): r for r in load("muslim.json")},
        "bulugh": {int(r["hadithnumber"]): r for r in load("bulugh-al-maram.json")},
        "fiqh": {f: {str(r["section_id"]): r for r in load(f)} for f in FIQH_FILES.values()},
        "tafsir": {f: {(int(r["surah"]), int(r["ayah"])): r for r in load(f)} for f in TAFSIR_FILES.values()},
    })
    return _CACHE


def canon_muslim(fz: dict, seq: int) -> str | None:
    """Fuad Abd al-Baqi number: arabicnumber '1615.03' -> '1615c', '1614' or '1614.00' -> '1614'."""
    h = fz.get(seq)
    if h is None:
        return None
    m = re.fullmatch(r"(\d+)(?:\.(\d+))?", str(h["arabicnumber"]))
    if not m:
        return None
    sub = int(m.group(2) or 0)
    return m.group(1) if sub == 0 else m.group(1) + "abcdefghijklmnopqrstuvwxyz"[sub - 1]


# ---------------------------------------------------------------- per-kind checks
def check_quran(r: dict, C: dict) -> None:
    rid = r["id"]
    s, a = r["ref"]["surah"], r["ref"]["ayah"]
    if rid != f"Q-{s}-{a}":
        fail(f"{rid}: id does not match ref {s}:{a}")
    line = C["tanzil"].get((s, a))
    if r.get("ar") != line:
        fail(f"{rid}: ar is not the Tanzil line {s}|{a} byte for byte")
    if r.get("ar_source") != "tanzil":
        fail(f"{rid}: ar_source {r.get('ar_source')!r} != 'tanzil'")
    if r.get("citation") != f"QS {SURAH_NAMES.get(s, '?')} [{s}]: {a}":
        fail(f"{rid}: citation {r.get('citation')!r} does not name {s}:{a}")
    if r.get("url") != f"https://tanzil.net/#{s}:{a}":
        fail(f"{rid}: url {r.get('url')!r}")
    qj = C["quran"].get((s, a), {})
    if r.get("ar_quran_json") != qj.get("arabic"):
        fail(f"{rid}: ar_quran_json != api/data/quran.json arabic")
    if r.get("ar_quran_json_byte_identical_to_tanzil") != (qj.get("arabic") == line):
        fail(f"{rid}: ar_quran_json_byte_identical_to_tanzil is wrong")
    tr = r.get("translations", {})
    q = C["qe"].get((s, a))
    t = tr.get("id_quranenc_indonesian_affairs", {})
    if q is None:
        fail(f"{rid}: no pinned QuranEnc file holds {s}:{a}")
    elif t.get("text") != q["translation"] or t.get("footnotes") != q["footnotes"]:
        fail(f"{rid}: QuranEnc translation/footnotes != the pinned QuranEnc file (verbatim required)")
    if not str(t.get("label", "")).startswith("QuranEnc indonesian_affairs v1.0.1"):
        fail(f"{rid}: QuranEnc label must name indonesian_affairs v1.0.1")
    if tr.get("id_quran_json", {}).get("text") != qj.get("id") or tr.get("en_quran_json", {}).get("text") != qj.get("en"):
        fail(f"{rid}: quran.json id/en translation != api/data/quran.json")


def check_hadith(r: dict, C: dict) -> None:
    rid, coll = r["id"], r.get("collection", "")
    if coll == "Sahih al-Bukhari":
        n = rid.rsplit("-", 1)[1]
        h = C["bukhari"].get(n)
        if h is None:
            return fail(f"{rid}: no api/data/bukhari.json record {n}")
        if r.get("ar") != h["ar"]:
            fail(f"{rid}: ar is not byte-identical to api/data/bukhari.json {n}")
        if r.get("citation") != h["citation_en"] or r.get("book") != h["book"] or r.get("in_book_number") != h["in_book_number"]:
            fail(f"{rid}: citation/book/in_book_number disagree with api/data/bukhari.json")
        if r.get("translations", {}).get("en", {}).get("text") != h["en"]:
            fail(f"{rid}: en translation != api/data/bukhari.json")
        if r.get("url") != f"https://sunnah.com/bukhari:{n}":
            fail(f"{rid}: url {r.get('url')!r}")
        for v in r.get("variants_in_corpus", []):
            if v not in C["bukhari"]:
                fail(f"{rid}: variant {v} is not in api/data/bukhari.json")
    elif coll == "Sahih Muslim":
        seq = r.get("local_hadithnumber")
        h = C["muslim"].get(seq)
        if h is None:
            return fail(f"{rid}: no api/data/muslim.json record {seq}")
        canon = canon_muslim(C["fz"], seq)
        if canon is None or rid != f"H-MUSLIM-{canon}" or r.get("citation") != f"Sahih Muslim {canon}":
            fail(f"{rid}: canonical number is {canon} for local {seq} (fawazahmed0 arabicnumber)")
        elif C["fz"][seq]["text"] != h["ar"]:
            fail(f"{rid}: fawazahmed0 Arabic != api/data/muslim.json {seq}, so the number map cannot be trusted")
        if r.get("ar") != h["ar"]:
            fail(f"{rid}: ar is not byte-identical to api/data/muslim.json {seq}")
        if r.get("local_citation_en") != h["citation_en"]:
            fail(f"{rid}: local_citation_en != api/data/muslim.json")
        tr = r.get("translations", {})
        if tr.get("en", {}).get("text") != h["en"] or tr.get("id", {}).get("text") != h.get("id", ""):
            fail(f"{rid}: en/id translation != api/data/muslim.json")
        if r.get("url") != f"https://sunnah.com/muslim:{canon}":
            fail(f"{rid}: url {r.get('url')!r}")
    elif coll.startswith("Bulugh al-Maram"):
        check_bulugh(r, C)
    else:
        fail(f"{rid}: unknown collection {coll!r}")


FOOT_ITEM = re.compile(r"(?:^|[‏\s])\d+ ‏-")
INTEXT_MARKER = re.compile(r"\s\d+‏")


def check_bulugh(r: dict, C: dict) -> None:
    rid = r["id"]
    n = int(rid.rsplit("-", 1)[1])
    h = C["bulugh"].get(n)
    if h is None:
        return fail(f"{rid}: no api/data/bulugh-al-maram.json record {n}")
    ar = h["ar"]
    if r.get("ar") != ar:
        fail(f"{rid}: ar is not byte-identical to api/data/bulugh-al-maram.json {n}")
    if r.get("translations", {}).get("en", {}).get("text") != h["en"]:
        fail(f"{rid}: en translation != api/data/bulugh-al-maram.json")
    matn, foot = r.get("ar_matn_and_ibn_hajar_attribution", ""), r.get("ar_tahqiq_footnote", "")
    if not matn or not ar.startswith(matn):
        return fail(f"{rid}: shown matn span is not a prefix of the source bytes")
    if not foot or not ar.endswith(foot) or not foot.startswith("1 ‏-"):
        return fail(f"{rid}: tahqiq footnote is not the source's suffix starting at footnote 1")
    between = ar[len(matn):len(ar) - len(foot)]
    if len(matn) + len(foot) > len(ar) or not re.fullmatch(r"[\s\d‏.]*", between):
        fail(f"{rid}: shown matn span and the editor footnote overlap, or text lies between them ({between[:30]!r})")
    if FOOT_ITEM.search(matn):
        fail(f"{rid}: shown matn span contains an editor footnote item")
    if not on_word_boundary(ar, len(matn)) or (matn and matn[-1].isdigit()):
        fail(f"{rid}: shown matn span does not end on a word boundary (or ends on a footnote marker)")
    if INTEXT_MARKER.search(matn):
        if rid in KNOWN_INTEXT_MARKERS:
            warns.append(f"{rid}: the shown matn span carries the editor's in-text footnote marker "
                         f"{INTEXT_MARKER.search(matn).group(0).strip()!r} (known research-file defect; strip before display)")
        else:
            fail(f"{rid}: shown matn span carries an editor in-text footnote marker")
    for g in r.get("grades_from_tahqiq_footnotes", []):
        if g.get("text", "") == "" or g["text"] not in foot:
            fail(f"{rid}: grade {g.get('text')!r} is not a substring of the tahqiq footnote")


def shown_excerpt(src: str, a: int, b: int, omit: list, truncated: bool) -> str:
    """src[a:b] with each omitted span replaced by '…', plus ' …' for a truncated source record."""
    parts, pos = [], a
    for x, y in omit:
        parts.append(src[pos:x])
        pos = y
    parts.append(src[pos:b])
    return ELISION.join(parts) + (" " + ELISION if truncated else "")


def omit_shape_ok(omit, a: int, b: int) -> bool:
    """omit is a list of [x, y) int pairs, sorted, disjoint and strictly inside (a, b)."""
    if not isinstance(omit, list):
        return False
    pos = a
    for sp in omit:
        if not (isinstance(sp, list) and len(sp) == 2 and all(isinstance(v, int) for v in sp)):
            return False
        x, y = sp
        if not (pos < x < y < b):
            return False
        pos = y
    return True


def check_shown_arabic(r: dict) -> None:
    """5b (corpus-free): no running head and no long digit run in any Arabic field of a record."""
    for k, v in r.items():
        if not (k == "ar" or k.startswith("ar_")) or not isinstance(v, str):
            continue
        for h in RUNNING_HEADS:
            if h in v:
                fail(f"{r['id']}: {k} carries the printed edition's running head {h[:12]!r}… (page-break debris; cut it "
                     f"out with 'omit')")
        m = DIGIT_RUN.search(v)
        if m:
            fail(f"{r['id']}: {k} carries a digit run of {len(m.group(0))} digits (page-break debris, not kitab text)")


def check_excerpt(r: dict, C: dict) -> None:
    rid = r["id"]
    if r["kind"] == "fiqh":
        f = next((v for k, v in FIQH_FILES.items() if r.get("book", "").startswith(k)), None)
        h = C["fiqh"].get(f, {}).get(str(r.get("section_id"))) if f else None
        if h is None:
            return fail(f"{rid}: source section not found ({r.get('book')!r} {r.get('section_id')!r})")
        if (r.get("anchor"), r.get("title"), r.get("qism")) != (h["anchor"], h["title"], h.get("qism", "")):
            fail(f"{rid}: anchor/title/qism disagree with api/data/{f}")
    else:
        f = next((v for k, v in TAFSIR_FILES.items() if r.get("book", "").startswith(k)), None)
        key = (r.get("ref", {}).get("surah"), r.get("ref", {}).get("ayah"))
        h = C["tafsir"].get(f, {}).get(key) if f else None
        if h is None or r.get("record_key") != f"{key[0]}:{key[1]}":
            return fail(f"{rid}: source tafsir record not found ({r.get('book')!r} {key})")
    a, b = r.get("char_range", [0, 0])
    src = h["ar"]
    omit, truncated = r.get("omit", []), r.get("source_truncated", False)
    if not (0 <= a < b <= len(src)):
        return fail(f"{rid}: char_range ({a}, {b}) is outside the source record")
    if "omit" in r and (not omit or not omit_shape_ok(omit, a, b)):
        return fail(f"{rid}: omit {omit!r} is not a sorted list of disjoint spans inside char_range ({a}, {b})")
    for x, y in omit:
        if not OMITTABLE.fullmatch(src[x:y]):
            fail(f"{rid}: omitted text [{x}, {y}) is not a running head ({src[x:x + 20]!r}…): only page-break debris "
                 f"may be cut from an excerpt")
    if truncated not in (False, True) or (truncated and b != len(src)):
        fail(f"{rid}: source_truncated, but the span ends at {b}, not at the end of the source record ({len(src)})")
    if shown_excerpt(src, a, b, omit, truncated is True) != r.get("ar"):
        return fail(f"{rid}: ar != source[char_range]" + (" minus its omit spans" if omit else "") + f" ({a}, {b})")
    if not on_word_boundary(src, a) or not on_word_boundary(src, b):
        fail(f"{rid}: excerpt [{a}, {b}) does not sit on word boundaries of the source "
             f"({src[max(0, a - 3):a + 3]!r} / {src[max(0, b - 3):b + 3]!r})")


def check_section(r: dict, C: dict) -> None:
    rid = r["id"]
    fname = r.get("file", "").split("/")[-1]
    if "section_id" in r:
        h = C["fiqh"].get(fname, {}).get(r["section_id"])
        if h is None:
            return fail(f"{rid}: section {r['section_id']} not in {r.get('file')}")
        if (r.get("anchor"), r.get("title"), r.get("qism"), r.get("char_count")) != (
                h["anchor"], h["title"], h.get("qism", ""), h["char_count"]) or h["char_count"] != len(h["ar"]):
            fail(f"{rid}: section anchor/title/qism/char_count disagree with {r.get('file')}")
    else:
        s, a = (int(x) for x in r.get("record_key", "0:0").split(":"))
        h = C["tafsir"].get(fname, {}).get((s, a))
        if h is None or r.get("char_count") != len(h["ar"]):
            fail(f"{rid}: section pointer {r.get('record_key')} / char_count disagree with {r.get('file')}")


def check_prose(r: dict, gap_file: bool) -> None:
    rid = r["id"]
    fields = PROSE_ID + (GAP_TEXT if gap_file else ())
    for k in fields:
        v = r.get(k)
        if isinstance(v, str) and any(is_arabic_script(c) for c in v):
            fail(f"{rid}: Arabic script in prose field {k!r} (Arabic is shown only from copied source fields)")
    if gap_file:
        for k in ("notes", "related", "rules", "plan_rows"):
            for v in r.get(k, []) or []:
                if isinstance(v, str) and any(is_arabic_script(c) for c in v):
                    fail(f"{rid}: Arabic script in {k!r} of a gap-file record")


# ---------------------------------------------------------------- provenance
EXPECTED_FIELDS = {
    "quran": {"ar", "ar_quran_json", "translations.id_quranenc_indonesian_affairs.text",
              "translations.id_quranenc_indonesian_affairs.footnotes", "translations.id_quran_json.text",
              "translations.en_quran_json.text"},
    "Sahih al-Bukhari": {"ar", "translations.en.text"},
    "Sahih Muslim": {"ar", "translations.en.text", "translations.id.text"},
    "Bulugh": {"ar", "ar_matn_and_ibn_hajar_attribution", "ar_tahqiq_footnote", "translations.en.text"},
    "fiqh": {"ar"}, "tafsir": {"ar"}, "section_index": {"(pointer)"},
}


def expected_fields(r: dict) -> set | None:
    k = r["kind"]
    if k == "hadith":
        c = r.get("collection", "")
        return EXPECTED_FIELDS["Bulugh" if c.startswith("Bulugh") else c] if (c.startswith("Bulugh") or c in EXPECTED_FIELDS) else None
    return EXPECTED_FIELDS.get(k)


def get_path(r: dict, dotted: str):
    v = r
    for part in dotted.split("."):
        if not isinstance(v, dict) or part not in v:
            return None
        v = v[part]
    return v


def source_field(e: dict, C: dict):
    """Resolve a provenance entry to the source string it names, independently of the build."""
    src, loc, fld = e.get("source", ""), e.get("locator", ""), e.get("source_field", "")
    kv = dict(x.split("=", 1) for x in loc.split(",") if "=" in x)
    try:
        if src == "tanzil_uthmani" and fld == "verse":
            s, a = (int(x) for x in loc.split("|"))
            return C["tanzil"].get((s, a))
        if src.startswith("quranenc_indonesian_affairs_waris:"):
            name = src.split(":", 1)[1]
            s = next(k for k, v in C["qe_files"].items() if v == name)
            return C["qe"][(s, int(kv["aya"]))][fld]
        if not src.startswith("api/data/"):
            return None
        f = src.split("/")[-1]
        if f == "quran.json":
            return C["quran"][(int(kv["surah"]), int(kv["ayah"]))][fld]
        if f == "bukhari.json":
            return C["bukhari"][kv["hadithnumber"]][fld]
        if f == "muslim.json":
            return C["muslim"][int(kv["hadithnumber"])].get(fld, "")
        if f == "bulugh-al-maram.json":
            return C["bulugh"][int(kv["hadithnumber"])][fld]
        if f in C["fiqh"]:
            return C["fiqh"][f][kv["section_id"]][fld]
        if f in C["tafsir"]:
            return C["tafsir"][f][(int(kv["surah"]), int(kv["ayah"]))][fld]
    except (KeyError, ValueError, StopIteration):
        return None
    return None


def check_provenance(records: list[tuple[str, dict]], prov: dict, C: dict | None) -> int:
    """C None (--no-corpus): only the record half: entries exist and cover the copied fields, spans are
    well-formed, copied_sha256 is the sha256 of the record's own bytes, excerpt spans equal char_range."""
    entries = prov.get("records", {})
    n = 0
    for fname, r in records:
        want = expected_fields(r)
        if want is None:
            continue
        rid = r["id"]
        p = entries.get(rid)
        if not p or p.get("file") != fname:
            fail(f"{rid}: no provenance entry (dalil-provenance.json) for this {fname} record")
            continue
        got = {e.get("field") for e in p.get("copies", [])}
        if want - got:
            fail(f"{rid}: provenance does not cover {sorted(want - got)}")
        for e in p.get("copies", []):
            whole = None
            if C is not None:
                whole = source_field(e, C)
                if whole is None:
                    fail(f"{rid}: provenance {e.get('field')}: source {e.get('source')} {e.get('locator')} not found")
                    continue
                if sha_text(whole) != e.get("sha256"):
                    fail(f"{rid}: provenance {e.get('field')}: sha256 of the source record field differs "
                         f"({e.get('source')} {e.get('locator')}: the source changed or the pin is wrong)")
            elif not re.fullmatch(r"[0-9a-f]{64}", str(e.get("sha256", ""))):
                fail(f"{rid}: provenance {e.get('field')}: sha256 of the source field is missing or malformed")
            if e.get("field") == "(pointer)":
                n += 1
                continue
            mine = get_path(r, e["field"])
            if not isinstance(mine, str):
                fail(f"{rid}: provenance names field {e['field']!r}, which the record lacks")
                continue
            span = e.get("span")
            limit = len(whole) if whole is not None else None
            if span is not None and not (isinstance(span, list) and len(span) == 2
                                         and all(isinstance(x, int) for x in span) and 0 <= span[0] <= span[1]
                                         and (limit is None or span[1] <= limit)):
                fail(f"{rid}: provenance {e['field']}: malformed span {span!r}")
                continue
            omit, truncated = e.get("omit", []), e.get("source_truncated", False) is True
            if (e.get("omit"), e.get("source_truncated")) != (r.get("omit"), r.get("source_truncated")) and r["kind"] in ("fiqh", "tafsir"):
                fail(f"{rid}: provenance omit/source_truncated disagree with the record")
            if omit and (span is None or not omit_shape_ok(omit, span[0], span[1])):
                fail(f"{rid}: provenance {e['field']}: malformed omit {omit!r}")
                continue
            if whole is not None:
                expect = shown_excerpt(whole, span[0], span[1], omit, truncated) if span else whole
                if mine != expect:
                    fail(f"{rid}: {e['field']} is not the provenance-named source bytes{' slice' if span else ''}")
            elif span is not None:
                want = span[1] - span[0] - sum(y - x for x, y in omit) + len(ELISION) * len(omit) + (2 if truncated else 0)
                if want != len(mine):
                    fail(f"{rid}: {e['field']} is not the provenance-named source bytes slice (span length {span[1] - span[0]}"
                         f"{' minus omit' if omit else ''} != {len(mine)} characters)")
            if sha_text(mine) != e.get("copied_sha256"):
                fail(f"{rid}: provenance {e['field']}: copied_sha256 != sha256 of the record's bytes")
            if r["kind"] in ("fiqh", "tafsir") and e["field"] == "ar" and span != r.get("char_range"):
                fail(f"{rid}: provenance span {span} != char_range {r.get('char_range')}")
            n += 1
    stale = set(entries) - {r["id"] for _, r in records}
    if stale:
        fail(f"provenance names records that are in neither dalil file: {sorted(stale)[:5]}")
    return n


# ---------------------------------------------------------------- META, references, gap list
def check_meta(meta: dict, which: str, C: dict) -> None:
    I = C["src"]["inputs"]
    srcs = meta.get("sources", {})
    if which == "dalil.json":
        if srcs.get("tanzil", {}).get("sha256") != I["tanzil_uthmani"]["sha256"]:
            fail("dalil.json META: tanzil sha256 != sources.json pin")
        files = I["quranenc_indonesian_affairs_waris"]["files"]
        for s, h in srcs.get("quranenc", {}).get("sha256", {}).items():
            if files.get(f"indonesian_affairs_sura{s}.json", {}).get("sha256") != h:
                fail(f"dalil.json META: QuranEnc sura {s} sha256 {h[:12]}… != the pinned file")
    else:
        if srcs.get("tanzil_uthmani", {}).get("sha256") != I["tanzil_uthmani"]["sha256"]:
            fail(f"{which} META: tanzil sha256 != sources.json pin")
        files = I["quranenc_indonesian_affairs_waris"]["files"]
        for s, h in srcs.get("quranenc_indonesian_affairs_waris", {}).get("sha256", {}).items():
            if files.get(f"indonesian_affairs_sura{s}.json", {}).get("sha256") != h:
                fail(f"{which} META: QuranEnc sura {s} sha256 != the pinned file")
    if C.get("api_sha") is None:  # --no-corpus: the sources.json pins above are checked, api/data hashes are not
        return
    for v in srcs.values():
        f = v.get("file", "") if isinstance(v, dict) else ""
        if f.startswith("api/data/"):
            got = C["api_sha"].get(f.split("/")[-1])
            if got != v.get("sha256"):
                fail(f"{which} META: {f} sha256 {str(v.get('sha256'))[:12]}… != current file {str(got)[:12]}… "
                     f"(the corpus changed since the build; rebuild and re-review)")


def check_references(dalil: list, gaps: list) -> None:
    all_ids: dict[str, str] = {}
    for fname, data in (("dalil.json", dalil), ("dalil-gaps.json", gaps)):
        for r in data:
            rid = r.get("id")
            if rid in all_ids:
                fail(f"id {rid!r} used twice ({all_ids[rid]} and {fname})")
            all_ids[rid] = fname
            if r.get("kind") not in KINDS:
                fail(f"{rid}: unknown kind {r.get('kind')!r}")
    rules = {r["id"] for r in dalil if r.get("kind") == "rule"}
    for r in dalil:
        if r.get("kind") == "rule":
            if r.get("status") not in RULE_STATUS:
                fail(f"{r['id']}: rule status {r.get('status')!r} not in {sorted(RULE_STATUS)}")
            if not r.get("statement_id"):
                fail(f"{r['id']}: empty statement_id")
            for x in r.get("strongest", []) + r.get("supporting", []):
                if all_ids.get(x) != "dalil.json":
                    fail(f"{r['id']}: strongest/supporting id {x!r} is unknown in dalil.json")
        for g in r.get("grounds", []) or []:
            if g not in rules:
                fail(f"{r['id']}: grounds names unknown rule {g!r}")
    for r in gaps[1:]:
        rid = r["id"]
        for x in r.get("would_ground", []):
            if x not in rules:
                fail(f"{rid}: would_ground names unknown rule {x!r}")
        for x in r.get("rules", []):
            if x not in rules:
                fail(f"{rid}: rules names unknown rule {x!r}")
        for x in r.get("related", []):
            if x not in all_ids:
                fail(f"{rid}: related names unknown record {x!r}")
        if r.get("kind") == "gap":
            if r.get("status") != "external":
                fail(f"{rid}: gap record status {r.get('status')!r} != 'external'")
            for k in ("source_doc", "plan_ref", "item", "corpus_has", "needed", "display"):
                if not isinstance(r.get(k), str) or len(r[k]) < 3:
                    fail(f"{rid}: gap record field {k!r} missing or empty")
        else:
            if r.get("status") != "draft":
                fail(f"{rid}: status {r.get('status')!r} (an extracted record must be draft until reviewed)")
            if r.get("grounds") != []:
                fail(f"{rid}: grounds must stay empty in the gap file (rule records are unchanged; use would_ground)")
            if not r.get("closes_gap") or not r.get("gist_id"):
                fail(f"{rid}: closes_gap/gist_id missing")


def check_gap_list(gaps: list) -> None:
    have = {r["id"]: r.get("kind") for r in gaps[1:]}
    for rid, kind in EXPECTED_EXTRACTED.items():
        if have.get(rid) != kind:
            fail(f"plan §8 gap list: {rid} missing from dalil-gaps.json (or not a {kind} record)")
    for rid in EXPECTED_GAPS:
        if have.get(rid) != "gap":
            fail(f"plan §8 gap list: {rid} missing from dalil-gaps.json (or not a gap record)")
    extra = {k for k, v in have.items() if v == "gap"} - EXPECTED_GAPS
    if extra:
        fail(f"plan §8 gap list: unexpected gap records {sorted(extra)} (add them to EXPECTED_GAPS deliberately)")


# ---------------------------------------------------------------- 10. RuleNotes
RULES = WARIS / "rules.json"
AUTHORED_RULES = PIPELINE / "authored" / "waris.rules.json"
REGISTRY_TS = PIPELINE.parent / "src" / "lib" / "waris" / "registry.ts"
# Arithmetic, not a ruling (plan D5, engine.md §14): may cite no dalil and no legal source, but must
# then carry a `method` block saying so. Keep this list explicit; it mirrors waris-content.ts.
METHOD_ONLY_RULES = {"rupiah.pembulatan"}
NOTE_EVIDENCE_KINDS = {"quran", "hadith", "fiqh", "tafsir", "gap"}
NOTE_KEYS = ("rule_id", "title_id", "summary_id", "dalil", "dalil_rule", "related_gaps", "legal", "ikhtilaf",
             "method", "reviewer_notes", "status")
NOTE_LIST_KEYS = ("dalil", "dalil_rule", "related_gaps", "legal", "reviewer_notes")
LEGAL_KINDS = {"peraturan", "sema", "yurisprudensi", "putusan", "fatwa", "pedoman", "kajian"}
CAPS_OK = {"SEMA", "MUNAS", "BAZNAS"}
LEGAL_ID = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
rules_checked = 0


def _ts_block(text: str, start: str, end: str) -> str | None:
    i = text.find(start)
    j = text.find(end, i + len(start)) if i >= 0 else -1
    return text[i + len(start):j] if i >= 0 and j >= 0 else None


def registry_rule_ids(text: str) -> list[str]:
    """RULE_IDS of registry.ts: RULES keys, then rujuk.<reason>, then catatan.<note>."""
    def clean(block: str) -> str:
        return re.sub(r"//[^\n]*", "", re.sub(r"/\*.*?\*/", "", block, flags=re.S))
    blocks = [_ts_block(text, "export const RULES = {", "} as const satisfies Record<string, RuleMeta>;"),
              _ts_block(text, "export const RUJUK_REASONS = [", "] as const;"),
              _ts_block(text, "export const NOTES = [", "] as const;")]
    if any(b is None for b in blocks):
        fail("registry.ts: RULES, RUJUK_REASONS or NOTES block not found (did the registry change shape?)")
        return []
    calc = [a or b for a, b in re.findall(r'^\s*(?:"([a-z0-9_.]+)"|([a-z_][a-z0-9_]*))\s*:\s*R\(', clean(blocks[0]), re.M)]
    rujuk = re.findall(r'"([a-z_]+)"', clean(blocks[1]))
    notes = re.findall(r'"([a-z_]+)"', clean(blocks[2]))
    if not calc or not rujuk or not notes:
        fail("registry.ts: RULES, RUJUK_REASONS or NOTES parsed empty")
    return calc + [f"rujuk.{r}" for r in rujuk] + [f"catatan.{n}" for n in notes]


def display_prose_problems(text: str) -> list[str]:
    """Learner-facing RuleNote prose: Arabic is shown only through dalil records (D10); a paraphrase
    is never dressed as a quotation; citations travel as ids, not as bare QS/HR text; no CAPS emphasis."""
    out = []
    if any(is_arabic_script(ch) for ch in text):
        out.append("Arabic script")
    if re.search('["“”«»]', text):
        out.append("quotation marks (a paraphrase must not read as a quotation)")
    if re.search(r"(?<![A-Za-z])(?:QS|HR)(?![A-Za-z])", text):
        out.append("a bare QS/HR citation (cite through dalil ids)")
    caps = [w for w in re.findall(r"\b[A-Z]{4,}\b", text) if w not in CAPS_OK]
    if caps:
        out.append(f"ALL-CAPS words {caps}")
    return out


def sentence_count(text: str) -> int:
    return len(re.findall(r"[.!?](?=\s|$)", text))


def json_strings(obj):
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, dict):
        for v in obj.values():
            yield from json_strings(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from json_strings(v)


def check_rules(dalil: list, gaps: list) -> None:
    global rules_checked
    data = read_json(RULES, "rules.json")
    if data is None:
        return
    if set(data) != {"meta", "legal_sources", "rules"}:
        fail(f"rules.json: top-level keys {sorted(data)} != ['legal_sources', 'meta', 'rules']")
        return
    meta, sources, notes = data["meta"], data["legal_sources"], data["rules"]
    if meta.get("status") != "draft":
        fail(f"rules.json: meta.status {meta.get('status')!r} (no reviewer has signed: plan D3, D13)")
    if "not an authoritative fatwa" not in meta.get("disclaimer_en", ""):
        fail("rules.json: meta.disclaimer_en must say 'AI-assisted, not an authoritative fatwa'")
    if not meta.get("disclaimer_id"):
        fail("rules.json: meta.disclaimer_id missing")

    # one note per registry id, in registry order
    reg = registry_rule_ids(REGISTRY_TS.read_text(encoding="utf-8")) if REGISTRY_TS.exists() else []
    if not REGISTRY_TS.exists():
        fail(f"rules: {REGISTRY_TS} is missing")
    seen: dict[str, int] = {}
    for n in notes:
        rid = n.get("rule_id")
        seen[rid] = seen.get(rid, 0) + 1
    for rid, k in seen.items():
        if k > 1:
            fail(f"rules: {rid} has more than one RuleNote ({k})")
    if reg:
        for rid in reg:
            if rid not in seen:
                fail(f"rules: engine rule id {rid} has no RuleNote")
        for rid in seen:
            if rid not in reg:
                fail(f"rules: RuleNote {rid!r} is not in the engine registry (src/lib/waris/registry.ts)")
        order = [n.get("rule_id") for n in notes]
        if order != [r for r in reg if r in seen] and len(set(order)) == len(order):
            fail("rules: rules.json is not in the registry order of RULE_IDS (re-run build_waris.py)")

    # legal sources
    legal_ids: set[str] = set()
    for s in sources:
        sid = s.get("id", "?")
        if not isinstance(sid, str) or not LEGAL_ID.match(sid):
            fail(f"legal source {sid!r}: id must be kebab-case")
        if sid in legal_ids:
            fail(f"legal source {sid}: id used twice")
        legal_ids.add(sid)
        if s.get("kind") not in LEGAL_KINDS:
            fail(f"legal source {sid}: kind {s.get('kind')!r} not in {sorted(LEGAL_KINDS)}")
        c = s.get("citation") or {}
        if len(c.get("kitab", "")) < 2 or not re.match(r"^https?://", c.get("url", "")):
            fail(f"legal source {sid}: citation needs a title (kitab) and a URL")
        pin = s.get("pin") or {}
        if pin.get("status") == "terpasang":
            if not re.match(r"^[0-9a-f]{64}$", pin.get("sha256") or ""):
                fail(f"legal source {sid}: a pinned source needs its sha256")
        elif pin.get("status") == "belum":
            if pin.get("sha256") is not None:
                fail(f"legal source {sid}: pin.status 'belum' but a sha256 is given")
        else:
            fail(f"legal source {sid}: pin.status {pin.get('status')!r} not in ['belum', 'terpasang']")
        if len(s.get("source_doc", "")) < 5:
            fail(f"legal source {sid}: source_doc missing")
        if any(is_arabic_script(ch) for x in json_strings(s) for ch in x):
            fail(f"legal source {sid}: Arabic script")

    kind_of = {r["id"]: r.get("kind") for r in dalil + gaps if isinstance(r, dict) and "id" in r}

    def check_ids(rid: str, field: str, ids, allowed: set[str], what: str) -> None:
        if len(set(ids)) != len(ids):
            fail(f"{rid}: {field} lists an id twice")
        for x in ids:
            if x not in kind_of:
                fail(f"{rid}: {field} names unknown dalil record {x!r}")
            elif kind_of[x] not in allowed:
                fail(f"{rid}: {field} id {x!r} is a {kind_of[x]} record; {field} must cite {what}")

    def check_legal(rid: str, cites) -> None:
        for c in cites:
            if not isinstance(c, dict) or c.get("source") not in legal_ids:
                fail(f"{rid}: legal cite names unknown legal source {c.get('source') if isinstance(c, dict) else c!r}")
            elif len(c.get("locator", "")) < 2:
                fail(f"{rid}: legal cite to {c['source']} has no locator")

    for n in notes:
        rid = n.get("rule_id", "?")
        extra = set(n) - set(NOTE_KEYS)
        if extra:
            fail(f"{rid}: unknown RuleNote keys {sorted(extra)}")
        if n.get("status") != "draft":
            fail(f"{rid}: status {n.get('status')!r}; every RuleNote must be draft until the fara'id reviewer signs (plan D13)")
        for k in NOTE_LIST_KEYS:
            if not isinstance(n.get(k, []), list):
                fail(f"{rid}: {k} must be a list")
        title, summary = n.get("title_id") or "", n.get("summary_id") or ""
        if not 5 <= len(title) <= 90:
            fail(f"{rid}: title_id must be 5-90 characters")
        if not 20 <= len(summary) <= 450 or not 1 <= sentence_count(summary) <= 2:
            fail(f"{rid}: summary_id must be 1-2 sentences of 20-450 characters")
        prose = [("title_id", title), ("summary_id", summary)]
        ik, method = n.get("ikhtilaf"), n.get("method")
        if ik is not None:
            if len(ik.get("summary_id", "")) < 20 or sentence_count(ik.get("summary_id", "")) > 3:
                fail(f"{rid}: ikhtilaf.summary_id must be 1-3 sentences")
            if len(ik.get("source_doc", "")) < 5:
                fail(f"{rid}: ikhtilaf needs source_doc (where the plan records the disagreement)")
            prose.append(("ikhtilaf.summary_id", ik.get("summary_id", "")))
            check_ids(rid, "ikhtilaf.dalil", ik.get("dalil", []), NOTE_EVIDENCE_KINDS - {"gap"}, "evidence records")
            check_legal(rid, ik.get("legal", []))
        if method is not None:
            if rid not in METHOD_ONLY_RULES:
                fail(f"{rid}: a method block is allowed only on {sorted(METHOD_ONLY_RULES)}")
            if len(method.get("summary_id", "")) < 20 or len(method.get("source_doc", "")) < 5:
                fail(f"{rid}: method block needs summary_id and source_doc")
            prose.append(("method.summary_id", method.get("summary_id", "")))
        for field, text in prose:
            for p in display_prose_problems(text):
                fail(f"{rid}: {p} in {field}")
        for t in n.get("reviewer_notes", []):
            if any(is_arabic_script(ch) for ch in t):
                fail(f"{rid}: Arabic script in reviewer_notes (quote corpus bytes only through dalil records)")
        d, legal = n.get("dalil", []), n.get("legal", [])
        check_ids(rid, "dalil", d, NOTE_EVIDENCE_KINDS, "an evidence or gap record")
        check_ids(rid, "dalil_rule", n.get("dalil_rule", []), {"rule"}, "rule records")
        check_ids(rid, "related_gaps", n.get("related_gaps", []), {"gap"}, "gap records")
        check_legal(rid, legal)
        if not d and not legal and not (rid in METHOD_ONLY_RULES and method is not None):
            fail(f"{rid}: has no dalil and no legal source")
        if d and not legal and all(kind_of.get(x) == "gap" for x in d) and "belum" not in summary.lower():
            fail(f"{rid}: cites only gap records but its summary_id does not say the source is pending ('belum')")

    # rules.json is the build output of the authored file
    authored = read_json(AUTHORED_RULES, "pipeline/authored/waris.rules.json")
    if authored is not None:
        if meta.get("source_sha256") != sha_file(AUTHORED_RULES):
            fail("rules.json: meta.source_sha256 differs from pipeline/authored/waris.rules.json (re-run build_waris.py)")
        if sources != authored.get("legal_sources"):
            fail("rules.json: legal_sources differs from pipeline/authored/waris.rules.json (re-run build_waris.py)")
        by_id = {n.get("rule_id"): n for n in notes}
        for a in authored.get("rules", []):
            full = {**{k: [] for k in NOTE_LIST_KEYS}, "ikhtilaf": None, "method": None, **a}
            if by_id.get(a.get("rule_id")) != {k: full.get(k) for k in NOTE_KEYS}:
                fail(f"rules.json: {a.get('rule_id')} differs from pipeline/authored/waris.rules.json (re-run build_waris.py)")
    rules_checked = len(notes)


# ---------------------------------------------------------------- main
def read_json(p: Path, what: str):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except FileNotFoundError:
        fail(f"{what}: {p} is missing (run build_waris.py)")
    except json.JSONDecodeError as e:
        fail(f"{what}: not valid JSON: {e}")
    return None


def main(rules_only: bool | None = None, no_corpus: bool | None = None) -> int:
    global rules_checked
    warns.clear()
    rules_checked = 0
    if rules_only is None:
        rules_only = "--rules-only" in sys.argv[1:]
    if no_corpus is None:
        no_corpus = "--no-corpus" in sys.argv[1:]
    if rules_only:
        dalil = read_json(DALIL, "dalil.json")
        gaps = read_json(GAPS, "dalil-gaps.json")
        if dalil is not None and gaps is not None:
            check_rules(dalil, gaps)
        for w in warns:
            print("WARN: " + w)
        if fails:
            print(f"\nVALIDATION FAILED ({len(fails)}):", file=sys.stderr)
            for f in fails:
                print("  - " + f, file=sys.stderr)
            return 1
        print(f"OK (rules only): {rules_checked} RuleNotes, one per engine rule id in registry order; every dalil, "
              f"rule-record, gap and legal reference resolves; every note has a dalil or legal source (or is a "
              f"listed method rule); all draft; no Arabic, quotation marks, bare QS/HR or CAPS in note prose; "
              f"rules.json matches pipeline/authored/waris.rules.json.")
        return 0
    C: dict | None
    if no_corpus:
        C = None
    else:
        missing = missing_api_files()
        if missing:
            fail(f"corpus: {API_DATA} lacks {missing} (api/data is git-ignored; the corpus checks need it). "
                 f"Run with --no-corpus for the corpus-free checks only.")
            return report(0, 0)
        C = corpus()
        for pp in C["pin_problems"]:
            fail(pp)
    # 2. parity with the research copies
    for mine, docs, label in ((DALIL, DOCS_DALIL, "dalil.json"), (VECTORS, DOCS_VECTORS, "test-vectors.json")):
        if docs is not None and docs.exists():
            if not mine.exists() or mine.read_bytes() != docs.read_bytes():
                fail(f"parity: belajar/content/waris/{label} is not byte-identical to {docs} "
                     f"(the docs copy is canonical during the research phase)")
    dalil = read_json(DALIL, "dalil.json")
    gaps = read_json(GAPS, "dalil-gaps.json")
    prov = read_json(PROV, "dalil-provenance.json")
    if dalil is None or gaps is None or prov is None:
        return report(0, 0)
    if not dalil or dalil[0].get("kind") != "meta" or not gaps or gaps[0].get("kind") != "meta":
        fail("dalil.json and dalil-gaps.json must each start with their META record")
        return report(0, 0)
    meta_c = C if C is not None else {"src": load_sources(), "api_sha": None}
    check_meta(dalil[0], "dalil.json", meta_c)
    check_meta(gaps[0], "dalil-gaps.json", meta_c)
    check_references(dalil, gaps)
    check_gap_list(gaps)
    check_rules(dalil, gaps)
    counts: dict[str, int] = {}
    both = [("dalil.json", r) for r in dalil[1:]] + [("dalil-gaps.json", r) for r in gaps[1:]]
    for fname, r in both:
        k = r.get("kind")
        counts[k] = counts.get(k, 0) + 1
        if C is None:
            pass
        elif k == "quran":
            check_quran(r, C)
        elif k == "hadith":
            check_hadith(r, C)
        elif k in ("fiqh", "tafsir"):
            check_excerpt(r, C)
        elif k == "section_index":
            check_section(r, C)
        check_shown_arabic(r)
        check_prose(r, fname == "dalil-gaps.json")
    copies = check_provenance(both, prov, C)
    return report(sum(counts.values()), copies, counts, no_corpus=C is None)


def report(n: int, copies: int, counts: dict | None = None, no_corpus: bool = False) -> int:
    for w in warns:
        print("WARN: " + w)
    if fails:
        print(f"\nVALIDATION FAILED ({len(fails)}):", file=sys.stderr)
        for f in fails:
            print("  - " + f, file=sys.stderr)
        return 1
    c = counts or {}
    if no_corpus:
        print(f"OK (no corpus): {n} dalil records ({', '.join(f'{k} {v}' for k, v in sorted(c.items()))}); META pins "
              f"agree with sources.json; {copies} provenance entries cover every copied field and their copied_sha256 "
              f"match the record bytes; no running head or page-break digit run in shown Arabic; no Arabic in Indonesian prose; references resolve; plan §8 gap list present "
              f"({len(EXPECTED_EXTRACTED)} extracted, {len(EXPECTED_GAPS)} external); research-phase parity holds where "
              f"the docs copies exist; {rules_checked} RuleNotes, one per engine rule id, every reference resolves, all "
              f"draft.\nSKIPPED (need api/data and pipeline/cache; run without --no-corpus locally): "
              f"{'; '.join(NO_CORPUS_SKIPPED)}.")
        return 0
    print(f"OK: {n} dalil records ({', '.join(f'{k} {v}' for k, v in sorted(c.items()))}); Qur'an byte-identical to "
          f"Tanzil; hadith/kitab/tafsir bytes and {copies} provenance hashes match api/data and the pins; spans on "
          f"word boundaries, running heads cut only where they are running heads, Bulugh footnotes outside the shown span; no Arabic in Indonesian prose; plan §8 gap list "
          f"present ({len(EXPECTED_EXTRACTED)} extracted, {len(EXPECTED_GAPS)} external); research-phase parity holds "
          f"where the docs copies exist; {rules_checked} RuleNotes, one per engine rule id, every reference resolves, "
          f"all draft.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
