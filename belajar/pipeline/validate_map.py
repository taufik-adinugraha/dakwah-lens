#!/usr/bin/env python3
"""Validator for the lesson maps (content/map/<slug>.json, version 2; lessonmap.py has the format
and the rules; operator 2026-10-13, docs/belajar-plan.md L23 and L26). Standard library only, no
network; run from belajar/pipeline:

    python3 validate_map.py

Checks, each stated on its own:
  1. every surah with authored/<slug>.map.json has its built file, and no file is left for a surah
     without one (the per-surah switch: such a file would still be read);
  2. per ayah (lessonmap.problems): NEW, LEARNT and LATER are steps of the curriculum and always
     apart — a step is in one of them at most; NEW is taught in this ayah's lesson (at most
     three), LEARNT in an earlier lesson of the curriculum's order, LATER in a later one; the four
     lists are the ones the curriculum gives for that lesson (content/curriculum.json, held to the
     lessons by validate_curriculum.py: learnt is EVERY earlier step, `here` exactly where it
     occurs, later occurs here, lanjut is tagged here);
  3. `steps` is exactly the steps the ayat list, in teaching order, each named as the curriculum
     names it and placed where it teaches it; `lanjut` exactly the next-level records they list,
     in the library's order; every name at most lessonmap.NAME_WORDS words;
  4. a step taught in this surah is called by the name its own "Konsep baru: …" caption opens with
     (content/narration/<slug>.json), so the card, the caption and the narrator name it alike;
  5. the file equals a fresh build_map.py run (no hand edits) — which also refuses a step whose
     name the narrator cannot say and a new step that has no text.
Prints the table. Exit 1 on any failure. What the map and learned narration lines say against the
map is validate_narration.py's part (map_problems).
"""
from __future__ import annotations

import json
import re
import sys

import build_map as BM
import curriculum as CUR
import lessonmap as LM
import validate_narration as V
from common import CONTENT_DIR, SURAH_BY_NUM, SURAHS


def caption_problems(content: dict, manifests: dict[str, dict], curriculum: dict | None) -> list[str]:
    """Check 4: a step taught in this surah opens its own caption, in the ayah that teaches it."""
    errs = []
    surah = content.get("surah")
    for sid, s in (content.get("steps") or {}).items():
        if not isinstance(s, dict) or not isinstance(s.get("lesson"), str) or not CUR.LESSON.match(s["lesson"]):
            continue
        at, ayah, segment = CUR.place(s["lesson"])
        line = (CUR.step_of(curriculum, sid) or {}).get("line")
        sp = SURAH_BY_NUM.get(at)
        if at != surah or segment is not None or not line or not sp:
            continue
        lines = (manifests.get(sp.slug) or {}).get("lines") or {}
        lid = f"{sp.slug}:{ayah}:{line}"
        shown = V._field_of(lines, lid, "display")
        head = f"{V.TITLE_LEAD} {s.get('name')}"
        if not shown:
            errs.append(f"map/{content['slug']}: {sid}: no narration line {lid} to teach it")
        elif not (shown.startswith(head) and re.match(r"(?:$|[,.:;]| \()", shown[len(head):])):
            errs.append(f"map/{content['slug']}: {sid} is named “{s.get('name')}”, and its caption ({lid}) does not open "
                        f"with that name: “{shown[:70]}”")
    return errs


def check(contents: dict[str, dict], lessons: dict[str, dict], library: dict, manifests: dict[str, dict], *,
          authored: dict[str, dict] | None = None, lex: V.Lexicon | None = None, curriculum: dict | None = None) -> list[str]:
    """Every check above. `authored`: the authored map files by slug, `curriculum`:
    content/curriculum.json (both default: from disk)."""
    errs: list[str] = []
    curriculum = CUR.load_content() if curriculum is None else curriculum
    switched = LM.authored_slugs() if authored is None else [sp.slug for sp in SURAHS if sp.slug in authored]
    try:
        fresh = BM.build_all(lessons, library, lex, authored, curriculum)
    except LM.MapError as e:
        fresh = None
        errs.append(f"build_map.py fails: {e}")
    for slug in switched:
        if slug not in contents:
            errs.append(f"map/{slug}: authored/{slug}.map.json has no built file (run build_map.py)")
    for slug, content in contents.items():
        if slug not in switched:
            errs.append(f"map/{slug}: no authored/{slug}.map.json behind it (the surah is not switched on: remove the file)")
        found = LM.problems(content, lessons, library, curriculum)
        errs += found
        if found:
            continue
        errs += caption_problems(content, manifests, curriculum)
        if fresh is not None and slug in fresh and LM.dump(content) != LM.dump(fresh[slug]):
            errs.append(f"map/{slug}: content/map/{slug}.json is out of date with build_map.py (rebuild, do not hand-edit)")
    return errs


def main() -> int:
    lessons = BM.load_lessons()
    library = json.loads((CONTENT_DIR / "library.json").read_text(encoding="utf-8"))
    manifests = {sp.slug: json.loads(p.read_text(encoding="utf-8")) for sp in SURAHS
                 if (p := CONTENT_DIR / "narration" / f"{sp.slug}.json").exists()}
    contents = LM.load_all_content()
    errs = check(contents, lessons, library, manifests)
    for content in contents.values():
        if isinstance(content, dict) and isinstance(content.get("ayat"), list) and isinstance(content.get("steps"), dict):
            try:
                print("\n".join(BM.table(content)))
            except (KeyError, TypeError):
                pass  # a malformed file: the problems below say what is wrong
    off = [sp.slug for sp in SURAHS if sp.slug in lessons and sp.slug not in contents]
    if off:
        print(f"no lesson map (no authored/<slug>.map.json): {', '.join(off)}")
    if errs:
        print(f"\nFAIL: {len(errs)} problem(s)")
        for e in errs:
            print("  -", e)
        return 1
    print("\nOK: lesson maps valid")
    return 0


if __name__ == "__main__":
    sys.exit(main())
