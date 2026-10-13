"""The guided-lesson quizzes: which exercises an ayah shows, each question with its answer and
options, and the check that every question was TAUGHT before it is asked (stdlib only).

Operator, 2026-10-10 (feedback_belajar_narration_style rule 16): "make sure all questions in quiz
already have lesson beforehand when exploring ayat"; "problem to classify marfu', manshub, majrur,
mabni, but there is no lesson about this yet"; "there is also quiz about bentuk kata (wazan), i did
not see lesson about this before"; "better to write the arabic word in quiz as well like majrur in
arabic". The audit of 2026-10-11 (every question re-derived from the components) and the main
session's decisions the same day fix the rules below.

ONE plan per surah, content/quiz/<slug>.json, built by build_quiz.py and read by everything else:
the lesson page and its exercises (src/lib/quiz-content.ts), the autoplay engine (which exercises an
ayah waits at, and which question a correct answer explains), the narration build (the exercise
intros with their counts, one explanation line per question) and its validator (the lines each ayah
must have). Nothing re-derives a question at render time any more.

Two kinds of plan:

- AUTHORED, authored/<slug>.quiz.json (Al-Fatihah): per ayah, the exercises it keeps and, per
  question, the word it asks about and the words whose reason (why-harakat) or role (label-role)
  are its wrong options, the case bins (sort-case), the forms by label (wazn-factory). This module
  resolves those references into the texts shown (content bytes, the grammar terms given their
  Arabic from the verified term table) and checks the plan:
    * every wrong option comes from an ayah already studied (≤ this one) and differs in CAUSE: for
      why-harakat no two options share a cause class (the first grammar term after "karena": the
      huruf jar, the mudhaf ilaih, the na't …), for label-role no wrong option shares a term with
      the answer (no "huruf jar + majrur" beside "khabar (jar-majrur)", no "na't (sifat)" beside
      "na't (sifat) atau badal"), so no question has two correct options;
    * sort-case bins are distinct case states, every word's state is a bin, and the words are in
      at least two states (nothing to sort otherwise); wazn-factory asks a form of a lemma of the
      ayah, from that lemma's tashrif table, with distinct labels and distinct forms;
    * TAUGHT(ayah) ⊇ REQUIRED(question) for every question: every grammar term a question, its
      options, its bins or its form labels name (the case state of a why/sort word, its sign, the
      terms in an option's text, a form's label) must have been TAUGHT by the end of the teaching
      steps of the ayat ≤ this one. TAUGHT is derived from the narration lines those steps play
      (content/narration/<slug>.json: intro … structure of every ayah ≤ n; never a hand list): a
      term is taught where the lesson NAMES or DEFINES it — in a concept step's title (the concept
      card's subject), as the subject of "… adalah …", after "disebut" / "menyebutnya", or, in a
      concept step's summary, as ", atau <term>" naming the thing just described ("kata keduanya,
      atau mudhaf ilaih"). A term only mentioned ("ia manshub") or only glossed after an
      Indonesian word ("pengganti (badal)", "objek (maf'ul bih)") is NOT taught (decision 6,
      2026-10-11).
- MECHANICAL (every other surah: the Mu'awwidzat, hidden on the live site since 2026-10-10): the
  exercises as the components built them before, except that wrong options come only from the
  ayat studied so far within the surah (the one rule that is mechanical; no teaching is authored
  for them here). A question left with no wrong option is dropped. Not taught-checked.

Shown Arabic: a grammar term in an option, a bin, a sign or a form label is shown "majrur
(مَجْرُور)" (first use in that text), merged with the text's own gloss ("na't (نَعْت, sifat)"),
inside the text's brackets right after the term, one space and no comma ("(mudhaf ilaih مُضَاف
إِلَيْه)"), and a phrase of Qur'anic words with ONE bracket after the whole phrase ("yaum ad-dīn
(يَوْمِ ٱلدِّينِ)"); two grammar terms side by side never share one, each keeps its own ("fi'il
mudhari' (فِعْل مُضَارِع) majzum (مَجْزُوم)") — the convention of the Konsep
pages and the word cards (src/lib/terms.ts annotate + termDisplay, of which render_marked below is
the twin; operator 2026-10-12, "tidy them up"). The Arabic is the term table's, byte for byte; a
term the table cannot attest (ar null) stays Latin. Nothing here types Arabic: forms come from the
lexicon's tashrif tables, words from the lesson content.
"""
from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

from common import AUTHORED_DIR, CONTENT_DIR, SURAHS

QUIZ_DIR = CONTENT_DIR / "quiz"
TERMS_JSON = AUTHORED_DIR / "library.terms.json"
QUIZ_VERSION = 1

# The five exercises, in page order (mirrors src/components/exercises/guide.ts EXERCISE_KEYS).
EXERCISE_KEYS = ("tap-word", "why-harakat", "sort-case", "label-role", "wazn-factory")
# The case states a beginner sorts and is asked "why" about (src/lib/cases.ts SORT_BINS).
SORT_BINS = ("marfu", "manshub", "majrur", "mabni")
# Case state → its term in the table.
STATE_TERM = {"marfu": "marfu", "manshub": "manshub", "majrur": "majrur", "mabni": "mabni", "majzum": "majzum"}
# One cause, two names: a sifat is a na't; a jar-majrur phrase is a huruf jar with its majrur; an
# isim majrur is majrur (cause classes and the overlap of role options).
SAME_CAUSE = {"sifat": "naat", "jar-majrur": "huruf-jar", "isim-majrur": "majrur"}
# The parts of an ayah's narration that TEACH (played before its exercises): line ids
# "<slug>:<ayah>:<part>"; exercise lines, the recap and next/done teach nothing.
TEACHING_PART = re.compile(r"intro|recite|primer:\d+|w\d+(?::compose:\d+)?|structure|concept:[a-z0-9-]+")
CONCEPT_LEAD = "Konsep baru:"
APOS = "'‘’ʼʿ`´"
_APOS = re.compile(f"[{APOS}]")


class QuizError(Exception):
    pass


# ------------------------------------------------------------------ the term table
def load_terms(path: Path = TERMS_JSON) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))["terms"]


def _norm(s: str) -> str:
    """Apostrophe-like marks as one ASCII apostrophe (same length: indices survive)."""
    return _APOS.sub("'", s)


class Terms:
    """The verified term table as a matcher over Latin prose: each term's `forms` (the surfaces the
    prose writes), longest first, whole words only, the first letter in either case."""

    def __init__(self, terms: list[dict]):
        self.by_id = {t["id"]: t for t in terms}
        alts: list[tuple[str, str, bool]] = []
        for t in terms:
            amb = set(t.get("ambiguous_forms") or [])
            for f in t.get("forms") or []:
                alts.append((_norm(f), t["id"], f in amb))
        alts.sort(key=lambda x: -len(x[0]))
        self._forms = alts
        parts = []
        for i, (f, _tid, _amb) in enumerate(alts):
            body = re.escape(f)
            if f[:1].isalpha():
                body = f"[{f[0].upper()}{f[0].lower()}]" + re.escape(f[1:])
            elif f[:1] == "'" and f[1:2].isalpha():
                body = "'" + f"[{f[1].upper()}{f[1].lower()}]" + re.escape(f[2:])
            parts.append(f"(?P<f{i}>{body})")
        self._rx = re.compile(r"(?<![\w'\-])(?:" + "|".join(parts) + r")(?![\w'\-])") if parts else None

    def matches(self, text: str, *, ambiguous: bool = False) -> list[tuple[int, int, str]]:
        """(start, end, term id) of each term the text names, left to right, longest first; an
        ambiguous form (huruf, sifat, bab …: ordinary Indonesian too) only when asked."""
        if self._rx is None:
            return []
        out = []
        for m in self._rx.finditer(_norm(text)):
            _f, tid, amb = self._forms[int(m.lastgroup[1:])]
            if amb and not ambiguous:
                continue
            out.append((m.start(), m.end(), tid))
        return out

    def ids(self, text: str) -> set[str]:
        return {tid for _a, _b, tid in self.matches(text)}

    def ar(self, tid: str) -> str | None:
        return (self.by_id.get(tid) or {}).get("ar")

    def label(self, tid: str) -> str:
        """A term on its own, "majrur (مَجْرُور)" (a bin, a badge)."""
        t = self.by_id[tid]
        return f"{t['latin']} ({t['ar']})" if t.get("ar") else t["latin"]

    def annotate(self, text: str) -> str:
        """`text` (plain prose: an unmarked lesson's reason, role or sign, a tashrif label) with each
        grammar term's Arabic at its first use: every term the text names is marked ([[…|id]]) and
        the text shown as marked text is (render_marked), so a plain text and a marked one follow
        one set of rules. A term the table has no Arabic for is left as it is written."""
        out, cur = "", 0
        for a, b, tid in self.matches(text):
            if not self.ar(tid):
                continue
            out += text[cur:a] + f"[[{text[a:b]}|{tid}]]"
            cur = b
        return self.annotate_marked(out + text[cur:], {})

    def annotate_marked(self, marked: str, quran: dict[str, str], segments: dict[str, list[str]] | None = None) -> str:
        """A MARKED text — a marked lesson's `why`, `role` or sign (build_surah.py MARKED_SURAHS;
        operator 2026-10-12: Qur'anic words in Arabic too, "not only the transliteration") — as the
        word card shows it: each term its Arabic from this table, each Qur'anic word, part, letter
        or gloss its bytes from the lesson's `quran` (q-ref without "q:"), at its first use in the
        text. Its markup is gone from the result."""
        return render_marked(marked, self.by_id, quran, segments or {})


# ------------------------------------------------------------------ marked text as the card shows it
# The twin of src/lib/terms.ts annotate + termDisplay for one text in a scope of its own, without
# the harakah reminders (a word card's scope: new Scope(false) — so a harakah term never owes a
# reminder here; runs are Qur'anic words only, as there). Every rule here is that module's, under
# the same name; src/lib/quiz-content.test.ts pins the Al-Fatihah quiz to the card's rendering,
# character for character. Change the two together.

# The Konsep markup (pipeline/terms.py MARKUP): [[surface]] or [[surface|ref]].
_MARKUP = re.compile(r"\[\[([^\[\]|]+?)(?:\|([^\[\]|]+))?\]\]")
# q:S:A:W · q:S:A:W1-W2 · q:S:A:W/k (QAC segment) · q:S:A:W#n (letter): terms.ts QREF.
_QREF = re.compile(r"^q:(\d{1,3}):(\d{1,3}):(\d{1,3})(?:-(\d{1,3})|/(\d{1,2})|#(\d{1,2}))?$")
# A gloss variant's surface, one quotation “…” (terms.ts GLOSS).
_GLOSS = re.compile(r"^“[^“”]+”$")
# Words that join a list inside brackets rather than continue a phrase (terms.ts LIST_WORDS).
_LIST_WORDS = {"dan", "atau", "serta", "maupun"}
_LEADING_PUNCT = re.compile(r"^[,.;:!?)”]+")
# The authors and kitabs cited by a capitalised name (terms.ts CITED: the same list).
CITED = ("Darwisy", "Ibnu", "Abu", "Ahmad", "Mughni", "Shahih", "Riyadhush")


def _cited(rest: str) -> bool:
    """`rest` opens with a cited name as a whole word (terms.ts CITED_NAME)."""
    for name in CITED:
        if rest.startswith(name):
            nxt = rest[len(name):len(name) + 1]
            if not nxt or unicodedata.category(nxt)[0] not in "LM":
                return True
    return False


def _gloss_opens(text: str) -> bool:
    """terms.ts GLOSS_OPENS: " (" opening the text's own gloss of the word, its ending, or its place
    (a bracket that opens on a number) — lowercase Indonesian, a quoted gloss, or a capitalised one
    whose first word is not a cited name; not "(al-Jadwal)", not "(lihat: …)"."""
    if not text.startswith(" (") or len(text) < 3:
        return False
    rest = text[2:]
    if rest[0] in "0123456789":
        return True
    if re.match(r"[a-z“'‘\-]", rest) and not re.match(r"[a-z]{1,2}-|lihat(?![A-Za-z0-9_])", rest):
        return True
    return unicodedata.category(rest[0]) == "Lu" and not _cited(rest)


def _cite_opens(text: str) -> bool:
    """terms.ts CITE_OPENS: " (" opening an author citation or a cross-reference."""
    if not text.startswith(" ("):
        return False
    rest = text[2:]
    return bool(re.match(r"lihat(?![A-Za-z0-9_])|[a-z]{1,3}-[A-Z]", rest)) or _cited(rest)


def _bracket_state(before: str) -> tuple[int, bool]:
    """terms.ts bracketState: how deep the text so far sits in its own brackets, and whether the
    innermost one is a cross-reference ("(lihat: …)")."""
    stack: list[int] = []
    for i, ch in enumerate(before):
        if ch == "(":
            stack.append(i)
        elif ch == ")" and stack:
            stack.pop()
    return len(stack), bool(stack) and bool(re.match(r"\(lihat(?![A-Za-z0-9_])", before[stack[-1]:]))


def _continues_phrase(nxt: tuple | None, after: tuple | None) -> bool:
    """terms.ts continuesPhrase: whether the text after an item or a run goes on with the same
    phrase — another word, or another marked item that is not of its run — not the end of the
    bracket, a comma or a list."""
    if not nxt or nxt[0] != "text":
        return False
    if nxt[1] == " ":
        return bool(after) and after[0] == "mark"
    m = re.match(r" ((?:[^\W\d_]|['‘’-])+)", nxt[1])
    return bool(m) and m.group(1).lower() not in _LIST_WORDS


def _follows(a: str, b: str, segments: dict[str, list[str]]) -> bool:
    """terms.ts follows: Qur'anic item `b` goes on where `a` ends — the next word of the same ayah,
    `a` a word, a run of words or the LAST part of its word, `b` a word, a run or the FIRST part of
    its own — so that their bytes joined by a space are the mushaf's own text."""
    x, y = _QREF.match(a), _QREF.match(b)
    if not x or not y or x.group(6) or y.group(6) or x.group(1) != y.group(1) or x.group(2) != y.group(2):
        return False
    if x.group(5) and len(segments.get(f"{x.group(1)}:{x.group(2)}:{x.group(3)}") or []) != int(x.group(5)):
        return False
    if y.group(5) and y.group(5) != "1":
        return False
    return int(y.group(3)) == int(x.group(4) or x.group(3)) + 1


def render_marked(marked: str, terms: dict[str, dict], quran: dict[str, str], segments: dict[str, list[str]]) -> str:
    """`marked` as a word card draws it (terms.ts annotate + termDisplay, a scope of its own, no
    harakah reminders). `terms`: the term table by id; `quran`: the bytes of each q-ref (without
    "q:"); `segments`: the QAC parts of each word a part ref names."""
    # spans: ("text", text) | ("mark", surface, ref)
    spans: list[tuple] = []
    last = 0
    for m in _MARKUP.finditer(marked):
        if m.start() > last:
            spans.append(("text", marked[last:m.start()]))
        spans.append(("mark", m.group(1), m.group(2) or m.group(1)))
        last = m.end()
    if last < len(marked):
        spans.append(("text", marked[last:]))

    # items: (kind, key, ar | None) — a term the table has no Arabic for keeps ar None; an unknown
    # ref is None (its surface, as plain text).
    def resolve(sp: tuple):
        if sp[0] != "mark":
            return None
        ref = sp[2]
        if ref.startswith("q:"):
            ar = quran.get(ref[2:])
            return ("quran", ref, ar) if ar else None
        term = terms.get(ref)
        return ("term", ref, term.get("ar")) if term else None

    items = [resolve(sp) for sp in spans]

    def joins(k: int) -> bool:
        if not 0 <= k < len(spans) or items[k] is None:
            return False
        kind, _key, _ar = items[k]
        # Qur'anic words only (terms.ts runFrom): two grammar terms side by side are seldom one
        # Arabic phrase, so each keeps its own Arabic (review 2026-10-12).
        return kind == "quran" and not _GLOSS.match(spans[k][1])

    # terms.ts runFrom, for every span at once (no scope state decides a run here): start → its spans.
    runs: dict[int, list[int]] = {}
    k = 0
    while k < len(spans):
        if joins(k):
            run = [k]
            while True:
                end = run[-1]
                gap = spans[end + 1] if end + 1 < len(spans) else None
                if not gap or gap != ("text", " ") or not joins(end + 2) or items[end + 2][0] != items[end][0]:
                    break
                if items[end][0] == "quran" and not _follows(items[end][1], items[end + 2][1], segments):
                    break
                run.append(end + 2)
            if len(run) > 1:
                runs[k] = run
            k = run[-1]
        k += 1

    out, before, seen = "", "", set()
    k = 0
    while k < len(spans):
        sp = spans[k]
        if sp[0] == "text":
            out += sp[1]
            before += sp[1]
            k += 1
            continue
        item = items[k]
        if item is None:
            out += sp[1]
            before += sp[1]
            k += 1
            continue
        depth, cross = _bracket_state(before)
        run = runs.get(k)
        end = run[-1] if run else k
        nxt = spans[end + 1] if end + 1 < len(spans) else None
        aft = spans[end + 2] if end + 2 < len(spans) else None
        live = not cross and not (depth > 0 and _continues_phrase(nxt, aft))
        if run:
            members = [items[i] for i in run]
            ar = " ".join(m[2] for m in members)
            arabic = live and any(m[1] not in seen for m in members)
            surface = " ".join(spans[i][1] for i in run)
            if live:
                seen.update(m[1] for m in members)
            k = end
        else:
            kind, key, ar = item
            surface = sp[1]
            arabic = live and bool(ar) and key not in seen
            if live and (kind == "term" or arabic):
                seen.add(key)
        out += surface
        before += surface
        if arabic:
            text = nxt[1] if nxt and nxt[0] == "text" else None
            after, merge, cite = "", False, False
            if text is not None:
                m = _LEADING_PUNCT.match(text)
                if m:
                    after = m.group(0)
                    spans[k + 1] = ("text", text[len(after):])
                    before += after
                elif depth == 0 and (_gloss_opens(text) or (text == " (" and aft is not None and aft[0] == "mark")):
                    merge = True
                elif depth == 0 and _cite_opens(text):
                    cite = True
                if merge or cite:
                    spans[k + 1] = ("text", text[2:])
                    before += " ("
            # terms.ts termDisplay
            if depth > 0:
                out += f" {ar}{after}"
            elif merge:
                out += f" ({ar}, "
            elif cite:
                out += f" ({ar}; "
            else:
                out += f" ({ar}){after}"
        k += 1
    return out


def cause_class(text: str, terms: Terms, *, after_karena: bool) -> str | None:
    """The grammar cause a reason or a role names: the first term (sifat counts: it is the na't)
    after "karena" (a why sentence: "Akhirnya kasrah karena menjadi mudhaf ilaih …"), or the
    first term at all (a role: "huruf jar + majrur" → huruf jar)."""
    start = 0
    if after_karena:
        m = re.search(r"\bkarena\b", text)
        start = m.end() if m else 0
    for a, _b, tid in terms.matches(text, ambiguous=True):
        if a >= start and tid != "huruf":
            return SAME_CAUSE.get(tid, tid)
    return None


def term_classes(text: str, terms: Terms) -> set[str]:
    """Every term a role names, as causes (sifat = na't, jar-majrur = huruf jar)."""
    return {SAME_CAUSE.get(tid, tid) for _a, _b, tid in terms.matches(text, ambiguous=True) if tid != "huruf"}


# ------------------------------------------------------------------ the lesson
def timed_words(ayah: dict) -> list[int]:
    """1-based word numbers timed in the ayah's recitation (the one imam's, plan L21; Dengar dan
    klik plays it): src/lib/autoplay/exercises.ts timedWords."""
    recs = ayah.get("recitation") or []
    return sorted({seg[0] for seg in recs[0]["segments"]}) if recs else []


def word_at(lesson: dict, loc: str) -> dict:
    s, a, w = (int(x) for x in loc.split(":"))
    for ay in lesson["ayat"]:
        if ay["ayah"] == a and 0 < w <= len(ay["words"]):
            word = ay["words"][w - 1]
            if word["loc"] == loc:
                return word
    raise QuizError(f"{loc}: not a word of {lesson['slug']}")


def ayah_of(loc: str) -> int:
    return int(loc.split(":")[1])


# ------------------------------------------------------------------ the deterministic shuffle
# A port of src/lib/shuffle.ts seededShuffle (FNV-1a + mulberry32 + Fisher–Yates): the mechanical
# plans pick their wrong options exactly as the components did, from the restricted pool.
def _i32(x: int) -> int:
    x &= 0xFFFFFFFF
    return x - 0x100000000 if x & 0x80000000 else x


def _imul(a: int, b: int) -> int:
    return _i32((a & 0xFFFFFFFF) * (b & 0xFFFFFFFF))


def _fnv(s: str) -> int:
    h = 2166136261
    units = s.encode("utf-16-le")
    for i in range(0, len(units), 2):
        h ^= units[i] | (units[i + 1] << 8)
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def seeded_shuffle(items: list, seed: str) -> list:
    out = list(items)
    a = _fnv(seed)

    def rand() -> float:
        nonlocal a
        a = _i32(a)
        a = _i32(a + 0x6D2B79F5)
        t = _imul(a ^ ((a & 0xFFFFFFFF) >> 15), 1 | a)
        t = _i32(t + _imul(t ^ ((t & 0xFFFFFFFF) >> 7), 61 | t)) ^ t
        return (((t ^ ((t & 0xFFFFFFFF) >> 14)) & 0xFFFFFFFF)) / 4294967296

    for i in range(len(out) - 1, 0, -1):
        j = int(rand() * (i + 1))
        out[i], out[j] = out[j], out[i]
    return out


# ------------------------------------------------------------------ the mechanical plan
def mechanical_plan(lesson: dict, library: dict) -> dict:
    """The authored-plan shape for a surah nobody wrote a plan for: the exercises as the components
    built them (before 2026-10-11), with the wrong options drawn only from the ayat studied so far."""
    lex = {x["id"]: x for x in library["lexicon"]}
    out: dict[str, dict] = {}
    pool: list[dict] = []
    for a in lesson["ayat"]:
        words = a["words"]
        pool = pool + words
        plan: dict = {}
        timed = set(timed_words(a))
        tap = [i for i in range(1, len(words) + 1) if i in timed]
        if len(tap) >= 2:
            plan["tap-word"] = {"words": tap}
        why = []
        for i, w in enumerate(words, 1):
            if w["case"]["state"] not in SORT_BINS:
                continue
            cands: list[str] = []
            src: dict[str, str] = {}
            for p in pool:
                if p["case"]["state"] != w["case"]["state"] and p["why"] != w["why"] and p["why"] not in src:
                    src[p["why"]] = p["loc"]
                    cands.append(p["why"])
            picked = seeded_shuffle(cands, w["loc"])[:2]
            if picked:
                why.append({"word": i, "distractors": [src[x] for x in picked]})
        if why:
            plan["why-harakat"] = why
        sort = [i for i, w in enumerate(words, 1) if w["case"]["state"] in SORT_BINS]
        if len(sort) >= 2:
            plan["sort-case"] = {"words": sort, "bins": list(SORT_BINS)}
        role = []
        for i, w in enumerate(words, 1):
            if not w.get("role"):
                continue
            cands, src = [], {}
            for p in pool:
                r = p.get("role")
                if r and r != w["role"] and r not in src:
                    src[r] = p["loc"]
                    cands.append(r)
            picked = seeded_shuffle(cands, w["loc"])[:3]
            if picked:
                role.append({"word": i, "distractors": [src[x] for x in picked]})
        if len(role) >= 2:
            plan["label-role"] = role
        wazn, tables = [], []
        for lid in dict.fromkeys(w.get("lemma_id") for w in words if w.get("lemma_id")):
            forms = ((lex.get(lid) or {}).get("tashrif") or {}).get("forms") or []
            if len(forms) < 3:
                continue
            table = [(f["label"], f["ar"]) for f in forms]
            if table in tables:
                continue  # rahman and rahim share one table: never the same questions twice
            tables.append(table)
            for f in forms:
                others = list(dict.fromkeys(o["ar"] for o in forms if o["ar"] != f["ar"]))
                picked = seeded_shuffle(others, f"{lid}/{f['label']}")[:2]
                labels = [f["label"]] + [next(o["label"] for o in forms if o["ar"] == x) for x in picked]
                wazn.append({"lexeme": lid, "label": f["label"], "options": labels})
        if len(wazn) >= 2:
            plan["wazn-factory"] = wazn
        out[str(a["ayah"])] = plan
    return {"ayat": out}


# ------------------------------------------------------------------ resolving a plan
def load_authored(slug: str) -> dict | None:
    p = AUTHORED_DIR / f"{slug}.quiz.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def build(lesson: dict, library: dict, terms: Terms, authored: dict | None) -> dict:
    """content/quiz/<slug>.json from the plan (authored, or mechanical without one)."""
    plan = authored if authored is not None else mechanical_plan(lesson, library)
    lex = {x["id"]: x for x in library["lexicon"]}
    slug = lesson["slug"]
    ayat_out = []
    states_used: set[str] = set()
    labels_used: dict[str, str] = {}
    known = {str(a["ayah"]) for a in lesson["ayat"]}
    quran = lesson.get("quran") or {}
    segments = lesson.get("segments") or {}

    def shown(w: dict, key: str) -> str:
        """A word's why / role / sign as the question shows it: from its marked twin when the lesson
        is marked (terms and Qur'anic words in Arabic), else the plain text with its terms'."""
        mk = (w.get("marked") or {}).get(key)
        return terms.annotate_marked(mk, quran, segments) if mk else terms.annotate(w["case"]["sign"] if key == "sign" else w[key])
    for k in (plan.get("ayat") or {}):
        if k not in known:
            raise QuizError(f"{slug}: the plan names ayah {k}, which the lesson does not have")
    for a in lesson["ayat"]:
        n = a["ayah"]
        words = a["words"]
        spec = (plan.get("ayat") or {}).get(str(n)) or {}
        unknown = set(spec) - set(EXERCISE_KEYS)
        if unknown:
            raise QuizError(f"{slug} {n}: unknown exercise(s) {sorted(unknown)}")

        def word(i: int, what: str) -> dict:
            if not isinstance(i, int) or not 0 < i <= len(words):
                raise QuizError(f"{slug} {n} {what}: word {i!r} is not a word of the ayah")
            return words[i - 1]

        exercises = []
        for key in EXERCISE_KEYS:
            if key not in spec:
                continue
            s = spec[key]
            qs: list[dict] = []
            ex: dict = {"key": key}
            if key == "tap-word":
                for q, i in enumerate(s["words"], 1):
                    word(i, key)
                    qs.append({"n": q, "word": i})
            elif key == "why-harakat":
                for q, item in enumerate(s, 1):
                    w = word(item["word"], key)
                    states_used.add(w["case"]["state"])
                    options = [{"from": w["loc"], "text": shown(w, "why")}]
                    for loc in item["distractors"]:
                        options.append({"from": loc, "text": shown(word_at(lesson, loc), "why")})
                    sign = w["case"]["sign"]
                    qs.append({"n": q, "word": item["word"], "sign": shown(w, "sign") if sign != "—" else None,
                               "why": shown(w, "why"), "options": options})
            elif key == "sort-case":
                bins = list(s.get("bins") or [])
                ex["bins"] = bins
                states_used.update(bins)
                for q, i in enumerate(s["words"], 1):
                    w = word(i, key)
                    states_used.add(w["case"]["state"])
                    sign = w["case"]["sign"]
                    qs.append({"n": q, "word": i, "sign": shown(w, "sign") if sign != "—" else None,
                               "why": shown(w, "why")})
            elif key == "label-role":
                for q, item in enumerate(s, 1):
                    w = word(item["word"], key)
                    if not w.get("role"):
                        raise QuizError(f"{slug} {n} {key}: word {item['word']} has no role")
                    options = [{"from": w["loc"], "text": shown(w, "role")}]
                    for loc in item["distractors"]:
                        r = word_at(lesson, loc).get("role")
                        if not r:
                            raise QuizError(f"{slug} {n} {key}: {loc} has no role to offer")
                        options.append({"from": loc, "text": shown(word_at(lesson, loc), "role")})
                    qs.append({"n": q, "word": item["word"], "why": shown(w, "why"), "options": options})
            elif key == "wazn-factory":
                for q, item in enumerate(s, 1):
                    lx = lex.get(item["lexeme"])
                    forms = {f["label"]: f["ar"] for f in ((lx or {}).get("tashrif") or {}).get("forms") or []}
                    if not forms:
                        raise QuizError(f"{slug} {n} {key}: lexeme {item['lexeme']!r} has no tashrif table")
                    opts = list(item.get("options") or [])
                    for lab in [item["label"], *opts]:
                        if lab not in forms:
                            raise QuizError(f"{slug} {n} {key}: {item['lexeme']} has no form {lab!r}")
                        labels_used[lab] = terms.annotate(lab)
                    if item["label"] in opts:
                        opts.remove(item["label"])
                    qs.append({"n": q, "lexeme": item["lexeme"], "label": item["label"], "options": [item["label"], *opts]})
            ex["questions"] = qs
            exercises.append(ex)
        ayat_out.append({"ayah": n, "exercises": exercises})
    return {
        "version": QUIZ_VERSION,
        "slug": slug,
        "authored": authored is not None,
        "states": {st: terms.label(STATE_TERM[st]) for st in sorted(states_used, key=SORT_BINS.index)
                   if st in STATE_TERM and STATE_TERM[st] in terms.by_id},
        "labels": dict(sorted(labels_used.items())),
        "ayat": ayat_out,
    }


def dump(content: dict) -> str:
    return json.dumps(content, ensure_ascii=False, indent=1) + "\n"


def load_content(slug: str) -> dict | None:
    p = QUIZ_DIR / f"{slug}.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def load_all_content() -> dict[str, dict]:
    return {sp.slug: c for sp in SURAHS if (c := load_content(sp.slug)) is not None}


def ayah_plan(quiz: dict | None, ayah: int) -> list[dict]:
    """The exercises (with their questions) of one ayah, in page order."""
    for a in (quiz or {}).get("ayat") or []:
        if a.get("ayah") == ayah:
            return list(a.get("exercises") or [])
    return []


def question_counts(quiz: dict | None, ayah: int) -> dict[str, int]:
    return {ex["key"]: len(ex.get("questions") or []) for ex in ayah_plan(quiz, ayah)}


# ------------------------------------------------------------------ TAUGHT and REQUIRED
def _sentence_start(text: str, i: int) -> bool:
    before = text[:i].rstrip()
    return not before or before[-1] in ".!?:;"


_AR_BRACKET = re.compile(r" \([^()]*[؀-ۿ][^()]*\)")


def teaching_lines(manifest: dict, slug: str) -> list[tuple[int, str, str, str]]:
    """(ayah, line id, part, caption) of every narration line a lesson plays before its exercises,
    split parts joined, in manifest order."""
    rx = re.compile(rf"^{re.escape(slug)}:(\d+):({TEACHING_PART.pattern})(?::[a-z])?$")
    out: dict[str, tuple[int, str, str]] = {}
    for lid, line in (manifest.get("lines") or {}).items():
        m = rx.match(lid)
        if not m or not isinstance(line, dict):
            continue
        base = f"{slug}:{m.group(1)}:{m.group(2)}"
        prev = out.get(base)
        text = str(line.get("display") or "")
        out[base] = (int(m.group(1)), m.group(2), f"{prev[2]} {text}" if prev else text)
    return [(a, lid, part, text) for lid, (a, part, text) in out.items()]


def defined_terms(part: str, display: str, terms: Terms) -> list[tuple[str, str]]:
    """(term id, how) for each term this line NAMES or DEFINES (module docstring)."""
    out: list[tuple[str, str]] = []
    concept = part.startswith("concept:")
    title_end = -1
    if concept and display.startswith(CONCEPT_LEAD):
        m = re.search(r"[.!?][”\"]?\s+(?=\S)", display[len(CONCEPT_LEAD):])
        title_end = len(CONCEPT_LEAD) + (m.start() if m else len(display) - len(CONCEPT_LEAD))
    plain = {(a, b) for a, b, _t in terms.matches(display)}
    for a, b, tid in terms.matches(display, ambiguous=concept):
        if concept and a < title_end:
            out.append((tid, "the concept's title"))
            continue
        if (a, b) not in plain:
            continue  # an ordinary word (huruf, sifat …) outside a concept's title
        # What follows the term once its own "(Arabic)" is skipped: "Fathah (فَتْحَة) adalah …".
        tail = _AR_BRACKET.sub("", display[b:], count=1) if display[b:b + 2] == " (" else display[b:]
        if re.match(r",?\s+adalah\b", tail) and _sentence_start(display, a):
            out.append((tid, "“… adalah”"))
        elif re.search(r"\b(?:disebut|menyebutnya)(?: sebagai)?\s+$", display[:a]):
            out.append((tid, "“disebut …”"))
        elif concept and re.search(r"\w, atau $", display[:a]):
            out.append((tid, "“…, atau <term>”"))
    return out


def taught(manifest: dict, lesson: dict, terms: Terms) -> dict[int, dict[str, str]]:
    """ayah → {term id: the line that first taught it (by that ayah's end)}, cumulative."""
    first: dict[str, tuple[int, str]] = {}
    for a, lid, part, text in teaching_lines(manifest, lesson["slug"]):
        for tid, how in defined_terms(part, text, terms):
            if tid not in first or first[tid][0] > a:
                first[tid] = (a, f"{lid} ({how})")
    out = {}
    for ay in lesson["ayat"]:
        n = ay["ayah"]
        out[n] = {tid: where for tid, (a, where) in first.items() if a <= n}
    return out


def required(ex: dict, q: dict, lesson: dict, ayah: dict, terms: Terms, quiz: dict) -> dict[str, str]:
    """{term id: what in the question needs it}: the answer's case state and sign (why-harakat),
    every bin (sort-case), every term an option's text names, every form label (wazn-factory)."""
    need: dict[str, str] = {}

    def add(text: str | None, what: str) -> None:
        for tid in sorted(terms.ids(text or "")):
            need.setdefault(tid, what)

    key = ex["key"]
    if key in ("why-harakat", "sort-case"):
        w = ayah["words"][q["word"] - 1]
        st = STATE_TERM.get(w["case"]["state"])
        if st:
            need.setdefault(st, f"the answer's case state ({w['case']['state']})")
        if key == "why-harakat":
            add(w["case"]["sign"], "the sign shown with the question")
    if key == "sort-case":
        for b in ex.get("bins") or []:
            if STATE_TERM.get(b):
                need.setdefault(STATE_TERM[b], f"the bin {b}")
    for o in q.get("options") or []:
        if isinstance(o, dict):
            add(o["text"], f"option from {o['from']}")
        else:
            add(o, f"form label {o!r}")
    if key == "wazn-factory":
        add(q["label"], f"the asked form {q['label']!r}")
    return need


# ------------------------------------------------------------------ the checks
def plan_problems(quiz: dict, lesson: dict, library: dict, terms: Terms, manifest: dict | None) -> list[str]:
    """Every rule of the module docstring; the taught check needs the narration manifest."""
    errs: list[str] = []
    slug = lesson["slug"]
    lex = {x["id"]: x for x in library["lexicon"]}
    authored = bool(quiz.get("authored"))
    taught_at = taught(manifest, lesson, terms) if (authored and manifest is not None) else None
    for a in lesson["ayat"]:
        n = a["ayah"]
        words = a["words"]
        where0 = f"{slug} {n}"
        exs = ayah_plan(quiz, n)
        keys = [e["key"] for e in exs]
        if keys != [k for k in EXERCISE_KEYS if k in keys] or len(set(keys)) != len(keys):
            errs.append(f"{where0}: exercises {keys} are not in page order, or one repeats")
        for ex in exs:
            key = ex["key"]
            qs = ex.get("questions") or []
            where = f"{where0} {key}"
            if not qs:
                errs.append(f"{where}: no questions")
            if [q.get("n") for q in qs] != list(range(1, len(qs) + 1)):
                errs.append(f"{where}: questions must be numbered 1, 2, …")
            if key == "tap-word":
                timed = set(timed_words(a))
                if len(qs) < 2:
                    errs.append(f"{where}: fewer than two words")
                for q in qs:
                    if q["word"] not in timed:
                        errs.append(f"{where} q{q['n']}: word {q['word']} has no timing in the ayah's recitation")
            if key in ("why-harakat", "label-role"):
                for q in qs:
                    w = words[q["word"] - 1]
                    opts = q.get("options") or []
                    if not opts or opts[0]["from"] != w["loc"]:
                        errs.append(f"{where} q{q['n']}: the first option must be the answer, from {w['loc']}")
                    texts = [o["text"] for o in opts]
                    if len(set(texts)) != len(texts) or len({o["from"] for o in opts}) != len(opts):
                        errs.append(f"{where} q{q['n']}: two options are the same")
                    if len(opts) < 2:
                        errs.append(f"{where} q{q['n']}: no wrong option")
                    for o in opts[1:]:
                        if ayah_of(o["from"]) > n:
                            errs.append(f"{where} q{q['n']}: option from {o['from']}, an ayah not studied yet")
                    if key == "why-harakat" and w["case"]["state"] not in SORT_BINS:
                        errs.append(f"{where} q{q['n']}: word {q['word']} has no case ending to ask about ({w['case']['state']})")
                    if not authored:
                        continue
                    if key == "why-harakat":
                        classes = [cause_class(word_at(lesson, o["from"])["why"], terms, after_karena=True) for o in opts]
                        if None in classes:
                            errs.append(f"{where} q{q['n']}: no cause named in {opts[classes.index(None)]['from']}'s reason")
                        elif len(set(classes)) != len(classes):
                            errs.append(f"{where} q{q['n']}: two options give the same cause {classes} — "
                                        "a wrong option must differ in cause, not only in wording")
                    else:
                        ans = term_classes(w["role"], terms)
                        for o in opts[1:]:
                            share = ans & term_classes(word_at(lesson, o["from"])["role"], terms)
                            if share:
                                errs.append(f"{where} q{q['n']}: option from {o['from']} shares {sorted(share)} with the "
                                            "answer — it would be partly true (two correct options)")
            if key == "sort-case":
                bins = ex.get("bins") or []
                if len(set(bins)) != len(bins) or not set(bins) <= set(SORT_BINS) or len(bins) < 2:
                    errs.append(f"{where}: bins {bins} must be two or more distinct states of {list(SORT_BINS)}")
                states = set()
                for q in qs:
                    st = words[q["word"] - 1]["case"]["state"]
                    states.add(st)
                    if st not in bins:
                        errs.append(f"{where} q{q['n']}: word {q['word']} is {st}, not one of the bins {bins}")
                if authored and len(states) < 2:
                    errs.append(f"{where}: every word is {sorted(states)} — nothing to sort")
            if key == "wazn-factory":
                lemmas = {w.get("lemma_id") for w in words}
                for q in qs:
                    forms = {f["label"]: f["ar"] for f in ((lex.get(q["lexeme"]) or {}).get("tashrif") or {}).get("forms") or []}
                    opts = q.get("options") or []
                    if q["lexeme"] not in lemmas:
                        errs.append(f"{where} q{q['n']}: {q['lexeme']} is not the lemma of a word of this ayah")
                    if not opts or opts[0] != q["label"]:
                        errs.append(f"{where} q{q['n']}: the first option must be the asked form {q['label']!r}")
                    if len(opts) < 2 or len(set(opts)) != len(opts) or any(o not in forms for o in opts):
                        errs.append(f"{where} q{q['n']}: options {opts} must be two or more distinct forms of {q['lexeme']}")
                    elif len({forms[o] for o in opts}) != len(opts):
                        errs.append(f"{where} q{q['n']}: two options are the same Arabic form (two correct options)")
            if taught_at is None:
                continue
            for q in qs:
                for tid, what in required(ex, q, lesson, a, terms, quiz).items():
                    if tid not in taught_at[n]:
                        later = next((m for m in sorted(taught_at) if tid in taught_at[m]), None)
                        errs.append(f"{where} q{q['n']}: needs {terms.by_id[tid]['latin']!r} ({what}), not taught by the end "
                                    f"of ayah {n}" + (f" (first taught in ayah {later})" if later else " (never taught)"))
    return errs
