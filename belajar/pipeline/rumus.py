"""The cheat sheet, "Rumus singkat" (content/rumus.json): one short formula per step of the basic
curriculum, each beside the kitab sentence it restates (stdlib only).

Operator, 2026-10-13: "we can make some 'cheat sheet' to explain the rules, for example: harf jar +
ism = kasrah (give examples), isim followed by another ism is mudhof ilaih etc. this cheat sheet is
explained also along with formal explanation" — and "of course we need to refer to valid kitab, my
example is just example"; 2026-10-14: "release cheat sheet". The draft table and what the matn states
of each row: docs/belajar-research/rumus-singkat.md. The standing rules: every formula cites a valid
kitab; nothing about grammar from memory; labelled AI-assisted, never promised a human review.

authored/rumus.json is ONE file, one entry per curriculum STEP id (authored/curriculum.json):

    {"rumus": "marked text", "awas": "marked text" (optional),
     "sumber": [{"page": "11371/6", "match": ["folded sentence", …]}, …]}

- `rumus`, `awas`: Indonesian, in the Konsep records' markup — [[isim]], [[huruf jar]],
  [[isimnya|isim]] — checked like the records' prose (terms.check_markup: a term form written
  without markup stops the build) and held to the term rule of the lessons (curriculum.too_early:
  a term of a LATER lesson stops it; a pointer to a later step is written {{di:<step id>}}, which
  becomes "di Al-Fatihah ayat 4" from the curriculum, never a number typed here). No Qur'anic word:
  Arabic reaches a reader only as a dictionary term or as the quoted kitab.
- `sumber`: a page of a kitab pinned in sources.json (shamela_istilah.pages) and, per sentence, a
  `match`: the CONSONANT SKELETON of the kitab's sentence (alif forms unified, no harakat), as a
  folded anchor. The shown quote is never typed: the build finds the anchor as a run of whole
  words in the pinned page text (the matn, not the editor's footnotes) and takes the page's own
  bytes — harakat and all, the editor's footnote marker dropped, spaces collapsed and none left before a punctuation mark. An anchor that is
  not found, or found twice, stops the build. A `quote` in the authored file is refused.
- the kitab's name, the print page ("hlm."), the section and the address are the PIN's (sources.json
  books / pages): nothing typed twice.
- the example of a step is derived: the first word of its lesson that the step occurs on (the
  curriculum's own `lines[].words`, else curriculum.occurs), by loc; the app draws that word from
  the lesson file.

content/rumus.json is built from the authored file, the built curriculum, the lessons and the pins.
Without pipeline/cache (CI) the quotes are taken from the file itself — each must still fold to its
authored anchor — and everything else is rebuilt and compared.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import curriculum as CUR
import terms as TM
from common import AUTHORED_DIR, CACHE, CONTENT_DIR, SURAHS, sha256_bytes

AUTHORED_JSON = AUTHORED_DIR / "rumus.json"
CONTENT_JSON = CONTENT_DIR / "rumus.json"
VERSION = 1
SHAMELA_KEY = "shamela_istilah"
PIPELINE_LINE = "belajar/pipeline/build_rumus.py (stdlib only, no LLM)"

ENTRY_KEYS = {"rumus", "awas", "sumber"}
SOURCE_KEYS = {"page", "match"}
TOP_KEYS = ["version", "steps", "data_versions"]
BUILT_KEYS = ["step", "lesson", "rumus", "awas", "example", "sumber"]
BUILT_SOURCE_KEYS = ["page", "kitab", "hlm", "bab", "url", "quotes"]
# A formula is short (it is a cheat sheet): the limits are generous, and a longer one is two steps.
MAX_RUMUS = 420
MAX_AWAS = 320
MIN_MATCH_WORDS = 3

_AR_LETTERS = "\u0621-\u063a\u0641-\u064a\u0671"  # the letters, alif wasla included
_AR_MARKS = "\u064b-\u065f\u0670\u06d6-\u06ed\u0640"  # harakat, dagger alif, the mushaf's small marks, tatweel
_WORD = re.compile(f"(?:[{_AR_LETTERS}][{_AR_MARKS}]*)+")
_MARKS = re.compile(f"[{_AR_MARKS}]")
# Alif forms unified (alif wasla, hamzah above, hamzah below, madda), alif maqsurah as ya'.
_FOLD = str.maketrans({"\u0671": "\u0627", "\u0623": "\u0627", "\u0625": "\u0627", "\u0622": "\u0627", "\u0649": "\u064a"})
_FOOTNOTE = re.compile("[\u0660-\u0669]+")  # Arabic-Indic digits: the editor's footnote markers
_ANY_ARABIC = re.compile("[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]")
# What a built quote may hold: Arabic letters and their marks, spaces, and the kitab's punctuation.
_QUOTE_OK = re.compile(f"^[{_AR_LETTERS}{_AR_MARKS} \u060c\u061b\u061f.,:;!?\"'\u201c\u201d()\u00ab\u00bb-]+$")
_POINTER = re.compile(r"\{\{di:([a-z0-9]+(?:-[a-z0-9]+)*)\}\}")
_ALLCAPS = re.compile(r"\b[A-Z]{3,}\b")
_WORD_CHARS = TM._WORD_CHARS


class RumusError(Exception):
    pass


# ------------------------------------------------------------------ files
def load_authored(path: Path = AUTHORED_JSON) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def load_content(path: Path = CONTENT_JSON) -> dict | None:
    """content/rumus.json, or None before build_rumus.py has run."""
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def dump(content: dict) -> str:
    return json.dumps(content, ensure_ascii=False, indent=1) + "\n"


# ------------------------------------------------------------------ the pages
def pages_of(sources: dict) -> dict[str, dict]:
    return sources["inputs"][SHAMELA_KEY]["pages"]


def books_of(sources: dict) -> dict[str, str]:
    return sources["inputs"][SHAMELA_KEY]["books"]


def page_text(sources: dict, key: str, cache: Path = CACHE) -> str:
    """The pinned page text (extracted, UTF-8) — the matn only, the editor's footnotes cut — read
    from the cache and held to the pin's sha256 of the WHOLE extracted text."""
    pin = pages_of(sources).get(key)
    if pin is None:
        raise RumusError(f"page {key}: not pinned in sources.json ({SHAMELA_KEY}.pages)")
    book, page = key.split("/")
    p = cache / "shamela" / book / f"{page}.txt"
    if not p.exists():
        raise RumusError(f"page {key}: {p} is missing (python3 fetch.py --only {SHAMELA_KEY})")
    b = p.read_bytes()
    if sha256_bytes(b) != pin.get("text_sha256"):
        raise RumusError(f"page {key}: the cached text does not match the pin (sha256 {sha256_bytes(b)} != {pin.get('text_sha256')})")
    text = b.decode("utf-8")
    cut = text.find(TM.HAMESH_MARK)
    return text if cut < 0 else text[:cut]


def bab_of(pin: dict) -> str:
    """The section the page sits in, as the pin's title names it: "ص9 - كتاب … - باب … - المكتبة
    الشاملة" → "باب …". The page number and the kitab's title must be the pin's."""
    parts = [p.strip() for p in str(pin.get("title", "")).split(" - ")]
    if len(parts) < 4 or parts[0] != f"ص{pin.get('print_page')}":
        raise RumusError(f"title {pin.get('title')!r} is not 'ص<print page> - <kitab> - <section> - <site>'")
    return " - ".join(parts[2:-1])


# ------------------------------------------------------------------ folding and finding a sentence
def words(text: str) -> list[tuple[str, int, int]]:
    """[(folded word, start, end)] of the Arabic words of `text` (marks included in the span)."""
    out = []
    for m in _WORD.finditer(text):
        out.append((_MARKS.sub("", m.group()).translate(_FOLD), m.start(), m.end()))
    return out


def fold_tokens(s: str) -> list[str]:
    return [w for w, _a, _b in words(s)]


def fold(s: str) -> str:
    return " ".join(fold_tokens(s))


def find_quote(text: str, anchor: list[str]) -> str:
    """The page's own bytes for the run of whole words `anchor` (folded words): the substring from
    the first word to the last, the footnote markers dropped and whitespace collapsed. Raises when
    the run is absent or occurs more than once."""
    ws = words(text)
    folded = [w for w, _a, _b in ws]
    n = len(anchor)
    at = [i for i in range(len(folded) - n + 1) if folded[i:i + n] == anchor]
    if not at:
        raise RumusError("not found as a run of whole words")
    if len(at) > 1:
        raise RumusError(f"found {len(at)} times: lengthen the match")
    i = at[0]
    start, end = ws[i][1], ws[i + n - 1][2]
    raw = text[start:end]
    # A sentence that ends inside a quotation takes the closing mark with it (غلامُ زيدٍ").
    if raw.count('"') % 2 == 1 and text[end:end + 1] == '"':
        raw += '"'
    one = re.sub(r"\s+", " ", _FOOTNOTE.sub("", raw)).strip()
    return re.sub(r"\s+([\u060c\u061b\u061f.,:;!?])", r"\1", one)


# ------------------------------------------------------------------ the markup
def terms_in(marked: str, table: dict) -> list[str]:
    """The term ids a text USES, in order: every [[…]] that names a term, and every term form
    written outside the markup — the ambiguous forms too (huruf, sifat, min …), which `unmarked`
    leaves to the author: for the term rule a form is a use."""
    by_id, by_form = TM.term_index(table)
    found: list[tuple[int, str]] = []
    for m in TM.MARKUP.finditer(marked):
        r = TM.resolve(m.group(1), m.group(2), by_id, by_form)
        if r and r[0] == "term":
            found.append((m.start(), r[1]))
    rest = _POINTER.sub(lambda m: " " * len(m.group(0)), TM.MARKUP.sub(lambda m: " " * len(m.group(0)), marked))
    taken = [False] * len(rest)
    pats = sorted(((f, t["id"]) for t in table.get("terms", []) for f in t.get("forms", [])), key=lambda x: len(x[0]), reverse=True)
    for f, tid in pats:
        rx = re.compile(rf"(?<![{_WORD_CHARS}]){re.escape(f)}(?:-?nya)?(?![{_WORD_CHARS}])", re.I)
        for m in rx.finditer(rest):
            if any(taken[m.start():m.end()]):
                continue
            for k in range(m.start(), m.end()):
                taken[k] = True
            found.append((m.start(), tid))
    return [tid for _p, tid in sorted(found)]


def place_phrase(cur: dict, step_id: str) -> str:
    """Where a step is taught, as a pointer says it: "di Al-Fatihah ayat 4", "di pelajaran
    pengantar", "di Ayat Kursi penggalan 5" — from the curriculum's lesson and unit."""
    step = CUR.step_of(cur, step_id)
    lesson = CUR.lesson_of(cur, step["lesson"]) if step else None
    if step is None or lesson is None:
        raise RumusError(f"pointer to {step_id!r}: no such step in the curriculum")
    if lesson["id"] == CUR.LESSON_ZERO:
        return "di pelajaran pengantar"
    unit = next((u for u in cur.get("units") or [] if u.get("id") == lesson.get("unit")), None)
    name = (unit or {}).get("name") or lesson.get("unit")
    if lesson.get("segment") is not None:
        return f"di {name} penggalan {lesson['segment']}"
    return f"di {name} ayat {lesson['ayah']}"


def resolve_pointers(text: str, cur: dict) -> str:
    return _POINTER.sub(lambda m: place_phrase(cur, m.group(1)), text)


def explicit_text(text: str, cur: dict, table: dict) -> str:
    """What is shipped: pointers resolved, every term named by id ([[isim|isim]])."""
    by_id, by_form = TM.term_index(table)
    return TM.explicit(resolve_pointers(text, cur), by_id, by_form)


# ------------------------------------------------------------------ the example
def lesson_ayah(cur: dict, lessons: dict[str, dict], lesson: dict) -> tuple[dict | None, dict | None]:
    """(unit, ayah dict of the lesson file) of an ayah lesson whose file is on disk, else Nones."""
    unit = next((u for u in cur.get("units") or [] if u.get("id") == lesson.get("unit")), None)
    slug = (unit or {}).get("slug")
    if not slug or slug not in lessons or lesson.get("segment") is not None or lesson.get("ayah") is None:
        return None, None
    return unit, next((a for a in lessons[slug].get("ayat", []) if a.get("ayah") == lesson["ayah"]), None)


def example_loc(cur: dict, lessons: dict[str, dict], step: dict) -> str | None:
    """The loc of the first word of the step's lesson that the step occurs on: the words the lesson's
    own line for the step lights (content/curriculum.json `lines`), else the words curriculum.occurs
    finds; None when the lesson has no ayah on disk or the step occurs nowhere."""
    lesson = CUR.lesson_of(cur, step["lesson"])
    if lesson is None:
        return None
    _unit, ayah = lesson_ayah(cur, lessons, lesson)
    if ayah is None:
        return None
    line = next((l for l in lesson.get("lines") or [] if l.get("step") == step["id"]), None)
    at = (line or {}).get("words") or CUR.occurs(step, ayah)
    n = min(at) if at else None
    return ayah["words"][n - 1]["loc"] if n else None


# ------------------------------------------------------------------ what the authored file must be
def authored_problems(authored: dict, cur: dict, sources: dict, table: dict) -> list[str]:
    errs: list[str] = []
    if not isinstance(authored, dict) or authored.get("version") != VERSION:
        return [f"authored/rumus.json: `version` must be {VERSION}"]
    extra = set(authored) - {"_comment", "version", "steps"}
    if extra or not isinstance(authored.get("steps"), dict):
        return [f"authored/rumus.json: keys must be _comment, version, steps (got extra {sorted(extra)})"]
    by_id, by_form = TM.term_index(table)
    pins = pages_of(sources)
    rank = CUR.ranks(cur)
    steps = {s["id"]: s for s in cur.get("steps") or [] if isinstance(s, dict)}
    for sid, e in authored["steps"].items():
        where = f"rumus[{sid}]"
        step = steps.get(sid)
        if step is None:
            errs.append(f"{where}: no step with this id in the curriculum (authored/curriculum.json steps)")
            continue
        if not isinstance(e, dict) or set(e) - ENTRY_KEYS:
            errs.append(f"{where}: keys must be among {sorted(ENTRY_KEYS)}")
            continue
        here = rank.get(step["lesson"])
        for field, cap in (("rumus", MAX_RUMUS), ("awas", MAX_AWAS)):
            if field not in e:
                if field == "rumus":
                    errs.append(f"{where}: no `rumus`")
                continue
            text = e[field]
            w = f"{where}.{field}"
            if not isinstance(text, str) or not text.strip() or text != text.strip() or "  " in text:
                errs.append(f"{w}: must be a non-empty, trimmed text with single spaces")
                continue
            if _ANY_ARABIC.search(text):
                errs.append(f"{w}: Arabic typed in a formula — Arabic reaches the page as a dictionary term "
                            "([[term]]) or as the quoted kitab (`sumber`), never typed")
            if _ALLCAPS.search(text):
                errs.append(f"{w}: ALL CAPS emphasis (use markdown-free plain prose; AGENTS.md)")
            if len(TM.strip(_POINTER.sub("di x ayat 1", text))) > cap:
                errs.append(f"{w}: longer than {cap} characters — a cheat sheet is short; split the step's claim")
            if "{{" in _POINTER.sub("", text) or "}}" in _POINTER.sub("", text):
                errs.append(f"{w}: a stray {{{{ }}}} (a pointer is {{{{di:<step id>}}}})")
            for sub in _POINTER.findall(text):
                try:
                    place_phrase(cur, sub)
                except RumusError as x:
                    errs.append(f"{w}: {x}")
                    continue
                if rank.get(steps[sub]["lesson"], -1) <= (here if here is not None else 10**6):
                    errs.append(f"{w}: pointer {{{{di:{sub}}}}} names a step taught in or before this lesson — a pointer is for "
                                "what the learner meets LATER; say the thing instead")
            flat = _POINTER.sub("di x ayat 1", text)
            errs += TM.check_markup(flat, w, by_id, by_form, table)
            errs += TM.wording(TM.strip(flat), w)
            for surface, ref in TM.spans(flat):
                if ref and ref.startswith("q:"):
                    errs.append(f"{w}: [[{surface}|{ref}]] — a Qur'anic word in a formula (no Qur'anic word is quoted here)")
            # The term rule (decision 7 of the basic curriculum; the lessons' own check):
            for tid in dict.fromkeys(terms_in(text, table)):
                bad = CUR.too_early(cur, step["lesson"], [tid])
                if bad:
                    errs.append(f"{w}: uses the term {tid!r} before the lesson that teaches it (taught in "
                                f"{CUR.term_home(cur, tid)}; this step is taught in {step['lesson']}) — reword it, or point to it "
                                f"with {{{{di:<step id>}}}}")
        src = e.get("sumber")
        if not isinstance(src, list) or not src:
            errs.append(f"{where}: no `sumber` — a formula without a kitab sentence is not shown (leave the step out)")
            continue
        seen_pages: set[str] = set()
        for k, s in enumerate(src):
            w = f"{where}.sumber[{k}]"
            if not isinstance(s, dict):
                errs.append(f"{w}: must be {{page, match}}")
                continue
            if "quote" in s or "quotes" in s:
                errs.append(f"{w}: a typed quote — the quote is the pinned page's own bytes, found by `match`")
            extra_keys = set(s) - SOURCE_KEYS - {"quote", "quotes"}
            if extra_keys:
                errs.append(f"{w}: unknown key(s) {sorted(extra_keys)} (kitab, hlm, bab, url come from the pin)")
            page = s.get("page")
            if page not in pins:
                errs.append(f"{w}: page {page!r} is not pinned in sources.json ({SHAMELA_KEY}.pages): pin it with fetch.py")
                continue
            if page in seen_pages:
                errs.append(f"{w}: page {page} listed twice — put its sentences in one source's `match`")
            seen_pages.add(page)
            for field_name in ("url", "print_page", "title", "text_sha256", "book"):
                if not pins[page].get(field_name):
                    errs.append(f"{w}: the pin of {page} has no {field_name!r}")
            m = s.get("match")
            if not isinstance(m, list) or not m:
                errs.append(f"{w}: `match` is a list of sentences (folded Arabic)")
                continue
            for j, one in enumerate(m):
                ww = f"{w}.match[{j}]"
                if not isinstance(one, str) or not one.strip():
                    errs.append(f"{ww}: must be text")
                elif fold(one) != one:
                    errs.append(f"{ww}: not folded — an anchor is the consonant skeleton (no harakat, alif forms unified, single "
                                f"spaces): {fold(one)!r}")
                elif len(fold_tokens(one)) < MIN_MATCH_WORDS:
                    errs.append(f"{ww}: fewer than {MIN_MATCH_WORDS} words — an anchor is a sentence, not a word")
    return errs


# ------------------------------------------------------------------ building
def build(authored: dict, cur: dict, lessons: dict[str, dict], sources: dict, table: dict, *,
          texts: dict[str, str] | None = None, previous: dict | None = None) -> dict:
    """content/rumus.json. `texts`: page key → pinned page text (the corpus); without it, each quote
    is taken from `previous` (the committed file) and must fold to its anchor."""
    errs = authored_problems(authored, cur, sources, table)
    if errs:
        raise RumusError("authored/rumus.json:\n  " + "\n  ".join(errs))
    pins = pages_of(sources)
    books = books_of(sources)
    old: dict[str, dict[str, list[str]]] = {}
    for e in (previous or {}).get("steps") or []:
        old[e.get("step")] = {s.get("page"): s.get("quotes") or [] for s in e.get("sumber") or []}
    order = [s["id"] for s in CUR.in_teaching_order(cur)]
    steps_out = []
    used: set[str] = set()
    for sid in [x for x in order if x in authored["steps"]]:
        a = authored["steps"][sid]
        step = CUR.step_of(cur, sid)
        sumber = []
        for s in a["sumber"]:
            page = s["page"]
            pin = pins[page]
            used.add(page)
            quotes = []
            for m in s["match"]:
                want = fold_tokens(m)
                try:
                    if texts is not None:
                        quote = find_quote(texts[page], want)
                    else:
                        quote = next((q for q in old.get(sid, {}).get(page, []) if fold_tokens(q) == want), None)
                        if quote is None:
                            raise RumusError("not in the committed file: build with pipeline/cache")
                except RumusError as x:
                    raise RumusError(f"rumus[{sid}] page {page}: the match {m!r}: {x}") from None
                quotes.append(quote)
            sumber.append({"page": page, "kitab": books[pin["book"]], "hlm": pin["print_page"], "bab": bab_of(pin),
                           "url": pin["url"], "quotes": quotes})
        entry: dict = {"step": sid, "lesson": step["lesson"], "rumus": explicit_text(a["rumus"], cur, table)}
        if a.get("awas"):
            entry["awas"] = explicit_text(a["awas"], cur, table)
        loc = example_loc(cur, lessons, step)
        if loc:
            entry["example"] = {"loc": loc}
        entry["sumber"] = sumber
        steps_out.append(entry)
    return {
        "version": VERSION,
        "steps": steps_out,
        "data_versions": {"pages": {p: pins[p]["text_sha256"] for p in sorted(used, key=lambda k: [int(x) for x in k.split("/")])},
                          "pipeline": PIPELINE_LINE},
    }


def texts_for(authored: dict, sources: dict, cache: Path = CACHE) -> dict[str, str]:
    """The pinned text of every page the authored file cites."""
    keys = sorted({s["page"] for e in authored["steps"].values() for s in e.get("sumber") or [] if s.get("page") in pages_of(sources)})
    return {k: page_text(sources, k, cache) for k in keys}


def load_lessons() -> dict[str, dict]:
    out = {}
    for sp in SURAHS:
        p = CONTENT_DIR / f"{sp.slug}.json"
        if p.exists():
            out[sp.slug] = json.loads(p.read_text(encoding="utf-8"))
    return out


# ------------------------------------------------------------------ what the built file must be
def problems(content: dict, authored: dict, cur: dict, lessons: dict[str, dict], sources: dict, table: dict, *,
             texts: dict[str, str] | None = None) -> list[str]:
    """Everything wrong with content/rumus.json: its shape, its pins, each quote (verbatim in its page
    where `texts` is given, else folding to an authored anchor), its example, and equality with a
    fresh build."""
    errs: list[str] = []
    if not isinstance(content, dict) or list(content) != TOP_KEYS or content.get("version") != VERSION:
        return [f"content/rumus.json: keys must be {TOP_KEYS}, version {VERSION}"]
    pins = pages_of(sources)
    books = books_of(sources)
    steps = {s["id"]: s for s in cur.get("steps") or [] if isinstance(s, dict)}
    rows = content.get("steps")
    if not isinstance(rows, list):
        return ["content/rumus.json: `steps` must be a list"]
    ids = [r.get("step") for r in rows if isinstance(r, dict)]
    want_ids = [s["id"] for s in CUR.in_teaching_order(cur) if s["id"] in (authored.get("steps") or {})]
    if ids != want_ids:
        errs.append(f"steps {ids} are not the authored steps in the curriculum's teaching order {want_ids}")
    anchors: dict[str, dict[str, list[list[str]]]] = {}
    for sid, e in (authored.get("steps") or {}).items():
        anchors[sid] = {s.get("page"): [fold_tokens(m) for m in s.get("match") or [] if isinstance(m, str)] for s in e.get("sumber") or []
                        if isinstance(s, dict)}
    for r in rows:
        if not isinstance(r, dict):
            errs.append("a step entry is not an object")
            continue
        sid = r.get("step")
        w = f"rumus[{sid}]"
        extra = [k for k in r if k not in BUILT_KEYS]
        if extra:
            errs.append(f"{w}: unknown key(s) {extra}")
        if sid not in steps:
            errs.append(f"{w}: no such step in the curriculum")
            continue
        if r.get("lesson") != steps[sid]["lesson"]:
            errs.append(f"{w}: lesson {r.get('lesson')!r} is not the step's lesson {steps[sid]['lesson']!r}")
        if not isinstance(r.get("rumus"), str) or not r["rumus"].strip():
            errs.append(f"{w}: no `rumus`")
        if _ANY_ARABIC.search(TM.strip(str(r.get("rumus", "")))) or _ANY_ARABIC.search(TM.strip(str(r.get("awas", "")))):
            errs.append(f"{w}: Arabic in a formula's text")
        src = r.get("sumber")
        if not isinstance(src, list) or not src:
            errs.append(f"{w}: no `sumber`")
            continue
        for k, s in enumerate(src):
            ws = f"{w}.sumber[{k}]"
            if not isinstance(s, dict):
                errs.append(f"{ws}: not an object")
                continue
            if list(s) != BUILT_SOURCE_KEYS:
                missing = [x for x in BUILT_SOURCE_KEYS if x not in s]
                errs.append(f"{ws}: keys must be {BUILT_SOURCE_KEYS}" + (f" (missing {missing}: a source needs its kitab, page, address)" if missing else ""))
                continue
            pin = pins.get(s["page"])
            if pin is None:
                errs.append(f"{ws}: page {s['page']!r} is not pinned in sources.json")
                continue
            for field_name, want in (("kitab", books.get(pin.get("book"))), ("hlm", pin.get("print_page")), ("url", pin.get("url"))):
                if s[field_name] != want or not s[field_name]:
                    errs.append(f"{ws}: {field_name} {s[field_name]!r} is not the pin's {want!r}")
            try:
                if s["bab"] != bab_of(pin):
                    errs.append(f"{ws}: bab {s['bab']!r} is not the pin's {bab_of(pin)!r}")
            except RumusError as x:
                errs.append(f"{ws}: {x}")
            qs = s["quotes"]
            if not isinstance(qs, list) or not qs or not all(isinstance(q, str) and q for q in qs):
                errs.append(f"{ws}: `quotes` must be a list of non-empty texts")
                continue
            for j, q in enumerate(qs):
                wq = f"{ws}.quotes[{j}]"
                if not _QUOTE_OK.match(q) or q != re.sub(r"\s+", " ", q).strip():
                    errs.append(f"{wq}: not the kitab's Arabic alone (letters, harakat, its punctuation, single spaces)")
                    continue
                if fold_tokens(q) not in anchors.get(sid, {}).get(s["page"], []):
                    errs.append(f"{wq}: is none of the authored anchors of page {s['page']} (a hand-edited quote?)")
                    continue
                if texts is not None:
                    try:
                        got = find_quote(texts[s["page"]], fold_tokens(q))
                    except (RumusError, KeyError) as x:
                        errs.append(f"{wq}: not found in the pinned text of page {s['page']}: {x}")
                        continue
                    if got != q:
                        errs.append(f"{wq}: differs from the page's own bytes: page has {got!r}")
        ex = r.get("example")
        if ex is not None:
            loc = ex.get("loc") if isinstance(ex, dict) else None
            if list(ex) != ["loc"] or loc != example_loc(cur, lessons, steps[sid]):
                errs.append(f"{w}: example {ex} is not the first word the step occurs on ({example_loc(cur, lessons, steps[sid])!r})")
        elif example_loc(cur, lessons, steps[sid]):
            errs.append(f"{w}: no example, and the step occurs on {example_loc(cur, lessons, steps[sid])}")
    # The pins the file was built from.
    used = sorted({s.get("page") for r in rows if isinstance(r, dict) for s in r.get("sumber") or [] if isinstance(s, dict)})
    dv = content.get("data_versions") or {}
    for p in used:
        if p in pins and (dv.get("pages") or {}).get(p) != pins[p].get("text_sha256"):
            errs.append(f"data_versions.pages[{p}]: {(dv.get('pages') or {}).get(p)!r} is not the pin's {pins[p].get('text_sha256')!r} — the page changed, rebuild")
    if set(dv.get("pages") or {}) != set(used):
        errs.append(f"data_versions.pages lists {sorted(dv.get('pages') or {})}, the sources cite {used}")
    # Equality with a fresh build (everything but the quote bytes where there is no corpus).
    try:
        fresh = build(authored, cur, lessons, sources, table, texts=texts, previous=content)
    except RumusError as x:
        errs.append(f"build: {x}")
        return errs
    if dump(fresh) != dump(content):
        a, b = fresh["steps"], content["steps"]
        first = next((x["step"] for x, y in zip(a, b) if x != y), None) or (a[len(b)]["step"] if len(a) > len(b) else "?")
        errs.append(f"out of date with a fresh build (first difference at step {first!r}): run build_rumus.py")
    return errs
