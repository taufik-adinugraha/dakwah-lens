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

Shared library (belajar/content/library.json) and the lesson's links into it
 12. Schema constraints: both files are read against a mirror of the zod declarations in
     schema.ts (types, required/optional/nullable, min/max/length, regex, int/positive, url,
     enums, no unknown keys), so a value the app's zod parse would reject fails here first.
 13. Links resolve: every Word.lemma_id is a Lexeme id whose lemma_ar and root equal the word's
     QAC lemma and root, and whose pos agrees with the word's pos (one " + "-part of the word's
     pos equals it, ignoring a verb's aspect and a "(jamak)"/"(mutsanna)" the lemma lacks); every Word.concepts id, structure.groups[].concept and Concept.related
     id is a Concept id; every Concept.examples loc is a word of a lesson in content/, and the
     word lists that concept (and vice versa); every Root.lemmas id is a Lexeme with the same root
     letters, and every rooted Lexeme is listed by exactly one Root. Ids are unique per kind.
 14. Structure: every ayah has one; groups name >= 2 ascending word indices inside the ayah.
     Every word has a role.
 15. Library records: >= 1 source each (kitab named, url well-formed; Darwisy as in 11) and status
     "draft"; Lexeme lemma_ar, root and occurrence counts and Root letters and counts are re-derived
     from QAC 0.4; tashrif forms, i'lal before/after and the Arabic in `bab` are imla'i letters,
     harakat, tanwin and spaces only (no tatweel, alif wasla, superscript alif or Qur'anic marks);
     an i'lal's before and after differ; Concept.related names no id twice.
 16. Prose of the library, the structures and the roles goes through 1 (quotes byte-exact, no
     unquoted Arabic words) and, together with the lesson prose, through 10.
 17. Pins: data_versions name the current sha256 of the authored structure, concepts map,
     lexicon and concepts files.
"""
from __future__ import annotations

import json
import re
import sys

from common import (ARABIC_RUN, CONTENT_DIR, PIPELINE, SCHEMA_TS, bw_to_ar, load_qac, load_sources, load_tanzil,
                    qac_words, require_pinned, root_letters, sha256_file)

OUT = CONTENT_DIR / "al-fatihah.json"
LIBRARY = CONTENT_DIR / "library.json"
AUTHORED = PIPELINE / "authored"
# Typed (non-Qur'anic) Arabic in the library: letters U+0621–U+063A, U+0641–U+064A; harakat and
# tanwin U+064B–U+0652; spaces. Tatweel (U+0640), alif wasla, superscript alif and Qur'anic marks
# are Uthmani-only and never appear in a tashrif or i'lal form.
AR_LETTERS = set(chr(c) for c in range(0x0621, 0x063B)) | set(chr(c) for c in range(0x0641, 0x064B))
TYPED_AR = AR_LETTERS | set(chr(c) for c in range(0x064B, 0x0653)) | {" "}
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


# ---------------------------------------------------------------- schema.ts constraints (zod mirror)
class _ZodReader:
    """Reads the zod subset schema.ts uses into nested dicts {"t": base, ...modifiers}. Anything
    outside the subset raises, so a new zod feature cannot be silently ignored."""
    BASES = {"string", "number", "boolean", "object", "array", "enum", "tuple", "record"}
    FLAGS = {"url", "int", "positive", "nonnegative", "optional", "nullable"}

    def __init__(self, s: str, i: int):
        self.s, self.i = s, i

    def peek(self) -> str:
        while self.s[self.i].isspace():
            self.i += 1
        return self.s[self.i]

    def eat(self, tok: str) -> None:
        self.peek()
        if not self.s.startswith(tok, self.i):
            raise ValueError(f"expected {tok!r} at {self.s[self.i:self.i + 40]!r}")
        self.i += len(tok)

    def match(self, pattern: str) -> str:
        self.peek()
        m = re.compile(pattern).match(self.s, self.i)
        if not m:
            raise ValueError(f"expected /{pattern}/ at {self.s[self.i:self.i + 40]!r}")
        self.i = m.end()
        return m.group(0)

    def regex(self) -> str:
        self.eat("/")
        j, in_class = self.i, False
        while self.s[j] != "/" or in_class:
            if self.s[j] == "\\":
                j += 1
            elif self.s[j] in "[]":
                in_class = self.s[j] == "["
            j += 1
        pat, self.i = self.s[self.i:j], j + 1
        if re.match(r"[a-z]", self.s[self.i]):
            raise ValueError(f"regex flags are not supported: /{pat}/")
        return pat

    def skip_arg(self) -> None:
        depth = 0
        while depth or self.s[self.i] != ")":
            c = self.s[self.i]
            if c == '"':
                self.match(r'"(?:[^"\\]|\\.)*"')
                continue
            depth += (c in "([{") - (c in ")]}")
            self.i += 1

    def items(self, close: str, item) -> list:
        out = []
        while self.peek() != close:
            out.append(item())
            if self.peek() == ",":
                self.i += 1
        self.eat(close)
        return out

    def expr(self) -> dict:
        name = self.match(r"[A-Za-z_]\w*")
        if name == "z":  # `z.string()`, or `z` and `.array(` on separate lines
            self.eat(".")
            base = self.match(r"[A-Za-z]\w*")
            if base not in self.BASES:
                raise ValueError(f"z.{base}() is not supported")
            self.eat("(")
            node = {"t": base}
            if base == "object":
                self.eat("{")
                node["fields"] = dict(self.items("}", self.field))
            elif base == "array":
                node["of"] = self.expr()
            elif base == "enum":
                self.eat("[")
                node["values"] = [v[1:-1] for v in self.items("]", lambda: self.match(r'"[^"]*"'))]
            elif base == "tuple":
                self.eat("[")
                node["items"] = self.items("]", self.expr)
            elif base == "record":
                node["key"] = self.expr()
                self.eat(",")
                node["value"] = self.expr()
            if self.peek() == ",":  # trailing comma (prettier)
                self.i += 1
            self.eat(")")
        else:
            node = {"t": "ref", "name": name}
        while self.peek() == ".":
            self.i += 1
            m = self.match(r"[A-Za-z]\w*")
            self.eat("(")
            if m in ("min", "max", "length"):
                node[m] = int(self.match(r"\d+"))
            elif m == "regex":
                node["regex"] = self.regex()
            elif m in self.FLAGS:
                node[m] = True
            elif m == "default":
                node["optional"] = True
                self.skip_arg()
            else:
                raise ValueError(f".{m}() is not supported")
            self.eat(")")
        return node

    def field(self) -> tuple[str, dict]:
        key = self.match(r"[A-Za-z_]\w*")
        self.eat(":")
        return key, self.expr()


def zod_defs(ts: str) -> dict:
    """{ConstName: node} for every `export const X = <zod expr>` in schema.ts."""
    ts = re.sub(r"/\*.*?\*/", "", ts, flags=re.S)
    ts = re.sub(r"//[^\n]*", "", ts)
    defs = {}
    for m in re.finditer(r"export const (\w+) = ", ts):
        try:
            defs[m.group(1)] = _ZodReader(ts, m.end()).expr()
        except (ValueError, IndexError) as e:
            fail(f"schema.ts {m.group(1)}: validate.py cannot read it ({e}); extend _ZodReader")
    return defs


def _js_regex(pat: str) -> str:
    """JS `$` (no m flag) is end of input; Python's also matches before a final newline."""
    return pat[:-1] + r"\Z" if pat.endswith("$") and not pat.endswith("\\$") else pat


def zcheck(v, node: dict, defs: dict, path: str) -> None:
    """Fail where zod would reject `v` (string lengths in UTF-16 code units, as in JS)."""
    if v is None:
        if not node.get("nullable"):
            fail(f"{path}: null, but schema.ts does not allow null here")
        return
    t = node["t"]
    if t == "ref":
        if node["name"] not in defs:
            fail(f"{path}: schema.ts has no {node['name']}")
        else:
            zcheck(v, defs[node["name"]], defs, path)
        return
    ok_type = {"string": isinstance(v, str), "boolean": isinstance(v, bool),
               "number": isinstance(v, (int, float)) and not isinstance(v, bool),
               "object": isinstance(v, dict), "record": isinstance(v, dict),
               "array": isinstance(v, list), "tuple": isinstance(v, list), "enum": True}[t]
    if not ok_type:
        fail(f"{path}: expected {t}, got {type(v).__name__}")
        return
    size = {"string": lambda: len(v.encode("utf-16-le")) // 2, "array": lambda: len(v),
            "number": lambda: v}.get(t)
    if size:
        n = size()
        if "min" in node and n < node["min"]:
            fail(f"{path}: {t} {'value' if t == 'number' else 'length'} {n} < schema.ts min({node['min']})")
        if "max" in node and n > node["max"]:
            fail(f"{path}: {t} {'value' if t == 'number' else 'length'} {n} > schema.ts max({node['max']})")
        if "length" in node and n != node["length"]:
            fail(f"{path}: length {n} != schema.ts length({node['length']})")
    if t == "string":
        if "regex" in node and not re.search(_js_regex(node["regex"]), v):
            fail(f"{path}: {v!r} does not match schema.ts /{node['regex']}/")
        if node.get("url") and not re.match(r"[A-Za-z][A-Za-z0-9+.-]*:\S+\Z", v):
            fail(f"{path}: {v!r} is not a url")
    elif t == "number":
        if node.get("int") and v != int(v):
            fail(f"{path}: {v} is not an integer")
        if node.get("positive") and not v > 0:
            fail(f"{path}: {v} is not positive")
        if node.get("nonnegative") and not v >= 0:
            fail(f"{path}: {v} is negative")
    elif t == "enum":
        if v not in node["values"]:
            fail(f"{path}: {v!r} not in schema.ts enum {node['values']}")
    elif t == "array":
        for i, it in enumerate(v):
            zcheck(it, node["of"], defs, f"{path}[{i}]")
    elif t == "tuple":
        if len(v) != len(node["items"]):
            fail(f"{path}: tuple of {len(v)} items, schema.ts has {len(node['items'])}")
        for i, (it, sub) in enumerate(zip(v, node["items"])):
            zcheck(it, sub, defs, f"{path}[{i}]")
    elif t == "record":
        for k, it in v.items():
            zcheck(k, node["key"], defs, f"{path} key {k!r}")
            zcheck(it, node["value"], defs, f"{path}.{k}")
    elif t == "object":
        fields = node["fields"]
        for k in sorted(set(v) - set(fields)):
            fail(f"{path}: key {k!r} is not in schema.ts")
        for k, sub in fields.items():
            if k in v:
                zcheck(v[k], sub, defs, f"{path}.{k}")
            elif not sub.get("optional"):
                fail(f"{path}: required key {k!r} missing")


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
        check_darwisy(sr, wp)
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


def check_darwisy(sr: dict, where: str) -> None:
    if re.search(r"Darwis[yh]", sr.get("kitab", "")):
        if sr["kitab"] != DARWISY:
            fail(f"{where}: Darwisy cited as {sr['kitab']!r}, not {DARWISY!r}")
        if not re.search(r"hlm\. \d+", sr.get("ref", "")) or re.search(r"\bbelum\b", sr.get("ref", "")):
            fail(f"{where}: Darwisy ref without a verified page: {sr.get('ref')!r}")


def check_typed_arabic(s, where: str) -> None:
    """A tashrif/i'lal form: imla'i letters, harakat, tanwin and spaces only, with a letter in it.
    A row that gives two attested forms (two mashdars) separates them with the Arabic comma;
    each side must then be a complete form by itself."""
    if not isinstance(s, str):
        fail(f"{where}: {s!r} is not a string")
        return
    for part in s.split("\u060C"):
        if not set(part) & AR_LETTERS:
            fail(f"{where}: {s!r} has an empty or letterless form")
            continue
        bad = sorted(set(part) - TYPED_AR)
        if bad:
            fail(f"{where}: {s!r} has characters outside Arabic letters/harakat/tanwin/space: "
                 + ", ".join(f"U+{ord(c):04X}" for c in bad))


def pos_agrees(lexeme_pos: str, word_pos: str) -> bool:
    """A lexeme's pos is the class of the lemma's segment, so it must equal one " + "-part of a linked
    word's pos; a verb lexeme says "fi'il" without the word's aspect, and a lexeme drops "(jamak)" /
    "(mutsanna)" when not every QAC occurrence of the lemma has that number (the word may keep it)."""
    for part in word_pos.split(" + "):
        if part == lexeme_pos or (lexeme_pos == "fi'il" and part.startswith("fi'il ")):
            return True
        if any(part == f"{lexeme_pos} {n}" for n in ("(jamak)", "(mutsanna)")):
            return True
    return False


def check_library(data: dict, lib: dict, lessons: list[dict], stems: list, raw: str) -> list[tuple[str, str]]:
    """Checks 13–15 (and the library half of 16/17). Returns the prose items for check 10."""
    prose: list[tuple[str, str]] = []
    kinds = {"concepts": lib.get("concepts", []), "lexicon": lib.get("lexicon", []), "roots": lib.get("roots", [])}
    ids = {}
    for kind, recs in kinds.items():
        seq = [x.get("id") for x in recs]
        ids[kind] = set(seq)
        for dup in sorted({i for i in seq if seq.count(i) > 1}):
            fail(f"library.{kind}: id {dup!r} used twice")
        for x in recs:
            where = f"library.{kind}[{x.get('id')}]"
            if x.get("status") != "draft":
                fail(f"{where}: status {x.get('status')!r} (must be draft)")
            if not x.get("sources"):
                fail(f"{where}: no sources")
            for i, sr in enumerate(x.get("sources") or []):
                check_source(sr, f"{where}.sources[{i}]")
                check_darwisy(sr, f"{where}.sources[{i}]")
    lex = {x["id"]: x for x in kinds["lexicon"]}
    con = {x["id"]: x for x in kinds["concepts"]}

    # QAC 0.4 re-derivation: lemma_ar, root letters, counts
    by_lem, by_root = {}, {}
    for g in stems:
        # QAC marks homograph lemmas with a digit (maE2); those have no Arabic spelling of their
        # own, so no lemma_ar can come from them. The Buckwalter table is one-to-one otherwise.
        if "LEM" in g.feat and not re.search(r"\d", g.feat["LEM"]):
            by_lem.setdefault(bw_to_ar(g.feat["LEM"]), []).append(g)
        if "ROOT" in g.feat:
            by_root.setdefault(tuple(root_letters(g.feat["ROOT"])), []).append(g)
    for x in kinds["lexicon"]:
        where = f"library.lexicon[{x['id']}]"
        hits = by_lem.get(x.get("lemma_ar"))
        if not hits:
            fail(f"{where}: lemma_ar {x.get('lemma_ar')!r} is not byte-identical to any QAC 0.4 lemma")
            continue
        roots = {tuple(root_letters(g.feat["ROOT"])) if "ROOT" in g.feat else None for g in hits}
        if roots != {tuple(x["root"]) if x.get("root") else None}:
            fail(f"{where}: root {x.get('root')} != QAC 0.4 root(s) of its lemma {sorted(map(str, roots))}")
        oc = x.get("occurrences")
        if oc and (oc["count"], oc["ayat"]) != (len(hits), len({(g.s, g.a) for g in hits})):
            fail(f"{where}: occurrences {oc['count']}/{oc['ayat']} != QAC 0.4 {len(hits)} in "
                 f"{len({(g.s, g.a) for g in hits})} ayat")
        t = x.get("tashrif")
        if t:
            for i, f in enumerate(t["forms"]):
                check_typed_arabic(f["ar"], f"{where}.tashrif.forms[{i}].ar")
            for run in ARABIC_RUN.findall(t["bab"]):
                check_typed_arabic(run, f"{where}.tashrif.bab")
            prose.append((f"{where}.tashrif.bab", ARABIC_RUN.sub(" ", t["bab"])))
        for i, il in enumerate(x.get("ilal", [])):
            check_typed_arabic(il["from"], f"{where}.ilal[{i}].from")
            check_typed_arabic(il["to"], f"{where}.ilal[{i}].to")
            if il["from"] == il["to"]:
                fail(f"{where}.ilal[{i}]: from and to are the same form {il['from']!r}")
            prose.append((f"{where}.ilal[{i}].rule", il["rule"]))
        prose.append((f"{where}.meaning", x["meaning"]))
    listed: dict[str, list[str]] = {}
    for r in kinds["roots"]:
        where = f"library.roots[{r['id']}]"
        hits = by_root.get(tuple(r["letters"]))
        if not hits:
            fail(f"{where}: letters {r['letters']} are not a QAC 0.4 root")
        elif r["occurrences"]["count"] != len(hits):
            fail(f"{where}: occurrences.count {r['occurrences']['count']} != QAC 0.4 {len(hits)}")
        for lid in r["lemmas"]:
            listed.setdefault(lid, []).append(r["id"])
            if lid not in lex:
                fail(f"{where}: lemma {lid!r} is not a lexicon id")
            elif lex[lid].get("root") != r["letters"]:
                fail(f"{where}: lemma {lid!r} has root {lex[lid].get('root')}, not {r['letters']}")
        prose.append((f"{where}.meaning", r["meaning"]))
    for x in kinds["lexicon"]:
        if x.get("root") and len(listed.get(x["id"], [])) != 1:
            fail(f"library.lexicon[{x['id']}]: listed by {len(listed.get(x['id'], []))} roots (must be exactly 1)")

    # lesson words, as the app joins them
    words = {w["loc"]: w for les in lessons for ay in les.get("ayat", []) for w in ay.get("words", [])}
    for c in kinds["concepts"]:
        where = f"library.concepts[{c['id']}]"
        rels = c.get("related", [])
        if len(set(rels)) != len(rels):
            fail(f"{where}: related repeats an id {rels}")
        for rel in rels:
            if rel not in con or rel == c["id"]:
                fail(f"{where}: related {rel!r} is not another concept id")
        locs = [e["loc"] for e in c.get("examples", [])]
        if len(set(locs)) != len(locs):
            fail(f"{where}: an example loc is repeated {locs}")
        for loc in locs:
            if loc not in words:
                fail(f"{where}: example {loc} is not a word of any lesson in content/")
            elif c["id"] not in (words[loc].get("concepts") or []):
                fail(f"{where}: example {loc}, but word {loc} does not list this concept")
        for i, t in enumerate([c["title"], c["summary"], *c["explanation"], c.get("bridge") or "",
                               *[e["note"] for e in c.get("examples", [])]]):
            if t:
                prose.append((f"{where}.text[{i}]", t))
    for ay in data.get("ayat", []):
        n = len(ay.get("words", []))
        st = ay.get("structure")
        if not st:
            fail(f"ayah {ay.get('loc')}: no structure")
        else:
            where = f"ayah {ay['loc']}.structure"
            if st.get("status") != "draft":
                fail(f"{where}: status {st.get('status')!r} (must be draft)")
            for i, sr in enumerate(st.get("sources", [])):
                check_source(sr, f"{where}.sources[{i}]")
                check_darwisy(sr, f"{where}.sources[{i}]")
            for i, g in enumerate(st.get("groups", [])):
                idx = g.get("words", [])
                if idx != sorted(set(idx)) or not all(isinstance(k, int) and 1 <= k <= n for k in idx):
                    fail(f"{where}.groups[{i}]: words {idx} must be ascending, unique indices within 1..{n}")
                if "concept" in g and g["concept"] not in con:
                    fail(f"{where}.groups[{i}]: concept {g['concept']!r} is not a concept id")
                prose.append((f"{where}.groups[{i}].label", g.get("label", "")))
            prose += [(f"{where}.type", st.get("type", "")), (f"{where}.summary", st.get("summary", ""))]
        for w in ay.get("words", []):
            wp = f"word {w['loc']}"
            lid = w.get("lemma_id")
            if lid is None:
                if w.get("lemma") is not None:
                    fail(f"{wp}: has a QAC lemma but no lemma_id")
            elif lid not in lex:
                fail(f"{wp}: lemma_id {lid!r} is not a lexicon id")
            elif (lex[lid]["lemma_ar"], lex[lid].get("root")) != (w.get("lemma"), w.get("root")):
                fail(f"{wp}: lemma_id {lid!r} is {lex[lid]['lemma_ar']} {lex[lid].get('root')}, "
                     f"but the word's QAC lemma/root is {w.get('lemma')} {w.get('root')}")
            if lid in lex and not pos_agrees(lex[lid].get("pos", ""), w.get("pos", "")):
                fail(f"{wp}: pos {w.get('pos')!r} does not agree with lexeme {lid!r} pos {lex[lid].get('pos')!r}")
            cs = w.get("concepts") or []
            if len(set(cs)) != len(cs):
                fail(f"{wp}: concepts repeat an id {cs}")
            for cid in cs:
                if cid not in con:
                    fail(f"{wp}: concept {cid!r} is not a concept id")
                elif w["loc"] not in {e["loc"] for e in con[cid].get("examples", [])}:
                    fail(f"{wp}: lists concept {cid!r}, which does not give {w['loc']} as an example")
            if not w.get("role"):
                fail(f"{wp}: no role")
            else:
                prose.append((f"{wp}.role", w["role"]))
    for path, text in prose:  # (bab arrives with its typed wazan Arabic masked; checked above)
        check_prose(text, raw, path)
    return prose


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
    if not LIBRARY.exists():
        print(f"missing {LIBRARY}; run build_library.py", file=sys.stderr)
        return 1
    lib = json.loads(LIBRARY.read_text(encoding="utf-8"))

    # 6. shape against schema.ts (keys), 12. zod constraints
    if not SCHEMA_TS.exists():
        fail(f"schema not found at {SCHEMA_TS}")
    else:
        ts = SCHEMA_TS.read_text(encoding="utf-8")
        schemas, enums = parse_schema(ts)
        defs = zod_defs(ts)
        for name, obj in (("SurahContent", data), ("Library", lib)):
            if name not in schemas or name not in defs:
                fail(f"schema.ts has no {name} object")
                continue
            check_shape(obj, schemas[name], schemas, enums, name)
            zcheck(obj, defs[name], defs, name)

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
            check_darwisy(sr, fp)
        if len(f["title"]) < 5 or len(f["body"]) < 10 or len(f["method"]) < 5:
            fail(f"{fp}: title/body/method too short for schema.ts")
    for h in data.get("hadith", []):
        if h.get("status") != "draft":
            fail("hadith: status must be draft")

    # 13–16. library records and the lesson's links into them; prose checked with the lesson's
    lessons = [data] + [json.loads(f.read_text(encoding="utf-8")) for f in sorted(OUT.parent.glob("*.json"))
                        if f.name not in (OUT.name, LIBRARY.name)]
    prose += check_library(data, lib, lessons, stems, raw)
    skb_words.update(x["translit"] for x in lib.get("lexicon", []))
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
    for key, f, owner, versions in (
            ("authored_structure", "al-fatihah.structure.json", "al-fatihah.json", dv),
            ("authored_concepts_map", "al-fatihah.concepts-map.json", "al-fatihah.json", dv),
            ("authored_lexicon", "library.lexicon.json", "library.json", lib.get("data_versions", {})),
            ("authored_concepts", "library.concepts.json", "library.json", lib.get("data_versions", {}))):
        if sha256_file(AUTHORED / f) not in versions.get(key, ""):
            fail(f"{owner} data_versions.{key} is stale or missing (authored/{f} changed since the build)")
    ldv = lib.get("data_versions", {})
    for k, sha in (("qac", I["qac_morphology"]["sha256"]), ("tanzil", I["tanzil_uthmani"]["sha256"])):
        if sha not in ldv.get(k, ""):
            fail(f"library.json data_versions.{k} does not carry the pinned sha256 {sha[:12]}…")
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
    n_lib_src = sum(len(x["sources"]) for k in ("concepts", "lexicon", "roots") for x in lib[k])
    n_groups = sum(len(a["structure"]["groups"]) for a in ayat)
    print(f"OK: {len(ayat)} ayat, {n_words} words, {len(data['facts'])} facts, {n_seg} timing segments, "
          f"{n_src} source refs; Qur'anic text byte-identical to Tanzil; keys match schema.ts; all draft.")
    print(f"OK: library {len(lib['concepts'])} concepts, {len(lib['lexicon'])} lexemes, {len(lib['roots'])} roots, "
          f"{n_lib_src} source refs; {n_words} lemma_id/concepts/role links and {len(ayat)} structures "
          f"({n_groups} groups) resolve; QAC-derived fields re-derived; zod constraints hold; all draft.")
    return 0


def check_source(sr: dict, where: str) -> None:
    if not isinstance(sr.get("kitab"), str) or len(sr["kitab"]) < 2:
        fail(f"{where}: source without kitab")
    if "url" in sr and not re.match(r"https?://[^\s]+$", sr["url"]):
        fail(f"{where}: source url {sr['url']!r} is not a URL")


if __name__ == "__main__":
    sys.exit(main())
