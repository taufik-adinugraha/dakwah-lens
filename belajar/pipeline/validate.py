#!/usr/bin/env python3
"""Stage 6 (local half): re-check every lesson in belajar/content/ (one SurahContent file per
surah registered in common.SURAHS: al-fatihah, al-ikhlas, al-falaq, an-nas) and the shared
library.json. Exit 1 on any failure.

Checks (per lesson unless said otherwise)
  0. Lessons: content/ holds exactly library.json plus one <slug>.json per registered surah that
     has authored input (al-fatihah always); no unregistered file, no authored surah left unbuilt,
     no lesson without its authored files; slug, surah number, name_id and name_ar (Tanzil
     metadata) match the registry.
  1. Qur'anic text: every ayah `ar` equals its Tanzil line byte-for-byte, except that the
     surah-heading basmalah Tanzil prepends to ayah 1 (every surah but 1 and 9) is sliced off
     (common.lesson_ayah); every word `ar` equals the w-th space token of that text; both are
     byte-exact substrings of the pinned Tanzil file. Every «…» quotation in any prose field is a
     byte-exact substring too, and any other Arabic script in prose may only be single letters
     (letter lists such as roots).
  2. Words: per ayah exactly common.SURAHS' counts (Al-Fatihah 4+4+2+3+4+3+9 = 29, Al-Ikhlas
     4+2+4+5, Al-Falaq 4+4+5+5+5, An-Nas 4+2+2+4+5+3), equal to the QAC 0.4 word counts, locs
     consecutive and matching their ayah.
  3. Recitation segments, per reciter: exactly Husary Mu'allim + Alafasy (L7 default); segments
     equal the pinned quran-align entry (0-based [start, end) -> 1-based word); integers, sorted,
     non-overlapping, endMs > startMs, word indices cover 1..N exactly once, last end not after
     the measured length of the streamed file of that surah and ayah.
  4. Sources: every word and fact has >= 1 SourceRef with a kitab; urls are http(s).
  5. Review: every status is "draft".
  6. Shape: every object's keys match the field names in belajar/src/content/schema.ts
     exactly (no unknown keys, no missing required keys), enums and loc formats hold.
  7. Pins: data_versions repeat the sha256 values pinned in sources.json (QuranEnc: that
     surah's own sura file); the cached Tanzil file still matches its pin.
  8. Translation: `text` is byte-identical to the cached QuranEnc `translation` of that sura and
     ayah (footnote markers kept); `footnotes` are the cached QuranEnc `footnotes` field,
     verbatim, one item per [n], in order, with nothing but whitespace left over; markers in the
     text = footnote markers.
  9. Fact counts, re-derived here from QAC 0.4: for every LEM:/ROOT: query named in a fact's QAC
     source whose ayah set equals the fact's location list, a count that differs from the number
     of ayat must be stated as "N kali dalam M ayat". Every "N kali dalam M ayat" has M = number
     of locations; a title count that differs from it must be restated that way in the body.
     Fact methods (and the library's occurrence methods) that use QAC carry the QAC 0.4 /
     Tanzil 1.0.2 basis note; every surah the note names is a lesson surah whose QAC words are
     re-checked here to be byte-identical to the Tanzil 1.1 tokens, and the QAC header is re-read.
     Hadith: status draft; `ar` is Arabic script only; `id` (Indonesian) carries no Arabic words.
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
 13. Links resolve (across all lessons): every Word.lemma_id is a Lexeme id whose lemma_ar and
     root equal the word's QAC lemma and root, and whose pos agrees with the word's pos (one
     " + "-part of the word's pos equals it, ignoring a verb's aspect and a "(jamak)"/"(mutsanna)"
     the lemma lacks); a word whose QAC stem has no lemma has lemma_id null; every Word.concepts
     id, structure.groups[].concept and Concept.related id is a Concept id; every Concept.examples loc is a word of a lesson in content/, and the
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
 17. Pins: data_versions name the current sha256 of each lesson's authored words, structure and
     concepts map (and facts / hadith when the lesson was built from them), and of the lexicon,
     concepts, terms, basics and parts files. The Konsep terms in Arabic script and the inline
     markup (operator 2026-10-10) have their own validator, validate_terms.py (CI: --no-corpus).
 18. App wiring: src/lib/content.ts loads exactly the lessons in content/, in mushaf order, and
     src/lib/routes.ts SURAH_SLUGS lists the same slugs in the same order.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import xml.etree.ElementTree as ET

from common import (ARABIC_RUN, CONTENT_DIR, CONTENT_TS, PIPELINE, ROUTES_TS, SCHEMA_TS, SURAH_BY_SLUG, SURAHS,
                    authored_file, bw_to_ar, lesson_ayah, load_qac, load_sources, load_tanzil, qac_words,
                    quranenc_sura, require_pinned, root_letters, sha256_file)

# Paths the checks read; test_validate.py points them at temporary copies.
LESSON_DIR = CONTENT_DIR
LIBRARY = CONTENT_DIR / "library.json"
CONTENT_TS_PATH = CONTENT_TS
ROUTES_TS_PATH = ROUTES_TS
AUTHORED = PIPELINE / "authored"
# reciter -> sources.json input holding its duration probes (L7: Alafasy is the default voice)
RECITERS = {"Husary_Muallim_128kbps": "everyayah_husary_muallim", "Alafasy_128kbps": "everyayah_alafasy"}
# Typed (non-Qur'anic) Arabic in the library: letters U+0621–U+063A, U+0641–U+064A; harakat and
# tanwin U+064B–U+0652; spaces. Tatweel (U+0640), alif wasla, superscript alif and Qur'anic marks
# are Uthmani-only and never appear in a tashrif or i'lal form.
AR_LETTERS = set(chr(c) for c in range(0x0621, 0x063B)) | set(chr(c) for c in range(0x0641, 0x064B))
TYPED_AR = AR_LETTERS | set(chr(c) for c in range(0x064B, 0x0653)) | {" "}
QAC_TANZIL_HEADER = "Tanzil Quran Text (Uthmani, version 1.0.2)"
QAC_BASIS = ("QAC 0.4 (disusun di atas teks Tanzil Uthmani 1.0.2; surah 1 identik byte-per-byte "
             "dengan 1.1 yang dipakai)")
# The same note naming other (or more) surahs: "surah 1, 112, 113 dan 114 identik …".
QAC_BASIS_RE = re.compile(r"QAC 0\.4 \(disusun di atas teks Tanzil Uthmani 1\.0\.2; surah (\d+(?:(?:, | dan )\d+)*) "
                          r"identik byte-per-byte dengan 1\.1 yang dipakai\)")
# Surahs whose QAC words main() byte-checked against Tanzil 1.1; None = not known (the early
# check run by build_surah.py), and then the surahs a basis note names are not compared.
CHECKED_SURAHS: set[int] | None = None
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
    if "QAC" in f["method"]:
        check_basis_note(f["method"], fp)


def check_basis_note(method: str, where: str) -> None:
    m = QAC_BASIS_RE.search(method)
    if not m:
        fail(f"{where}: method uses QAC but lacks the basis note '{QAC_BASIS}'")
        return
    named = {int(x) for x in re.findall(r"\d+", m.group(1))}
    if CHECKED_SURAHS is not None and named - CHECKED_SURAHS:
        fail(f"{where}: basis note names surah {sorted(named - CHECKED_SURAHS)}, whose QAC words are not "
             f"byte-checked here (no lesson for it in content/)")


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


def check_library(lib: dict, lessons: list[dict], stems: list, raw: str) -> list[tuple[str, str]]:
    """Checks 13–15 (and the library half of 16/17) over every lesson. Returns the prose items for
    check 10."""
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
        if oc:
            check_basis_note(oc["method"], f"{where}.occurrences")
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
        check_basis_note(r["occurrences"]["method"], f"{where}.occurrences")
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
    for ay in (ay for les in lessons for ay in les.get("ayat", [])):
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


# ---------------------------------------------------------------- inputs (parsed once per process)
_PARSED: dict = {}


def _cached(key: tuple, load):
    """test_validate.py runs main() dozens of times; the pinned inputs are re-hashed every run
    (require_pinned) but parsed once."""
    if key not in _PARSED:
        _PARSED[key] = load()
    return _PARSED[key]


def load_align(src: dict) -> dict[str, dict]:
    """reciter -> {(surah, ayah): quran-align entry}, from the pinned release members."""
    I = src["inputs"]
    qa_dir = (PIPELINE / I["quran_align"]["cache_path"]).parent
    out = {}
    for reciter in RECITERS:
        p = qa_dir / f"{reciter}.json"
        want = I["quran_align"]["members"][f"{reciter}.json"]["sha256"]
        if not p.exists() or sha256_file(p) != want:
            fail(f"quran-align {reciter}.json missing or not matching its pin; run fetch.py")
            out[reciter] = {}
            continue
        out[reciter] = _cached(("align", want), lambda p=p: {(e["surah"], e["ayah"]): e
                                                              for e in json.loads(p.read_text())})
    return out


def lesson_paths() -> dict[str, Path]:
    """Check 0: slug -> lesson file, in mushaf order."""
    found = {f.stem: f for f in sorted(LESSON_DIR.glob("*.json")) if f.name != LIBRARY.name}
    for slug in sorted(set(found) - set(SURAH_BY_SLUG)):
        fail(f"content/{slug}.json is not a surah registered in common.SURAHS (the app would not load it)")
    for spec in SURAHS:
        has_input = authored_file(spec.slug, "words").exists()
        if spec.slug == "al-fatihah" and spec.slug not in found:
            fail(f"missing content/{spec.slug}.json; run build_surah.py {spec.slug}")
        elif has_input and spec.slug not in found:
            fail(f"authored/{spec.slug}.words.json exists but content/{spec.slug}.json does not; "
                 f"run build_surah.py {spec.slug}")
        elif spec.slug in found and not has_input:
            fail(f"content/{spec.slug}.json has no authored/{spec.slug}.words.json to be checked against")
    return {spec.slug: found[spec.slug] for spec in SURAHS if spec.slug in found}


def check_lesson(spec, data: dict, ctx: dict) -> tuple[list[tuple[str, str]], set[str]]:
    """Checks 0–9 and 11 for one lesson. Returns (prose items for check 10, SKB words)."""
    T, raw, I, src, qw = ctx["T"], ctx["raw"], ctx["I"], ctx["src"], ctx["qw"]
    S = spec.surah
    prose: list[tuple[str, str]] = []
    skb_words: set[str] = set()
    lp = f"content/{spec.slug}.json"

    # 0. identity
    for key, want in (("slug", spec.slug), ("surah", S), ("name_id", spec.name_id),
                      ("name_ar", ctx["names_ar"].get(S))):
        if data.get(key) != want:
            fail(f"{lp}: {key} {data.get(key)!r} != {want!r} (common.SURAHS / Tanzil metadata)")

    # 1/2. text and words; QAC words byte-identical to the Tanzil tokens (basis note, check 9)
    ayat = data.get("ayat", [])
    if [a.get("ayah") for a in ayat] != list(range(1, spec.n_ayat + 1)):
        fail(f"{lp}: ayat are not 1..{spec.n_ayat}: {[a.get('ayah') for a in ayat]}")
    counts = [len(a.get("words", [])) for a in ayat]
    if counts != list(spec.words):
        fail(f"{lp}: word counts {counts} (total {sum(counts)}) != {list(spec.words)} ({sum(spec.words)})")
    qac_counts = [len([k for k in qw if k[0] == S and k[1] == a]) for a in range(1, spec.n_ayat + 1)]
    if qac_counts != list(spec.words):
        fail(f"{lp}: QAC 0.4 word counts {qac_counts} != {list(spec.words)}")
    for a in range(1, spec.n_ayat + 1):
        for w, tok in enumerate(lesson_ayah(T, S, a)[0].split(" "), 1):
            if bw_to_ar("".join(g.form for g in qw.get((S, a, w), []))) != tok:
                fail(f"QAC word {S}:{a}:{w} is not byte-identical to the Tanzil 1.1 token")
    qe, qe_path = quranenc_sura(src, S)
    qe_rows = _cached(("quranenc", qe["sha256"]), lambda: {
        int(r["aya"]): r for r in json.loads(qe_path.read_text(encoding="utf-8"))["result"]})
    probes = {r: I[k]["files"] for r, k in RECITERS.items()}
    for ay in ayat:
        s, a = ay["surah"], ay["ayah"]
        p = f"ayah {s}:{a}"
        if s != S:
            fail(f"{p}: in {lp}, which is surah {S}")
        if ay["loc"] != f"{s}:{a}":
            fail(f"{p}: loc {ay['loc']!r}")
        line = lesson_ayah(T, s, a)[0] if (s, a) in T.verses else None
        if ay["ar"] != line:
            fail(f"{p}: ar differs from the Tanzil ayah (Tanzil line, surah-heading basmalah removed)")
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
        # 8. translation
        tr = ay["translation"]
        qe_row = qe_rows.get(a, {})
        if tr["text"] != qe_row.get("translation"):
            fail(f"{p}: translation.text is not byte-identical to the cached QuranEnc text (sura {S})")
        fn_raw = qe_row.get("footnotes") or ""
        fns = tr.get("footnotes", [])
        pos = 0
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
        if tr["source_label"] != qe["title_id"]:
            fail(f"{p}: source_label differs from the QuranEnc title recorded in sources.json")
        if tr.get("version") != qe["version"]:
            fail(f"{p}: translation version {tr.get('version')!r} != QuranEnc {qe['version']!r}")
        check_prose(tr["text"], raw, f"{p}.translation")
        # 3. recitation
        if not ay.get("recitation"):
            fail(f"{p}: no recitation")
        reciters = [rc.get("reciter") for rc in ay.get("recitation", [])]
        if sorted(reciters) != sorted(RECITERS):
            fail(f"{p}: reciters {reciters} != {sorted(RECITERS)} (Alafasy is the default, plan L7)")
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
            qa = ctx["align"].get(rc["reciter"], {}).get((s, a))
            want = [[ws + 1, int(s_ms), int(e_ms)] for ws, _we, s_ms, e_ms in qa["segments"]] if qa else None
            if segs != want:
                fail(f"{rp}: segments differ from the pinned quran-align entry for {s}:{a}")
            probe = probes.get(rc["reciter"], {}).get(f"{s:03d}{a:03d}.mp3")
            if not probe:
                fail(f"{rp}: no duration probe in sources.json")
            elif segs and segs[-1][2] > probe["duration_ms"]:
                fail(f"{rp}: last segment ends after the streamed file ({segs[-1][2]} > {probe['duration_ms']} ms)")
            if rc["url"] != f"https://everyayah.com/data/{rc['reciter']}/{s:03d}{a:03d}.mp3":
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
        check_fact_counts(f, ctx["stems"])
        for sr in f.get("sources", []):
            check_darwisy(sr, fp)
        if len(f["title"]) < 5 or len(f["body"]) < 10 or len(f["method"]) < 5:
            fail(f"{fp}: title/body/method too short for schema.ts")
    for h in data.get("hadith", []):
        hp = f"{lp} hadith {h.get('citation')!r}"
        if h.get("status") != "draft":
            fail(f"{hp}: status must be draft")
        # The matn is Arabic copied from the corpus; Latin letters mean a placeholder or a mix-up.
        if not ARABIC_RUN.search(h.get("ar", "")) or re.search(r"[A-Za-z]", h.get("ar", "")):
            fail(f"{hp}: ar must be Arabic text only")
        if ARABIC_RUN.search(h.get("id", "")) and any(len(t) > 1 for r in ARABIC_RUN.findall(h["id"]) for t in r.split()):
            fail(f"{hp}: id (the Indonesian translation) carries Arabic words")

    # 7. pins (17: authored files of this lesson)
    dv = data.get("data_versions", {})
    pins = {"tanzil": I["tanzil_uthmani"]["sha256"], "qac": I["qac_morphology"]["sha256"],
            "quran_align": I["quran_align"]["sha256"], "quranenc": qe["sha256"],
            "tanzil_metadata": I["tanzil_metadata"]["sha256"]}
    for k, sha in pins.items():
        if k not in dv or sha not in dv[k]:
            fail(f"{lp} data_versions.{k} does not carry the pinned sha256 {sha[:12]}…")
    for n, m in I["quran_align"]["members"].items():
        if m["sha256"] not in dv.get("quran_align", ""):
            fail(f"{lp} data_versions.quran_align lacks {n} sha256")
    for key, kind in (("authored_words", "words"), ("authored_structure", "structure"),
                      ("authored_concepts_map", "concepts-map"), ("authored_facts", "facts.generated"),
                      ("authored_hadith", "hadith")):
        f = authored_file(spec.slug, kind)
        if key in ("authored_facts", "authored_hadith") and not f.exists() and key not in dv:
            continue  # optional input, not used
        if key == "authored_facts" and spec.slug == "al-fatihah":
            continue  # Al-Fatihah's facts are recomputed by facts.py
        if not f.exists():
            fail(f"{lp} data_versions.{key} names authored/{f.name}, which no longer exists")
        elif sha256_file(f) not in dv.get(key, ""):
            fail(f"{lp} data_versions.{key} is stale or missing (authored/{f.name} changed since the build)")
    if not all(isinstance(v, str) for v in dv.values()):
        fail(f"{lp}: data_versions values must be strings")
    return prose, skb_words


def check_app_wiring(slugs: list[str]) -> None:
    """Check 18: the app loads exactly the lessons in content/, in mushaf order."""
    if not CONTENT_TS_PATH.exists() or not ROUTES_TS_PATH.exists():
        fail(f"cannot read {CONTENT_TS_PATH.name} / {ROUTES_TS_PATH.name} for the wiring check")
        return
    ts = CONTENT_TS_PATH.read_text(encoding="utf-8")
    imported = dict((name, slug) for name, slug in
                    re.findall(r'^import\s+(\w+)\s+from\s+"\.\./\.\./content/([a-z0-9-]+)\.json";', ts, re.M))
    m = re.search(r"export const SURAHS: Surah\[\] = \[(.*?)\];", ts, re.S)
    loaded = re.findall(r'load\(\s*(\w+)\s*,\s*"([a-z0-9-]+)"\s*\)', m.group(1)) if m else []
    if [slug for _, slug in loaded] != slugs:
        fail(f"src/lib/content.ts SURAHS loads {[slug for _, slug in loaded]}, content/ has {slugs} (mushaf order)")
    for name, slug in loaded:
        if imported.get(name) != slug:
            fail(f"src/lib/content.ts loads {name} as {slug!r} but imports it from {imported.get(name)!r}.json")
    m = re.search(r"export const SURAH_SLUGS = \[(.*?)\] as const;", ROUTES_TS_PATH.read_text(encoding="utf-8"), re.S)
    route_slugs = re.findall(r'"([a-z0-9-]+)"', m.group(1)) if m else []
    if route_slugs != slugs:
        fail(f"src/lib/routes.ts SURAH_SLUGS {route_slugs} != the lessons in content/ {slugs} (mushaf order)")


def main() -> int:
    global CHECKED_SURAHS
    paths = lesson_paths()
    if not paths:
        print(f"no lesson in {LESSON_DIR}; run build_surah.py", file=sys.stderr)
        for m in fails:
            print("  - " + m, file=sys.stderr)
        return 1
    if not LIBRARY.exists():
        print(f"missing {LIBRARY}; run build_library.py", file=sys.stderr)
        return 1
    src = load_sources()
    I = src["inputs"]
    tanzil_path = require_pinned(src, "tanzil_uthmani")
    T = _cached(("tanzil", I["tanzil_uthmani"]["sha256"]), lambda: load_tanzil(tanzil_path))
    raw = T.raw
    qac_path = require_pinned(src, "qac_morphology")
    segs, qac_header = _cached(("qac", I["qac_morphology"]["sha256"]), lambda: load_qac(qac_path))
    stems = [g for g in segs if "STEM" in g.flags]
    if QAC_TANZIL_HEADER not in qac_header:
        fail(f"QAC header does not name '{QAC_TANZIL_HEADER}' (the basis note in fact methods)")
    qw = _cached(("qac_words", I["qac_morphology"]["sha256"]), lambda: qac_words(segs))
    meta_path = require_pinned(src, "tanzil_metadata")
    names_ar = {int(e.get("index")): e.get("name") for e in ET.parse(meta_path).getroot().iter("sura")}
    lessons = {slug: json.loads(p.read_text(encoding="utf-8")) for slug, p in paths.items()}
    lib = json.loads(LIBRARY.read_text(encoding="utf-8"))
    CHECKED_SURAHS = {SURAH_BY_SLUG[slug].surah for slug in lessons}
    ctx = {"T": T, "raw": raw, "I": I, "src": src, "qw": qw, "stems": stems, "names_ar": names_ar,
           "align": load_align(src)}

    # 6. shape against schema.ts (keys), 12. zod constraints
    if not SCHEMA_TS.exists():
        fail(f"schema not found at {SCHEMA_TS}")
    else:
        ts = SCHEMA_TS.read_text(encoding="utf-8")
        schemas, enums = parse_schema(ts)
        defs = zod_defs(ts)
        for name, label, obj in [("SurahContent", f"SurahContent[{slug}]", d) for slug, d in lessons.items()] \
                + [("Library", "Library", lib)]:
            if name not in schemas or name not in defs:
                fail(f"schema.ts has no {name} object")
                continue
            check_shape(obj, schemas[name], schemas, enums, label)
            zcheck(obj, defs[name], defs, label)

    # 0–9, 11. each lesson
    prose: list[tuple[str, str]] = []
    skb_words: set[str] = set()
    for slug, data in lessons.items():
        p, w = check_lesson(SURAH_BY_SLUG[slug], data, ctx)
        prose += p
        skb_words |= w

    # 13–16. library records and every lesson's links into them; prose checked with the lessons'
    prose += check_library(lib, list(lessons.values()), stems, raw)
    skb_words.update(x["translit"] for x in lib.get("lexicon", []))
    check_translit_prose(prose, skb_words)

    # 17. library pins
    ldv = lib.get("data_versions", {})
    for key, f in (("authored_lexicon", "library.lexicon.json"), ("authored_concepts", "library.concepts.json"),
                   ("authored_terms", "library.terms.json"), ("authored_basics", "library.basics.json"),
                   ("authored_parts", "library.parts.json")):
        if not (AUTHORED / f).exists() and key not in ldv:
            continue  # optional input (basics, parts), not used
        if not (AUTHORED / f).exists() or sha256_file(AUTHORED / f) not in ldv.get(key, ""):
            fail(f"library.json data_versions.{key} is stale or missing (authored/{f} changed since the build)")
    for k, sha in (("qac", I["qac_morphology"]["sha256"]), ("tanzil", I["tanzil_uthmani"]["sha256"])):
        if sha not in ldv.get(k, ""):
            fail(f"library.json data_versions.{k} does not carry the pinned sha256 {sha[:12]}…")

    # 18. app wiring
    check_app_wiring(list(lessons))

    if fails:
        print("VALIDATION FAILED:", file=sys.stderr)
        for m in fails:
            print("  - " + m, file=sys.stderr)
        return 1
    n_links = 0
    for slug, data in lessons.items():
        ayat = data["ayat"]
        n_words = sum(len(a["words"]) for a in ayat)
        n_links += n_words
        n_src = sum(len(w["sources"]) for a in ayat for w in a["words"]) + sum(len(f["sources"]) for f in data["facts"])
        n_seg = sum(len(r["segments"]) for a in ayat for r in a["recitation"])
        n_groups = sum(len(a["structure"]["groups"]) for a in ayat)
        print(f"OK: {slug}: {len(ayat)} ayat, {n_words} words, {len(data['facts'])} facts, "
              f"{len(data['hadith'])} hadith, {n_seg} timing segments, {n_src} source refs, "
              f"{len(ayat)} structures ({n_groups} groups); Qur'anic text byte-identical to Tanzil; all draft.")
    n_lib_src = sum(len(x["sources"]) for k in ("concepts", "lexicon", "roots") for x in lib[k])
    print(f"OK: library {len(lib['concepts'])} concepts, {len(lib['lexicon'])} lexemes, {len(lib['roots'])} roots, "
          f"{n_lib_src} source refs; {n_links} lemma_id/concepts/role links across {len(lessons)} lessons resolve; "
          f"QAC-derived fields re-derived; keys and zod constraints match schema.ts; app wiring matches; all draft.")
    return 0


def check_source(sr: dict, where: str) -> None:
    if not isinstance(sr.get("kitab"), str) or len(sr["kitab"]) < 2:
        fail(f"{where}: source without kitab")
    if "url" in sr and not re.match(r"https?://[^\s]+$", sr["url"]):
        fail(f"{where}: source url {sr['url']!r} is not a URL")


if __name__ == "__main__":
    sys.exit(main())
