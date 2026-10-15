#!/usr/bin/env python3
"""Builds content/curriculum.json — the basic curriculum as the web app and the other builders read
it (curriculum.py has the format and the rules; operator-approved 2026-10-13,
docs/belajar-research/kurikulum-dasar.md, plan L26) — from authored/curriculum.json, the lessons
(content/<slug>.json), content/library.json and the term table; each step's name through the
narration's own sanitiser and pronunciation dictionary. Deterministic, stdlib only, no network, no
LLM. Run from belajar/pipeline, after build_surah.py / build_library.py and BEFORE build_quiz.py,
build_map.py and build_narration.py (the lesson maps and the "Konsep baru" lines read it):

    python3 build_curriculum.py            # write content/curriculum.json
    python3 build_curriculum.py --check    # exit 1 if the file on disk differs from a fresh build
    python3 build_curriculum.py --show     # print the lessons, their steps and the derived lists

A curriculum that breaks a rule of validate_curriculum.py's structural checks writes nothing and
exits 1 (a step in no lesson, a record placed twice, a term with two owners).
"""
from __future__ import annotations

import argparse
import json
import re
import sys

import build_narration as B
import curriculum as CUR
import terms as TERMS
import validate_narration as V
from common import CONTENT_DIR, SURAH_BY_NUM, SURAHS

# A name is a name, not a description (lessonmap.NAME_WORDS, src/lib/emphasis.ts NAME_WORDS).
NAME_WORDS = 4
# How the narration names a Qur'anic word (build_narration.Sanitiser): by its place, or by its meaning.
_PLACES = re.compile(rf"\b[Kk]ata (?:ini|{V.ORDINAL})\b|\b(?:[Kk]ata|[Ff]rasa) yang artinya “")


def load_lessons() -> dict[str, dict]:
    return {sp.slug: json.loads((CONTENT_DIR / f"{sp.slug}.json").read_text(encoding="utf-8"))
            for sp in SURAHS if (CONTENT_DIR / f"{sp.slug}.json").exists()}


class Namer:
    """A step's name as the narration says and shows it: `latin` the prose (folded to plain
    letters, as every narration line is), `name` its caption form — each dictionary term with its
    Arabic, "Majrur (مَجْرُور)" — the way a lesson map's names have always been built.

    A name the narrator may not say is REPORTED, not rewritten (`problems`): one that holds a
    Qur'anic word ("Lam nafi": lam is the first word of Al-Ikhlas 3), is longer than NAME_WORDS
    words, or fails a narration check. build_map.py refuses such a name the moment a lesson map
    would speak it; until then validate_curriculum.py lists it."""

    def __init__(self, lessons: dict[str, dict], lex: V.Lexicon | None = None):
        self.lex = lex or V.load_lexicon()
        self.san = B.Sanitiser(lessons)
        self.sp = B.Speech(self.lex)

    def shown(self, prose: str) -> str:
        return self.sp.shown(self.sp.mark(prose), None)

    def step(self, step: dict) -> tuple[dict, list[str]]:
        """({"name", "latin"}, what keeps the narrator from saying it)."""
        sid, text = step["id"], " ".join(str(step.get("name") or "").split())
        errs: list[str] = []
        try:
            latin = B._cap(self.san.prose(text, 0, 0, strict=f"steps[{sid}] name"))
        except SystemExit as e:
            # The same prose without the stop: what the cards show meanwhile.
            errs.append(str(e))
            latin = B._cap(V.fold(text))
        if len(latin.split()) > NAME_WORDS:
            errs.append(f"steps[{sid}] name: {latin!r} is longer than {NAME_WORDS} words (a description, not a name)")
        marked = self.sp.mark(latin)
        name, said = self.sp.shown(marked, None), self.sp.spoken(marked)
        if not errs:
            errs += (V.check_text(f"steps[{sid}] name", latin, self.san.forms, max_len=None)
                     + V.check_spoken(f"steps[{sid}] name", said, self.san.forms, self.lex)
                     + V.check_display(f"steps[{sid}] name", name, said, self.san.forms, self.lex, None))
        return {"name": name, "latin": latin}, errs

    def quranic_words(self, text: str) -> list[str]:
        """The Qur'anic words a prose text names in transliteration (validate_narration.Forms),
        but for what the narration says in Indonesian anyway: the Name ("Allah", and "lafaz Allah",
        which a line says as lafaz “Allah”), a surah's name after "Surah", and "lam" as the name
        of the letter."""
        t = " ".join(text.split())
        found, toks = self.san.forms.mentions(t)
        bad = []
        for start, end, k, _cands, i, _n in found:
            orig = t[start:end]
            if orig == "Allah":
                continue
            if k in self.san.forms.surah_name_keys and i > 0 and toks[i - 1][0] == "surah":
                continue
            if k == ("lam",) and V._letter_context(toks, i, t):
                continue
            bad.append(orig)
        return bad

    def teach_problems(self, step: dict) -> list[str]:
        """A step's own text is said by the narrator like a record's (the same sanitiser), and it
        is written for that: it names no Qur'anic word, in its title or its summary — nothing
        there has to be turned into a word's place — and what the sanitiser makes of it passes
        the narration's own checks."""
        errs = []
        surah, ayah, _segment = CUR.place(step["lesson"])
        for key in ("title", "summary"):
            text = (step.get("teach") or {}).get(key)
            if not isinstance(text, str) or not text.strip():
                continue
            what = f"steps[{step['id']}] teach.{key}"
            plain = TERMS.strip(text)
            bad = self.quranic_words(plain)
            if bad:
                errs.append(f"{what}: names the Qur'anic word(s) {bad} — a step's own text is said by the narrator, who never "
                            "voices one")
                continue
            try:
                prose = self.san.prose(plain, surah or 0, ayah or 0)
            except SystemExit as e:
                errs.append(f"{what}: {e}")
                continue
            # Said as written: the sanitiser found no word to turn into a place.
            if len(_PLACES.findall(prose)) != len(_PLACES.findall(V.fold(plain))):
                errs.append(f"{what}: the narration would turn a word of it into a word's place (“{prose[:80]}”) — a step's "
                            "own text names no Qur'anic word")
            errs += V.check_text(what, prose, self.san.forms, max_len=None)
        return errs


def teach_record(step: dict, by_id: dict, by_form: dict) -> dict:
    """A step's own text as the app reads it: the plain prose (the narration's input), the marked
    twin with every term named by id (the card's Arabic), and its sources."""
    t = step["teach"]
    return {
        "title": TERMS.strip(t["title"]),
        "summary": TERMS.strip(t["summary"]),
        "marked": {"title": TERMS.explicit(t["title"], by_id, by_form), "summary": TERMS.explicit(t["summary"], by_id, by_form)},
        "sources": [dict(s) for s in t.get("sources") or []],
    }


def about_of(note: str) -> str:
    """A record example's note without the word it opens with ("na‘budu: fi'il, kata kerja." →
    "fi'il, kata kerja."), as plain text — src/lib/autoplay/examples.ts aboutOf, the card's label."""
    plain = TERMS.strip(note)
    i = plain.find(": ")
    return plain[i + 2:].strip() if i > 0 else plain.strip()


def term_card(tid: str, by_id: dict) -> dict:
    """A term on a slide's card: its id, Latin and Arabic (the term table's; never typed here)."""
    t = by_id.get(tid) or {}
    return {"id": tid, "latin": t.get("latin"), "ar": t.get("ar")}


def lead_record(step: dict, by_id: dict) -> dict:
    """A lesson-zero step's slide (curriculum.LEAD_KEYS) as the app reads it: its line's text, the
    cards it shows (each term with the table's Arabic) and its sources."""
    t = step["lead"]
    cards = []
    for c in t.get("cards") or []:
        card = {"lang": c["lang"], "means": c["means"]}
        if c.get("word"):
            card["word"] = c["word"]
        if c.get("term"):
            card["term"] = term_card(c["term"], by_id)
        cards.append(card)
    return {"say": " ".join(t["say"].split()), "cards": cards, "sources": [dict(x) for x in t.get("sources") or []]}


def example_records(step: dict, library: dict) -> list[dict]:
    """A lesson-zero step's examples: each with its line's text and the card's label (`about`,
    from the record's own note on that example)."""
    rec = next((c for c in library.get("concepts") or [] if c.get("id") == step.get("concept")), None) or {}
    notes = {e["loc"]: e.get("note") or "" for e in rec.get("examples") or []}
    return [{"loc": e["loc"], "say": " ".join(e["say"].split()), "about": about_of(notes.get(e["loc"], ""))}
            for e in step.get("examples") or []]


def build(authored: dict, lessons: dict[str, dict], library: dict, table: dict, namer: Namer) -> dict:
    """content/curriculum.json (curriculum.py, "THE BUILT FILE")."""
    by_id, by_form = TERMS.term_index(table)
    rank = CUR.ranks(authored)
    steps = CUR.in_teaching_order(authored)
    derived = CUR.derive(authored, lessons, library)
    units = []
    for u in authored.get("units") or []:
        unit = {k: u[k] for k in ("id", "name", "surah", "ayah") if k in u}
        spec = SURAH_BY_NUM.get(u.get("surah")) if "ayah" not in u else None
        if spec:
            unit["slug"] = spec.slug
        units.append(unit)
    out_lessons = []
    before = 0
    for l in authored.get("lessons") or []:
        surah, ayah, segment = CUR.place(l["id"])
        own = [s["id"] for s in steps if s["lesson"] == l["id"]]
        entry: dict = {"id": l["id"], "unit": l["unit"]}
        if surah is not None:
            entry.update(surah=surah, ayah=ayah)
        if segment is not None:
            entry["segment"] = segment
        if "words" in l:
            entry["words"] = list(l["words"])
        entry.update(steps=own, before=before, after=before + len(own))
        before += len(own)
        if l["id"] in derived:
            entry.update(derived[l["id"]])
        out_lessons.append(entry)
    out_steps = []
    for s in steps:
        if s["lesson"] not in rank:
            raise CUR.CurriculumError(f"step {s['id']!r} is taught in lesson {s['lesson']!r}, which is not a lesson")
        named, _problems = namer.step(s)
        rec: dict = {"id": s["id"], "lesson": s["lesson"], **named}
        for k in ("concept", "part", "basics", "occurs"):
            if k in s:
                rec[k] = s[k]
        rec["line"] = CUR.line_part(s)
        if isinstance(s.get("teach"), dict):
            rec["teach"] = teach_record(s, by_id, by_form)
        if isinstance(s.get("lead"), dict):
            rec["lead"] = lead_record(s, by_id)
        if isinstance(s.get("examples"), list):
            rec["examples"] = example_records(s, library)
        rec["terms"] = list(s.get("terms") or [])
        out_steps.append(rec)
    return {"version": CUR.VERSION, "units": units, "lessons": out_lessons, "steps": out_steps,
            "free": list(authored.get("free") or []), "lanjut": list(authored.get("lanjut") or [])}


def build_all(lessons: dict[str, dict], library: dict, lex: V.Lexicon | None = None, authored: dict | None = None,
              table: dict | None = None) -> dict:
    """The built file from the files on disk (`authored`, `table`: given instead, for the tests)."""
    return build(CUR.load_authored() if authored is None else authored, lessons, library,
                 TERMS.load_terms() if table is None else table, Namer(lessons, lex))


def table(content: dict) -> list[str]:
    """The lessons with their steps and, for a written lesson, the derived lists."""
    by = {s["id"]: s for s in content["steps"]}
    out = []
    for l in content["lessons"]:
        names = ", ".join(f"{by[s]['latin']}" + ("" if by[s]["line"] or by[s].get("basics") else " [not written]") for s in l["steps"])
        out.append(f"  {l['id']:8s} new {len(l['steps'])}: {names or '—'}   (learnt {l['before']} → {l['after']})")
        m = l.get("map")
        if m:
            here = [x["id"] for x in m["learnt"] if x["here"]]
            later = [x + " (" + by[x]["lesson"] + ")" for x in m["later"]]
            out.append(f"           here {len(here)} of {len(m['learnt'])}: {', '.join(here) or '—'}")
            out.append(f"           later {len(later)}: {', '.join(later) or '—'}   lanjut {len(m['lanjut'])}: {', '.join(m['lanjut']) or '—'}")
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--check", action="store_true", help="compare with the file on disk; write nothing")
    ap.add_argument("--show", action="store_true", help="print the lessons and the derived lists; write nothing")
    args = ap.parse_args()
    lessons = load_lessons()
    library = json.loads((CONTENT_DIR / "library.json").read_text(encoding="utf-8"))
    authored = CUR.load_authored()
    import validate_curriculum as VC  # local import: validate_curriculum imports this module

    errs = VC.authored_problems(authored, lessons, library, TERMS.load_terms())
    if errs:
        print("BUILD FAILED:\n  " + "\n  ".join(errs), file=sys.stderr)
        return 1
    try:
        content = build_all(lessons, library, authored=authored)
    except CUR.CurriculumError as e:
        print(f"BUILD FAILED: {e}", file=sys.stderr)
        return 1
    if args.show:
        print("\n".join(table(content)))
        return 0
    text = CUR.dump(content)
    stale = not CUR.CONTENT_JSON.exists() or CUR.CONTENT_JSON.read_text(encoding="utf-8") != text
    if args.check:
        if stale:
            print("out of date: content/curriculum.json")
            return 1
        print("content/curriculum.json is up to date")
        return 0
    if stale:
        CUR.CONTENT_JSON.write_text(text, encoding="utf-8")
    n_written = sum(1 for l in content["lessons"] if "map" in l)
    print(f"curriculum   {len(content['lessons'])} lessons ({n_written} written)  {len(content['steps'])} steps  "
          f"{len(content['lanjut'])} next-level records  -> {CUR.CONTENT_JSON.relative_to(CONTENT_DIR.parent)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
