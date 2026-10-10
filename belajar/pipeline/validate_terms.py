#!/usr/bin/env python3
"""Konsep library: grammar terms in Arabic script, Qur'anic words from content bytes, the inline
markup, the Harakat page and the word-parts diagrams (operator 2026-10-10 on /belajar/id/konsep:
"mention the arabic word like majrur in arabic letter etc, not only the transliteration"; the
narration review's rules the same day: Arabic from content bytes with "yang artinya", "klik" never
"ketuk", letters as in the ayah, words explained by their parts). Standard library only.

    python3 validate_terms.py              # local: with pipeline/cache (Shamela pages, Tanzil, QAC)
    python3 validate_terms.py --no-corpus  # CI (pipeline/cache is git-ignored): every check that
                                           # needs no cache; the skipped ones are named in the OK line

Checks
  1. The term table (authored/library.terms.json, terms.check_table): ids, groups, a reminder for
     every harakah term; `ar` typed Arabic only (letters, harakat, spaces: no Uthmani marks, no
     tatweel) and byte-equal to the pronunciation dictionary where that names the term; every
     spelling attested — {"pron"} byte-equal to the operator-approved dictionary, or a Shamela
     excerpt (≤ 12 words) of a pinned page of a cited kitab that contains the folded term as whole
     tokens with no vowel conflict; a term nothing attests has ar null and a stated reason (listed
     here, shown in Latin only). With the cache: each pinned page's text matches its sha256 and the
     excerpt is a verbatim substring of its matn (or of the footnotes when it says so).
  2. The authored markup (library.concepts.json, library.basics.json, library.parts.json): every
     [[…]] names a term of the table or a q-ref (q:S:A:W, -W2, /segment, #letter); an explicit
     term ref's surface names that term ([[majrur|marfu]] fails); no form of a term is left
     unmarked in prose (except its ambiguous_forms); no "ketuk"; no "yang berarti"; a Qur'anic
     word's meaning is "yang artinya “…”", not a bare quote or "berarti" (terms.BARE_QUOTE_OK
     lists the recorded-narration exceptions); no "akar" in a parts diagram (bentuk dasar).
  3. content/library.json is a fresh build of them: its data_versions pin the current sha256 of
     the four authored files; every plain field equals its marked field without the markup and
     equals the authored text without the markup; every shipped marked field (concepts, basics,
     parts labels and steps) equals the authored markup with its terms made explicit, byte for
     byte; no markup left in a plain field; the shipped terms equal the table; every term a
     shipped marked field names is shipped.
  4. Qur'anic bytes (library.json `quran`): every entry naming a lesson word — the word, a run of
     words, a QAC segment, a letter — equals the bytes of content/<slug>.json for that word
     (rule: Arabic from content bytes, never retyped); `segments` of a word join to the word;
     every word, run and segment ref's Latin surface names its bytes (terms.surface_matches:
     [[bi-|q:1:1:1/2]], which would show سْمِ, fails), and so does each parts tile's translit;
     each parts diagram spells its word (terms.parts_problems); each Harakat sign's sound, place
     and reading agree with the mark its example letter carries (terms.sign_problems).
     With the cache: every entry, lesson word or not, equals the pinned Tanzil token or QAC 0.4
     segment it names.
  5. Every example of every concept is a lesson word with Arabic, a transliteration and a gloss
     in the content (the example row: "بِسْمِ bismi, yang artinya “dengan nama”").
Harakat (review 2026-10-10): an attestation proves a spelling's letters; a mark counts as
confirmed only where the dictionary or a vocalised excerpt writes it. The OK line counts both,
and every mark no source confirms is listed ("HARAKAT UNCONFIRMED").
Exit 1 on any failure.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import terms as TM
from common import (CONTENT_DIR, PIPELINE, SURAHS, bw_to_ar, lesson_ayah, load_qac, load_sources, load_tanzil,
                    qac_words, require_pinned, sha256_file)

# Paths the checks read; test_validate_terms.py points them at temporary copies.
AUTHORED = PIPELINE / "authored"
TERMS = AUTHORED / "library.terms.json"
PRONUNCIATION = AUTHORED / "pronunciation.json"
CONCEPTS = AUTHORED / "library.concepts.json"
BASICS = AUTHORED / "library.basics.json"
PARTS = AUTHORED / "library.parts.json"
LIBRARY = CONTENT_DIR / "library.json"
LESSON_DIR = CONTENT_DIR
SOURCES = PIPELINE / "sources.json"

NO_CORPUS_SKIPPED = ("1 Shamela page pins and excerpts verbatim in the pinned pages",
                     "4 bytes of Qur'anic refs outside the lesson words (Tanzil 1.1 / QAC 0.4)")
fails: list[str] = []


def fail(msg: str) -> None:
    fails.append(msg)


def marked_fields(concepts: list, basics: list, parts: list):
    """(where, marked text) for every authored prose field that takes markup."""
    for c in concepts:
        w = f"concepts[{c.get('id')}]"
        yield f"{w}.title", c.get("title", "")
        yield f"{w}.summary", c.get("summary", "")
        for i, p in enumerate(c.get("explanation") or []):
            yield f"{w}.explanation[{i}]", p
        if c.get("bridge"):
            yield f"{w}.bridge", c["bridge"]
        for i, x in enumerate(c.get("examples") or []):
            yield f"{w}.examples[{i}].note", x.get("note", "")
    for b in basics:
        w = f"basics[{b.get('id')}]"
        yield f"{w}.title", b.get("title", "")
        yield f"{w}.summary", b.get("summary", "")
        for i, p in enumerate(b.get("explanation") or []):
            yield f"{w}.explanation[{i}]", p
    for pt in parts:
        w = f"parts[{pt.get('loc')}]"
        for i, t in enumerate(pt.get("tiles") or []):
            yield f"{w}.tiles[{i}].label", t.get("label", "")
        for i, s in enumerate(pt.get("steps") or []):
            yield f"{w}.steps[{i}]", s


def lesson_words() -> dict[str, dict]:
    out = {}
    for spec in SURAHS:
        p = LESSON_DIR / f"{spec.slug}.json"
        if p.exists():
            for a in json.loads(p.read_text(encoding="utf-8"))["ayat"]:
                for w in a["words"]:
                    out[w["loc"]] = w
    return out


def main(no_corpus: bool | None = None) -> int:
    fails.clear()
    if no_corpus is None:
        no_corpus = "--no-corpus" in sys.argv[1:]
    table = json.loads(TERMS.read_text(encoding="utf-8"))
    pron = TM.load_pronunciation(PRONUNCIATION)
    src = json.loads(SOURCES.read_text(encoding="utf-8"))
    meta = src["inputs"]["shamela_istilah"]

    # 1. the term table
    page_text = None
    if not no_corpus:
        page_text = {}
        for pk, pm in meta["pages"].items():
            book, page = pk.split("/")
            f = PIPELINE / meta["cache_dir"] / book / f"{page}.txt"
            if not f.exists():
                fail(f"shamela_istilah {pk}: not in pipeline/cache; run fetch.py (or --no-corpus)")
            elif sha256_file(f) != pm.get("text_sha256"):
                fail(f"shamela_istilah {pk}: cached page text does not match its pinned sha256")
            else:
                page_text[pk] = f.read_text(encoding="utf-8")
    stats: dict = {}
    errs, report = TM.check_table(table, pron, meta["pages"], meta["books"], page_text, stats)
    for e in errs:
        fail(e)

    # 2. the authored markup
    concepts = json.loads(CONCEPTS.read_text(encoding="utf-8"))
    basics = json.loads(BASICS.read_text(encoding="utf-8"))["basics"] if BASICS.exists() else []
    parts = json.loads(PARTS.read_text(encoding="utf-8"))["parts"] if PARTS.exists() else []
    by_id, by_form = TM.term_index(table)
    authored_plain, authored_marked = {}, {}
    for where, text in marked_fields(concepts, basics, parts):
        for e in (TM.check_markup(text, where, by_id, by_form, table) + TM.wording(TM.strip(text), where)
                  + TM.meaning_problems(text, where)):
            fail(e)
        if where.startswith("parts[") and TM.AKAR.search(TM.strip(text)):
            fail(f"{where}: says 'akar'; a part's base form is its 'bentuk dasar' (rule 14: akar = the root letters)")
        authored_plain[where] = TM.strip(text)
        authored_marked[where] = TM.explicit(text, by_id, by_form)

    # 3. library.json is a fresh build
    lib = json.loads(LIBRARY.read_text(encoding="utf-8"))
    dv = lib.get("data_versions", {})
    for key, f in (("authored_terms", TERMS), ("authored_concepts", CONCEPTS), ("authored_basics", BASICS),
                   ("authored_parts", PARTS)):
        if f.exists() and sha256_file(f) not in dv.get(key, ""):
            fail(f"library.json data_versions.{key} is stale or missing (authored/{f.name} changed since the build; "
                 f"run build_library.py)")
    shipped_terms = {t["id"]: t for t in lib.get("terms", [])}
    for t in table.get("terms", []):
        s = shipped_terms.get(t["id"])
        want = {"latin": t["latin"], "ar": t.get("ar"), "group": t["group"], "hint": t.get("hint")}
        if not s or {k: s.get(k) for k in want} != want:
            fail(f"library.json terms[{t['id']}] does not equal the term table")
    for tid in set(shipped_terms) - set(by_id):
        fail(f"library.json ships term {tid!r}, which the term table does not have")

    def shipped(rec_kind: str, rec: dict):
        w = f"{rec_kind}[{rec.get('id', rec.get('loc'))}]"
        mk = rec.get("marked")
        if rec_kind in ("concepts", "basics"):
            if not mk:
                fail(f"library.json {w}: no marked prose")
                return
            pairs = [("title", mk.get("title"), rec.get("title")), ("summary", mk.get("summary"), rec.get("summary"))]
            pairs += [(f"explanation[{i}]", m, p) for i, (m, p) in
                      enumerate(zip(mk.get("explanation", []), rec.get("explanation", [])))]
            if len(mk.get("explanation", [])) != len(rec.get("explanation", [])):
                fail(f"library.json {w}: marked and plain explanation differ in length")
            if rec.get("bridge") or mk.get("bridge"):
                pairs.append(("bridge", mk.get("bridge"), rec.get("bridge")))
            if rec_kind == "concepts":
                if len(mk.get("notes", [])) != len(rec.get("examples", [])):
                    fail(f"library.json {w}: {len(mk.get('notes', []))} marked notes for {len(rec.get('examples', []))} examples")
                pairs += [(f"examples[{i}].note", m, x.get("note")) for i, (m, x) in
                          enumerate(zip(mk.get("notes", []), rec.get("examples", [])))]
            for fld, m, p in pairs:
                where = f"{w}.{fld}"
                if m is None or p is None or TM.strip(m) != p:
                    fail(f"library.json {where}: the plain text is not the marked text without its markup")
                if p and ("[[" in p or "]]" in p):
                    fail(f"library.json {where}: markup left in a plain field")
                if p is not None and authored_plain.get(where) not in (None, p):
                    fail(f"library.json {where}: differs from the authored text (run build_library.py)")
                if m is not None and authored_marked.get(where) not in (None, m):
                    fail(f"library.json {where}: the marked text differs from the authored markup "
                         f"(a hand edit or a stale build; run build_library.py)")
                for _s, ref in TM.spans(m or ""):
                    if not ref.startswith("q:") and ref not in shipped_terms:
                        fail(f"library.json {where}: names term {ref!r}, which is not shipped")
        for ex in rec.get("examples", []) if rec_kind == "concepts" else []:
            if ex["loc"] not in words:
                fail(f"library.json {w}: example {ex['loc']} is not a lesson word")
            else:
                wd = words[ex["loc"]]
                if not (wd.get("ar") and wd.get("translit") and wd.get("gloss")):
                    fail(f"library.json {w}: example {ex['loc']} lacks Arabic, transliteration or gloss in content")

    words = lesson_words()
    for c in lib.get("concepts", []):
        shipped("concepts", c)
    for b in lib.get("basics", []):
        shipped("basics", b)
    for pt in lib.get("parts", []):
        w = f"parts[{pt.get('loc')}]"
        got = [(f"{w}.tiles[{i}].label", t.get("label")) for i, t in enumerate(pt.get("tiles", []))]
        got += [(f"{w}.steps[{i}]", t) for i, t in enumerate(pt.get("steps", []))]
        for where, m in got:
            if authored_marked.get(where) != m:
                fail(f"library.json {where}: the marked text differs from the authored markup "
                     f"(a hand edit or a stale build; run build_library.py)")

    # 4. Qur'anic bytes
    quran = lib.get("quran", {})
    segments = lib.get("segments", {})
    used = set()
    for rec in lib.get("concepts", []) + lib.get("basics", []):
        mk = rec.get("marked") or {}
        for t in [mk.get("title", ""), mk.get("summary", ""), *mk.get("explanation", []), mk.get("bridge") or "",
                  *mk.get("notes", [])]:
            used |= {r for r in TM.q_refs(t)}
        for sg in rec.get("signs", []):
            used.add(sg["example"])
    for pt in lib.get("parts", []):
        used.add(f"q:{pt['loc']}")
        for tl in pt["tiles"]:
            used.add(tl["q"])
            used |= set(TM.q_refs(tl["label"]))
        for s in pt["steps"]:
            used |= set(TM.q_refs(s))
    for ref in sorted(used):
        if ref[2:] not in quran:
            fail(f"library.json quran has no bytes for {ref}")
    for loc, segs in segments.items():
        if loc in words and "".join(segs) != words[loc]["ar"]:
            fail(f"library.json segments[{loc}] do not join to the lesson word's content bytes")

    # every word, run and segment ref: its Latin names its bytes (review 2026-10-10)
    def surfaces(text: str, where: str) -> None:
        for surface, ref in TM.spans(text):
            m = TM.QREF.match(ref or "")
            if not m or m.group(6) or ref[2:] not in quran:
                continue
            if not TM.surface_matches(surface, quran[ref[2:]]):
                fail(f"library.json {where}: [[{surface}|{ref}]]: {surface!r} does not name {quran[ref[2:]]} "
                     f"(consonants {TM.skeleton_latin(surface)!r} vs {TM.skeleton_ar(quran[ref[2:]])!r})")
    for rec_kind in ("concepts", "basics"):
        for rec in lib.get(rec_kind, []):
            mk = rec.get("marked") or {}
            w = f"{rec_kind}[{rec.get('id')}]"
            for fld, t in [("title", mk.get("title", "")), ("summary", mk.get("summary", "")),
                           *[(f"explanation[{i}]", p) for i, p in enumerate(mk.get("explanation", []))],
                           ("bridge", mk.get("bridge") or ""),
                           *[(f"examples[{i}].note", n) for i, n in enumerate(mk.get("notes", []))]]:
                surfaces(t, f"{w}.{fld}")
    for pt in lib.get("parts", []):
        w = f"parts[{pt.get('loc')}]"
        tiles = []
        for i, t in enumerate(pt.get("tiles", [])):
            surfaces(t.get("label", ""), f"{w}.tiles[{i}].label")
            b = quran.get(t["q"][2:])
            tiles.append(b)
            if b is not None and not TM.surface_matches(t.get("translit", ""), b):
                fail(f"library.json {w}.tiles[{i}]: translit {t.get('translit')!r} does not name the tile's bytes {b}")
        for i, t in enumerate(pt.get("steps", [])):
            surfaces(t, f"{w}.steps[{i}]")
        if None not in tiles and pt.get("loc") in words:
            for x in TM.parts_problems(tiles, pt.get("changes", []), pt.get("drops", []), words[pt["loc"]]["ar"]):
                fail(f"library.json {w}: {x}")
    for b in lib.get("basics", []):
        for i, sg in enumerate(b.get("signs", [])):
            letter = quran.get(sg.get("example", "")[2:])
            if letter is not None:
                for x in TM.sign_problems(sg, letter, f"basics[{b.get('id')}].signs[{i}]"):
                    fail(f"library.json {x}")
    for key, bytes_ in quran.items():
        m = TM.QREF.match("q:" + key)
        if not m:
            fail(f"library.json quran key {key!r} is not a q-ref")
            continue
        loc = ":".join(m.groups()[:3])
        if loc not in words:
            continue  # a Tanzil token outside the lessons: the corpus check below
        word = words[loc]["ar"]
        if m.group(4):
            run = [words.get(f"{m.group(1)}:{m.group(2)}:{k}", {}).get("ar") for k in
                   range(int(m.group(3)), int(m.group(4)) + 1)]
            ok = None not in run and bytes_ == " ".join(run)
        elif m.group(5):
            segs = segments.get(loc) or []
            k = int(m.group(5))
            ok = 1 <= k <= len(segs) and segs[k - 1] == bytes_
        elif m.group(6):
            try:
                ok = TM.letter_of(word, int(m.group(6))) == bytes_
            except ValueError:
                ok = False
        else:
            ok = bytes_ == word
        if not ok:
            fail(f"library.json quran[{key}] {bytes_} does not match the lesson content bytes of {loc} ({word})")
    if not no_corpus:
        S = load_sources()
        T = load_tanzil(require_pinned(S, "tanzil_uthmani"))
        segs_, _ = load_qac(require_pinned(S, "qac_morphology"))
        W = qac_words(segs_)

        def tok(s, a, w):
            if (s, a) not in T.verses:
                return None
            toks = lesson_ayah(T, s, a)[0].split(" ")
            return toks[w - 1] if 1 <= w <= len(toks) else None

        for key, bytes_ in quran.items():
            try:
                want = TM.resolve_q("q:" + key, tok, lambda s, a, w: [bw_to_ar(g.form) for g in W.get((s, a, w), [])])
            except ValueError as e:
                fail(f"library.json quran[{key}]: {e}")
                continue
            if want != bytes_:
                fail(f"library.json quran[{key}] {bytes_} is not the pinned Tanzil/QAC bytes {want}")

    if fails:
        print("VALIDATION FAILED:", file=sys.stderr)
        for m in fails:
            print("  - " + m, file=sys.stderr)
        return 1
    n_ar = sum(1 for t in table["terms"] if t.get("ar"))
    print(f"OK: {len(table['terms'])} terms ({n_ar} with an attested Arabic spelling: "
          f"{stats.get('harakat_confirmed', 0)} with every mark confirmed by a source, "
          f"{stats.get('harakat_unconfirmed', 0)} with marks no source confirms, listed below; "
          f"{len(table['terms']) - n_ar} in Latin only), "
          f"{len(authored_plain)} marked prose fields, {len(quran)} Qur'anic refs, "
          f"{len(lib.get('parts', []))} parts diagrams, {len(lib.get('basics', []))} basics page(s)"
          + ("" if not no_corpus else f".\nSKIPPED (need pipeline/cache; run without --no-corpus locally): "
             f"{'; '.join(NO_CORPUS_SKIPPED)}") + ".")
    for line in report:
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
