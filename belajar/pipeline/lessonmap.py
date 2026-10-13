"""The lesson map of a surah: per ayah, which Konsep are NEW there, which are REPEATED from an
earlier ayah, and which are PRESENT but taught LATER (stdlib only).

Operator, 2026-10-13 (docs/belajar-plan.md L23): "at the beginning of the ayat, better to inform
what concept we will learn in this ayat, also explain maybe we skip some concept and will visit
later in next ayat instead of explaining all concepts in 1 ayat. for example marfu' also exist in
ayat-1, but we skipt the lesson to be done in ayat2. so at the beginning we inform what will be
learnt, in the end recap what we've learnt" — "if some concept already done in previous ayat, we
say we repeat what we've learnt before".

Nothing here is authored per ayah: the map is DERIVED from what the lessons already carry.

  present(ayah)  the Konsep ids its words are tagged with (content/<slug>.json words[].concepts)
                 and those its structure groups name (structure.groups[].concept; today every one
                 of them is tagged on a word as well, so the groups add nothing — they are read so
                 that a group-only concept can never go missing);
  taught(id)     the ayah of the concept's FIRST example (content/library.json; the rule of
                 validate_narration.introduced_concepts and src/lib/library.ts
                 conceptsIntroducedIn): where its "Konsep baru: …" line is said;
  new(ayah)      the concepts taught in this ayah, in the library's order — the order of the
                 ayah's concept:* narration lines;
  review(ayah)   present here, taught in an EARLIER ayah of the lessons;
  later(ayah)    present here, taught in a LATER ayah (the lessons postpone these: the word is
                 explained, its concept waits for the ayah that introduces it).

"Earlier" and "later" are places in the lessons' order (mushaf order of common.SURAHS, then the
ayat). review and later are listed in the order they are (or will be) taught, then the library's:
the card on the stage shows each with its ayah, which then reads in rising order, and the narrator
names the first ones.

A concept's NAME is the name its "Konsep baru: …" caption opens with — cut_name below, the prose
twin of src/lib/emphasis.ts conceptName (its words up to the title's "," ":" "." ";" or the " ("
of its gloss, at most NAME_WORDS words) — so the map, the caption and the card say one name. A
title that gives no such name ("Lam: menafikan dan menjazmkan …", a title that names a Qur'anic
word) needs an explicit one in authored/<slug>.map.json `names`; the build stops and says so
rather than guess. Explicit names are prose, sanitised like every narration line (no Qur'anic
word).

AUTHORED "later" items, or TOPICS (operator 2026-10-13: "in ayat-1, it mentions 'bentuk tertentu'
but no explanation about marfu' itself, better to inform it will be learnt later"). Not everything
a lesson postpones is a Konsep: ayah 1 shows that a noun's base form ends in dhammah and never says
why — the state is named marfu' only in ayah 2, by a word's own line, not by a concept card. The
derivation cannot see that, so authored/<slug>.map.json may give an ayah such an item under
`later`: {"ayah", "id", "name", "note", "line"} — a short name, what the learner is left wondering
(shown on the card, never spoken), and the narration line that TEACHES it. It joins that ayah's
`later` list (card and narrated count alike) and is held to its line: the line must exist, lie in
a LATER ayah, and really NAME the thing (topic_problems: its caption says "disebut <name>" or
"<name> adalah …"). A pointer to something no line teaches cannot be written.

ONE file per surah, content/map/<slug>.json, built by build_map.py for every surah that has
authored/<slug>.map.json — that authored file is the per-surah switch (Al-Fatihah only today): a
surah without it has no map, its lessons get no "map" / "learned" narration line and no card, and
its narration manifest is untouched. Read by the narration build (build_narration.py: the two
lines per ayah), its validator (validate_narration.py: what each line must say), the lesson page
(src/lib/map-content.ts: the card) and the autoplay engine (the two steps). Format (version 1):

    {"version": 1, "slug": "al-fatihah", "surah": 1,
     "concepts": {"huruf-jar": {"name": "Huruf jar (حَرْف جَرّ)", "latin": "Huruf jar",
                                "from": "title", "surah": 1, "ayah": 1}, …},
     "ayat": [{"ayah": 1, "new": ["kalimah-isim-fiil-huruf", …], "review": [], "later": ["syibhul-jumlah"]}, …]}

`concepts` holds every concept an ayah of the surah lists: `name` its caption form (dictionary
terms as "na’t (نَعْت)", authored/pronunciation.json), `latin` the same name as prose, `from`
"title" (cut from the caption's title) or "authored" (an explicit name), `surah` / `ayah` where it
is taught — and every topic, `from` "topic", with its `note` and the `line` that teaches it
(`surah` / `ayah` are that line's). Meant to be reused: a surah's end review is the union of its
ayat's `new` (never a topic: a topic is only ever "later").
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Callable

from common import AUTHORED_DIR, CONTENT_DIR, SURAH_BY_SLUG, SURAHS

MAP_DIR = CONTENT_DIR / "map"
MAP_VERSION = 1
# src/lib/emphasis.ts NAME_WORDS: a longer title opens with a description, not a name.
NAME_WORDS = 4
GROUPS = ("new", "review", "later")
TOPIC = "topic"  # `from` of an authored later item (not a Konsep)
CONCEPT_KEYS = {"name", "latin", "from", "surah", "ayah"}
TOPIC_KEYS = CONCEPT_KEYS | {"note", "line"}
# A caption NAMES a thing: "… disebut <name>", "… dinamakan <name>", "<name> adalah …".
_NAMED_BEFORE = re.compile(r"\b(?:disebut|dinamakan|menyebutnya)(?: sebagai)?\s+$")
_NAMED_AFTER = re.compile(r"^,?\s+adalah\b")
_APOS = "'‘’ʼʿʾ`´"
_NAME = re.compile(r"[^\s,.:;()“”«»]+(?: [^\s,.:;()“”«»]+)*")
_NAME_END = re.compile(r"(?:$|[,.:;]| \()")
ID = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


class MapError(Exception):
    """A map that cannot be built (a concept without a usable name, a tag without a lesson)."""


# ------------------------------------------------------------------ files
def authored_path(slug: str) -> Path:
    return AUTHORED_DIR / f"{slug}.map.json"


def authored_slugs() -> list[str]:
    """The surahs with a lesson map: those with authored/<slug>.map.json (mushaf order)."""
    return [sp.slug for sp in SURAHS if authored_path(sp.slug).exists()]


def load_authored(slug: str) -> dict | None:
    p = authored_path(slug)
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def dump(content: dict) -> str:
    return json.dumps(content, ensure_ascii=False, indent=1) + "\n"


def load_content(slug: str) -> dict | None:
    p = MAP_DIR / f"{slug}.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def load_all_content() -> dict[str, dict]:
    """content/map/<slug>.json of every lesson surah that has one."""
    return {sp.slug: c for sp in SURAHS if (c := load_content(sp.slug)) is not None}


def ayah_entry(content: dict | None, ayah: int) -> dict | None:
    """One ayah's {ayah, new, review, later}, or None (no map for the surah, or for that ayah)."""
    for a in (content or {}).get("ayat") or []:
        if isinstance(a, dict) and a.get("ayah") == ayah:
            return a
    return None


# ------------------------------------------------------------------ the derivation
def lesson_order(lessons: dict[str, dict]) -> dict[tuple[int, int], int]:
    """(surah, ayah) → its place in the lessons' order: mushaf order of SURAHS, then the ayat."""
    out: dict[tuple[int, int], int] = {}
    for sp in SURAHS:
        for a in (lessons.get(sp.slug) or {}).get("ayat") or []:
            out[(sp.surah, a["ayah"])] = len(out)
    return out


def taught_at(concept: dict) -> tuple[int, int] | None:
    """(surah, ayah) of the concept's first example: where it is introduced; None without one."""
    ex = concept.get("examples") or []
    if not ex:
        return None
    s, a = str(ex[0]["loc"]).split(":")[:2]
    return int(s), int(a)


def present_ids(ayah: dict) -> list[str]:
    """The concept ids an ayah carries, in the order it meets them: its words' tags, then the ones
    only a structure group names."""
    out: list[str] = []
    for w in ayah.get("words") or []:
        out += [c for c in w.get("concepts") or [] if c not in out]
    for g in (ayah.get("structure") or {}).get("groups") or []:
        c = g.get("concept")
        if c and c not in out:
            out.append(c)
    return out


def derive(lesson: dict, lessons: dict[str, dict], library: dict) -> list[dict]:
    """[{ayah, new, review, later}] of every ayah of `lesson` (module docstring)."""
    rank = lesson_order(lessons)
    concepts = library["concepts"]
    index = {c["id"]: i for i, c in enumerate(concepts)}
    taught = {c["id"]: taught_at(c) for c in concepts}
    surah = lesson["surah"]
    out = []
    for a in lesson["ayat"]:
        here = (surah, a["ayah"])
        where = f"{lesson['slug']} {a['ayah']}"
        present = present_ids(a)
        for cid in present:
            if cid not in index:
                raise MapError(f"{where}: tagged with {cid!r}, which is not a Konsep of the library")
            if taught[cid] is None or taught[cid] not in rank:
                raise MapError(f"{where}: {cid} is tagged here, and its first example ({taught[cid]}) is in no lesson: "
                               "it is never introduced")
        key = lambda cid: (rank[taught[cid]], index[cid])  # noqa: E731
        out.append({
            "ayah": a["ayah"],
            "new": [c["id"] for c in concepts if taught[c["id"]] == here],
            "review": sorted((c for c in present if rank[taught[c]] < rank[here]), key=key),
            "later": sorted((c for c in present if rank[taught[c]] > rank[here]), key=key),
        })
    return out


# ------------------------------------------------------------------ names
def cut_name(title: str) -> str | None:
    """The name a concept's caption title opens with (src/lib/emphasis.ts conceptName, on the
    prose): its words up to the title's "," ":" "." ";" or the " (" of its gloss; None when there
    is none, or it is longer than NAME_WORDS words (a description, not a name)."""
    m = _NAME.match(title)
    if not m or not _NAME_END.match(title[m.end():]):
        return None
    return m.group() if len(m.group().split()) <= NAME_WORDS else None


# namer(concept, surah, ayah, explicit name or None) → {"name", "latin", "from"}, and
# namer.topic(id, name, note, surah, ayah) → {"name", "latin", "from": "topic", "note"}
# (build_map.Namer: it needs the narration's sanitiser and dictionary, which this module does not
# import).
Namer = Callable[[dict, int, int, "str | None"], dict]


def line_place(slug: str, line: str) -> int | None:
    """The ayah of narration line id "<slug>:<ayah>:<part>"; None when it is not one of `slug`."""
    m = re.fullmatch(rf"{re.escape(slug)}:([1-9]\d*):[a-z0-9:-]+", line) if isinstance(line, str) else None
    return int(m.group(1)) if m else None


def _low(s: str) -> str:
    i = 1 if s[:1] in _APOS and s[1:2].isalpha() else 0
    return s[:i] + s[i:i + 1].lower() + s[i + 1:]


def line_display(lines: dict, lid: str) -> str:
    """A manifest line's caption, its split parts ("<id>:a", ":b") joined."""
    if isinstance(lines.get(lid), dict):
        return str(lines[lid].get("display", ""))
    parts = [str(lines[k].get("display", "")) for k in sorted(lines)
             if k.startswith(lid + ":") and len(k) == len(lid) + 2 and isinstance(lines[k], dict)]
    return " ".join(parts)


def names_it(display: str, name: str) -> bool:
    """Does a caption NAME `name` (its caption form, in either case): "… disebut marfu’ (مَرْفُوع)",
    "Marfu’ (مَرْفُوع) adalah …"? A mere mention ("ia marfu’") does not."""
    for form in {name, _low(name)}:
        at = display.find(form)
        while at != -1:
            if _NAMED_BEFORE.search(display[:at]) or _NAMED_AFTER.match(display[at + len(form):]):
                return True
            at = display.find(form, at + 1)
    return False


def topic_problems(content: dict, lines: dict) -> list[str]:
    """Every topic (authored later item) against the narration of its surah (`lines`: the lines of
    content/narration/<slug>.json): its teaching line exists, is a line of the ayah the record
    gives, and names the thing."""
    errs = []
    slug = content.get("slug")
    for cid, c in (content.get("concepts") or {}).items():
        if not isinstance(c, dict) or c.get("from") != TOPIC:
            continue
        w = f"map/{slug}: topic {cid}"
        ayah = line_place(slug, c.get("line"))
        if ayah is None:
            errs.append(f"{w}: its teaching line {c.get('line')!r} is not a narration line of {slug}")
            continue
        if ayah != c.get("ayah"):
            errs.append(f"{w}: its teaching line {c['line']} is in ayah {ayah}, not ayah {c.get('ayah')}")
        shown = line_display(lines, c["line"])
        if not shown:
            errs.append(f"{w}: its teaching line {c['line']} is not in the narration")
        elif not names_it(shown, str(c.get("name"))):
            errs.append(f"{w}: its teaching line {c['line']} does not name “{c.get('name')}” (“disebut …” or “… adalah”): "
                        f"“{shown[:80]}”")
    return errs


def build(slug: str, lessons: dict[str, dict], library: dict, namer: Namer, authored: dict | None = None) -> dict:
    """content/map/<slug>.json. `authored`: authored/<slug>.map.json (default: from disk)."""
    lesson = lessons[slug]
    authored = load_authored(slug) if authored is None else authored
    if not isinstance(authored, dict) or authored.get("slug") != slug:
        raise MapError(f"authored/{slug}.map.json must carry slug {slug!r}")
    names = authored.get("names")
    if not isinstance(names, dict) or not all(isinstance(k, str) and isinstance(v, str) and v.strip() for k, v in names.items()):
        raise MapError(f"authored/{slug}.map.json: `names` must be an object of concept id → name")
    ayat = derive(lesson, lessons, library)
    used = [cid for a in ayat for g in GROUPS for cid in a[g]]
    stale = sorted(set(names) - set(used))
    if stale:
        raise MapError(f"authored/{slug}.map.json: names for {stale}, which no ayah of {slug} lists")
    rank = lesson_order(lessons)
    by_id = {c["id"]: c for c in library["concepts"]}
    index = {c["id"]: i for i, c in enumerate(library["concepts"])}
    place = {cid: taught_at(by_id[cid]) for cid in set(used)}
    records = {}
    # The authored later items (topics): each joins its ayah's `later`, after the concepts taught
    # in the same ayah, in the order written.
    topics = authored.get("later", [])
    if not isinstance(topics, list):
        raise MapError(f"authored/{slug}.map.json: `later` must be a list of {{ayah, id, name, note, line}}")
    surah = lesson["surah"]
    by_ayah = {a["ayah"]: a for a in ayat}
    for k, t in enumerate(topics):
        w = f"authored/{slug}.map.json later[{k}]"
        if not isinstance(t, dict) or set(t) != {"ayah", "id", "name", "note", "line"} or not all(
                isinstance(t[x], str) and t[x].strip() for x in ("id", "name", "note", "line")):
            raise MapError(f"{w}: must be exactly {{ayah, id, name, note, line}}")
        cid = t["id"]
        if not ID.match(cid) or cid in by_id or cid in records:
            raise MapError(f"{w}: id {cid!r} must be a new id (not a Konsep's, not used twice)")
        if t["ayah"] not in by_ayah:
            raise MapError(f"{w}: {slug} has no ayah {t['ayah']!r}")
        taught = line_place(slug, t["line"])
        if taught is None:
            raise MapError(f"{w}: its teaching line {t['line']!r} is not a narration line of {slug}")
        if (surah, taught) not in rank or not rank[(surah, taught)] > rank[(surah, t["ayah"])]:
            raise MapError(f"{w}: {cid} is taught by {t['line']}, which is not in a later ayah than ayah {t['ayah']}")
        records[cid] = {**namer.topic(cid, t["name"], t["note"], surah, taught), "surah": surah, "ayah": taught, "line": t["line"]}
        place[cid] = (surah, taught)
        index[cid] = len(library["concepts"]) + k
        by_ayah[t["ayah"]]["later"].append(cid)
    key = lambda cid: (rank[place[cid]], index[cid])  # noqa: E731
    for a in ayat:
        a["later"].sort(key=key)
    concepts = {}
    for cid in sorted(set(used) | set(records), key=key):
        if cid in records:
            concepts[cid] = records[cid]
        else:
            s, a = place[cid]
            concepts[cid] = {**namer(by_id[cid], s, a, names.get(cid)), "surah": s, "ayah": a}
    return {"version": MAP_VERSION, "slug": slug, "surah": lesson["surah"], "concepts": concepts, "ayat": ayat}


# ------------------------------------------------------------------ checks
def problems(content, lessons: dict[str, dict], library: dict) -> list[str]:
    """What a map file says against the lessons and the library, re-derived here (never by
    calling `derive`: the checks below state each rule on its own)."""
    if not isinstance(content, dict) or set(content) != {"version", "slug", "surah", "concepts", "ayat"}:
        return ["map: a file is exactly {version, slug, surah, concepts, ayat}"]
    slug = content["slug"]
    w = f"map/{slug}"
    if slug not in SURAH_BY_SLUG or slug not in lessons:
        return [f"{w}: not a lesson surah"]
    errs: list[str] = []
    lesson = lessons[slug]
    if content["version"] != MAP_VERSION:
        errs.append(f"{w}: version must be {MAP_VERSION}")
    if content["surah"] != lesson["surah"]:
        errs.append(f"{w}: surah {content['surah']!r} is not {lesson['surah']}")
    concepts, ayat = content["concepts"], content["ayat"]
    if not isinstance(concepts, dict) or not isinstance(ayat, list):
        return errs + [f"{w}: concepts must be an object and ayat a list"]
    rank = lesson_order(lessons)
    by_id = {c["id"]: c for c in library["concepts"]}
    index = {c["id"]: i for i, c in enumerate(library["concepts"])}
    place = {cid: taught_at(c) for cid, c in by_id.items()}
    if [a.get("ayah") if isinstance(a, dict) else None for a in ayat] != [a["ayah"] for a in lesson["ayat"]]:
        return errs + [f"{w}: ayat must be the lesson's ayat, each once, in order"]
    # The topics (authored later items): not Konsep, each taught by the narration line it names,
    # in the ayah its record gives (topic_problems holds that line to the narration).
    topics = [cid for cid, c in concepts.items() if isinstance(c, dict) and c.get("from") == TOPIC]
    for k, cid in enumerate(topics):
        c = concepts[cid]
        if cid in by_id:
            errs.append(f"{w}: topic {cid} has the id of a Konsep")
        if set(c) != TOPIC_KEYS or not isinstance(c.get("note"), str) or not c["note"].strip():
            errs.append(f"{w}: topic {cid} must be {{name, latin, from, surah, ayah, note, line}}")
        taught = line_place(slug, c.get("line"))
        if taught is None or (c.get("surah"), c.get("ayah")) != (lesson["surah"], taught) or (lesson["surah"], taught) not in rank:
            errs.append(f"{w}: topic {cid}: its teaching line {c.get('line')!r} is not a line of ayah {c.get('ayah')!r} of {slug}")
            return errs
        place[cid] = (lesson["surah"], taught)
        index[cid] = len(library["concepts"]) + k
    if errs:
        return errs
    is_topic = set(topics)
    listed: set[str] = set()
    for entry, a in zip(ayat, lesson["ayat"]):
        n = a["ayah"]
        if set(entry) != {"ayah", *GROUPS} or not all(
                isinstance(entry[g], list) and all(isinstance(x, str) for x in entry[g]) for g in GROUPS):
            errs.append(f"{w} ayah {n}: an entry is exactly {{ayah, new, review, later}}, each a list of concept ids")
            continue
        here = (lesson["surah"], n)
        present = present_ids(a)
        every = [cid for g in GROUPS for cid in entry[g]]
        listed |= set(every)
        unknown = [cid for cid in every if cid not in place or place[cid] not in rank]
        if unknown:
            errs.append(f"{w} ayah {n}: {unknown} are not Konsep with a lesson that introduces them")
            continue
        if len(set(every)) != len(every):
            errs.append(f"{w} ayah {n}: a concept is listed twice")
        # new: the concepts whose "Konsep baru" line this ayah says, in that order.
        introduced = [c["id"] for c in library["concepts"] if place[c["id"]] == here]
        if entry["new"] != introduced:
            errs.append(f"{w} ayah {n}: new {entry['new']} is not the concepts introduced here, in the library's order "
                        f"({introduced})")
        for cid in entry["new"] + entry["review"]:
            if cid in is_topic:
                errs.append(f"{w} ayah {n}: topic {cid} is listed as new or repeated (a topic is only ever taught later)")
        for cid in entry["review"]:
            if cid not in present and cid not in is_topic:
                errs.append(f"{w} ayah {n}: review lists {cid}, which no word or structure group of the ayah carries")
            if not rank[place[cid]] < rank[here]:
                errs.append(f"{w} ayah {n}: review lists {cid}, which is not taught earlier (it is taught in "
                            f"{place[cid][0]}:{place[cid][1]})")
        for cid in entry["later"]:
            if cid not in present and cid not in is_topic:
                errs.append(f"{w} ayah {n}: later lists {cid}, which no word or structure group of the ayah carries")
            if not rank[place[cid]] > rank[here]:
                errs.append(f"{w} ayah {n}: later lists {cid}, which is not taught later (it is taught in "
                            f"{place[cid][0]}:{place[cid][1]})")
        missing = [cid for cid in present if cid not in every]
        if missing:
            errs.append(f"{w} ayah {n}: {missing} are on the ayah's words and in none of new / review / later")
        for g in ("review", "later"):
            want = sorted(entry[g], key=lambda cid: (rank[place[cid]], index[cid]))
            if entry[g] != want:
                errs.append(f"{w} ayah {n}: {g} is not in the order the concepts are taught ({want})")
    if errs:
        return errs
    if set(concepts) != listed:
        errs.append(f"{w}: concepts must be exactly the ones its ayat list (extra {sorted(set(concepts) - listed)}, "
                    f"missing {sorted(listed - set(concepts))})")
    want_order = sorted(concepts, key=lambda cid: (rank[place[cid]], index[cid]) if cid in place and place[cid] in rank else (0, 0))
    if list(concepts) != want_order:
        errs.append(f"{w}: concepts are not in the order they are taught")
    for cid, c in concepts.items():
        if not ID.match(cid) or not isinstance(c, dict) or set(c) != (TOPIC_KEYS if cid in is_topic else CONCEPT_KEYS):
            errs.append(f"{w}: concept {cid!r} must be {{name, latin, from, surah, ayah}}")
            continue
        if cid in place and (c["surah"], c["ayah"]) != place[cid]:
            errs.append(f"{w}: {cid} is taught in {place[cid][0]}:{place[cid][1]}, not {c['surah']}:{c['ayah']}")
        if c["from"] not in ("title", "authored", TOPIC):
            errs.append(f"{w}: {cid}: from must be \"title\", \"authored\" or \"topic\"")
        for k in ("name", "latin"):
            if not isinstance(c[k], str) or not c[k].strip() or c[k] != c[k].strip():
                errs.append(f"{w}: {cid}: {k} must be a non-empty, trimmed string")
        if isinstance(c["latin"], str):
            if len(c["latin"].split()) > NAME_WORDS:
                errs.append(f"{w}: {cid}: the name {c['latin']!r} is longer than {NAME_WORDS} words (a description, not a name)")
            if re.search("[؀-ۿ]", c["latin"]):
                errs.append(f"{w}: {cid}: latin carries Arabic script (the caption form goes in name)")
    return errs
