#!/usr/bin/env python3
"""Stage 2 'Assemble': build belajar/content/al-fatihah.json (SurahContent, schema.ts).

Inputs (all pinned in sources.json and verified by sha256 before use):
  Tanzil Uthmani 1.1 text + metadata, QAC 0.4 morphology, quran-align (Husary Mu'allim,
  Alafasy), QuranEnc indonesian_affairs sura 1, EveryAyah duration probes,
  and the hand-authored inventory authored/al-fatihah.words.json.
Library links (hand-authored, shared with build_library.py):
  Word.lemma_id  = the authored/library.lexicon.json id of the word's QAC STEM LEM (same key as
                   build_library.py --word-map);
  Word.concepts  = authored/al-fatihah.concepts-map.json (ids must exist in library.concepts.json);
  Word.role and Ayah.structure = authored/al-fatihah.structure.json (role_src / role_note /
                   review_notes are reviewer-only and never reach the output).

Qur'anic Arabic is copied byte-for-byte from the Tanzil file. Every record is status "draft".
The build stops (exit 1) on any structural problem; it prints data anomalies as warnings.
No network, no LLM. Run fetch.py first.
"""
from __future__ import annotations

import json
import re
import sys
import xml.etree.ElementTree as ET

from common import (CONTENT_DIR, PIPELINE, bw_to_ar, load_qac, load_sources, load_tanzil, qac_words,
                    require_pinned, root_letters, sha256_file, stem_of)
from facts import QAC_TANZIL_HEADER, Corpus, compute_facts

SURAH = 1
SLUG = "al-fatihah"
NAME_ID = "Al-Fatihah"
EXPECTED_WORDS = [4, 4, 2, 3, 4, 3, 9]
AUTHORED = PIPELINE / "authored" / "al-fatihah.words.json"
STRUCTURE = PIPELINE / "authored" / "al-fatihah.structure.json"
CONCEPTS_MAP = PIPELINE / "authored" / "al-fatihah.concepts-map.json"
LEXICON = PIPELINE / "authored" / "library.lexicon.json"
CONCEPTS = PIPELINE / "authored" / "library.concepts.json"
OUT = CONTENT_DIR / "al-fatihah.json"
STRUCTURE_KEYS = ["type", "summary", "groups", "sources", "status"]  # schema.ts Ayah.structure
GROUP_KEYS = {"words", "label", "concept"}

RECITERS = [
    ("Husary_Muallim_128kbps", "everyayah_husary_muallim",
     "Recitation: Mahmoud Khalil Al-Husary (Mu'allim) via EveryAyah.com · Word timings: Collin Fair, quran-align (CC BY 4.0)"),
    ("Alafasy_128kbps", "everyayah_alafasy",
     "Recitation: Mishary Rashid Alafasy via EveryAyah.com · Word timings: Collin Fair, quran-align (CC BY 4.0)"),
]
GAP_WARN_MS = 1500
SHORT_WARN_MS = 200

errors: list[str] = []
warnings: list[str] = []


# ---------------------------------------------------------------- QAC -> learner word class
def pos_label(word_segs) -> str:
    """Map QAC 0.4 segment tags to the Indonesian learner label (README §'Kelas kata')."""
    parts = []
    for g in word_segs:
        t = g.tag
        if "PREFIX" in g.flags:
            if t == "DET":  # alif-lam ta'rif: not shown as a separate class
                continue
            parts.append({"P": "huruf jar", "CONJ": "huruf 'athaf", "REM": "huruf isti'naf",
                          "EMPH": "lam taukid", "INTG": "huruf istifham", "VOC": "huruf nida'",
                          "FUT": "huruf istiqbal", "RSLT": "fa' jawab", "CAUS": "fa' sababiyyah",
                          "SUP": "huruf tambahan", "IMPV": "lam amr", "PRP": "lam ta'lil"}.get(t, f"[{t}]"))
        elif "SUFFIX" in g.flags:
            parts.append("dhamir muttashil" if t == "PRON" else f"[{t}]")
        else:  # STEM
            f = set(g.flags)
            if t == "N":
                base = "isim fa'il" if {"ACT", "PCPL"} <= f else "isim maf'ul" if {"PASS", "PCPL"} <= f else \
                    "mashdar" if "VN" in f else "isim"
                if f & {"MP", "FP", "P"}:
                    base += " (jamak)"
                elif f & {"MD", "FD", "D"}:
                    base += " (mutsanna)"
                parts.append(base)
            elif t == "PN":
                parts.append("isim 'alam (lafaz Allah)" if g.feat.get("LEM") == "{ll~ah" else "isim 'alam")
            elif t == "ADJ":
                parts.append("isim sifat (isim fa'il)" if {"ACT", "PCPL"} <= f else
                             "isim sifat (isim maf'ul)" if {"PASS", "PCPL"} <= f else "isim sifat")
            elif t == "PRON":
                parts.append("dhamir munfashil")
            elif t == "REL":
                parts.append("isim maushul")
            elif t == "DEM":
                parts.append("isim isyarah")
            elif t == "V":
                parts.append("fi'il madhi" if "PERF" in f else "fi'il mudhari'" if "IMPF" in f else
                             "fi'il amr" if "IMPV" in f else "fi'il")
            elif t == "P":
                parts.append("huruf jar")
            elif t == "NEG":
                parts.append("huruf nafi")
            else:
                parts.append(f"[{t}]")
    label = " + ".join(parts)
    if "[" in label:
        errors.append(f"unmapped QAC tag in {[g.features for g in word_segs]} -> {label}")
    return label


# ---------------------------------------------------------------- sources
def expand_src(spec: list, ayah: int, kitab: dict) -> dict:
    """spec = [abbr], [abbr, ref] or [abbr, ref, url_ayah]. ref None = the kitab's default ref for
    this ayah. url_ayah names the ayah page the passage is on (when the kitab discusses the word
    under another ayah); null = no url, because no page is known to hold the passage."""
    abbr = spec[0]
    k = kitab[abbr]
    ref = spec[1] if len(spec) > 1 and spec[1] is not None else \
        k["default_ref"].get(str(ayah), k["default_ref"]["*"])
    out = {"kitab": k["kitab"], "ref": ref.replace("{ayah}", str(ayah))}
    url_ayah = spec[2] if len(spec) > 2 else ayah
    if url_ayah is not None:
        out["url"] = k["url"].replace("{ayah}", str(url_ayah))
    return out


VERB_FORMS = ["II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"]
ASPECT = {"PERF": "fi'il madhi (PERF)", "IMPF": "fi'il mudhari' (IMPF)", "IMPV": "fi'il amr (IMPV)"}


def verb_form_src(loc: str, a: int, st) -> dict:
    """QAC 0.4 verb-form (VF) tag behind a verb's wazn. QAC writes (II)..(XII) and leaves form I
    unmarked; the file has no '(I)' tag at all."""
    tagged = [f.strip("()") for f in st.flags if f.startswith("(") and f.strip("()") in VERB_FORMS]
    vf = tagged[0] if tagged else "I"
    note = "" if tagged else " (QAC 0.4 menandai bentuk II–XII saja; tanpa tanda = bentuk I)"
    aspect = next((ASPECT[f] for f in st.flags if f in ASPECT), "fi'il")
    pgn = next((f for f in st.flags if f[:1] in "123"), "")
    return {"kitab": "Quranic Arabic Corpus 0.4",
            "ref": f"({loc}:*) bentuk kata kerja (VF) {vf}{note}, {aspect}, {pgn}; "
                   f"harakat pola wazan mengikuti token Tanzil {loc}",
            "url": f"https://corpus.quran.com/wordbyword.jsp?chapter={SURAH}&verse={a}"}


def load_links(word_locs: list[str], kitab: dict) -> tuple[dict, set, dict, dict]:
    """Read the hand-authored library links and check them against each other.
    Returns (lexicon id by QAC LEM, concept ids, concepts by word loc, the structure file)."""
    lex = json.loads(LEXICON.read_text(encoding="utf-8"))["lexicon"]
    lex_by_lem = {e["qac_lem"]: e["id"] for e in lex}
    if len(lex_by_lem) != len(lex) or len({e["id"] for e in lex}) != len(lex):
        errors.append("library.lexicon.json: duplicate qac_lem or id")
    raw_c = json.loads(CONCEPTS.read_text(encoding="utf-8"))
    concept_ids = {c["id"] for c in (raw_c["concepts"] if isinstance(raw_c, dict) else raw_c)}
    cmap = json.loads(CONCEPTS_MAP.read_text(encoding="utf-8"))["words"]
    struct = json.loads(STRUCTURE.read_text(encoding="utf-8"))
    for name, keys in (("concepts-map words", set(cmap)), ("structure words", set(struct["words"]))):
        if keys != set(word_locs):
            errors.append(f"{name}: locs differ from the 29 Tanzil words "
                          f"(missing {sorted(set(word_locs) - keys)}, unknown {sorted(keys - set(word_locs))})")
    for loc, ids in cmap.items():
        if not isinstance(ids, list) or len(set(ids)) != len(ids):
            errors.append(f"concepts-map {loc}: must be a list without repeats, got {ids!r}")
            continue
        for cid in ids:
            if cid not in concept_ids:
                errors.append(f"concepts-map {loc}: {cid!r} is not a concept id in library.concepts.json")
    for loc, sw in struct["words"].items():
        if not isinstance(sw.get("role"), str) or len(sw["role"]) < 2:
            errors.append(f"structure word {loc}: role must be a string of >= 2 characters")
        for abbr in sw.get("role_src", []):
            if abbr not in kitab:
                errors.append(f"structure word {loc}: role_src {abbr!r} is not a kitab abbreviation")
    return lex_by_lem, concept_ids, cmap, struct


def ayah_structure(a: int, n_words: int, struct: dict, concept_ids: set) -> dict | None:
    """Ayah.structure from the authored file: schema keys only, groups checked."""
    sa = (struct["ayat"].get(str(a)) or {}).get("structure")
    if not sa:
        errors.append(f"structure.json: no structure for ayah {SURAH}:{a}")
        return None
    where = f"structure {SURAH}:{a}"
    if set(sa) != set(STRUCTURE_KEYS):
        errors.append(f"{where}: keys {sorted(sa)} != {STRUCTURE_KEYS}")
    if sa.get("status") != "draft":
        errors.append(f"{where}: status must be draft")
    if not sa.get("sources"):
        errors.append(f"{where}: no sources")
    groups = []
    for i, g in enumerate(sa.get("groups", [])):
        gw = f"{where}.groups[{i}]"
        if set(g) - GROUP_KEYS:
            errors.append(f"{gw}: unknown keys {sorted(set(g) - GROUP_KEYS)}")
        idx = g.get("words", [])
        if len(idx) < 2 or idx != sorted(set(idx)) or any(not isinstance(x, int) or not 1 <= x <= n_words
                                                            for x in idx):
            errors.append(f"{gw}: words {idx} must be >= 2 ascending indices within 1..{n_words}")
        if "concept" in g and g["concept"] not in concept_ids:
            errors.append(f"{gw}: concept {g['concept']!r} is not in library.concepts.json")
        groups.append({k: g[k] for k in ("words", "label", "concept") if k in g})
    return {"type": sa["type"], "summary": sa["summary"], "groups": groups, "sources": sa["sources"],
            "status": sa["status"]}


def split_footnotes(raw: str) -> list[str]:
    """QuranEnc 'footnotes' field -> one string per footnote, each starting at its [n] marker.
    Only the whitespace between footnotes is dropped; the text is not otherwise touched."""
    return [p.strip() for p in re.split(r"(?=\[\d+\])", raw or "") if p.strip()]


def main() -> int:
    src = load_sources()
    I = src["inputs"]
    T = load_tanzil(require_pinned(src, "tanzil_uthmani"))
    meta_xml = ET.parse(require_pinned(src, "tanzil_metadata")).getroot()
    segs, qac_header = load_qac(require_pinned(src, "qac_morphology"))
    if QAC_TANZIL_HEADER not in qac_header:
        errors.append(f"QAC header no longer names '{QAC_TANZIL_HEADER}'; update facts.QAC_BASIS")
    W = qac_words(segs)
    qe_path = require_pinned(src, "quranenc_indonesian_affairs")
    qe = I["quranenc_indonesian_affairs"]
    qe_rows = {int(r["aya"]): r for r in json.loads(qe_path.read_text(encoding="utf-8"))["result"]}
    qa_dir = PIPELINE / I["quran_align"]["cache_path"]
    qa_dir = qa_dir.parent
    align = {}
    for reciter, probe_key, _ in RECITERS:
        p = qa_dir / f"{reciter}.json"
        want = I["quran_align"]["members"][f"{reciter}.json"]["sha256"]
        if sha256_file(p) != want:
            raise SystemExit(f"quran-align {reciter}.json sha256 mismatch; run fetch.py")
        align[reciter] = {(e["surah"], e["ayah"]): e for e in json.loads(p.read_text())}
    authored = json.loads(AUTHORED.read_text(encoding="utf-8"))
    kitab = authored["kitab"]

    # ---- metadata cross-check
    sura_meta = {int(e.get("index")): e for e in meta_xml.iter("sura")}
    for s, e in sura_meta.items():
        n = sum(1 for (ss, _a) in T.verses if ss == s)
        if n != int(e.get("ayas")):
            errors.append(f"Tanzil metadata says surah {s} has {e.get('ayas')} ayat, text has {n}")
    name_ar = sura_meta[SURAH].get("name")

    # ---- tokenisation: Tanzil vs QAC
    counts = [len(T.verses[(SURAH, a)].split(" ")) for a in range(1, 8)]
    if counts != EXPECTED_WORDS:
        errors.append(f"Tanzil token counts {counts} != expected {EXPECTED_WORDS}")
    qac_counts = [len([k for k in W if k[0] == SURAH and k[1] == a]) for a in range(1, 8)]
    if qac_counts != EXPECTED_WORDS:
        errors.append(f"QAC word counts {qac_counts} != expected {EXPECTED_WORDS}")
    for a in range(1, 8):
        for w, tok in enumerate(T.verses[(SURAH, a)].split(" "), 1):
            segs_w = W.get((SURAH, a, w))
            if not segs_w:
                errors.append(f"QAC has no word {SURAH}:{a}:{w}")
                continue
            form = bw_to_ar("".join(g.form for g in segs_w))
            if form != tok:
                errors.append(f"{SURAH}:{a}:{w}: QAC form {form!r} != Tanzil token {tok!r}")
    if errors:
        return finish(None)

    # ---- library links (lemma_id, concepts, role, structure)
    word_locs = [f"{SURAH}:{a}:{w}" for a in range(1, 8) for w in range(1, EXPECTED_WORDS[a - 1] + 1)]
    lex_by_lem, concept_ids, cmap, struct = load_links(word_locs, kitab)
    if errors:
        return finish(None)

    # ---- ayat
    ayat = []
    for a in range(1, 8):
        verse = T.verses[(SURAH, a)]
        tokens = verse.split(" ")
        words = []
        for w, tok in enumerate(tokens, 1):
            loc = f"{SURAH}:{a}:{w}"
            au = authored["words"].get(loc)
            if not au:
                errors.append(f"no authored entry for {loc}")
                continue
            segs_w = W[(SURAH, a, w)]
            st = stem_of(segs_w)
            root = root_letters(st.feat["ROOT"]) if "ROOT" in st.feat else None
            lemma = bw_to_ar(st.feat["LEM"]) if "LEM" in st.feat else None
            sources = [expand_src(sp, a, kitab) for sp in au["src"]]
            sources.append({"kitab": "Quranic Arabic Corpus 0.4",
                            "ref": f"({loc}:*) — akar, lemma, kelas kata: "
                                   + " + ".join(f"{g.tag}|{g.features}" for g in segs_w),
                            "url": f"https://corpus.quran.com/wordbyword.jsp?chapter={SURAH}&verse={a}"})
            if st.feat.get("POS") == "V" and au["wazn"]:
                sources.append(verb_form_src(loc, a, st))
            sources.append({"kitab": f"Gloss in-house (draf), diselaraskan dengan terjemahan QuranEnc "
                                     f"'{qe['title_id']}' v{qe['version']}",
                            "ref": f"QS {SURAH}:{a}", "url": qe["url"]})
            case = {"state": au["case"]["state"], "sign": au["case"]["sign"]}
            if "mahall" in au["case"]:
                case["mahall"] = au["case"]["mahall"]
            qac_pos = pos_label(segs_w)
            pos = au.get("pos") or qac_pos
            if au.get("pos") and not au.get("pos_note"):
                errors.append(f"{loc}: authored pos override {pos!r} needs a pos_note (QAC says {qac_pos!r})")
            lemma_id = lex_by_lem.get(st.feat.get("LEM"))
            if lemma_id is None:
                errors.append(f"{loc}: no library.lexicon.json entry for QAC LEM {st.feat.get('LEM')!r}")
            sw = struct["words"][loc]
            src_abbr = {sp[0] for sp in au["src"]}
            for abbr in sw.get("role_src", []):
                if abbr not in src_abbr:
                    errors.append(f"{loc}: role_src {abbr!r} is not among the word's own src {sorted(src_abbr)}")
            words.append({
                "loc": loc, "ar": tok, "translit": au["translit"], "gloss": au["gloss"],
                "root": root, "lemma": lemma, "pos": pos, "wazn": au["wazn"], "case": case,
                "why": au["why"], "lemma_id": lemma_id, "concepts": list(cmap[loc]), "role": sw["role"],
                "ikhtilaf": au["ikhtilaf"], "sources": sources, "status": "draft",
            })

        # QuranEnc text verbatim (markers kept); its footnotes verbatim, one item per [n].
        tr = qe_rows[a]["translation"]
        footnotes = split_footnotes(qe_rows[a].get("footnotes"))
        markers = re.findall(r"\[\d+\]", tr)
        fn_markers = [(re.match(r"\[\d+\]", f) or [None])[0] for f in footnotes]
        if markers != fn_markers:
            errors.append(f"translation {SURAH}:{a}: markers in text {markers} != footnote markers {fn_markers}")

        recitation = []
        for reciter, probe_key, credit in RECITERS:
            e = align[reciter].get((SURAH, a))
            if not e:
                errors.append(f"quran-align {reciter}: no entry for {SURAH}:{a}")
                continue
            segs_out = []
            for ws, we, s_ms, e_ms in e["segments"]:
                if we - ws != 1:
                    errors.append(f"{reciter} {SURAH}:{a}: segment covers words {ws + 1}..{we} together; "
                                  f"cannot give per-word timing")
                    continue
                segs_out.append([ws + 1, int(s_ms), int(e_ms)])
            probe = I[probe_key]["files"].get(f"{SURAH:03d}{a:03d}.mp3", {})
            check_segments(reciter, a, segs_out, len(tokens), probe.get("duration_ms"), e.get("stats", {}))
            recitation.append({"reciter": reciter,
                               "url": f"https://everyayah.com/data/{reciter}/{SURAH:03d}{a:03d}.mp3",
                               "segments": segs_out, "credit": credit})

        ayah = {
            "loc": f"{SURAH}:{a}", "surah": SURAH, "ayah": a, "ar": verse, "words": words,
            "translation": {"text": tr, "footnotes": footnotes, "source_label": qe["title_id"],
                            "version": qe["version"]},
            "recitation": recitation, "status": "draft",
        }
        structure = ayah_structure(a, len(tokens), struct, concept_ids)
        if structure:
            ayah = {**{k: v for k, v in ayah.items() if k != "status"}, "structure": structure, "status": "draft"}
        ayat.append(ayah)

    # ---- facts
    C = Corpus(T, segs, I["tanzil_uthmani"]["sha256"], I["qac_morphology"]["sha256"])
    facts, comparisons = compute_facts(C)
    for c in comparisons:
        if not c["match"]:
            warnings.append(f"fact {c['fact']}: {c['what']}: computed {c['computed']} vs Appendix B {c['plan']}")

    # ---- gloss consistency heuristic (every gloss word appears in the ayah translation)
    for ay in ayat:
        tr_words = re.findall(r"[\w'-]+", ay["translation"]["text"].lower())
        for wd in ay["words"]:
            au = authored["words"][wd["loc"]]
            missing = [g for g in re.findall(r"[\w'-]+", wd["gloss"].lower())
                       if not any(t.startswith(g) for t in tr_words)]
            if missing and not au.get("gloss_exception"):
                warnings.append(f"gloss {wd['loc']} '{wd['gloss']}': {missing} not in ayah translation")

    qa = I["quran_align"]
    data_versions = {
        "tanzil": f"uthmani-{I['tanzil_uthmani']['version']} sha256:{I['tanzil_uthmani']['sha256']}",
        "tanzil_metadata": f"{I['tanzil_metadata']['version']} sha256:{I['tanzil_metadata']['sha256']}",
        "qac": f"{I['qac_morphology']['version']} sha256:{I['qac_morphology']['sha256']}",
        "quran_align": f"{qa['version']} sha256:{qa['sha256']}; "
                       + "; ".join(f"{n} sha256:{m['sha256']}" for n, m in qa["members"].items()),
        "quranenc": f"indonesian_affairs {qe['version']} (last_update {qe['last_update_unix']}) "
                    f"sha256:{qe['sha256']}",
        "authored_words": f"authored/al-fatihah.words.json sha256:{sha256_file(AUTHORED)}",
        "authored_structure": f"authored/al-fatihah.structure.json sha256:{sha256_file(STRUCTURE)}",
        "authored_concepts_map": f"authored/al-fatihah.concepts-map.json sha256:{sha256_file(CONCEPTS_MAP)}",
        "pipeline": "belajar/pipeline/build_fatihah.py + facts.py (stdlib only, no LLM)",
    }
    out = {"surah": SURAH, "slug": SLUG, "name_ar": name_ar, "name_id": NAME_ID, "ayat": ayat,
           "facts": facts, "hadith": [], "data_versions": data_versions}
    return finish(out, comparisons)


def check_segments(reciter: str, a: int, segs: list, n_words: int, duration_ms, stats: dict) -> None:
    tag = f"{reciter} {SURAH}:{a}"
    idx = [s[0] for s in segs]
    if idx != sorted(idx):
        errors.append(f"{tag}: segments not sorted by word index {idx}")
    if sorted(idx) != list(range(1, n_words + 1)):
        missing = sorted(set(range(1, n_words + 1)) - set(idx))
        dup = sorted({i for i in idx if idx.count(i) > 1})
        errors.append(f"{tag}: coverage mismatch (missing {missing}, duplicated {dup})")
    prev_end = -1
    for w, s_ms, e_ms in segs:
        if e_ms <= s_ms:
            errors.append(f"{tag} word {w}: endMs {e_ms} <= startMs {s_ms}")
        if s_ms < prev_end:
            errors.append(f"{tag} word {w}: overlaps previous word (start {s_ms} < previous end {prev_end})")
        if prev_end >= 0 and s_ms - prev_end > GAP_WARN_MS:
            warnings.append(f"{tag}: {s_ms - prev_end} ms silence before word {w} (check by ear)")
        if e_ms - s_ms < SHORT_WARN_MS:
            warnings.append(f"{tag} word {w}: only {e_ms - s_ms} ms long (check by ear)")
        prev_end = e_ms
    if duration_ms is None:
        warnings.append(f"{tag}: no duration probe (run fetch.py without --skip-audio)")
    elif segs and segs[-1][2] > duration_ms:
        errors.append(f"{tag}: last segment ends {segs[-1][2]} ms, after the streamed file ends ({duration_ms} ms)")
    if any(stats.get(k) for k in ("insertions", "deletions", "transpositions")):
        warnings.append(f"{tag}: quran-align matcher stats {stats} (alignment was not clean; check by ear)")


def finish(out, comparisons=None) -> int:
    for w in warnings:
        print("WARN  " + w)
    if errors:
        print("\nBUILD FAILED:", file=sys.stderr)
        for e in errors:
            print("  - " + e, file=sys.stderr)
        return 1
    CONTENT_DIR.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    n_words = sum(len(a["words"]) for a in out["ayat"])
    print(f"\nwrote {OUT.relative_to(PIPELINE.parent.parent)}: {len(out['ayat'])} ayat, {n_words} words, "
          f"{len(out['facts'])} facts")
    if comparisons is not None:
        diff = [c for c in comparisons if not c["match"]]
        print(f"facts: {len(comparisons)} figures re-derived, {len(diff)} differ from Appendix B")
    return 0


if __name__ == "__main__":
    sys.exit(main())
