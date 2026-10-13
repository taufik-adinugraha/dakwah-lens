"""The basic curriculum: WHERE each topic of the Qur'anic Arabic course is taught (stdlib only).

Operator, 2026-10-13 (docs/belajar-research/kurikulum-dasar.md, decisions 1-9; plan L26): "this is
my plan, we will not cover all ayat in quran: we only cover alfatihah, 3qul, ayat qursi … we
distribute the lessons into these ayats" — "let's focus on the basic first for those ayats/surahs,
the more advanced ones reserved for later" — "agree" (to the distribution: at most three new steps
per lesson, no term before the lesson that teaches it) — "next ayat, should review pervious lesson
if exist in that ayat" — "so the knowledge is accummulating and repeated" — "but separate new vs
already knows concept, this is what new, this is what we've learnt so far".

Until then a Konsep was introduced in the ayah of its FIRST EXAMPLE, a rule written three times
(validate_narration.introduced_concepts, lessonmap.taught_at, src/lib/library.ts
conceptsIntroducedIn); it put 5, 3, 1, 1, 8, 2, 6 new concepts on the seven ayat of Al-Fatihah.
Now ONE authored file says where a topic is taught, authored/curriculum.json, and everything else
is derived from it here: the "Konsep baru" lines a lesson says, what an ayah's card lists as new,
already learnt, taught later and next-level, and the check that no line uses a term before its
lesson. src/lib/curriculum.ts is the twin of the derivation (curriculum.test.ts compares the two
on every lesson).

THE AUTHORED FILE (its own `_comment` has the full account):

  units    the lesson zero and the five units, in teaching order;
  lessons  every lesson in teaching order: "0" (the lesson with no ayah, decision 1), "S:A" (an
           ayah), "S:A/N" (segment N of a long ayah, with `words`: its first and last word);
  steps    the new steps, each taught in exactly one lesson, at most MAX_STEPS per lesson, listed
           in the order their lines are said. A step is taught from
             a whole Konsep record   `concept`, no `part`: the record's own title and summary;
             its own text            `teach` {title, summary, sources}: a PART of a record that
                                     arrives in several steps (`concept` + `part`: i'rab is majrur,
                                     marfu', manshub, majzum), or a step with no record (alif lam);
             a Dasar membaca record  `basics` (the harakat primer);
             nothing yet             none of these: the step is not written, and its lesson cannot
                                     be switched on (a lesson map) before it has a sourced text;
  free     dictionary terms any lesson may use;
  lanjut   the Konsep records of the next level ("tingkat lanjut", decision 6): a basic lesson
           names such a topic on its card and never teaches it.

WHAT IS DERIVED (`derive`), per lesson whose ayah is on disk ("written"):

  new      the lesson's steps, in the order listed;
  learnt   EVERY step of every earlier lesson, in teaching order, each with `here`: whether it
           occurs in this ayah (decision 9: "learnt so far" is cumulative; decision 8: the ones that
           occur here are the ones reviewed);
  later    the steps of later lessons that occur in this ayah, in teaching order;
  lanjut   the next-level records tagged on this ayah (words' concept tags, structure groups),
           in the library's order;
  lines    the "Konsep baru" lines the lesson says, one per step that has a text, in the order
           listed, each with the words of the ayah it lights.

"Earlier" and "later" are places in the CURRICULUM's lesson order (An-Nas before Al-Falaq before
Al-Ikhlas, decision 2), never mushaf order.

WHERE A STEP OCCURS (`occurs`), in the words of one ayah:

  occurs {case: s}   the words whose case.state is s (a part of the i'rab record);
  occurs {qac: T}    the words with a QAC 0.4 segment tagged T, read from the QAC line build_surah.py
                     writes into every word's `sources` ("… kelas kata: DET|PREFIX|Al+ + ADJ|STEM|…":
                     the first field of each segment) — the lesson content already carries it, so
                     nothing here needs pipeline/cache;
  occurs {always}    every word (the three kinds of word: every word is one of them);
  a whole record     without `occurs`: the words tagged with its record, and the words of the ayah's
                     structure groups of that record (validate_narration.concept_words);
  a basics step      nowhere: the harakat are on every letter, and marking them "here" in every
                     ayah would say nothing;
  anything else      nowhere yet (a step with no record and no `occurs`).

THE BUILT FILE, content/curriculum.json (build_curriculum.py; what the web app and the other
builders read — they never read the authored file):

    {"version": 1,
     "units":   [{"id", "name", "surah"?, "ayah"?, "slug"?}],
     "lessons": [{"id", "unit", "surah"?, "ayah"?, "segment"?, "words"?, "steps": [step id…],
                  "before": n, "after": n,                  # steps learnt before / after this lesson
                  # a written lesson only:
                  "lines": [{"line": "concept:majrur", "step": "majrur", "words": [1, 2, 3, 4]}],
                  "map": {"new": [id…], "learnt": [{"id", "here"}…], "later": [id…], "lanjut": [record id…]}}],
     "steps":   [{"id", "lesson", "name", "latin", "concept"?, "part"?, "basics"?, "occurs"?,
                  "line": "concept:…" | null, "teach"?: {"title", "summary", "marked": {"title",
                  "summary"}, "sources"}, "terms": [term id…]}],
     "free": [term id…], "lanjut": [record id…]}

A step's `name` is its caption form (dictionary terms with their Arabic, "Majrur (مَجْرُور)") and
`latin` the same name as prose, built the way a lesson map's names are (build_curriculum.Namer:
the narration's own sanitiser and pronunciation dictionary). `line` is the part of the narration
line that teaches it: "concept:<record id>" for a whole record (so a line whose text did not
change keeps its audio), "concept:<step id>" for a step with its own text, null for a step with
no text of its own.

NO TERM BEFORE ITS LESSON (decision 7; `term_home`, `pending_problems`). A dictionary term
(authored/library.terms.json) is owned by at most one step, or is free, or belongs to the next
level. A lesson line may use a term only from the lesson that teaches it on. What the lessons
written before the curriculum still say too early is listed in authored/curriculum.pending.json
— {"lines": {narration line id: [term id…]}, "quiz": {"<slug>:<ayah>:<exercise>:<n>": [term
id…]}} — and held both ways: a violation that is not listed fails, and a listed entry that no
longer violates fails as stale. The file is meant to shrink to empty as the prose is rewritten,
the check running strictly all the while (build_narration.py --write-pending writes it).
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from common import AUTHORED_DIR, CONTENT_DIR, SURAH_BY_NUM

AUTHORED_JSON = AUTHORED_DIR / "curriculum.json"
PENDING_JSON = AUTHORED_DIR / "curriculum.pending.json"
CONTENT_JSON = CONTENT_DIR / "curriculum.json"
VERSION = 1
# Decision 7: "At most three new steps per lesson."
MAX_STEPS = 3
ZERO = "0"  # the lesson with no ayah (decision 1)
# "0" · "S:A" · "S:A/N"
LESSON = re.compile(r"^(?:0|(?P<surah>[1-9]\d{0,2}):(?P<ayah>[1-9]\d{0,2})(?:/(?P<segment>[1-9]\d?))?)$")
ID = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
# The states a word's case.state can name (src/content/schema.ts CaseState, without "mabni": a
# mabni word shows no i'rab state).
CASE_STATES = ("marfu", "manshub", "majrur", "majzum")
QAC_TAG = re.compile(r"^[A-Z]+$")
QAC_KITAB = "Quranic Arabic Corpus"
_QAC_LINE = re.compile(r"kelas kata: (.+)$")
NEXT_LEVEL = "tingkat lanjut"  # where a term no step owns is taught


class CurriculumError(Exception):
    """A curriculum that cannot be built or read (a broken id, a step without its lesson)."""


# ------------------------------------------------------------------ files
def load_authored(path: Path = AUTHORED_JSON) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def load_content(path: Path = CONTENT_JSON) -> dict | None:
    """content/curriculum.json, or None before build_curriculum.py has run."""
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def dump(content: dict) -> str:
    return json.dumps(content, ensure_ascii=False, indent=1) + "\n"


# ------------------------------------------------------------------ lessons and their order
def place(lesson_id: str) -> tuple[int | None, int | None, int | None]:
    """(surah, ayah, segment) of a lesson id; (None, None, None) for the lesson with no ayah."""
    m = LESSON.match(lesson_id) if isinstance(lesson_id, str) else None
    if not m:
        raise CurriculumError(f"lesson id {lesson_id!r} is not \"0\", \"S:A\" or \"S:A/N\"")
    if m.group("surah") is None:
        return None, None, None
    return int(m.group("surah")), int(m.group("ayah")), int(m.group("segment")) if m.group("segment") else None


def ayah_lesson(surah: int, ayah: int) -> str:
    """The lesson id of a whole ayah."""
    return f"{surah}:{ayah}"


def ranks(cur: dict) -> dict[str, int]:
    """lesson id → its place in the teaching order (the authored file's, or the built file's)."""
    return {l["id"]: i for i, l in enumerate(cur.get("lessons") or []) if isinstance(l, dict) and isinstance(l.get("id"), str)}


def lesson_of(cur: dict | None, lesson_id: str) -> dict | None:
    for l in (cur or {}).get("lessons") or []:
        if isinstance(l, dict) and l.get("id") == lesson_id:
            return l
    return None


def steps_of(cur: dict, lesson_id: str) -> list[dict]:
    """The steps a lesson teaches, in the order their lines are said (the order listed)."""
    return [s for s in cur.get("steps") or [] if isinstance(s, dict) and s.get("lesson") == lesson_id]


def step_of(cur: dict | None, step_id: str) -> dict | None:
    for s in (cur or {}).get("steps") or []:
        if isinstance(s, dict) and s.get("id") == step_id:
            return s
    return None


def in_teaching_order(cur: dict) -> list[dict]:
    """Every step, by its lesson's place and then the order listed (a stable sort: the authored
    file lists them that way already, and validate_curriculum.py says so when it does not)."""
    rank = ranks(cur)
    steps = [s for s in cur.get("steps") or [] if isinstance(s, dict)]
    return sorted(steps, key=lambda s: rank.get(s.get("lesson"), len(rank)))


# ------------------------------------------------------------------ how a step is taught
def kind(step: dict) -> str | None:
    """"teach": the step's own text (a part of a record, or no record); "record": a whole Konsep
    record's title and summary; "basics": a Dasar membaca record (the harakat primer, which has
    lines of its own, not a "Konsep baru" line); None: not written yet."""
    if isinstance(step.get("teach"), dict):
        return "teach"
    if step.get("concept") and "part" not in step:
        return "record"
    if step.get("basics"):
        return "basics"
    return None


def line_part(step: dict) -> str | None:
    """The part of the narration line id that teaches the step ("<slug>:<ayah>:<part>"): the
    record's id for a whole record — the id its line had before the curriculum, so an unchanged
    text keeps its audio — and the step's own id for a step with its own text; None for a step
    with no "Konsep baru" text (the harakat primer, a step not written yet)."""
    k = kind(step)
    if k == "record":
        return f"concept:{step['concept']}"
    return f"concept:{step['id']}" if k == "teach" else None


def teachable(step: dict) -> bool:
    """Can a lesson teach the step today: it has a text (or is the harakat primer)."""
    return kind(step) is not None


# ------------------------------------------------------------------ where a step occurs
def qac_tags(word: dict) -> list[str]:
    """The QAC 0.4 segment tags of a lesson word, in order (DET, N, P, V, PRON …): the first field
    of each segment in the QAC line of its `sources`. [] for a word without that line."""
    for src in word.get("sources") or []:
        if isinstance(src, dict) and str(src.get("kitab", "")).startswith(QAC_KITAB):
            m = _QAC_LINE.search(str(src.get("ref", "")))
            if m:
                return [seg.split("|", 1)[0] for seg in m.group(1).split(" + ")]
    return []


def record_words(ayah: dict, record: str) -> list[int]:
    """The words of an ayah that carry a Konsep record: tagged with it, or in a structure group of
    it (validate_narration.concept_words, src/lib/autoplay/sequence.ts kindHighlight)."""
    n = len(ayah.get("words") or [])
    out = {i for i, w in enumerate(ayah.get("words") or [], 1) if record in (w.get("concepts") or [])}
    for g in (ayah.get("structure") or {}).get("groups") or []:
        if g.get("concept") == record:
            out |= {x for x in g.get("words") or [] if isinstance(x, int) and not isinstance(x, bool) and 1 <= x <= n}
    return sorted(out)


def occurs(step: dict, ayah: dict) -> list[int]:
    """The words (1-based) of `ayah` the step occurs on (module docstring, "WHERE A STEP OCCURS")."""
    words = ayah.get("words") or []
    rule = step.get("occurs")
    if step.get("basics"):
        return []
    if isinstance(rule, dict):
        if rule.get("always") is True:
            return list(range(1, len(words) + 1))
        if "case" in rule:
            return [i for i, w in enumerate(words, 1) if (w.get("case") or {}).get("state") == rule["case"]]
        if "qac" in rule:
            return [i for i, w in enumerate(words, 1) if rule["qac"] in qac_tags(w)]
        return []
    if step.get("concept") and "part" not in step:
        return record_words(ayah, step["concept"])
    return []


def tagged(ayah: dict) -> list[str]:
    """The Konsep record ids an ayah carries, in the order it meets them: its words' tags, then
    the ones only a structure group names."""
    out: list[str] = []
    for w in ayah.get("words") or []:
        out += [c for c in w.get("concepts") or [] if c not in out]
    for g in (ayah.get("structure") or {}).get("groups") or []:
        c = g.get("concept")
        if c and c not in out:
            out.append(c)
    return out


# ------------------------------------------------------------------ the derivation
def written(cur: dict, lessons: dict[str, dict]) -> dict[str, tuple[dict, dict]]:
    """lesson id → (the surah's lesson content, the ayah) for every lesson whose ayah is on disk
    (`lessons`: content/<slug>.json by slug). The lesson with no ayah and the segments of a long
    ayah have no content yet."""
    out: dict[str, tuple[dict, dict]] = {}
    for l in cur.get("lessons") or []:
        surah, ayah, segment = place(l["id"])
        spec = SURAH_BY_NUM.get(surah) if surah is not None and segment is None else None
        content = lessons.get(spec.slug) if spec else None
        for a in (content or {}).get("ayat") or []:
            if a.get("ayah") == ayah:
                out[l["id"]] = (content, a)
    return out


def derive(cur: dict, lessons: dict[str, dict], library: dict) -> dict[str, dict]:
    """lesson id → {"lines", "map": {new, learnt, later, lanjut}} for every written lesson (module
    docstring, "WHAT IS DERIVED"). `cur`: the authored curriculum (or the built one: both list
    `lessons`, `steps` and `lanjut` the same way)."""
    rank = ranks(cur)
    steps = in_teaching_order(cur)
    for s in steps:
        if s.get("lesson") not in rank:
            raise CurriculumError(f"step {s.get('id')!r} is taught in lesson {s.get('lesson')!r}, which is not a lesson")
    next_level = set(cur.get("lanjut") or [])
    out: dict[str, dict] = {}
    for lid, (_content, a) in written(cur, lessons).items():
        here = rank[lid]
        own = [s for s in steps if s["lesson"] == lid]
        carried = set(tagged(a))
        out[lid] = {
            "lines": [{"line": line_part(s), "step": s["id"], "words": occurs(s, a)} for s in own if line_part(s)],
            "map": {
                "new": [s["id"] for s in own],
                "learnt": [{"id": s["id"], "here": bool(occurs(s, a))} for s in steps if rank[s["lesson"]] < here],
                "later": [s["id"] for s in steps if rank[s["lesson"]] > here and occurs(s, a)],
                "lanjut": [c["id"] for c in library.get("concepts") or [] if c["id"] in next_level and c["id"] in carried],
            },
        }
    return out


def lesson_entry(content: dict | None, surah: int, ayah: int) -> dict | None:
    """The built file's lesson of a whole ayah, or None (no curriculum file, or no such lesson)."""
    return lesson_of(content, ayah_lesson(surah, ayah))


def lesson_lines(content: dict | None, surah: int, ayah: int) -> list[dict]:
    """[{line, step, words}] — the "Konsep baru" lines the lesson of this ayah says, in order."""
    return list((lesson_entry(content, surah, ayah) or {}).get("lines") or [])


def taught_text(content: dict, library: dict, step_id: str) -> tuple[str, str] | None:
    """(title, summary) of a step's "Konsep baru" line, as plain prose: its own text, or its whole
    record's; None for a step with no such line."""
    s = step_of(content, step_id)
    if not s or not s.get("line"):
        return None
    if isinstance(s.get("teach"), dict):
        return s["teach"]["title"], s["teach"]["summary"]
    rec = next((c for c in library.get("concepts") or [] if c.get("id") == s.get("concept")), None)
    return (rec["title"], rec["summary"]) if rec else None


# ------------------------------------------------------------------ who owns a term
def owners(cur: dict) -> dict[str, str]:
    """term id → the step that teaches it (the first one listed: a term in two steps is the
    validator's finding)."""
    out: dict[str, str] = {}
    for s in in_teaching_order(cur):
        for t in s.get("terms") or []:
            out.setdefault(t, s["id"])
    return out


def term_home(cur: dict, term: str) -> str | None:
    """Where a dictionary term is taught: its step's lesson id ("1:4"), NEXT_LEVEL for a term no
    step owns, None for a free term (any lesson may use it)."""
    if term in (cur.get("free") or []):
        return None
    step = step_of(cur, owners(cur).get(term, ""))
    return step["lesson"] if step else NEXT_LEVEL


def too_early(cur: dict, lesson_id: str, terms: list[str], *, allowed: set[str] | frozenset[str] = frozenset()) -> list[str]:
    """The terms of `terms` a line of lesson `lesson_id` may not use yet (decision 7): owned by a
    step of a later lesson, or by no step (the next level). In order of first use, each once.
    `allowed`: the terms this one line may name all the same (the steps a "taught later" line
    announces)."""
    rank = ranks(cur)
    here = rank.get(lesson_id)
    out: list[str] = []
    for t in terms:
        if t in out or t in allowed:
            continue
        home = term_home(cur, t)
        if home is None:
            continue
        if home == NEXT_LEVEL or here is None or rank[home] > here:
            out.append(t)
    return out


# ------------------------------------------------------------------ the tolerated list
def load_pending(path: Path = PENDING_JSON) -> dict:
    """authored/curriculum.pending.json as {"lines": {…}, "quiz": {…}}; both empty without a file."""
    data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    return {"lines": dict(data.get("lines") or {}), "quiz": dict(data.get("quiz") or {})}


PENDING_COMMENT = (
    "TOLERATED FOR NOW: what the lessons written before the basic curriculum (authored/curriculum.json, operator-approved "
    "2026-10-13; docs/belajar-research/kurikulum-dasar.md decision 7: 'No lesson line may use a term before the lesson that "
    "teaches it') still say too early. `lines`: narration line id -> the dictionary terms (authored/library.terms.json ids) "
    "its prose uses although their step is taught in a later lesson, or in none (tingkat lanjut). `quiz`: "
    "'<slug>:<ayah>:<exercise>:<question number>' -> the terms that question needs although the lesson has not TAUGHT them "
    "by that ayah (quiz.py, TAUGHT ⊇ REQUIRED: a term's lesson moved later). Held BOTH ways by build_narration.py / "
    "validate_narration.py (lines) and validate_quiz.py (quiz): a violation that is not listed here fails, and an entry "
    "that no longer violates fails as stale ('remove it'). NEVER add an entry by hand to make a new line pass: rewrite the "
    "line. This file only shrinks — `python3 build_narration.py --write-pending` rewrites it from what the checks find "
    "(use it to drop the entries a rewrite has cleared), and it must end as {\"lines\": {}, \"quiz\": {}}."
)


def dump_pending(lines: dict[str, list[str]], quiz: dict[str, list[str]]) -> str:
    """The file's text: the comment, then both lists in a stable order (lesson order is the
    caller's; ids are written as given)."""
    return json.dumps({"_comment": PENDING_COMMENT, "lines": lines, "quiz": quiz}, ensure_ascii=False, indent=1) + "\n"


def pending_problems(what: str, found: dict[str, list[str]], listed: dict[str, list[str]], home) -> list[str]:
    """The rule both ways. `found`: what violates now ({id: [term…]}); `listed`: what the pending
    file tolerates; `home(term)`: where the term is taught, for the message. `what` names the
    thing ("line", "question")."""
    errs = []
    for key, terms in found.items():
        for t in terms:
            if t not in (listed.get(key) or []):
                errs.append(f"{key}: uses the term {t!r} before the lesson that teaches it (taught in {home(t)}) — reword the "
                            f"{what}; decision 7 of the basic curriculum")
    for key, terms in listed.items():
        if not isinstance(terms, list) or not terms:
            errs.append(f"authored/curriculum.pending.json: {key}: an entry lists the terms it tolerates (remove an empty one)")
            continue
        for t in terms:
            if t not in (found.get(key) or []):
                errs.append(f"authored/curriculum.pending.json: {key} no longer uses {t!r} too early (stale): remove it")
    return errs
