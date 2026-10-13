#!/usr/bin/env python3
"""Builds content/map/<slug>.json — the lesson map of a surah, version 2: per ayah, the steps that
are new there, every step learnt so far (and which of them come up again), the steps present but
taught later, and the next-level topics (lessonmap.py has the format and the rules; operator
2026-10-13, docs/belajar-plan.md L23 and L26) — for every surah that has authored/<slug>.map.json
(the per-surah switch; Al-Fatihah only today). The four lists are the curriculum's
(content/curriculum.json, build_curriculum.py); a step is named as the curriculum names it, a
next-level record through the narration's own sanitiser and pronunciation dictionary.
Deterministic, stdlib only, no network, no LLM. Run from belajar/pipeline, after
build_curriculum.py and BEFORE build_narration.py (whose map and learned lines read it):

    python3 build_map.py            # write content/map/*.json
    python3 build_map.py --check    # exit 1 if a file on disk differs from a fresh build
    python3 build_map.py --show     # print the table and every name

A step whose name the narrator cannot say, a new step with no text, or a next-level record whose
title gives no clean name stops the build (the last: give it one in authored/<slug>.map.json `names`).
"""
from __future__ import annotations

import argparse
import json
import re
import sys

import build_curriculum as BC
import build_narration as B
import curriculum as CUR
import lessonmap as LM
import validate_narration as V
from common import CONTENT_DIR, SURAHS

load_lessons = BC.load_lessons


class Namer(BC.Namer):
    """The names of a lesson map (lessonmap.Namer).

    A STEP is named by the curriculum (content/curriculum.json `name` / `latin`,
    build_curriculum.Namer.step); here its name is only held to what the narrator may say
    (step_problems), because a map line says it.

    A NEXT-LEVEL RECORD is named from its Konsep title: the title is written as the narration
    writes a caption title (the sanitised title, read in the ayah of the record's first example),
    and the name is what that title opens with (lessonmap.cut_name) — its caption form must open
    the title's, at a "," ":" "." ";" or the " (" of its gloss, which is where src/lib/emphasis.ts
    conceptName ends a name. Or, authored: the explicit name, sanitised in strict mode. Either way
    at most lessonmap.NAME_WORDS words, passing the narration's own checks, and no word place."""

    def title(self, concept: dict, surah: int, ayah: int) -> str:
        """The caption title's prose (build_narration.surah_lines)."""
        return B._cap(self.san.prose(concept["title"], surah, ayah))

    def step_problems(self, sid: str, latin: str) -> list[str]:
        return self.step({"id": sid, "name": latin})[1]

    def __call__(self, concept: dict, surah: int, ayah: int, explicit: str | None) -> dict:
        cid = concept["id"]
        if explicit is not None:
            try:
                latin = B._cap(self.san.prose(explicit, surah, ayah, strict=f"names[{cid}]"))
            except SystemExit as e:
                raise LM.MapError(str(e)) from None
            source = "authored"
        else:
            title = self.title(concept, surah, ayah)
            latin = LM.cut_name(title)
            if latin is None:
                raise LM.MapError(f"{cid}: its caption title “{title}” opens with no name of at most {LM.NAME_WORDS} "
                                  f"words — give it one in authored/<slug>.map.json names[{cid!r}]")
            head = self.shown(title)
            name = self.shown(latin)
            if not head.startswith(name) or not LM._NAME_END.match(head[len(name):]):
                raise LM.MapError(f"{cid}: the caption “{head}” does not open with the name “{name}” — give it one in "
                                  f"authored/<slug>.map.json names[{cid!r}]")
            source = "title"
        if len(latin.split()) > LM.NAME_WORDS:
            raise LM.MapError(f"{cid}: the name {latin!r} is longer than {LM.NAME_WORDS} words")
        # A title that names a Qur'anic word: the sanitiser put the word's place there ("Zharaf kata
        # keempat"), which means nothing away from that ayah's screen.
        if re.search(rf"\b[Kk]ata (?:ini|{V.ORDINAL})\b", latin) or re.search(r"\b(?:di|pada) ayat\b", latin):
            raise LM.MapError(f"{cid}: the name {latin!r} holds a word's place, not a name — give it one in "
                              f"authored/<slug>.map.json names[{cid!r}]")
        marked = self.sp.mark(latin)
        name, said = self.sp.shown(marked, None), self.sp.spoken(marked)
        errs = (V.check_text(f"name of {cid}", latin, self.san.forms, max_len=None)
                + V.check_spoken(f"name of {cid}", said, self.san.forms, self.lex)
                + V.check_display(f"name of {cid}", name, said, self.san.forms, self.lex, None))
        if errs:
            raise LM.MapError("; ".join(errs))
        return {"name": name, "latin": latin, "from": source}


def build_all(lessons: dict[str, dict], library: dict, lex: V.Lexicon | None = None,
              authored: dict[str, dict] | None = None, curriculum: dict | None = None) -> dict[str, dict]:
    """slug → content/map/<slug>.json for every surah with an authored map file. `authored`: the
    authored files by slug, `curriculum`: content/curriculum.json (both default: from disk)."""
    curriculum = CUR.load_content() if curriculum is None else curriculum
    if curriculum is None:
        raise LM.MapError("content/curriculum.json is missing (run build_curriculum.py first)")
    namer = Namer(lessons, lex)
    slugs = LM.authored_slugs() if authored is None else [sp.slug for sp in SURAHS if sp.slug in authored]
    return {slug: LM.build(slug, lessons, library, curriculum, namer, None if authored is None else authored[slug])
            for slug in slugs if slug in lessons}


def table(content: dict) -> list[str]:
    """One map: per ayah the four lists, then every name."""
    steps = content["steps"]
    where = lambda sid: f"{sid} ({steps[sid]['lesson']})"  # noqa: E731
    out = [f"{content['slug']}:"]
    for a in content["ayat"]:
        here = LM.here_ids(a)
        out.append(f"  ayat {a['ayah']}: new {len(a['new'])}: {', '.join(a['new']) or '—'}")
        out.append(f"          learnt {len(a['learnt'])}, here {len(here)}: {', '.join(here) or '—'}")
        out.append(f"          later {len(a['later'])}: {', '.join(map(where, a['later'])) or '—'}")
        out.append(f"          lanjut {len(a['lanjut'])}: {', '.join(a['lanjut']) or '—'}")
    out.append("  steps:")
    out += [f"    {sid}: {x['name']}  [{x['lesson']}]" for sid, x in steps.items()]
    out.append("  next level:")
    out += [f"    {cid}: {x['name']}  [{x['from']}]" for cid, x in content["lanjut"].items()]
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--check", action="store_true", help="compare with the files on disk; write nothing")
    ap.add_argument("--show", action="store_true", help="print the table and the names; write nothing")
    args = ap.parse_args()
    lessons = load_lessons()
    library = json.loads((CONTENT_DIR / "library.json").read_text(encoding="utf-8"))
    curriculum = CUR.load_content()
    try:
        built = build_all(lessons, library, curriculum=curriculum)
    except LM.MapError as e:
        print(f"BUILD FAILED: {e}", file=sys.stderr)
        return 1
    failed = False
    for slug, content in built.items():
        errs = LM.problems(content, lessons, library, curriculum)
        if errs:
            print(f"{slug}: BUILD FAILED:\n  " + "\n  ".join(errs), file=sys.stderr)
            failed = True
    if failed:
        return 1
    if args.show:
        for content in built.values():
            print("\n".join(table(content)))
        return 0
    stale = lambda path, text: not path.exists() or path.read_text(encoding="utf-8") != text  # noqa: E731
    differ = [slug for slug, content in built.items() if stale(LM.MAP_DIR / f"{slug}.json", LM.dump(content))]
    # A map file whose surah lost its authored switch is out of date too (it would still be read).
    orphans = sorted(set(LM.load_all_content()) - set(built))
    if args.check:
        if differ or orphans:
            print("out of date:", ", ".join(differ + [f"{s} (no authored/{s}.map.json)" for s in orphans]))
            return 1
        print("lesson map files are up to date")
        return 0
    LM.MAP_DIR.mkdir(parents=True, exist_ok=True)
    for slug, content in built.items():
        path = LM.MAP_DIR / f"{slug}.json"
        if stale(path, LM.dump(content)):
            path.write_text(LM.dump(content), encoding="utf-8")
        new = sum(len(a["new"]) for a in content["ayat"])
        print(f"{slug:12s} {len(content['ayat'])} ayat  {len(content['steps'])} steps listed ({new} taught here)  "
              f"{len(content['lanjut'])} next-level records  -> {path.relative_to(CONTENT_DIR.parent)}")
    for slug in orphans:
        print(f"WARN  content/map/{slug}.json has no authored/{slug}.map.json behind it: remove it (it is still read)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
