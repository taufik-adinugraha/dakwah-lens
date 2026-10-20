#!/usr/bin/env python3
"""Validator for the basic curriculum (authored/curriculum.json → content/curriculum.json;
curriculum.py has the format and the rules; operator-approved 2026-10-13,
docs/belajar-research/kurikulum-dasar.md decisions 1-9, plan L26). Standard library only, no
network; run from belajar/pipeline:

    python3 validate_curriculum.py

Checks on the AUTHORED file, each stated on its own (authored_problems, speech_problems):
  1. units and lessons: ids unique; a lesson id is "0" (the lesson with no ayah), "S:A" or "S:A/N"
     (a segment, with `words` [first, last]); every lesson belongs to a unit that exists, the
     lessons of a unit stand together and the units come in the order listed; a unit's lessons are
     of its surah (its ayah, for a unit of one ayah, whose segments cover its words from 1 without
     a gap); a surah with lessons on disk has every one of its ayat as a lesson, in order;
  2. steps: ids unique; each taught in exactly one lesson, which exists; at most
     curriculum.MAX_STEPS per lesson (decision 7); listed in teaching order; each with a name;
  3. records: a step's `concept` is a Konsep of the library and its `basics` a Dasar membaca
     record; a Konsep record is EITHER taught whole by one step, OR split into parts numbered
     1…n (each its own step, in teaching order, each with `occurs`: the record's tag does not
     say which part a word shows), OR in `lanjut` — never two of these — and every record of the
     library is placed; a step has one way of being taught (a whole record has no `teach`, a
     basics step neither); the narration line of a step is its own (no two steps share one, and
     a step with its own text does not carry the id of a Konsep record);
  4. terms: every term id is in authored/library.terms.json; a term is owned by at most one step;
     the `free` terms exist and no step owns them;
  5. `teach`: a title, a summary and at least one source with kitab, ref and url; its [[…]]
     markup resolves and leaves no term unmarked (terms.py); it names no Qur'anic word — no q:
     reference and no transliterated word of a lesson (the Name, a surah's name after "Surah" and
     the letter lam aside, which the narration says in Indonesian) — so that the narration's
     sanitiser has nothing to turn into a word's place, and what it makes of the text passes the
     narration's own checks;
  5b. lesson zero's slides of a step (operator 2026-10-15; curriculum.LEAD_KEYS): `lead` and
     `examples` only on a step of lesson "0" taught as a whole Konsep record; `lead` is {say,
     cards, sources} — one line of at most curriculum.MAX_SAY characters, plain prose (no markup,
     no Arabic script), 1–3 cards (an Arabic card names a term; an Indonesian card a Latin word,
     and may name the term that translates it; every term exists and is this step's or free, so
     a card shows nothing a later lesson teaches) and at least one source with kitab, ref and url;
     `examples` are {loc, say}: each loc one of the record's own examples, once, its line at most
     curriculum.MAX_SAY characters of plain prose naming the kind of word (isim, fi'il, huruf)
     the record's note on it names; both said by the narrator as written (checked with check 5's
     rule: no Qur'anic word);
  6. `occurs` is exactly one of {case: marfu | manshub | majrur | majzum}, {qac: a QAC tag},
     {always: true}, {indefinite: true};
  7. a step taught in a lesson whose surah has lessons on disk AND a lesson map
     (authored/<slug>.map.json) is teachable today — a whole record or `teach` — and every step
     such a map lists has a name the narrator can say (no Qur'anic word, at most four words).
     A name that fails this in a lesson not yet switched on is listed, not refused.
Checks on the BUILT file (content_problems):
  8. it equals a fresh build_curriculum.py run (no hand edits);
  9. per written lesson, re-stated here and never by calling curriculum.derive: `new` is the
     lesson's steps in the order listed; `learnt` is every step of every earlier lesson, in
     teaching order, `here` exactly where the step occurs in the ayah; `later` the steps of later
     lessons that occur in it, in teaching order; `lanjut` the next-level records tagged on it,
     in the library's order; every record tagged on a word or a structure group is a step's or a
     next-level one; `lines` the steps that have a text, with the words each occurs on; `before`
     and `after` the running count of steps.
Prints the lessons with their steps and the totals. Exit 1 on any failure.
"""
from __future__ import annotations

import json
import sys

import build_curriculum as BC
import curriculum as CUR
import lessonmap as LM
import terms as TERMS
import validate_narration as V
from common import CONTENT_DIR, SURAH_BY_NUM, SURAHS

AUTHORED_KEYS = {"_comment", "version", "units", "lessons", "steps", "free", "lanjut"}
STEP_KEYS = {"id", "lesson", "name", "concept", "part", "basics", "occurs", "teach", "lead", "examples", "terms"}
TEACH_KEYS = {"title", "summary", "sources"}


def _is_int(x) -> bool:
    return isinstance(x, int) and not isinstance(x, bool)


def authored_problems(authored, lessons: dict[str, dict], library: dict, table: dict,
                      switched: list[str] | None = None) -> list[str]:
    """Checks 1-7 that need no narration (module docstring). `switched`: the slugs with a lesson
    map (default: authored/<slug>.map.json on disk)."""
    w = "authored/curriculum.json"
    if not isinstance(authored, dict) or not set(authored) <= AUTHORED_KEYS or not AUTHORED_KEYS - {"_comment"} <= set(authored):
        return [f"{w}: a file is {{version, units, lessons, steps, free, lanjut}} (and a _comment)"]
    errs: list[str] = []
    if authored["version"] != CUR.VERSION:
        errs.append(f"{w}: version must be {CUR.VERSION}")
    units, les, steps = authored["units"], authored["lessons"], authored["steps"]
    if not all(isinstance(x, list) for x in (units, les, steps, authored["free"], authored["lanjut"])):
        return errs + [f"{w}: units, lessons, steps, free and lanjut are lists"]
    switched = LM.authored_slugs() if switched is None else switched

    # --- 1. units and lessons
    unit_ids: list[str] = []
    for i, u in enumerate(units):
        if not isinstance(u, dict) or not isinstance(u.get("id"), str) or not CUR.ID.match(u["id"]) \
                or not isinstance(u.get("name"), str) or not u["name"].strip() or not set(u) <= {"id", "name", "surah", "ayah"}:
            errs.append(f"{w}: units[{i}] must be {{id, name, surah?, ayah?}}")
            continue
        if u["id"] in unit_ids:
            errs.append(f"{w}: unit {u['id']!r} is listed twice")
        unit_ids.append(u["id"])
    unit_by = {u["id"]: u for u in units if isinstance(u, dict) and isinstance(u.get("id"), str)}
    lesson_ids: list[str] = []
    seen_units: list[str] = []
    for i, l in enumerate(les):
        if not isinstance(l, dict) or not isinstance(l.get("id"), str) or not set(l) <= {"id", "unit", "words"}:
            errs.append(f"{w}: lessons[{i}] must be {{id, unit, words?}}")
            continue
        lid = l["id"]
        if not CUR.LESSON.match(lid):
            errs.append(f"{w}: lesson id {lid!r} is not \"0\", \"S:A\" or \"S:A/N\"")
            continue
        if lid in lesson_ids:
            errs.append(f"{w}: lesson {lid} is listed twice")
        lesson_ids.append(lid)
        u = unit_by.get(l.get("unit"))
        if u is None:
            errs.append(f"{w}: lesson {lid} belongs to unit {l.get('unit')!r}, which is not a unit")
            continue
        if not seen_units or seen_units[-1] != u["id"]:
            if u["id"] in seen_units:
                errs.append(f"{w}: the lessons of unit {u['id']} do not stand together (lesson {lid})")
            seen_units.append(u["id"])
        surah, ayah, segment = CUR.place(lid)
        if "surah" not in u:
            if surah is not None:
                errs.append(f"{w}: lesson {lid} is an ayah, in unit {u['id']}, which has no surah")
        elif surah != u["surah"] or ("ayah" in u and (ayah != u["ayah"] or segment is None)) or ("ayah" not in u and segment is not None):
            errs.append(f"{w}: lesson {lid} is not a lesson of unit {u['id']} "
                        f"(surah {u['surah']}{', ayah ' + str(u['ayah']) + ', by segment' if 'ayah' in u else ', by ayah'})")
        if (segment is not None) != ("words" in l):
            errs.append(f"{w}: lesson {lid}: a segment, and only a segment, has `words` [first, last]")
        elif "words" in l and not (isinstance(l["words"], list) and len(l["words"]) == 2 and all(_is_int(x) for x in l["words"])
                                   and 1 <= l["words"][0] <= l["words"][1]):
            errs.append(f"{w}: lesson {lid}: words must be [first, last] with 1 ≤ first ≤ last")
    if [u for u in unit_ids if u in seen_units] != seen_units:
        errs.append(f"{w}: the units' lessons are not in the order the units are listed ({seen_units})")
    for u in unit_ids:
        if u not in seen_units:
            errs.append(f"{w}: unit {u} has no lesson")
    # A unit of one ayah: its segments 1…n, their words from 1 without a gap.
    for u in units:
        if not isinstance(u, dict) or "ayah" not in u:
            continue
        segs = [l for l in les if isinstance(l, dict) and l.get("unit") == u.get("id") and isinstance(l.get("words"), list)
                and len(l["words"]) == 2 and all(_is_int(x) for x in l["words"])]
        nxt = 1
        for k, l in enumerate(segs, 1):
            if CUR.LESSON.match(l["id"]) and CUR.place(l["id"])[2] != k:
                errs.append(f"{w}: unit {u['id']}: its segments must be numbered 1, 2, … in order (lesson {l['id']})")
            if l["words"][0] != nxt:
                errs.append(f"{w}: lesson {l['id']}: its words start at {l['words'][0]}, not at {nxt} (a gap or an overlap)")
            nxt = l["words"][1] + 1
    # A surah with lessons on disk: every ayah is a lesson, in order.
    for sp in SURAHS:
        if sp.slug not in lessons:
            continue
        want = [CUR.ayah_lesson(sp.surah, a["ayah"]) for a in lessons[sp.slug]["ayat"]]
        have = [lid for lid in lesson_ids if CUR.place(lid)[0] == sp.surah]
        if have != want:
            errs.append(f"{w}: the lessons of surah {sp.surah} ({sp.slug}) must be its ayat on disk, each once, in order "
                        f"({want}); got {have}")
    rank = {lid: i for i, lid in enumerate(lesson_ids)}

    # --- 2. steps
    step_ids: list[str] = []
    per_lesson: dict[str, int] = {}
    last = -1
    good: list[dict] = []
    for i, s in enumerate(steps):
        if not isinstance(s, dict) or not isinstance(s.get("id"), str) or not CUR.ID.match(s["id"]) or not set(s) <= STEP_KEYS:
            errs.append(f"{w}: steps[{i}] must be {{id, lesson, name, concept?, part?, basics?, occurs?, teach?, terms}} with an id like \"huruf-jar\"")
            continue
        sid = s["id"]
        if sid in step_ids:
            errs.append(f"{w}: step {sid} is listed twice (a step is taught in exactly one lesson)")
            continue
        step_ids.append(sid)
        if s.get("lesson") not in rank:
            errs.append(f"{w}: step {sid} is taught in lesson {s.get('lesson')!r}, which is not a lesson")
            continue
        per_lesson[s["lesson"]] = per_lesson.get(s["lesson"], 0) + 1
        if rank[s["lesson"]] < last:
            errs.append(f"{w}: step {sid} (lesson {s['lesson']}) is listed after a step of a later lesson: list the steps in teaching order")
        last = max(last, rank[s["lesson"]])
        if not isinstance(s.get("name"), str) or not s["name"].strip() or s["name"] != s["name"].strip():
            errs.append(f"{w}: step {sid} needs a name (non-empty, trimmed)")
        if not isinstance(s.get("terms"), list) or not all(isinstance(t, str) for t in s["terms"]):
            errs.append(f"{w}: step {sid}: terms must be a list of term ids")
            continue
        good.append(s)
    for lid, n in per_lesson.items():
        if n > CUR.MAX_STEPS:
            errs.append(f"{w}: lesson {lid} teaches {n} new steps, more than {CUR.MAX_STEPS} (decision 7: at most three per lesson)")

    # --- 3. records
    records = [c["id"] for c in library.get("concepts") or []]
    basics = {b["id"] for b in library.get("basics") or []}
    lanjut = authored["lanjut"]
    for cid in lanjut:
        if cid not in records:
            errs.append(f"{w}: lanjut lists {cid!r}, which is not a Konsep of the library")
    if len(set(lanjut)) != len(lanjut):
        errs.append(f"{w}: lanjut lists a record twice")
    whole: dict[str, list[str]] = {}
    parts: dict[str, list[dict]] = {}
    lines: dict[str, str] = {}
    for s in good:
        sid = s["id"]
        if "concept" in s and s["concept"] not in records:
            errs.append(f"{w}: step {sid}: concept {s['concept']!r} is not a Konsep of the library")
        if "basics" in s and s["basics"] not in basics:
            errs.append(f"{w}: step {sid}: basics {s['basics']!r} is not a Dasar membaca record of the library")
        if "part" in s and ("concept" not in s or not _is_int(s["part"]) or s["part"] < 1):
            errs.append(f"{w}: step {sid}: `part` numbers a part of its `concept` (1, 2, …)")
        if "basics" in s and ("concept" in s or "teach" in s):
            errs.append(f"{w}: step {sid}: a basics step is taught by its Dasar membaca record alone (no concept, no teach)")
        if "concept" in s and "part" not in s and "teach" in s:
            errs.append(f"{w}: step {sid}: a whole record is taught by its own title and summary — `teach` is for a part of "
                        "a record or a step with no record (two texts for one step)")
        if "concept" in s:
            (parts if "part" in s else whole).setdefault(s["concept"], []).append(s if "part" in s else sid)
        if "teach" in s and sid in records:
            errs.append(f"{w}: step {sid} has its own text and the id of a Konsep record: its line concept:{sid} would read as "
                        "that record's")
        lp = CUR.line_part(s)
        if lp:
            if lp in lines:
                errs.append(f"{w}: steps {lines[lp]} and {sid} share the narration line {lp}")
            lines.setdefault(lp, sid)
    for cid in records:
        ways = [x for x, yes in (("taught whole", cid in whole), ("split into parts", cid in parts), ("in lanjut", cid in lanjut)) if yes]
        if not ways:
            errs.append(f"{w}: the Konsep record {cid} is placed nowhere: a step teaches it, or it is in lanjut")
        elif len(ways) > 1:
            errs.append(f"{w}: the Konsep record {cid} is {' and '.join(ways)} — one of these, never two")
        if len(whole.get(cid, [])) > 1:
            errs.append(f"{w}: the Konsep record {cid} is taught whole by {whole[cid]} — by one step")
        ps = parts.get(cid) or []
        if ps:
            if sorted(p["part"] for p in ps if _is_int(p.get("part"))) != list(range(1, len(ps) + 1)):
                errs.append(f"{w}: the parts of {cid} must be numbered 1…{len(ps)}, each once")
            elif [p["part"] for p in ps] != list(range(1, len(ps) + 1)):
                errs.append(f"{w}: the parts of {cid} are not taught in their order ({[p['id'] for p in ps]})")
            for p in ps:
                if "occurs" not in p:
                    errs.append(f"{w}: step {p['id']} is a part of {cid} and needs `occurs`: the record's tag does not say "
                                "which part a word shows")

    # --- 4. terms
    by_id, by_form = TERMS.term_index(table)
    owner: dict[str, str] = {}
    for s in good:
        if len(set(s["terms"])) != len(s["terms"]):
            errs.append(f"{w}: step {s['id']} lists a term twice")
        for t in s["terms"]:
            if t not in by_id:
                errs.append(f"{w}: step {s['id']}: term {t!r} is not in authored/library.terms.json")
            elif t in owner and owner[t] != s["id"]:
                errs.append(f"{w}: the term {t} is owned by {owner[t]} and by {s['id']} (a term belongs to at most one step)")
            owner.setdefault(t, s["id"])
    for t in authored["free"]:
        if t not in by_id:
            errs.append(f"{w}: free term {t!r} is not in authored/library.terms.json")
        if t in owner:
            errs.append(f"{w}: the free term {t} is owned by step {owner[t]} (free, or a step's — not both)")
    if len(set(authored["free"])) != len(authored["free"]):
        errs.append(f"{w}: free lists a term twice")

    # --- 5. teach, 6. occurs
    for s in good:
        sid = s["id"]
        if "teach" in s:
            t = s["teach"]
            if not isinstance(t, dict) or set(t) != TEACH_KEYS or not all(isinstance(t.get(k), str) and t[k].strip() for k in ("title", "summary")):
                errs.append(f"{w}: step {sid}: teach must be {{title, summary, sources}} with a title and a summary")
            else:
                srcs = t["sources"]
                if not isinstance(srcs, list) or not srcs or not all(
                        isinstance(x, dict) and all(isinstance(x.get(k), str) and x[k].strip() for k in ("kitab", "ref", "url")) for x in srcs):
                    errs.append(f"{w}: step {sid}: teach needs at least one source, each with kitab, ref and url")
                for k in ("title", "summary"):
                    where = f"{w}: step {sid} teach.{k}"
                    errs += TERMS.check_markup(t[k], where, by_id, by_form, table)
                    for surface, ref in TERMS.spans(t[k]):
                        if (ref or "").startswith("q:"):
                            errs.append(f"{where}: [[{surface}|{ref}]] names a Qur'anic word — a step's own text is said by the "
                                        "narrator, who never voices one")
        if "occurs" in s:
            o = s["occurs"]
            ok = isinstance(o, dict) and len(o) == 1 and (
                o.get("case") in CUR.CASE_STATES or o.get("always") is True or o.get("indefinite") is True
                or (isinstance(o.get("qac"), str) and CUR.QAC_TAG.match(o["qac"]) is not None))
            if not ok:
                errs.append(f"{w}: step {sid}: occurs must be one of {{case: {' | '.join(CUR.CASE_STATES)}}}, {{qac: a QAC tag}}, "
                            "{always: true}, {indefinite: true}")

    # --- 5b. lesson zero's slides
    concepts = {c.get("id"): c for c in library.get("concepts") or [] if isinstance(c, dict)}
    for s in good:
        sid = s["id"]
        if "lead" not in s and "examples" not in s:
            continue
        if s["lesson"] != CUR.ZERO or "concept" not in s or "part" in s:
            errs.append(f"{w}: step {sid}: `lead` and `examples` are lesson zero's slides of a step taught as a whole Konsep "
                        "record (lesson \"0\", `concept`, no `part`)")
            continue
        errs += zero_slide_problems(f"{w}: step {sid}", s, concepts.get(s["concept"]) or {}, by_id, owner,
                                    set(authored.get("free") or []))

    # --- 7. a step of a switched-on surah is teachable
    for s in good:
        surah = CUR.place(s["lesson"])[0] if s["lesson"] in rank else None
        spec = SURAH_BY_NUM.get(surah)
        if spec and spec.slug in lessons and spec.slug in switched and not CUR.teachable(s):
            errs.append(f"{w}: step {sid_of(s)} is taught in lesson {s['lesson']}, whose surah ({spec.slug}) has a lesson map, and "
                        "has no text: a whole Konsep record (`concept`) or its own `teach`")
    return errs


def _plain_say(x) -> bool:
    return isinstance(x, str) and bool(x.strip()) and len(" ".join(x.split())) <= CUR.MAX_SAY \
        and "[[" not in x and not V.ARABIC.search(x)


def zero_slide_problems(w: str, s: dict, record: dict, by_id: dict, owner: dict, free) -> list[str]:
    """Check 5b (module docstring) for one step."""
    errs: list[str] = []
    sid = s["id"]
    if "lead" in s:
        t = s["lead"]
        if not isinstance(t, dict) or set(t) != CUR.LEAD_KEYS:
            return errs + [f"{w}: lead must be {{say, cards, sources}}"]
        if not _plain_say(t["say"]):
            errs.append(f"{w}: lead.say must be one line of plain prose (no [[…]] markup, no Arabic script), at most "
                        f"{CUR.MAX_SAY} characters (a longer line would be split in two files)")
        srcs = t["sources"]
        if not isinstance(srcs, list) or not srcs or not all(
                isinstance(x, dict) and all(isinstance(x.get(k), str) and x[k].strip() for k in ("kitab", "ref", "url")) for x in srcs):
            errs.append(f"{w}: lead needs at least one source, each with kitab, ref and url")
        cards = t["cards"]
        if not isinstance(cards, list) or not 1 <= len(cards) <= 3:
            errs.append(f"{w}: lead.cards must be one to three cards")
            cards = []
        for k, c in enumerate(cards, 1):
            where = f"{w}: lead.cards[{k}]"
            if not isinstance(c, dict) or c.get("lang") not in CUR.CARD_LANGS or not set(c) <= {"lang", "term", "word", "means"} \
                    or not (isinstance(c.get("means"), str) and c["means"].strip()) or V.ARABIC.search(str(c.get("means"))):
                errs.append(f"{where}: a card is {{lang: ar | id, term?, word?, means}} with an Indonesian meaning")
                continue
            if c["lang"] == "ar" and not c.get("term"):
                errs.append(f"{where}: an Arabic card names a term of the term table (its Arabic is the table's, never typed)")
            if c["lang"] == "id" and not (isinstance(c.get("word"), str) and c["word"].strip() and not V.ARABIC.search(c["word"])):
                errs.append(f"{where}: an Indonesian card names its Latin word")
            if c["lang"] == "ar" and "word" in c:
                errs.append(f"{where}: an Arabic card shows its term, not a word")
            tid = c.get("term")
            if tid is not None:
                if tid not in by_id or not by_id[tid].get("ar"):
                    errs.append(f"{where}: term {tid!r} is not a term of authored/library.terms.json with an Arabic spelling")
                elif owner.get(tid) != sid and tid not in free:
                    errs.append(f"{where}: term {tid!r} is not this step's own (or free): the card would show a term "
                                "before the lesson that teaches it")
    if "examples" in s:
        exs = s["examples"]
        notes = {e.get("loc"): e.get("note") or "" for e in record.get("examples") or [] if isinstance(e, dict)}
        if not isinstance(exs, list) or not exs:
            return errs + [f"{w}: examples must be a non-empty list of {{loc, say}}"]
        seen: set[str] = set()
        for k, e in enumerate(exs, 1):
            where = f"{w}: examples[{k}]"
            if not isinstance(e, dict) or set(e) != CUR.EXAMPLE_KEYS:
                errs.append(f"{where}: an example is {{loc, say}}")
                continue
            if e["loc"] not in notes:
                errs.append(f"{where}: {e['loc']!r} is not one of the record's own examples ({record.get('id')})")
            elif e["loc"] in seen:
                errs.append(f"{where}: {e['loc']} is listed twice")
            seen.add(e["loc"])
            if not _plain_say(e["say"]):
                errs.append(f"{where}: say must be one line of plain prose (no [[…]] markup, no Arabic script), at most "
                            f"{CUR.MAX_SAY} characters")
            elif e["loc"] in notes:
                want = CUR.kinds_in(BC.about_of(notes[e["loc"]]))
                if not want or not want <= CUR.kinds_in(e["say"]):
                    errs.append(f"{where}: the line must name the kind of word the record's note names "
                                f"({sorted(want) or 'none named'}); it says {sorted(CUR.kinds_in(e['say']))}")
    return errs


def sid_of(step: dict) -> str:
    return str(step.get("id"))


def spoken_steps(authored: dict, lessons: dict[str, dict], library: dict, switched: list[str]) -> set[str]:
    """The steps a lesson map of a switched-on surah names (new, learnt or taught later): the ones
    whose names the narrator says."""
    out: set[str] = set()
    for lid, d in CUR.derive(authored, lessons, library).items():
        spec = SURAH_BY_NUM.get(CUR.place(lid)[0])
        if spec and spec.slug in switched:
            m = d["map"]
            out |= set(m["new"]) | {x["id"] for x in m["learnt"]} | set(m["later"])
    return out


def speech_problems(authored: dict, lessons: dict[str, dict], library: dict, namer: BC.Namer,
                    switched: list[str] | None = None) -> tuple[list[str], list[str]]:
    """(errors, notes). Check 5's last half (a step's own text names no Qur'anic word) and check
    7's (a name a lesson map says is sayable); a name that is not, in a lesson no map speaks yet,
    is a note."""
    switched = LM.authored_slugs() if switched is None else switched
    errs: list[str] = []
    notes: list[str] = []
    spoken = spoken_steps(authored, lessons, library, switched)
    for s in authored.get("steps") or []:
        if isinstance(s.get("teach"), dict):
            errs += [f"authored/curriculum.json: {e}" for e in namer.teach_problems(s)]
        # Check 5b's last half: lesson zero's slides are said as written, and name no Qur'anic word.
        says = ([("lead.say", s["lead"].get("say"))] if isinstance(s.get("lead"), dict) else []) + [
            (f"examples[{k}].say", e.get("say")) for k, e in enumerate(s.get("examples") or [], 1) if isinstance(e, dict)]
        for key, text in says:
            bad = namer.quranic_words(str(text or ""))
            if bad:
                errs.append(f"authored/curriculum.json: steps[{s['id']}] {key}: names the Qur'anic word(s) {bad} — the narrator "
                            "never voices one; say “kata ini” over the card that shows it")
        _named, found = namer.step(s)
        for e in found:
            if s["id"] in spoken:
                errs.append(f"authored/curriculum.json: {e}")
            else:
                notes.append(f"step {s['id']} (lesson {s['lesson']}): {e}")
    return errs, notes


def content_problems(content, authored: dict, lessons: dict[str, dict], library: dict, fresh: dict | None) -> list[str]:
    """Checks 8 and 9 (module docstring). `fresh`: what build_curriculum.py builds now, or None
    when it cannot (the caller has said why)."""
    w = "content/curriculum.json"
    if content is None:
        return [f"{w}: missing (run build_curriculum.py)"]
    if not isinstance(content, dict) or set(content) != {"version", "units", "lessons", "steps", "free", "lanjut"}:
        return [f"{w}: a file is exactly {{version, units, lessons, steps, free, lanjut}}"]
    errs: list[str] = []
    if content["version"] != CUR.VERSION:
        errs.append(f"{w}: version must be {CUR.VERSION}")
    if not isinstance(content["lessons"], list) or not isinstance(content["steps"], list):
        return errs + [f"{w}: lessons and steps are lists"]
    if [l.get("id") if isinstance(l, dict) else None for l in content["lessons"]] != [l["id"] for l in authored["lessons"]]:
        return errs + [f"{w}: its lessons are not the authored lessons, each once, in order"]
    rank = CUR.ranks(authored)
    a_steps = sorted(authored["steps"], key=lambda s: rank[s["lesson"]])
    order = [s["id"] for s in a_steps]
    if [s.get("id") if isinstance(s, dict) else None for s in content["steps"]] != order:
        return errs + [f"{w}: its steps are not the authored steps in teaching order"]
    by = {s["id"]: s for s in a_steps}
    for s in content["steps"]:
        a = by[s["id"]]
        if s.get("lesson") != a["lesson"]:
            errs.append(f"{w}: step {s['id']} is taught in lesson {a['lesson']}, not {s.get('lesson')!r}")
        if s.get("line") != CUR.line_part(a):
            errs.append(f"{w}: step {s['id']}: its narration line is {CUR.line_part(a)!r}, not {s.get('line')!r}")
        if s.get("terms") != list(a.get("terms") or []):
            errs.append(f"{w}: step {s['id']}: its terms are not the authored ones")
        for k in ("name", "latin"):
            if not isinstance(s.get(k), str) or not s[k].strip() or s[k] != s[k].strip():
                errs.append(f"{w}: step {s['id']}: {k} must be a non-empty, trimmed string")
        if isinstance(s.get("latin"), str) and V.ARABIC.search(s["latin"]):
            errs.append(f"{w}: step {s['id']}: latin carries Arabic script (the caption form goes in name)")
    if content["lanjut"] != authored["lanjut"] or content["free"] != authored["free"]:
        errs.append(f"{w}: its lanjut and free lists are not the authored ones")
    if errs:
        return errs
    next_level = set(authored["lanjut"])
    placed = {s["concept"] for s in a_steps if "concept" in s} | next_level
    on_disk = CUR.written(authored, lessons)
    count = 0
    for l in content["lessons"]:
        lid = l["id"]
        own = [s["id"] for s in a_steps if s["lesson"] == lid]
        if l.get("steps") != own:
            errs.append(f"{w}: lesson {lid}: steps {l.get('steps')} are not the steps taught there, in the order listed ({own})")
        if (l.get("before"), l.get("after")) != (count, count + len(own)):
            errs.append(f"{w}: lesson {lid}: learnt before / after is {count} / {count + len(own)}, not {l.get('before')} / {l.get('after')}")
        count += len(own)
        if (lid in on_disk) != ("map" in l and "lines" in l):
            errs.append(f"{w}: lesson {lid}: a lesson that has a page (its ayah on disk; lesson zero once a harakat primer is "
                        "played there), and only such a lesson, has its derived `lines` and `map`")
            continue
        if lid not in on_disk:
            continue
        _lesson, a = on_disk[lid]
        m = l["map"]
        if not isinstance(m, dict) or set(m) != {"new", "learnt", "later", "lanjut"}:
            errs.append(f"{w}: lesson {lid}: map is exactly {{new, learnt, later, lanjut}}")
            continue
        here = rank[lid]
        if m["new"] != own:
            errs.append(f"{w}: lesson {lid}: new {m['new']} is not the lesson's steps, in the order listed ({own})")
        earlier = [sid for sid in order if rank[by[sid]["lesson"]] < here]
        if [x.get("id") if isinstance(x, dict) else None for x in m["learnt"]] != earlier:
            errs.append(f"{w}: lesson {lid}: learnt must be every step of every earlier lesson, in teaching order ({len(earlier)} steps)")
        else:
            for x in m["learnt"]:
                want = bool(CUR.occurs(by[x["id"]], a))
                if x.get("here") is not want:
                    errs.append(f"{w}: lesson {lid}: learnt says {x['id']} {'occurs' if x.get('here') else 'does not occur'} in this "
                                f"ayah; it {'does' if want else 'does not'}")
        for sid in m["later"]:
            if sid not in by or not rank[by[sid]["lesson"]] > here:
                errs.append(f"{w}: lesson {lid}: later lists {sid}, which is not taught in a later lesson")
            elif not CUR.occurs(by[sid], a):
                errs.append(f"{w}: lesson {lid}: later lists {sid}, which does not occur in this ayah")
        want_later = [sid for sid in order if rank[by[sid]["lesson"]] > here and CUR.occurs(by[sid], a)]
        if m["later"] != want_later and all(sid in want_later for sid in m["later"]):
            errs.append(f"{w}: lesson {lid}: later must be the steps of later lessons that occur here, in teaching order ({want_later})")
        carried = CUR.tagged(a)
        for cid in carried:
            if cid not in placed:
                errs.append(f"{w}: lesson {lid}: the record {cid} is tagged on this ayah and placed nowhere in the curriculum")
        want_lanjut = [c["id"] for c in library["concepts"] if c["id"] in next_level and c["id"] in carried]
        if m["lanjut"] != want_lanjut:
            errs.append(f"{w}: lesson {lid}: lanjut {m['lanjut']} is not the next-level records tagged on this ayah, in the "
                        f"library's order ({want_lanjut})")
        want_lines = [{"line": CUR.line_part(by[sid]), "step": sid, "words": CUR.occurs(by[sid], a)} for sid in own if CUR.line_part(by[sid])]
        if l["lines"] != want_lines:
            errs.append(f"{w}: lesson {lid}: lines must be the steps that have a text, each with the words it occurs on ({want_lines})")
    if not errs and fresh is not None and CUR.dump(content) != CUR.dump(fresh):
        errs.append(f"{w}: out of date with build_curriculum.py (rebuild, do not hand-edit)")
    return errs


def totals(authored: dict, table: dict) -> dict[str, int]:
    """The counts kurikulum-dasar.md E gives (2026-10-13: 32 lessons, 36 steps, 10 lessons with no
    new step, 86 owned terms, 4 free, 76 left to the next level)."""
    taught = {s["lesson"] for s in authored["steps"]}
    owned = {t for s in authored["steps"] for t in s.get("terms") or []}
    return {"lessons": len(authored["lessons"]), "steps": len(authored["steps"]),
            "lessons without a new step": sum(1 for l in authored["lessons"] if l["id"] not in taught),
            "owned terms": len(owned), "free terms": len(authored["free"]),
            "next-level terms": len({t["id"] for t in table["terms"]} - owned - set(authored["free"])),
            "next-level records": len(authored["lanjut"])}


def check(authored, content, lessons: dict[str, dict], library: dict, table: dict, *, lex: V.Lexicon | None = None,
          switched: list[str] | None = None) -> tuple[list[str], list[str]]:
    """(errors, notes): every check above."""
    errs = authored_problems(authored, lessons, library, table, switched)
    if errs:
        return errs, []
    namer = BC.Namer(lessons, lex)
    try:
        found, notes = speech_problems(authored, lessons, library, namer, switched)
        fresh = BC.build(authored, lessons, library, table, namer)
    except CUR.CurriculumError as e:
        return [f"build_curriculum.py fails: {e}"], []
    return found + content_problems(content, authored, lessons, library, fresh), notes


def main() -> int:
    lessons = BC.load_lessons()
    library = json.loads((CONTENT_DIR / "library.json").read_text(encoding="utf-8"))
    table = TERMS.load_terms()
    authored = CUR.load_authored()
    content = CUR.load_content()
    errs, notes = check(authored, content, lessons, library, table)
    if isinstance(content, dict) and isinstance(content.get("lessons"), list) and isinstance(content.get("steps"), list):
        try:
            print("\n".join(BC.table(content)))
        except (KeyError, TypeError):
            pass  # a malformed file: the problems below say what is wrong
    if not errs:
        print("\n" + ", ".join(f"{n} {what}" for what, n in totals(authored, table).items()))
    if notes:
        print(f"\nnot sayable yet ({len(notes)}): a lesson map cannot be switched on for these lessons until the name is reworded")
        for n in notes:
            print("  ·", n)
    if errs:
        print(f"\nFAIL: {len(errs)} problem(s)")
        for e in errs:
            print("  -", e)
        return 1
    print("\nOK: curriculum valid")
    return 0


if __name__ == "__main__":
    sys.exit(main())
