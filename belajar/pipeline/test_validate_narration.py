#!/usr/bin/env python3
"""Mutation tests for validate_narration.py: each case plants one fault in a copy of the narration
manifests (content/narration/*.json), of the lessons they are built from, of the pronunciation
dictionary (authored/pronunciation.json), of the lesson maps, of the curriculum
(content/curriculum.json), of the list it tolerates for now (authored/curriculum.pending.json) or
of the continuation data (authored/<slug>.structure.json `continues`, validate_narration.load_continues),
and asserts that the validator fails with the expected message. The unmutated copies must pass. Also unit-tests the speech text, the dictionary rendering
(spoken text, caption, karaoke tokens), the Indonesian numbers, the render request body (no
network) and the delivery encode (its name, its fixed flags, drift and token fit, one take per
file, the upload command; with ffmpeg on the machine, real encodes of generated tones, renders of
them with the voice API mocked, and encode_narration.py itself on a scratch output directory).
Standard library only; run from belajar/pipeline after build_narration.py:

    python3 test_validate_narration.py          # table of faults and the message that caught each
    python3 -m unittest test_validate_narration # the same as a unittest run
"""
from __future__ import annotations

import argparse
import contextlib
import copy
import io
import json
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import build_curriculum as BC
import build_narration as B
import curriculum as CUR
import encode_narration as E
import render_narration as R
import terms as TERMS
import validate_narration as V

MANIFESTS, LESSONS, LIBRARY = V.load_all()
COMPOSE = V.load_compose()
LESSONMAP = V.load_map()
CURRICULUM = V.load_curriculum()
PENDING = CUR.load_pending()
CONTINUES = V.load_continues()
# Named words as the captions show them (the content's bytes: never typed here).
_NAMED = V.Named(LESSONS, COMPOSE)
ALLAHI, SIRATA, BIRABBI, YUWASWISU = (V.named_shown(*_NAMED.refs[r]) for r in ("1:2:2/allahi", "1:6:2", "114:1:3", "114:5:2"))
LEXDATA = json.loads(V.PRONUNCIATION_JSON.read_text(encoding="utf-8"))
LEX = V.Lexicon(LEXDATA)
FORMS = V.Forms(LESSONS)
SHA = "a" * 64
VOICE = {"id": "v123", "name": "Suara Uji", "model": "eleven_v3"}


def run_check(m, ls, lx, cp=None, mp=None, cur=None, pend=None, cont=None):
    return V.check(m, ls, LIBRARY, lex=V.Lexicon(lx), compose=COMPOSE if cp is None else cp,
                   lessonmap=LESSONMAP if mp is None else mp, curriculum=CURRICULUM if cur is None else cur,
                   pending=PENDING if pend is None else pend, continues=CONTINUES if cont is None else cont)


def name_of(lid):
    return "shared" if lid.startswith("shared:") else lid.split(":")[0]


def line(m, lid):
    return m[name_of(lid)]["lines"][lid]


def set_field(lid, field, value):
    def f(m, *_):
        line(m, lid)[field] = value
    return f


def set_text(lid, text):
    return set_field(lid, "text", text)


def set_display(lid, text):
    return set_field(lid, "display", text)


def append_text(lid, extra):
    def f(m, *_):
        line(m, lid)["text"] += extra
    return f


def replace_in(lid, field, old, new):
    def f(m, *_):
        ln = line(m, lid)
        assert old in ln[field], f"{lid}.{field} has no {old!r}"
        ln[field] = ln[field].replace(old, new, 1)
    return f


def drop(lid):
    def f(m, *_):
        del m[name_of(lid)]["lines"][lid]
    return f


def add(lid, text):
    def f(m, *_):
        m[name_of(lid)]["lines"][lid] = {"text": text, "display": text, "highlight": [], "focus": None}
    return f


def fake_tokens(text, focus=None, display=None):
    """Tokens for `text` from a made-up alignment: 50 ms per character (`display`: the caption, for
    its named words)."""
    starts = [i * 0.05 for i in range(len(text))]
    ends = [i * 0.05 + 0.04 for i in range(len(text))]
    return LEX.tokens(text, starts, ends, FORMS.word_ar.get(focus) if focus else None, V.named_in_display(display),
                      LEX.text_cuts(display))


def good_audio(m, lid, text=None, *, fmt=V.DELIVERY_FORMAT):
    """The audio entry of a delivered file of `text` (default: the line's own) whose bytes hash to SHA."""
    text = text if text is not None else line(m, lid)["text"]
    return {"url": f"/belajar/media/narration/suara-uji/{name_of(lid)}/{V.delivery_name(text, VOICE['id'], SHA, fmt)}.mp3",
            "ms": len(text) * 50 + 500, "sha256": SHA}


def master_audio(m, lid):
    """The entry the manifests carried until 2026-10-11: the url of the 128 kbps master."""
    return {**good_audio(m, lid), "url": V.master_url(VOICE, name_of(lid), line(m, lid)["text"])}


def with_audio(lid, *, voice=True, tokens=True, audio=None, tweak=None):
    def f(m, *_):
        if voice:
            m[name_of(lid)]["voice"] = dict(VOICE)
        ln = line(m, lid)
        ln["audio"] = audio(m) if audio else good_audio(m, lid)
        if tokens:
            ln["tokens"] = fake_tokens(ln["text"], ln["focus"], ln.get("display"))
        else:
            ln.pop("tokens", None)
        if tweak:
            tweak(ln)
    return f


def tokens_only(lid):
    def f(m, *_):
        ln = line(m, lid)
        ln.pop("audio", None)
        ln["tokens"] = fake_tokens(ln["text"], ln["focus"], ln.get("display"))
    return f


def split_without_b(m, *_):
    lines = m["al-fatihah"]["lines"]
    old = lines.pop("al-fatihah:2:recap")
    lines["al-fatihah:2:recap:a"] = old


def gloss_changed(_m, lessons, *_):
    lessons["al-fatihah"]["ayat"][0]["words"][0]["gloss"] = "atas nama"


def lex_term(term, **changes):
    def f(_m, _l, lx, *_):
        t = next(x for x in lx["terms"] if x["term"] == term)
        t.update(changes)
    return f


def drop_shown_piece(ln):
    """The karaoke token that carries a shown-only word without it (as if it were never shown)."""
    for tk in ln["tokens"]:
        tk["t"] = V.NAMED_SHOWN.sub("", tk["t"]).replace(", yaitu ,", ",").strip() or tk["t"]


def lex_add(**entry):
    def f(_m, _l, lx, *_):
        lx["terms"].append(entry)
    return f


def non_applicable_exercise():
    """An (ayah, exercise) the page does not show, to plant an ex line for it."""
    for slug, lesson in LESSONS.items():
        for a in lesson["ayat"]:
            missing = [k for k in V.EXERCISE_KEYS if k not in V.exercise_counts(a, LIBRARY)]
            if missing:
                return f"{slug}:{a['ayah']}:ex:{missing[0]}:intro"
    raise AssertionError("every ayah shows every exercise; pick another fault")


def concept_line():
    return next(lid for lid in MANIFESTS["al-fatihah"]["lines"] if ":concept:" in lid)


LAHU_L = V.first_letter(FORMS.word_ar["112:4:3"])  # لَّ of lahu (112:4:3), with the shadda of the ayah
W = "al-fatihah:2:w1"
# Al-Fatihah 1's word lines are now the gloss + the composition's lead; the terms and the letter
# they used to carry are said in the composition lines (narration rule 14, 2026-10-10).
W11 = "al-fatihah:1:w1:compose:4"   # "… dhommah menjadi كَسْرَة …"
WBA = "al-fatihah:1:w1:compose:1"   # "… huruf بَاء, yang artinya dengan."
C1 = "al-fatihah:1:w1:compose:3"
# The structure told item by item (operator 2026-10-13): ayah 1's first two items.
S11, S12 = "al-fatihah:1:structure:1", "al-fatihah:1:structure:2"
LAM3 = "al-fatihah:1:w3:compose:3"  # "huruf ل": the bare lam of the frame's ٱلرَّحْمَٰن


# The line after the last of word 2's composition in Al-Fatihah 1, however many it has (three
# since its second `say` was split in two, 2026-10-13).
PAST_W2 = f"al-fatihah:1:w2:compose:{len(COMPOSE['al-fatihah']['words']['1:1:2']['lines']) + 1}"


def compose_say(loc, k, text):
    """A composition's k-th `say` changed in the content (the narration then lags behind it)."""
    def f(_m, _l, _x, cp, *_):
        cp["al-fatihah"]["words"][loc]["lines"][k - 1]["say"] = text
    return f


def item_say(ayah, k, text):
    """The k-th structure item's `say` changed in the lesson content (the narration then lags)."""
    def f(_m, ls, *_):
        ls["al-fatihah"]["ayat"][ayah - 1]["structure"]["items"][k - 1]["say"] = text
    return f


def item_words(ayah, k, words):
    def f(_m, ls, *_):
        ls["al-fatihah"]["ayat"][ayah - 1]["structure"]["items"][k - 1]["words"] = words
    return f


def no_items(ayah):
    """An ayah of Al-Fatihah told from its summary again (its items taken out of the content)."""
    def f(_m, ls, *_):
        del ls["al-fatihah"]["ayat"][ayah - 1]["structure"]["items"]
    return f


def why_basic(loc, text):
    """A word's `why_basic` changed (None: taken away) in the lesson content."""
    def f(_m, ls, *_):
        a, w = (int(x) for x in loc.split(":")[1:])
        word = ls["al-fatihah"]["ayat"][a - 1]["words"][w - 1]
        if text is None:
            del word["why_basic"]
        else:
            word["why_basic"] = text
    return f


def split_item(m, *_):
    lines = m["al-fatihah"]["lines"]
    old = lines.pop(S12)
    lines[S12 + ":a"] = dict(old)
    lines[S12 + ":b"] = dict(old)


def primer_lesson(value):
    """The primer's `lesson` marker changed in the compositions (None: taken away — the primer
    then opens its own ayah's lesson again)."""
    def f(_m, _l, _x, cp, *_):
        p = cp["al-fatihah"]["primer"]
        if value is None:
            p.pop("lesson", None)
        else:
            p["lesson"] = value
    return f


def drop_frame(lid):
    def f(m, *_):
        line(m, lid).pop("frame")
    return f


def split_compose(m, *_):
    lines = m["al-fatihah"]["lines"]
    old = lines.pop(C1)
    lines[C1 + ":a"] = dict(old)
    lines[C1 + ":b"] = dict(old)
# Audio faults go on a manifest that has no voice yet, on a line that is renderable (no Latin term).
AUD = next(lid for lid, ln in MANIFESTS["al-ikhlas"]["lines"].items() if ":w" in lid and not V.held_line(ln, LEX))
NA_EX = non_applicable_exercise()


def heavy_line():
    """A line without audio that speaks a heavy letter + a with no approved respelling (khabar…)."""
    return next(lid for man in MANIFESTS.values() for lid, ln in man["lines"].items()
                if "audio" not in ln and V.heavy_latin(ln["text"], LEX) and name_of(lid) != "al-fatihah")


HEAVY = heavy_line()


# A line whose caption names a word it does not say (a heavy letter: ṣirāṭa), and ayah 1's first
# structure item as authored (it names بِ and ٱسْمِ, said).
SHOWN_ONLY = "al-fatihah:7:w1"
SHOWN_ISIM = "al-fatihah:6:w2:compose:1"  # "isim (اِسْم)," then the shown-only ", yaitu صِرَٰط (ṣirāṭ)," (2026-10-17)


def merge_shown_token(lid):
    """The shown-only piece glued back onto the word that already shows Arabic: ONE karaoke word
    "isim (اِسْم), yaitu صِرَٰط (ṣirāṭ)," with two Arabic units, as rendered 2026-10-17."""
    def f(m, *_):
        toks = line(m, lid)["tokens"]
        k = next(i for i, tk in enumerate(toks) if tk["t"] == "isim (اِسْم),")
        toks[k:k + 2] = [{**toks[k], "t": toks[k]["t"] + " " + toks[k + 1]["t"]}]
    return f


def retime_shown_token(lid):
    """The shown-only token given a time of its own (made up: no spoken character has it)."""
    def f(m, *_):
        toks = line(m, lid)["tokens"]
        k = next(i for i, tk in enumerate(toks) if tk["t"].startswith("yaitu "))
        toks[k] = {**toks[k], "e": round(toks[k]["e"] + 0.001, 3)}
    return f
ITEM11_SAY = LESSONS["al-fatihah"]["ayat"][0]["structure"]["items"][0]["say"]


def unnamed_text(ln):
    """A line's spoken text with the named words its caption shows masked: a named word is said in
    Latin on purpose (its sound: the warm-up's تَ (ta) is no letter name), as check_renderable and
    held_line read a line."""
    return V.mask_named_said(ln["text"], [s for s, _ in V.named_in_display(ln.get("display"))])


def latin_line():
    """A line without audio that says an Arabic term in Latin (mubtada', fa'il…) and no heavy letter."""
    return next(lid for man in MANIFESTS.values() for lid, ln in man["lines"].items()
                if "audio" not in ln and V.latin_terms(unnamed_text(ln), LEX) and not V.heavy_latin(ln["text"], LEX))


LATIN = latin_line()
W79 = "al-fatihah:7:w9:compose:3"   # the doubled lam of ٱلضَّآلِّينَ, pinned by its frame (`letters`)
LAM79 = V.COMPOSE.pieces(FORMS.word_ar["1:7:9"])[-3]  # that lam with its shadda and kasrah, from the bytes
LAM79_BARE = V.COMPOSE.pieces(FORMS.word_ar["1:7:9"])[1]  # the article's bare lam of the same word


def lex_drop(term, field):
    def f(_m, _l, lx, *_):
        next(x for x in lx["terms"] if x["term"] == term).pop(field)
    return f


def swap_first_tokens(ln):
    ln["tokens"][0]["s"], ln["tokens"][1]["s"] = ln["tokens"][1]["s"], ln["tokens"][0]["s"]


def bad_token_text(ln):
    ln["tokens"][0]["t"] = "Kalimat"


def cut_by(ms):
    """A take cut short: its audio `ms` milliseconds shorter than its last token's end (ElevenLabs
    returned al-fatihah:0:primer:1 111 ms short of its own alignment, 2026-10-17)."""
    def f(ln):
        ln["audio"]["ms"] = round(max(t["e"] for t in ln["tokens"]) * 1000) - ms
    return f


def named_letter(lid, name):
    """The first single letter its caption shows alone (after "huruf "), with its Latin name put back
    beside it in brackets, as captions had it until 2026-10-17 ("huruf ra' (رَّ)")."""
    def f(m, *_):
        ln = line(m, lid)
        hit = re.search(r"huruf ([\u0621-\u064a][\u064b-\u065f\u0670]*)(?=[ ,.;])", ln["display"])
        assert hit, f"{lid} shows no letter alone"
        ln["display"] = ln["display"][:hit.start()] + f"huruf {name} ({hit.group(1)})" + ln["display"][hit.end():]
    return f


def retoken(lid, old, new):
    """A karaoke token's text changed (the audio and its timings left as they are)."""
    def f(m, *_):
        toks = [t for t in line(m, lid)["tokens"] if t["t"] == old]
        assert toks, f"{lid} has no token {old!r}"
        toks[0]["t"] = new
    return f


# --- the lesson map's lines (operator 2026-10-13, plan L23 and L26): one step per group of the
# card, one sentence per line (2026-10-15)
N1, N2, N3, N4 = (f"al-fatihah:{n}:map:new" for n in (1, 2, 3, 4))
L1, L2, L3 = (f"al-fatihah:{n}:map:learnt" for n in (1, 2, 3))
G1, G2, G3 = (f"al-fatihah:{n}:map:again" for n in (1, 2, 3))
T1, T2, T3 = (f"al-fatihah:{n}:map:later" for n in (1, 2, 3))
F1, F2, F3 = (f"al-fatihah:{n}:map:focus" for n in (1, 2, 3))
S1, S3, S7 = (f"al-fatihah:{n}:map:total" for n in (1, 3, 7))
# Al-Ikhlas 4 (2026-10-19): its running total, 28 steps, said unit by unit — the count, then two groups.
K4, K41, K42 = "al-ikhlas:4:map:total", "al-ikhlas:4:map:total:1", "al-ikhlas:4:map:total:2"


def both(lid, old, new, old_said=None, new_said=None):
    """The same change in a line's caption and in its spoken text (so that only what the line SAYS
    is at fault, not a caption that differs from the speech)."""
    def f(m, *_):
        ln = line(m, lid)
        said_old, said_new = (old if old_said is None else old_said), (new if new_said is None else new_said)
        assert old in ln["display"] and said_old in ln["text"], f"{lid} has no {old!r} / {said_old!r}"
        ln["display"] = ln["display"].replace(old, new, 1)
        ln["text"] = ln["text"].replace(said_old, said_new, 1)
    return f


def unname(lid):
    """The named word taken out of a line that names a word by its place: "Kata pertama, yaitu
    ٱلْحَمْدُ (al-ḥamdu), artinya: …" → "Kata pertama artinya: …", in its caption and its speech."""
    def f(m, *_):
        ln = line(m, lid)
        said = V.named_in_display(ln["display"])[0][0]
        d0, t0 = ln["display"], ln["text"]
        ln["display"] = re.sub(r",(?: yaitu)? " + V.NAMED_SHOWN.pattern + ",", "", d0, count=1)
        ln["text"] = re.sub(r",(?: yaitu)? " + re.escape(said) + ",", "", t0, count=1)
        assert ln["display"] != d0 and ln["text"] != t0, lid
    return f


def more(lid, shown, said=None):
    """A sentence added to a line, in its caption and in its spoken text."""
    def f(m, *_):
        ln = line(m, lid)
        ln["display"] += " " + shown
        ln["text"] += " " + (shown if said is None else said)
    return f


def in_map(fn):
    """A fault in the lesson map itself (content/map/al-fatihah.json)."""
    def f(_m, _l, _x, _c, mp, *_):
        fn(mp["al-fatihah"])
    return f


def in_cur(fn):
    """A fault in the curriculum (content/curriculum.json)."""
    def f(_m, _l, _x, _c, _mp, cur, *_):
        fn(cur)
    return f


def in_pending(fn):
    """A fault in the list of what is tolerated for now (authored/curriculum.pending.json)."""
    def f(_m, _l, _x, _c, _mp, _cur, pend, *_):
        fn(pend["lines"])
    return f


def in_continues(fn):
    """A fault in the continuation data (authored/<slug>.structure.json `continues`, load_continues)."""
    def f(_m, _l, _x, _c, _mp, _cur, _pend, cont):
        fn(cont)
    return f


def link_of(cont, slug, ayah, k):
    return cont[slug]["ayat"][ayah]["links"][k]


def listed(lid, terms):
    """The list of what is tolerated for now says `lid` uses `terms` too early."""
    return in_pending(lambda p: p.__setitem__(lid, list(terms)))


def then(*faults):
    """Several changes as ONE planted fault (a use, and the list's entry for it)."""
    def f(*args):
        for fault in faults:
            fault(*args)
    return f


# The first explanation of ayah 2's warm-up ("Kata pertama adalah isim …").
W21 = "al-fatihah:2:ex:word-kind:1:why"

# A sentence that names a term before its lesson, as (caption, speech) for `more`: idhafah is
# taught in ayah 4, badal in An-Nas 2, isim fa'il at the next level.
EARLY = ("Ini idhafah (إِضَافَة).", "Ini idhofah.")
EARLY_TWO = ("Ini idhafah (إِضَافَة) dan badal (بَدَل).", "Ini idhofah dan بَدَل.")
NEXT_LEVEL = ("Ini isim fa’il (اِسْم فَاعِل).", "Ini اِسْم فَاعِل.")


def map_entry(mp, ayah):
    return next(a for a in mp["ayat"] if a["ayah"] == ayah)


def cur_lesson(cur, lid):
    return next(x for x in cur["lessons"] if x["id"] == lid)


def cur_step(cur, sid):
    return next(x for x in cur["steps"] if x["id"] == sid)


def first_sentence_only(lid):
    def f(m, *_):
        ln = line(m, lid)
        for k in ("text", "display"):
            ln[k] = ln[k].split(". ")[0] + "."
    return f


def split_map(m, *_):
    lines = m["al-fatihah"]["lines"]
    old = lines.pop(G2)
    lines[G2 + ":a"] = dict(old)
    lines[G2 + ":b"] = dict(old)


# (name, mutation(manifests, lessons, pronunciation data, compositions, lesson maps, curriculum,
# pending list), substring the failure message must contain)
MUTATIONS = [
    ("empty text", set_text(W, ""), "empty text"),
    ("Arabic script", append_text(W, " Lafaznya الله."), "Arabic script"),
    ("Qur'anic word, plain transliteration", append_text(W, " Ini kata rabbi."), "Qur'anic word 'rabbi'"),
    ("Qur'anic word without its ending", append_text(W, " Bandingkan al-hamd."), "Qur'anic word 'al-hamd'"),
    ("Qur'anic part of a word (wa)", append_text(W, " Lalu wa menyambung."), "Qur'anic word 'wa'"),
    ("Qur'anic phrase run together", set_text("shared:start", "Bismillah, mari kita mulai."), "Qur'anic phrase 'Bismillah'"),
    ("Indonesian spelling (a'udzu)", append_text(W, " Lalu a'udzu."), "Qur'anic word \"a'udzu\" (another spelling"),
    ("Indonesian spelling (ash-shirath)", append_text(W, " Yaitu ash-shirath."), "Qur'anic word 'shirath' (another spelling"),
    ("Indonesian spelling (ghairi)", append_text(W, " Lalu ghairi."), "Qur'anic word 'ghairi' (another spelling"),
    ("another case ending (rabbu)", append_text(W, " Ini rabbu."), "Qur'anic word 'rabbu' (another spelling or ending)"),
    ("pausal form of a mabni word (khalaq)", append_text(W, " Sama dengan khalaq."), "Qur'anic word 'khalaq'"),
    ("ta marbuta spelled -ah (al-jinnah)", append_text(W, " Dari al-jinnah."), "Qur'anic word 'jinnah'"),
    ("two words run together (huwallahu)", append_text(W, " Seperti huwallahu."), "Qur'anic phrase 'huwallahu'"),
    ("the front of a word ('ala)", append_text("al-fatihah:7:w4", " 'Ala lagi."), "Qur'anic word \"'Ala\""),
    ("bare Allah in the caption", set_display("shared:correct", "Benar, Allah Maha Tahu."), "Qur'anic word 'Allah'"),
    ("lam not naming the letter", append_text("al-ikhlas:3:w2", " Lam meniadakan."), "Qur'anic word 'Lam'"),
    ("surah name without 'Surah'", append_text(W, " Seperti di An-Nas."), "Qur'anic word 'An-Nas'"),
    ("transliteration diacritic", append_text(W, " Ini ḥamd."), "transliteration diacritic"),
    ("a word of another ayah by its place", append_text("al-fatihah:3:w1", " Lihat kata kedua di ayat dua."),
     "names a word of another ayah by its place"),
    ("a place inside a place", append_text(W, " Seperti kata kedua dalam kata ketiga."), "a word place inside another"),
    ("a concept title turned into a place", lambda m, *_: line(m, concept_line()).__setitem__("text", "Konsep baru: Kata pertama: menafikan."),
     "the concept's title became a word place"),
    ("a card the stage does not show", append_text(W, " Lihat di kartu ini."), "refers to a card"),
    ("a place past the ayah's last word", append_text("al-ikhlas:1:w1", " Lihat kata kesembilan."),
     "names word 9 of an ayah with 4 words"),
    ("digit", append_text(W, " Lihat ayat 3."), "digit in narration"),
    ("ALL-CAPS emphasis", append_text(W, " JANGAN lupa."), "ALL-CAPS word 'JANGAN'"),
    ("line too long", set_text(W, "Kata pertama. " * 30), "more than 400"),
    ("stray whitespace", set_text(W, " Kata pertama."), "stray whitespace"),
    ("missing word line", drop("al-fatihah:7:w9"), "missing line al-fatihah:7:w9"),
    ("word line past the last word", add("al-fatihah:1:w5", "Kata kelima."), "unexpected line al-fatihah:1:w5"),
    ("concept line missing", lambda m, *_: m["al-fatihah"]["lines"].pop(concept_line()), "missing line"),
    ("exercise the ayah does not show", add(NA_EX, "Latihan."), f"unexpected line {NA_EX}"),
    ("id outside the contract", add("al-fatihah:1:word1", "Kata."), "does not follow the step-id contract"),
    ("shared line missing", lambda m, *_: m["shared"]["lines"].pop("shared:reminder"), "missing line shared:reminder"),
    ("split part without its partner", split_without_b, "split parts of 'al-fatihah:2:recap'"),
    ("line without its caption", lambda m, *_: line(m, W).pop("display"), "a line is {text, display, highlight, focus"),
    ("audio without a voice", with_audio(AUD, voice=False), "names no voice"),
    ("audio url off the media path", with_audio(AUD, audio=lambda m: {**good_audio(m, AUD), "url": "https://cdn.example.com/a.mp3"}),
     "under /belajar/media/narration/"),
    ("audio ms zero", with_audio(AUD, audio=lambda m: {**good_audio(m, AUD), "ms": 0}), "ms must be a positive integer"),
    ("audio without sha256", with_audio(AUD, audio=lambda m: {"url": good_audio(m, AUD)["url"], "ms": 4200}),
     "exactly {url, ms, sha256}"),
    ("audio of an older text (stale file name)", with_audio(AUD, audio=lambda m: good_audio(m, AUD, "Teks lama.")),
     "a changed line needs a new render"),
    # --- delivery at 64 kbps mono (operator 2026-10-11): the url names the DELIVERED file, by its
    # text, the delivery format and its bytes
    ("audio url naming the 128 kbps master", with_audio(AUD, audio=lambda m: master_audio(m, AUD)),
     "is the name of the mp3_44100_128 master, not of the delivered file"),
    ("audio sha256 of other bytes than the file is named by",
     with_audio(AUD, audio=lambda m: {**good_audio(m, AUD), "sha256": "b" * 64}), "a changed file a new name"),
    ("audio named with another delivery format tag",
     with_audio(AUD, audio=lambda m: good_audio(m, AUD, fmt="mp3_44100_128_mono")),
     "the delivery format mp3_44100_64_mono"),
    ("voice model not the house standard",
     lambda m, *_: m["al-fatihah"].__setitem__("voice", {"id": "v", "name": "n", "model": "eleven_v4"}),
     "not the house standard"),
    ("hand-edited line", set_text(W, "Kata pertama artinya: segala puji. Akhirnya dhommah."), "out of date"),
    ("content changed, narration stale", gloss_changed, "does not give the gloss"),
    ("intro without the translation", set_text("al-fatihah:3:intro", "Ayat ketiga Surah Al-Fatihah."),
     "does not read the translation"),
    # --- the pronunciation dictionary (operator review of the Al-Fatihah 1 preview, 2026-10-10)
    # مُسْتَتِر: a term of the Konsep table the pronunciation dictionary does not have (مُبْتَدَأ, the
    # earlier example, is in it since 2026-10-11).
    ("Arabic that is not a dictionary term", append_text(W, " Ini مُسْتَتِر."),
     "not a pronunciation-dictionary term"),
    ("Qur'anic word in Arabic script", append_text(W, " Lalu بِسْمِ."), "Qur'anic word 'بِسْمِ' (Arabic script)"),
    # In the line of the lesson that teaches the term (the idhafah "Konsep baru" line of ayah 4):
    # until 2026-10-13 a word line of ayah 1 said it, three lessons early.
    ("heavy-letter term spoken from Arabic", replace_in("al-fatihah:4:concept:idhafah", "text", "mudhof ilaih", "مُضَاف إِلَيْه"),
     "not a pronunciation-dictionary term"),
    ("grammar term left in Latin", replace_in(W11, "text", "كَسْرَة", "kasrah"),
     "'kasrah' must be spoken from the pronunciation dictionary"),
    ("Allah not said Alloh", replace_in("al-fatihah:1:intro", "text", "Alloh", "Allah"),
     "'Allah' must be spoken from the pronunciation dictionary (Alloh)"),
    ("dictionary: heavy letter without a respelling", lex_term("ضَمِير", speak="ضَمِير"),
     "heavy letter with fathah/alif needs a fixed Latin respelling"),
    ("dictionary: a Qur'anic word as a term (عَلَى)", lex_add(term="عَلَى", speak="عَلَى", display="‘ala (عَلَى)"),
     "Qur'anic word 'عَلَى'"),
    ("dictionary: Arabic speak that is not the term", lex_term("نَعْت", speak="نَعْتٌ"),
     "speak must be the term itself"),
    ("caption differs from the speech", replace_in(W11, "display", "kasrah (كَسْرَة)", "fathah (فَتْحَة)"),
     "display does not say what is spoken"),
    ("caption names the letter", replace_in(LAM3, "display", "huruf ل ", "huruf لَام "),
     "caption shows the letter lam by its name"),
    # A single letter is shown ALONE, without its Latin name (operator 2026-10-17, on the Pengantar: "we
    # dont need to write “ba’” here, only the arabic one is enough, also apply this rule to similar sentences")
    ("a lesson-zero caption with the letter's Latin name beside it (ba’)",
     replace_in("al-fatihah:0:primer:5", "display", "huruf ب ini", "huruf ba’ (ب) ini"),
     "al-fatihah:0:primer:5: caption names the letter in Latin beside it ('ba’ (ب)')"),
    ("… sin, as the frame writes it", replace_in("al-fatihah:0:primer:10", "display", "huruf سْ dibaca", "huruf sin (سْ) dibaca"),
     "al-fatihah:0:primer:10: caption names the letter in Latin beside it ('sin (سْ)')"),
    ("… alif, the small upright alif's line", replace_in("al-fatihah:0:primer:13", "display", "lagi: ا kecil", "lagi: alif (ا) kecil"),
     "al-fatihah:0:primer:13: caption names the letter in Latin beside it ('alif (ا)')"),
    ("… with a straight apostrophe, in an ayah's line", named_letter(LAM3, "ra'"),
     f"{LAM3}: caption names the letter in Latin beside it"),
    ("… in a karaoke word of a rendered line", retoken("al-fatihah:0:primer:3", "ب", "ba’ (ب)"),
     "al-fatihah:0:primer:3: tokens do not join to the display rendering of the spoken text"),
    # sin is said "sin" (operator 2026-10-17: "you read it siiiin, i think sin is enough"): the Arabic
    # script سِين, which the voice drew out, is no longer the dictionary's
    ("sin spoken from Arabic script again", both("al-fatihah:0:primer:9", "huruf س ini", "huruf س ini", "huruf sin ini", "huruf سِين ini"),
     "Arabic script in spoken text that is not a pronunciation-dictionary term: 'سِين'"),
    # (on lahū's composition since 2026-10-19: its word line no longer explains the letter)
    ("caption letter not as in the ayah", replace_in("al-ikhlas:4:w3:compose:7", "display", f"Huruf {LAHU_L} ", "Huruf لِ "),
     f"the letter as in the ayah is {LAHU_L}"),
    ("quotes left in the spoken text", replace_in(WBA, "text", "artinya dengan.", "artinya “dengan”."),
     "character not allowed in spoken text"),
    ("tokens that do not join to the caption", with_audio(AUD, tweak=bad_token_text), "tokens do not join"),
    ("tokens out of time order", with_audio(AUD, tweak=swap_first_tokens), "starts before the token before it"),
    ("tokens without audio", tokens_only(AUD), "tokens without audio"),
    # named words (operator 2026-10-17: "Kata pertama diawali huruf jar yaitu XXX yang artinya …";
    # "say bi instead of ba"; "should also mention the arabic word not only artinya"): the content's
    # bytes and transliteration in the caption, the transliteration said there — and nowhere else
    ("a named word whose Arabic is not the content's", replace_in(S11, "display", "بِ (bi)", "بَ (bi)"),
     f"{S11}: caption names 'بَ (bi)', which is no lesson word or composition form"),
    ("a named word with another transliteration", both(S11, "ٱسْمِ (ismi)", "ٱسْمِ (ismu)", "ismi", "ismu"),
     f"{S11}: caption names 'ٱسْمِ (ismu)', which is no lesson word"),
    ("a lesson word said in Latin where the caption does not name it", more(S11, "Lalu ismi.", "Lalu ismi."),
     f"{S11}: Qur'anic word 'ismi' in narration"),
    ("a named word said otherwise than its caption names it", replace_in(S11, "text", "yaitu ismi", "yaitu ismu"),
     f"{S11}: display does not say what is spoken"),
    ("a named word said from Arabic script", replace_in(S11, "text", "yaitu bi yang", "yaitu بِ yang"),
     "Arabic script in spoken text that is not a pronunciation-dictionary term: 'بِ'"),
    # the operator's wording (README "Operator's lesson-wording rules")
    ("what a later ayah teaches said the old way", more(W, "Ini kita pelajari di ayat keempat."),
     f"{W}: says 'kita pelajari di ayat ' of what a later ayah teaches"),
    ("… and “baru kita bahas nanti”", more(W, "Gunanya baru kita bahas nanti."), f"{W}: says 'kita bahas nanti'"),
    ("a grammatical estimate in jargon", more(W, "Para ulama memperkirakannya sebagai “tetap”."),
     f"{W}: says 'memperkirakannya': say “para ulama memahaminya"),
    ("a word named only by its meaning", more(W, "Seperti kata yang artinya “jalan” di ayat keenam."),
     f"{W}: names a word only by its meaning ('kata yang artinya')"),
    ("a part named only by its meaning", more(W, "Bagian kedua adalah huruf yang artinya “bukan”."),
     f"{W}: names a word only by its meaning ('huruf yang artinya')"),
    # a word named by its place and its meaning only (operator 2026-10-17, rule 26 "every one … even
    # when the stage highlights that word"), and a pointer at an earlier ayah (rule 29)
    ("a word line by its place and meaning only, as until 2026-10-17", unname(W),
     f"{W}: names a word by its place and meaning only ('Kata pertama artinya')"),
    ("a quiz explanation by its place and meaning only", unname("al-fatihah:1:ex:tap-word:1:why"),
     "al-fatihah:1:ex:tap-word:1:why: names a word by its place and meaning only ('kata pertama yang artinya')"),
    ("a Konsep example by “kata ini” and its meaning only", unname("al-fatihah:0:concept:kalimah-isim-fiil-huruf:ex:3"),
     "al-fatihah:0:concept:kalimah-isim-fiil-huruf:ex:3: names a word by its place and meaning only ('Kata ini yang artinya')"),
    ("“yang pertama artinya …” without its word", unname("al-fatihah:0:concept:kalimah-isim-fiil-huruf:ex:5"),
     "al-fatihah:0:concept:kalimah-isim-fiil-huruf:ex:5: names a word by its place and meaning only ('yang pertama artinya')"),
    ("a run of words by its places and meaning only", more(W, "Kata ketiga dan keempat, yang artinya “Tuhan seluruh alam”."),
     f"{W}: names a word by its place and meaning only ('Kata ketiga dan keempat, yang artinya')"),
    ("a structure item by a place the build cannot name (kata itu)", item_say(1, 2, "Kata itu, yang artinya “nama”, disandarkan kepada kata kedua."),
     "names a word by its place and meaning only ('Kata itu, yang artinya')"),
    # a part (a composition's tile) named by its kind and meaning only, and a word named twice
    # (operator 2026-10-17, "Sibling lines")
    ("a composition part by its kind and meaning only, as until 2026-10-17", unname("al-fatihah:1:w3:compose:2"),
     "al-fatihah:1:w3:compose:2: names a part by its kind and meaning only ('Bagian kedua adalah isim (اِسْم)'"),
    ("… a heavy-letter part, its caption-only name taken out",
     both("al-fatihah:6:w2:compose:1", "isim (اِسْم), yaitu صِرَٰط (ṣirāṭ), yang", "isim (اِسْم) yang", "اِسْم, yang", "اِسْم yang"),
     "al-fatihah:6:w2:compose:1: names a part by its kind and meaning only ('Alif lam (ٱل) bersambung dengan isim (اِسْم)'"),
    ("… the second part of a join line",
     both("al-fatihah:7:w7:compose:1", "dhamir (ضَمِير), yaitu هِمْ (him), yang", "dhamir (ضَمِير) yang", "dhomir, yaitu him, yang", "dhomir yang"),
     "al-fatihah:7:w7:compose:1: names a part by its kind and meaning only ('bersambung dengan dhamir (ضَمِير)'"),
    ("… in the composition's own say", compose_say("1:7:4", 7, "Dhamir yang artinya “mereka” ini merujuk kepada kata kedua: merekalah yang diberi nikmat."),
     "al-fatihah:7:w4:compose:7: names a part by its kind and meaning only ('Dhamir (ضَمِير)'"),
    ("a word named twice in its own line, as until 2026-10-17 (An-Nas 4)",
     both("an-nas:4:w1", "Kata ini adalah", "Kata ini, yaitu مِن (min), yang artinya “dari”, adalah", "Kata ini adalah",
          "Kata ini, yaitu min, yang artinya dari, adalah"),
     "an-nas:4:w1: names 'مِن (min)' twice in one line"),
    ("a word named in two parts of one split line, as until 2026-10-17 (Al-Falaq 3)",
     both("al-falaq:3:structure:b", "dengan kata kerja tempat frasa ini bergantung,", "dengan kata أَعُوذُ (a‘ūżu) yang artinya “aku berlindung”",
          "dengan kata kerja tempat frasa ini bergantung,", "dengan kata a'udzu yang artinya aku berlindung"),
     "al-falaq:3:structure: names 'أَعُوذُ (a‘ūżu)' in more than one of its parts"),
    # the kinds of word MET HERE are the ayah's own (operator 2026-10-18: "we always say in this ayat we find
    # 3 jenis kata: isim, fi'il, huruf. But actually in that ayat (example ayat-3) we only have isim")
    ("ayah 3's map:again naming isim, fi'il and huruf, as until 2026-10-18",
     then(set_display(G3, "Dari yang sudah kita pelajari, yang kita temui lagi di ayat ini adalah harakat, tiga jenis kata, yaitu isim (اِسْم), fi’il (فِعْل), dan huruf (حَرْف), serta majrur (مَجْرُور)."), set_text(G3, "Dari yang sudah kita pelajari, yang kita temui lagi di ayat ini adalah harakat, tiga jenis kata, yaitu اِسْم, فِعْل, dan حَرْف, serta مَجْرُور.")),
     f"{G3}: names isim, fi'il, huruf as met in this ayah"),
    ("ayah 3 said to have a fi'il", both(G3, "hanya ada isim (اِسْم).", "hanya ada isim (اِسْم) dan fi’il (فِعْل).", "hanya ada اِسْم.", "hanya ada اِسْم dan فِعْل."),
     f"{G3}: says this ayah has 'isim (اِسْم) dan fi’il (فِعْل)' of the kinds of word; its words are isim"),
    ("ayah 4's kinds of word left out", first_sentence_only("al-fatihah:4:map:again"),
     "al-fatihah:4:map:again: does not say which kinds of word this ayah has (isim)"),
    ("ayah 7 said to have fewer kinds than its three",
     more("al-fatihah:7:map:again", "Dari tiga jenis kata itu, di ayat ini hanya ada isim (اِسْم).", "Dari tiga jenis kata itu, di ayat ini hanya ada اِسْم."),
     "al-fatihah:7:map:again: says which kinds of word this ayah has"),
    ("the lesson map's kinds of ayah 6 wrong (no fi'il)", in_map(lambda mp: map_entry(mp, 6)["kinds"].remove("fiil")),
     "al-fatihah:6:map:again: says this ayah has 'isim (اِسْم) dan fi’il (فِعْل)' of the kinds of word; its words are isim"),
    ("a comparison with an earlier ayah", more(W, "Sama seperti di ayat pertama."),
     f"{W}: points back at an earlier ayah ('ayat pertama')"),
    ("“ayat sebelumnya”", more("al-ikhlas:2:structure:b", "Ia menegaskan isi ayat sebelumnya."),
     "al-ikhlas:2:structure:b: points back at an earlier ayah ('ayat sebelumnya')"),
    ("a comparison with an earlier ayah in a composition", compose_say("1:3:1", 4, "Sebabnya, kata ini sekali lagi menjadi sifat bagi nama Allah di ayat kedua."),
     "points back at an earlier ayah ('ayat kedua')"),
    # … but a DEPENDENCY on an earlier ayah is said (operator 2026-10-18: "we need to remind some ayat
    # is continuing previous ayat … mention which word"): the opening "Ayat ini melanjutkan ayat …"
    # and the earlier word named and cited, where the authored `continues` data says
    ("a dependency's citation taken out, as 2026-10-17 to 2026-10-18",
     then(both("al-fatihah:3:w1:compose:4", " di ayat kedua", "", " di ayat kedua", ""),
          both("al-fatihah:3:w1:compose:5", " di ayat kedua", "", " di ayat kedua", "")),
     f"al-fatihah:3:w1: depends on '{ALLAHI}' of ayah 2 (na't (sifat), the data): its explanation says so"),
    # the clearer explanation (operator 2026-10-18: "give more clear explanation"): the word that says
    # why the earlier word ends as it does is a word of the ayah the line cites — never uncited
    ("the reason's earlier word named without its ayah",
     both("al-fatihah:3:w1:compose:5", " di ayat kedua,", ",", " di ayat kedua,", ","),
     f"al-fatihah:3:w1:compose:5: names '{ALLAHI}', a word of ayah 2, without saying which ayah"),
    # THE REMINDER CARD (operator 2026-10-18: "better to remind user what that previous ayat looks
    # like"): every line that says the continuation or cites an earlier word carries the card of
    # that ayah, its cited word highlighted, and no other line carries one
    ("a continuing ayah's opening without its reminder card", lambda m, *_: line(m, "al-fatihah:3:structure:1").pop("reminder"),
     "al-fatihah:3:structure:1: reminder card None, and the line says the continuation or cites [{'ayah': 2, 'words': [2]}]"),
    ("a continuing ayah without any reminder card", lambda m, *_: [ln.pop("reminder", None) for lid, ln in m["al-fatihah"]["lines"].items()
                                                                 if lid.startswith("al-fatihah:7:")],
     "al-fatihah:7: continues ayah 6 (the data), and no line of it carries the reminder card of that ayah"),
    ("a card whose highlighted word is not in the earlier ayah", set_field("al-fatihah:3:structure:1", "reminder", [{"ayah": 2, "words": [9]}]),
     "al-fatihah:3:structure:1: reminder {'ayah': 2, 'words': [9]} is not a card of an earlier ayah of the surah with words of it highlighted"),
    ("a card highlighting a word the line does not cite", set_field("al-fatihah:7:w1:compose:3", "reminder", [{"ayah": 6, "words": [1]}]),
     "al-fatihah:7:w1:compose:3: reminder card [{'ayah': 6, 'words': [1]}], and the line says the continuation or cites [{'ayah': 6, 'words': [2]}]"),
    # 2026-10-19: لَمْ (lam), cited in Al-Ikhlas 4, is word 1 of ayah 3 and also the form `lam` of
    # word 3's composition (wa lam): the card lights the cited WORDS, never a word only a form shares
    # its bytes with (as it did, [1, 2, 3], once Al-Ikhlas had compositions).
    ("a card that lights a word whose composition form shares the cited word's bytes (wa lam of 112:3:3)",
     set_field("al-ikhlas:4:w1:compose:5", "reminder", [{"ayah": 3, "words": [1, 2, 3]}]),
     "al-ikhlas:4:w1:compose:5: reminder card [{'ayah': 3, 'words': [1, 2, 3]}], and the line says the continuation or cites [{'ayah': 3, 'words': [1, 2]}]"),
    ("a card of a later ayah", set_field("al-fatihah:3:structure:1", "reminder", [{"ayah": 4, "words": [1]}]),
     "al-fatihah:3:structure:1: reminder {'ayah': 4, 'words': [1]} is not a card of an earlier ayah"),
    ("a card on a line that cites nothing", set_field("al-fatihah:3:w1:compose:3", "reminder", [{"ayah": 2, "words": [2]}]),
     "al-fatihah:3:w1:compose:3: reminder card [{'ayah': 2, 'words': [2]}], and the line says no continuation and cites no earlier word: no card"),
    ("a card on a quiz explanation (the stage shows the exercise there)",
     set_field("al-fatihah:3:ex:why-harakat:1:why", "reminder", [{"ayah": 2, "words": [2]}]),
     "al-fatihah:3:ex:why-harakat:1:why: reminder card [{'ayah': 2, 'words': [2]}], and the line says no continuation"),
    ("… in a quiz explanation (An-Nas 2)", both("an-nas:2:ex:why-harakat:1:why", " di ayat pertama,", "", " di ayat pertama,", ""),
     f"an-nas:2:ex:why-harakat:1:why: names '{BIRABBI}', a word of ayah 1, without saying which ayah"),
    ("… in a structure line (An-Nas 6, a phrase's hal)", both("an-nas:6:structure:b", " di ayat kelima", "", " di ayat kelima", ""),
     f"an-nas:6:structure: words [1, 2, 3] depend on '{YUWASWISU}' of ayah 5"),
    ("the continuation sentence taken out", both("al-fatihah:3:structure:1", " Ayat ini melanjutkan ayat kedua.", ""),
     "al-fatihah:3:structure:1: ayah 3 continues ayah 2 (the data): its structure part opens with “Ayat ini melanjutkan ayat kedua.”"),
    ("… said of an ayah the data does not continue",
     both("al-fatihah:6:structure:1", "Sekarang susunan kalimatnya.", "Sekarang susunan kalimatnya. Ayat ini melanjutkan ayat kelima."),
     "al-fatihah:6:structure:1: says 'Ayat ini melanjutkan ayat kelima', but the data has no continuation of ayah 5"),
    ("… the wrong ayah", both("al-fatihah:4:structure:1", "melanjutkan ayat kedua", "melanjutkan ayat ketiga"),
     "al-fatihah:4:structure:1: says 'Ayat ini melanjutkan ayat ketiga', but the data has no continuation of ayah 3"),
    ("a hedged continuation said without its hedge",
     both("al-ikhlas:2:structure:a", "Menurut al-Mujtaba dan al-Jadwal, ayat ini", "Ayat ini"),
     "al-ikhlas:2:structure:a: ayah 2 continues ayah 1 (the data): its structure part opens with “Menurut al-Mujtaba dan al-Jadwal, ayat ini melanjutkan ayat pertama.”"),
    ("a continuation in a later structure line",
     both("al-fatihah:7:structure:2", "Kata pertama disandarkan", "Ayat ini melanjutkan ayat keenam. Kata pertama disandarkan"),
     "al-fatihah:7:structure:2: 'Ayat ini melanjutkan ayat keenam' again: the continuation is said once"),
    ("a citation of a word that is not in that ayah",
     both("al-fatihah:7:w1:compose:3", "di ayat keenam", "di ayat kelima"),
     f"al-fatihah:7:w1:compose:3: cites '{SIRATA}' “di ayat kelima”, which is not a word of ayah 5"),
    ("a citation the data does not have (its link taken out)", in_continues(lambda c: c["al-fatihah"]["ayat"][3]["links"].pop(1)),
     f"al-fatihah:3:w2:compose:4: cites '{ALLAHI}' of ayah 2 as a dependency the data does not have"),
    ("a citation inside a comparison", both("an-nas:5:w1", "di ayat keempat, yang", "di ayat keempat, seperti di ayat kedua, yang"),
     "an-nas:5:w1: points back at an earlier ayah ('ayat keempat')"),
    ("a lanjutan ayah without data", in_continues(lambda c: c["al-falaq"]["ayat"].pop(4)),
     "al-falaq:4: its structure is a continuation ("),
    ("data that continues the ayah itself", in_continues(lambda c: c["al-fatihah"]["ayat"][7].__setitem__("ayah", 7)),
     "al-fatihah structure.json ayah 7 continues: ayah 7 is not an earlier ayah"),
    ("data that disagrees with the ayah's structure type", in_continues(lambda c: c["an-nas"]["ayat"][3].__setitem__("ayah", 2)),
     "an-nas:3: its structure type continues ayat 1, `continues` says ayah 2"),
    ("data with a ref that does not resolve", in_continues(lambda c: link_of(c, "an-nas", 2, 0).__setitem__("on", ["114:1:9"])),
     "an-nas structure.json ayah 2 continues.links[0]: on ['114:1:9'] must be named-word refs"),
    ("data with a kitab the surah does not cite", in_continues(lambda c: link_of(c, "al-fatihah", 4, 0).__setitem__("src", ["DA"])),
     "al-fatihah structure.json ayah 4 continues.links[0]: src ['DA'] must be kitab of the surah's `kitab` table"),
    # a heavy-letter word is shown and explained, never said (operator 2026-10-17: "better not to use
    # heavy-letter words with elevenlabs, we just explain but not read them; simple words so far is ok")
    ("a heavy-letter word said in its plain spelling", replace_in(SHOWN_ONLY, "text", "Kata pertama artinya", "Kata pertama, yaitu shiratha, artinya"),
     f"{SHOWN_ONLY}: says the heavy-letter word 'ṣirāṭa'"),
    ("… in a pesantren respelling", replace_in(SHOWN_ONLY, "text", "Kata pertama artinya", "Kata pertama, yaitu shirotho, artinya"),
     f"{SHOWN_ONLY}: Qur'anic word 'shirotho'"),
    ("a heavy-letter word said, the caption as it was", replace_in(SHOWN_ONLY, "text", "Kata pertama artinya", "Kata pertama, yaitu shiratha, artinya"),
     f"{SHOWN_ONLY}: display does not say what is spoken"),
    ("a rendered line saying a heavy-letter word", then(replace_in(SHOWN_ONLY, "text", "Kata pertama artinya", "Kata pertama, yaitu shiratha, artinya"),
                                                        with_audio(SHOWN_ONLY, voice=True)),
     f"{SHOWN_ONLY}: says the heavy-letter word 'ṣirāṭa'"),
    ("a heavy-letter word named with the markup of a said one",
     compose_say("1:7:1", 3, "Sebabnya, kata ini pengganti bagi kata {{1:6:2}} yang artinya “jalan” di ayat keenam, dan pengganti mengikuti akhiran kata yang digantikannya."),
     "has a heavy letter (ص ض ط ظ ق خ غ): it is shown and explained, never said — write {{!1:6:2}}"),
    ("a simple word named as shown only", item_say(1, 1, ITEM11_SAY.replace("{{1:1:1/bi}}", "{{!1:1:1/bi}}")),
     "bi is a simple word, said as it is written: write {{1:1:1/bi}}"),
    ("a shown-only word without its token (the karaoke drops it)", with_audio(SHOWN_ONLY, voice=True, tweak=drop_shown_piece),
     f"{SHOWN_ONLY}: tokens do not join"),
    # one karaoke word, at most one Arabic unit at its end (rule 15; coordinator 2026-10-17: the
    # rendered "isim (اِسْم), yaitu صِرَٰط (ṣirāṭ)," could break inside one karaoke word)
    ("a shown-only piece glued to a word that shows Arabic, as rendered 2026-10-17", merge_shown_token(SHOWN_ISIM),
     f"{SHOWN_ISIM}: tokens are not the karaoke words of the spoken text"),
    ("… its own token with a time made up", retime_shown_token(SHOWN_ISIM),
     f"{SHOWN_ISIM}: token 'yaitu صِرَٰط (ṣirāṭ),', a shown-only piece, does not have the timing"),
    # a take ElevenLabs cut short (operator 2026-10-17: "the voice is cut slightly before the sentence
    # finished"; al-fatihah:0:primer:1 ended 111 ms before its own last word)
    ("a take cut short (111 ms, as al-fatihah:0:primer:1 was)", with_audio(AUD, tweak=cut_by(111)),
     "tokens run past the end of the audio: the take is cut, its last word ends 111 ms after the file does"),
    ("a take cut just past the tolerance", with_audio(AUD, tweak=cut_by(V.CUT_TOLERANCE_MS + 1)),
     f"its last word ends {V.CUT_TOLERANCE_MS + 1} ms after the file does"),
    ("audio without tokens", with_audio(AUD, tokens=False), "audio without tokens"),
    ("a rendered line whose text changed", replace_in("al-fatihah:1:recite", "text", "Sekarang", "Kini"),
     "a changed line needs a new render"),
    ("rendered with an unrespelled heavy letter (khabar, 'athaf)", with_audio(HEAVY),
     "a heavy letter + a with no approved respelling"),
    ("spoken ellipsis (an open phrase)", append_text(W, " Kata pelaku: yang...."), "keeps an ellipsis"),
    ("a phrase ending on a bare di", append_text(W, " Isim maf'ul, kata yang di."), "bare “di”"),
    # --- copy rules
    ("ketuk instead of klik", set_text("shared:skip_offer", "Jika ingin melewati latihan ini, ketuk tombol Lewati latihan."),
     "say “klik”"),
    ("meaning with yang berarti", append_text(W, " Huruf ini yang berarti dengan."), "“yang artinya”"),
    ("fatwa in the start line", append_text("shared:start", " Penjelasan ini bukan fatwa."), "does not speak of fatwa"),
    ("a promise of human review", append_text("shared:start", " Semua penjelasan sudah ditinjau ustadz."),
     "promises a human review"),
    # --- what the stage shows
    ("word line highlighting another word", set_field("al-fatihah:2:w2", "highlight", [1]),
     "not what the stage shows for this step"),
    ("word card on another word", set_field("al-fatihah:2:w2", "focus", "1:2:1"), "not what the stage shows"),
    ("highlight past the ayah's words", set_field("al-fatihah:2:intro", "highlight", [9]), "must be [0] (the whole ayah)"),
    ("focus outside the ayah", set_field("al-fatihah:2:w2", "focus", "1:3:1"), "is not a word of this ayah"),
    ("shared line with a highlight", set_field("shared:correct", "highlight", [0]), "not what the stage shows"),
    # --- word composition and the harakat primer (narration rule 14, 2026-10-10)
    ("compose line missing", drop(C1), f"missing line {C1}"),
    ("compose line past the frames' says", add(PAST_W2, "Lagi."), f"unexpected line {PAST_W2}"),
    ("primer line missing", drop("al-fatihah:0:primer:2"), "missing line al-fatihah:0:primer:2"),
    # lesson zero's slide and the narrator's line over each example (operator 2026-10-15)
    ("lesson zero's slide line missing", drop("al-fatihah:0:concept:kalimah-isim-fiil-huruf:lead"),
     "missing line al-fatihah:0:concept:kalimah-isim-fiil-huruf:lead"),
    ("an example line of lesson zero missing", drop("al-fatihah:0:concept:kalimah-isim-fiil-huruf:ex:3"),
     "missing line al-fatihah:0:concept:kalimah-isim-fiil-huruf:ex:3"),
    ("an example line lesson zero does not have", add("al-fatihah:0:concept:kalimah-isim-fiil-huruf:ex:6", "Kata ini adalah isim."),
     "unexpected line al-fatihah:0:concept:kalimah-isim-fiil-huruf:ex:6"),
    # a letter's NAME is a whole Arabic word: لَام inside كَلَام (kalam) is no letter, but the letter's name alone is
    ("a letter's name in a caption, as a whole word", replace_in("al-fatihah:0:concept:kalimah-isim-fiil-huruf:lead", "display",
                                                                  "kalam (كَلَام)", "huruf لَام"),
     "caption shows the letter lam by its name (لَام)"),
    ("primer on an ayah the primer does not open", add("al-fatihah:2:primer:1", "Harakat."),
     "unexpected line al-fatihah:2:primer:1"),
    # --- lesson zero (kurikulum-dasar.md decision 1; 2026-10-13): the lesson with no ayah plays the
    # harakat primer and the kalimah record's line, as "ayah 0" of the surah that hosts it
    ("the primer still played in ayah 1, where it stood until 2026-10-13", add("al-fatihah:1:primer:1", "Harakat adalah tanda bunyi."),
     "unexpected line al-fatihah:1:primer:1"),
    ("lesson zero without its opening line", drop("al-fatihah:0:intro"), "missing line al-fatihah:0:intro"),
    ("lesson zero without its hand-over to ayah 1", drop("al-fatihah:0:next"), "missing line al-fatihah:0:next"),
    ("the kalimah record's line said nowhere", drop("al-fatihah:0:concept:kalimah-isim-fiil-huruf"),
     "missing line al-fatihah:0:concept:kalimah-isim-fiil-huruf"),
    ("the kalimah record's line said in ayah 1 as well", add("al-fatihah:1:concept:kalimah-isim-fiil-huruf", "Konsep baru: tiga jenis kata."),
     "unexpected line al-fatihah:1:concept:kalimah-isim-fiil-huruf"),
    ("a part lesson zero does not have (the imam recites no ayah there)", add("al-fatihah:0:recite", "Sekarang dengarkan imam."),
     "unexpected line al-fatihah:0:recite"),
    ("a lesson zero in a surah that hosts none", add("al-ikhlas:0:intro", "Ini pelajaran pengantar."), "unexpected line al-ikhlas:0:intro"),
    ("a lesson-zero line lighting a word (there is no ayah on its stage)", set_field("al-fatihah:0:primer:4", "highlight", [1]),
     "al-fatihah:0:primer:4: highlight [1] must be [0] (the whole ayah), [] or word numbers 1–0 in order"),
    ("a lesson-zero line lighting the whole ayah", set_field("al-fatihah:0:intro", "highlight", [0]), "not what the stage shows"),
    ("lesson zero's hand-over reworded by hand", both("al-fatihah:0:next", "berlanjut sendiri", "berlanjut"), "out of date"),
    ("the primer taken back from lesson zero in the content, narration stale", primer_lesson(None), "missing line al-fatihah:1:primer:1"),
    ("a term of a later lesson in lesson zero", more("al-fatihah:0:intro", "Lalu majrur (مَجْرُور).", "Lalu مَجْرُور."),
     "al-fatihah:0:intro: uses the term 'majrur' before the lesson that teaches it (taught in 1:1)"),
    ("compose line without its frame", drop_frame(C1), "is not the animation frame this line plays over"),
    ("compose line on the wrong frame", set_field(C1, "frame", 1), "is not the animation frame this line plays over"),
    ("a frame on a line without animation", set_field("al-fatihah:1:w1", "frame", 1), "only primer / compose lines have one"),
    ("compose line on another word's card", set_field(C1, "focus", "1:1:2"), "not what the stage shows"),
    ("compose caption too long beside the animation", set_display(C1, "Kata pertama. " * 14),
     "beside the animation"),
    ("a syllable the tiles show, spoken", append_text(WBA, " Dibaca bi."), "a syllable the tiles show in transliteration"),
    # The primer says the sound of its mark frame's own example after "terdengar" (operator 2026-10-15: "jika
    # dibaca kasrah, maka terdengar bi") — only there (primer_sounds):
    ("a primer sound said over the bare letter", append_text("al-fatihah:0:primer:5", " Maka terdengar bi."),
     "al-fatihah:0:primer:5: says 'bi', a syllable the tiles show"),
    ("a primer sound said without “terdengar”", append_text("al-fatihah:0:primer:6", " Bunyinya bi."),
     "al-fatihah:0:primer:6: says 'bi', a syllable the tiles show"),
    ("another frame's primer sound after “terdengar”", append_text("al-fatihah:0:primer:6", " Lalu terdengar bu."),
     "al-fatihah:0:primer:6: says 'bu', a syllable the tiles show"),
    ("a longer primer form after “terdengar” (a doubled letter)", append_text("al-fatihah:0:primer:12", " Maka terdengar rra."),
     "al-fatihah:0:primer:12: says 'rra', a syllable the tiles show"),
    ("a compose line split", split_compose, "is never split"),
    ("letter not as the frame writes it", replace_in(LAM3, "display", "huruf ل ", "huruf لِ "),
     "the letter as in the ayah is ل"),
    ("composition changed, narration stale",
     compose_say("1:1:1", 1, "Bagian pertama adalah huruf jar, yaitu {{1:1:1/bi}}."), "out of date"),
    ("Qur'anic word in a composition's say",
     compose_say("1:1:1", 1, "Bagian pertama adalah bi- dan ismi."), "names the Qur'anic word(s)"),
    # --- the sentence structure as separate items (operator 2026-10-13: "can we make this kind of
    # explanation in items: harfjar in one item, idhafah in next item etc, it's kind of confusing
    # which for which in this paragraph"): one line per item, its words lit, spoken as authored
    ("a structure item's line missing", drop(S12), "missing line al-fatihah:1:structure:2"),
    ("the one structure line beside the items", add("al-fatihah:1:structure", "Sekarang susunan kalimatnya."),
     "unexpected line al-fatihah:1:structure"),
    ("one item too many", add("al-fatihah:3:structure:3", "Keduanya berakhir sama."), "unexpected line al-fatihah:3:structure:3"),
    ("an item lighting the whole ayah, as the one line did", set_field(S12, "highlight", [0]), "not what the stage shows"),
    ("an item lighting another item's words", set_field(S12, "highlight", [2, 3, 4]), "not what the stage shows"),
    ("an item with a word card", set_field(S12, "focus", "1:1:2"), "not what the stage shows"),
    ("a structure item split", split_item, "a structure item is never split"),
    ("the lead said before a later item", both(S12, "Isim (اِسْم) itu", "Sekarang susunan kalimatnya. Isim (اِسْم) itu", "اِسْم itu",
                                                      "Sekarang susunan kalimatnya. اِسْم itu"), "out of date"),
    ("an item changed in the content, narration stale", item_say(1, 2, "Kata pertama disandarkan kepada kata kedua."), "out of date"),
    ("an item's words changed in the content, narration stale", item_words(1, 2, [1, 2, 3]), "out of date"),
    ("the items taken out of the content: the ayah is told from its summary", no_items(4), "missing line al-fatihah:4:structure"),
    ("Qur'anic word in an item's say", item_say(1, 1, "Kata pertama, bismi, diawali huruf jar."), "names the Qur'anic word(s)"),
    ("an item with a Latin term the dictionary does not speak", both(S11, "Gabungan seperti ini", "Fa'il-nya tersirat. Gabungan seperti ini"),
     "says \"Fa'il\" in Latin"),
    # --- `why_basic` (2026-10-13): a word's reason in the lesson's own vocabulary, said by the
    # quiz explanations in place of `why`; held to the term check, the strict rule and rule 1
    ("a why_basic changed in the content, narration stale",
     why_basic("1:5:1", "Dhamir ini mabni: akhirnya selalu fathah, apa pun kedudukannya."), "out of date"),
    # Without it the explanation says the card's `why` again — and with it the term the card names.
    ("a why_basic taken away: the card's why is said again, with its term", why_basic("1:7:1", None),
     "al-fatihah:7:ex:sort-case:1:why: uses the term 'badal' before the lesson that teaches it (taught in 114:2)"),
    ("a why_basic that names a term taught later",
     why_basic("1:7:1", "Akhirnya fathah karena menjadi badal bagi kata {{!1:6:2}} yang artinya “jalan”."),
     "al-fatihah:7:ex:sort-case:1:why: uses the term 'badal' before the lesson that teaches it (taught in 114:2)"),
    ("a why_basic that names a next-level term",
     why_basic("1:5:2", "Akhirnya dhammah karena fi'il mudhari' ini tidak didahului penashab; pelakunya tersirat."),
     "uses the term 'nashib' before the lesson that teaches it (taught in tingkat lanjut)"),
    ("Qur'anic word in a why_basic", why_basic("1:5:1", "Dhamir iyyāka ini mabni: akhirnya tetap fathah."), "names the Qur'anic word(s)"),
    ("a why_basic with a Latin term the dictionary does not speak",
     both("al-fatihah:6:ex:sort-case:1:why", "fa’il (فَاعِل) kata ini", "fa'il-nya", "فَاعِل kata ini", "fa'il-nya"), "says \"fa'il\" in Latin"),
    # --- the warm-up that opens a lesson (operator 2026-10-13: "in every ayat we identify first
    # each words fall into which category: ismu, fi'il or harf"): its lines stand before the first
    # word's, one per question, and may use only what EARLIER lessons taught
    ("a warm-up line missing", drop("al-fatihah:3:ex:word-kind:2:why"), "al-fatihah:3:ex:word-kind:2:why"),
    ("a warm-up line for a question the quiz does not ask", add("al-fatihah:3:ex:word-kind:9:why", "Kata ketiga adalah isim."), "al-fatihah:3:ex:word-kind:9:why"),
    ("a warm-up sentence edited by hand", both(W21, "Kata pertama", "Kata yang pertama"), "out of date"),
    ("a warm-up line that names a term of its OWN lesson (huruf jar, taught in ayah 1, said by ayah 1's warm-up)",
     more("al-fatihah:1:ex:word-kind:2:why", "Tandanya: didahului huruf jar (حَرْف جَرّ).", "Tandanya: didahului حَرْف جَرّ."),
     "al-fatihah:1:ex:word-kind:2:why: uses the term 'huruf-jar' before the lesson that teaches it (taught in 1:1)"),
    ("a warm-up line that names a term of a later lesson", more(W21, *EARLY),
     "al-fatihah:2:ex:word-kind:1:why: uses the term 'idhafah' before the lesson that teaches it (taught in 1:4)"),
    ("Qur'anic word in a warm-up line", both(W21, "Kata pertama", "Kata al-ḥamdu"), "al-fatihah:2:ex:word-kind:1:why"),
    # --- Arabic terms said in Latin (rule 1) and the dictionary's approvals (review 2026-10-10)
    ("a compose line with a Latin grammar term (mubtada')", append_text(C1, " Kata ini mubtada'."),
     "says \"mubtada'\" in Latin"),
    ("a compose line with Latin sukun", append_text(C1, " Huruf itu dengan sukun di atasnya."), "says 'sukun' in Latin"),
    ("a compose line with a letter name the dictionary lacks", append_text(WBA, " Lalu huruf jim."), "says 'jim' in Latin"),
    ("a composed word's lead with a Latin term", append_text("al-fatihah:1:w1", " Ia mabni."), "says 'mabni' in Latin"),
    # Caught by check_renderable while the line is unrendered, by the rendered-audio check once it
    # carries audio (Al-Fatihah was rendered 2026-10-11): both messages share this wording.
    ("a primer line with a heavy letter + a (mushaf)", append_text("al-fatihah:0:primer:1", " Lihat mushaf."),
     "a heavy letter + a with no approved respelling"),
    ("a rendered line with a Latin grammar term", with_audio(LATIN), "in Latin, an Arabic term"),
    ("a letter name spoken in Latin where the dictionary has it", replace_in(C1, "text", "مِيم", "mim"),
     "'mim' must be spoken from the pronunciation dictionary"),
    ("dictionary: a term without its approval", lex_drop("نَعْت", "approved"), "needs `approved`"),
    ("dictionary: an approval that is not a date", lex_term("نَعْت", approved="soon"), "approved must be a date"),
    ("a syllable of another word's tiles in the same ayah (hum)",
     append_text("al-fatihah:7:w7:compose:2", " Bunyi asalnya hum."), "a syllable the tiles show"),
    ("a letter's name read as a sound", append_text("al-fatihah:0:primer:3", " Huruf بَاء dibaca بَاء."),
     "reads a letter's name as a sound"),
    ("Indonesian spelling, long vowel doubled (maaliki)", append_text(W, " Seperti maaliki."),
     "Qur'anic word 'maaliki' (another spelling"),
    ("Indonesian spelling, ‘ain as k (nakbudu)", append_text(W, " Fi'il ini, nakbudu."),
     "Qur'anic word 'nakbudu' (another spelling"),
    ("Indonesian spelling, ‘ain as ng (nastangin)", append_text(W, " Lalu nastangin."),
     "Qur'anic word 'nastangin' (another spelling"),
    ("the doubled lam not as the frame pins it", replace_in(W79, "display", f"huruf {LAM79} ", f"huruf {LAM79_BARE} "),
     f"the letter as in the ayah is {LAM79}"),
    # --- the lesson map (plan L23, L26): after the imam's recitation one step per group of the
    # card, one sentence per line ("map:new"; "map:again" — the step "map:learnt"; "map:later", "map:focus"),
    # and "learned", "map:total" before the recap. Since 2026-10-15 a counted group is named whole.
    ("map:new line missing", drop(N1), f"missing line {N1}"),
    ("map:again line missing", drop(G3), f"missing line {G3}"),
    ("map:later line missing (an ayah with next-level topics only)", drop(T3), f"missing line {T3}"),
    ("map:focus line missing", drop(F3), f"missing line {F3}"),
    ("learned line missing", drop("al-fatihah:7:learned"), "missing line al-fatihah:7:learned"),
    ("map:total line missing", drop(S7), f"missing line {S7}"),
    ("a map line in a surah without a lesson map", add("al-falaq:1:map:new", "Di ayat ini tidak ada hal baru."),
     "unexpected line al-falaq:1:map:new"),
    # the running total unit by unit (2026-10-19: Al-Ikhlas's 25 to 28 steps no longer fit one line of
    # 400 spoken characters; lessonmap.py "THE RUNNING TOTAL, UNIT BY UNIT")
    ("a group of the running total missing", drop(K42), f"missing line {K42}"),
    ("a group the lesson map does not have", add("al-ikhlas:4:map:total:3", "Dari Surah Al-Ikhlas ada satu hal, yaitu majzum."),
     "unexpected line al-ikhlas:4:map:total:3"),
    ("the count of a running total said unit by unit naming its steps too",
     both(K4, "hal yang kita pelajari.", "hal yang kita pelajari, yaitu harakat."),
     f"{K4}: names the steps although the lines after it name them unit by unit"),
    ("the count of a running total said unit by unit, wrong", both(K4, "dua puluh delapan", "dua puluh tujuh"),
     f"{K4}: says dua puluh tujuh step(s) learnt in all, the lesson map has 28"),
    ("a group that names other units", both(K42, "Dari Surah An-Nas, Surah Al-Falaq, dan Surah Al-Ikhlas", "Dari Surah An-Nas dan Surah Al-Falaq"),
     f"{K42}: names the units “Surah An-Nas dan Surah Al-Falaq”"),
    ("a step of a group left out", both(K42, ", majzum (مَجْزُوم), serta", ", serta", ", مَجْزُوم, serta", ", serta"),
     f"{K42}: names"),
    ("a group's count that disagrees with its names", both(K41, "sembilan belas hal", "delapan belas hal"),
     f"{K41}: says delapan belas step(s) of pelajaran pengantar, Surah Al-Fatihah and names 19"),
    ("a group split", lambda m, *_: (m["al-ikhlas"]["lines"].__setitem__(K41 + ":a", dict(m["al-ikhlas"]["lines"][K41])),
                                    m["al-ikhlas"]["lines"].__setitem__(K41 + ":b", m["al-ikhlas"]["lines"].pop(K41))),
     "a map / learned line is never split"),
    ("the one map line of before the curriculum", add("al-fatihah:1:map", "Di ayat ini ada dua hal baru."),
     "does not follow the step-id contract"),
    ("the surah's map switched off, its lines left behind", lambda _m, _l, _x, _c, mp, *_: mp.pop("al-fatihah"),
     f"unexpected line {N1}"),
    ("a map line split", split_map, "a map / learned line is never split"),
    ("a map line that highlights the ayah", set_field(N1, "highlight", [0]), "not what the stage shows for this step"),
    ("the reassurance that highlights the ayah", set_field(F1, "highlight", [0]), "not what the stage shows for this step"),
    # what is new
    ("the count of new steps", both(N2, "tiga hal baru", "empat hal baru"), "says empat new step(s), the lesson map has 3"),
    ("a new step not named", both(N2, ", marfu’ (مَرْفُوع)", "", ", مَرْفُوع", ""),
     "names ['jumlah-ismiyyah', 'jamak-mudzakkar-salim'] as new step(s); the lesson map gives"),
    ("a learnt step named as new", both(N3, "dan na’t (نَعْت)", "dan majrur (مَجْرُور)", "dan نَعْت", "dan مَجْرُور"),
     "names ['alif-lam', 'majrur'] as new step(s); the lesson map gives ['alif-lam', 'naat']"),
    ("a name that is no step of the map", both(N4, "idhafah (إِضَافَة)", "isim (اِسْم)", "idhofah", "اِسْم"),
     "are not a list of the map's step names"),
    ("map:new says more than what is new", more(N1, "Mari kita mulai."), "does not say, in one sentence, how many steps are new"),
    # what has been learnt so far: since 2026-10-17 said only in the closing's running total (the
    # operator removed the opening's line: "better to remove this line in every ayat beginning:
    # 'Sebelum ayat ini, kita sudah mempelajari XX hal, yaitu …'") — its protections hold there
    ("the learnt-so-far line back at an ayah's opening, as until 2026-10-17",
     add(L3, "Sebelum ayat ini, kita sudah mempelajari tujuh hal, yaitu harakat, tiga jenis kata, majrur, huruf jar, jumlah ismiyyah, marfu', dan jamak mudzakkar salim."),
     f"{L3}: says how many steps were learnt before this ayah"),
    ("… or put in front of what comes up again",
     both(G2, "Dari yang sudah kita pelajari, yang", "Sebelum ayat ini, kita sudah mempelajari empat hal. Dari yang sudah kita pelajari, yang"),
     f"{G2}: says how many steps were learnt before this ayah"),
    ("what comes up again worded as it was after that line (not on its own)",
     both(G1, "Dari yang sudah kita pelajari, yang kita temui", "Yang kita temui"),
     f"{G1}: does not stand on its own"),
    ("a running total whose count disagrees with the names given", both(S1, "sudah empat hal", "sudah lima hal"),
     f"{S1}: says lima step(s) learnt in all"),
    ("a selection of the running total (“di antaranya”)", both(S1, ", yaitu harakat, tiga jenis kata, ", ", di antaranya "),
     "says “di antaranya”: every one of the step(s) learnt in all is named"),
    # what of it comes up again here: every one by name, in teaching order
    ("the old shape “ada satu: …”", both(G1, "adalah harakat dan", "ada satu: harakat dan"),
     f"{G1}: counts the learnt steps that come up again (“ada …”) instead of naming every one"),
    ("the old shape “ada tiga, di antaranya …”", both(G2, "adalah harakat, ", "ada tiga, di antaranya "),
     f"{G2}: counts the learnt steps that come up again"),
    ("a repeated step left out", both(G2, "tiga jenis kata, majrur (مَجْرُور), dan", "majrur (مَجْرُور), dan", "tiga jenis kata, مَجْرُور, dan", "مَجْرُور, dan"),
     "(kalimah left out)"),
    ("a repeated step the map does not mark here", both(G3, "dan majrur (مَجْرُور).", "dan huruf jar (حَرْف جَرّ).", "dan مَجْرُور.", "dan حَرْف جَرّ."),
     "names ['harakat', 'kalimah', 'huruf-jar'] as repeated step(s)"),
    ("the repeated steps most recent first, as until 2026-10-15",
     both(G3, "adalah harakat, tiga jenis kata, dan majrur (مَجْرُور)", "adalah majrur (مَجْرُور), tiga jenis kata, dan harakat",
          "adalah harakat, tiga jenis kata, dan مَجْرُور", "adalah مَجْرُور, tiga jenis kata, dan harakat"),
     "names ['majrur', 'kalimah', 'harakat'] as repeated step(s); the lesson map gives ['harakat', 'kalimah', 'majrur'] (another order"),
    ("“none comes up again” where steps do", then(set_field(G1, "display", "Tidak ada yang kita temui lagi di ayat ini."),
                                                   set_field(G1, "text", "Tidak ada yang kita temui lagi di ayat ini.")),
     f"{G1}: does not name, in one sentence, the learnt steps that come up again here (2 in the lesson map)"),
    # what is taught later — every one by name — and how many next-level topics there are
    ("a postponed step, the wrong ayah",
     both(T1, "idhafah (إِضَافَة) di ayat keempat", "idhafah (إِضَافَة) di ayat kelima", "idhofah di ayat keempat", "idhofah di ayat kelima"),
     "says idhafah is taught in ayah 5; the lesson map says ayah 4"),
    ("a postponed step left out of the line", both(T1, "alif lam (ال) di ayat ketiga, ", "", "alif lam di ayat ketiga, ", ""),
     "names ['naat', 'idhafah'] as postponed step(s); the lesson map gives ['alif-lam', 'naat', 'idhafah']"),
    ("the count of postponed steps", both(T1, "Ada tiga hal lagi", "Ada dua hal lagi"), "says dua postponed step(s), the lesson map has 3"),
    ("a selection of the postponed steps (“di antaranya”, as until 2026-10-15)",
     both(T2, "yaitu alif lam (ال), na’t (نَعْت), idhafah (إِضَافَة), dan badal (بَدَل)", "di antaranya alif lam (ال) dan na’t (نَعْت)",
          "yaitu alif lam, نَعْت, idhofah, dan بَدَل", "di antaranya alif lam dan نَعْت"),
     "says “di antaranya”: every one of the postponed step(s) is named"),
    ("a postponed step left out of a “yaitu” list", both(T2, "na’t (نَعْت), ", "", "نَعْت, ", ""), "(naat left out)"),
    ("the count of next-level topics", both(T1, "Ada juga satu hal tingkat lanjut", "Ada juga dua hal tingkat lanjut"),
     "says dua next-level topic(s), the lesson map has 1"),
    ("the next-level topics left out", first_sentence_only(T1),
     "1 sentence(s); the lesson map has postponed steps and next-level topics: 2"),
    ("a next-level topic named (the narrator gives their count only)",
     both(T3, "satu hal tingkat lanjut,", "satu hal tingkat lanjut, yaitu wazan (وَزْن) dan tashrif (تَصْرِيف),",
          "satu hal tingkat lanjut,", "satu hal tingkat lanjut, yaitu وَزْن dan تَصْرِيف,"),
     "says more of the next-level topics than their count (“yaitu wazan (وَزْن) dan tashrif (تَصْرِيف)”): the narrator never names one"),
    ("“Ada juga” where the ayah postpones nothing", both(T3, "Di ayat ini ada satu hal tingkat lanjut", "Ada juga satu hal tingkat lanjut"),
     "“Ada juga” is said exactly when the ayah has postponed steps as well"),
    # the reassurance after what is put aside (operator 2026-10-15)
    ("the reassurance's pronoun for three", both(F1, "menghafal ketiganya", "menghafal keduanya"),
     f"{F1}: says “keduanya” of 3 thing(s) put aside: “ketiganya”"),
    ("the reassurance's pronoun for four", both(F2, "menghafal semuanya", "menghafal keempatnya"),
     f"{F2}: says “keempatnya” of 4 thing(s) put aside: “semuanya”"),
    ("the reassurance's pronoun for one", both("al-fatihah:6:map:focus", "menghafal yang satu ini", "menghafal semuanya"),
     "al-fatihah:6:map:focus: says “semuanya” of 1 thing(s) put aside: “yang satu ini”"),
    ("the next-level clause left out where both are put aside", both(F1, ", dan tidak perlu memikirkan hal tingkat lanjut tadi", ""),
     f"{F1}: adds “dan tidak perlu memikirkan hal tingkat lanjut tadi” exactly when"),
    ("“menghafal” of next-level topics alone", both(F3, "memikirkan yang satu ini", "menghafal yang satu ini"),
     "the verb is “menghafal” for postponed steps, “memikirkan” for next-level topics alone"),
    ("the focus on a learnt step instead of a new one",
     both(F3, "alif lam (ال) dan na’t (نَعْت)", "alif lam (ال) dan majrur (مَجْرُور)", "alif lam dan نَعْت", "alif lam dan مَجْرُور"),
     "names ['alif-lam', 'majrur'] as new step(s) to focus on; the lesson map gives ['alif-lam', 'naat']"),
    ("the focus leaves a new step out", both(F1, "majrur (مَجْرُور) dan huruf jar (حَرْف جَرّ)", "majrur (مَجْرُور)", "مَجْرُور dan حَرْف جَرّ", "مَجْرُور"),
     "(huruf-jar left out)"),
    ("the reassurance without what to focus on", first_sentence_only(F1), f"{F1}: 1 sentence(s); a reassurance is two"),
    ("the reassurance said in the later line, not its own", more(T3, "Sekarang Anda tidak perlu memikirkan yang satu ini."),
     f"{T3}: 2 sentence(s); the lesson map has next-level topics: 1"),
    # the closing: what was new; the running total, every step by name
    ("the closing's count of new steps", both("al-fatihah:7:learned", "tiga hal baru", "dua hal baru"),
     "al-fatihah:7:learned: says dua new step(s), the lesson map has 3"),
    ("the closing names the new steps in another order",
     both("al-fatihah:1:learned", "majrur (مَجْرُور) dan huruf jar (حَرْف جَرّ)", "huruf jar (حَرْف جَرّ) dan majrur (مَجْرُور)",
          "مَجْرُور dan حَرْف جَرّ", "حَرْف جَرّ dan مَجْرُور"),
     "al-fatihah:1:learned: names ['huruf-jar', 'majrur'] as new step(s)"),
    ("the closing with the running total in it, as until 2026-10-15", more("al-fatihah:3:learned", "Dengan itu, sudah sembilan hal yang kita pelajari."),
     "al-fatihah:3:learned: does not say, in one sentence, how many new steps the ayah taught, and which"),
    ("the running total", both(S3, "sudah sembilan hal", "sudah delapan hal"), f"{S3}: says delapan step(s) learnt in all, the lesson map has 9"),
    ("the running total counted and not named, as until 2026-10-15",
     both(S1, ", yaitu harakat, tiga jenis kata, yaitu isim (اِسْم), fi’il (فِعْل), dan huruf (حَرْف), majrur (مَجْرُور), serta huruf jar (حَرْف جَرّ).", ".",
          ", yaitu harakat, tiga jenis kata, yaitu اِسْم, فِعْل, dan حَرْف, مَجْرُور, serta حَرْف جَرّ.", "."),
     f"{S1}: says how many step(s) learnt in all there are and does not name them"),
    ("the running total leaves out what the ayah just taught",
     both(S1, "harakat, tiga jenis kata, yaitu isim (اِسْم), fi’il (فِعْل), dan huruf (حَرْف), majrur (مَجْرُور), serta huruf jar (حَرْف جَرّ)", "harakat, serta tiga jenis kata, yaitu isim (اِسْم), fi’il (فِعْل), dan huruf (حَرْف)",
          "harakat, tiga jenis kata, yaitu اِسْم, فِعْل, dan حَرْف, مَجْرُور, serta حَرْف جَرّ", "harakat, serta tiga jenis kata, yaitu اِسْم, فِعْل, dan حَرْف"),
     "(majrur, huruf-jar left out)"),
    ("the running total in another order", both(S1, "yaitu harakat, tiga jenis kata, yaitu isim (اِسْم), fi’il (فِعْل), dan huruf (حَرْف),", "yaitu tiga jenis kata, yaitu isim (اِسْم), fi’il (فِعْل), dan huruf (حَرْف), harakat,", "yaitu harakat, tiga jenis kata, yaitu اِسْم, فِعْل, dan حَرْف,", "yaitu tiga jenis kata, yaitu اِسْم, فِعْل, dan حَرْف, harakat,"),
     f"{S1}: names ['kalimah', 'harakat', 'majrur', 'huruf-jar'] as step(s) learnt in all"),
    ("“Sampai ayat ini” after an ayah that taught something", both(S1, "Dengan itu,", "Sampai ayat ini,"),
     f"{S1}: opens “Dengan itu” exactly when the ayah taught something new"),
    # the map itself
    ("the map's new steps are not the ayah's concept lines", in_map(lambda mp: map_entry(mp, 3)["new"].clear()),
     "the lesson map's new steps [] are not this ayah's concept lines ['concept:alif-lam', 'concept:naat']"),
    ("a step named otherwise than its own caption", in_map(lambda mp: mp["steps"]["naat"].__setitem__("name", "Sifat (نَعْت)")),
     "naat is named “Sifat (نَعْت)”, and its own caption does not open with that name"),
    ("the map lists a postponed step the curriculum does not", in_map(lambda mp: map_entry(mp, 3)["later"].append("badal")),
     "ayah 3: later is not what the curriculum gives"),
    ("lesson map changed, narration stale", in_map(lambda mp: mp["steps"]["naat"].__setitem__("latin", "Sifat pengikut")),
     "out of date"),
    # --- WHERE a "Konsep baru" line is said: the curriculum (operator-approved 2026-10-13, plan L26)
    ("a record's line in the ayah of its first example, not in its lesson", add("al-fatihah:1:concept:naat", "Konsep baru: sifat."),
     "unexpected line al-fatihah:1:concept:naat"),
    ("a next-level record taught", add("al-fatihah:3:concept:wazan-dan-tashrif", "Konsep baru: bentuk kata."),
     "unexpected line al-fatihah:3:concept:wazan-dan-tashrif"),
    ("the line of a step with its own text missing", drop("al-fatihah:2:concept:marfu"), "missing line al-fatihah:2:concept:marfu"),
    ("a step's line lighting other words than the step occurs on", set_field("al-fatihah:1:concept:majrur", "highlight", [1]),
     "not what the stage shows for this step"),
    ("the curriculum moved a step, narration stale",
     in_cur(lambda cur: cur_lesson(cur, "1:3")["lines"].append(cur_lesson(cur, "1:4")["lines"].pop())),
     "missing line al-fatihah:3:concept:idhafah"),
    ("a step's own text changed in the curriculum, narration stale",
     in_cur(lambda cur: cur_step(cur, "marfu")["teach"].__setitem__("summary", "Keadaan kedua.")), "out of date"),
    # --- no term before its lesson (decision 7), and the list tolerated for now, both ways. Each
    # fault PLANTS its use (and its entry of the list): the real list only shrinks as the lessons
    # are reworded, down to empty, and a fault that needed one of its entries would go with it
    # (2026-10-13: the Al-Fatihah entries these cases stood on were reworded away).
    ("a term planted in a line before its lesson", more(W, *EARLY),
     "al-fatihah:2:w1: uses the term 'idhafah' before the lesson that teaches it (taught in 1:4)"),
    ("a next-level term planted in a line", more(W, *NEXT_LEVEL),
     "al-fatihah:2:w1: uses the term 'isim-fail' before the lesson that teaches it (taught in tingkat lanjut)"),
    ("two terms planted, one of them listed", then(more(W, *EARLY_TWO), listed(W, ["idhafah"])),
     "al-fatihah:2:w1: uses the term 'badal' before the lesson that teaches it (taught in 114:2)"),
    ("a stale entry: a line that says nothing too early", listed("al-fatihah:1:w1", ["idhafah"]),
     "al-fatihah:1:w1 no longer uses 'idhafah' too early (stale): remove it"),
    ("a stale term on a listed line", then(more(W, *EARLY), listed(W, ["idhafah", "badal"])),
     "al-fatihah:2:w1 no longer uses 'badal' too early (stale): remove it"),
    # … also a term the pronunciation dictionary has no entry for, or does not match in the form
    # the prose writes (2026-10-13): found by the term table's own forms
    ("a term with no dictionary entry planted before its lesson (zharaf)", more(W, "Kata ini zharaf."),
     "al-fatihah:2:w1: uses the term 'zharaf' before the lesson that teaches it (taught in 2:255/5)"),
    ("a next-level term with no dictionary entry (mubalaghah)", more(W, "Ini bentuk mubalaghah."),
     "al-fatihah:2:w1: uses the term 'mubalaghah' before the lesson that teaches it (taught in tingkat lanjut)"),
    ("a dictionary term in a form the dictionary does not match (-nya)", more(W, "Badal-nya kata kedua."),
     "al-fatihah:2:w1: uses the term 'badal' before the lesson that teaches it (taught in 114:2)"),
    ("an entry for a line that does not exist", listed("al-fatihah:2:w99", ["idhafah"]),
     "al-fatihah:2:w99 no longer uses 'idhafah' too early (stale): remove it"),
    ("map:later naming a term that is none of the steps it announces", more(T1, "Juga badal (بَدَل).", "Juga بَدَل."),
     "al-fatihah:1:map:later: uses the term 'badal' before the lesson that teaches it (taught in 114:2)"),
    ("the exemption of map:later claimed by another line",
     both(N1, "dan huruf jar (حَرْف جَرّ)", "dan na’t (نَعْت)", "dan حَرْف جَرّ", "dan نَعْت"),
     "al-fatihah:1:map:new: uses the term 'naat' before the lesson that teaches it (taught in 1:3)"),
]


class NarrationValidation(unittest.TestCase):
    def test_unmutated_passes(self):
        self.assertEqual(run_check(copy.deepcopy(MANIFESTS), copy.deepcopy(LESSONS), copy.deepcopy(LEXDATA)), [])

    def test_build_is_deterministic(self):
        self.assertEqual(B.build_lines(LESSONS, LIBRARY, LEX), B.build_lines(LESSONS, LIBRARY, LEX))

    def test_compose_lines_follow_the_frames(self):
        lines = B.build_lines(LESSONS, LIBRARY, LEX, COMPOSE)["al-fatihah"]
        ids = [lid for lid in lines if lid.startswith("al-fatihah:1:")]
        # recite → what the ayah brings (the lesson map, plan L23 and L26: one step per group of its
        # card, one sentence per line since 2026-10-15) → each word: its gloss line, then its
        # frames' lines (rule 14). The harakat primer stood between them until 2026-10-13; it is
        # lesson zero's now.
        # … and, since the same day, the warm-up that opens the lesson stands before the first word.
        # (The learnt-so-far line "map:learnt" stood before map:again until 2026-10-17.)
        self.assertEqual(ids[1:7], ["al-fatihah:1:recite", "al-fatihah:1:map:new", "al-fatihah:1:map:again",
                                    "al-fatihah:1:map:later", "al-fatihah:1:map:focus", "al-fatihah:1:ex:word-kind:intro"])
        warm = [lid for lid in ids if ":ex:word-kind:" in lid]
        self.assertEqual(warm, ["al-fatihah:1:ex:word-kind:intro", *[f"al-fatihah:1:ex:word-kind:{n}:why" for n in range(1, 6)]])
        self.assertEqual(ids[6 + len(warm)], "al-fatihah:1:w1")
        # Every other exercise's lines still follow the structure.
        self.assertGreater(ids.index("al-fatihah:1:ex:tap-word:intro"), ids.index("al-fatihah:1:structure:4"))
        zero = [lid for lid in lines if lid.startswith("al-fatihah:0:")]
        self.assertEqual(zero, ["al-fatihah:0:intro", *[f"al-fatihah:0:primer:{k}" for k in range(1, 15)],
                                "al-fatihah:0:concept:kalimah-isim-fiil-huruf:lead", "al-fatihah:0:concept:kalimah-isim-fiil-huruf",
                                *[f"al-fatihah:0:concept:kalimah-isim-fiil-huruf:ex:{k}" for k in range(1, 6)], "al-fatihah:0:next"])
        # The slide and the example lines are the curriculum's text, said as written, each one file.
        kal = next(s for s in CURRICULUM["steps"] if s["id"] == "kalimah")
        self.assertIn("dalam bahasa Arab disebut كَلَام.", lines["al-fatihah:0:concept:kalimah-isim-fiil-huruf:lead"]["text"])
        for k, _ex in enumerate(kal["examples"], 1):
            ln = lines[f"al-fatihah:0:concept:kalimah-isim-fiil-huruf:ex:{k}"]
            self.assertTrue(ln["text"].startswith(("Kata ini", "Tulisan ini")), ln["text"])
            self.assertLessEqual(len(ln["text"]), 400)
        self.assertEqual(len(kal["examples"]), 5)
        self.assertEqual(list(lines)[:len(zero)], zero)  # before ayah 1's lines
        for k, ln in enumerate(COMPOSE["al-fatihah"]["primer"]["lines"], 1):
            self.assertEqual(lines[f"al-fatihah:0:primer:{k}"]["frame"], ln["frame"])
        # No ayah on its stage: nothing lit, no word card.
        self.assertTrue(all(lines[lid]["highlight"] == [] and lines[lid]["focus"] is None for lid in zero))
        self.assertEqual(lines["al-fatihah:0:intro"]["text"], B.ZERO_INTRO.format(surah="Al-Fatihah"))
        self.assertEqual(lines["al-fatihah:0:next"]["text"], B.ZERO_NEXT.format(surah="Al-Fatihah"))
        # No other surah hosts it.
        for slug in ("al-ikhlas", "al-falaq", "an-nas"):
            self.assertIsNone(V.lesson_zero(LESSONS[slug], COMPOSE.get(slug)))
            self.assertFalse(any(f"{slug}:0:" in lid for lid in B.build_lines(LESSONS, LIBRARY, LEX, COMPOSE)[slug]))
        w1 = ids.index("al-fatihah:1:w1")
        self.assertEqual(ids[w1 + 1], "al-fatihah:1:w1:compose:1")
        comp = COMPOSE["al-fatihah"]["words"]["1:1:1"]
        for k, ln in enumerate(comp["lines"], 1):
            self.assertEqual(lines[f"al-fatihah:1:w1:compose:{k}"]["frame"], ln["frame"])
        self.assertNotIn("frame", lines["al-fatihah:1:w1"])
        # The word line is the gloss and the lead; the why is said part by part in the frames.
        # (Until 2026-10-17 "Kata pertama artinya: …": the word is named too, rule 26.)
        w = LESSONS["al-fatihah"]["ayat"][0]["words"][0]
        self.assertEqual(lines["al-fatihah:1:w1"]["display"],
                         f"Kata pertama, yaitu {w['ar']} ({w['translit']}), artinya: “dengan nama”. Kata ini terdiri dari dua bagian.")
        # The narrator never says the tiles' syllables; the vowel sounds it may say — and, in the primer, the
        # sound of a mark frame's own letter after "terdengar" (operator 2026-10-15).
        for lid, ln in lines.items():
            if ":compose:" in lid or ":primer:" in lid:
                said = re.sub(r"terdengar (?:ba|bi|bu)\.$", "", ln["text"]) if ":primer:" in lid else ln["text"]
                # … and, since 2026-10-17, a word the caption names with its Arabic ("yaitu بِ (bi)")
                said = V.mask_named_said(said, [w for w, _ in V.named_in_display(ln["display"])])
                self.assertNotRegex(said, r"\b(?:bi|bu|ismu|ismi|bismi|ar-rahmanu|ar-rahmani)\b", lid)
        self.assertIn("bunyinya a", lines["al-fatihah:0:primer:3"]["text"])
        # the letter alone first, then the same letter with its mark and the sound it gives
        self.assertIn("Contohnya huruf بَاء ini, tanpa harakat.", lines["al-fatihah:0:primer:5"]["text"])
        self.assertEqual(lines["al-fatihah:0:primer:6"]["text"], "Jika dibaca كَسْرَة, maka terdengar bi.")

    def test_mutations_fail(self):
        for name, mutate, expect in MUTATIONS:
            with self.subTest(name):
                m, ls, lx, cp = copy.deepcopy(MANIFESTS), copy.deepcopy(LESSONS), copy.deepcopy(LEXDATA), copy.deepcopy(COMPOSE)
                mp, cur, pend = copy.deepcopy(LESSONMAP), copy.deepcopy(CURRICULUM), copy.deepcopy(PENDING)
                cont = copy.deepcopy(CONTINUES)
                mutate(m, ls, lx, cp, mp, cur, pend, cont)
                errs = run_check(m, ls, lx, cp, mp, cur, pend, cont)
                self.assertTrue(any(expect in e for e in errs), f"{name}: expected {expect!r} in {errs[:5]}")

    def test_good_audio_passes(self):
        m = copy.deepcopy(MANIFESTS)
        with_audio(AUD)(m)
        self.assertEqual(V.check(m, LESSONS, LIBRARY, build=False, lex=LEX), [])

    def test_allowed_exceptions_pass(self):
        ok = [
            "Terjemahannya: “Dengan nama Allah Yang Maha Pengasih.”",
            "Bila diucapkan hamba kepada Allah subhanahu wa ta'ala maknanya doa.",
            "Pelajaran ayat terakhir Surah An-Nas selesai.",
            "Akhirnya kasrah karena didahului huruf jar lam.",
            "Tanpa alif lam.",
            "Pelakunya tersirat, yaitu Nabi Muhammad shallallahu 'alaihi wa sallam.",
            "Penjelasan ini dibacakan dengan suara AI (kecerdasan buatan).",
        ]
        for text in ok:
            with self.subTest(text):
                self.assertEqual(V.check_text("t", text, FORMS), [])
        spoken = [
            "Kata kedua artinya: Alloh. Akhirnya dibaca كَسْرَة, karena menjadi mudhof ilaih dari kata pertama.",
            "Didahului حَرْف جَرّ, yaitu huruf بَاء, yang artinya dengan.",
            "Bila diucapkan hamba kepada Alloh subhanahu wa ta'ala maknanya doa.",
        ]
        for text in spoken:
            with self.subTest(text):
                self.assertEqual(V.check_spoken("t", text, FORMS, LEX), [])


class LessonMapLines(unittest.TestCase):
    """The lesson map's lines per ayah (operator 2026-10-13, plan L23 and L26): what they say, that
    a surah gets them only with its map file, and that a render of them is accepted."""

    S = {  # a made-up map's steps: names as lessonmap stores them, the lesson that teaches each
        "a": {"name": "Na’t (نَعْت)", "latin": "Na't", "lesson": "1:1"},
        "b": {"name": "Badal (بَدَل)", "latin": "Badal", "lesson": "1:7"},
        "c": {"name": "Mu’rab (مُعْرَب) dan mabni (مَبْنِيّ)", "latin": "Mu'rab dan mabni", "lesson": "1:3"},
        "d": {"name": "Idhafah (إِضَافَة)", "latin": "Idhafah", "lesson": "1:3"},
        "e": {"name": "Fi’il amr (فِعْل أَمْر)", "latin": "Fi'il amr", "lesson": "114:1"},
        "z": {"name": "Tiga jenis kata", "latin": "Tiga jenis kata", "lesson": "0"},
    }

    @staticmethod
    def entry(new="", again="", rest="", later="", lanjut=0, kinds=("isim", "fiil", "huruf")):
        """An ayah's entry: `again` the learnt steps that come up again here, `rest` the others,
        `kinds` the kinds of word its words are made of."""
        return {"new": list(new), "learnt": [{"id": x, "here": True} for x in again] + [{"id": x, "here": False} for x in rest],
                "later": list(later), "lanjut": [f"r{i}" for i in range(lanjut)], "kinds": list(kinds)}

    # The same steps as a map file holds them (no kinds table: the step "z" is a step like any other).
    C = {"steps": S, "kinds": None}
    # … and with the step of the three kinds of word named with its members, and the kinds table
    # (lessonmap.kinds_table; operator 2026-10-18: "in that ayat (example ayat-3) we only have isim").
    K = {"steps": {**S, "z": {"name": "Tiga jenis kata, yaitu isim (اِسْم), fi’il (فِعْل), dan huruf (حَرْف)",
                              "latin": "Tiga jenis kata (isim, fi'il, dan huruf)", "lesson": "0"}},
         "kinds": {"step": "z", "name": "Tiga jenis kata", "latin": "Tiga jenis kata",
                   "members": {"isim": {"name": "Isim (اِسْم)", "latin": "Isim"}, "fiil": {"name": "Fi’il (فِعْل)", "latin": "Fi'il"},
                               "huruf": {"name": "Huruf (حَرْف)", "latin": "Huruf"}}}}

    def test_wording(self):
        n = lambda new: B.map_new(self.entry(new), self.S)  # noqa: E731
        g = lambda again="", rest="": B.map_again(self.entry("", again, rest), self.C)  # noqa: E731
        t = lambda later="", lanjut=0: B.map_later(self.entry("", "", "", later, lanjut), self.S, 1)  # noqa: E731
        f = lambda new="", again="", later="", lanjut=0: B.map_focus(self.entry(new, again, "", later, lanjut), self.C)  # noqa: E731
        c = lambda new="", again="", rest="": B.map_closing(self.entry(new, again, rest), self.C)  # noqa: E731
        s = lambda new="", again="", rest="": B.map_total(self.entry(new, again, rest), self.S)  # noqa: E731
        # what is new: every step named (at most three), a name with a "dan" of its own set apart
        self.assertEqual(n(""), "Di ayat ini tidak ada hal baru.")
        self.assertEqual(n("a"), "Di ayat ini ada satu hal baru: na't.")
        self.assertEqual(n("ab"), "Di ayat ini ada dua hal baru: na't dan badal.")
        self.assertEqual(n("abd"), "Di ayat ini ada tiga hal baru: na't, badal, dan idhafah.")
        self.assertEqual(n("ac"), "Di ayat ini ada dua hal baru: na't, serta mu'rab dan mabni.")
        # what has been learnt so far is no opening line since 2026-10-17 (operator: "better to remove
        # this line in every ayat beginning: 'Sebelum ayat ini, kita sudah mempelajari XX hal'"); the
        # running total says it, at the close (map_total)
        self.assertFalse(hasattr(B, "map_learnt"))
        # what of it comes up again: every one by name (no "ada satu: X", no "di antaranya"), or plainly
        # none — on its own, saying what it picks from
        self.assertIsNone(g())
        self.assertEqual(g("", "ab"), "Tidak ada yang kita temui lagi di ayat ini.")
        self.assertEqual(g("a", "z"), "Dari yang sudah kita pelajari, yang kita temui lagi di ayat ini adalah na't.")
        self.assertEqual(g("zab", "d"), "Dari yang sudah kita pelajari, yang kita temui lagi di ayat ini adalah tiga jenis kata, na't, dan badal.")
        self.assertEqual(g("zabde"), "Dari yang sudah kita pelajari, yang kita temui lagi di ayat ini adalah tiga jenis kata, na't, badal, idhafah, dan fi'il amr.")
        # what is taught later: every one named; one ayah, several ayat of this surah, another surah
        self.assertIsNone(t())
        self.assertEqual(t("b"), "Ada satu hal lagi di ayat ini, yaitu badal, tetapi baru akan diajarkan lebih lengkap di ayat ketujuh.")
        self.assertEqual(t("cd"), "Ada dua hal lagi di ayat ini, yaitu mu'rab dan mabni, serta idhafah, tetapi baru akan diajarkan lebih lengkap di ayat ketiga.")
        self.assertEqual(t("db"), "Ada dua hal lagi di ayat ini, tetapi baru akan diajarkan lebih lengkap nanti: idhafah di ayat ketiga dan badal di ayat ketujuh.")
        self.assertEqual(t("be"), "Ada dua hal lagi di ayat ini, yaitu badal dan fi'il amr, tetapi baru akan diajarkan lebih lengkap nanti.")
        self.assertEqual(t("abcd"), "Ada empat hal lagi di ayat ini, tetapi baru akan diajarkan lebih lengkap nanti: na't di ayat pertama, badal di ayat ketujuh, "
                                    "mu'rab dan mabni di ayat ketiga, serta idhafah di ayat ketiga.")
        self.assertEqual(t("abcde"), "Ada lima hal lagi di ayat ini, yaitu na't, badal, mu'rab dan mabni, idhafah, serta fi'il amr, tetapi baru "
                                     "akan diajarkan lebih lengkap nanti.")
        # the next-level topics: ONE sentence with their count, never a name
        self.assertEqual(t("", 2), "Di ayat ini ada dua hal tingkat lanjut, yang tidak kita bahas di tingkat dasar.")
        self.assertEqual(t("b", 1), "Ada satu hal lagi di ayat ini, yaitu badal, tetapi baru akan diajarkan lebih lengkap di ayat ketujuh. "
                                    "Ada juga satu hal tingkat lanjut, yang tidak kita bahas di tingkat dasar.")
        # the reassurance after them (operator 2026-10-15: "Sekarang Anda tidak perlu menghafal
        # ketiganya, mari kita fokus pada pelajaran XXX dan YYY terlebih dahulu"): the pronoun by
        # the postponed count, the next-level ones "not to think about", the new steps by name
        self.assertEqual([V.focus_pronoun(x) for x in (1, 2, 3, 4, 9)], ["yang satu ini", "keduanya", "ketiganya", "semuanya", "semuanya"])
        self.assertIsNone(f("a"))  # nothing put aside: no reassurance
        self.assertEqual(f("a", "", "b"), "Sekarang Anda tidak perlu menghafal yang satu ini. Mari kita fokus pada pelajaran na't terlebih dahulu.")
        self.assertEqual(f("ab", "", "cd"), "Sekarang Anda tidak perlu menghafal keduanya. Mari kita fokus pada pelajaran na't dan badal terlebih dahulu.")
        self.assertEqual(f("ab", "", "cde", 1), "Sekarang Anda tidak perlu menghafal ketiganya, dan tidak perlu memikirkan hal tingkat lanjut tadi. "
                                                "Mari kita fokus pada pelajaran na't dan badal terlebih dahulu.")
        self.assertEqual(f("a", "", "bcde"), "Sekarang Anda tidak perlu menghafal semuanya. Mari kita fokus pada pelajaran na't terlebih dahulu.")
        self.assertEqual(f("ac", "", "", 2), "Sekarang Anda tidak perlu memikirkan keduanya. Mari kita fokus pada pelajaran na't, serta mu'rab dan "
                                             "mabni terlebih dahulu.")
        # … with nothing new: what the ayah repeats, or the ayah itself
        self.assertEqual(f("", "z", "b"), "Sekarang Anda tidak perlu menghafal yang satu ini. Mari kita fokus mengulang tiga jenis kata terlebih dahulu.")
        self.assertEqual(f("", "", "", 1), "Sekarang Anda tidak perlu memikirkan yang satu ini. Mari kita fokus pada ayat ini terlebih dahulu.")
        # the closing: what was new; with nothing new, what was repeated, by name
        self.assertEqual(c("ab", "z", "d"), "Di ayat ini kita mempelajari dua hal baru: na't dan badal.")
        self.assertEqual(c("", "za", "d"), "Di ayat ini tidak ada hal baru; kita mengulang dua hal yang sudah kita pelajari, yaitu tiga jenis kata "
                                           "dan na't.")
        self.assertEqual(c("", "", "ab"), "Di ayat ini tidak ada hal baru.")
        # … and its own line, the running total: every step by then, the learnt ones in teaching
        # order and then the new ones (operator: "Dengan itu, sudah empat hal yang kita pelajari,
        # yaitu A, B, C, D")
        self.assertEqual(s("ab", "z", "d"), "Dengan itu, sudah empat hal yang kita pelajari, yaitu tiga jenis kata, idhafah, na't, dan badal.")
        self.assertEqual(s("", "za", "d"), "Sampai ayat ini, sudah tiga hal yang kita pelajari, yaitu tiga jenis kata, na't, dan idhafah.")
        with self.assertRaises(ValueError):
            s()
        # which lines an ayah has
        self.assertEqual(V.map_opening_parts(self.entry("a")), ["map:new"])
        self.assertEqual(V.map_opening_parts(self.entry("a", "", "b")), ["map:new", "map:again"])
        self.assertEqual(V.map_opening_parts(self.entry("", "", "", "b")), ["map:new", "map:later", "map:focus"])
        self.assertEqual(V.map_opening_parts(self.entry("", "z", "", "", 1)), ["map:new", "map:again", "map:later", "map:focus"])
        self.assertEqual(V.map_opening_parts(None), [])
        self.assertEqual(V.map_closing_parts(self.entry("a")), ["learned", "map:total"])
        self.assertEqual(V.map_closing_parts(None), [])

    def test_the_kinds_of_word_met_here(self):
        # Operator 2026-10-18: "we always say in this ayat we find 3 jenis kata: isim, fi'il, huruf. But
        # actually in that ayat (example ayat-3) we only have isim, no harf or fi'il. Fix this in all
        # lessons." Where a line says the step is MET HERE, it names the kinds the ayah has.
        g = lambda kinds, again="za": B.map_again(self.entry("", again, "", kinds=kinds), self.K)  # noqa: E731
        f = lambda kinds: B.map_focus(self.entry("", "za", "", "b", kinds=kinds), self.K)  # noqa: E731
        c = lambda kinds: B.map_closing(self.entry("", "za", "", kinds=kinds), self.K)  # noqa: E731
        self.assertEqual(g(["isim", "fiil", "huruf"]), "Dari yang sudah kita pelajari, yang kita temui lagi di ayat ini adalah tiga jenis kata "
                                                      "(isim, fi'il, dan huruf), serta na't.")
        self.assertEqual(g(["isim"]), "Dari yang sudah kita pelajari, yang kita temui lagi di ayat ini adalah tiga jenis kata dan na't. "
                                      "Dari tiga jenis kata itu, di ayat ini hanya ada isim.")
        self.assertEqual(g(["isim", "huruf"]), "Dari yang sudah kita pelajari, yang kita temui lagi di ayat ini adalah tiga jenis kata dan "
                                               "na't. Dari tiga jenis kata itu, di ayat ini hanya ada isim dan huruf.")
        # the step not met here: nothing about the kinds
        self.assertEqual(g(["isim"], "a"), "Dari yang sudah kita pelajari, yang kita temui lagi di ayat ini adalah na't.")
        # with nothing new: the reassurance and the closing say it the same way
        self.assertTrue(f(["isim"]).endswith("Mari kita fokus mengulang tiga jenis kata dan na't terlebih dahulu. Dari tiga jenis kata itu, "
                                             "di ayat ini hanya ada isim."))
        self.assertEqual(c(["fiil", "huruf"]), "Di ayat ini tidak ada hal baru; kita mengulang dua hal yang sudah kita pelajari, yaitu tiga "
                                               "jenis kata dan na't. Dari tiga jenis kata itu, di ayat ini hanya ada fi'il dan huruf.")
        # … and read back, with its faults: the line in the old wording, a kind the ayah does not have,
        # the sentence left out, the sentence where all three occur.
        lesson = {"slug": "x", "surah": 1, "ayat": [{"ayah": 1}, {"ayah": 2}]}
        shown = lambda prose: BC.Namer(LESSONS, LEX).shown(prose)  # noqa: E731
        mp = {**self.K, "lanjut": {"r0": {"name": "Hal", "latin": "Hal", "from": "title"}}, "ayat": [
            {"ayah": 1, **self.entry("b", "za", "", kinds=["isim"])},
            {"ayah": 2, **self.entry("b", "za", "", kinds=["isim", "fiil", "huruf"])},
        ]}
        lines = {f"x:{a['ayah']}:map:again": {"display": shown(B.map_again(a, mp))} for a in mp["ayat"]}
        self.assertEqual(lines["x:1:map:again"]["display"], "Dari yang sudah kita pelajari, yang kita temui lagi di ayat ini adalah tiga "
                                                            "jenis kata dan na’t (نَعْت). Dari tiga jenis kata itu, di ayat ini hanya ada isim (اِسْم).")
        self.assertEqual(lines["x:2:map:again"]["display"], "Dari yang sudah kita pelajari, yang kita temui lagi di ayat ini adalah tiga "
                                                            "jenis kata, yaitu isim (اِسْم), fi’il (فِعْل), dan huruf (حَرْف), serta na’t (نَعْت).")
        again = lambda ls: [e for e in V.map_problems("x", ls, lesson, mp) if ":map:again" in e]  # noqa: E731
        self.assertEqual(again(lines), [])

        def put(lid, text):
            ls = copy.deepcopy(lines)
            ls[lid] = {"display": text}
            return again(ls)
        self.assertTrue(any("names isim, fi'il, huruf as met in this ayah" in e for e in put("x:1:map:again", lines["x:2:map:again"]["display"])))
        self.assertTrue(any("says this ayah has 'isim (اِسْم) dan huruf (حَرْف)' of the kinds of word; its words are isim" in e
                            for e in put("x:1:map:again", lines["x:1:map:again"]["display"].replace("hanya ada isim (اِسْم)", "hanya ada isim (اِسْم) dan huruf (حَرْف)"))))
        self.assertTrue(any("does not say which kinds of word this ayah has (isim)" in e
                            for e in put("x:1:map:again", lines["x:1:map:again"]["display"].split(" Dari tiga")[0])))
        self.assertTrue(any("says which kinds of word this ayah has" in e and "it has all three" in e
                            for e in put("x:2:map:again", lines["x:2:map:again"]["display"] + " Dari tiga jenis kata itu, di ayat ini hanya ada isim (اِسْم).")))
        self.assertTrue(any("names the kinds of word bare" in e
                            for e in put("x:2:map:again", lines["x:1:map:again"]["display"].split(" Dari tiga")[0])))

    def test_counts_and_names_read_back(self):
        for n in (0, 1, 9, 10, 11, 12, 19, 20, 21, 36, 40, 99):
            self.assertEqual(V.count_value(B.num_id(n)), n)
        self.assertIsNone(V.count_value("banyak"))
        known = {V._low(c["name"]): sid for sid, c in self.S.items()}
        self.assertEqual(V.named_concepts("na’t (نَعْت), serta mu’rab (مُعْرَب) dan mabni (مَبْنِيّ)", known), [("a", None), ("c", None)])
        self.assertEqual(V.named_concepts("badal (بَدَل) di ayat ketujuh dan idhafah (إِضَافَة) di ayat ketiga", known, places=True),
                         [("b", 7), ("d", 3)])
        self.assertIsNone(V.named_concepts("na’t (نَعْت) dan sifat", known))

    def test_a_made_up_map_reads_back(self):
        # Every wording above, through map_problems: an ayah with nothing new and nothing repeated,
        # one whose postponed steps share an ayah, one taught in another surah, one that puts
        # nothing aside.
        lesson = {"slug": "x", "surah": 1, "ayat": [{"ayah": n} for n in (1, 2, 3, 4)]}
        shown = lambda prose: BC.Namer(LESSONS, LEX).shown(prose)  # noqa: E731
        mp = {"steps": self.S, "lanjut": {"r0": {"name": "Hal", "latin": "Hal", "from": "title"}}, "ayat": [
            {"ayah": 1, **self.entry("", "", "za", "cd")},
            {"ayah": 2, **self.entry("", "z", "a", "e", 1)},
            {"ayah": 3, **self.entry("", "", "za", "", 1)},
            {"ayah": 4, **self.entry("b", "z", "a")},
        ]}
        lines = {}
        for a in mp["ayat"]:
            base = f"x:{a['ayah']}"
            said = {"map:new": B.map_new(a, self.S), "map:again": B.map_again(a, mp),
                    "map:later": B.map_later(a, self.S, 1), "map:focus": B.map_focus(a, mp),
                    "learned": B.map_closing(a, mp), "map:total": B.map_total(a, self.S)}
            for part in [*V.map_opening_parts(a), *V.map_closing_parts(a)]:
                lines[f"{base}:{part}"] = {"display": shown(said[part])}
        self.assertEqual(V.map_problems("x", lines, lesson, mp), [])
        self.assertEqual(lines["x:1:map:again"]["display"], "Tidak ada yang kita temui lagi di ayat ini.")
        self.assertIn("tetapi baru akan diajarkan lebih lengkap di ayat ketiga.", lines["x:1:map:later"]["display"])
        self.assertTrue(lines["x:2:map:focus"]["display"].endswith("Mari kita fokus mengulang tiga jenis kata terlebih dahulu."))
        self.assertTrue(lines["x:3:map:total"]["display"].startswith("Sampai ayat ini, sudah dua hal yang kita pelajari, yaitu "))
        self.assertNotIn("x:4:map:focus", lines)
        problems = lambda edit: V.map_problems("x", edit(copy.deepcopy(lines)), lesson, mp)  # noqa: E731

        def put(lid, text):
            def f(ls):
                ls[lid] = {"display": text}
                return ls
            return f
        # Said to come up again where none does; a shared ayah that is the wrong one; repeated
        # steps where nothing is new and nothing comes up again; a reassurance where nothing is put
        # aside; "Dengan itu" after an ayah that taught nothing.
        self.assertTrue(any("x:1:map:again: no learnt step comes up again in this ayah" in e
                            for e in problems(put("x:1:map:again", lines["x:2:map:again"]["display"]))))
        self.assertTrue(any("says the postponed steps are taught in ayah 5; the lesson map says ayah 3" in e
                            for e in problems(put("x:1:map:later", lines["x:1:map:later"]["display"].replace("ketiga", "kelima")))))
        self.assertTrue(any("x:3:learned: the lesson map has no new step here and none comes up again" in e
                            for e in problems(put("x:3:learned", "Di ayat ini tidak ada hal baru; kita mengulang dua hal yang sudah kita "
                                                                 "pelajari, yaitu tiga jenis kata dan na’t (نَعْت)."))))
        self.assertTrue(any("x:4:map:focus: the ayah puts nothing aside" in e
                            for e in problems(put("x:4:map:focus", "Sekarang Anda tidak perlu menghafal yang satu ini. Mari kita fokus pada "
                                                                   "pelajaran badal (بَدَل) terlebih dahulu."))))
        self.assertTrue(any("x:3:map:total: opens “Dengan itu” exactly when the ayah taught something new" in e
                            for e in problems(put("x:3:map:total", lines["x:3:map:total"]["display"].replace("Sampai ayat ini", "Dengan itu")))))
        # The reassurance, with nothing new, says what is repeated — not "pelajaran …".
        self.assertTrue(any("x:2:map:focus: the ayah has nothing new, and the line does not end with the learnt steps it repeats" in e
                            for e in problems(put("x:2:map:focus", lines["x:2:map:focus"]["display"].replace(
                                "fokus mengulang tiga jenis kata", "fokus pada pelajaran tiga jenis kata")))))
        self.assertTrue(any("x:3:map:focus: the ayah has nothing new and repeats nothing" in e
                            for e in problems(put("x:3:map:focus", "Sekarang Anda tidak perlu memikirkan yang satu ini. Mari kita mulai."))))

    def test_al_fatihah_lines(self):
        lines = MANIFESTS["al-fatihah"]["lines"]
        is_map = lambda lid: lid.split(":", 2)[2] in V.MAP_PARTS  # noqa: E731
        ids = [lid for lid in lines if is_map(lid)]
        # Every ayah of Al-Fatihah has all five opening lines: something was learnt before each
        # (the lesson with no ayah comes first), and each has a next-level topic at least — and the
        # two closing ones.
        self.assertEqual(ids, [f"al-fatihah:{n}:{p}" for n in range(1, 8) for p in V.MAP_PARTS])
        for lid in ids:
            with self.subTest(lid):
                ln = lines[lid]
                self.assertEqual((ln["highlight"], ln["focus"]), ([], None))
                self.assertNotIn("frame", ln)
                self.assertLessEqual(len(ln["text"]), V.MAX_LINE)
                self.assertEqual(V.held(ln["text"], LEX), [], "every Al-Fatihah map line is renderable")
        # Where each sits: right after the imam's recitation, right before the recap.
        order = [lid for lid in lines if lid.startswith("al-fatihah:2:")]
        at = order.index("al-fatihah:2:recite")
        self.assertEqual(order[at + 1:at + 1 + len(V.MAP_OPENING)], [f"al-fatihah:2:{p}" for p in V.MAP_OPENING])
        end = order.index("al-fatihah:2:recap")
        self.assertEqual(order[end - len(V.MAP_CLOSING):end], [f"al-fatihah:2:{p}" for p in V.MAP_CLOSING])
        # Ayah 1: two new steps; two learnt before it (the lesson with no ayah), both met again in
        # every ayah (the harakat too since 2026-10-17: "in alfatihah ayat-1 it says no harakat?"),
        # the three kinds as this ayah has them — isim and huruf, no fi'il (2026-10-18: "in that
        # ayat (example ayat-3) we only have isim"); with their members only where all three occur
        # (the running total names them: what was learnt); three steps seen and taught in ayat 3 and 4
        # ("baru akan diajarkan lebih lengkap", 2026-10-17); one next-level topic, counted; the
        # reassurance; what was new; the running total — every counted step named (2026-10-15).
        self.assertEqual([lines[f"al-fatihah:1:{p}"]["display"] for p in V.MAP_PARTS], [
            "Di ayat ini ada dua hal baru: majrur (مَجْرُور) dan huruf jar (حَرْف جَرّ).",
            "Dari yang sudah kita pelajari, yang kita temui lagi di ayat ini adalah harakat dan tiga jenis kata. Dari tiga jenis kata itu, "
            "di ayat ini hanya ada isim (اِسْم) dan huruf (حَرْف).",
            "Ada tiga hal lagi di ayat ini, tetapi baru akan diajarkan lebih lengkap nanti: alif lam (ال) di ayat ketiga, na’t (نَعْت) "
            "di ayat ketiga, dan idhafah (إِضَافَة) di ayat keempat. Ada juga satu hal tingkat lanjut, yang tidak kita bahas di tingkat dasar.",
            "Sekarang Anda tidak perlu menghafal ketiganya, dan tidak perlu memikirkan hal tingkat lanjut tadi. Mari kita fokus pada "
            "pelajaran majrur (مَجْرُور) dan huruf jar (حَرْف جَرّ) terlebih dahulu.",
            "Di ayat ini kita mempelajari dua hal baru: majrur (مَجْرُور) dan huruf jar (حَرْف جَرّ).",
            "Dengan itu, sudah empat hal yang kita pelajari, yaitu harakat, tiga jenis kata, yaitu isim (اِسْم), fi’il (فِعْل), dan huruf "
            "(حَرْف), majrur (مَجْرُور), serta huruf jar (حَرْف جَرّ).",
        ])
        # The running total at each closing: 4, 7, 9, 10, 13, 16, 19 (kurikulum-dasar.md E), each
        # with all its names; the longest list, ayah 7's sixteen learnt and nineteen in all, is one
        # line each, within MAX_LINE (checked above).
        totals = [V.count_value(V._MAP_TOTAL.match(lines[f"al-fatihah:{n}:map:total"]["display"]).group("n")) for n in range(1, 8)]
        self.assertEqual(totals, [4, 7, 9, 10, 13, 16, 19])
        self.assertNotIn("di antaranya", " ".join(lines[lid]["display"] for lid in ids))
        # No next-level topic is ever named by the narrator (nine of them, on seven cards): the
        # one sentence about them is their count, and the reassurance after it names none either.
        for n in range(1, 8):
            shown = lines[f"al-fatihah:{n}:map:later"]["display"]
            self.assertRegex(shown.split(". ")[-1], r"^(?:Ada juga|Di ayat ini ada) [a-z ]+ hal tingkat lanjut, yang tidak kita bahas di tingkat dasar\.$")
            for cid, c in LESSONMAP["al-fatihah"]["lanjut"].items():
                for part in ("map:later", "map:focus"):
                    self.assertNotIn(V._low(c["name"]), lines[f"al-fatihah:{n}:{part}"]["display"], f"ayah {n} {part} names {cid}")

    def test_the_konsep_baru_lines_follow_the_curriculum(self):
        # At most three per ayah, in the order the curriculum lists them, none for a next-level
        # record — in every surah (the Qul surahs follow mechanically; they have no map).
        for slug, man in MANIFESTS.items():
            if slug == "shared":
                continue
            for a in LESSONS[slug]["ayat"]:
                base = f"{slug}:{a['ayah']}:"
                said = list(dict.fromkeys(re.sub(r":[a-z]$", "", lid)[len(base):] for lid in man["lines"] if lid.startswith(base + "concept:")))
                self.assertEqual(said, [t["line"] for t in V.taught_lines(a, CURRICULUM)], base)
                self.assertLessEqual(len(said), CUR.MAX_STEPS, base)
        said = {lid.split(":", 2)[2] for man in MANIFESTS.values() for lid in man["lines"] if ":concept:" in lid}
        self.assertFalse({f"concept:{cid}" for cid in CURRICULUM["lanjut"]} & said)
        # Al-Fatihah: 2, 3, 2, 1, 3, 3, 3 lines (it was 5, 3, 1, 1, 8, 2, 6).
        fatihah = MANIFESTS["al-fatihah"]["lines"]
        self.assertEqual([len({re.sub(r":[a-z]$", "", lid) for lid in fatihah if lid.startswith(f"al-fatihah:{n}:concept:")}) for n in range(1, 8)],
                         [2, 3, 2, 1, 3, 3, 3])
        # A step with its own text: its line, lit on the words it occurs on.
        self.assertEqual(fatihah["al-fatihah:1:concept:majrur"]["highlight"], [1, 2, 3, 4])
        self.assertEqual(fatihah["al-fatihah:3:concept:alif-lam"]["highlight"], [1, 2])
        self.assertTrue(fatihah["al-fatihah:3:concept:alif-lam"]["display"].startswith("Konsep baru: Alif lam (ال), penanda isim (اِسْم) yang tertentu."))
        self.assertIn("seperti nama Allah subhanahu wa ta'ala, sudah ma’rifah (مَعْرِفَة) tanpa alif lam (ال).", fatihah["al-fatihah:3:concept:alif-lam"]["display"])
        # The lesson with no ayah has its page (2026-10-13): the kalimah record's line is said
        # there, once, and the harakat primer left ayah 1 for it.
        self.assertIn("al-fatihah:0:concept:kalimah-isim-fiil-huruf", fatihah)
        self.assertNotIn("al-fatihah:1:concept:kalimah-isim-fiil-huruf", fatihah)
        self.assertIn("al-fatihah:0:primer:1", fatihah)
        self.assertFalse(any(lid.startswith("al-fatihah:1:primer:") for lid in fatihah))

    def test_a_moved_line_keeps_its_audio(self):
        # The curriculum moved four "Konsep baru" lines to another ayah of Al-Fatihah with their
        # text unchanged: the manifest keeps their audio, which is named by the text, not the place.
        lines = MANIFESTS["al-fatihah"]["lines"]
        for lid in ("al-fatihah:3:concept:naat", "al-fatihah:4:concept:idhafah", "al-fatihah:6:concept:jumlah-filiyyah",
                    "al-fatihah:7:concept:athaf"):
            self.assertIn("audio", lines[lid], lid)
        # A new line's text is new: it has no audio of anyone else's text (the steps with their
        # own text, the map's lines). Before its render it has none; after it (2026-10-14: the
        # rework's 132 lines) it has its OWN, named by its text; this holds in both states. That
        # a changed text drops the old audio is what the next test plants (the mechanism).
        for lid in ("al-fatihah:1:concept:majrur", "al-fatihah:2:concept:marfu", "al-fatihah:1:map:new", "al-fatihah:1:learned"):
            audio = lines[lid].get("audio")
            if audio is not None:
                self.assertEqual(audio["url"], V.delivery_url(MANIFESTS["al-fatihah"]["voice"], "al-fatihah", lines[lid]["text"], audio["sha256"]), lid)
        # … and a composition line whose text did not change kept its own (word 1 of ayah 1's
        # third, its base form; the second, until 2026-10-17 — it names its tile since, "Sibling
        # lines", a new text), and most of the 150-odd composition lines — the ones
        # reworded since (2026-10-13: no term before its lesson; 2026-10-17: the review, rules 26
        # and 29) wait for a render, like any new text. (Until 2026-10-17 the word lines too: since,
        # each names its word, "Kata pertama, yaitu بِسْمِ (bismi), artinya: …", a new text.)
        self.assertIn("audio", lines["al-fatihah:1:w1:compose:3"])
        compose_lines = [ln for lid, ln in lines.items() if re.fullmatch(r"al-fatihah:\d:w\d:compose:\d+", lid)]
        self.assertGreater(sum("audio" in ln for ln in compose_lines), 0.6 * len(compose_lines))
        text = "Konsep baru: نَعْت, yaitu sifat."
        aud = {"url": V.delivery_url(VOICE, "x", text, SHA), "ms": 2000, "sha256": SHA}
        old = {"version": 2, "voice": dict(VOICE), "lines": {
            "x:1:concept:naat": {"text": text, "display": "d", "highlight": [], "focus": None, "audio": aud, "tokens": fake_tokens(text)},
            "x:1:w1": {"text": "Kata pertama.", "display": "d", "highlight": [1], "focus": None, "audio": aud, "tokens": fake_tokens("Kata pertama.")},
        }}
        new = lambda lines: B.manifest(lines, old, LEX, FORMS)["lines"]  # noqa: E731
        bare = lambda t: {"text": t, "display": LEX.render_display(t), "highlight": [], "focus": None}  # noqa: E731
        # moved: the old id is gone, the text is the same
        self.assertEqual(new({"x:3:concept:naat": bare(text)})["x:3:concept:naat"]["audio"], aud)
        # the old line is still there and a second line says the same text: one file for both,
        # as the renderer would give them (identical texts are rendered once and copied)
        got = new({"x:1:concept:naat": bare(text), "x:3:concept:naat": bare(text)})
        self.assertEqual(got["x:1:concept:naat"]["audio"], aud)
        self.assertEqual(got["x:3:concept:naat"]["audio"], aud)
        # renumbered (the quiz replanned, 2026-10-13): the id lives on with another text, and the
        # line that now says the old text keeps the recording
        got = new({"x:1:concept:naat": bare("Konsep baru: lain."), "x:2:concept:naat": bare(text)})
        self.assertNotIn("audio", got["x:1:concept:naat"])
        self.assertEqual(got["x:2:concept:naat"]["audio"], aud)
        # another text: nothing to take
        self.assertNotIn("audio", new({"x:3:concept:naat": bare(text + " Lagi.")})["x:3:concept:naat"])
        # a line that kept its id and changed its text loses its audio, as before
        self.assertNotIn("audio", new({"x:1:w1": bare("Kata pertama, lagi.")})["x:1:w1"])

    def test_terms_the_dictionary_does_not_match_are_found_by_the_term_table(self):
        # 2026-10-13: nafi, zharaf, mubalaghah, maqul al-qaul … have no pronunciation entry, so a
        # line says them in Latin and the dictionary-only check did not see them; nor a dictionary
        # term with -nya.
        ids = V.term_ids(LEX)
        self.assertNotIn("nafi", set(ids.values()))
        self.assertNotIn("zharaf", set(ids.values()))
        self.assertEqual(V.prose_terms("Huruf yang menafikan, lalu zharaf dan maqul al-qaul.", LEX, ids), ["nafi", "zharaf", "maqul-al-qaul"])
        self.assertEqual(V.prose_terms("Fa'il-nya tersirat, dan shilah-nya dua kata.", LEX, ids), ["fail", "shilah"])
        # … in the order they stand, among the dictionary's own matches, each once per use
        self.assertEqual(V.prose_terms("Ini badal, lalu zharaf, lalu na't, lalu zharaf.", LEX, ids), ["badal", "zharaf", "naat", "zharaf"])
        # A caption shows the same: display forms for the dictionary's, Latin for the rest.
        sp = B.Speech(LEX)
        prose = "Ini badal, lalu zharaf, dan fa'il-nya."
        self.assertEqual(V.caption_terms(sp.shown(sp.mark(prose), None), LEX, ids), V.prose_terms(prose, LEX, ids))
        # A form that is an ordinary Indonesian word too is the author's call: not found.
        forms = TERMS.TermForms([{"id": "hal", "forms": ["hal"], "ambiguous_forms": ["hal"]}, {"id": "jar", "forms": ["jar"]},
                                 {"id": "huruf-jar", "forms": ["huruf jar"]}])
        self.assertEqual([t for _a, _b, t in forms.spans("Dua hal: huruf jar, lalu jar-nya, bukan jarak.")], ["huruf-jar", "jar"])
        self.assertEqual(TERMS.TermForms([]).spans("apa saja"), [])
        # Without the term table beside the ids (a plain dict), only the dictionary's matches.
        self.assertEqual(V.prose_terms("Ini badal, lalu zharaf.", LEX, dict(ids)), ["badal"])

    def test_terms_in_prose_and_caption_agree(self):
        ids = V.term_ids(LEX)
        prose = "Akhirnya kasrah karena menjadi mudhaf ilaih; huruf jar lam dan lafaz Allah, lalu na't."
        sp = B.Speech(LEX)
        self.assertEqual(V.prose_terms(prose, LEX, ids), ["kasrah", "mudhaf-ilaih", "huruf-jar", "naat"])
        self.assertEqual(V.caption_terms(sp.shown(sp.mark(prose), None), LEX, ids), ["kasrah", "mudhaf-ilaih", "huruf-jar", "naat"])
        # The build held every line to it (build_all stops when a caption shows other terms than
        # its prose uses); what it finds too early is exactly what the list tolerates.
        _built, early = B.build_all(LESSONS, LIBRARY, LEX)
        self.assertEqual(early, PENDING["lines"])
        found = V.term_order_found(V.manifest_term_uses(MANIFESTS["al-fatihah"]["lines"], LEX, ids), LESSONS["al-fatihah"], CURRICULUM,
                                   lambda ayah: V.later_allowance(V.LESSONMAP.ayah_entry(LESSONMAP["al-fatihah"], ayah), LESSONMAP["al-fatihah"],
                                                                  lambda rec: V.caption_terms(rec["name"], LEX, ids)))
        self.assertEqual(found, {k: v for k, v in PENDING["lines"].items() if k.startswith("al-fatihah:")})
        # A map:later line names its postponed steps, and only there: without the exemption the
        # seven of Al-Fatihah would each be a finding.
        strict = V.term_order_found(V.manifest_term_uses(MANIFESTS["al-fatihah"]["lines"], LEX, ids), LESSONS["al-fatihah"], CURRICULUM,
                                    lambda ayah: set())
        self.assertEqual(sorted(set(strict) - set(found)), [f"al-fatihah:{n}:map:later" for n in (1, 2, 5, 6, 7)])
        # The list, emptied, leaves the check running: every entry is then a finding.
        errs = V.term_order_problems(MANIFESTS, LESSONS, LEX, CURRICULUM, LESSONMAP, {"lines": {}})
        self.assertEqual(len(errs), sum(len(v) for v in PENDING["lines"].values()))

    def test_only_a_surah_with_a_map_gets_the_lines(self):
        quiz = V.load_quiz()
        without = B.build_lines(LESSONS, LIBRARY, LEX, COMPOSE, quiz, {})
        with_map = B.build_lines(LESSONS, LIBRARY, LEX, COMPOSE, quiz, LESSONMAP)
        is_map = lambda lid: V.is_map_part(lid.split(":", 2)[2]) if lid.count(":") >= 2 and not lid.startswith("shared:") else False  # noqa: E731
        # Al-Fatihah: 7 ayat × 6 (map:learnt removed 2026-10-17); Al-Ikhlas (switched on 2026-10-19):
        # 4 ayat × 8, its running total said unit by unit (map:total, map:total:1, map:total:2).
        per = {"al-fatihah": 42, "al-ikhlas": 32}
        for name in with_map:
            added = [lid for lid in with_map[name] if lid not in without[name]]
            self.assertEqual(len(added), per.get(name, 0), name)
            self.assertTrue(all(is_map(lid) for lid in added))
            # … and every other line is what it was without the map, in the same order.
            self.assertEqual({k: v for k, v in with_map[name].items() if k not in added}, without[name], name)
            self.assertEqual([k for k in with_map[name] if k not in added], list(without[name]), name)

    def test_another_surah_switched_on(self):
        # An-Nas with a map of its own. Two of its steps have no text yet, so the real curriculum
        # refuses the switch (test_validate_map.py); here they are left out, and the surah's lines
        # are built in the CURRICULUM's order (An-Nas comes right after Al-Fatihah: 19 steps are
        # learnt before its first ayah), pass the validator, and move no other surah but Al-Ikhlas
        # (switched on 2026-10-19, taught after An-Nas: the two steps left out leave its learnt
        # lists and its running total too, so its lines are built anew here as well).
        import build_map as BM
        import lessonmap as LM
        import terms as TERMS
        authored = copy.deepcopy(CUR.load_authored())
        authored["steps"] = [s for s in authored["steps"] if s["id"] not in ("jamak-taksir", "mudzakkar-muannats")]
        cur = BC.build(authored, LESSONS, LIBRARY, TERMS.load_terms(), BC.Namer(LESSONS, LEX))
        maps = BM.build_all(LESSONS, LIBRARY, LEX, {"al-fatihah": LM.load_authored("al-fatihah"), "al-ikhlas": LM.load_authored("al-ikhlas"),
                                                    "an-nas": {"slug": "an-nas", "names": {}}}, cur)
        self.assertEqual(maps["al-fatihah"], LESSONMAP["al-fatihah"])
        self.assertEqual(maps["an-nas"]["steps"]["fiil-amr"]["lesson"], "114:1")
        quiz = V.load_quiz()
        built = B.build_lines(LESSONS, LIBRARY, LEX, COMPOSE, quiz, maps, cur)
        new = [lid for lid in built["an-nas"] if lid not in MANIFESTS["an-nas"]["lines"]]
        self.assertEqual(sorted(new), sorted(f"an-nas:{n}:{p}" for n in range(1, 7) for p in V.MAP_PARTS))
        self.assertEqual(built["an-nas"]["an-nas:1:map:new"]["display"], "Di ayat ini ada satu hal baru: fi’il amr (فِعْل أَمْر).")
        self.assertNotIn("an-nas:1:map:learnt", built["an-nas"])  # the learnt-so-far line, removed 2026-10-17
        self.assertTrue(built["an-nas"]["an-nas:1:map:again"]["display"].startswith(
            "Dari yang sudah kita pelajari, yang kita temui lagi di ayat ini adalah harakat, tiga jenis kata, yaitu isim (اِسْم), fi’il (فِعْل), dan huruf (حَرْف), "))
        self.assertEqual(built["an-nas"]["an-nas:3:map:new"]["display"], "Di ayat ini tidak ada hal baru.")
        # (six until 2026-10-17: harakat is met again in every ayah, operator addition A)
        self.assertTrue(built["an-nas"]["an-nas:3:learned"]["display"].startswith("Di ayat ini tidak ada hal baru; kita mengulang tujuh hal"))
        self.assertEqual(built["al-fatihah"], B.build_lines(LESSONS, LIBRARY, LEX, COMPOSE, quiz, LESSONMAP)["al-fatihah"])
        m = copy.deepcopy(MANIFESTS)
        m["an-nas"] = B.manifest(built["an-nas"], m["an-nas"], LEX, FORMS)
        m["al-ikhlas"] = B.manifest(built["al-ikhlas"], m["al-ikhlas"], LEX, FORMS)
        self.assertNotIn("jamak taksir", m["al-ikhlas"]["lines"]["al-ikhlas:4:map:total:2"]["display"])
        self.assertEqual(V.check(m, LESSONS, LIBRARY, lex=LEX, compose=COMPOSE, lessonmap=maps, curriculum=cur), [])

    def test_rendered_map_lines_pass(self):
        # With the delivered file's audio and its tokens on each of the 42 lines, the validator
        # accepts them and a rebuild keeps them (the text did not change). A line without audio (the
        # lines of 2026-10-13's curriculum, until the operator renders them) gets a stand-in here,
        # so this holds before and after the render.
        m = copy.deepcopy(MANIFESTS)
        man = m["al-fatihah"]
        seen = 0
        for lid, ln in man["lines"].items():
            if lid.split(":", 2)[2] in V.MAP_PARTS:
                seen += 1
                if "audio" not in ln:
                    ln["audio"] = {"url": V.delivery_url(man["voice"], "al-fatihah", ln["text"], SHA), "ms": len(ln["text"]) * 50 + 500, "sha256": SHA}
                    ln["tokens"] = fake_tokens(ln["text"], None, ln.get("display"))
        self.assertEqual(seen, 42)
        self.assertEqual(V.check(m, LESSONS, LIBRARY, lex=LEX, compose=COMPOSE, lessonmap=LESSONMAP), [])
        rebuilt = B.manifest(B.build_lines(LESSONS, LIBRARY, LEX, COMPOSE, V.load_quiz(), LESSONMAP)["al-fatihah"], man, LEX, FORMS,
                             V.letters_for("al-fatihah", LESSONS, FORMS, COMPOSE, LIBRARY))
        self.assertEqual(B.dump(rebuilt), B.dump(man))

    def test_unrendered_map_lines_pass(self):
        # The same 42 lines BEFORE a render — no audio, no tokens — are caption-only by design and
        # still valid, whatever the manifest on disk holds today.
        m = copy.deepcopy(MANIFESTS)
        stripped = 0
        for lid, ln in m["al-fatihah"]["lines"].items():
            if lid.split(":", 2)[2] in V.MAP_PARTS:
                stripped += 1
                ln.pop("audio", None)
                ln.pop("tokens", None)
        self.assertEqual(stripped, 42)
        self.assertEqual(V.check(m, LESSONS, LIBRARY, lex=LEX, compose=COMPOSE, lessonmap=LESSONMAP), [])


class Dictionary(unittest.TestCase):
    def test_dictionary_passes_its_rules(self):
        self.assertEqual(LEX.problems(FORMS), [])
        self.assertNotIn("عَلَى", LEX.by_term, "عَلَى was removed: it is the front of a Qur'anic word (1:7)")

    def test_heavy_letters(self):
        for term in ("إِضَافَة", "مُضَاف إِلَيْه", "ضَمَّة", "ضَمِير"):
            self.assertTrue(V.HEAVY_A.search(term), term)
            self.assertFalse(V.ARABIC.search(LEX.by_term[term].speak), f"{term} needs a Latin respelling")
        for term in ("كَسْرَة", "تَصْرِيف", "فَتْحَة", "نَعْت"):
            self.assertFalse(V.HEAVY_A.search(term), term)

    def test_quranic_arabic(self):
        self.assertTrue(FORMS.quranic_arabic("عَلَى"))      # the front of عَلَيْهِمْ
        self.assertTrue(FORMS.quranic_arabic("ٱلرَّحْمَٰنِ"))
        self.assertTrue(FORMS.quranic_arabic("رَبِّ"))       # بِرَبِّ without its proclitic
        for term in ("اِسْم", "حَرْف جَرّ", "كَسْرَة", "لَام", "بَاء"):
            self.assertFalse(FORMS.quranic_arabic(term), term)

    def test_speech_and_caption(self):
        sp = B.Speech(LEX)
        marked = sp.mark("Akhirnya kasrah karena menjadi sifat (na't) bagi kata kedua, lalu mudhaf ilaih.")
        self.assertEqual(sp.spoken(marked),
                         "Akhirnya كَسْرَة karena menjadi sifat, atau نَعْت, bagi kata kedua, lalu mudhof ilaih.")
        shown = sp.shown(marked, None)
        self.assertEqual(shown, "Akhirnya kasrah (كَسْرَة) karena menjadi sifat, atau na’t (نَعْت), bagi kata kedua, "
                                "lalu mudhaf ilaih (مُضَاف إِلَيْه).")
        self.assertEqual(LEX.speech_of_display(shown), sp.spoken(marked))
        # "huruf" stays Indonesian outside the three word classes; a compound the dictionary has
        # (2026-10-11) is said whole, from Arabic script or its respelling (ض + alif: rule 9) …
        self.assertEqual(sp.spoken(sp.mark("empat huruf, isim fa'il, dan fi'il mudhari'")),
                         "empat huruf, اِسْم فَاعِل, dan fi'il mudhori'")
        # … and one it lacks keeps its head as written (held until the dictionary has it)
        self.assertEqual(sp.spoken(sp.mark("fi'il majhul")), "fi'il majhul")
        # the letter of a preposition: its name is said, the letter as in the ayah is shown — alone,
        # without its Latin name beside it (operator 2026-10-17)
        marked = sp.mark("Huruf lam yang artinya “bagi”.")
        self.assertEqual(sp.spoken(marked), "Huruf لَام yang artinya bagi.")
        self.assertEqual(sp.shown(marked, None), "Huruf لِ yang artinya “bagi”.")
        self.assertEqual(sp.shown(marked, FORMS.word_ar["112:4:3"]), f"Huruf {LAHU_L} yang artinya “bagi”.")
        self.assertEqual(LEX.speech_of_display(sp.shown(marked, None)), sp.spoken(marked))
        self.assertEqual(sp.spoken(sp.mark("Sifat bagi “Allah”.")), "Sifat bagi Alloh.")

    def test_tokens(self):
        text = "Akhirnya dibaca كَسْرَة, karena didahului حَرْف جَرّ, yaitu huruf بَاء. Alloh."
        toks = fake_tokens(text)
        self.assertEqual([t["t"] for t in toks],
                         ["Akhirnya", "dibaca", "kasrah (كَسْرَة),", "karena", "didahului", "huruf jar (حَرْف جَرّ),",
                          "yaitu", "huruf", "بِ.", "Allah."])
        self.assertEqual(" ".join(t["t"] for t in toks), LEX.render_display(text))
        # a two-word term is one token: from its first character to the comma glued to it
        a = text.index("حَرْف")
        self.assertEqual((toks[5]["s"], toks[5]["e"]), (round(a * 0.05, 3), round(text.index(",", a) * 0.05 + 0.04, 3)))
        with self.assertRaises(ValueError):
            LEX.tokens(text, [0.0], [0.1])

    def test_title_capital(self):
        # Right after "Konsep baru:" the title starts: a term spoken from Arabic script is shown
        # capitalised there (as the caption shows it), and only there.
        self.assertEqual(LEX.render_display("Konsep baru: نَعْت, yaitu sifat. Tiga jenis كَلِمَة, atau kata: اِسْم."),
                         "Konsep baru: Na’t (نَعْت), yaitu sifat. Tiga jenis kalimah (كَلِمَة), atau kata: isim (اِسْم).")

    def test_heavy_latin(self):
        # dh zh kh gh sh th q + a, unless the dictionary respells it (mudhof ilaih, idhofah, Bashrah);
        # fathatain's t-h is ta then ha, not tha'.
        text = "Khabar dan mudhof ilaih, idhofah, fathatain, Bashrah, di-'athaf-kan, zharaf, qaul, dhommah."
        self.assertEqual(V.heavy_latin(text, LEX), ["Khabar", "'athaf", "zharaf", "qaul"])
        # menghafal (the lesson map's reassurance, 2026-10-15) is meng- + hafal, not ghain; only that
        # word: another form of it is still held until someone decides it.
        self.assertEqual(V.heavy_latin("Anda tidak perlu menghafal ketiganya; menghafalnya nanti.", LEX), ["menghafalnya"])
        rows = [("x", "x:1:w1", "Kata pertama adalah khabar."), ("x", "x:1:w2", "Akhirnya dibaca كَسْرَة.")]
        self.assertEqual(R.blocked(rows, LEX), [("x:1:w1", ["khabar"])])

    def test_huruf_is_the_word_class_only_where_the_three_kinds_are_named(self):
        # "huruf" is plain Indonesian for a letter; the dictionary says it as the term (حَرْف) only
        # where the Kalimah record lists the three kinds, and — since the warm-up, 2026-10-13 —
        # where the warm-up names them: its introduction and its explanation of a huruf.
        term = LEX.by_term["حَرْف"]

        def found(prose):
            return [prose[a:b] for a, b, t, _cap in LEX.latin_matches(prose) if t is term]

        for prose in ("tebak dulu jenisnya: isim, fi'il, atau huruf.", "Pilih jenisnya: isim, fi'il, atau huruf.",
                      "Bagian pertama kata pertama adalah huruf, yaitu kata tugas.", "isim, fi'il, dan huruf",
                      "Bagian pertama kata pertama, yaitu bi, yang artinya “dengan”, adalah huruf, karena ia kata tugas.",
                      "atau huruf (kata tugas)."):
            self.assertEqual(found(prose), ["huruf"], prose)
        for prose in ("Huruf pertama Surah Al-Fatihah, huruf ba', memakai kasrah.", "Bagian pertama adalah huruf jar, yaitu huruf ba'.",
                      "Kata ini adalah huruf 'athaf.", "Tanda itu adalah huruf kecil.", "empat huruf atau huruf mati",
                      "Yang pertama adalah huruf, bukan kata."):
            self.assertEqual(found(prose), [], prose)
        # The lines as built: the three kinds said from the dictionary, a letter still a letter.
        lines = MANIFESTS["al-fatihah"]["lines"]
        self.assertIn("اِسْم, فِعْل, atau حَرْف.", lines["al-fatihah:1:ex:word-kind:intro"]["text"])
        self.assertEqual(lines["al-fatihah:1:ex:word-kind:1:why"]["text"],
                         "Bagian pertama kata pertama, yaitu bi, yang artinya dengan, adalah حَرْف, karena ia kata tugas.")
        self.assertNotIn("حَرْف,", lines["al-fatihah:0:primer:5"]["text"])
        self.assertEqual(MANIFESTS["shared"]["lines"]["shared:ex:word-kind:options"]["text"], "Pilih jenisnya: اِسْم, فِعْل, atau حَرْف.")

    def test_latin_terms_and_pending(self):
        # Arabic terms said in Latin are held back (render refuses them); the honorifics, Indonesian
        # words of Arabic origin and the pesantren verbs are not terms; "ya" is the letter only as ya'.
        text = "Kata ini mubtada' dan khabarnya; huruf ya' itu, ya, harakat dan lafaz Alloh subhanahu wa ta'ala dijarkan."
        self.assertEqual(V.latin_terms(text, LEX), ["mubtada'", "khabarnya", "ya'"])
        rows = [("x", "x:1:w1", "Kata pertama adalah mubtada'."), ("x", "x:1:w2", "Akhirnya dibaca كَسْرَة.")]
        self.assertEqual(R.blocked(rows, LEX), [("x:1:w1", ["mubtada'"])])
        # a pending term (operator waived the pre-render review) renders and is reported
        mim = LEX.by_term["مِيم"]
        self.assertTrue(mim.pending)
        self.assertFalse(LEX.by_term["كَسْرَة"].pending)
        self.assertEqual(V.check_spoken("t", "Di atas huruf مِيم.", FORMS, LEX), [])
        self.assertIn("مِيم", V.pending_terms(MANIFESTS, LEX))
        # alif is said as written (its Arabic name is refused, rule 3) and shown as on screen: the
        # letter alone, the article with its name (operator 2026-10-17); a name said in Latin takes
        # its capital back from where the letter stands
        sp = B.Speech(LEX)
        marked = sp.mark("Alif lam dan alif.")
        self.assertEqual(sp.spoken(marked), "Alif lam dan alif.")
        self.assertEqual(sp.shown(marked, None), "Alif lam (ال) dan ا.")
        self.assertEqual(LEX.speech_of_display("Alif lam (ال) dan ا."), "Alif lam dan alif.")
        self.assertEqual(LEX.speech_of_display("Kata pertama. ا di awalnya dibaca."), "Kata pertama. Alif di awalnya dibaca.")

    def test_retext_keeps_timing(self):
        line = {"text": "Akhirnya dibaca كَسْرَة.", "focus": None}
        old = [{"t": "a", "s": 0.0, "e": 0.4}, {"t": "b", "s": 0.5, "e": 0.9}, {"t": "c", "s": 1.0, "e": 1.5}]
        new = B.retext_tokens(old, line, LEX, None)
        self.assertEqual([(t["t"], t["s"]) for t in new], [("Akhirnya", 0.0), ("dibaca", 0.5), ("kasrah (كَسْرَة).", 1.0)])

    def test_a_shown_only_piece_beside_arabic_is_its_own_token(self):
        # One karaoke word holds at most one Arabic unit, at its end (rule 15; the TS textUnits test):
        # the shown-only ", yaitu صِرَٰط (ṣirāṭ)," after "isim (اِسْم)" is a token of its own, with
        # the timing of the word it is shown with (2026-10-17: rendered as ONE token, the line could
        # break inside it). Beside a plain word it still joins that word ("Kata pertama, yaitu …").
        ln = MANIFESTS["al-fatihah"]["lines"][SHOWN_ISIM]
        named, cuts = V.named_in_display(ln["display"]), LEX.text_cuts(ln["display"])
        entries = LEX.token_entries(ln["text"], None, named, cuts)
        texts = [t for t, _i in entries]
        k = texts.index("isim (اِسْم),")
        self.assertEqual(texts[k + 1], "yaitu صِرَٰط (ṣirāṭ),")
        self.assertEqual(entries[k][1], entries[k + 1][1])  # one spoken word, two karaoke words
        toks = LEX.tokens(ln["text"], [i * 0.05 for i in range(len(ln["text"]))], [i * 0.05 + 0.04 for i in range(len(ln["text"]))],
                          None, named, cuts)
        self.assertEqual((toks[k]["s"], toks[k]["e"]), (toks[k + 1]["s"], toks[k + 1]["e"]))
        self.assertEqual(" ".join(t["t"] for t in toks), LEX.render_display(ln["text"], None, named, cuts))
        # A kept render's tokens of the old shape (one token per spoken word) take the new shape with
        # their timings unchanged, and the new shape stays as it is.
        old = [dict(t) for t in ln["tokens"]]
        merged = old[:k] + [{**old[k], "t": old[k]["t"] + " " + old[k + 1]["t"]}] + old[k + 2:]
        timing = lambda ts: [(x["s"], x["e"]) for x in ts]  # noqa: E731
        again = B.retext_tokens(merged, ln, LEX, None)
        self.assertEqual(timing(again), timing(old))
        self.assertEqual(again, B.retext_tokens(old, ln, LEX, None))
        self.assertEqual([x["t"] for x in again], [t for t, _i in entries])
        # Beside a plain word, as before: the piece joins it.
        plain = MANIFESTS["al-fatihah"]["lines"][SHOWN_ONLY]
        p_entries = LEX.token_entries(plain["text"], None, V.named_in_display(plain["display"]), LEX.text_cuts(plain["display"]))
        self.assertIn("pertama, yaitu صِرَٰطَ (ṣirāṭa),", [t for t, _i in p_entries])
        # Every rendered token of every manifest: at most one Arabic run, and nothing but its
        # transliteration and punctuation after it.
        ar = "؀-ۿ"
        for man in MANIFESTS.values():
            for lid, l in man["lines"].items():
                for tk in l.get("tokens") or []:
                    runs = re.findall(rf"[{ar}]+(?:\s+[{ar}]+)*", tk["t"])
                    self.assertLessEqual(len(runs), 1, f"{lid}: {tk['t']!r}")
                    if runs:
                        tail = tk["t"][tk["t"].rindex(runs[-1]) + len(runs[-1]):]
                        self.assertRegex(tail, r"^\)?(?: \([^()]*\))?[)”»,.;:!?]*$", f"{lid}: {tk['t']!r}")


class WordPlaces(unittest.TestCase):
    def test_named_once(self):
        # The why of a word's own line names the word once: the line has just named it (operator
        # 2026-10-17, "Sibling lines"); a quiz explanation, which says the why alone, keeps the name.
        why = "Kata ini, yaitu {{114:4:1}}, yang artinya “dari”, adalah huruf jar yang mabni."
        self.assertEqual(B.named_once(why, "114:4:1"), "Kata ini adalah huruf jar yang mabni.")
        self.assertEqual(B.named_once(why, "114:5:3"), why)  # another word: left as it is
        self.assertEqual(B.named_once("Kata ini, yaitu {{!1:6:2}}, yang artinya “jalan”, adalah isim.", "1:6:2"),
                         "Kata ini adalah isim.")
        self.assertEqual(B.named_once("Akhirnya kasrah, karena kata ini, yaitu {{114:4:1}}, yang artinya “dari”, …", "114:4:1"),
                         "Akhirnya kasrah, karena kata ini, yaitu {{114:4:1}}, yang artinya “dari”, …")  # not the why's opening
        w = MANIFESTS["an-nas"]["lines"]["an-nas:4:w1"]["display"]
        self.assertEqual(V.named_twice(w), [])
        self.assertTrue(w.startswith("Kata pertama, yaitu مِن (min), artinya: “dari”. Kata ini adalah huruf jar"))
        why = MANIFESTS["an-nas"]["lines"]["an-nas:4:ex:label-role:1:why"]["display"]
        self.assertIn("Kata ini, yaitu مِن (min), yang artinya “dari”, adalah", why)

    def test_part_meaning_only(self):
        f = V.part_meaning_only
        self.assertEqual(f("Bagian kedua adalah isim (اِسْم) yang artinya “Maha Pengasih”."), ["Bagian kedua adalah isim (اِسْم)"])
        self.assertEqual(f("Bagian kedua adalah isim (اِسْم), yaitu رَحْمَٰن (raḥmān), yang artinya “Maha Pengasih”."), [])
        self.assertEqual(f("Huruf jar (حَرْف جَرّ), yaitu عَلَى (‘alā), yang artinya “atas”, bersambung dengan dhamir (ضَمِير) "
                           "yang artinya “mereka”."), ["bersambung dengan dhamir (ضَمِير)"])
        # the line's own word ("kata ini", named on the line before) and a phrase are no part
        self.assertEqual(f("Kata ini adalah kata penghubung yang artinya “orang-orang yang”; maknanya baru lengkap."), [])
        self.assertEqual(f("misalnya بِٱسْمِ (bismi) di awal Surah Al-'Alaq, dalam ungkapan yang artinya “dengan nama Tuhanmu”."), [])
        # every composition line of Al-Fatihah, as built: none
        bad = {lid: f(ln["display"]) for lid, ln in MANIFESTS["al-fatihah"]["lines"].items() if ":compose:" in lid and f(ln["display"])}
        self.assertEqual(bad, {})

    def test_word_places(self):
        self.assertEqual(V.word_places("Kata pertama artinya “x”; kata ketiga dan keempat, lalu kata kedua sampai keempat."),
                         [1, 3, 4, 2])
        self.assertEqual(V.word_places("Kata kedua di ayat dua; kata ini; sifat keempat."), [])
        self.assertEqual(V.word_places("kata kedua belas"), [12])

    def test_line_view(self):
        a = LESSONS["al-fatihah"]["ayat"][0]
        cp = COMPOSE["al-fatihah"]
        self.assertEqual(V.line_view(a, "w1:compose:3", cp), ([1], "1:1:1"))
        self.assertEqual(V.line_frame(a, "w1:compose:3", cp), cp["words"]["1:1:1"]["lines"][2]["frame"])
        self.assertIsNone(V.line_frame(a, "w1", cp))
        # A primer that opens its own ayah's lesson marks the words whose letters its frame shows
        # as they are (بِ of word 1) — what Al-Fatihah's did until 2026-10-13 …
        own = {**cp, "primer": {k: v for k, v in cp["primer"].items() if k != "lesson"}}
        self.assertEqual(V.line_view(a, "primer:6", own), ([1], None))  # بِ over the kasrah's mark frame
        self.assertEqual(V.line_view(a, "primer:4", own), ([], None))  # بَ: an edit, not the ayah's letter
        self.assertEqual(V.line_view(a, "primer:5", own), ([], None))  # ب, the bare letter: an edit too
        # … and one that lesson zero plays marks nothing: there is no ayah on that stage.
        zero = V.lesson_zero(LESSONS["al-fatihah"], cp)
        self.assertEqual((zero["ayah"], zero["words"]), (0, []))
        self.assertEqual(V.line_view(zero, "primer:4", cp), ([], None))
        self.assertEqual(V.line_frame(zero, "primer:4", cp), cp["primer"]["lines"][3]["frame"])
        self.assertIsNone(V.primer_of(cp, 1))
        self.assertIs(V.primer_of(cp, 0), cp["primer"])
        self.assertIs(V.primer_of(own, 1), own["primer"])
        self.assertIsNone(V.lesson_zero(LESSONS["al-fatihah"], own))
        self.assertEqual(V.line_view(zero, "intro", cp), ([], None))
        # A letter term takes the frame's shape: the bare lam of ٱلرَّحْمَٰن (join frame).
        src = V.line_letters(a, "w3:compose:3", "1:1:3", FORMS, cp)
        self.assertEqual(LEX.shown_letter(LEX.by_term["لَام"], src), "ل")
        self.assertEqual(V.line_view(a, "intro"), ([0], None))
        self.assertEqual(V.line_view(a, "w3"), ([3], "1:1:3"))
        # A concept: the words tagged with it and the words of its structure groups (bismi +
        # Allāhi is the idhafah although only Allāhi is tagged; Allāhi is what the two na't follow).
        self.assertEqual(V.line_view(a, "concept:naat"), ([2, 3, 4], None))
        self.assertEqual(V.line_view(a, "concept:idhafah"), ([1, 2], None))
        self.assertEqual(V.line_view(a, "concept:huruf-jar"), ([1], None))
        # With the curriculum: a step's line lights the words the step occurs on — every majrur
        # word for the step majrur (a part of the i'rab record, which tags one word of this ayah).
        self.assertEqual(V.line_view(a, "concept:majrur", cp, CURRICULUM), ([1, 2, 3, 4], None))
        self.assertEqual(V.line_view(a, "concept:huruf-jar", cp, CURRICULUM), ([1], None))
        self.assertEqual(V.line_view(a, "next"), ([], None))
        self.assertEqual(V.line_view(None, "start"), ([], None))


NEEDS_FFMPEG = unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"),
                                   "needs ffmpeg and ffprobe (not on the CI runner)")
RENDER_VOICE = {"id": "v1", "name": "Suara Uji", "model": "eleven_v3"}
# A stand-in for another ffmpeg or LAME build: LAME quality 3 in place of 2, so the same master
# gives other bytes of the same length and format.
OTHER_BUILD = tuple("3" if i and E.ENCODE[i - 1] == "-compression_level" else x for i, x in enumerate(E.ENCODE))


def tone(path: Path, hz: int, seconds: float) -> bool:
    """A generated 128 kbps mono tone at `path`, standing in for a master (False: this ffmpeg cannot)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    made = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", f"sine=frequency={hz}:duration={seconds}",
                           "-c:a", "libmp3lame", "-b:a", "128k", "-ac", "1", "-ar", "44100", str(path)],
                          capture_output=True, check=False)
    return made.returncode == 0


def alignment(text: str, seconds: float) -> dict:
    """A made-up alignment as ElevenLabs returns one: the characters of `text` spread evenly over `seconds`."""
    step = seconds / len(text)
    return {"characters": list(text), "character_start_times_seconds": [round(i * step, 3) for i in range(len(text))],
            "character_end_times_seconds": [round((i + 1) * step, 3) for i in range(len(text))]}


def take(master: Path, hz: int, seconds: float, text: str) -> bool:
    """One take of `text` on disk: the master (a tone) and, beside it, its alignment .json."""
    if not tone(master, hz, seconds):
        return False
    master.with_suffix(".json").write_text(json.dumps(alignment(text, seconds - 0.1)), encoding="utf-8")
    return True


def aligned_timings(text: str, seconds: float) -> list:
    """The token timings render_narration derives from take(…, seconds, text)'s alignment."""
    al = alignment(text, seconds - 0.1)
    return E.timings(LEX.tokens(text, al["character_start_times_seconds"], al["character_end_times_seconds"]))


def unrendered(name: str) -> dict:
    """A copy of the manifests in which `name` has no voice, no audio and no tokens yet."""
    manifests = copy.deepcopy(MANIFESTS)
    manifests[name]["voice"] = None
    for ln in manifests[name]["lines"].values():
        ln.pop("audio", None)
        ln.pop("tokens", None)
    return manifests


@contextlib.contextmanager
def rendering(root: Path, synthesize):
    """render_narration.render with the voice API replaced by `synthesize` (nothing is ever sent)
    and the manifests written under `root`; yields what the run prints."""
    with mock.patch.object(R, "synthesize", synthesize), mock.patch.object(R, "read_api_key", return_value="test"), \
            mock.patch.object(V, "NARRATION_DIR", root), contextlib.redirect_stdout(io.StringIO()) as said:
        yield said


def render_args(root: Path) -> argparse.Namespace:
    return argparse.Namespace(voice_id=RENDER_VOICE["id"], voice_name=RENDER_VOICE["name"], out=str(root / "out"),
                              env_file=str(root / "none.env"), switch_voice=False)


def encode_main(narration: Path, *argv: str) -> tuple[int, str]:
    """encode_narration.main() on the manifests in `narration`, in this process (so that a test can
    stand in for another encoder build): its exit status and what it printed."""
    with mock.patch.object(V, "NARRATION_DIR", narration), mock.patch.object(sys, "argv", ["encode_narration.py", *argv]), \
            contextlib.redirect_stdout(io.StringIO()) as said:
        try:
            status = E.main()
        except SystemExit as e:
            status = e.code
    return status, said.getvalue()


NEVER_SENT = "a test must never call the voice API"


class SpeechAndRender(unittest.TestCase):
    def test_numbers(self):
        cases = {1: "satu", 11: "sebelas", 12: "dua belas", 20: "dua puluh", 45: "empat puluh lima",
                 100: "seratus", 112: "seratus dua belas", 339: "tiga ratus tiga puluh sembilan",
                 1000: "seribu", 2699: "dua ribu enam ratus sembilan puluh sembilan"}
        for n, w in cases.items():
            self.assertEqual(B.num_id(n), w)
        self.assertEqual([B.ordinal(n) for n in (1, 2, 4, 9, 12)],
                         ["pertama", "kedua", "keempat", "kesembilan", "kedua belas"])

    def test_tts_text(self):
        t = B.tts_text("Kata kedua artinya “bagi Allah”. Akhirnya kasrah karena kata ini (nama) didahului huruf jar.")
        self.assertEqual(t, "Kata kedua artinya bagi Allah. Akhirnya kasrah karena kata ini, nama, didahului huruf jar.")
        # An ellipsis is an open phrase, not a full stop; an open prefix is read without its hyphen.
        self.assertEqual(B.tts_text("bentuk mubalaghah (“yang banyak …”) dari isim fa'il."),
                         "bentuk mubalaghah, yang banyak, dari isim fa'il.")
        self.assertEqual(B.tts_text("Fi'il majhul (kata kerja pasif: berawalan “di-”). Lalu."),
                         "Fi'il majhul, kata kerja pasif: berawalan di. Lalu.")
        self.assertEqual(B.tts_text("Frasa huruf jar + isim."), "Frasa huruf jar dan isim.")
        self.assertNotRegex(B.tts_text("Isim fa'il (kata pelaku: “yang...”)."), r"[()“”]")

    def test_render_request_uses_house_settings(self):
        body = R.request_body("Benar.")
        self.assertEqual(body["model_id"], "eleven_v3")
        self.assertEqual(body["language_code"], "id")
        self.assertEqual(body["apply_text_normalization"], "off")
        self.assertEqual(body["voice_settings"],
                         {"stability": 0.5, "style": 0.35, "similarity_boost": 0.75, "use_speaker_boost": True})
        self.assertNotIn("previous_text", body)
        self.assertNotIn("next_text", body)
        self.assertIn("/with-timestamps", R.API)

    def test_audio_name_is_content_addressed(self):
        a = V.audio_name("Benar.", "v1")
        self.assertRegex(a, r"^[0-9a-f]{16}$")
        self.assertEqual(a, V.audio_name("Benar.", "v1"))
        self.assertNotEqual(a, V.audio_name("Benar sekali.", "v1"))
        self.assertNotEqual(a, V.audio_name("Benar.", "v2"))

    def test_delivery_name_binds_text_format_and_bytes(self):
        sha = "c" * 64
        d = V.delivery_name("Benar.", "v1", sha)
        self.assertRegex(d, r"^[0-9a-f]{16}$")
        self.assertEqual(d, V.delivery_name("Benar.", "v1", sha))
        # never the master's name: the server may keep both, and only one is in a manifest
        self.assertNotEqual(d, V.audio_name("Benar.", "v1"))
        self.assertNotEqual(d, V.delivery_name("Benar sekali.", "v1", sha))  # another text
        self.assertNotEqual(d, V.delivery_name("Benar.", "v2", sha))  # another voice
        self.assertNotEqual(d, V.delivery_name("Benar.", "v1", "d" * 64))  # other bytes: a retake, another encoder
        self.assertNotEqual(d, V.delivery_name("Benar.", "v1", sha, "mp3_22050_32_mono"))  # another format
        self.assertEqual(V.DELIVERY_FORMAT, "mp3_44100_64_mono")
        self.assertNotEqual(V.DELIVERY_FORMAT, V.OUTPUT_FORMAT)
        voice = {"id": "v1", "name": "Suara Uji", "model": "eleven_v3"}
        audio = {"url": V.delivery_url(voice, "shared", "Benar.", sha), "ms": 800, "sha256": sha}
        self.assertEqual(audio["url"], f"/belajar/media/narration/suara-uji/shared/{d}.mp3")
        self.assertTrue(V.is_delivery(audio, voice, "shared", "Benar."))
        self.assertFalse(V.is_delivery(audio, voice, "shared", "Benar sekali."))
        self.assertFalse(V.is_delivery({**audio, "url": V.master_url(voice, "shared", "Benar.")}, voice, "shared", "Benar."))
        self.assertFalse(V.is_delivery({**audio, "sha256": "d" * 64}, voice, "shared", "Benar."))
        self.assertFalse(V.is_delivery(None, voice, "shared", "Benar."))

    def test_rendered_lines_name_their_delivered_file(self):
        # What is on disk: every rendered line is delivered, none still points at its master.
        n = 0
        for name, man in MANIFESTS.items():
            for lid, ln in man["lines"].items():
                if "audio" in ln:
                    n += 1
                    self.assertTrue(V.is_delivery(ln["audio"], man["voice"], name, ln["text"]), lid)
                    self.assertNotEqual(ln["audio"]["url"], V.master_url(man["voice"], name, ln["text"]), lid)
        self.assertGreater(n, 0)

    def test_delivery_encode_is_fixed(self):
        args = E.encode_args(Path("m.mp3"), Path("d.mp3"))
        joined = " ".join(args)
        for want in ("-c:a libmp3lame", "-b:a 64000", "-ac 1", "-ar 44100", "-map_metadata -1", "-flags +bitexact",
                     "-fflags +bitexact", "-id3v2_version 0", "-write_xing 1", "-threads 1"):
            self.assertIn(want, joined)
        self.assertEqual((args[0], args[-1]), ("ffmpeg", "d.mp3"))
        # the tag says what the flags do
        self.assertEqual(V.DELIVERY_FORMAT, f"mp3_{E.SAMPLE_RATE}_{E.BITRATE // 1000}_mono")
        self.assertEqual(E.CHANNELS, 1)
        ok = {"codec": "mp3", "sample_rate": 44100, "channels": 1, "bit_rate": 64000}
        self.assertEqual(E.format_problems(ok), [])
        self.assertTrue(E.format_problems({**ok, "bit_rate": 128000}))  # a master copied over
        self.assertTrue(E.format_problems({**ok, "channels": 2}))

    def test_delivery_drift_and_token_fit(self):
        toks = [{"t": "Kata", "s": 0.0, "e": 0.4}, {"t": "pertama.", "s": 0.5, "e": 2.95}]
        self.assertEqual(E.fit_problems(toks, 3.0, 3.0), [])
        self.assertEqual(E.fit_problems(toks, 3.0, 3.026), [])  # a frame longer
        self.assertEqual(E.fit_problems(toks, 3.0, 2.974), [])  # a frame shorter, the last token still inside
        self.assertTrue(any("no longer fits" in e for e in E.fit_problems(toks, 3.0, 2.94)))
        self.assertTrue(any("drifted" in e for e in E.fit_problems(toks, 3.0, 3.081)))
        self.assertTrue(any("drifted" in e for e in E.fit_problems(toks, 3.0, 2.919)))
        self.assertEqual(E.MAX_DRIFT_MS, 80)
        # A token that already ran past the end of its master (ElevenLabs' alignment: one rendered
        # line, 131 ms) is not the encode's doing, unless the delivered file ends earlier still.
        late = toks + [{"t": "Lagi.", "s": 3.0, "e": 3.131}]
        self.assertEqual(E.fit_problems(late, 3.0, 3.0), [])
        self.assertEqual(E.past_master_ms(late, 3.0), 131)
        self.assertEqual(E.past_master_ms(toks, 3.0), 0)
        self.assertTrue(any("no longer fits" in e for e in E.fit_problems(late, 3.0, 2.99)))

    def test_one_file_one_take(self):
        # What tells two takes of a text apart is the token timings, never the token texts (those
        # are re-derived by the build when a display form changes).
        toks = [{"t": "Kata", "s": 0.0, "e": 0.4}, {"t": "pertama.", "s": 0.5, "e": 2.95}]
        self.assertEqual(E.timings(toks), [(0.0, 0.4), (0.5, 2.95)])
        self.assertEqual(E.timings([{**toks[0], "t": "kata (كَلِمَة)"}, toks[1]]), E.timings(toks))
        self.assertEqual(E.timings(None), [])
        # encode_narration.settle never writes tokens, so lines that share a text (one master, one
        # delivered file) must carry ONE set of timings: a twin still on an older take is refused,
        # before ffmpeg is asked for anything, instead of getting the new audio under old timings.
        text = "Benar."
        audio = {"url": V.delivery_url(RENDER_VOICE, "shared", text, SHA), "ms": 3000, "sha256": SHA}
        line = {"text": text, "audio": dict(audio), "tokens": toks}
        older = {**line, "tokens": [{**t, "s": round(t["s"] * 1.1, 3), "e": round(t["e"] * 1.1, 3)} for t in toks]}
        nowhere = Path("no-such-out")
        for reencode in (False, True):
            how, d, errs = E.settle([line, older], nowhere / "master.mp3", RENDER_VOICE, "shared", nowhere, reencode=reencode, write=False)
            self.assertEqual((how, d), ("failed", None))
            self.assertIn("token timings differ", errs[0])
            self.assertIn("render_narration.py --render", errs[0])
        # Every line of a group is compared, not only the second: published groups have 3 and 6 lines.
        for group in ([line, line, older], [line, line, line, line, line, older]):
            self.assertEqual(E.settle(group, nowhere / "master.mp3", RENDER_VOICE, "shared", nowhere, write=False)[0], "failed")
        # the same timings under other token texts are one take: nothing to refuse (and nothing here to check)
        retexted = {**line, "tokens": [{**toks[0], "t": "kata"}, toks[1]]}
        self.assertEqual(E.settle([line, retexted], nowhere / "master.mp3", RENDER_VOICE, "shared", nowhere, write=False),
                         ("absent", None, []))

    def test_tokens_are_the_masters_take(self):
        # encode_narration.take_problems (review 2026-10-11): this step never writes tokens, so a
        # master replaced by hand and re-encoded (--reencode) would play under the old take's
        # timings. Every token time is copied (to the ms) from the alignment beside the master: a
        # time that is not there is another take's, and the line is refused before ffmpeg is asked.
        text = "Kata pertama."
        times = lambda k: {"characters": list(text),
                           "character_start_times_seconds": [round(k * i * 0.2, 4) for i in range(len(text))],
                           "character_end_times_seconds": [round(k * (i + 1) * 0.2 - 0.01, 4) for i in range(len(text))]}
        al = times(1.0)
        toks = [{"t": "Kata", "s": round(al["character_start_times_seconds"][0], 3), "e": round(al["character_end_times_seconds"][3], 3)},
                {"t": "pertama.", "s": round(al["character_start_times_seconds"][5], 3), "e": round(al["character_end_times_seconds"][-1], 3)}]
        audio = {"url": V.delivery_url(RENDER_VOICE, "shared", text, SHA), "ms": 3000, "sha256": SHA}
        line = {"text": text, "audio": audio, "tokens": toks}
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            master = root / "master.mp3"
            master.write_bytes(b"not decoded: refused before ffmpeg")
            self.assertIn("no alignment beside the master", E.take_problems([line], master)[0])
            master.with_suffix(".json").write_text(json.dumps(al), encoding="utf-8")
            self.assertEqual(E.take_problems([line, line], master), [])
            # the master and its alignment replaced by a slower take: the lines' timings are not in it
            master.with_suffix(".json").write_text(json.dumps(times(1.1)), encoding="utf-8")
            self.assertIn("not the take at the master", E.take_problems([line], master)[0])
            for reencode in (False, True):
                how, d, errs = E.settle([line], master, RENDER_VOICE, "shared", root, reencode=reencode, write=False)
                self.assertEqual((how, d), ("failed", None))
                self.assertIn("render_narration.py --render", errs[0])

    def test_upload_sends_the_listed_files_only(self):
        # The upload the scripts print (never run): the files of the --list file, read by tar from the
        # delivery directory, unpacked on the VM as the owner of the media directory, existing files
        # kept. Never `scp -r` of a directory, which also holds files no manifest references.
        out = Path("/o/out")
        self.assertEqual(E.upload_command(out),
                         "cd /o/out/delivery && COPYFILE_DISABLE=1 tar --no-mac-metadata -cf - -T /o/out/delivery/files.txt "
                         "| ssh <vm-host> 'sudo -n -u deploy tar -x --skip-old-files -C /srv/dakwah-lens/data/belajar-media/narration'")
        self.assertIn("-T '/tmp/my list.txt' ", E.upload_command(out, Path("/tmp/my list.txt")))
        self.assertEqual(E.list_command(out), "python3 encode_narration.py --check --out /o/out --list /o/out/delivery/files.txt")
        self.assertEqual(E.list_command(E.DEFAULT_OUT.resolve()),
                         f"python3 encode_narration.py --check --list {E.DEFAULT_OUT.resolve() / 'delivery' / 'files.txt'}")
        # the steps a run prints: the list first (unless it has just written it), the upload, the served check
        self.assertEqual(E.upload_steps(out)[:2], [f"  {E.list_command(out)}", f"  {E.upload_command(out)}"])
        self.assertEqual(E.upload_steps(out, Path("/l.txt"))[0], f"  {E.upload_command(out, Path('/l.txt'))}")
        self.assertIn("https://dakwah-lens.id/belajar/media/narration/", E.upload_steps(out)[-1])
        for script in ("encode_narration.py", "render_narration.py"):
            self.assertNotIn("scp ", (Path(E.__file__).resolve().parent / script).read_text(encoding="utf-8"), script)

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "needs ffmpeg and ffprobe (not on the CI runner)")
    def test_render_delivers_what_it_renders(self):
        # render_narration.render on a line whose master is already on disk (a generated tone and a
        # made-up alignment): nothing is sent, the manifest gets the DELIVERED file, and with the
        # master gone a second run skips the line instead of rendering it again.
        lid, name = "shared:correct", "shared"
        text = MANIFESTS[name]["lines"][lid]["text"]
        voice = {"id": "v1", "name": "Suara Uji", "model": "eleven_v3"}
        manifests = copy.deepcopy(MANIFESTS)
        manifests[name]["voice"] = None
        for ln in manifests[name]["lines"].values():
            ln.pop("audio", None)
            ln.pop("tokens", None)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            master = E.master_path(root / "out", voice, name, text)
            master.parent.mkdir(parents=True)
            made = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
                                   "-c:a", "libmp3lame", "-b:a", "128k", "-ac", "1", "-ar", "44100", str(master)],
                                  capture_output=True, check=False)
            if made.returncode:
                self.skipTest(f"this ffmpeg cannot make the test tone: {made.stderr[:200]!r}")
            master.with_suffix(".json").write_text(json.dumps({
                "characters": list(text), "character_start_times_seconds": [i * 0.05 for i in range(len(text))],
                "character_end_times_seconds": [i * 0.05 + 0.04 for i in range(len(text))]}), encoding="utf-8")
            args = argparse.Namespace(voice_id=voice["id"], voice_name=voice["name"], out=str(root / "out"),
                                      env_file=str(root / "none.env"), switch_voice=False)
            sent = mock.Mock(side_effect=AssertionError("a test must never call the voice API"))
            with mock.patch.object(R, "synthesize", sent), mock.patch.object(R, "read_api_key", return_value="test"), \
                    mock.patch.object(V, "NARRATION_DIR", root), contextlib.redirect_stdout(io.StringIO()) as said:
                self.assertEqual(R.render([(name, lid, text)], manifests, LESSONS, args, LIBRARY), 0)
                ln = manifests[name]["lines"][lid]
                first = dict(ln["audio"])
                self.assertTrue(V.is_delivery(first, voice, name, text))
                delivered = E.delivery_path(root / "out", first["url"])
                self.assertEqual(E.sha256_bytes(delivered.read_bytes()), first["sha256"])
                self.assertEqual(E.format_problems(E.probe(delivered)), [])
                self.assertEqual(E.format_problems(E.probe(master))[0], "bit_rate is 128000, not 64000")  # the master is kept as rendered
                self.assertEqual(" ".join(t["t"] for t in ln["tokens"]), LEX.render_display(text))
                self.assertEqual(json.loads((root / f"{name}.json").read_text(encoding="utf-8"))["lines"][lid]["audio"], first)
                self.assertEqual(V.check_audio(lid, first, name, manifests[name]["voice"], text), [])
                # the upload it prints sends the files of the list, from the delivery directory: never
                # the masters, never a whole directory
                self.assertIn(E.list_command((root / "out").resolve()), said.getvalue())
                self.assertIn(E.upload_command((root / "out").resolve()), said.getvalue())
                self.assertNotIn("scp", said.getvalue())
                self.assertIn("reuse  shared:correct", said.getvalue())
                # Run again with the master still on disk: the delivered file the manifest names is
                # kept, not encoded again (another ffmpeg build would write other bytes, a new name).
                with mock.patch.object(E, "_encode_to", side_effect=AssertionError("a published file must not be encoded again")):
                    self.assertEqual(R.render([(name, lid, text)], manifests, LESSONS, args, LIBRARY), 0)
                self.assertEqual(ln["audio"], first)
                self.assertEqual(E.sha256_bytes(delivered.read_bytes()), first["sha256"])
                master.unlink()
                self.assertEqual(R.render([(name, lid, text)], manifests, LESSONS, args, LIBRARY), 0)
                self.assertIn("skip   shared:correct", said.getvalue())
                self.assertEqual(ln["audio"], first)
            sent.assert_not_called()

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "needs ffmpeg and ffprobe (not on the CI runner)")
    def test_delivery_encode_roundtrip(self):
        # One real encode, of a generated 128 kbps mono tone standing in for a master: 64 kbps mono,
        # the same length, the same bytes on a second run, named by its text and its bytes.
        voice = {"id": "v1", "name": "Suara Uji", "model": "eleven_v3"}
        text = "Benar."
        toks = [{"t": "Benar.", "s": 0.1, "e": 1.9}]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            master = E.master_path(root, voice, "shared", text)
            master.parent.mkdir(parents=True)
            made = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
                                   "-c:a", "libmp3lame", "-b:a", "128k", "-ac", "1", "-ar", "44100", str(master)],
                                  capture_output=True, check=False)
            if made.returncode:
                self.skipTest(f"this ffmpeg cannot make the test tone: {made.stderr[:200]!r}")
            d = E.deliver(master, text, voice, "shared", toks, root)
            body = d.path.read_bytes()
            self.assertEqual(d.path, root / "delivery" / "suara-uji" / "shared" / f"{V.delivery_name(text, 'v1', d.audio['sha256'])}.mp3")
            self.assertEqual(d.audio["sha256"], E.sha256_bytes(body))
            self.assertTrue(V.is_delivery(d.audio, voice, "shared", text))
            self.assertEqual(V.check_audio("shared:correct", d.audio, "shared", voice, text), [])
            self.assertEqual(E.format_problems(E.probe(d.path)), [])
            self.assertLessEqual(abs(d.drift_ms), E.MAX_DRIFT_MS)
            self.assertEqual(d.audio["ms"], E.probe(d.path)["ms"])
            self.assertLess(d.size, d.master_size * 0.6)
            self.assertFalse(body.startswith(b"ID3"))
            self.assertIsNone(E.decode_error(d.path))
            self.assertEqual(E.encode(master), body)  # deterministic on this machine
            self.assertNotEqual(d.path.name, master.name)
            # a master ffmpeg cannot read is refused: nothing is delivered in its name
            broken = master.with_name("0000000000000000.mp3")
            broken.write_bytes(b"not an mp3" * 50)
            with self.assertRaises(SystemExit):
                E.deliver(broken, text, voice, "shared", toks, root)

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "needs ffmpeg and ffprobe (not on the CI runner)")
    def test_published_name_stands(self):
        # encode_narration.settle (review 2026-10-11): a delivered file the manifest names, on disk
        # and intact, is KEPT, master on disk or not. Its name carries its bytes, and another ffmpeg
        # build writes other bytes: encoding it again in passing would rename every published file.
        voice = {"id": "v1", "name": "Suara Uji", "model": "eleven_v3"}
        text = "Benar."
        toks = [{"t": "Benar.", "s": 0.1, "e": 1.9}]

        def tone(path: Path, hz: int) -> bool:
            made = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", f"sine=frequency={hz}:duration=2",
                                   "-c:a", "libmp3lame", "-b:a", "128k", "-ac", "1", "-ar", "44100", str(path)],
                                  capture_output=True, check=False)
            return made.returncode == 0

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            master = E.master_path(root, voice, "shared", text)
            master.parent.mkdir(parents=True)
            if not tone(master, 440):
                self.skipTest("this ffmpeg cannot make the test tone")
            # Its alignment, as render_narration.py keeps one beside every master: the take the
            # tokens are from (encode_narration.take_problems), unchanged below where only the bytes are.
            n = len(text)
            master.with_suffix(".json").write_text(json.dumps({
                "characters": list(text),
                "character_start_times_seconds": [round(0.1 + i * 1.8 / n, 3) for i in range(n)],
                "character_end_times_seconds": [round(0.1 + (i + 1) * 1.8 / n, 3) for i in range(n)],
            }), encoding="utf-8")
            d = E.deliver(master, text, voice, "shared", toks, root)
            first_take = master.read_bytes()
            line = {"text": text, "audio": dict(d.audio), "tokens": toks}
            twin = {"text": text, "audio": dict(d.audio), "tokens": toks}  # the same text on another line
            settle = lambda lines=None, **kw: E.settle(lines or [line, twin], master, voice, "shared", root, **kw)
            with mock.patch.object(E, "_encode_to", side_effect=AssertionError("a kept file must not be encoded again")):
                self.assertEqual(settle(), ("kept", None, []))
                self.assertEqual(E.standing(line, voice, "shared", root), d.path)
            # Other bytes from the same master's place (a master replaced by hand here; an upgraded
            # encoder does the same to every file): the published name stands all the same …
            self.assertTrue(tone(master, 880))
            self.assertEqual(settle(), ("kept", None, []))
            # … and only --reencode takes the new bytes, under a new name (nothing written by --check).
            how, again, errs = settle(reencode=True, write=False)
            self.assertEqual((how, errs), ("encoded", []))
            self.assertNotEqual(again.audio["url"], line["audio"]["url"])
            self.assertFalse(again.path.exists())
            self.assertEqual(E.on_disk({d.audio["url"][len(V.MEDIA_PREFIX):], again.audio["url"][len(V.MEDIA_PREFIX):]}, root),
                             ([d.audio["url"][len(V.MEDIA_PREFIX):]], [again.audio["url"][len(V.MEDIA_PREFIX):]]))
            # Lines of one text that do not name ONE file (the twin names other bytes, validly):
            # not kept, delivered again as one.
            elsewhere = {"url": V.delivery_url(voice, "shared", text, "1" * 64), "ms": d.audio["ms"], "sha256": "1" * 64}
            self.assertTrue(V.is_delivery(elsewhere, voice, "shared", text))
            self.assertEqual(settle([line, {**twin, "audio": elsewhere}], write=False)[0], "encoded")
            # A damaged delivered file: made again while its master is here and still gives the
            # published bytes, a failure once it is not. (With the other bytes in the master's place
            # it is refused: test_published_file_is_never_renamed_in_passing.)
            whole = d.path.read_bytes()
            for damaged in (whole[: len(whole) // 2], b"", b"not an mp3" * 50):
                d.path.write_bytes(damaged)
                self.assertIsNone(E.standing(line, voice, "shared", root))
                self.assertEqual(settle(write=False)[0], "failed")
                master.write_bytes(first_take)
                how, again, errs = settle(write=False)
                self.assertEqual((how, errs, again.audio), ("encoded", [], line["audio"]))
                self.assertTrue(tone(master, 880))
            master.unlink()
            how, _d, errs = settle()
            self.assertEqual(how, "failed")
            self.assertTrue(errs)
            # Neither file on this machine (another one rendered the line): nothing to check here.
            d.path.unlink()
            self.assertEqual(settle(), ("absent", None, []))
            self.assertEqual(E.on_disk({d.audio["url"][len(V.MEDIA_PREFIX):]}, root), ([], [d.audio["url"][len(V.MEDIA_PREFIX):]]))
            # … unless the manifest names no delivered file at all: then there is nothing to serve.
            unnamed = {**line, "audio": {**line["audio"], "url": V.master_url(voice, "shared", text)}}
            self.assertEqual(settle([unnamed])[0], "failed")

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "needs ffmpeg and ffprobe (not on the CI runner)")
    def test_delivery_list_wants_every_file(self):
        # encode_narration.py --check on a machine with none of the files (an empty --out): nothing
        # was checked and it says so; with --list (the gate before an upload) that is a failure, and
        # no file that is not here is listed (review 2026-10-11: it used to print OK and list all).
        if not any("audio" in ln for man in MANIFESTS.values() for ln in man["lines"].values()):
            self.skipTest("no line has audio")
        here = Path(E.__file__).resolve().parent
        with tempfile.TemporaryDirectory() as tmp:
            listed = Path(tmp) / "files.txt"
            run = lambda *extra: subprocess.run([sys.executable, str(here / "encode_narration.py"), "--check", "--out", tmp, *extra],
                                                cwd=here, capture_output=True, text=True, check=False)
            plain = run()
            self.assertEqual(plain.returncode, 0, plain.stdout[-400:] + plain.stderr[-400:])
            self.assertIn("NOT checked", plain.stdout)
            self.assertNotIn("re-encoded and compared", plain.stdout)
            gate = run("--list", str(listed))
            self.assertEqual(gate.returncode, 1, gate.stdout[-400:] + gate.stderr[-400:])
            self.assertIn("NOT in the list", gate.stdout)
            self.assertEqual(listed.read_text(encoding="utf-8"), "")
            self.assertEqual(list(Path(tmp).glob("delivery/**/*.mp3")), [])  # --check wrote nothing

    @NEEDS_FFMPEG
    def test_render_takes_audio_and_tokens_from_one_take(self):
        # render_narration.render derives the tokens from the alignment beside the master, every
        # time. The delivered file the manifest already names may be kept only while it is that
        # same take; otherwise the line would play one take under another take's word timings, and
        # no validator could tell (review 2026-10-11).
        lid, name = "shared:correct", "shared"
        text = MANIFESTS[name]["lines"][lid]["text"]
        manifests = unrendered(name)
        ln = manifests[name]["lines"][lid]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            out, args = root / "out", render_args(root)
            master = E.master_path(out, RENDER_VOICE, name, text)
            if not take(master, 440, 3, text):
                self.skipTest("this ffmpeg cannot make the test tone")
            never = mock.Mock(side_effect=AssertionError(NEVER_SENT))
            run = lambda: R.render([(name, lid, text)], manifests, LESSONS, args, LIBRARY)

            def one_take(seconds: float) -> None:
                """The line's audio is the master on disk, delivered, and its tokens are that take's."""
                delivered = E.delivery_path(out, ln["audio"]["url"])
                self.assertEqual(delivered.read_bytes(), E.encode(master))
                self.assertEqual(E.sha256_bytes(delivered.read_bytes()), ln["audio"]["sha256"])
                self.assertEqual(ln["audio"]["ms"], E.probe(delivered)["ms"])
                self.assertEqual(E.timings(ln["tokens"]), aligned_timings(text, seconds))
                self.assertLessEqual(ln["tokens"][-1]["e"], ln["audio"]["ms"] / 1000)
                self.assertEqual(json.loads((root / f"{name}.json").read_text(encoding="utf-8"))["lines"][lid], ln)

            with rendering(root, never):
                self.assertEqual(run(), 0)
                first = dict(ln["audio"])
                one_take(3)
                # A retake put in the master's place by hand, with its alignment: the audio and the
                # tokens move together. (Kept, the line would have the 3 s file under 2 s timings.)
                self.assertTrue(take(master, 880, 2, text))
                self.assertEqual(run(), 0)
                second = dict(ln["audio"])
                self.assertNotEqual(second["url"], first["url"])
                self.assertLess(second["ms"], first["ms"] - 500)
                one_take(2)
                # Again with nothing replaced: now the manifest's file IS the take on disk, and it is kept.
                with mock.patch.object(E, "_encode_to", side_effect=AssertionError("a published file must not be encoded again")):
                    self.assertEqual(run(), 0)
                self.assertEqual(ln["audio"], second)
            never.assert_not_called()
            # A FRESH render (here: the alignment is gone, so the line is sent again) is delivered
            # anew even when its timings are the very ones the manifest has: the audio is another take.
            master.with_suffix(".json").unlink()
            self.assertTrue(tone(root / "retake.mp3", 660, 2))
            fresh = mock.Mock(return_value=((root / "retake.mp3").read_bytes(), alignment(text, 1.9), len(text)))
            with rendering(root, fresh) as said:
                self.assertEqual(run(), 0)
            fresh.assert_called_once()
            self.assertIn(f"render {lid}", said.getvalue())
            self.assertEqual(master.read_bytes(), (root / "retake.mp3").read_bytes())
            self.assertNotEqual(ln["audio"]["url"], second["url"])
            one_take(2)

    @NEEDS_FFMPEG
    def test_render_retake_of_a_shared_text(self):
        # Two lines of one manifest with the same text share one master. When the text is retaken,
        # the line rendered second re-uses the master the first one just paid for: it must take
        # that take's audio with its tokens, not keep the old file under the new timings.
        name = "shared"
        by: dict[str, list[str]] = {}
        for lid, ln in MANIFESTS[name]["lines"].items():
            by.setdefault(ln["text"], []).append(lid)
        twins = next((lids for lids in by.values() if len(lids) > 1), None)
        if not twins:
            self.skipTest("no two shared lines have the same text")
        a, b = twins[:2]
        text = MANIFESTS[name]["lines"][a]["text"]
        manifests = unrendered(name)
        la, lb = manifests[name]["lines"][a], manifests[name]["lines"][b]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            out, args = root / "out", render_args(root)
            master = E.master_path(out, RENDER_VOICE, name, text)
            if not take(master, 440, 3, text):
                self.skipTest("this ffmpeg cannot make the test tone")
            run = lambda *lids: R.render([(name, lid, text) for lid in lids], manifests, LESSONS, args, LIBRARY)
            settle = lambda **kw: E.settle([la, lb], master, RENDER_VOICE, name, out, **kw)

            def retake(hz: int, seconds: float) -> mock.Mock:
                """The operator's retake: the master and its alignment deleted, the audio taken off
                the FIRST line only; the voice API (mocked) then returns another take."""
                self.assertTrue(tone(root / "retake.mp3", hz, seconds))
                master.unlink()
                master.with_suffix(".json").unlink()
                la.pop("audio")
                la.pop("tokens")
                return mock.Mock(return_value=((root / "retake.mp3").read_bytes(), alignment(text, seconds - 0.1), len(text)))

            with rendering(root, mock.Mock(side_effect=AssertionError(NEVER_SENT))):
                self.assertEqual(run(a, b), 0)
            first = dict(la["audio"])
            self.assertEqual(lb["audio"], first)
            self.assertEqual(settle(), ("kept", None, []))
            # Both lines selected: one request, and both get the new take's audio and timings.
            sent = retake(880, 2)
            with rendering(root, sent) as said:
                self.assertEqual(run(a, b), 0)
            sent.assert_called_once()
            self.assertIn(f"render {a}", said.getvalue())
            self.assertIn(f"reuse  {b}", said.getvalue())
            second = dict(la["audio"])
            self.assertNotEqual(second["url"], first["url"])
            self.assertEqual(lb["audio"], second)
            for ln in (la, lb):
                self.assertEqual(E.timings(ln["tokens"]), aligned_timings(text, 2))
                self.assertLessEqual(ln["tokens"][-1]["e"], ln["audio"]["ms"] / 1000)
            self.assertEqual(E.delivery_path(out, second["url"]).read_bytes(), E.encode(master))
            self.assertEqual(settle(), ("kept", None, []))
            # Only the first selected (--only): the second still has the older take, whole (its
            # audio with its own timings). encode_narration.py must not hand it the new file, which
            # would sit under the old timings: it refuses, and names what to run.
            sent = retake(660, 2.5)
            with rendering(root, sent):
                self.assertEqual(run(a), 0)
            third = dict(la["audio"])
            self.assertNotEqual(third["url"], second["url"])
            self.assertEqual((lb["audio"], E.timings(lb["tokens"])), (second, aligned_timings(text, 2)))
            for kw in ({}, {"write": False}, {"reencode": True}):
                how, _d, errs = settle(**kw)
                self.assertEqual(how, "failed", kw)
                self.assertIn("token timings differ", errs[0])
            self.assertEqual(lb["audio"], second)
            # What it names: render on the other line. Nothing is sent (the master is on disk), and
            # the line moves to the new take, audio and tokens together.
            with rendering(root, mock.Mock(side_effect=AssertionError(NEVER_SENT))) as said:
                self.assertEqual(run(b), 0)
            self.assertIn(f"reuse  {b}", said.getvalue())
            self.assertEqual(lb["audio"], third)
            self.assertEqual(E.timings(lb["tokens"]), aligned_timings(text, 2.5))
            self.assertEqual(settle(), ("kept", None, []))

    @NEEDS_FFMPEG
    def test_render_does_not_skip_a_line_that_names_its_master(self):
        # Until 2026-10-11 a rendered line named its 128 kbps master. Such an entry has audio and
        # tokens but no delivered file, so with the master not on this machine the line is rendered
        # (and delivered), not skipped as "the manifest already has this audio".
        lid, name = "shared:correct", "shared"
        text = MANIFESTS[name]["lines"][lid]["text"]
        manifests = unrendered(name)
        manifests[name]["voice"] = dict(RENDER_VOICE)
        ln = manifests[name]["lines"][lid]
        ln["audio"] = {"url": V.master_url(RENDER_VOICE, name, text), "ms": 3000, "sha256": SHA}
        ln["tokens"] = fake_tokens(text)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            if not tone(root / "take.mp3", 440, 3):
                self.skipTest("this ffmpeg cannot make the test tone")
            sent = mock.Mock(return_value=((root / "take.mp3").read_bytes(), alignment(text, 2.9), len(text)))
            with rendering(root, sent) as said:
                self.assertEqual(R.render([(name, lid, text)], manifests, LESSONS, render_args(root), LIBRARY), 0)
            sent.assert_called_once()
            self.assertIn(f"render {lid}", said.getvalue())
            self.assertNotIn("skip   ", said.getvalue())  # render's own "skip   <id>" line, not the upload's --skip-old-files
            self.assertTrue(V.is_delivery(ln["audio"], RENDER_VOICE, name, text))
            self.assertTrue(E.delivery_path(root / "out", ln["audio"]["url"]).is_file())
            self.assertEqual(E.timings(ln["tokens"]), aligned_timings(text, 3))

    @NEEDS_FFMPEG
    def test_published_file_is_never_renamed_in_passing(self):
        # A delivered file the manifest names, lost or damaged on this machine, is made again from
        # its master only as the published bytes. Another ffmpeg or LAME build writes other bytes,
        # which would be a new name: the manifest rewritten, exit 0, and a file CI cannot see was
        # never uploaded. So that is a failure that says to fetch the file back from the server;
        # only --reencode takes the new bytes (review 2026-10-11).
        lid, name = "shared:correct", "shared"
        text = MANIFESTS[name]["lines"][lid]["text"]
        manifests = unrendered(name)
        ln = manifests[name]["lines"][lid]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            out, args = root / "out", render_args(root)
            master = E.master_path(out, RENDER_VOICE, name, text)
            if not take(master, 440, 3, text):
                self.skipTest("this ffmpeg cannot make the test tone")
            never = mock.Mock(side_effect=AssertionError(NEVER_SENT))
            run = lambda: R.render([(name, lid, text)], manifests, LESSONS, args, LIBRARY)
            with rendering(root, never):
                self.assertEqual(run(), 0)
            published = dict(ln["audio"])
            delivered = E.delivery_path(out, published["url"])
            whole = delivered.read_bytes()
            written = (root / f"{name}.json").read_bytes()
            with mock.patch.object(E, "ENCODE", OTHER_BUILD):
                self.assertNotEqual(E.encode(master), whole)  # the stand-in does write other bytes
            settle = lambda **kw: E.settle([ln], master, RENDER_VOICE, name, out, **kw)
            for what, hurt in (("lost", delivered.unlink), ("damaged", lambda: delivered.write_bytes(whole[: len(whole) // 2]))):
                with mock.patch.object(E, "ENCODE", OTHER_BUILD):
                    # everything on disk: kept, whatever this build would write
                    self.assertEqual(settle(), ("kept", None, []), what)
                    hurt()
                    was = delivered.read_bytes() if delivered.exists() else None
                    for kw in ({}, {"write": False}):
                        how, _d, errs = settle(**kw)
                        self.assertEqual(how, "failed", what)
                        self.assertIn("this ffmpeg writes other bytes", errs[0])
                        self.assertIn(f"fetch the file back from the server ({E.SITE}{published['url']})", errs[0])
                    # the same rule for a render that re-uses the master (not rendered fresh)
                    with rendering(root, never), self.assertRaises(SystemExit) as stopped:
                        run()
                    self.assertIn("this ffmpeg writes other bytes", str(stopped.exception))
                    # nothing was renamed, nothing written: the manifest, the directory, the damaged file
                    self.assertEqual(ln["audio"], published)
                    self.assertEqual((root / f"{name}.json").read_bytes(), written)
                    self.assertEqual((delivered.read_bytes() if delivered.exists() else None), was)
                    self.assertEqual([p for p in delivered.parent.glob("*.mp3") if p != delivered], [])
                    # --reencode is the deliberate way: the new bytes, under a new name (not written by --check)
                    how, again, errs = settle(reencode=True, write=False)
                    self.assertEqual((how, errs), ("encoded", []))
                    self.assertNotEqual(again.audio["url"], published["url"])
                # The build that published it gives the published bytes: restored without a word.
                how, again, errs = settle()
                self.assertEqual((how, errs, again.audio), ("encoded", [], published), what)
                self.assertEqual(delivered.read_bytes(), whole)
                hurt()
                with rendering(root, never):
                    self.assertEqual(run(), 0)
                self.assertEqual(ln["audio"], published)
                self.assertEqual(delivered.read_bytes(), whole)
            never.assert_not_called()

    @NEEDS_FFMPEG
    def test_encode_check_and_list_see_a_damaged_file(self):
        # encode_narration.py itself, on a scratch output directory and a scratch copy of one
        # manifest: --check must exit 1 on a delivered file that is damaged (it says "out of
        # date"), --list must never name such a file for the upload, and a list from an earlier
        # run must not outlive a run that fails.
        lid, name = "shared:correct", "shared"
        text = MANIFESTS[name]["lines"][lid]["text"]
        manifests = unrendered(name)
        ln = manifests[name]["lines"][lid]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            out, narration = root / "out", root / "narration"
            narration.mkdir()
            master = E.master_path(out, RENDER_VOICE, name, text)
            if not take(master, 440, 3, text):
                self.skipTest("this ffmpeg cannot make the test tone")
            with rendering(narration, mock.Mock(side_effect=AssertionError(NEVER_SENT))):
                self.assertEqual(R.render([(name, lid, text)], manifests, LESSONS, render_args(root), LIBRARY), 0)
            delivered = E.delivery_path(out, ln["audio"]["url"])
            rel = ln["audio"]["url"][len(V.MEDIA_PREFIX):]
            whole, written = delivered.read_bytes(), (narration / f"{name}.json").read_bytes()
            listed = root / "files.txt"
            main = lambda *argv: encode_main(narration, "--out", str(out), *argv)
            # everything as described: OK, and the list names the one file
            status, said = main("--check", "--list", str(listed))
            self.assertEqual(status, 0, said)
            self.assertIn("OK: 1 delivered files are on disk as the manifests describe them", said)
            self.assertEqual(listed.read_text(encoding="utf-8"), f"{rel}\n")
            self.assertIn(E.upload_command(out.resolve(), listed.resolve()), said)
            # the delivered file cut in half, its master here: --check says so with its exit status,
            # writes nothing, and the damaged file is not in the list
            delivered.write_bytes(whole[: len(whole) // 2])
            status, said = main("--check")
            self.assertEqual(status, 1, said)
            self.assertIn("out of date: 1 delivered files not on disk as encoded", said)
            self.assertNotIn("OK:", said)
            self.assertEqual(delivered.read_bytes(), whole[: len(whole) // 2])
            status, said = main("--check", "--list", str(listed))
            self.assertEqual(status, 1, said)
            self.assertEqual(listed.read_text(encoding="utf-8"), "")
            self.assertIn("NOT in the list", said)
            self.assertIn(f"  - {rel}", said)
            self.assertNotIn("tar ", said)  # no upload is offered from a list that is short
            # the same file absent: the same
            delivered.unlink()
            status, said = main("--check", "--list", str(listed))
            self.assertEqual((status, listed.read_text(encoding="utf-8")), (1, ""), said)
            # another encoder build cannot make the published bytes: a failure, and the list of an
            # earlier run is gone, not left to look current
            listed.write_text(f"{rel}\n", encoding="utf-8")
            with mock.patch.object(E, "ENCODE", OTHER_BUILD):
                status, said = main("--list", str(listed))
            self.assertEqual(status, 1, said)
            self.assertIn("this ffmpeg writes other bytes", said)
            self.assertFalse(listed.exists())
            self.assertFalse(delivered.exists())
            self.assertEqual((narration / f"{name}.json").read_bytes(), written)
            # the plain run on the publishing build restores the published bytes and lists the file
            status, said = main("--list", str(listed))
            self.assertEqual(status, 0, said)
            self.assertEqual(delivered.read_bytes(), whole)
            self.assertEqual(listed.read_text(encoding="utf-8"), f"{rel}\n")
            self.assertEqual((narration / f"{name}.json").read_bytes(), written)
            self.assertIn("the manifests already describe these files", said)
            # damaged with its master gone: a failed run, and again no list is left behind
            delivered.write_bytes(whole[: len(whole) // 2])
            master.unlink()
            status, said = main("--list", str(listed))
            self.assertEqual(status, 1, said)
            self.assertIn("FAIL: ", said)
            self.assertFalse(listed.exists())

    def test_sanitiser_names_places(self):
        san = B.Sanitiser(LESSONS)
        # a word of the ayah, the line's own word, a word of another ayah, a run of words
        self.assertEqual(san.prose("Mudhaf ilaih bagi māliki.", 1, 4, 2), "Mudhaf ilaih bagi kata pertama.")
        self.assertEqual(san.prose("Min adalah huruf jar.", 113, 2, 1), "Kata ini adalah huruf jar.")
        # a word of ANOTHER ayah (only this ayah's words are numbered on screen): until 2026-10-17
        # by its meaning alone; since, a named word with its meaning (operator: "should also
        # mention the arabic word not only artinya"), shown and said by Speech — and an EARLIER ayah
        # by its ordinal, the word this ayah depends on (operator 2026-10-18, refining rule 29 of
        # 2026-10-17, when it was left out: "… mention which word"; validate_narration holds the
        # citation to the `continues` data); a later one as before
        self.assertEqual(san.prose("Badal dari aṣ-ṣirāṭa di ayat 6.", 1, 7, 1),
                         "Badal dari kata {{!1:6:2}} yang artinya “jalan” di ayat keenam.")
        self.assertEqual(san.prose("Seperti aṣ-ṣirāṭa di ayat 6.", 1, 2), "Seperti kata {{!1:6:2}} yang artinya “jalan” di ayat enam.")
        self.assertEqual(san.prose("Sifat bagi lafaz Allah di ayat 2.", 1, 3), "Sifat bagi lafaz “Allah” di ayat kedua.")
        self.assertEqual(san.prose("Bergantung pada a‘ūżu (“aku berlindung”).", 113, 3),
                         "Bergantung pada kata {{113:1:2}} yang artinya “aku berlindung” di ayat pertama.")
        # … a comma closes the citation before the clause goes on, and a phrase of an earlier ayah is
        # named by its words
        self.assertEqual(san.prose("Badal dari rabbi di ayat 1 yang majrur.", 114, 2, 1),
                         "Badal dari kata {{114:1:3}} yang artinya “kepada Tuhan” di ayat pertama, yang majrur.")
        self.assertEqual(san.prose("Wa menyambungkan kalimat ini dengan lam yalid.", 112, 4, 1),
                         "Wawu menyambungkan kalimat ini dengan frasa {{112:3:1}} {{112:3:2}} yang artinya “tidak beranak” di ayat ketiga.")
        self.assertEqual(san.prose("Seperti khalaqa.", 1, 7), "Seperti kata {{!113:2:4}} yang artinya “Dia ciptakan”.")
        # … and what a listener hears and reads: the word's sound and its bytes where the markup was
        sp = B.Speech(LEX, V.Named(LESSONS, COMPOSE))
        marked = sp.mark("Seperti kata {{!1:6:2}} yang artinya “jalan”.")
        w = next(x for a in LESSONS["al-fatihah"]["ayat"] for x in a["words"] if x["loc"] == "1:6:2")
        self.assertEqual(sp.shown(marked, None), f"Seperti kata {w['ar']} ({w['translit']}) yang artinya “jalan”.")
        # aṣ-ṣirāṭa has heavy letters: shown, never said (operator 2026-10-17)
        self.assertEqual(sp.spoken(marked), "Seperti kata yang artinya jalan.")
        # the front of ‘alaihim (never spoken, not even in Arabic), and a title that is only the particle
        self.assertEqual(san.prose("‘Alā adalah huruf jar.", 1, 7, 4),
                         "Bagian depan kata ini adalah huruf jar yang artinya “atas”.")
        # (the step's name first since 2026-10-19, when Al-Ikhlas's map was switched on: a "Konsep
        # baru" caption opens with its step's name, "Huruf nafi yang menjazmkan")
        self.assertEqual(san.prose("Lam: menafikan dan menjazmkan fi'il mudhari'", 112, 3),
                         "Huruf nafi yang menjazmkan: menafikan dan menjazmkan fi'il mudhari'")
        self.assertEqual(san.prose("Kalimat huwa Allāhu aḥadun.", 112, 1), "Kalimat kata kedua sampai keempat.")
        self.assertEqual(san.prose("Disambung dengan wa.", 1, 5), "Disambung dengan wawu.")
        # meanings with "yang artinya"; the letter of a preposition after "huruf jar"
        self.assertEqual(san.prose("Akhirnya kasrah karena kata ism (nama) didahului huruf jar bi- (dengan).", 1, 1, 1),
                         "Akhirnya dibaca kasrah, karena kata ini didahului huruf jar, yaitu huruf ba', yang artinya “dengan”.")
        self.assertEqual(san.prose("Huruf jar seperti li- (“bagi”).", 1, 1), "Huruf jar seperti huruf lam yang artinya “bagi”.")
        # a grammar term's meaning in brackets or bare quotes; an example stays an example
        self.assertEqual(san.prose("Jamak dari naffāṡah, bentuk mubalaghah (“yang banyak meniup”) dari isim fa'il.", 1, 1),
                         "Jamak dari naffasah, bentuk mubalaghah, yang artinya “yang banyak meniup”, dari isim fa'il.")
        self.assertEqual(san.prose("Kata ini adalah huruf jar (kata depan) “dari”; lalu.", 1, 1),
                         "Kata ini adalah huruf jar (kata depan) yang artinya “dari”; lalu.")
        self.assertEqual(san.prose("Zharaf (keterangan waktu “apabila”).", 1, 1),
                         "Zharaf (keterangan waktu yang artinya “apabila”).")
        self.assertEqual(san.prose("Bentuk majhul (pasif: “diperanakkan”) ini majzum.", 1, 1),
                         "Bentuk majhul (pasif), yang artinya “diperanakkan”, ini majzum.")
        self.assertEqual(san.prose("Bergantung pada khabar yang tidak disebut (misalnya 'tetap').", 1, 2),
                         "Bergantung pada khabar yang tidak disebut (misalnya “tetap”).")
        # the Huruf jar concept never names its third example (‘alā, a Qur'anic word) by the term itself
        hj = san.prose(next(c for c in LIBRARY["concepts"] if c["id"] == "huruf-jar")["summary"], 1, 1)
        self.assertNotIn("huruf jar yang artinya “atas”", hj)
        # (until 2026-10-17 "huruf ba' yang artinya “dengan”, dan huruf lam …": the particles are
        # named words now, said "bi" and "li", PRE_REWRITES)
        self.assertIn("{{1:1:1/bi}} yang artinya “dengan”, dan {{1:2:2/li}} yang artinya “bagi”", hj)

    # --- the Pengantar review of 2026-10-17 ---------------------------------------------------
    def test_a_place_with_its_meaning_names_the_word(self):
        # Rule 26, every one (operator 2026-10-17: "'Kata ketiga, yaitu رَبِّ (rabbi), yang artinya
        # “Tuhan”' … even when the stage highlights that word"): the sanitiser adds the word to a
        # place said with its meaning — a run each of its words, "kata ini" the line's own word —
        # and leaves what it cannot resolve to the validator.
        san = B.Sanitiser(LESSONS)
        self.assertEqual(san.prose("Kata ketiga, yang artinya “Tuhan”, disandarkan kepada kata keempat.", 1, 2),
                         "Kata ketiga, yaitu {{1:2:3}}, yang artinya “Tuhan”, disandarkan kepada kata keempat.")
        self.assertEqual(san.prose("Kata ketiga dan keempat, yang artinya “Tuhan seluruh alam”, adalah satu frasa.", 1, 2),
                         "Kata ketiga dan keempat, yaitu {{1:2:3}} {{1:2:4}}, yang artinya “Tuhan seluruh alam”, adalah satu frasa.")
        self.assertIn("Kata kedua sampai keempat, yaitu {{113:1:2}} {{113:1:3}} {{!113:1:4}}, yang artinya",
                      san.prose("Kata kedua sampai keempat, yang artinya “aku berlindung kepada Tuhan”, adalah isinya.", 113, 1))
        self.assertEqual(san.prose("Kata ini, yang artinya “dari”, adalah huruf jar.", 114, 4, 1),
                         "Kata ini, yaitu {{114:4:1}}, yang artinya “dari”, adalah huruf jar.")
        # no line's own word, or past the ayah's last word: left as it is (the validator refuses it)
        self.assertEqual(san.prose("Kata ini, yang artinya “dari”, adalah huruf jar.", 114, 4),
                         "Kata ini, yang artinya “dari”, adalah huruf jar.")
        self.assertEqual(san.prose("Kata kelima, yang artinya “x”, tidak ada.", 1, 1), "Kata kelima, yang artinya “x”, tidak ada.")
        # "kata perintah, yaitu kata pertama" already has its "yaitu": the word is an apposition
        self.assertEqual(san.prose("Ayat dibuka dengan kata perintah qul (“katakanlah”).", 112, 1),
                         "Ayat dibuka dengan kata perintah, yaitu kata pertama, {{!112:1:1}}, yang artinya “katakanlah”.")
        # what the validator reads in a caption (PLACE_MEANING): a place and a meaning with nothing between
        for bad in ("Kata ketiga, yang artinya “Tuhan”", "Kata pertama artinya: “segala puji”", "kata ketiga dan keempat, yang artinya",
                    "kata kedua sampai keempat, yang artinya", "Kata ini, yang artinya “jalan”", "kata itu, yang artinya",
                    "yang pertama artinya “dan”", "Itu kata pertama, yang artinya “dengan nama”"):
            self.assertTrue(V.PLACE_MEANING.search(bad), bad)
        for good in ("Kata ketiga, yaitu رَبِّ (rabbi), yang artinya “Tuhan”", "kata pertama, قُلْ (qul), yang artinya",
                     "Kata pertama, yaitu بِسْمِ (bismi), artinya: “dengan nama”", "yang pertama, وَ (wa), artinya “dan”",
                     "frasa yang artinya “dari kejahatan”", "Kata ketiga disandarkan kepada kata keempat."):
            self.assertIsNone(V.PLACE_MEANING.search(good), good)
        # … and every word line, every quiz "Itu kata …" and every Konsep example names its word now
        lines = MANIFESTS["al-fatihah"]["lines"]
        self.assertTrue(lines["al-fatihah:1:w1"]["display"].startswith("Kata pertama, yaitu "))
        self.assertIn("yaitu bismi, artinya", lines["al-fatihah:1:w1"]["text"])
        self.assertIn(", yaitu ", lines["al-fatihah:1:ex:tap-word:1:why"]["display"])
        for man in MANIFESTS.values():
            for lid, ln in man["lines"].items():
                self.assertIsNone(V.PLACE_MEANING.search(ln["display"]), lid)

    def test_back_references(self):
        # Rule 8 (operator 2026-10-17, "BACK-REFERENCES: YES — remove them all"; refined 2026-10-18: "we
        # need to remind some ayat is continuing previous ayat … mention which word"): a line of ayah A
        # does not COMPARE with an earlier ayah of its surah; it names one only for a dependency, as
        # "Ayat ini melanjutkan ayat <N>" or as a citation after a named word in a line that says the
        # dependency. A later ayah, the same one, another surah's citation, lesson zero and the lesson
        # map's own recap are no back-references.
        br = V.back_references
        self.assertEqual(br("al-fatihah:3:w1:compose:4", "Sifat, seperti di ayat pertama."), ["ayat pertama"])
        self.assertEqual(br("al-ikhlas:2:structure:b", "Ia menegaskan isi ayat sebelumnya."), ["ayat sebelumnya"])
        self.assertEqual(br("an-nas:5:w1", "bagi kata itu di ayat empat"), ["ayat empat"])
        self.assertEqual(br("al-fatihah:2:w1", "baru akan diajarkan lebih lengkap di ayat keenam"), [])
        self.assertEqual(br("al-fatihah:3:w1", "Di ayat ketiga ini"), [])
        self.assertEqual(br("al-ikhlas:3:structure:a", "seperti dalam Surah Al-Fatihah ayat dua"), [])
        self.assertEqual(br("al-fatihah:3:map:total", "Sampai ayat ini, sudah … di ayat pertama"), [])
        self.assertEqual(br("al-fatihah:0:primer:1", "ayat pertama"), [])
        # the two forms of a dependency
        allahi = ALLAHI
        self.assertEqual(br("al-fatihah:3:w1:compose:4", f"Sebabnya, kata ini na’t (نَعْت), yaitu sifat, bagi {allahi} di ayat kedua."), [])
        self.assertEqual(br("al-fatihah:3:structure:1", "Sekarang susunan kalimatnya. Ayat ini melanjutkan ayat kedua."), [])
        self.assertEqual(br("al-ikhlas:4:w1", "menyambungkan kalimat ini dengan frasa لَمْ (lam) يَلِدْ (yalid) yang artinya “tidak "
                                              "beranak” di ayat ketiga"), [])
        self.assertEqual(br("an-nas:2:w1", "badal dari kata بِرَبِّ (birabbi) yang artinya “kepada Tuhan” di ayat pertama, yang majrur"), [])
        # … a citation in a line that says no dependency, a citation in a comparison, an ayah after an
        # ordinary word, "melanjutkan" not at "ayat ini"
        self.assertEqual(br("al-fatihah:3:w1", f"Lihat {allahi} di ayat kedua."), ["ayat kedua"])
        self.assertEqual(br("al-fatihah:3:w1", f"Sifat bagi {allahi} di ayat kedua, seperti di ayat pertama."), ["ayat kedua", "ayat pertama"])
        self.assertEqual(br("al-fatihah:3:w1", "Kata ini sifat bagi nama Allah di ayat kedua."), ["ayat kedua"])
        self.assertEqual(br("al-fatihah:4:w1", "Pelajaran ini melanjutkan ayat kedua."), ["ayat kedua"])
        self.assertEqual(V.citations("al-fatihah:4:w1:compose:2", f"na’t (نَعْت), yaitu sifat, bagi {allahi} di ayat kedua."), [([allahi], 2)])
        self.assertEqual(V.citations("al-fatihah:2:w1", f"bagi {allahi} di ayat pertama"), [([allahi], 1)])
        self.assertEqual(V.citations("al-fatihah:1:w1", f"bagi {allahi} di ayat kedua"), [])  # a later ayah: no citation
        for man in MANIFESTS.values():
            for lid, ln in man["lines"].items():
                self.assertEqual(br(lid, ln["display"]), [], lid)

    def test_continuations(self):
        # Every continuation of the four surahs (the authored data, 2026-10-18), said as the data says.
        per = {slug: sorted(d["ayat"]) for slug, d in CONTINUES.items()}
        self.assertEqual(per, {"al-fatihah": [3, 4, 7], "al-ikhlas": [2, 3, 4], "al-falaq": [2, 3, 4, 5], "an-nas": [2, 3, 4, 5, 6]})
        self.assertEqual(V.continuation_problems(MANIFESTS, LESSONS, V.Named(LESSONS, COMPOSE), CONTINUES), [])
        lines = MANIFESTS["al-fatihah"]["lines"]
        # The operator's example: Al-Fatihah 3, word 1, and the structure item that said "bukan kalimat baru".
        self.assertEqual(lines["al-fatihah:3:w1:compose:4"]["display"],
                         f"Sebabnya, kata ini na’t (نَعْت), yaitu sifat, bagi {ALLAHI} di ayat kedua.")
        self.assertTrue(lines["al-fatihah:3:structure:1"]["display"].startswith(
            "Sekarang susunan kalimatnya. Ayat ini melanjutkan ayat kedua. Kedua katanya adalah na’t (نَعْت), yaitu dua sifat "
            f"bagi {ALLAHI} di ayat kedua"))
        self.assertIn("bagi Allohi di ayat kedua", lines["al-fatihah:3:w1:compose:4"]["text"])
        # a heavy-letter word is cited caption-only: "… bagi kata yang artinya jalan di ayat keenam"
        self.assertIn("kata ini pengganti bagi kata yang artinya jalan di ayat keenam", lines["al-fatihah:7:w1:compose:3"]["text"])
        # the hedge the data carries, where the kitab differ
        self.assertTrue(MANIFESTS["al-ikhlas"]["lines"]["al-ikhlas:2:structure:a"]["display"].startswith(
            "Sekarang susunan kalimatnya. Menurut al-Mujtaba dan al-Jadwal, ayat ini melanjutkan ayat pertama:"))
        # no ayah without data says it, and the ayat that start a sentence do not
        for man in MANIFESTS.values():
            for lid, ln in man["lines"].items():
                if V.CONTINUES.search(ln["display"]):
                    slug, a = lid.split(":")[:2]
                    self.assertIn(int(a), CONTINUES[slug]["ayat"], lid)
        for slug, ayah in (("al-fatihah", 2), ("al-fatihah", 5), ("al-fatihah", 6), ("al-ikhlas", 1), ("an-nas", 1)):
            self.assertNotIn(ayah, CONTINUES[slug]["ayat"])

    def test_heavy_letter_words_are_shown_not_said(self):
        # Operator 2026-10-17: "better not to use heavy-letter words with elevenlabs, we just explain
        # but not read them; simple words so far is ok". THE rule, from the word's Arabic letters.
        said = {"بِسْمِ": "bismi", "ٱسْمِ": "ismi", "رَبِّ": "rabbi", "ٱلْحَمْدُ": "al-ḥamdu", "نَعْبُدُ": "na‘budu",
                "ٱلَّذِينَ": "allażīna", "أَعُوذُ": "a‘ūżu", "ٱلْعَٰلَمِينَ": "al-‘ālamīna"}
        shown = {"ٱلصِّرَٰطَ": "aṣ-ṣirāṭa", "قُلْ": "qul", "غَيْرِ": "gairi", "خَلَقَ": "khalaqa", "ٱلْفَلَقِ": "al-falaqi",
                 "ٱلصَّمَدُ": "aṣ-ṣamadu", "ٱلْمُسْتَقِيمَ": "al-mustaqīma", "ٱلضَّآلِّينَ": "aḍ-ḍāllīna"}
        for ar, tr in said.items():
            self.assertTrue(V.named_is_said(ar, tr), tr)
        for ar, tr in shown.items():
            self.assertFalse(V.named_is_said(ar, tr), tr)
        # every manifest as built: a named word is in the spoken text exactly when it is said
        n_said = n_shown = 0
        for man in MANIFESTS.values():
            for lid, ln in man["lines"].items():
                for m in V.NAMED_SHOWN.finditer(ln["display"]):
                    says = re.search(rf"(?<![\w'‘’-]){re.escape(V.named_speech(m.group('lat')))}(?![\w'‘’-])", ln["text"])
                    self.assertEqual(bool(says), V.named_is_said(m.group("ar"), m.group("lat")), f"{lid}: {m.group()}")
                    n_said, n_shown = n_said + bool(says), n_shown + (not says)
                self.assertEqual(V.said_heavy(ln), [], lid)
        self.assertGreater(n_said, 50)
        self.assertGreater(n_shown, 30)
        # a shown-only word: on screen, left out of the speech with its connector, its piece carried
        # by the token before it (with that token's timing: nothing faked)
        ln = MANIFESTS["al-fatihah"]["lines"][SHOWN_ONLY]
        w = LESSONS["al-fatihah"]["ayat"][6]["words"][0]
        self.assertEqual(ln["display"], f"Kata pertama, yaitu {w['ar']} ({w['translit']}), artinya: “jalan”.")
        self.assertEqual(ln["text"], "Kata pertama artinya: jalan.")
        self.assertEqual(LEX.speech_of_display(ln["display"]), ln["text"])
        cuts = LEX.text_cuts(ln["display"])
        self.assertEqual(cuts, [(len("Kata pertama"), f", yaitu {w['ar']} ({w['translit']}),")])
        toks = fake_tokens(ln["text"], ln["focus"], ln["display"])
        plain = LEX.tokens(ln["text"], [i * 0.05 for i in range(len(ln["text"]))], [i * 0.05 + 0.04 for i in range(len(ln["text"]))])
        self.assertEqual([t["t"] for t in toks], ["Kata", f"pertama, yaitu {w['ar']} ({w['translit']}),", "artinya:", "jalan."])
        self.assertEqual([(t["s"], t["e"]) for t in toks], [(t["s"], t["e"]) for t in plain])
        self.assertEqual(V.check_tokens("t", toks, None, ln["text"], LEX, None, (), cuts), [])
        # the cases of UNSAID, each a deletion
        x = "X"
        for before, after in (("Kata kedua, yaitu X, artinya: jalan.", "Kata kedua artinya: jalan."),
                              ("Itu kata pertama, yaitu X, yang artinya jalan.", "Itu kata pertama, yang artinya jalan."),
                              ("yaitu kata pertama, X, yang artinya katakanlah", "yaitu kata pertama, yang artinya katakanlah"),
                              ("pengganti bagi kata X yang artinya jalan, dan", "pengganti bagi kata yang artinya jalan, dan"),
                              ("sebelum huruf nun: X.", "sebelum huruf nun."),
                              ("kata kedua sampai keempat, yaitu a'udzu birabbi X, yang artinya", "kata kedua sampai keempat, yaitu a'udzu birabbi, yang artinya")):
            got, pieces = V.unsay(before, x)
            self.assertEqual(got, after)
            # … put back where they were, the text is what it was
            for pos, piece in sorted(pieces, reverse=True):
                got = got[:pos] + piece + got[pos:]
            self.assertEqual(got, before)
        # the render refuses a line that says one (said_heavy), and lets a line that only shows it go
        bad = {**ln, "text": "Kata pertama, yaitu shiratha, artinya: jalan."}
        self.assertIn("ṣirāṭa", V.held_line(bad, LEX))
        self.assertEqual(V.held_line(ln, LEX), [])
        # a named part said as its sound is no letter's name (the warm-up's تَ (ta), 2026-10-17); the
        # same syllable said outside a named word still is
        ta = MANIFESTS["al-fatihah"]["lines"]["al-fatihah:7:ex:word-kind:4:why"]
        self.assertIn(", yaitu ta, ", ta["text"])
        self.assertEqual(V.held_line(ta, LEX), [])
        self.assertEqual(V.held_line({**ta, "text": ta["text"] + " Huruf ta di akhirnya."}, LEX), ["ta"])
        manifests = {"x": {"lines": {"x:1:w1": bad}}}
        self.assertEqual([lid for lid, _ in R.blocked([("x", "x:1:w1", bad["text"])], LEX, manifests)], ["x:1:w1"])
        # and the dictionary's retired `named` list is refused
        self.assertTrue(any("`named` is retired" in e for e in V.Lexicon({**LEXDATA, "named": []}).shape))

    def test_bare_letters_in_captions(self):
        # "we dont need to write “ba’” here, only the arabic one is enough, also apply this rule to
        # similar sentences" (operator 2026-10-17): a single letter is shown alone, in the shape the
        # screen gives it; the article keeps its name; the spoken text still names the letter.
        bare = sorted(t.head for t in LEX.terms if t.bare)
        self.assertIn("ba’", bare)
        self.assertIn("alif", bare)
        self.assertNotIn("alif lam", bare)  # the article, two letters
        self.assertFalse(LEX.by_term["كَلَام"].letter)  # kalam is a term, not the letter lam
        self.assertEqual(set(V.letter_shapes("ا")), set("اٱأإآ"))
        self.assertEqual(V.letter_shapes("بِ"), "ب")
        lines = MANIFESTS["al-fatihah"]["lines"]
        shown = {k: lines[f"al-fatihah:0:primer:{k}"]["display"] for k in (3, 5, 7, 9, 10, 11, 12, 13, 14)}
        self.assertTrue(shown[3].endswith("Contohnya huruf ب ini, tanpa harakat."))
        self.assertIn("seperti huruf و kecil", shown[7])
        self.assertTrue(shown[9].endswith("Contohnya huruf س ini, tanpa tanda."))
        self.assertIn("maka huruf سْ dibaca mati", shown[10])
        self.assertIn("Contohnya huruf رَ ini", shown[11])
        self.assertRegex(shown[12], "huruf ر[\u0651\u064e]{2} menandakan")  # the doubled ra', as the frame writes it
        self.assertTrue(shown[13].startswith("Satu tanda lagi: ا kecil yang tegak. Contohnya huruf مَ ini"))
        self.assertIn("pada huruf مَٰ itu", shown[14])
        # No caption of any manifest names a single letter in Latin beside it, nor any karaoke word.
        for name, man in MANIFESTS.items():
            for lid, ln in man["lines"].items():
                for s in [ln["display"], *(t["t"] for t in ln.get("tokens") or [])]:
                    for t in LEX.terms:
                        if t.bare:
                            hit = re.search(rf"(?<![\w'‘’]){V.letter_name_rx(t)} \([{V.AR_LETTERS}]+\)", s)
                            self.assertTrue(hit is None or s[:hit.start()].lower().endswith("alif "), (lid, s))  # the article
        # The spoken text is unchanged by it (the same file names: validate_narration's delivery name
        # binds the text), and saying the caption gives it back exactly.
        self.assertIn("Contohnya huruf بَاء ini, tanpa harakat.", lines["al-fatihah:0:primer:3"]["text"])
        for k in (3, 7, 11, 13, 14):
            ln = lines[f"al-fatihah:0:primer:{k}"]
            self.assertEqual(LEX.speech_of_display(ln["display"]), ln["text"])
            self.assertTrue(V.is_delivery(ln["audio"], MANIFESTS["al-fatihah"]["voice"], "al-fatihah", ln["text"]))

    def test_sin_is_said_sin(self):
        # "When say sin, i hear it’s too long, you read it siiiin, i think sin is enough" (operator
        # 2026-10-17): one spelling, Latin, pending his ear check; the caption still shows س alone.
        sin = LEX.by_term["سِين"]
        self.assertEqual((sin.speak, sin.letter, sin.bare, sin.arabic_speak), ("sin", True, True, False))
        self.assertTrue(sin.pending)
        lines = MANIFESTS["al-fatihah"]["lines"]
        said = [lid for man in MANIFESTS.values() for lid, ln in man["lines"].items() if re.search(r"\bsin\b", ln["text"])]
        # (al-fatihah:2:w1:compose:3 said it too, until the operator struck its "seperti di atas huruf
        # sin pada ayat pertama", 2026-10-17)
        self.assertEqual(said, ["al-fatihah:0:primer:9", "al-fatihah:0:primer:10"])
        self.assertFalse(any("سِين" in ln["text"] for man in MANIFESTS.values() for ln in man["lines"].values()))
        self.assertIn("Contohnya huruf sin ini, tanpa tanda.", lines["al-fatihah:0:primer:9"]["text"])
        # a new text: no audio until it is rendered (and the render does not refuse it: no held
        # term), then audio of that text (rendered 2026-10-17)
        for lid in said:
            audio = lines[lid].get("audio")
            if audio is not None:
                self.assertEqual(audio["url"], V.delivery_url(MANIFESTS["al-fatihah"]["voice"], "al-fatihah", lines[lid]["text"],
                                                              audio["sha256"]), lid)
            self.assertEqual(V.held(lines[lid]["text"], LEX), [])
        self.assertEqual(V.check_spoken("t", "Contohnya huruf sin ini.", FORMS, LEX), [])
        self.assertIn("سِين", V.pending_terms(MANIFESTS, LEX))
        # "sini" and "sinar" are Indonesian words, never the letter
        self.assertEqual([t.term for _a, _b, t in LEX.spoken_spans("di sini, sinar, dan huruf sin.")], ["سِين"])

    def test_cut_take_tolerance(self):
        # A take ElevenLabs cut short (operator 2026-10-17: "the voice is cut slightly before the
        # sentence finished"): al-fatihah:0:primer:1's master is 4.049 s, its last letter aligned to
        # end at 4.16 s. Every whole take of 2026-10-17 ends 26 ms or more after its last token.
        self.assertEqual(V.CUT_TOLERANCE_MS, 20)
        toks = [{"t": "Pertama,", "s": 0.0, "e": 0.6}, {"t": "Arab.", "s": 3.84, "e": 4.16}]
        self.assertEqual(V.cut_ms(toks, 4049), 111)
        self.assertTrue(V.is_cut(toks, 4049))
        self.assertFalse(V.is_cut(toks, 4186))  # 26 ms after it: the last MP3 frame of a whole take
        self.assertFalse(V.is_cut(toks, 4140))  # 20 ms short: rounding
        self.assertTrue(V.is_cut(toks, 4139))   # 21 ms short: cut
        self.assertFalse(V.is_cut([], 1000))
        self.assertFalse(V.is_cut(toks, None))
        self.assertEqual(V.check_tokens("t", toks, {"ms": 4140}, None, LEX, None), [])
        self.assertIn("the take is cut", " ".join(V.check_tokens("t", toks, {"ms": 4049}, None, LEX, None)))
        # Every rendered line is whole now: the two cut takes (al-fatihah:0:primer:1, 111 ms;
        # al-fatihah:4:w1:compose:2, 131 ms) were dropped by the build, and their new takes (rendered
        # 2026-10-17) are whole like the rest.
        for name, man in MANIFESTS.items():
            for lid, ln in man["lines"].items():
                if "audio" in ln:
                    self.assertFalse(V.is_cut(ln["tokens"], ln["audio"]["ms"]), lid)
        for lid in ("al-fatihah:0:primer:1", "al-fatihah:4:w1:compose:2"):
            ln = MANIFESTS["al-fatihah"]["lines"][lid]
            if "audio" in ln:
                self.assertFalse(V.is_cut(ln["tokens"], ln["audio"]["ms"]), lid)

    def test_build_does_not_carry_a_cut_take_over(self):
        text = "Benar."
        toks = fake_tokens(text)
        end = round(toks[-1]["e"] * 1000)
        whole = {"text": text, "display": text, "highlight": [], "focus": None,
                 "audio": {"url": V.delivery_url(VOICE, "shared", text, SHA), "ms": end + 26, "sha256": SHA}, "tokens": toks}
        cut = {**whole, "audio": {**whole["audio"], "ms": end - 111}}
        new = {"shared:correct": {"text": text, "display": text, "highlight": [], "focus": None}}
        old = lambda ln, lid="shared:correct": {"version": 2, "voice": dict(VOICE), "lines": {lid: ln}}  # noqa: E731
        self.assertEqual(B.manifest(new, old(whole), LEX, FORMS)["lines"]["shared:correct"]["audio"], whole["audio"])
        for prev in (old(cut), old(cut, "shared:revealed")):  # its own, or another line's of the same text
            got = B.manifest(new, prev, LEX, FORMS)["lines"]["shared:correct"]
            self.assertNotIn("audio", got)
            self.assertNotIn("tokens", got)

    def test_named_words(self):
        # The one place the narrator says a Qur'anic word, in Latin: where the line explains it and
        # its caption shows it from the content's bytes (operator 2026-10-17; validate_narration
        # "named words").
        self.assertEqual(V.named_speech("bi"), "bi")
        self.assertEqual(V.named_speech("Allāhi"), "Allohi")       # the Name at a word's start: Alloh
        self.assertEqual(V.named_speech("lillāhi"), "lillahi")     # … not after li-: light
        self.assertEqual(V.named_speech("al-‘ālamīna"), "al-'alamina")  # a simple word: ‘ → '
        self.assertEqual(V.named_speech("allażīna"), "alladzina")
        named = V.Named(LESSONS, COMPOSE)
        self.assertEqual(named.resolve("1:1:1", "bi"), ("بِ", "bi"))
        self.assertEqual(named.resolve("1:1:2"), (FORMS.word_ar["1:1:2"], "Allāhi"))
        with self.assertRaises(SystemExit):
            named.resolve("1:1:1", "nope")
        sp = B.Speech(LEX, named)
        marked = sp.mark("Kata pertama diawali huruf jar, yaitu {{1:1:1/bi}} yang artinya “dengan”.")
        self.assertEqual(sp.spoken(marked), "Kata pertama diawali حَرْف جَرّ, yaitu bi yang artinya dengan.")
        shown = sp.shown(marked, None)
        self.assertEqual(shown, "Kata pertama diawali huruf jar (حَرْف جَرّ), yaitu بِ (bi) yang artinya “dengan”.")
        self.assertEqual(LEX.speech_of_display(shown), sp.spoken(marked))
        self.assertEqual(V.named_in_display(shown), [("bi", "بِ (bi)")])
        # karaoke: the named word is one token, shown as its caption shows it
        text = sp.spoken(marked)
        toks = LEX.tokens(text, [i * 0.05 for i in range(len(text))], [i * 0.05 + 0.04 for i in range(len(text))], None,
                          V.named_in_display(shown))
        self.assertIn("بِ (bi)", [t["t"] for t in toks])
        self.assertEqual(V.check_tokens("t", toks, None, text, LEX, None, V.named_in_display(shown)), [])
        # without a caption that names it, the same word said is a Qur'anic word in narration
        self.assertTrue(any("Qur'anic word 'bi'" in e or "Qur'anic word" in e for e in V.check_spoken("t", "Yaitu ismi.", FORMS, LEX)))
        self.assertEqual(V.check_spoken("t", "Yaitu ismi.", FORMS, LEX, ["ismi"]), [])
        # The lines as built: ayah 1's first structure item names بِ and ٱسْمِ (the operator's example)
        s11 = MANIFESTS["al-fatihah"]["lines"][S11]
        self.assertIn("yaitu بِ (bi) yang artinya “dengan”, sehingga isim (اِسْم) sesudahnya, yaitu ٱسْمِ (ismi) yang artinya “nama”",
                      s11["display"])
        self.assertIn("yaitu bi yang artinya dengan, sehingga اِسْم sesudahnya, yaitu ismi yang artinya nama", s11["text"])

    @NEEDS_FFMPEG
    def test_render_refuses_a_cut_take(self):
        # The render checks a fresh take BEFORE it takes the master's place: one ElevenLabs cut short
        # never becomes the master, is never delivered, never enters the manifest; it is kept aside
        # (paid for) and the run exits 1. The same command again renders one more take.
        lid, name = "shared:correct", "shared"
        text = MANIFESTS[name]["lines"][lid]["text"]
        manifests = unrendered(name)
        ln = manifests[name]["lines"][lid]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            out, args = root / "out", render_args(root)
            master = E.master_path(out, RENDER_VOICE, name, text)
            if not (tone(root / "cut.mp3", 440, 2) and tone(root / "whole.mp3", 660, 2)):
                self.skipTest("this ffmpeg cannot make the test tone")
            run = lambda: R.render([(name, lid, text)], manifests, LESSONS, args, LIBRARY)  # noqa: E731
            # 2 s of audio whose alignment runs to 2.2 s: the last word cut off.
            cut = mock.Mock(return_value=((root / "cut.mp3").read_bytes(), alignment(text, 2.2), len(text)))
            with rendering(root, cut) as said:
                self.assertEqual(run(), 1)
            cut.assert_called_once()
            self.assertIn(f"REFUSED {lid}", said.getvalue())
            self.assertNotIn("audio", ln)
            self.assertNotIn("tokens", ln)
            self.assertFalse(master.exists() or master.with_suffix(".json").exists())
            kept = master.with_name(f"{master.stem}.cut-1.mp3")
            self.assertEqual(kept.read_bytes(), (root / "cut.mp3").read_bytes())
            self.assertTrue(kept.with_suffix(".json").is_file())
            self.assertEqual(list(out.glob("delivery/**/*.mp3")), [])
            self.assertFalse(list(out.glob("narration/**/*.new.*")))
            # Again: a whole take this time — checked, put in the master's place, delivered.
            whole = mock.Mock(return_value=((root / "whole.mp3").read_bytes(), alignment(text, 1.9), len(text)))
            with rendering(root, whole) as said:
                self.assertEqual(run(), 0)
            whole.assert_called_once()
            self.assertEqual(master.read_bytes(), (root / "whole.mp3").read_bytes())
            self.assertTrue(kept.is_file())  # the refused take stays where it was
            self.assertTrue(V.is_delivery(ln["audio"], RENDER_VOICE, name, text))
            self.assertFalse(V.is_cut(ln["tokens"], ln["audio"]["ms"]))

    @NEEDS_FFMPEG
    def test_render_does_not_reuse_a_cut_master(self):
        # A cut take on disk (as the masters of al-fatihah:0:primer:1 and 4:w1:compose:2 are) is never
        # re-used for a line without audio: it is moved aside, not deleted, and the line is rendered anew.
        lid, name = "shared:correct", "shared"
        text = MANIFESTS[name]["lines"][lid]["text"]
        manifests = unrendered(name)
        ln = manifests[name]["lines"][lid]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            out, args = root / "out", render_args(root)
            master = E.master_path(out, RENDER_VOICE, name, text)
            if not (tone(master, 440, 2) and tone(root / "whole.mp3", 660, 2)):
                self.skipTest("this ffmpeg cannot make the test tone")
            old = master.read_bytes()
            master.with_suffix(".json").write_text(json.dumps(alignment(text, 2.2)), encoding="utf-8")
            whole = mock.Mock(return_value=((root / "whole.mp3").read_bytes(), alignment(text, 1.9), len(text)))
            with rendering(root, whole) as said:
                self.assertEqual(R.render([(name, lid, text)], manifests, LESSONS, args, LIBRARY), 0)
            whole.assert_called_once()
            self.assertIn(f"cut    {lid}", said.getvalue())
            self.assertNotIn(f"reuse  {lid}", said.getvalue())
            aside = master.with_name(f"{master.stem}.cut-1.mp3")
            self.assertEqual(aside.read_bytes(), old)
            self.assertTrue(aside.with_suffix(".json").is_file())
            self.assertEqual(master.read_bytes(), (root / "whole.mp3").read_bytes())
            self.assertEqual(E.timings(ln["tokens"]), E.timings(LEX.tokens(text, *(alignment(text, 1.9)[k] for k in (
                "character_start_times_seconds", "character_end_times_seconds")))))

    @NEEDS_FFMPEG
    def test_delivery_refuses_a_cut_master(self):
        voice = {"id": "v1", "name": "Suara Uji", "model": "eleven_v3"}
        text = "Benar."
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            master = E.master_path(root, voice, "shared", text)
            if not tone(master, 440, 2):
                self.skipTest("this ffmpeg cannot make the test tone")
            ms = E.probe(master)["ms"]
            E.deliver(master, text, voice, "shared", [{"t": "Benar.", "s": 0.1, "e": (ms + V.CUT_TOLERANCE_MS) / 1000}], root)
            with self.assertRaises(SystemExit) as caught:
                E.deliver(master, text, voice, "shared", [{"t": "Benar.", "s": 0.1, "e": (ms + 111) / 1000}], root)
            self.assertIn("its master is cut short: the last token ends 111 ms after the master does", str(caught.exception))


def main() -> int:
    # `--only <text>`: while iterating, the planted faults whose name holds <text> and the unit
    # tests whose id does (the whole run plants every fault and takes minutes). CI runs it bare.
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv[1:-1] else None
    chosen = [m for m in MUTATIONS if only is None or only in m[0]]
    width = max(len(n) for n, _, _ in MUTATIONS)
    failed = 0
    base = run_check(copy.deepcopy(MANIFESTS), copy.deepcopy(LESSONS), copy.deepcopy(LEXDATA))
    print(f"{'unmutated copies':{width}s}  {'PASS' if not base else 'FAIL'}" + (f"  {base[:3]}" if base else ""))
    failed += bool(base)
    for name, mutate, expect in chosen:
        m, ls, lx, cp = copy.deepcopy(MANIFESTS), copy.deepcopy(LESSONS), copy.deepcopy(LEXDATA), copy.deepcopy(COMPOSE)
        mp, cur, pend = copy.deepcopy(LESSONMAP), copy.deepcopy(CURRICULUM), copy.deepcopy(PENDING)
        cont = copy.deepcopy(CONTINUES)
        mutate(m, ls, lx, cp, mp, cur, pend, cont)
        errs = run_check(m, ls, lx, cp, mp, cur, pend, cont)
        hit = next((e for e in errs if expect in e), None)
        failed += hit is None
        print(f"{name:{width}s}  {'caught' if hit else 'MISSED'}  {hit or errs[:2]}")
    suite = unittest.TestSuite()
    loader = unittest.defaultTestLoader
    for cls in (NarrationValidation, LessonMapLines, Dictionary, WordPlaces, SpeechAndRender):
        suite.addTests(t for t in loader.loadTestsFromTestCase(cls) if only is None or only in t.id())
    res = unittest.TextTestRunner(verbosity=1, stream=sys.stdout).run(suite)
    print(f"\n{len(chosen)} planted faults{'' if only is None else f' of {len(MUTATIONS)} (--only {only})'}, "
          f"{len(chosen) - failed + bool(base)} caught" if not base else "\nunmutated copies fail")
    return 1 if failed or not res.wasSuccessful() else 0


if __name__ == "__main__":
    sys.exit(main())
