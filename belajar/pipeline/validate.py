#!/usr/bin/env python3
"""Stage 6 (local half): re-check belajar/content/al-fatihah.json. Exit 1 on any failure.

Checks
  1. Qur'anic text: every ayah `ar` equals its Tanzil line byte-for-byte; every word `ar` equals
     the w-th space token of that line; both are byte-exact substrings of the pinned Tanzil file.
     Every «…» quotation in any prose field is a byte-exact substring too, and any other Arabic
     script in prose may only be single letters (letter lists such as roots).
  2. Words: 29 in total, 4+4+2+3+4+3+9, locs consecutive and matching their ayah.
  3. Recitation segments: integers, sorted, non-overlapping, endMs > startMs, word indices
     cover 1..N exactly once, last end not after the measured length of the streamed file.
  4. Sources: every word and fact has >= 1 SourceRef with a kitab; urls are http(s).
  5. Review: every status is "draft".
  6. Shape: every object's keys match the field names in belajar/src/content/schema.ts
     exactly (no unknown keys, no missing required keys), enums and loc formats hold.
  7. Pins: data_versions repeat the sha256 values pinned in sources.json; the cached Tanzil
     file still matches its pin.
  8. Translation: `text` is byte-identical to the cached QuranEnc `translation` (footnote markers
     kept); `footnotes` are the cached QuranEnc `footnotes` field, verbatim, one item per [n],
     in order, with nothing but whitespace left over; markers in the text = footnote markers.
  9. Fact counts, re-derived here from QAC 0.4: for every LEM:/ROOT: query named in a fact's QAC
     source whose ayah set equals the fact's location list, a count that differs from the number
     of ayat must be stated as "N kali dalam M ayat". Every "N kali dalam M ayat" has M = number
     of locations; a title count that differs from it must be restated that way in the body.
     Fact methods that use QAC carry the QAC 0.4 / Tanzil 1.0.2 basis note, and the QAC header
     and the surah-1 byte identity behind that note are re-checked.
 10. Prose transliteration: no capital after the article hyphen in an SKB word (capital only for
     Allah); no ASCII apostrophe in a word written in SKB (hamzah ’, ‘ain ‘); no
     ASCII-apostrophe spelling of a transliteration that appears elsewhere in SKB form; none of
     the known ASCII spellings (istaf'ala, al-musta'an, abtadi'u, ibtida'i, hada, ila).
 11. Kitab refs: Darwisy is cited under one title, always with a verified page; a verb with a
     wazn carries its QAC verb-form (VF) ref; a mabni word whose `why` names its built-in vowel
     has that vowel as `sign`; a jar-majrur word with a mahall says the mahall is the phrase's.
"""
from __future__ import annotations

import json
import re
import sys

from common import (ARABIC_RUN, CONTENT_DIR, PIPELINE, SCHEMA_TS, bw_to_ar, load_qac, load_sources, load_tanzil,
                    qac_words, require_pinned, sha256_file)

OUT = CONTENT_DIR / "al-fatihah.json"
EXPECTED_WORDS = [4, 4, 2, 3, 4, 3, 9]
QAC_TANZIL_HEADER = "Tanzil Quran Text (Uthmani, version 1.0.2)"
QAC_BASIS = ("QAC 0.4 (disusun di atas teks Tanzil Uthmani 1.0.2; surah 1 identik byte-per-byte "
             "dengan 1.1 yang dipakai)")
DARWISY = "Muhyiddin Darwisy, I'rab al-Qur'an wa Bayanuh (cet. 4, 1415 H)"
fails: list[str] = []


def fail(msg: str) -> None:
    fails.append(msg)


# ---------------------------------------------------------------- schema.ts reader
def parse_schema(ts: str) -> tuple[dict, dict]:
    """Return ({SchemaName: {field: spec}}, {EnumName: [values]}) from the zod source."""
    ts = re.sub(r"/\*.*?\*/", "", ts, flags=re.S)
    ts = re.sub(r"//[^\n]*", "", ts)
    ts = re.sub(r"\.regex\(/.*?/\)", ".regex(RE)", ts)
    enums = {m.group(1): re.findall(r'"([^"]*)"', m.group(2))
             for m in re.finditer(r"export const (\w+) = z\.enum\(\[(.*?)\]\)", ts, flags=re.S)}
    schemas: dict[str, dict] = {}
    names = re.findall(r"export const (\w+) = z\.object\(", ts)
    for name in names:
        start = ts.index(f"export const {name} = z.object(") + len(f"export const {name} = z.object(")
        body = balanced(ts, start)
        schemas[name] = body
    parsed = {name: parse_object(body, set(names) | set(enums)) for name, body in schemas.items()}
    return parsed, enums


def balanced(s: str, i: int) -> str:
    """s[i] is '{'; return the text inside the matching braces."""
    assert s[i] == "{", s[i:i + 20]
    depth, j = 0, i
    while True:
        c = s[j]
        if c in "{([":
            depth += 1
        elif c in "})]":
            depth -= 1
            if depth == 0:
                return s[i + 1:j]
        elif c == '"':
            j = s.index('"', j + 1)
        j += 1


def split_top(body: str) -> list[str]:
    parts, depth, cur, j = [], 0, [], 0
    while j < len(body):
        c = body[j]
        if c == '"':
            k = body.index('"', j + 1)
            cur.append(body[j:k + 1])
            j = k + 1
            continue
        if c in "{([":
            depth += 1
        elif c in "})]":
            depth -= 1
        if c == "," and depth == 0:
            parts.append("".join(cur))
            cur = []
        else:
            cur.append(c)
        j += 1
    parts.append("".join(cur))
    return [p.strip() for p in parts if p.strip()]


def parse_object(body: str, known: set[str]) -> dict:
    fields = {}
    for entry in split_top(body):
        key, val = entry.split(":", 1)
        key, val = key.strip(), re.sub(r"\s+", "", val)
        spec = {"optional": bool(re.search(r"\.(optional|default)\([^()]*(\([^()]*\))?[^()]*\)$", val)
                                 or val.endswith(".optional()")),
                "nullable": ".nullable()" in val}
        if val.startswith("z.object({"):
            spec["object"] = parse_object(balanced(val, len("z.object(")), known)
        elif val.startswith("z.array(z.object({"):
            spec["array_object"] = parse_object(balanced(val, len("z.array(z.object(")), known)
        else:
            m = re.match(r"z\.array\((\w+)\)", val)
            if m and m.group(1) in known:
                spec["array_ref"] = m.group(1)
            else:
                m = re.match(r"(\w+)", val)
                if m and m.group(1) in known:
                    spec["ref"] = m.group(1)
        fields[key] = spec
    return fields


def check_shape(obj, fields: dict, schemas: dict, enums: dict, path: str) -> None:
    if not isinstance(obj, dict):
        fail(f"{path}: expected an object")
        return
    extra = set(obj) - set(fields)
    missing = {k for k, sp in fields.items() if not sp["optional"] and k not in obj}
    if extra:
        fail(f"{path}: keys not in schema.ts: {sorted(extra)}")
    if missing:
        fail(f"{path}: required keys missing: {sorted(missing)}")
    for k, sp in fields.items():
        if k not in obj:
            continue
        v = obj[k]
        if v is None:
            if not sp["nullable"]:
                fail(f"{path}.{k}: null but not nullable in schema.ts")
            continue
        if "object" in sp:
            check_shape(v, sp["object"], schemas, enums, f"{path}.{k}")
        elif "array_object" in sp:
            for i, it in enumerate(v):
                check_shape(it, sp["array_object"], schemas, enums, f"{path}.{k}[{i}]")
        elif "array_ref" in sp and sp["array_ref"] in schemas:
            for i, it in enumerate(v):
                check_shape(it, schemas[sp["array_ref"]], schemas, enums, f"{path}.{k}[{i}]")
        elif "ref" in sp and sp["ref"] in schemas:
            check_shape(v, schemas[sp["ref"]], schemas, enums, f"{path}.{k}")
        elif "ref" in sp and sp["ref"] in enums and v not in enums[sp["ref"]]:
            fail(f"{path}.{k}: {v!r} not in enum {sp['ref']} {enums[sp['ref']]}")


# ---------------------------------------------------------------- prose checks
QUOTE = re.compile(r"«([^»]*)»")
TRANSLIT_OK = set("abcdefghijklmnopqrstuvwxyz -’‘āīūḥṡżṣḍṭẓA")
TRANSLIT_BAD = re.compile(r"sh|dh|th|gh|ts|dz|'|ʿ|ʾ")


def check_prose(text: str, raw: str, path: str) -> None:
    for m in QUOTE.finditer(text):
        if m.group(1) not in raw:
            fail(f"{path}: quoted Arabic «{m.group(1)}» is not a byte-exact substring of Tanzil")
    rest = QUOTE.sub(" ", text)
    for run in ARABIC_RUN.findall(rest):
        if any(len(tok) != 1 for tok in run.split()):
            fail(f"{path}: unquoted Arabic {run!r} (only «quoted» Tanzil text or single letters allowed)")


SKB_MARKS = set("āīūḥṣḍṭẓṡż‘’ĀĪŪḤṢḌṬẒṠŻ")
_DEGRADE = str.maketrans({"ā": "a", "ī": "i", "ū": "u", "ḥ": "h", "ṣ": "s", "ḍ": "d", "ṭ": "t", "ẓ": "z",
                          "ṡ": "s", "ż": "z", "‘": "'", "’": "'"})
WORD_TOKEN = re.compile(r"[A-Za-zĀāĪīŪūḤḥṢṣḌḍṬṭẒẓṠṡŻż‘’'-]+")
KNOWN_ASCII = re.compile(r"(?<![\w'‘’])(istaf'ala|al-musta'an|abtadi'u|ibtida'i|hada|ila)(?![\w'‘’])")


def degrade(t: str) -> str:
    return t.lower().translate(_DEGRADE).strip("'-")


def check_translit_prose(items: list[tuple[str, str]], skb_words: set[str]) -> None:
    """items = (path, prose text). Grammar terms in pesantren spelling (fi'il, mubtada', 'athaf)
    may keep ASCII apostrophes; transliterated words may not."""
    skb = set(skb_words)
    for _, text in items:
        skb |= {t for t in WORD_TOKEN.findall(text) if set(t) & SKB_MARKS}
    degraded = {degrade(t): t for t in skb}
    for path, text in items:
        for m in KNOWN_ASCII.finditer(text):
            fail(f"{path}: ASCII transliteration {m.group(1)!r} (use SKB: ’ hamzah, ‘ ain, long vowels)")
        for t in WORD_TOKEN.findall(text):
            parts = t.split("-")
            if set(t) & SKB_MARKS and any(x[:1].isupper() and not x.startswith("All") for x in parts[1:]):
                fail(f"{path}: {t!r}: capital letter after the hyphen (SKB: capital only for the name Allah)")
            if "'" not in t:
                continue
            if set(t) & SKB_MARKS:
                fail(f"{path}: {t!r} mixes an ASCII apostrophe with SKB letters")
            elif degrade(t) in degraded:
                fail(f"{path}: {t!r} is an ASCII spelling of the transliteration {degraded[degrade(t)]!r}")


def fmt(n: int) -> str:
    return f"{n:,}".replace(",", ".")


KALI_DALAM = re.compile(r"(\d[\d.]*) kali dalam (\d[\d.]*) ayat")
QAC_QUERY = re.compile(r"\b(LEM|ROOT):([^\s;,]+)")


def check_fact_counts(f: dict, stems: list) -> None:
    fp = f"fact {f['id']}"
    locs = f["locations"]
    n_loc = len(locs)
    for m in KALI_DALAM.finditer(f["body"]):
        n, a = int(m.group(1).replace(".", "")), int(m.group(2).replace(".", ""))
        if a != n_loc:
            fail(f"{fp}: body says '{m.group(0)}' but lists {n_loc} ayat")
        if n <= a:
            fail(f"{fp}: '{m.group(0)}' — use 'kali dalam … ayat' only when the count exceeds the ayat")
    m = re.search(r"(\d[\d.]*) kali", f["title"])
    if m:
        n = int(m.group(1).replace(".", ""))
        # The only occurrences outside ayat text are surah-heading basmalahs (not ayat, so not
        # locations); a body that counts them as "pembuka K surah" accounts for the difference.
        if n != n_loc and f"{fmt(n)} kali dalam {fmt(n_loc)} ayat" not in f["body"] \
                and f"pembuka {fmt(n - n_loc)} surah" not in f["body"]:
            fail(f"{fp}: title count {n} != {n_loc} listed ayat, and the body does not say "
                 f"'{fmt(n)} kali dalam {fmt(n_loc)} ayat'")
    for sr in f["sources"]:
        if not sr["kitab"].startswith("Quranic Arabic Corpus"):
            continue
        for key, val in QAC_QUERY.findall(sr.get("ref", "")):
            hits = [g for g in stems if g.feat.get(key) == val]
            ayat = {f"{g.s}:{g.a}" for g in hits}
            if not hits:
                fail(f"{fp}: QAC query {key}:{val} matches nothing")
            elif ayat == set(locs) and len(hits) != len(ayat):
                want = f"{fmt(len(hits))} kali dalam {fmt(len(ayat))} ayat"
                if want not in f["body"]:
                    fail(f"{fp}: {key}:{val} = {len(hits)} segments in {len(ayat)} ayat; body must say '{want}'")
    if "QAC" in f["method"] and QAC_BASIS not in f["method"]:
        fail(f"{fp}: method uses QAC but lacks the basis note '{QAC_BASIS}'")


VOWELS = ("fathah", "kasrah", "dhammah", "sukun")


def check_word_sources(wd: dict, wp: str) -> None:
    for sr in wd["sources"]:
        if re.search(r"Darwis[yh]", sr["kitab"]):
            if sr["kitab"] != DARWISY:
                fail(f"{wp}: Darwisy cited as {sr['kitab']!r}, not {DARWISY!r}")
            if not re.search(r"hlm\. \d+", sr.get("ref", "")) or "belum" in sr.get("ref", ""):
                fail(f"{wp}: Darwisy ref without a verified page: {sr.get('ref')!r}")
    if wd["wazn"] and "fi'il" in wd["pos"] and not any("bentuk kata kerja (VF)" in sr.get("ref", "")
                                                        for sr in wd["sources"]):
        fail(f"{wp}: verb wazn {wd['wazn']!r} without a QAC verb-form (VF) ref")
    c = wd["case"]
    if c["state"] == "mabni":
        m = re.search(r"mabni di atas (" + "|".join(VOWELS) + ")", wd["why"])
        if m and c["sign"] != m.group(1):
            fail(f"{wp}: why says 'mabni di atas {m.group(1)}' but sign is {c['sign']!r}")
        if wd["pos"].startswith("huruf jar") and c.get("mahall") and "frasa jar-majrur" not in wd["why"]:
            fail(f"{wp}: jar-majrur word with {c['mahall']!r}; why must say the mahall belongs to the phrase")


def main() -> int:
    if not OUT.exists():
        print(f"missing {OUT}; run build_fatihah.py", file=sys.stderr)
        return 1
    src = load_sources()
    I = src["inputs"]
    tanzil_path = require_pinned(src, "tanzil_uthmani")
    T = load_tanzil(tanzil_path)
    raw = T.raw
    data = json.loads(OUT.read_text(encoding="utf-8"))
    segs, qac_header = load_qac(require_pinned(src, "qac_morphology"))
    stems = [g for g in segs if "STEM" in g.flags]
    if QAC_TANZIL_HEADER not in qac_header:
        fail(f"QAC header does not name '{QAC_TANZIL_HEADER}' (the basis note in fact methods)")
    qw = qac_words(segs)
    for a in range(1, 8):
        for w, tok in enumerate(T.verses[(1, a)].split(" "), 1):
            if bw_to_ar("".join(g.form for g in qw.get((1, a, w), []))) != tok:
                fail(f"QAC word 1:{a}:{w} is not byte-identical to the Tanzil 1.1 token")
    qe_rows = {int(r["aya"]): r for r in
               json.loads(require_pinned(src, "quranenc_indonesian_affairs").read_text(encoding="utf-8"))["result"]}
    prose: list[tuple[str, str]] = []
    skb_words: set[str] = set()

    # 6. shape against schema.ts
    if not SCHEMA_TS.exists():
        fail(f"schema not found at {SCHEMA_TS}")
    else:
        schemas, enums = parse_schema(SCHEMA_TS.read_text(encoding="utf-8"))
        if "SurahContent" not in schemas:
            fail("schema.ts has no SurahContent object")
        else:
            check_shape(data, schemas["SurahContent"], schemas, enums, "SurahContent")

    # 1/2. text and words
    ayat = data.get("ayat", [])
    if [a.get("ayah") for a in ayat] != list(range(1, 8)):
        fail(f"ayat are not 1..7: {[a.get('ayah') for a in ayat]}")
    counts = [len(a.get("words", [])) for a in ayat]
    if counts != EXPECTED_WORDS or sum(counts) != 29:
        fail(f"word counts {counts} (total {sum(counts)}) != {EXPECTED_WORDS} (29)")
    probes = {r: I[k]["files"] for r, k in (("Husary_Muallim_128kbps", "everyayah_husary_muallim"),
                                            ("Alafasy_128kbps", "everyayah_alafasy"))}
    for ay in ayat:
        s, a = ay["surah"], ay["ayah"]
        p = f"ayah {s}:{a}"
        if ay["loc"] != f"{s}:{a}":
            fail(f"{p}: loc {ay['loc']!r}")
        line = T.verses.get((s, a))
        if ay["ar"] != line:
            fail(f"{p}: ar differs from the Tanzil line")
        if ay["ar"] not in raw:
            fail(f"{p}: ar is not a substring of the Tanzil file")
        toks = line.split(" ") if line else []
        for w, wd in enumerate(ay["words"], 1):
            wp = f"word {wd.get('loc')}"
            if wd["loc"] != f"{s}:{a}:{w}":
                fail(f"{wp}: expected loc {s}:{a}:{w}")
            if w > len(toks) or wd["ar"] != toks[w - 1]:
                fail(f"{wp}: ar is not Tanzil token {w} of {s}:{a}")
            if wd["ar"] not in raw:
                fail(f"{wp}: ar is not a substring of the Tanzil file")
            if not wd.get("sources"):
                fail(f"{wp}: no sources")
            if wd.get("status") != "draft":
                fail(f"{wp}: status {wd.get('status')!r} (must be draft)")
            if wd.get("root") is not None and any(len(c) != 1 for c in wd["root"]):
                fail(f"{wp}: root items must be single letters")
            if len(wd.get("why", "")) < 10:
                fail(f"{wp}: why shorter than 10 characters")
            if set(wd["translit"]) - TRANSLIT_OK or TRANSLIT_BAD.search(wd["translit"]):
                fail(f"{wp}: translit {wd['translit']!r} outside the SKB 158/1987 character set")
            for fld in ("why", "gloss", "translit"):
                check_prose(wd[fld], raw, f"{wp}.{fld}")
            skb_words.update(wd["translit"].split())
            prose += [(f"{wp}.why", wd["why"]), (f"{wp}.gloss", wd["gloss"])]
            for i, ik in enumerate(wd.get("ikhtilaf", [])):
                if len(ik["options"]) < 2:
                    fail(f"{wp}.ikhtilaf[{i}]: fewer than 2 options")
                for t in [ik["point"], *ik["options"]]:
                    check_prose(t, raw, f"{wp}.ikhtilaf[{i}]")
                    prose.append((f"{wp}.ikhtilaf[{i}]", t))
            for sr in wd.get("sources", []):
                check_source(sr, wp)
            check_word_sources(wd, wp)
        # translation
        tr = ay["translation"]
        qe = qe_rows.get(a, {})
        if tr["text"] != qe.get("translation"):
            fail(f"{p}: translation.text is not byte-identical to the cached QuranEnc text")
        fn_raw = qe.get("footnotes") or ""
        fns = tr.get("footnotes", [])
        rest, pos = fn_raw, 0
        for i, fn in enumerate(fns):
            j = fn_raw.find(fn, pos)
            if j < 0:
                fail(f"{p}: footnote {i} is not verbatim (in order) from QuranEnc: {fn[:40]!r}")
                break
            if fn_raw[pos:j].strip():
                fail(f"{p}: QuranEnc footnote text skipped before footnote {i}: {fn_raw[pos:j][:40]!r}")
            if not re.match(r"\[\d+\]", fn):
                fail(f"{p}: footnote {i} does not start with its [n] marker")
            pos = j + len(fn)
        if fn_raw[pos:].strip():
            fail(f"{p}: QuranEnc footnote text not shipped: {fn_raw[pos:][:40]!r}")
        if re.findall(r"\[\d+\]", tr["text"]) != [re.match(r"\[\d+\]", fn).group(0) for fn in fns
                                                  if re.match(r"\[\d+\]", fn)]:
            fail(f"{p}: footnote markers in the text do not match the footnotes")
        for fn in fns:
            check_prose(fn, raw, f"{p}.translation.footnotes")
        if "2019" in tr["source_label"] or "kemenag 2019" in tr["source_label"].lower():
            fail(f"{p}: translation source_label must be QuranEnc's own label, not 'Kemenag 2019'")
        if tr["source_label"] != I["quranenc_indonesian_affairs"]["title_id"]:
            fail(f"{p}: source_label differs from the QuranEnc title recorded in sources.json")
        check_prose(tr["text"], raw, f"{p}.translation")
        # 3. recitation
        if not ay.get("recitation"):
            fail(f"{p}: no recitation")
        for rc in ay.get("recitation", []):
            rp = f"{p} {rc['reciter']}"
            segs = rc["segments"]
            if not all(isinstance(x, int) for sg in segs for x in sg) or any(len(sg) != 3 for sg in segs):
                fail(f"{rp}: segments must be [int, int, int]")
                continue
            idx = [sg[0] for sg in segs]
            if idx != sorted(idx):
                fail(f"{rp}: not sorted by word index")
            if sorted(idx) != list(range(1, len(ay["words"]) + 1)):
                fail(f"{rp}: word indices {idx} do not cover 1..{len(ay['words'])} exactly once")
            prev = -1
            for w, st, en in segs:
                if en <= st:
                    fail(f"{rp} word {w}: endMs <= startMs")
                if st < prev:
                    fail(f"{rp} word {w}: overlaps the previous segment")
                if st < 0:
                    fail(f"{rp} word {w}: negative start")
                prev = en
            probe = probes.get(rc["reciter"], {}).get(f"{s:03d}{a:03d}.mp3")
            if not probe:
                fail(f"{rp}: no duration probe in sources.json")
            elif segs and segs[-1][2] > probe["duration_ms"]:
                fail(f"{rp}: last segment ends after the streamed file ({segs[-1][2]} > {probe['duration_ms']} ms)")
            if not rc["url"].startswith("https://everyayah.com/data/" + rc["reciter"] + "/"):
                fail(f"{rp}: unexpected url {rc['url']}")
            if "quran-align (CC BY 4.0)" not in rc["credit"]:
                fail(f"{rp}: credit line lacks the quran-align attribution")
        if ay.get("status") != "draft":
            fail(f"{p}: status must be draft")
        if "tafsir" in ay:
            fail(f"{p}: tafsir must come from the retrieval stage, not this build")

    # facts
    ids = set()
    for f in data.get("facts", []):
        fp = f"fact {f.get('id')}"
        if f["id"] in ids:
            fail(f"{fp}: duplicate id")
        ids.add(f["id"])
        if not re.fullmatch(r"[a-z0-9-]+", f["id"]):
            fail(f"{fp}: bad id")
        if not f.get("sources"):
            fail(f"{fp}: no sources")
        for sr in f.get("sources", []):
            check_source(sr, fp)
        if f.get("status") != "draft":
            fail(f"{fp}: status must be draft")
        if not f.get("locations"):
            fail(f"{fp}: no locations")
        for loc in f.get("locations", []):
            m = re.fullmatch(r"(\d{1,3}):(\d{1,3})", loc)
            if not m or (int(m.group(1)), int(m.group(2))) not in T.verses:
                fail(f"{fp}: location {loc} is not an ayah in Tanzil")
        if f["locations"] != sorted(set(f["locations"]), key=lambda r: tuple(map(int, r.split(":")))):
            fail(f"{fp}: locations not sorted/unique")
        for fld in ("title", "body", "method"):
            check_prose(f[fld], raw, f"{fp}.{fld}")
            prose.append((f"{fp}.{fld}", f[fld]))
        check_fact_counts(f, stems)
        for sr in f.get("sources", []):
            if re.search(r"Darwis[yh]", sr["kitab"]):
                if sr["kitab"] != DARWISY:
                    fail(f"{fp}: Darwisy cited as {sr['kitab']!r}, not {DARWISY!r}")
                if not re.search(r"hlm\. \d+", sr.get("ref", "")) or "belum" in sr.get("ref", ""):
                    fail(f"{fp}: Darwisy ref without a verified page: {sr.get('ref')!r}")
        if len(f["title"]) < 5 or len(f["body"]) < 10 or len(f["method"]) < 5:
            fail(f"{fp}: title/body/method too short for schema.ts")
    for h in data.get("hadith", []):
        if h.get("status") != "draft":
            fail("hadith: status must be draft")
    check_translit_prose(prose, skb_words)

    # 7. pins
    dv = data.get("data_versions", {})
    pins = {"tanzil": I["tanzil_uthmani"]["sha256"], "qac": I["qac_morphology"]["sha256"],
            "quran_align": I["quran_align"]["sha256"], "quranenc": I["quranenc_indonesian_affairs"]["sha256"],
            "tanzil_metadata": I["tanzil_metadata"]["sha256"]}
    for k, sha in pins.items():
        if k not in dv or sha not in dv[k]:
            fail(f"data_versions.{k} does not carry the pinned sha256 {sha[:12]}…")
    for n, m in I["quran_align"]["members"].items():
        if m["sha256"] not in dv.get("quran_align", ""):
            fail(f"data_versions.quran_align lacks {n} sha256")
    authored = PIPELINE / "authored" / "al-fatihah.words.json"
    if sha256_file(authored) not in dv.get("authored_words", ""):
        fail("data_versions.authored_words is stale (authored file changed since the build)")
    if not all(isinstance(v, str) for v in dv.values()):
        fail("data_versions values must be strings")

    if fails:
        print("VALIDATION FAILED:", file=sys.stderr)
        for m in fails:
            print("  - " + m, file=sys.stderr)
        return 1
    n_words = sum(len(a["words"]) for a in ayat)
    n_src = sum(len(w["sources"]) for a in ayat for w in a["words"]) + sum(len(f["sources"]) for f in data["facts"])
    n_seg = sum(len(r["segments"]) for a in ayat for r in a["recitation"])
    print(f"OK: {len(ayat)} ayat, {n_words} words, {len(data['facts'])} facts, {n_seg} timing segments, "
          f"{n_src} source refs; Qur'anic text byte-identical to Tanzil; keys match schema.ts; all draft.")
    return 0


def check_source(sr: dict, where: str) -> None:
    if not isinstance(sr.get("kitab"), str) or len(sr["kitab"]) < 2:
        fail(f"{where}: source without kitab")
    if "url" in sr and not re.match(r"https?://[^\s]+$", sr["url"]):
        fail(f"{where}: source url {sr['url']!r} is not a URL")


if __name__ == "__main__":
    sys.exit(main())
