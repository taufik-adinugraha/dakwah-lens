"""The voice of every word in the Kosakata list (operator 2026-11-03: "we should also provide the
audio of each word so user can listen how it's read").

Each lemma plays Quran.com's word-by-word recording of ONE real place in the Qur'an (plan L34: our
unaltered copy, a word played as [start, end] of its file). A lemma is an abstraction and has no
recording of its own, so the page always shows the form that is heard and where it stands. Which
place, by rule and never by hand (`places`):

  1. the word's own spelling first, with as little attached as possible. Two faults found by reading
     the first choices made this come before everything else: QAC groups عِظَام (bones) under عَظِيم,
     and آتَى would have played the passive أُوتِىَ. A letter of difference counts as two attached parts,
     so وَعَبَدَ beats يَعْبُدُ.
  2. inside an ayah before at its end. The last word of an ayah is read in its stop form, without
     its final vowel (project_voiced_examples_waqf), and a learner should hear the whole word.
  3. spelt as it stands alone. A first letter doubled by the word before it (مُّبِينٌ after a tanwin)
     comes last.
  4. the most frequent such form, then the first place in the mushaf.

Four ayat are left out because Tanzil and QAC count their words differently (2:181, 8:6, 13:37,
37:130), so a QAC word number there is not a Tanzil token. They are found, not listed.

kosakata_voice.json holds the pins: place, Quran.com's own text of that word (the check that the
file number is this word), sha256, and the word's [start, end] inside its file. build_kosakata_voice.py
writes it. The files themselves are on the media store (host_media.py), so CI sees only the pins.
Standard library only, no LLM.
"""
from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from pathlib import Path

import wordvoice as W
from common import bw_to_ar, lesson_ayah

PINS = Path(__file__).resolve().parent / "kosakata_voice.json"
_SHADDAH = "ّ"
_LOC = re.compile(r"[1-9]\d{0,2}:[1-9]\d{0,2}:[1-9]\d{0,2}")


def skeleton(ar: str) -> str:
    """The word's letters only, spelt one way: alif forms, ya, ta marbuta and hamza seats unified."""
    return W.fold(ar).translate(str.maketrans({"ؤ": "و", "ئ": "ي", "ء": ""}))


def distance(a: str, b: str) -> int:
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def assimilated(token: str) -> bool:
    """The first letter carries a shaddah because of the word before it. A word starting with
    hamzat wasl and a doubled letter (ٱلَّذِى) has its shaddah on the second letter, so it is not one."""
    return token[1:3].find(_SHADDAH) != -1 and not token.startswith("ٱ")


def counted_alike(T, segs: list) -> tuple[dict[tuple[int, int], list[str]], dict[tuple[int, int], int]]:
    """({(s, a): Tanzil tokens}, {(s, a): word count}) of the ayat where Tanzil and QAC agree."""
    words: dict[tuple[int, int], int] = {}
    for g in segs:
        words[(g.s, g.a)] = max(words.get((g.s, g.a), 0), g.w)
    tokens: dict[tuple[int, int], list[str]] = {}
    count: dict[tuple[int, int], int] = {}
    for k, n in words.items():
        toks = lesson_ayah(T, *k)[0].split(" ")
        if len(toks) == n:
            tokens[k], count[k] = toks, n
    return tokens, count


def places(segs: list, T, headword) -> dict[str, dict]:
    """{QAC lemma: {"loc": "s:a:w", "form": Tanzil token, "final": bool, "alone": bool}}, by the
    rule in the module docstring."""
    by_word: dict[tuple[int, int, int], list] = defaultdict(list)
    for g in segs:
        by_word[(g.s, g.a, g.w)].append(g)
    tokens, count = counted_alike(T, segs)
    found: dict[str, list[tuple]] = defaultdict(list)
    for key, gs in by_word.items():
        toks = tokens.get(key[:2])
        if toks is None:
            continue
        token = toks[key[2] - 1]
        others = len(gs) - 1
        article = others == 1 and any(x.features == "PREFIX|Al+" for x in gs)
        attached = 0 if others == 0 else 1 if article else 1 + others
        for g in gs:
            lem = g.feat.get("LEM")
            if lem:
                found[lem].append((attached, key, token, g.form))
    out = {}
    for lem, ps in found.items():
        target = skeleton(headword(lem))
        freq = Counter(p[2] for p in ps)

        def order(p: tuple) -> tuple:
            attached, key, token, stem = p
            return (2 * distance(skeleton(bw_to_ar(stem)), target) + attached, key[2] == count[key[:2]],
                    assimilated(token), -freq[token], key)

        attached, key, token, _ = min(ps, key=order)
        out[lem] = {"loc": ":".join(map(str, key)), "form": token, "final": key[2] == count[key[:2]], "alone": attached == 0}
    return out


def load_pins(path: Path = PINS) -> dict:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"words": {}}


def url_of(loc: str) -> str:
    s, a, w = (int(x) for x in loc.split(":"))
    return f"{W.QC_PREFIX}{s:03d}_{a:03d}_{w:03d}.mp3"


def upstream_of(loc: str) -> str:
    s, a, w = (int(x) for x in loc.split(":"))
    return f"{W.QC_UPSTREAM}wbw/{s:03d}_{a:03d}_{w:03d}.mp3"


def word_voice(pin: dict) -> dict:
    """What a word file carries: everything the word page shows and plays, and the URL host_media.py
    finds when it lists the files the content references."""
    out = {"form": pin["form"], "loc": pin["loc"], "url": url_of(pin["loc"]), "ms": pin["ms"], "start": pin["start"], "end": pin["end"], "sha256": pin["sha256"]}
    if pin.get("final"):
        out["final"] = True
    return out


def row_voice(pin: dict) -> str:
    """What an index row carries: "<loc> <start> <end>", one short string, because the index stays in
    the container's memory and the list only needs to play the word."""
    return f"{pin['loc']} {pin['start']} {pin['end']}"


def pin_problems(pins: dict, wanted: dict[str, dict] | None = None) -> list[str]:
    """The pins alone (CI), and against the rule's places when they are given (local, with the corpus)."""
    out = []
    words = pins.get("words") or {}
    for lem, p in words.items():
        loc = str(p.get("loc"))
        if not _LOC.fullmatch(loc):
            out.append(f"{lem}: {loc!r} is not a word's place")
            continue
        if not re.fullmatch(r"[0-9a-f]{64}", str(p.get("sha256"))):
            out.append(f"{lem}: sha256 is not 64 hex digits")
        if W.fold(p.get("qc_text", "")) != W.fold(p.get("form", "")):
            out.append(f"{lem}: Quran.com's word at {loc} is {p.get('qc_text')!r}, not {p.get('form')!r} (the file is another word)")
        ms, s0, s1 = p.get("ms"), p.get("start"), p.get("end")
        if not all(isinstance(x, int) and not isinstance(x, bool) for x in (ms, s0, s1)):
            out.append(f"{lem}: ms/start/end are not whole milliseconds")
        elif not (0 <= s0 < s1 <= ms) or not W.MIN_MS <= s1 - s0 <= W.MAX_MS:
            out.append(f"{lem}: [{s0}, {s1}] of {ms} ms is not a plausible word inside its file")
    if wanted is not None:
        for lem, w in wanted.items():
            p = words.get(lem)
            if p is None:
                out.append(f"{lem}: no recording pinned (build_kosakata_voice.py --fetch)")
            elif p.get("loc") != w["loc"] or p.get("form") != w["form"] or bool(p.get("final")) != w["final"]:
                out.append(f"{lem}: pinned {p.get('loc')} {p.get('form')!r}, but the rule chooses {w['loc']} {w['form']!r}")
        for lem in sorted(set(words) - set(wanted)):
            out.append(f"{lem}: pinned, but no such lemma")
    return out
