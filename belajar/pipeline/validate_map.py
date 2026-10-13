#!/usr/bin/env python3
"""Validator for the lesson maps (content/map/<slug>.json; lessonmap.py has the format and the
rules; operator 2026-10-13, docs/belajar-plan.md L23). Standard library only, no network; run from
belajar/pipeline:

    python3 validate_map.py

Checks, each stated on its own (lessonmap.problems re-derives them from the lessons and the
library, it does not call the builder):
  1. every surah with authored/<slug>.map.json has its built file, and no file is left for a surah
     without one (the per-surah switch: such a file would still be read);
  2. per ayah: NEW is exactly the concepts whose first example is in that ayah, in the library's
     order (the ayah's "Konsep baru" lines); REVIEW ⊆ the ayah's concepts and each really
     introduced in an EARLIER ayah; LATER ⊆ the ayah's concepts and each really introduced in a
     LATER ayah; every concept the ayah's words (or structure groups) carry is in exactly one of
     the three; review and later in the order they are taught;
  3. `concepts` is exactly the concepts the ayat list, each with the ayah that teaches it;
  4. every name is at most lessonmap.NAME_WORDS words, and a name taken from the title is what the
     concept's own "Konsep baru: …" caption opens with (content/narration/<slug>.json), so the
     card, the caption and the narrator name it alike; an authored later item (a topic, e.g.
     marfu' in Al-Fatihah 1) is no Konsep, is only ever "later", and its teaching line exists, is
     in a later ayah and really names it ("disebut …" / "… adalah");
  5. the file equals a fresh build_map.py run (no hand edits; the names through the narration's
     sanitiser and dictionary).
Prints the new / review / later table. Exit 1 on any failure. What the "map" and "learned"
narration lines say against the map is validate_narration.py's part (map_problems).
"""
from __future__ import annotations

import json
import re
import sys

import build_map as BM
import lessonmap as LM
import validate_narration as V
from common import CONTENT_DIR, SURAH_BY_NUM, SURAHS


def caption_problems(content: dict, manifests: dict[str, dict]) -> list[str]:
    """Check 4: a title-derived name opens the concept's own caption, in the ayah that teaches it."""
    errs = []
    for cid, c in (content.get("concepts") or {}).items():
        if not isinstance(c, dict) or c.get("from") != "title":
            continue
        sp = SURAH_BY_NUM.get(c.get("surah"))
        lines = ((manifests.get(sp.slug) if sp else None) or {}).get("lines") or {}
        lid = f"{sp.slug if sp else '?'}:{c.get('ayah')}:concept:{cid}"
        shown = V._field_of(lines, lid, "display")
        head = f"{V.TITLE_LEAD} {c.get('name')}"
        if not shown:
            errs.append(f"map/{content['slug']}: {cid}: no narration line {lid} to take its name from")
        elif not (shown.startswith(head) and re.match(r"(?:$|[,.:;]| \()", shown[len(head):])):
            errs.append(f"map/{content['slug']}: {cid} is named “{c.get('name')}”, and its caption ({lid}) does not open "
                        f"with that name: “{shown[:70]}”")
    return errs


def check(contents: dict[str, dict], lessons: dict[str, dict], library: dict, manifests: dict[str, dict], *,
          authored: dict[str, dict] | None = None, lex: V.Lexicon | None = None) -> list[str]:
    """Every check above. `authored`: the authored map files by slug (default: from disk)."""
    errs: list[str] = []
    switched = LM.authored_slugs() if authored is None else [sp.slug for sp in SURAHS if sp.slug in authored]
    try:
        fresh = BM.build_all(lessons, library, lex, authored)
    except LM.MapError as e:
        fresh = None
        errs.append(f"build_map.py fails: {e}")
    for slug in switched:
        if slug not in contents:
            errs.append(f"map/{slug}: authored/{slug}.map.json has no built file (run build_map.py)")
    for slug, content in contents.items():
        if slug not in switched:
            errs.append(f"map/{slug}: no authored/{slug}.map.json behind it (the surah is not switched on: remove the file)")
        found = LM.problems(content, lessons, library)
        errs += found
        if found:
            continue
        errs += caption_problems(content, manifests)
        errs += LM.topic_problems(content, (manifests.get(slug) or {}).get("lines") or {})
        if fresh is not None and slug in fresh and LM.dump(content) != LM.dump(fresh[slug]):
            errs.append(f"map/{slug}: content/map/{slug}.json is out of date with build_map.py (rebuild, do not hand-edit)")
    # What the authored file asks for NOW (a rebuild would write it): an authored later item must
    # point at a line the narration has and that names it, before it is ever built into a file.
    for slug, content in (fresh or {}).items():
        errs += [e for e in LM.topic_problems(content, (manifests.get(slug) or {}).get("lines") or {}) if e not in errs]
    return errs


def main() -> int:
    lessons = BM.load_lessons()
    library = json.loads((CONTENT_DIR / "library.json").read_text(encoding="utf-8"))
    manifests = {sp.slug: json.loads(p.read_text(encoding="utf-8")) for sp in SURAHS
                 if (p := CONTENT_DIR / "narration" / f"{sp.slug}.json").exists()}
    contents = LM.load_all_content()
    errs = check(contents, lessons, library, manifests)
    for content in contents.values():
        if isinstance(content, dict) and isinstance(content.get("ayat"), list) and isinstance(content.get("concepts"), dict):
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
