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
  6. (2026-10-12, operator: "write the arabic words, not only the transliteration" on a word card;
     "check also other parts") The lessons' marked prose (terms.MARKED_SURAHS: a word's why, role,
     sign, wazn and ikhtilaf, the ayah structure, the facts; authored in <slug>.words.json,
     <slug>.structure.json and the facts overlay <slug>.facts.marked.json) and the Kosakata prose
     (library.lexicon.json: meanings, tashrif bab, i'lal rules, root meanings; the word class and
     the tashrif labels marked by the build, terms.mark_terms): the authored markup passes the same
     checks as the Konsep prose (the Kosakata keeps its wording: no style rules); each shipped
     `marked` twin strips to its plain field and equals the authored markup made explicit; every
     q-ref has bytes in the lesson's own `quran` (lesson words: the content bytes; with the cache:
     the pinned Tanzil/QAC bytes), and its Latin names them; an unmarked lesson ships no markup.
  7. Every shipped marked text: the GLOSS variant ([[“nama Allah”|q:1:1:1-2]]: the surface one
     quotation “…”, a word, run or segment ref that resolves; its Latin is not compared with the
     bytes) and no Arabic typed by hand (only «…» quotations and single letters; a `wazn` and a
     tashrif `bab` are typed patterns by design).
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
LEXICON = AUTHORED / "library.lexicon.json"
LESSON_AUTHORED = AUTHORED  # <slug>.words.json, .structure.json, .facts.marked.json of a marked lesson
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


def lessons_marked():
    """(spec, lesson content) of every marked lesson in content/ (terms.MARKED_SURAHS)."""
    out = []
    for spec in SURAHS:
        p = LESSON_DIR / f"{spec.slug}.json"
        if spec.slug in TM.MARKED_SURAHS and p.exists():
            out.append((spec, json.loads(p.read_text(encoding="utf-8"))))
    return out


def library_marked_texts(lib: dict):
    """(where, marked text, typed Arabic allowed) of every marked text library.json ships."""
    for kind in ("concepts", "basics"):
        for rec in lib.get(kind, []):
            mk = rec.get("marked") or {}
            w = f"{kind}[{rec.get('id')}]"
            for fld in ("title", "summary", "bridge"):
                if mk.get(fld):
                    yield f"{w}.{fld}", mk[fld], False
            for i, t in enumerate(mk.get("explanation", [])):
                yield f"{w}.explanation[{i}]", t, False
            for i, t in enumerate(mk.get("notes", [])):
                yield f"{w}.examples[{i}].note", t, False
    for pt in lib.get("parts", []):
        w = f"parts[{pt.get('loc')}]"
        for i, t in enumerate(pt.get("tiles", [])):
            yield f"{w}.tiles[{i}].label", t.get("label", ""), False
        for i, t in enumerate(pt.get("steps", [])):
            yield f"{w}.steps[{i}]", t, False
    for lx in lib.get("lexicon", []):
        mk = lx.get("marked") or {}
        w = f"lexicon[{lx.get('id')}]"
        for fld in ("meaning", "pos"):
            if mk.get(fld):
                yield f"{w}.{fld}", mk[fld], False
        if mk.get("bab"):
            yield f"{w}.bab", mk["bab"], True  # the bab names its wazan in typed imla'i Arabic
        for i, t in enumerate(mk.get("labels", [])):
            yield f"{w}.labels[{i}]", t, False
        for i, t in enumerate(mk.get("ilal", [])):
            yield f"{w}.ilal[{i}]", t, False
    for r in lib.get("roots", []):
        if (r.get("marked") or {}).get("meaning"):
            yield f"roots[{r.get('id')}].meaning", r["marked"]["meaning"], False


def marked_lessons_and_lexicon(lib: dict, table: dict, by_id: dict, by_form: dict, words: dict,
                               shipped_terms: dict) -> int:
    """Check 6 (module docstring). Returns how many marked fields were checked."""
    n = 0
    translit = {loc: w.get("translit", "") for loc, w in words.items()}

    def authored(text: str, where: str, style: bool = True, typed_ok: bool = False) -> str:
        """The authored markup, checked; returned with every term named by id."""
        for x in TM.check_markup(text, where, by_id, by_form, table):
            fail(x)
        if style:
            for x in TM.wording(TM.strip(text), where) + TM.meaning_problems(text, where):
                fail(x)
        if not typed_ok:
            for x in TM.typed_arabic(text, where):
                fail(x)
        return TM.explicit(text, by_id, by_form)

    def shipped(where: str, marked, plain, want, qmap: dict | None, typed_ok: bool = False) -> None:
        """One shipped (marked, plain) pair against the authored markup `want` (made explicit)."""
        nonlocal n
        n += 1
        if marked is None or plain is None:
            fail(f"{where}: no marked twin (run the build)")
            return
        if TM.strip(marked) != plain:
            fail(f"{where}: the plain text is not the marked text without its markup")
        if "[[" in plain or "]]" in plain:
            fail(f"{where}: markup left in a plain field")
        if want is not None and marked != want:
            fail(f"{where}: the marked text differs from the authored markup (a hand edit or a stale build)")
        for surface, ref in TM.spans(marked):
            for x in TM.gloss_problems(surface, ref, where):
                fail(x)
            if not ref.startswith("q:"):
                if ref not in shipped_terms:
                    fail(f"{where}: names term {ref!r}, which library.json does not ship")
                continue
            if qmap is None:
                continue
            if ref[2:] not in qmap:
                fail(f"{where}: {ref} has no bytes in the lesson's quran")
                continue
            m = TM.QREF.match(ref)
            if m and not m.group(6) and not TM.is_gloss(surface) and not TM.surface_matches(surface, qmap[ref[2:]]):
                fail(f"{where}: [[{surface}|{ref}]]: {surface!r} does not name {qmap[ref[2:]]}")
            for x in TM.translit_problems(surface, ref, where, translit):
                fail(x)
        if not typed_ok:
            for x in TM.typed_arabic(marked, where):
                fail(x)

    # --- the lessons
    for spec in SURAHS:
        p = LESSON_DIR / f"{spec.slug}.json"
        if not p.exists():
            continue
        lesson = json.loads(p.read_text(encoding="utf-8"))
        name = f"content/{spec.slug}.json"
        any_marked = any("marked" in w for a in lesson["ayat"] for w in a["words"]) or \
            any("marked" in (a.get("structure") or {}) for a in lesson["ayat"]) or any("marked" in f for f in lesson.get("facts", []))
        if spec.slug not in TM.MARKED_SURAHS:
            if any_marked or lesson.get("quran"):
                fail(f"{name}: ships marked prose, but {spec.slug} is not a marked lesson (terms.MARKED_SURAHS)")
            continue
        wa = json.loads((LESSON_AUTHORED / f"{spec.slug}.words.json").read_text(encoding="utf-8"))["words"]
        sa = json.loads((LESSON_AUTHORED / f"{spec.slug}.structure.json").read_text(encoding="utf-8"))
        fm_path = LESSON_AUTHORED / f"{spec.slug}.facts.marked.json"
        overlay = json.loads(fm_path.read_text(encoding="utf-8")).get("facts", {}) if fm_path.exists() else {}
        dv = lesson.get("data_versions", {})
        for key, f in (("authored_words", LESSON_AUTHORED / f"{spec.slug}.words.json"),
                       ("authored_structure", LESSON_AUTHORED / f"{spec.slug}.structure.json"),
                       ("authored_facts_marked", fm_path)):
            if f.exists() and sha256_file(f) not in dv.get(key, ""):
                fail(f"{name} data_versions.{key} is stale or missing (authored/{f.name} changed since the build; "
                     f"run build_surah.py {spec.slug})")
        qmap = lesson.get("quran") or {}
        segs = lesson.get("segments") or {}
        for a in lesson["ayat"]:
            for w in a["words"]:
                au, sw = wa[w["loc"]], sa["words"][w["loc"]]
                wp = f"{name} words[{w['loc']}]"
                mk = w.get("marked") or {}
                shipped(f"{wp}.why", mk.get("why"), w["why"], authored(au["why"], f"{wp}.why"), qmap)
                if w.get("role"):
                    shipped(f"{wp}.role", mk.get("role"), w["role"], authored(sw["role"], f"{wp}.role"), qmap)
                if w["case"]["sign"] != "—":
                    shipped(f"{wp}.sign", mk.get("sign"), w["case"]["sign"],
                            authored(au["case"]["sign"], f"{wp}.sign"), qmap)
                if w.get("wazn"):
                    shipped(f"{wp}.wazn", mk.get("wazn"), w["wazn"], authored(au["wazn"], f"{wp}.wazn", typed_ok=True),
                            qmap, typed_ok=True)
                ikh = mk.get("ikhtilaf") or []
                if len(ikh) != len(w["ikhtilaf"]):
                    fail(f"{wp}: {len(ikh)} marked ikhtilaf for {len(w['ikhtilaf'])}")
                for i, (x, y, z) in enumerate(zip(w["ikhtilaf"], ikh, au["ikhtilaf"])):
                    shipped(f"{wp}.ikhtilaf[{i}].point", y.get("point"), x["point"],
                            authored(z["point"], f"{wp}.ikhtilaf[{i}].point"), qmap)
                    if len(y.get("options", [])) != len(x["options"]):
                        fail(f"{wp}.ikhtilaf[{i}]: marked and plain options differ in number")
                    for j, (o, mo, ao) in enumerate(zip(x["options"], y.get("options", []), z["options"])):
                        shipped(f"{wp}.ikhtilaf[{i}].options[{j}]", mo, o,
                                authored(ao, f"{wp}.ikhtilaf[{i}].options[{j}]"), qmap)
            st = a.get("structure")
            if st:
                sp = f"{name} structure[{a['loc']}]"
                ast = sa["ayat"][str(a["ayah"])]["structure"]
                smk = st.get("marked") or {}
                shipped(f"{sp}.type", smk.get("type"), st["type"], authored(ast["type"], f"structure[{a['loc']}].type"), qmap)
                shipped(f"{sp}.summary", smk.get("summary"), st["summary"],
                        authored(ast["summary"], f"structure[{a['loc']}].summary"), qmap)
                labels = smk.get("groups") or []
                if len(labels) != len(st["groups"]):
                    fail(f"{sp}: {len(labels)} marked group labels for {len(st['groups'])} groups")
                for i, (g, lm, ag) in enumerate(zip(st["groups"], labels, ast["groups"])):
                    shipped(f"{sp}.groups[{i}].label", lm, g["label"],
                            authored(ag["label"], f"structure[{a['loc']}].groups[{i}].label"), qmap)
        for fid in sorted(set(overlay) - {f["id"] for f in lesson.get("facts", [])}):
            fail(f"authored/{fm_path.name}: fact {fid!r} is not a fact of {spec.slug}")
        for f in lesson.get("facts", []):
            fmk = f.get("marked") or {}
            for fld in ("title", "body", "method"):
                text = (overlay.get(f["id"]) or {}).get(fld, f[fld])
                shipped(f"{name} facts[{f['id']}].{fld}", fmk.get(fld), f[fld],
                        authored(text, f"facts[{f['id']}].{fld}"), qmap)
        # the lesson's byte map: lesson words are the content bytes, segments join to the word
        for loc, ss in segs.items():
            if loc in words and "".join(ss) != words[loc]["ar"]:
                fail(f"{name} segments[{loc}] do not join to the lesson word's content bytes")
        for key, bytes_ in qmap.items():
            m = TM.QREF.match("q:" + key)
            if not m:
                fail(f"{name} quran key {key!r} is not a q-ref")
                continue
            loc = ":".join(m.groups()[:3])
            if loc not in words:
                continue
            word = words[loc]["ar"]
            if m.group(4):
                run = [words.get(f"{m.group(1)}:{m.group(2)}:{k}", {}).get("ar") for k in
                       range(int(m.group(3)), int(m.group(4)) + 1)]
                ok = None not in run and bytes_ == " ".join(run)
            elif m.group(5):
                ss = segs.get(loc) or []
                ok = 1 <= int(m.group(5)) <= len(ss) and ss[int(m.group(5)) - 1] == bytes_
            elif m.group(6):
                try:
                    ok = TM.letter_of(word, int(m.group(6))) == bytes_
                except ValueError:
                    ok = False
            else:
                ok = bytes_ == word
            if not ok:
                fail(f"{name} quran[{key}] {bytes_} does not match the lesson content bytes of {loc} ({word})")

    # --- the Kosakata (library.lexicon.json → library.json lexicon / roots)
    lx_src = json.loads(LEXICON.read_text(encoding="utf-8"))
    dv = lib.get("data_versions", {})
    if sha256_file(LEXICON) not in dv.get("authored_lexicon", ""):
        fail("library.json data_versions.authored_lexicon is stale or missing (run build_library.py)")
    src_by_id = {e["id"]: e for e in lx_src["lexicon"]}
    lib_q = lib.get("quran", {})
    for lx in lib.get("lexicon", []):
        e = src_by_id.get(lx["id"])
        if e is None:
            continue
        w = f"library.json lexicon[{lx['id']}]"
        mk = lx.get("marked") or {}
        shipped(f"{w}.meaning", mk.get("meaning"), lx["meaning"],
                authored(e["meaning"], f"lexicon[{lx['id']}].meaning", style=False), lib_q)
        shipped(f"{w}.pos", mk.get("pos"), lx["pos"], TM.mark_terms(lx["pos"], table, ambiguous=True), lib_q)
        if lx.get("tashrif"):
            shipped(f"{w}.bab", mk.get("bab"), lx["tashrif"]["bab"],
                    authored(e["tashrif"]["bab"], f"lexicon[{lx['id']}].tashrif.bab", style=False, typed_ok=True),
                    lib_q, typed_ok=True)
            labels = mk.get("labels") or []
            if len(labels) != len(lx["tashrif"]["forms"]):
                fail(f"{w}: {len(labels)} marked tashrif labels for {len(lx['tashrif']['forms'])} forms")
            for i, (f, lm) in enumerate(zip(lx["tashrif"]["forms"], labels)):
                shipped(f"{w}.labels[{i}]", lm, f["label"], TM.mark_terms(f["label"], table), lib_q)
        ilal = mk.get("ilal") or []
        if len(ilal) != len(lx.get("ilal", [])):
            fail(f"{w}: {len(ilal)} marked i'lal rules for {len(lx.get('ilal', []))}")
        for i, (il, im, ie) in enumerate(zip(lx.get("ilal", []), ilal, e.get("ilal", []))):
            shipped(f"{w}.ilal[{i}]", im, il["rule"], authored(ie["rule"], f"lexicon[{lx['id']}].ilal[{i}].rule", style=False),
                    lib_q)
    from build_library import root_id  # the id the build gives a root (pure; no corpus)
    roots_src = {root_id(r["qac_root"]): r for r in lx_src["roots"]}
    for r in lib.get("roots", []):
        w = f"library.json roots[{r['id']}]"
        e = roots_src.get(r["id"])
        want = authored(e["meaning"], f"roots[{r['id']}].meaning", style=False) if e else None
        shipped(f"{w}.meaning", (r.get("marked") or {}).get("meaning"), r["meaning"], want, lib_q)
    return n


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
                  + TM.meaning_problems(text, where) + TM.typed_arabic(text, where)):
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
            used.add(sg["example"].split("#")[0])  # the word the letter is cut from: "dari <word> (…)"
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
            if not m or m.group(6) or ref[2:] not in quran or TM.is_gloss(surface):  # a gloss is no transliteration
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
            # "dari <word> (<transliteration>)": a lesson word brings its own; a word outside the
            # lessons (chosen so the sign is heard there, clips.py) carries one that names its bytes
            sloc = sg.get("example", "")[2:].split("#")[0]
            sword, sw = quran.get(sloc), f"library.json basics[{b.get('id')}].signs[{i}]"
            if sloc in words:
                if "translit" in sg:
                    fail(f"{sw}: {sloc} is a lesson word, shown with the lesson's transliteration; remove `translit`")
            elif sword is not None and not sg.get("translit"):
                fail(f"{sw}: the example's word {sword} ({sloc}) is not a lesson word; it needs `translit`")
            elif sword is not None and not TM.surface_matches(sg["translit"], sword):
                fail(f"{sw}: translit {sg['translit']!r} does not name the example's word {sword}")
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

    # 6. the lessons' marked prose and the Kosakata prose (2026-10-12)
    n_marked = marked_lessons_and_lexicon(lib, table, by_id, by_form, words, shipped_terms)
    # 7. every shipped marked text of the library: gloss variant, no typed Arabic
    for where, text, typed_ok in library_marked_texts(lib):
        for surface, ref in TM.spans(text):
            for x in TM.gloss_problems(surface, ref, f"library.json {where}"):
                fail(x)
        if not typed_ok:
            for x in TM.typed_arabic(text, f"library.json {where}"):
                fail(x)

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

        maps = [("library.json", quran)] + [(f"content/{spec.slug}.json", lesson.get("quran") or {})
                                           for spec, lesson in lessons_marked()]
        for name, qmap in maps:
            for key, bytes_ in qmap.items():
                try:
                    want = TM.resolve_q("q:" + key, tok, lambda s, a, w: [bw_to_ar(g.form) for g in W.get((s, a, w), [])])
                except ValueError as e:
                    fail(f"{name} quran[{key}]: {e}")
                    continue
                if want != bytes_:
                    fail(f"{name} quran[{key}] {bytes_} is not the pinned Tanzil/QAC bytes {want}")

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
          f"{len(authored_plain)} marked prose fields of the Konsep library and {n_marked} of the lessons and "
          f"the Kosakata, {len(quran)} Qur'anic refs, "
          f"{len(lib.get('parts', []))} parts diagrams, {len(lib.get('basics', []))} basics page(s)"
          + ("" if not no_corpus else f".\nSKIPPED (need pipeline/cache; run without --no-corpus locally): "
             f"{'; '.join(NO_CORPUS_SKIPPED)}") + ".")
    for line in report:
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
