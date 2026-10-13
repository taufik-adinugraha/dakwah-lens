#!/usr/bin/env python3
"""Builds content/map/<slug>.json — the lesson map of a surah: per ayah, the Konsep that are new
there, repeated from an earlier ayah, or present but taught later (lessonmap.py has the format and
the rules; operator 2026-10-13, docs/belajar-plan.md L23) — for every surah that has
authored/<slug>.map.json (the per-surah switch; Al-Fatihah only today). Derived from
content/<slug>.json and content/library.json; the names through the narration's own sanitiser and
pronunciation dictionary. Deterministic, stdlib only, no network, no LLM. Run from
belajar/pipeline, after build_surah.py / build_library.py and BEFORE build_narration.py (whose
"map" and "learned" lines read it):

    python3 build_map.py            # write content/map/*.json
    python3 build_map.py --check    # exit 1 if a file on disk differs from a fresh build
    python3 build_map.py --show     # print the new / review / later table and every name

A concept whose caption title gives no clean name stops the build: give it one in
authored/<slug>.map.json `names`.
"""
from __future__ import annotations

import argparse
import json
import re
import sys

import build_narration as B
import lessonmap as LM
import validate_narration as V
from common import CONTENT_DIR, SURAHS


def load_lessons() -> dict[str, dict]:
    return {sp.slug: json.loads((CONTENT_DIR / f"{sp.slug}.json").read_text(encoding="utf-8"))
            for sp in SURAHS if (CONTENT_DIR / f"{sp.slug}.json").exists()}


class Namer:
    """A concept's name as the narration says and shows it (lessonmap.Namer).

    From the title: the caption title is written exactly as build_narration.surah_lines writes it
    for the concept's "Konsep baru: …" line (the sanitised title, in the ayah that introduces it),
    and the name is what that title opens with (lessonmap.cut_name) — checked against the caption:
    the title's caption form must open with the name's, at a "," ":" "." ";" or the " (" of its
    gloss, which is where src/lib/emphasis.ts conceptName ends the name it emphasises.
    Authored: the explicit name, sanitised in strict mode (a Qur'anic word in it stops the build).
    Either way the name is at most lessonmap.NAME_WORDS words, passes the narration's own checks
    (no Qur'anic word, no digit, no Arabic outside the dictionary) and is no word place."""

    def __init__(self, lessons: dict[str, dict], lex: V.Lexicon | None = None):
        self.lex = lex or V.load_lexicon()
        self.san = B.Sanitiser(lessons)
        self.sp = B.Speech(self.lex)

    def title(self, concept: dict, surah: int, ayah: int) -> str:
        """The caption title's prose (build_narration.surah_lines)."""
        return B._cap(self.san.prose(concept["title"], surah, ayah))

    def shown(self, prose: str) -> str:
        return self.sp.shown(self.sp.mark(prose), None)

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


    def topic(self, cid: str, name: str, note: str, surah: int, ayah: int) -> dict:
        """An authored later item (lessonmap.py "TOPICS"): its name and its note, sanitised in
        strict mode like every authored narration text, the name at most NAME_WORDS words. The
        name is spoken (the map line names it); the note is shown on the card only, in its
        caption form (dictionary terms with their Arabic)."""
        try:
            latin = B._cap(self.san.prose(name, surah, ayah, strict=f"later[{cid}] name"))
            said = self.san.prose(note, surah, ayah, strict=f"later[{cid}] note")
        except SystemExit as e:
            raise LM.MapError(str(e)) from None
        if len(latin.split()) > LM.NAME_WORDS:
            raise LM.MapError(f"{cid}: the name {latin!r} is longer than {LM.NAME_WORDS} words")
        out, errs = {}, []
        for key, prose in (("name", latin), ("note", said)):
            marked = self.sp.mark(prose)
            shown, spoken = self.sp.shown(marked, None), self.sp.spoken(marked)
            errs += (V.check_text(f"{key} of {cid}", prose, self.san.forms, max_len=None)
                     + V.check_spoken(f"{key} of {cid}", spoken, self.san.forms, self.lex)
                     + V.check_display(f"{key} of {cid}", shown, spoken, self.san.forms, self.lex, None))
            out[key] = shown
        if errs:
            raise LM.MapError("; ".join(errs))
        return {"name": out["name"], "latin": latin, "from": LM.TOPIC, "note": out["note"]}


def build_all(lessons: dict[str, dict], library: dict, lex: V.Lexicon | None = None,
              authored: dict[str, dict] | None = None) -> dict[str, dict]:
    """slug → content/map/<slug>.json for every surah with an authored map file. `authored`: the
    authored files by slug (default: from disk)."""
    namer = Namer(lessons, lex)
    slugs = LM.authored_slugs() if authored is None else [sp.slug for sp in SURAHS if sp.slug in authored]
    return {slug: LM.build(slug, lessons, library, namer, None if authored is None else authored[slug])
            for slug in slugs if slug in lessons}


def table(content: dict) -> list[str]:
    """The new / review / later table of one map, and each concept's name."""
    c = content["concepts"]
    where = lambda cid: f"{cid} (ayat {c[cid]['ayah']})" if c[cid]["surah"] == content["surah"] else f"{cid} (QS {c[cid]['surah']}:{c[cid]['ayah']})"  # noqa: E731
    out = [f"{content['slug']}:"]
    for a in content["ayat"]:
        out.append(f"  ayat {a['ayah']}: new {len(a['new'])}: {', '.join(a['new']) or '—'}")
        out.append(f"          review {len(a['review'])}: {', '.join(map(where, a['review'])) or '—'}")
        out.append(f"          later {len(a['later'])}: {', '.join(map(where, a['later'])) or '—'}")
    out.append("  names:")
    out += [f"    {cid}: {x['name']}  [{x['from']}]" + (f"  — {x['note']}  (taught by {x['line']})" if x["from"] == LM.TOPIC else "")
            for cid, x in c.items()]
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--check", action="store_true", help="compare with the files on disk; write nothing")
    ap.add_argument("--show", action="store_true", help="print the table and the names; write nothing")
    args = ap.parse_args()
    lessons = load_lessons()
    library = json.loads((CONTENT_DIR / "library.json").read_text(encoding="utf-8"))
    try:
        built = build_all(lessons, library)
    except LM.MapError as e:
        print(f"BUILD FAILED: {e}", file=sys.stderr)
        return 1
    failed = False
    for slug, content in built.items():
        errs = LM.problems(content, lessons, library)
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
        n = {g: sum(len(a[g]) for a in content["ayat"]) for g in LM.GROUPS}
        print(f"{slug:12s} {len(content['ayat'])} ayat  {len(content['concepts'])} concepts  new {n['new']}  "
              f"review {n['review']}  later {n['later']}  -> {path.relative_to(CONTENT_DIR.parent)}")
    for slug in orphans:
        print(f"WARN  content/map/{slug}.json has no authored/{slug}.map.json behind it: remove it (it is still read)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
