"""The learning path over the Kosakata list (operator 2026-11-03): levels by coverage, batches of ten,
and the next batch opens when a test is passed. This module decides what can be decided from the data:
which words share a batch, what kind of word each is, and Level 0. Standard library only, no LLM.

Batches follow frequency rank, with one exception: two words a learner would confuse never share a
batch, because learning look-alikes or synonyms side by side makes both harder. The later one moves to
the next batch that has room. Measured 2026-11-03 on the top 2,000: no word moves more than 7 ranks.

Two words clash when they have the same letters once the harakat are gone (مِن and مَن, إِنَّ and أَنَّ),
or share a meaning among their first two senses (مِن and عَن, both "dari"). The list's other 2,832
words stay out of the path: they make up 5% of the text and 1,994 of them occur once.

Level 0 is the parts attached to words: 53.8% of the Qur'an's words carry one, and the list cannot
hold them because QAC gives a lemma only to a stem. Their meanings are authored/kosakata_parts.json,
written by hand; their counts, examples and recordings are computed here and checked against QAC.
"""
from __future__ import annotations

import json
import re
import unicodedata
from collections import defaultdict

import kosakata_voice as V
from common import AUTHORED_DIR

PARTS_FILE = AUTHORED_DIR / "kosakata_parts.json"
LEVELS = ((1, 100), (101, 300), (301, 500), (501, 1000), (1001, 2000))
BATCH_SIZE = 10
PASS_PERCENT = 80
LEVEL_TEST_QUESTIONS = 30
REVIEW_QUESTIONS = 5
# A card, never a question: wrong options do not belong beside these words.
NO_TEST = ("{ll~ah", "{ll~ahum~a")
_MARKS_AS_LETTERS = "ۥۦـ"


def kind_of(tags: dict[str, int]) -> str:
    """verb, name, noun or particle: the most frequent of the lemma's tags decides. Wrong options in a
    test come from the same kind, so an option cannot be ruled out by its grammar alone."""
    tag = max(sorted(tags), key=lambda t: tags[t])
    if tag == "V":
        return "verb"
    if tag == "PN":
        return "name"
    return "noun" if tag in {"N", "ADJ", "VN", "NV"} else "particle"


def meanings(word: dict) -> set[str]:
    """The word's first two senses in Indonesian, each phrase separately, without its parenthesis."""
    out = set()
    for s in word["senses"][:2]:
        for part in re.split(r"[,;]", re.sub(r"\(.*?\)", "", s["id"])):
            if part.strip():
                out.add(part.strip().lower())
    return out


def clash(a: dict, b: dict) -> bool:
    return V.skeleton(a["ar"]) == V.skeleton(b["ar"]) or bool(meanings(a) & meanings(b))


def batches(words: list[dict]) -> list[list[dict]]:
    """One level's words, in rank order, as batches of BATCH_SIZE with no clash inside a batch, except
    where the words left over leave no choice."""
    pool = list(words)
    out = []
    while pool:
        batch: list[dict] = []
        rest = []
        for w in pool:
            if len(batch) < BATCH_SIZE and not any(clash(w, x) for x in batch):
                batch.append(w)
            else:
                rest.append(w)
        room = BATCH_SIZE - len(batch)
        if room > 0:
            batch, rest = batch + rest[:room], rest[room:]
        out.append(batch)
        pool = rest
    return out


def load_parts(path=PARTS_FILE) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))["parts"]


def part_places(parts: list[dict]) -> list[str]:
    """Every place Level 0 plays, in the file's order, each once."""
    return list(dict.fromkeys(loc for p in parts for loc in (p["card"], p["test"])))


def letters(token: str) -> list[str]:
    """The word as letters, each with its marks."""
    out: list[str] = []
    for ch in token:
        if out and (unicodedata.category(ch) == "Mn" or ch in _MARKS_AS_LETTERS):
            out[-1] += ch
        else:
            out.append(ch)
    return out


def split_part(token: str, side: str, n: int) -> list[str]:
    """[before, the part, after]: the three join back into the Tanzil token, byte for byte."""
    c = letters(token)
    return ["", "".join(c[:n]), "".join(c[n:])] if side == "prefix" else ["".join(c[:-n]), "".join(c[-n:]), ""]


def feature(seg) -> str:
    return seg.features.split("|")[1]


def part_count(part: dict, segs: list) -> int:
    start, not_start = part.get("form_starts"), part.get("form_not_starts")
    return sum(
        1
        for g in segs
        if ("PREFIX" in g.flags or "SUFFIX" in g.flags)
        and feature(g) in part["feats"]
        and (start is None or g.form.startswith(start))
        and (not_start is None or not g.form.startswith(not_start))
    )


def attached_share(segs: list) -> int:
    """Words of the Qur'an that carry a prefix or suffix, in basis points."""
    words, attached = set(), set()
    for g in segs:
        words.add((g.s, g.a, g.w))
        if "PREFIX" in g.flags or "SUFFIX" in g.flags:
            attached.add((g.s, g.a, g.w))
    return round(len(attached) * 10000 / len(words))


def part_table(parts: list[dict], segs: list, tokens: dict, count: dict, lemmas: dict, pins: dict) -> dict[str, dict]:
    """Each part as the pages use it. ValueError when a place is not what the file says: not this part
    and one stem, or at the end of an ayah, where the recording is a stop form."""
    by_word: dict[tuple[int, int, int], list] = defaultdict(list)
    for g in segs:
        by_word[(g.s, g.a, g.w)].append(g)
    out = {}
    for p in parts:
        examples = []
        for loc in (p["card"], p["test"]):
            s, a, w = (int(x) for x in loc.split(":"))
            gs = by_word[(s, a, w)]
            mine = [g for g in gs if feature(g) in p["feats"] and ("PREFIX" in g.flags or "SUFFIX" in g.flags)]
            stems = [g for g in gs if g.feat.get("LEM")]
            if len(gs) != 2 or len(mine) != 1 or len(stems) != 1:
                raise ValueError(f"part {p['key']}: {loc} is not this part and one stem")
            if (s, a) not in tokens or w == count[(s, a)]:
                raise ValueError(f"part {p['key']}: {loc} ends its ayah, or Tanzil and QAC count that ayah differently")
            token = tokens[(s, a)][w - 1]
            split = split_part(token, p["side"], p["letters"])
            if "".join(split) != token:
                raise ValueError(f"part {p['key']}: splitting {loc} lost a letter")
            pin = pins.get("parts", {}).get(loc)
            if pin is None:
                raise ValueError(f"part {p['key']}: no recording pinned for {loc}: run build_kosakata_voice.py --fetch")
            stem = lemmas.get(stems[0].feat["LEM"], {}).get("senses", [{"id": "", "en": ""}])[0]
            order = (lambda x, y: f"{x} + {y}") if p["side"] == "prefix" else (lambda x, y: f"{y} + {x}")
            examples.append(
                {
                    "word": split,
                    "pieces": {"id": order(p["id"], stem["id"]), "en": order(p["en"], stem["en"])},
                    "voice": V.word_voice(pin),
                }
            )
        out[p["key"]] = {
            "key": p["key"],
            "ar": examples[0]["word"][1],
            "translit": p["translit"],
            "id": p["id"],
            "en": p["en"],
            "count": part_count(p, segs),
            "examples": examples,
        }
        if p.get("concept"):
            out[p["key"]]["concept"] = p["concept"]
    return out


def path_file(words: list[dict], rows: list[dict], parts: list[dict], table: dict[str, dict], attached: int) -> dict:
    """content/kosakata/path.json: what the map, the batches and the tests need beyond the word files."""
    levels: list[dict] = [
        {
            "n": 0,
            "batches": [[p["key"] for p in parts if p["side"] == "prefix"], [p["key"] for p in parts if p["side"] == "suffix"]],
        }
    ]
    for n, (lo, hi) in enumerate(LEVELS, 1):
        levels.append(
            {
                "n": n,
                "from": lo,
                "to": hi,
                "cum": rows[hi - 1]["cum"],
                "batches": [[w["rank"] for w in b] for b in batches(words[lo - 1 : hi])],
            }
        )
    return {
        "pass_percent": PASS_PERCENT,
        "level_test_questions": LEVEL_TEST_QUESTIONS,
        "review_questions": REVIEW_QUESTIONS,
        "attached_share": attached,
        "no_test": [w["rank"] for w in words if w["lemma"] in NO_TEST],
        "levels": levels,
        "parts": table,
    }


def path_problems(path: dict | None, words: list[dict]) -> list[str]:
    """The path alone, against the word files: every word of a level once, batches of ten, no clash."""
    if not path:
        return ["path.json is missing; run build_kosakata.py"]
    out: list[str] = []
    by_rank = {w["rank"]: w for w in words}
    levels = path["levels"]
    if [lv["n"] for lv in levels] != list(range(len(LEVELS) + 1)):
        out.append("the levels are not 0 to 5 in order")
        return out
    in_batches = {k for b in levels[0]["batches"] for k in b}
    if in_batches != set(path["parts"]):
        out.append("Level 0's batches and its parts differ")
    for lv, (lo, hi) in zip(levels[1:], LEVELS):
        ranks = [r for b in lv["batches"] for r in b]
        if sorted(ranks) != list(range(lo, hi + 1)):
            out.append(f"Level {lv['n']} does not hold each of words {lo} to {hi} once")
        for i, b in enumerate(lv["batches"], 1):
            if len(b) != BATCH_SIZE:
                out.append(f"Level {lv['n']} batch {i} holds {len(b)} words")
            for x in range(len(b)):
                for y in range(x + 1, len(b)):
                    if b[x] in by_rank and b[y] in by_rank and clash(by_rank[b[x]], by_rank[b[y]]):
                        out.append(f"Level {lv['n']} batch {i}: words {b[x]} and {b[y]} clash")
    for key, p in path["parts"].items():
        if len(p.get("examples", [])) != 2:
            out.append(f"part {key}: {len(p.get('examples', []))} examples, expected a card's and a test's")
        for e in p.get("examples", []):
            if "".join(e["word"]) != e["voice"]["form"]:
                out.append(f"part {key}: the example does not join back into {e['voice']['form']}")
    return out
