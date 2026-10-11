#!/usr/bin/env python3
"""Stage 2 'Assemble' for the shared library: build belajar/content/library.json (Library, schema.ts).

Inputs (pinned in sources.json and verified by sha256 before use):
  QAC 0.4 morphology, Tanzil Uthmani 1.1 (only to byte-check «…» quotations in prose),
  authored/library.lexicon.json (Kosakata + Akar, author A) and, when present,
  authored/library.concepts.json (Konsep, author B; passed through after a shape check, minus
  each record's reviewer-only `review_notes`), authored/library.terms.json (grammar terms in
  Arabic script, each spelling attested by the pronunciation dictionary or a Shamela page pinned
  by its text sha256, sources.json `shamela_istilah`), authored/library.basics.json (the Harakat
  page) and authored/library.parts.json (words explained by their parts). The Konsep prose
  carries inline markup (terms.py: [[majrur]], [[bismi|q:1:1:1]], …): every field is checked,
  stripped into the plain field (narration and metadata read those) and shipped marked beside it,
  and every Qur'anic ref's bytes go to `quran` from Tanzil and QAC (operator 2026-10-10: terms
  and words in Arabic, never retyped).

Covered surahs: every surah registered in common.SURAHS whose authored/<slug>.words.json exists,
in mushaf order (`--only <slug> ...` narrows the set, e.g. to rebuild the Al-Fatihah-only file).
Lemmas and roots are listed in reading order of first occurrence across the covered surahs, so
adding a later surah appends records and never reorders the earlier ones.

Data-derived here, never typed: the list of lemmas and roots the covered surahs need, lemma_ar
(QAC LEM, Buckwalter -> Arabic), root letters, pos (build_surah.pos_label), lemma and root
counts, root ids, root lemma lists, QAC source refs. Typed in the authored file: translit,
meaning, tashrif rows, i'lal, root meaning, kitab refs. Every record is status "draft".
The build stops (exit 1) on any structural or sourcing problem. No network, no LLM.
"""
from __future__ import annotations

import json
import re
import sys
import urllib.parse
from collections import Counter

import build_surah
import terms as TM
import validate as V
from common import (ARABIC_RUN, CONTENT_DIR, PIPELINE, SCHEMA_TS, SURAH_BY_SLUG, authored_file, authored_surahs,
                    bw_to_ar, lesson_ayah, load_qac, load_sources, load_tanzil, qac_words, require_pinned,
                    root_letters, sha256_file, stem_of)
from facts import QAC_BASIS, QAC_TANZIL_HEADER, fmt, refs_text

LEXICON = PIPELINE / "authored" / "library.lexicon.json"
CONCEPTS = PIPELINE / "authored" / "library.concepts.json"
TERMS_FILE = TM.TERMS_JSON  # grammar terms in Arabic script (operator 2026-10-10)
PRONUNCIATION = TM.PRONUNCIATION_JSON
BASICS = PIPELINE / "authored" / "library.basics.json"  # Dasar membaca: the Harakat page
PARTS = PIPELINE / "authored" / "library.parts.json"  # words explained by their parts (rule 14)
OUT = CONTENT_DIR / "library.json"
SURAHS = [1]  # surahs whose every stem lemma and root must have a library entry (set in main)
WORDS = {1: authored_file("al-fatihah", "words")}  # surah -> authored word file (set in main)


def qac_basis(surahs: list[int]) -> str:
    """facts.QAC_BASIS for Al-Fatihah alone (unchanged), naming every covered surah otherwise;
    validate.py byte-checks the QAC words of every lesson surah against Tanzil 1.1."""
    if surahs == [1]:
        return QAC_BASIS
    return QAC_BASIS.replace("surah 1 identik", f"surah {refs_text([str(s) for s in surahs])} identik")


QAC_KITAB = "Quranic Arabic Corpus 0.4 (morfologi)"
ID_RE = re.compile(r"^[a-z0-9-]+$")
LOC_RE = re.compile(r"^\d{1,3}:\d{1,3}:\d{1,3}$")

# Amtsilah at-Tashrifiyyah row order (istilahi + lughawi columns, as taught). A row may skip forms
# (only what the sources support) but never reorder them.
TASHRIF_ORDER = ["fi'il madhi", "fi'il mudhari'", "mashdar", "isim fa'il", "isim maf'ul", "fi'il amr",
                 "fi'il nahi", "isim zaman/makan", "isim alat"]
# QAC verb form (VF) of the tashrif's verb -> the wazan its `bab` must name.
BAB_FOR_VF = {"I": "Tsulatsi mujarrad", "II": "فَعَّلَ", "III": "فَاعَلَ", "IV": "أَفْعَلَ", "V": "تَفَعَّلَ",
              "VI": "تَفَاعَلَ", "VII": "اِنْفَعَلَ", "VIII": "اِفْتَعَلَ", "IX": "اِفْعَلَّ", "X": "اِسْتَفْعَلَ"}
VERB_FORMS = ["II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"]
# Typed (non-Qur'anic) Arabic: imla'i letters + harakat only. Superscript alif, alif wasla, tatweel
# and the Qur'anic annotation marks are Uthmani-only and are rejected, so a tashrif form can never
# pass for (or be mistaken for) mushaf text.
# Letters U+0621–U+063A and U+0641–U+064A (U+063B–U+0640, which include tatweel, are left out);
# harakat and tanwin U+064B–U+0652.
IMLAI = (set(chr(c) for c in range(0x0621, 0x063B)) | set(chr(c) for c in range(0x0641, 0x064B))
         | set(chr(c) for c in range(0x064B, 0x0653)) | {" ", "،"})
# Root id: QAC Buckwalter root letters -> ASCII tokens joined by '-'. One token per letter and no
# token repeats, so the id is unique for every root (ح hh vs ه h; ص sh vs ش sy; ع ain).
ROOT_ID_TOKEN = {
    "A": "a", "b": "b", "t": "t", "v": "ts", "j": "j", "H": "hh", "x": "kh", "d": "d", "*": "dz", "r": "r",
    "z": "z", "s": "s", "$": "sy", "S": "sh", "D": "dh", "T": "th", "Z": "zh", "E": "ain", "g": "gh",
    "f": "f", "q": "q", "k": "k", "l": "l", "m": "m", "n": "n", "h": "h", "w": "w", "y": "y",
}
assert len(set(ROOT_ID_TOKEN.values())) == len(ROOT_ID_TOKEN)
# QAC POS tags named in an occurrence method when one lemma carries more than one of them.
POS_NAME = {"N": "isim", "ADJ": "isim sifat", "PN": "isim 'alam", "T": "keterangan waktu", "V": "fi'il",
            "NEG": "huruf nafi", "PRO": "larangan", "REL": "isim maushul", "COND": "makna syarat",
            "P": "huruf jar", "PRON": "dhamir", "DEM": "isim isyarah",
            # QAC tagset names (corpus.quran.com/documentation/tagset.jsp), for mā and idzā:
            "PREV": "pencegah (kaffah)", "INTG": "kata tanya (istifham)", "SUB": "huruf mashdariyyah",
            "SUP": "tambahan (zaidah)", "SUR": "kejutan (fuja'iyyah)"}
ASPECT = [("PERF", "madhi"), ("IMPF", "mudhari'"), ("IMPV", "amr")]

errors: list[str] = []
warnings: list[str] = []


def err(msg: str) -> None:
    errors.append(msg)


# ---------------------------------------------------------------- helpers
def root_id(bw_root: str) -> str:
    return "-".join(ROOT_ID_TOKEN[c] for c in bw_root)


def qac_url(bw_root: str | None, first_loc: tuple[int, int, int]) -> str:
    if bw_root:
        return "https://corpus.quran.com/qurandictionary.jsp?q=" + urllib.parse.quote(bw_root, safe="")
    s, a, _ = first_loc
    return f"https://corpus.quran.com/wordbyword.jsp?chapter={s}&verse={a}"


def expand_src(spec, kitab: dict, where: str, tag: str = "") -> dict | None:
    """spec = [abbr, ref, url_id]. url_id fills {id} in the kitab's url template (null = no url);
    a template without {id} is a fixed url (e.g. the archive.org scan) and is used as is."""
    if not isinstance(spec, list) or len(spec) != 3:
        err(f"{where}: src item must be [abbr, ref, url_id], got {spec!r}")
        return None
    abbr, ref, uid = spec
    k = kitab.get(abbr)
    if not k:
        err(f"{where}: unknown kitab abbreviation {abbr!r}")
        return None
    if not isinstance(ref, str) or len(ref) < 5:
        err(f"{where}: src {abbr} needs a ref that locates the claim (volume/page/entry)")
        return None
    out = {"kitab": k["kitab"], "ref": (f"({tag}) " if tag else "") + ref}
    url = k.get("url")
    if url and "{id}" in url:
        if uid is not None:
            out["url"] = url.replace("{id}", str(uid))
    elif url:
        if uid is not None:
            err(f"{where}: src {abbr} gives url id {uid!r} but the kitab url has no {{id}}")
        out["url"] = url
    return out


def dedupe(sources: list[dict]) -> list[dict]:
    seen, out = set(), []
    for s in sources:
        key = json.dumps(s, sort_keys=True, ensure_ascii=False)
        if key not in seen:
            seen.add(key)
            out.append(s)
    return out


def check_typed_arabic(s: str, where: str) -> None:
    if not s or not ARABIC_RUN.search(s):
        err(f"{where}: expected Arabic, got {s!r}")
        return
    bad = sorted({c for c in s if c not in IMLAI})
    if bad:
        err(f"{where}: {s!r} has characters outside imla'i Arabic letters + harakat: "
            + ", ".join(f"U+{ord(c):04X}" for c in bad))


def number_of(st) -> str | None:
    f = set(st.flags)
    if f & {"MP", "FP", "P"}:
        return "P"
    if f & {"MD", "FD", "D"}:
        return "D"
    return None


def lemma_pos(st, hits) -> str:
    """Lemma-level learner label: the word-card label of the stem (build_surah.pos_label), with
    verbs as plain "fi'il" (aspect belongs to a word, not a lemma) and the number mark dropped
    unless every QAC occurrence of the lemma has it (e.g. ‘ālamīn, always plural)."""
    if st.tag == "V":
        return "fi'il"
    label = build_surah.pos_label([st])
    nums = {number_of(g) for g in hits}
    if nums != {"P"}:
        label = label.replace(" (jamak)", "")
    if nums != {"D"}:
        label = label.replace(" (mutsanna)", "")
    return label


def vf_of(st) -> str:
    tagged = [f.strip("()") for f in st.flags if f.startswith("(") and f.strip("()") in VERB_FORMS]
    return tagged[0] if tagged else "I"


def pos_breakdown(hits) -> str:
    c = Counter(g.feat.get("POS") for g in hits)
    if len(c) < 2:
        return ""
    parts = []
    for tag, n in c.most_common():
        name = POS_NAME.get(tag)
        if not name:
            warnings.append(f"POS tag {tag} has no Indonesian name in POS_NAME; shown raw")
        parts.append(f"{tag} ({name}) {fmt(n)}" if name else f"{tag} {fmt(n)}")
    return f" QAC memberi lemma ini lebih dari satu tag kelas kata: {', '.join(parts)}."


PGN = re.compile(r"^[123]?[MF]?[SDP]$")


def feature_breakdown(hits) -> str:
    """For the QAC source ref: POS tags and, for pronouns/relatives/demonstratives, the
    person-gender-number features the lemma covers (e.g. LEM:{l~a*iY = MP, MS, FS, FP, MD)."""
    out = []
    pos = Counter(g.feat.get("POS") for g in hits)
    if len(pos) > 1:
        out.append("tag kelas kata " + ", ".join(f"{t} {fmt(n)}" for t, n in pos.most_common()))
    if set(pos) & {"PRON", "REL", "DEM"}:
        pgn = Counter(next((f for f in g.flags if PGN.match(f)), "-") for g in hits)
        out.append("fitur orang/jenis/bilangan " + ", ".join(f"{t} {fmt(n)}" for t, n in pgn.most_common()))
    return "; " + "; ".join(out) if out else ""


def check_lengths(obj: dict, rules: dict, where: str) -> None:
    for key, n in rules.items():
        v = obj.get(key)
        if v is not None and isinstance(v, (str, list)) and len(v) < n:
            err(f"{where}.{key}: shorter than the schema minimum ({n})")


def check_sources(srcs: list, where: str) -> None:
    if not srcs:
        err(f"{where}: no sources")
    for i, s in enumerate(srcs):
        V.check_source(s, f"{where}.sources[{i}]")


# ---------------------------------------------------------------- main
def main(only: list[str] | None = None) -> int:
    global SURAHS, WORDS
    specs = [SURAH_BY_SLUG[x] for x in only] if only else authored_surahs()
    specs = sorted(specs, key=lambda sp: sp.surah)
    if not specs:
        err("no covered surah: no authored/<slug>.words.json for any slug in common.SURAHS")
        return finish(None)
    SURAHS = [sp.surah for sp in specs]
    WORDS = {sp.surah: authored_file(sp.slug, "words") for sp in specs}
    basis = qac_basis(SURAHS)
    src = load_sources()
    I = src["inputs"]
    segs, qac_header = load_qac(require_pinned(src, "qac_morphology"))
    T = load_tanzil(require_pinned(src, "tanzil_uthmani"))
    if QAC_TANZIL_HEADER not in qac_header:
        err(f"QAC header no longer names '{QAC_TANZIL_HEADER}'; the QAC_BASIS note would be wrong")
    qsha = I["qac_morphology"]["sha256"]
    W = qac_words(segs)
    stems = [g for g in segs if "STEM" in g.flags]
    by_lem: dict[str, list] = {}
    by_root: dict[str, list] = {}
    for g in stems:
        if "LEM" in g.feat:
            by_lem.setdefault(g.feat["LEM"], []).append(g)
        if "ROOT" in g.feat:
            by_root.setdefault(g.feat["ROOT"], []).append(g)

    # ---- what the covered surahs need (reading order of first occurrence)
    need_lem: dict[str, object] = {}  # LEM -> first stem segment
    need_root: dict[str, object] = {}
    for key in sorted(W):
        if key[0] not in SURAHS:
            continue
        st = stem_of(W[key])
        if "LEM" not in st.feat:
            if st.tag == "PRON":  # QAC 0.4 leaves some pronoun stems without a lemma (112:1:2, 112:4:3)
                warnings.append(f"QAC word {':'.join(map(str, key))} ({st.tag}) has no LEM: no lexeme for it")
            else:
                err(f"QAC word {':'.join(map(str, key))} has no LEM")
            continue
        need_lem.setdefault(st.feat["LEM"], st)
        if "ROOT" in st.feat:
            need_root.setdefault(st.feat["ROOT"], st)

    A = json.loads(LEXICON.read_text(encoding="utf-8"))
    kitab = A["kitab"]
    entries = {e["qac_lem"]: e for e in A["lexicon"]}
    if len(entries) != len(A["lexicon"]):
        err("authored lexicon: duplicate qac_lem")
    for lem in need_lem:
        if lem not in entries:
            err(f"no authored lexicon entry for QAC LEM {lem!r} ({bw_to_ar(lem)}), needed by surah {SURAHS}")
    for lem in entries:
        if lem not in by_lem:
            err(f"authored lexicon entry {lem!r} matches no QAC 0.4 lemma")
        elif lem not in need_lem:
            warnings.append(f"lexicon entry {lem!r} is not used by the covered surahs {SURAHS}")
    rentries = {r["qac_root"]: r for r in A["roots"]}
    if len(rentries) != len(A["roots"]):
        err("authored roots: duplicate qac_root")
    for r in need_root:
        if r not in rentries:
            err(f"no authored root entry for QAC ROOT {r!r} ({' '.join(root_letters(r))})")
    for r in rentries:
        if r not in by_root:
            err(f"authored root entry {r!r} matches no QAC 0.4 root")
    if errors:
        return finish(None)

    # ---- lexicon
    lexicon, lex_by_lem, prose = [], {}, []
    order = [lem for lem in need_lem] + [lem for lem in entries if lem not in need_lem]
    for lem in order:
        e = entries[lem]
        where = f"lexicon[{e.get('id')}]"
        hits = by_lem[lem]
        st = need_lem.get(lem) or hits[0]
        roots = {g.feat.get("ROOT") for g in hits}
        if len(roots) != 1:
            err(f"{where}: QAC gives LEM {lem} more than one root {roots}")
        bw_root = next(iter(roots))
        if not ID_RE.match(e.get("id", "")):
            err(f"{where}: id must match {ID_RE.pattern}")
        if set(e["translit"]) - V.TRANSLIT_OK or V.TRANSLIT_BAD.search(e["translit"]):
            err(f"{where}: translit {e['translit']!r} outside the SKB 158/1987 character set")
        pos = lemma_pos(st, hits)
        if e.get("pos"):
            if not e.get("pos_note"):
                err(f"{where}: authored pos override {e['pos']!r} needs a pos_note (QAC-derived: {pos!r})")
            pos = e["pos"]
        first = (st.s, st.a, st.w)
        loc = ":".join(map(str, first))
        sources = [expand_src(sp, kitab, where) for sp in e.get("src", [])]
        prose.append((f"{where}.meaning", e["meaning"]))

        out = {"id": e["id"], "lemma_ar": bw_to_ar(lem), "translit": e["translit"],
               "root": root_letters(bw_root) if bw_root else None, "pos": pos, "meaning": e["meaning"]}

        t = e.get("tashrif")
        if t:
            tw = f"{where}.tashrif"
            vl = t.get("verb_lem")
            vh = [g for g in by_lem.get(vl, []) if g.feat.get("POS") == "V"]
            if not vh:
                err(f"{tw}: verb_lem {vl!r} is not a QAC 0.4 verb lemma")
            elif {g.feat.get("ROOT") for g in vh} != {bw_root}:
                err(f"{tw}: verb_lem {vl!r} has root {({g.feat.get('ROOT') for g in vh})}, lexeme has {bw_root!r}")
            labels = [f["label"] for f in t["forms"]]
            if any(lb not in TASHRIF_ORDER for lb in labels):
                err(f"{tw}: labels must be from {TASHRIF_ORDER}, got {labels}")
            elif [TASHRIF_ORDER.index(lb) for lb in labels] != sorted(TASHRIF_ORDER.index(lb) for lb in labels) \
                    or len(set(labels)) != len(labels):
                err(f"{tw}: forms out of the Amtsilah order (or repeated): {labels}")
            aspects = Counter(next((name for flag, name in ASPECT if flag in g.flags), "-") for g in vh)
            if "fi'il amr" in labels and not aspects.get("amr"):
                err(f"{tw}: a fi'il amr form needs QAC to tag {vl} IMPV somewhere (it does not)")
            vfs = {vf_of(g) for g in vh}
            # QAC marks only forms II-XII; an unmarked verb on a four-letter root (w-s-w-s,
            # yuwaswisu 114:5:2) is the basic ruba'i form, not tsulatsi form I.
            quad = bool(bw_root) and len(bw_root) == 4
            if len(vfs) > 1:
                err(f"{tw}: QAC verb forms of {vl} are mixed: {vfs}")
            elif vfs:
                vf = next(iter(vfs))
                want = "Ruba'i mujarrad" if quad and vf == "I" else BAB_FOR_VF.get(vf, "\0")
                if quad and vf != "I":
                    err(f"{tw}: four-letter root {bw_root} with QAC verb form {vf}: no ruba'i mazid bab mapped yet")
                elif want not in t["bab"]:
                    err(f"{tw}: QAC verb form {vf} for {vl} but bab {t['bab']!r} does not name {want!r}")
            for run in ARABIC_RUN.findall(t["bab"]):
                check_typed_arabic(run, f"{tw}.bab")
            for i, f in enumerate(t["forms"]):
                check_typed_arabic(f["ar"], f"{tw}.forms[{i}]")
            attest = []
            for al in t.get("attest", []):
                ah = by_lem.get(al)
                if not ah:
                    err(f"{tw}: attest lemma {al!r} not in QAC 0.4")
                elif {g.feat.get("ROOT") for g in ah} != {bw_root}:
                    err(f"{tw}: attest lemma {al!r} has another root")
                else:
                    attest.append(f"LEM:{al} {fmt(len(ah))}")
            out["tashrif"] = {"bab": t["bab"], "forms": [{"label": f["label"], "ar": f["ar"]} for f in t["forms"]]}
            sources += [expand_src(sp, kitab, tw, "tashrif") for sp in t.get("src", [])]
            asp = ", ".join(f"{name} {fmt(aspects[name])}" for _, name in ASPECT if aspects.get(name))
            sources.append({
                "kitab": QAC_KITAB,
                "ref": f"(tashrif) sha256:{qsha[:16]}; fi'il LEM:{vl}, bentuk kata kerja (VF) "
                       f"{'/'.join(sorted(vfs)) or '?'} (QAC menandai II–XII; tanpa tanda = I"
                       + ("; akar empat huruf, jadi bentuk dasarnya ruba'i mujarrad" if quad else "") + "), "
                       f"dipakai {fmt(len(vh))} kali: {asp}"
                       + (f"; bentuk lain dari baris ini yang dipakai Al-Qur'an: {', '.join(attest)}" if attest else ""),
                "url": qac_url(bw_root, first)})

        ilal = []
        for i, il in enumerate(e.get("ilal", [])):
            iw = f"{where}.ilal[{i}]"
            check_typed_arabic(il["from"], f"{iw}.from")
            check_typed_arabic(il["to"], f"{iw}.to")
            if len(il.get("rule", "")) < 10:
                err(f"{iw}.rule: too short")
            if not il.get("src"):
                err(f"{iw}: an i'lal entry needs its own src")
            prose.append((f"{iw}.rule", il["rule"]))
            ilal.append({"from": il["from"], "to": il["to"], "rule": il["rule"]})
            sources += [expand_src(sp, kitab, iw, "i'lal") for sp in il.get("src", [])]
        out["ilal"] = ilal

        ayat = {(g.s, g.a) for g in hits}
        method = (f"{basis}: jumlah segmen STEM dengan LEM:{lem} (lemma kata {loc}), dalam {fmt(len(ayat))} "
                  f"ayat; ayat dihitung sekali walau memuat kata ini lebih dari sekali.{pos_breakdown(hits)}")
        if any(g.s == 1 and g.a == 1 for g in hits):
            method += " QAC tidak memuat basmalah pembuka surah, tetapi memuat 1:1 dan 27:30."
        out["occurrences"] = {"count": len(hits), "ayat": len(ayat), "method": method}
        sources.append({"kitab": QAC_KITAB,
                        "ref": f"sha256:{qsha[:16]}; LEM:{lem} — bentuk lemma, akar, kelas kata (dari kata {loc}: "
                               + " + ".join(f"{g.tag}|{g.features}" for g in W[first]) + "), jumlah kemunculan"
                               + feature_breakdown(hits),
                        "url": qac_url(bw_root, first)})
        out["sources"] = dedupe([s for s in sources if s])
        out["status"] = "draft"
        check_lengths(out, {"lemma_ar": 1, "translit": 1, "pos": 2, "meaning": 2}, where)
        check_sources(out["sources"], where)
        lexicon.append(out)
        lex_by_lem[lem] = out
    ids = [x["id"] for x in lexicon]
    for dup in sorted({i for i in ids if ids.count(i) > 1}):
        err(f"lexicon id {dup!r} used twice")

    # ---- roots
    roots = []
    r_order = [r for r in need_root] + [r for r in rentries if r not in need_root]
    for r in r_order:
        e = rentries[r]
        where = f"roots[{r}]"
        hits = by_root[r]
        st = need_root.get(r) or hits[0]
        loc = f"{st.s}:{st.a}:{st.w}"
        lemmas = [lex_by_lem[lem]["id"] for lem in lex_by_lem if by_lem[lem][0].feat.get("ROOT") == r]
        if not lemmas:
            err(f"{where}: no lexicon entry has this root")
        named = []
        for m in e.get("mentions", []):
            mh = by_lem.get(m)
            if not mh:
                err(f"{where}: mention {m!r} is not a QAC 0.4 lemma")
            elif {g.feat.get("ROOT") for g in mh} != {r}:
                err(f"{where}: mention {m!r} is not under ROOT:{r} in QAC 0.4")
            else:
                named.append(f"LEM:{m} {fmt(len(mh))}")
        unrooted = []
        for m in e.get("mentions_without_root", []):
            mh = by_lem.get(m)
            if not mh:
                err(f"{where}: mention_without_root {m!r} is not a QAC 0.4 lemma")
            elif any("ROOT" in g.feat for g in mh):
                err(f"{where}: {m!r} does have a root in QAC 0.4")
            else:
                unrooted.append(f"LEM:{m} {fmt(len(mh))}")
        if len(e.get("meaning", "")) < 5:
            err(f"{where}.meaning: too short")
        prose.append((f"{where}.meaning", e["meaning"]))
        ayat = {(g.s, g.a) for g in hits}
        nlem = len({g.feat.get("LEM") for g in hits})
        translits = [x["translit"] for x in lexicon if x["id"] in lemmas]
        sources = [expand_src(sp, kitab, where) for sp in e.get("src", [])]
        sources.append({
            "kitab": QAC_KITAB,
            "ref": f"sha256:{qsha[:16]}; ROOT:{r} — {fmt(len(hits))} segmen STEM dalam {fmt(len(ayat))} ayat, "
                   f"{nlem} lemma"
                   + (f"; lemma yang disebut di keterangan: {', '.join(named)}" if named else "")
                   + (f"; disebut di keterangan, tanpa akar di QAC: {', '.join(unrooted)}" if unrooted else ""),
            "url": qac_url(r, (st.s, st.a, st.w))})
        out = {
            "id": root_id(r), "letters": root_letters(r), "meaning": e["meaning"], "lemmas": lemmas,
            "occurrences": {
                "count": len(hits),
                "method": f"{basis}: jumlah segmen STEM dengan ROOT:{r} (akar kata {loc}), dalam "
                          f"{fmt(len(ayat))} ayat. Hitungan ini menggabungkan semua {nlem} lemma seakar di QAC, "
                          f"termasuk yang maknanya berjauhan. Lemma akar ini yang sudah ada di Kosakata: "
                          f"{', '.join(translits)}."},
            "sources": dedupe([s for s in sources if s]), "status": "draft"}
        if not 2 <= len(out["letters"]) <= 4:
            err(f"{where}: {len(out['letters'])} root letters (schema allows 2–4)")
        check_sources(out["sources"], where)
        roots.append(out)
    rids = [x["id"] for x in roots]
    for dup in sorted({i for i in rids if rids.count(i) > 1}):
        err(f"root id {dup!r} used twice")

    # ---- concepts (author B): passed through, shape-checked
    concepts, concepts_ver = [], "none (authored/library.concepts.json not present)"
    if CONCEPTS.exists():
        raw_c = json.loads(CONCEPTS.read_text(encoding="utf-8"))
        concepts = raw_c["concepts"] if isinstance(raw_c, dict) else raw_c
        # `review_notes` (reviewer-only, as in the lexicon and lesson files) never reach the output.
        for c in concepts:
            rn = c.get("review_notes", [])
            if not isinstance(rn, list) or not all(isinstance(t, str) and len(t) >= 10 for t in rn):
                err(f"concepts[{c.get('id')}]: review_notes must be a list of sentences")
        concepts = [{k: v for k, v in c.items() if k != "review_notes"} for c in concepts]
        concepts_ver = f"authored/library.concepts.json sha256:{sha256_file(CONCEPTS)}"
        covered_locs = {":".join(map(str, k)) for k in W if k[0] in SURAHS}
        cids = [c.get("id") for c in concepts]
        for c in concepts:
            cw = f"concepts[{c.get('id')}]"
            if not ID_RE.match(c.get("id") or ""):
                err(f"{cw}: id must match {ID_RE.pattern}")
            if c.get("kind") not in ("nahwu", "sharaf"):
                err(f"{cw}: kind must be nahwu or sharaf")
            check_lengths(c, {"title": 3, "summary": 15}, cw)
            ex = c.get("explanation") or []
            if not 1 <= len(ex) <= 4 or any(len(p) < 20 for p in ex):
                err(f"{cw}: explanation must be 1–4 paragraphs of ≥20 characters")
            for x in c.get("examples") or []:
                if not LOC_RE.match(x.get("loc", "")) or len(x.get("note", "")) < 5:
                    err(f"{cw}: bad example {x!r}")
                elif x["loc"] not in covered_locs:
                    warnings.append(f"{cw}: example {x['loc']} is not a word of the covered surahs")
            if not c.get("examples"):
                err(f"{cw}: needs ≥1 example")
            for rel in c.get("related") or []:
                if rel not in cids:
                    err(f"{cw}: related {rel!r} is not a concept id")
            check_sources(c.get("sources") or [], cw)
        for dup in sorted({i for i in cids if cids.count(i) > 1}):
            err(f"concept id {dup!r} used twice")
    # ---- terms in Arabic script + the inline markup; plain fields from here on (terms.py)
    extra = markup_section(concepts, T, W, src)
    if CONCEPTS.exists():
        for c in concepts:
            cw = f"concepts[{c.get('id')}]"
            prose += [(f"{cw}.title", c.get("title", "")), (f"{cw}.summary", c.get("summary", ""))]
            prose += [(f"{cw}.explanation[{i}]", t) for i, t in enumerate(c.get("explanation") or [])]
            if c.get("bridge"):
                prose.append((f"{cw}.bridge", c["bridge"]))
            prose += [(f"{cw}.examples[{i}].note", x.get("note", "")) for i, x in enumerate(c.get("examples") or [])]

    prose += extra["prose"]
    # ---- prose (lexicon, roots and concepts together, as the app shows them side by side): no
    # unquoted Arabic words, «…» quotes byte-exact in Tanzil, SKB transliteration
    for path, text in prose:
        V.check_prose(text, T.raw, path)
    skb_words = {x["translit"] for x in lexicon}
    for s, p in WORDS.items():
        if p.exists():
            skb_words |= {w["translit"] for w in json.loads(p.read_text(encoding="utf-8"))["words"].values()}
    V.check_translit_prose(prose, skb_words)

    data_versions = {
        "qac": f"{I['qac_morphology']['version']} sha256:{qsha}",
        "tanzil": f"uthmani-{I['tanzil_uthmani']['version']} sha256:{I['tanzil_uthmani']['sha256']} "
                  f"(only to byte-check «…» quotations in prose)",
        "authored_lexicon": f"authored/library.lexicon.json sha256:{sha256_file(LEXICON)}",
        "authored_concepts": concepts_ver,
        **extra["versions"],
        "pipeline": "belajar/pipeline/build_library.py (stdlib only, no LLM)",
    }
    out = {"concepts": concepts, "lexicon": lexicon, "roots": roots, "basics": extra["basics"],
           "terms": extra["terms"], "parts": extra["parts"], "quran": extra["quran"],
           "segments": extra["segments"], "data_versions": data_versions}

    # ---- shape against schema.ts (keys, nesting, enums) + status
    schemas, enums = V.parse_schema(SCHEMA_TS.read_text(encoding="utf-8"))
    V.check_shape(out, schemas["Library"], schemas, enums, "library")
    for kind, recs in (("concept", concepts), ("lexeme", lexicon), ("root", roots), ("basic", extra["basics"]),
                       ("parts", extra["parts"])):
        for x in recs:
            if x.get("status") != "draft":
                err(f"{kind} {x.get('id')}: status must be 'draft' (pipeline state; plan L11)")
    errors.extend(V.fails)
    errors.extend(build_surah.errors)
    return finish(out)


# ---------------------------------------------------------------- terms in Arabic script, markup
# Operator 2026-10-10 on /konsep: "mention the arabic word like majrur in arabic letter etc, not
# only the transliteration" (and the earlier rules: Qur'anic words in Arabic from content bytes,
# the harakat for beginners, words explained by their parts). terms.py has the markup and the term
# checks; here every marked prose field is checked, stripped into the plain field the app,
# narration and metadata read, and kept marked beside it; every q-ref is resolved from the pinned
# Tanzil text and QAC 0.4 into library.json `quran`.
LETTER_NAMES = {  # a letter q-ref's surface must name its letter (rule 7: the letter as in the ayah)
    "ا": {"alif"}, "ب": {"ba’", "ba'"}, "ت": {"ta’", "ta'"}, "ث": {"tsa’"}, "ج": {"jim"}, "ح": {"ha’"},
    "خ": {"kha’"}, "د": {"dal"}, "ذ": {"dzal"}, "ر": {"ra’", "ra"}, "ز": {"zai"}, "س": {"sin"}, "ش": {"syin"},
    "ص": {"shad"}, "ض": {"dhad"}, "ط": {"tha’"}, "ظ": {"zha’"}, "ع": {"‘ain"}, "غ": {"ghain"}, "ف": {"fa’"},
    "ق": {"qaf"}, "ك": {"kaf"}, "ل": {"lam"}, "م": {"mim"}, "ن": {"nun"}, "و": {"wawu"}, "ه": {"ha’"},
    "ي": {"ya’", "ya'"}, "ى": {"ya’", "alif"}, "ء": {"hamzah"}, "أ": {"hamzah", "alif"}, "إ": {"hamzah", "alif"},
}
PAUSAL = re.compile(r"(un|in|an|u|i|a)$")


def markup_section(concepts: list[dict], T, W, src: dict) -> dict:
    table = TM.load_terms(TERMS_FILE)
    pron = TM.load_pronunciation(PRONUNCIATION)
    meta = src["inputs"]["shamela_istilah"]
    page_text = {}
    for pk, pm in meta["pages"].items():
        book, page = pk.split("/")
        f = PIPELINE / meta["cache_dir"] / book / f"{page}.txt"
        if not f.exists():
            err(f"shamela_istilah {pk}: not in the cache; run fetch.py")
        elif sha256_file(f) != pm.get("text_sha256"):
            err(f"shamela_istilah {pk}: cached text does not match its pin; run fetch.py")
        else:
            page_text[pk] = f.read_text(encoding="utf-8")
    e, report = TM.check_table(table, pron, meta["pages"], meta["books"], page_text)
    for x in e:
        err(x)
    warnings.extend(report)
    by_id, by_form = TM.term_index(table)
    translit = {}
    for p in WORDS.values():
        if p.exists():
            translit.update({loc: w["translit"] for loc, w in json.loads(p.read_text(encoding="utf-8"))["words"].items()})

    def tanzil_token(s, a, w):
        if (s, a) not in T.verses:
            return None
        toks = lesson_ayah(T, s, a)[0].split(" ")
        return toks[w - 1] if 1 <= w <= len(toks) else None

    def qac_segments(s, a, w):
        return [bw_to_ar(g.form) for g in W.get((s, a, w), [])]

    refs: set[str] = set()

    def same_surface(surface: str, want: str, last: bool) -> bool:
        s = surface if surface.startswith("All") else surface[:1].lower() + surface[1:]
        return s == want or (last and PAUSAL.search(want) is not None and s == PAUSAL.sub("", want))

    def check_q(surface: str, ref: str, where: str) -> None:
        m = TM.QREF.match(ref)
        s, a, w = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if m.group(4):  # a run: each word's transliteration, the last may be pausal (aḥad)
            locs = [f"{s}:{a}:{k}" for k in range(w, int(m.group(4)) + 1)]
            if all(l in translit for l in locs):
                words = surface.split(" ")
                want = [translit[l] for l in locs]
                # multi-word transliterations (wa lā) count as their words
                flat = " ".join(want).split(" ")
                if len(words) != len(flat) or not all(same_surface(x, y, i == len(flat) - 1)
                                                      for i, (x, y) in enumerate(zip(words, flat))):
                    err(f"{where}: [[{surface}|{ref}]]: the words are {' '.join(want)!r}")
        elif m.group(6):  # a letter: the surface names that letter
            try:
                letter = TM.letter_of(tanzil_token(s, a, w) or "", int(m.group(6)))
            except ValueError as x:
                err(f"{where}: {x}")
                return
            if surface.lower() not in LETTER_NAMES.get(letter[0], set()):
                err(f"{where}: [[{surface}|{ref}]] names the letter {letter[0]}, whose name is "
                    f"{sorted(LETTER_NAMES.get(letter[0], {'?'}))}")
        elif not m.group(5) and f"{s}:{a}:{w}" in translit:
            if not same_surface(surface, translit[f"{s}:{a}:{w}"], False):
                err(f"{where}: [[{surface}|{ref}]]: the word's transliteration is {translit[f'{s}:{a}:{w}']!r}")
        if not m.group(6):  # every word, run and segment: the Latin names the bytes (terms.surface_matches)
            try:
                ar = TM.resolve_q(ref, tanzil_token, qac_segments)
            except ValueError as x:
                err(f"{where}: {x}")
                return
            if not TM.surface_matches(surface, ar):
                err(f"{where}: [[{surface}|{ref}]]: {surface!r} does not name {ar} "
                    f"(consonants {TM.skeleton_latin(surface)!r} vs {TM.skeleton_ar(ar)!r})")

    def field(text: str, where: str) -> str:
        for x in (TM.check_markup(text, where, by_id, by_form, table) + TM.wording(TM.strip(text), where)
                  + TM.meaning_problems(text, where)):
            err(x)
        for surface, ref in TM.spans(text):
            if ref and ref.startswith("q:") and TM.QREF.match(ref):
                refs.add(ref)
                check_q(surface, ref, where)
        return TM.strip(text)

    def explicit(text: str) -> str:
        return TM.explicit(text, by_id, by_form)

    def marked_record(rec: dict, where: str, notes: list[str]) -> dict:
        mk = {"title": explicit(rec["title"]), "summary": explicit(rec["summary"]),
              "explanation": [explicit(p) for p in rec["explanation"]]}
        if rec.get("bridge"):
            mk["bridge"] = explicit(rec["bridge"])
        mk["notes"] = [explicit(n) for n in notes]
        rec["title"] = field(rec["title"], f"{where}.title")
        rec["summary"] = field(rec["summary"], f"{where}.summary")
        rec["explanation"] = [field(p, f"{where}.explanation[{i}]") for i, p in enumerate(rec["explanation"])]
        if rec.get("bridge"):
            rec["bridge"] = field(rec["bridge"], f"{where}.bridge")
        return mk

    for c in concepts:
        cw = f"concepts[{c.get('id')}]"
        notes = [x.get("note", "") for x in c.get("examples") or []]
        mk = marked_record(c, cw, notes)
        for i, x in enumerate(c.get("examples") or []):
            x["note"] = field(x["note"], f"{cw}.examples[{i}].note")
        c["marked"] = mk

    # ---- Dasar membaca (the Harakat page)
    basics = []
    if BASICS.exists():
        for b in json.loads(BASICS.read_text(encoding="utf-8"))["basics"]:
            bw = f"basics[{b.get('id')}]"
            b = {k: v for k, v in b.items() if k != "review_notes"}
            b["marked"] = marked_record(b, bw, [])
            for i, sg in enumerate(b.get("signs", [])):
                sw = f"{bw}.signs[{i}]"
                t = by_id.get(sg.get("term"))
                if not t or t.get("group") != "harakah":
                    err(f"{sw}: term {sg.get('term')!r} is not a harakah term of library.terms.json")
                m = TM.QREF.match(sg.get("example", ""))
                if not m or not m.group(6):
                    err(f"{sw}: example must be a letter q-ref (q:S:A:W#n), got {sg.get('example')!r}")
                    continue
                refs.add(sg["example"])
                try:
                    letter = TM.letter_of(tanzil_token(*map(int, m.groups()[:3])) or "", int(m.group(6)))
                except ValueError as x:
                    err(f"{sw}: {x}")
                    continue
                have = {TM.MARKS[ch] for ch in letter if ch in TM.MARKS}
                if not set(sg["marks"]) <= have:
                    err(f"{sw}: the example letter {letter} carries {sorted(have)}, not {sg['marks']}")
                for x in TM.sign_problems(sg, letter, sw):
                    err(x)
                for fld in ("sound", "place", "shape", "reading"):
                    for x in TM.wording(sg.get(fld, ""), f"{sw}.{fld}"):
                        err(x)
            for rel in b.get("related", []):
                if rel not in {c.get("id") for c in concepts}:
                    err(f"{bw}: related {rel!r} is not a concept id")
            check_sources(b.get("sources") or [], bw)
            if b.get("status") != "draft":
                err(f"{bw}: status must be 'draft' (plan L11)")
            basics.append(b)

    # ---- words explained by their parts (rule 14), static diagrams
    parts = []
    cids = {c.get("id") for c in concepts}
    if PARTS.exists():
        for pt in json.loads(PARTS.read_text(encoding="utf-8"))["parts"]:
            pw = f"parts[{pt.get('loc')}]"
            loc = pt.get("loc", "")
            s, a, w = map(int, loc.split(":"))
            word = tanzil_token(s, a, w)
            if loc not in translit or word is None:
                err(f"{pw}: {loc} is not a word of a lesson surah")
                continue
            refs.add(f"q:{loc}")
            for cid in pt.get("concepts", []):
                if cid not in cids:
                    err(f"{pw}: concept {cid!r} does not exist")
            tiles = []
            for i, tl in enumerate(pt.get("tiles", [])):
                tw = f"{pw}.tiles[{i}]"
                m = TM.QREF.match(tl.get("q", ""))
                if not m or m.group(4) or m.group(6):
                    err(f"{tw}: q must be a word or a QAC segment q-ref, got {tl.get('q')!r}")
                    continue
                # A tile is a part as this word writes it (its own QAC segment) or the part's bentuk
                # dasar elsewhere in the Qur'an: a Tanzil token (ٱسْمُ, QS 55:78) or, for an attached
                # pronoun, the QAC segment of another word (the هُمْ of رَزَقْنَٰهُمْ, QS 2:3).
                try:
                    tiles.append(TM.resolve_q(tl["q"], tanzil_token, qac_segments))
                except ValueError as x:
                    err(f"{tw}: {x}")
                    continue
                if not TM.surface_matches(tl.get("translit", ""), tiles[-1]):
                    err(f"{tw}: translit {tl.get('translit')!r} does not name the tile's bytes {tiles[-1]}")
                refs.add(tl["q"])
                field(tl["label"], f"{tw}.label")  # checked; shipped marked
                if TM.AKAR.search(TM.strip(tl["label"])):
                    err(f"{tw}.label: says 'akar'; a part's base form is its 'bentuk dasar' (rule 14)")
                tl["label"] = explicit(tl["label"])
            if len(tiles) == len(pt.get("tiles", [])):
                for x in TM.parts_problems(tiles, pt.get("changes", []), pt.get("drops", []), word):
                    err(f"{pw}: {x}")
            for i, t in enumerate(pt.get("steps", [])):
                field(t, f"{pw}.steps[{i}]")  # checked; shipped marked (WordParts renders the markup)
                if TM.AKAR.search(TM.strip(t)):
                    err(f"{pw}.steps[{i}]: says 'akar'; a part's base form is its 'bentuk dasar' (rule 14: "
                        f"akar = the root letters)")
            pt["steps"] = [explicit(t) for t in pt.get("steps", [])]
            check_sources(pt.get("sources") or [], pw)
            if pt.get("status") != "draft":
                err(f"{pw}: status must be 'draft' (plan L11)")
            parts.append(pt)
    # ---- the bytes of every q-ref, and the segments of each lesson word a part names
    quran, segments = {}, {}
    # mushaf order, then the ref itself, so ties ("114:6:1-2" and "114:6:1#2") sort the same every run
    for ref in sorted(refs, key=lambda r: ([int(x) for x in re.findall(r"\d+", r)], r)):
        try:
            quran[ref[2:]] = TM.resolve_q(ref, tanzil_token, qac_segments)
        except ValueError as x:
            err(f"q-ref {ref}: {x}")
        m = TM.QREF.match(ref)
        loc = ":".join(m.groups()[:3])
        if m.group(5) and loc in translit:
            segments[loc] = qac_segments(*map(int, m.groups()[:3]))

    terms_out = []
    for t in table.get("terms", []):
        o = {"id": t["id"], "latin": t["latin"], "ar": t.get("ar"), "group": t["group"]}
        if t.get("hint"):
            o["hint"] = t["hint"]
        srcs = []
        if t.get("ar"):
            for at in t.get("attest", []):
                pm = meta["pages"].get(at.get("page"))
                if not pm:
                    continue
                vol = re.search(r"ج(\d+)", pm.get("title") or "")
                ref = (f"jil. {vol.group(1)}, " if vol else "") + f"hlm. {pm.get('print_page')}" \
                    + (", catatan kaki penyunting" if at.get("part") == "hamesh" else "") + ": ejaan istilah"
                srcs.append({"kitab": meta["books"][pm["book"]], "ref": ref, "url": pm["url"]})
        o["sources"] = srcs
        terms_out.append(o)

    prose_items = []
    for b in basics:
        bw = f"basics[{b['id']}]"
        prose_items += [(f"{bw}.title", b["title"]), (f"{bw}.summary", b["summary"])]
        prose_items += [(f"{bw}.explanation[{i}]", t) for i, t in enumerate(b["explanation"])]
    for pt in parts:
        prose_items += [(f"parts[{pt['loc']}].steps[{i}]", TM.strip(t)) for i, t in enumerate(pt["steps"])]
    versions = {
        "authored_terms": f"authored/library.terms.json sha256:{sha256_file(TERMS_FILE)}",
        "shamela_istilah": f"{len(page_text)} Shamela pages pinned by text sha256 (sources.json shamela_istilah)",
    }
    if BASICS.exists():
        versions["authored_basics"] = f"authored/library.basics.json sha256:{sha256_file(BASICS)}"
    if PARTS.exists():
        versions["authored_parts"] = f"authored/library.parts.json sha256:{sha256_file(PARTS)}"
    return {"terms": terms_out, "basics": basics, "parts": parts, "quran": quran, "segments": segments,
            "prose": prose_items, "versions": versions}


def word_lemma_ids(surah: int = 1) -> dict[str, str]:
    """Word loc -> lexicon id, for Word.lemma_id in the surah build (keyed by the QAC LEM of the
    word's STEM, the same key the library uses)."""
    src = load_sources()
    segs, _ = load_qac(require_pinned(src, "qac_morphology"))
    by_lem = {e["qac_lem"]: e["id"] for e in json.loads(LEXICON.read_text(encoding="utf-8"))["lexicon"]}
    out = {}
    for key, ws in sorted(qac_words(segs).items()):
        if key[0] == surah:
            lem = stem_of(ws).feat.get("LEM")
            out[":".join(map(str, key))] = by_lem.get(lem)
    return out


def finish(out) -> int:
    for w in warnings:
        print("WARN  " + w)
    if errors:
        print("\nBUILD FAILED:", file=sys.stderr)
        for e in errors:
            print("  - " + e, file=sys.stderr)
        return 1
    CONTENT_DIR.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    n_t = sum(1 for x in out["lexicon"] if "tashrif" in x)
    n_i = sum(len(x["ilal"]) for x in out["lexicon"])
    n_src = sum(len(x["sources"]) for k in ("concepts", "lexicon", "roots") for x in out[k])
    print(f"wrote {OUT.relative_to(PIPELINE.parent.parent)}: {len(out['lexicon'])} lexemes "
          f"({n_t} with tashrif, {n_i} i'lal), {len(out['roots'])} roots, {len(out['concepts'])} concepts, "
          f"{n_src} source refs; all draft.")
    return 0


if __name__ == "__main__":
    args = sys.argv[1:]
    if args[:1] == ["--word-map"]:
        # python3 build_library.py --word-map [slug]   (default al-fatihah)
        slug = args[1] if len(args) > 1 else "al-fatihah"
        print(json.dumps(word_lemma_ids(SURAH_BY_SLUG[slug].surah), ensure_ascii=False, indent=2))
        sys.exit(0)
    if args[:1] == ["--only"] and len(args) > 1 and all(a in SURAH_BY_SLUG for a in args[1:]):
        sys.exit(main(args[1:]))
    if args:
        print(f"usage: python3 build_library.py [--only <slug> ...] | --word-map [slug]   "
              f"(slugs: {', '.join(SURAH_BY_SLUG)})", file=sys.stderr)
        sys.exit(2)
    sys.exit(main())
