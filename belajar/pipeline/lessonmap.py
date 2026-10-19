"""The lesson map of a surah, version 2: per ayah, what is NEW, what has been LEARNT SO FAR (and
which of it comes up again here), what is present but taught LATER, and what belongs to the NEXT
LEVEL (stdlib only).

Operator, 2026-10-13 (docs/belajar-plan.md L23): "at the beginning of the ayat, better to inform
what concept we will learn in this ayat, also explain maybe we skip some concept and will visit
later in next ayat instead of explaining all concepts in 1 ayat … so at the beginning we inform
what will be learnt, in the end recap what we've learnt" — "if some concept already done in
previous ayat, we say we repeat what we've learnt before". And the same day, on the basic
curriculum (docs/belajar-research/kurikulum-dasar.md decisions 8 and 9; plan L26): "next ayat,
should review pervious lesson if exist in that ayat" — "so the knowledge is accummulating and
repeated" — "but separate new vs already knows concept, this is what new, this is what we've
learnt so far".

Version 1 derived the map from each Konsep's FIRST EXAMPLE (new 5 / 3 / 1 / 1 / 8 / 2 / 6 on
Al-Fatihah). Version 2 takes WHERE a thing is taught from the curriculum (curriculum.py,
content/curriculum.json) and lists STEPS, not records:

  new      the steps this ayah's lesson teaches, in the order their lines are said (at most three);
  learnt   EVERY step of every earlier lesson, in teaching order — the whole list so far — each
           with `here`: it occurs in this ayah (the ones the lesson reviews);
  later    the steps of later lessons that occur in this ayah, in teaching order;
  lanjut   the next-level Konsep records tagged on this ayah, in the library's order: named on the
           card, never taught at this level and never spoken by the narrator.

Nothing here is authored per ayah, and nothing is derived here either: the four lists are the
curriculum's own (content/curriculum.json `lessons[].map`, checked by validate_curriculum.py),
copied for the surahs that are switched on, each step with the name the narrator and the card
call it by.

ONE file per surah, content/map/<slug>.json, built by build_map.py for every surah that has
authored/<slug>.map.json — that authored file is the per-surah switch (Al-Fatihah only today): a
surah without it has no map, its lessons get no map / learned narration line and no card. Format:

    {"version": 2, "slug": "al-fatihah", "surah": 1,
     "steps": {"majrur": {"name": "Majrur (مَجْرُور)", "latin": "Majrur", "lesson": "1:1"}, …},
     "lanjut": {"syibhul-jumlah": {"name": "Syibhul jumlah (شِبْه الجُمْلَة)", "latin": "Syibhul jumlah", "from": "title"}, …},
     "ayat": [{"ayah": 1, "new": ["majrur", "huruf-jar"],
               "learnt": [{"id": "harakat", "here": false}, {"id": "kalimah", "here": true}],
               "later": ["alif-lam", "naat", "idhafah"], "lanjut": ["syibhul-jumlah"]}, …]}

`steps` holds every step an ayah of the surah lists, in teaching order: `name` its caption form,
`latin` the same as prose, `lesson` where it is taught (a curriculum lesson id: "0", "1:4",
"114:2"). `lanjut` holds every next-level record an ayah lists, in the library's order, named as
its Konsep title opens (cut_name below, the prose twin of src/lib/emphasis.ts conceptName) or, for
a title that gives no clean name, by an explicit one in authored/<slug>.map.json `names` — the
build stops and says so rather than guess. A next-level name is shown, never said.

Superseded with version 1 (2026-10-13): the authored "later" TOPICS. Marfu' was one — "in ayat-1,
it mentions 'bentuk tertentu' but no explanation about marfu' itself, better to inform it will be
learnt later" — because no Konsep taught it. It is now a step of its own, taught at Al-Fatihah 2
and found wherever a word is marfu'; ayah 1 has no marfu' word, so its card no longer lists it,
and the sentence that points ahead there ("Mengapa dhammah, kita pelajari di ayat kedua.") stays
true: the curriculum teaches marfu' in ayah 2.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Callable

import curriculum as CUR
from common import AUTHORED_DIR, CONTENT_DIR, SURAH_BY_SLUG, SURAHS

MAP_DIR = CONTENT_DIR / "map"
MAP_VERSION = 2
# src/lib/emphasis.ts NAME_WORDS: a longer title opens with a description, not a name.
NAME_WORDS = 4
GROUPS = ("new", "learnt", "later", "lanjut")
STEP_KEYS = {"name", "latin", "lesson"}
RECORD_KEYS = {"name", "latin", "from"}
ENTRY_KEYS = {"ayah", *GROUPS, "kinds"}
FILE_KEYS = {"version", "slug", "surah", "steps", "lanjut", "ayat", "kinds"}

# THE KINDS OF WORD MET IN AN AYAH (operator 2026-10-18: "we always say in this ayat we find 3 jenis
# kata: isim, fi'il, huruf. But actually in that ayat (example ayat-3) we only have isim, no harf or
# fi'il. Fix this in all lessons."). The step "Tiga jenis kata (isim, fi'il, dan huruf)" occurs in
# every ayah (`occurs.always`), and a line that says it is MET HERE names the kinds that occur here:
# each entry carries `kinds`, the kinds of its words' parts, derived the way the warm-up derives
# them (quiz.part_kinds: the QAC tag of each part as one of quiz.KINDS), and the file a `kinds` table
# — which step it is (the one whose Konsep record is quiz.KALIMAH_RECORD), its name without its
# members ("Tiga jenis kata") and each member's name. With all three kinds the step is named whole
# as before; with fewer, the list names it bare and one more sentence says which:
# "Dari tiga jenis kata itu, di ayat ini hanya ada isim (اِسْم)." The DEFINITION of the step — what
# was learnt (map:total), lesson zero's Konsep line — keeps the three: it is no claim about an ayah.
KINDS_SENTENCE = "Dari {step} itu, di ayat ini hanya ada {kinds}."
KINDS_KEYS = {"step", "name", "latin", "members"}
_NAME = re.compile(r"[^\s,.:;()“”«»]+(?: [^\s,.:;()“”«»]+)*")
_NAME_END = re.compile(r"(?:$|[,.:;]| \()")
ID = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


class MapError(Exception):
    """A map that cannot be built (a name the narrator cannot say, a record without a usable name)."""


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
    """One ayah's {ayah, new, learnt, later, lanjut}, or None (no map for the surah, or for that ayah)."""
    for a in (content or {}).get("ayat") or []:
        if isinstance(a, dict) and a.get("ayah") == ayah:
            return a
    return None


# ------------------------------------------------------------------ reading an entry
def here_ids(entry: dict) -> list[str]:
    """The steps learnt before that come up again in this ayah, in teaching order."""
    return [x["id"] for x in entry.get("learnt") or [] if isinstance(x, dict) and x.get("here") is True]


def learnt_total(entry: dict) -> int:
    """How many steps have been learnt once this ayah's lesson is through."""
    return len(entry.get("learnt") or []) + len(entry.get("new") or [])


def kinds_of(lesson: dict, ayah: dict) -> list[str]:
    """The kinds of word the ayah's words are made of, in quiz.KINDS order: each part's QAC tag as
    one of the three kinds (quiz.part_kinds — the warm-up's own rule, so the two always agree)."""
    import quiz as Q  # noqa: PLC0415 — quiz imports this module
    found = {k for w in ayah["words"] for k in Q.part_kinds(w)}
    return [k for k in Q.KINDS if k in found]


def kinds_step(curriculum: dict) -> str | None:
    """The step whose members are the three kinds of word: the one whose Konsep record is the
    Kalimah record (quiz.KALIMAH_RECORD), or None."""
    import quiz as Q  # noqa: PLC0415
    return next((s["id"] for s in curriculum.get("steps") or [] if s.get("concept") == Q.KALIMAH_RECORD), None)


def all_kinds(entry: dict) -> bool:
    """Does the ayah have words of all three kinds?"""
    import quiz as Q  # noqa: PLC0415
    return list(entry.get("kinds") or []) == list(Q.KINDS)


def bare_name(latin: str) -> str:
    """A step's name without the members it lists in brackets: "Tiga jenis kata (isim, fi'il, dan
    huruf)" → "Tiga jenis kata"."""
    return re.sub(r"\s*\([^()]*\)$", "", latin.strip())


def kinds_partial(content: dict | None, entry: dict) -> bool:
    """The kinds step comes up again in this ayah, and the ayah has fewer than all three kinds: a
    line that says it is met here names it bare and says which kinds occur (KINDS_SENTENCE)."""
    k = (content or {}).get("kinds")
    return isinstance(k, dict) and k.get("step") in here_ids(entry) and not all_kinds(entry)


def here_latin(content: dict, entry: dict, sid: str) -> str:
    """The prose name a "met here" list gives step `sid` in this ayah: the kinds step bare when the
    ayah has fewer than all three kinds, every other step (and that one with all three) by its name."""
    if kinds_partial(content, entry) and sid == content["kinds"]["step"]:
        return content["kinds"]["latin"]
    return content["steps"][sid]["latin"]


def kind_names(content: dict, entry: dict, field: str = "latin") -> list[str]:
    """The names (`latin` or caption `name`) of the kinds that occur in this ayah, in order."""
    members = ((content or {}).get("kinds") or {}).get("members") or {}
    return [members[k][field] for k in entry.get("kinds") or [] if k in members]


def taught_ayah(step: dict, surah: int) -> int | None:
    """The ayah of surah `surah` that teaches a step, or None: it is taught in another surah, in
    a segment of a long ayah or in the lesson with no ayah (the narrator then says "nanti")."""
    s, a, segment = CUR.place(step["lesson"])
    return a if s == surah and segment is None else None


# ------------------------------------------------------------------ names
def cut_name(title: str) -> str | None:
    """The name a concept's caption title opens with (src/lib/emphasis.ts conceptName, on the
    prose): its words up to the title's "," ":" "." ";" or the " (" of its gloss; None when there
    is none, or it is longer than NAME_WORDS words (a description, not a name)."""
    m = _NAME.match(title)
    if not m or not _NAME_END.match(title[m.end():]):
        return None
    return m.group() if len(m.group().split()) <= NAME_WORDS else None


def first_example(concept: dict) -> tuple[int, int] | None:
    """(surah, ayah) of a record's first example: the ayah its title is read in when a next-level
    record is named (a title that names a Qur'anic word would say a place of that ayah, and is
    refused). No longer where anything is TAUGHT: the curriculum says that."""
    ex = concept.get("examples") or []
    if not ex:
        return None
    s, a = str(ex[0]["loc"]).split(":")[:2]
    return int(s), int(a)


# namer(concept, surah, ayah, explicit name or None) → {"name", "latin", "from"} for a next-level
# record, and namer.step_problems(step id, latin) → what keeps the narrator from saying a step's
# name (build_map.Namer: it needs the narration's sanitiser and dictionary, which this module does
# not import).
Namer = Callable[[dict, int, int, "str | None"], dict]


def build(slug: str, lessons: dict[str, dict], library: dict, curriculum: dict, namer: Namer, authored: dict | None = None) -> dict:
    """content/map/<slug>.json. `curriculum`: content/curriculum.json; `authored`:
    authored/<slug>.map.json (default: from disk)."""
    lesson = lessons[slug]
    authored = load_authored(slug) if authored is None else authored
    if not isinstance(authored, dict) or authored.get("slug") != slug:
        raise MapError(f"authored/{slug}.map.json must carry slug {slug!r}")
    if "later" in authored:
        raise MapError(f"authored/{slug}.map.json: `later` (an authored item an ayah postpones) was superseded by the "
                       "curriculum on 2026-10-13: what is taught later is a step of authored/curriculum.json")
    names = authored.get("names")
    if not isinstance(names, dict) or not all(isinstance(k, str) and isinstance(v, str) and v.strip() for k, v in names.items()):
        raise MapError(f"authored/{slug}.map.json: `names` must be an object of next-level record id → name")
    surah = lesson["surah"]
    step_by = {s["id"]: s for s in curriculum.get("steps") or []}
    ayat = []
    for a in lesson["ayat"]:
        entry = (CUR.lesson_entry(curriculum, surah, a["ayah"]) or {}).get("map")
        if not isinstance(entry, dict):
            raise MapError(f"{slug} {a['ayah']}: content/curriculum.json has no lesson {CUR.ayah_lesson(surah, a['ayah'])} "
                           "with its derived lists (run build_curriculum.py)")
        ayat.append({"ayah": a["ayah"], "new": list(entry["new"]), "learnt": [dict(x) for x in entry["learnt"]],
                     "later": list(entry["later"]), "lanjut": list(entry["lanjut"]), "kinds": kinds_of(lesson, a)})
    listed = {sid for a in ayat for sid in a["new"] + [x["id"] for x in a["learnt"]] + a["later"]}
    steps = {}
    for s in curriculum.get("steps") or []:
        sid = s["id"]
        if sid not in listed:
            continue
        found = namer.step_problems(sid, s["latin"])
        if found:
            raise MapError(f"{slug}: step {sid} is named “{s['latin']}”, which the narrator cannot say — "
                           f"reword its name in authored/curriculum.json ({'; '.join(found)})")
        steps[sid] = {"name": s["name"], "latin": s["latin"], "lesson": s["lesson"]}
    missing = sorted(listed - set(step_by))
    if missing:
        raise MapError(f"{slug}: {missing} are listed and are no steps of content/curriculum.json")
    for a, src in zip(ayat, lesson["ayat"]):
        for sid in a["new"]:
            if not (step_by[sid].get("line") or step_by[sid].get("basics")):
                raise MapError(f"{slug} {src['ayah']}: step {sid} is new here and has no text to teach it (a whole Konsep "
                               "record or its own `teach` in authored/curriculum.json)")
    used = [cid for a in ayat for cid in a["lanjut"]]
    stale = sorted(set(names) - set(used))
    if stale:
        raise MapError(f"authored/{slug}.map.json: names for {stale}, which no ayah of {slug} lists as a next-level topic")
    lanjut = {}
    for c in library["concepts"]:
        if c["id"] in used:
            at = first_example(c) or (surah, 1)
            lanjut[c["id"]] = namer(c, at[0], at[1], names.get(c["id"]))
    lost = sorted(set(used) - set(lanjut))
    if lost:
        raise MapError(f"{slug}: {lost} are listed as next-level topics and are no Konsep of the library")
    ks = kinds_step(curriculum)
    kinds = kinds_table(ks, steps[ks], namer) if ks in steps else None
    return {"version": MAP_VERSION, "slug": slug, "surah": surah, "steps": steps, "lanjut": lanjut, "ayat": ayat,
            "kinds": kinds}


def kinds_table(sid: str, step: dict, namer) -> dict:
    """The file's `kinds`: the step, its name without its members (as the caption shows it and as
    prose) and each kind's name, "Isim (اِسْم)" — its term's display in the pronunciation dictionary
    (the term table gives the kind's Arabic), exactly what its caption shows inside the step's own
    name."""
    import quiz as Q  # noqa: PLC0415
    terms = Q.Terms(Q.load_terms())
    bare = bare_name(step["latin"])
    members = {}
    for k in Q.KINDS:
        t = namer.lex.by_term.get(terms.by_id[k]["ar"])
        if t is None:
            raise MapError(f"the kind {k!r} ({terms.by_id[k]['ar']}) has no term in the pronunciation dictionary")
        members[k] = {"name": t.display[:1].upper() + t.display[1:], "latin": t.latin[:1].upper() + t.latin[1:]}
    return {"step": sid, "name": namer.shown(bare), "latin": bare, "members": members}


# ------------------------------------------------------------------ checks
def problems(content, lessons: dict[str, dict], library: dict, curriculum: dict | None) -> list[str]:
    """What a map file says against the lessons, the library and the curriculum
    (content/curriculum.json, itself held to the lessons by validate_curriculum.py)."""
    if not isinstance(content, dict) or set(content) != FILE_KEYS:
        return ["map: a file is exactly {version, slug, surah, steps, lanjut, ayat, kinds}"]
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
    steps, lanjut, ayat = content["steps"], content["lanjut"], content["ayat"]
    if not isinstance(steps, dict) or not isinstance(lanjut, dict) or not isinstance(ayat, list):
        return errs + [f"{w}: steps and lanjut must be objects and ayat a list"]
    if not isinstance(curriculum, dict):
        return errs + [f"{w}: no content/curriculum.json to hold it to (run build_curriculum.py)"]
    if [a.get("ayah") if isinstance(a, dict) else None for a in ayat] != [a["ayah"] for a in lesson["ayat"]]:
        return errs + [f"{w}: ayat must be the lesson's ayat, each once, in order"]
    rank = CUR.ranks(curriculum)
    step_by = {s["id"]: s for s in curriculum.get("steps") or []}
    order = [s["id"] for s in curriculum.get("steps") or []]
    next_level = set(curriculum.get("lanjut") or [])
    listed: set[str] = set()
    listed_lanjut: set[str] = set()
    for entry, a in zip(ayat, lesson["ayat"]):
        n = a["ayah"]
        lid = CUR.ayah_lesson(lesson["surah"], n)
        ok = set(entry) == ENTRY_KEYS and all(isinstance(entry[g], list) for g in (*GROUPS, "kinds")) \
            and all(isinstance(x, str) for g in ("new", "later", "lanjut", "kinds") for x in entry[g]) \
            and all(isinstance(x, dict) and set(x) == {"id", "here"} and isinstance(x["id"], str) and isinstance(x["here"], bool)
                    for x in entry["learnt"])
        if not ok:
            errs.append(f"{w} ayah {n}: an entry is exactly {{ayah, new, learnt, later, lanjut, kinds}}: step ids, the learnt "
                        "ones each {id, here}, next-level record ids, and the kinds of word of its words")
            continue
        # The kinds of word met here are the ayah's own (quiz.word_parts, the warm-up's rule): a
        # line that says a kind is met here when no word of the ayah is of it is wrong (operator
        # 2026-10-18, Al-Fatihah 3: "we only have isim, no harf or fi'il").
        want_kinds = kinds_of(lesson, a)
        if entry["kinds"] != want_kinds:
            errs.append(f"{w} ayah {n}: kinds {entry['kinds']} are not the kinds of its words' parts {want_kinds} "
                        "(quiz.part_kinds, the QAC tag of each part)")
        learnt = [x["id"] for x in entry["learnt"]]
        every = entry["new"] + learnt + entry["later"]
        listed |= set(every)
        listed_lanjut |= set(entry["lanjut"])
        unknown = [sid for sid in every if sid not in step_by]
        if unknown:
            errs.append(f"{w} ayah {n}: {unknown} are no steps of the curriculum")
            continue
        if len(set(every)) != len(every):
            errs.append(f"{w} ayah {n}: a step is listed twice (new, learnt and later are always apart)")
        if len(entry["new"]) > CUR.MAX_STEPS:
            errs.append(f"{w} ayah {n}: {len(entry['new'])} new steps, more than {CUR.MAX_STEPS}")
        here = rank.get(lid)
        if here is None:
            errs.append(f"{w} ayah {n}: {lid} is no lesson of the curriculum")
            continue
        for sid in entry["new"]:
            if step_by[sid]["lesson"] != lid:
                errs.append(f"{w} ayah {n}: new lists {sid}, which is taught in {step_by[sid]['lesson']}, not here")
        for sid in learnt:
            if not rank[step_by[sid]["lesson"]] < here:
                errs.append(f"{w} ayah {n}: learnt lists {sid}, which is not taught earlier (it is taught in {step_by[sid]['lesson']})")
        for sid in entry["later"]:
            if not rank[step_by[sid]["lesson"]] > here:
                errs.append(f"{w} ayah {n}: later lists {sid}, which is not taught later (it is taught in {step_by[sid]['lesson']})")
        for cid in entry["lanjut"]:
            if cid not in next_level:
                errs.append(f"{w} ayah {n}: lanjut lists {cid}, which is not a next-level record of the curriculum")
        want = (CUR.lesson_of(curriculum, lid) or {}).get("map")
        got = {g: entry[g] for g in GROUPS}
        if got != want:
            diff = next((g for g in GROUPS if not isinstance(want, dict) or got[g] != want.get(g)), "new")
            errs.append(f"{w} ayah {n}: {diff} is not what the curriculum gives for lesson {lid} "
                        f"({(want or {}).get(diff) if isinstance(want, dict) else 'no derived lists'})")
    if errs:
        return errs
    if list(steps) != [sid for sid in order if sid in listed]:
        errs.append(f"{w}: steps must be exactly the steps its ayat list, in teaching order "
                    f"(extra {sorted(set(steps) - listed)}, missing {sorted(listed - set(steps))})")
    want_lanjut = [c["id"] for c in library["concepts"] if c["id"] in listed_lanjut]
    if list(lanjut) != want_lanjut:
        errs.append(f"{w}: lanjut must be exactly the next-level records its ayat list, in the library's order "
                    f"(extra {sorted(set(lanjut) - listed_lanjut)}, missing {sorted(listed_lanjut - set(lanjut))})")
    for sid, s in steps.items():
        if not ID.match(sid) or not isinstance(s, dict) or set(s) != STEP_KEYS:
            errs.append(f"{w}: step {sid!r} must be {{name, latin, lesson}}")
            continue
        c = step_by.get(sid)
        if c is not None and (s["name"], s["latin"], s["lesson"]) != (c["name"], c["latin"], c["lesson"]):
            what = "is taught in " + c["lesson"] + ", not " + str(s["lesson"]) if s["lesson"] != c["lesson"] \
                else "is named “" + c["name"] + "” by the curriculum, not “" + str(s["name"]) + "”"
            errs.append(f"{w}: step {sid} {what}")
        errs += _name_problems(w, sid, s)
    for cid, c in lanjut.items():
        if not ID.match(cid) or not isinstance(c, dict) or set(c) != RECORD_KEYS:
            errs.append(f"{w}: next-level record {cid!r} must be {{name, latin, from}}")
            continue
        if c["from"] not in ("title", "authored"):
            errs.append(f"{w}: {cid}: from must be \"title\" or \"authored\"")
        errs += _name_problems(w, cid, c)
    errs += _kinds_problems(w, content, curriculum)
    return errs


def _kinds_problems(w: str, content: dict, curriculum: dict) -> list[str]:
    """The file's `kinds` table: the kinds step when the map lists it (else null), its bare name,
    a name for each of the three kinds (quiz.KINDS)."""
    import quiz as Q  # noqa: PLC0415
    k, sid = content.get("kinds"), kinds_step(curriculum)
    if sid not in content["steps"]:
        return [] if k is None else [f"{w}: kinds is null when no ayah lists the step of the kinds of word"]
    if not isinstance(k, dict) or set(k) != KINDS_KEYS or k.get("step") != sid:
        return [f"{w}: kinds must be {{step, name, latin, members}} for the step {sid!r} (the kinds of word)"]
    errs = []
    if k["latin"] != bare_name(content["steps"][sid]["latin"]) or not isinstance(k["name"], str) \
            or not content["steps"][sid]["name"].startswith(k["name"]):
        errs.append(f"{w}: kinds names the step {k['latin']!r}, not its own name without its members "
                    f"({bare_name(content['steps'][sid]['latin'])!r})")
    members = k.get("members")
    if not isinstance(members, dict) or list(members) != list(Q.KINDS) \
            or not all(isinstance(m, dict) and set(m) == {"name", "latin"} and all(isinstance(m[x], str) and m[x] for x in m)
                       for m in members.values()):
        errs.append(f"{w}: kinds.members must name each of {list(Q.KINDS)}, in that order, as {{name, latin}}")
    return errs


def name_words(latin: str) -> int:
    """The words of a name, not counting the members it lists in brackets at its end: "Tiga jenis
    kata (isim, fi'il, dan huruf)" is a name of three words (operator 2026-10-17: "add in parenthesis
    what are tiga jenis kata", so that the steps named after it are not heard as its members)."""
    return len(re.sub(r"\s*\([^()]*\)$", "", latin.strip()).split())


def _name_problems(w: str, key: str, rec: dict) -> list[str]:
    errs = []
    for k in ("name", "latin"):
        if not isinstance(rec[k], str) or not rec[k].strip() or rec[k] != rec[k].strip():
            errs.append(f"{w}: {key}: {k} must be a non-empty, trimmed string")
    if isinstance(rec["latin"], str):
        if name_words(rec["latin"]) > NAME_WORDS:
            errs.append(f"{w}: {key}: the name {rec['latin']!r} is longer than {NAME_WORDS} words (a description, not a name)")
        if re.search("[؀-ۿ]", rec["latin"]):
            errs.append(f"{w}: {key}: latin carries Arabic script (the caption form goes in name)")
    return errs
