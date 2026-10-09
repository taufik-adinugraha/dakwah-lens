#!/usr/bin/env python3
"""Stage 2 'Assemble' for the shared library: build belajar/content/library.json (Library, schema.ts).

Inputs (pinned in sources.json and verified by sha256 before use):
  QAC 0.4 morphology, Tanzil Uthmani 1.1 (only to byte-check «…» quotations in prose),
  authored/library.lexicon.json (Kosakata + Akar, author A) and, when present,
  authored/library.concepts.json (Konsep, author B; passed through after a shape check, minus
  each record's reviewer-only `review_notes`).

Data-derived here, never typed: the list of lemmas and roots the covered surahs need, lemma_ar
(QAC LEM, Buckwalter -> Arabic), root letters, pos (build_fatihah.pos_label), lemma and root
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

import build_fatihah
import validate as V
from common import (ARABIC_RUN, CONTENT_DIR, PIPELINE, SCHEMA_TS, bw_to_ar, load_qac, load_sources, load_tanzil,
                    qac_words, require_pinned, root_letters, sha256_file, stem_of)
from facts import QAC_BASIS, QAC_TANZIL_HEADER, fmt

LEXICON = PIPELINE / "authored" / "library.lexicon.json"
CONCEPTS = PIPELINE / "authored" / "library.concepts.json"
WORDS = {1: PIPELINE / "authored" / "al-fatihah.words.json"}
OUT = CONTENT_DIR / "library.json"
SURAHS = [1]  # surahs whose every stem lemma and root must have a library entry
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
            "P": "huruf jar", "PRON": "dhamir", "DEM": "isim isyarah"}
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
    """Lemma-level learner label: the word-card label of the stem (build_fatihah.pos_label), with
    verbs as plain "fi'il" (aspect belongs to a word, not a lemma) and the number mark dropped
    unless every QAC occurrence of the lemma has it (e.g. ‘ālamīn, always plural)."""
    if st.tag == "V":
        return "fi'il"
    label = build_fatihah.pos_label([st])
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
def main() -> int:
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
            if len(vfs) > 1:
                err(f"{tw}: QAC verb forms of {vl} are mixed: {vfs}")
            elif vfs:
                vf = next(iter(vfs))
                if BAB_FOR_VF.get(vf, "\0") not in t["bab"]:
                    err(f"{tw}: QAC verb form {vf} for {vl} but bab {t['bab']!r} does not name "
                        f"{BAB_FOR_VF.get(vf)!r}")
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
                       f"{'/'.join(sorted(vfs)) or '?'} (QAC menandai II–XII; tanpa tanda = I), "
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
        method = (f"{QAC_BASIS}: jumlah segmen STEM dengan LEM:{lem} (lemma kata {loc}), dalam {fmt(len(ayat))} "
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
                "method": f"{QAC_BASIS}: jumlah segmen STEM dengan ROOT:{r} (akar kata {loc}), dalam "
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
        fatihah_locs = {":".join(map(str, k)) for k in W if k[0] in SURAHS}
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
                elif x["loc"] not in fatihah_locs:
                    warnings.append(f"{cw}: example {x['loc']} is not a word of the covered surahs")
            if not c.get("examples"):
                err(f"{cw}: needs ≥1 example")
            for rel in c.get("related") or []:
                if rel not in cids:
                    err(f"{cw}: related {rel!r} is not a concept id")
            check_sources(c.get("sources") or [], cw)
        for dup in sorted({i for i in cids if cids.count(i) > 1}):
            err(f"concept id {dup!r} used twice")
        for c in concepts:
            cw = f"concepts[{c.get('id')}]"
            prose += [(f"{cw}.title", c.get("title", "")), (f"{cw}.summary", c.get("summary", ""))]
            prose += [(f"{cw}.explanation[{i}]", t) for i, t in enumerate(c.get("explanation") or [])]
            if c.get("bridge"):
                prose.append((f"{cw}.bridge", c["bridge"]))
            prose += [(f"{cw}.examples[{i}].note", x.get("note", "")) for i, x in enumerate(c.get("examples") or [])]

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
        "pipeline": "belajar/pipeline/build_library.py (stdlib only, no LLM)",
    }
    out = {"concepts": concepts, "lexicon": lexicon, "roots": roots, "data_versions": data_versions}

    # ---- shape against schema.ts (keys, nesting, enums) + status
    schemas, enums = V.parse_schema(SCHEMA_TS.read_text(encoding="utf-8"))
    V.check_shape(out, schemas["Library"], schemas, enums, "library")
    for kind, recs in (("concept", concepts), ("lexeme", lexicon), ("root", roots)):
        for x in recs:
            if x.get("status") != "draft":
                err(f"{kind} {x.get('id')}: status must be 'draft' until an ustadz signs it off")
    errors.extend(V.fails)
    errors.extend(build_fatihah.errors)
    return finish(out)


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
    if sys.argv[1:] == ["--word-map"]:
        print(json.dumps(word_lemma_ids(), ensure_ascii=False, indent=2))
        sys.exit(0)
    sys.exit(main())
