#!/usr/bin/env python3
"""Mutation tests for validate_narration.py: each case plants one fault in a copy of the narration
manifests (content/narration/*.json), of the lessons they are built from, of the pronunciation
dictionary (authored/pronunciation.json), of the lesson maps, of the curriculum
(content/curriculum.json) or of the list it tolerates for now (authored/curriculum.pending.json),
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
LEXDATA = json.loads(V.PRONUNCIATION_JSON.read_text(encoding="utf-8"))
LEX = V.Lexicon(LEXDATA)
FORMS = V.Forms(LESSONS)
SHA = "a" * 64
VOICE = {"id": "v123", "name": "Suara Uji", "model": "eleven_v3"}


def run_check(m, ls, lx, cp=None, mp=None, cur=None, pend=None):
    return V.check(m, ls, LIBRARY, lex=V.Lexicon(lx), compose=COMPOSE if cp is None else cp,
                   lessonmap=LESSONMAP if mp is None else mp, curriculum=CURRICULUM if cur is None else cur,
                   pending=PENDING if pend is None else pend)


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


def fake_tokens(text, focus=None):
    """Tokens for `text` from a made-up alignment: 50 ms per character."""
    starts = [i * 0.05 for i in range(len(text))]
    ends = [i * 0.05 + 0.04 for i in range(len(text))]
    return LEX.tokens(text, starts, ends, FORMS.word_ar.get(focus) if focus else None)


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
            ln["tokens"] = fake_tokens(ln["text"], ln["focus"])
        else:
            ln.pop("tokens", None)
        if tweak:
            tweak(ln)
    return f


def tokens_only(lid):
    def f(m, *_):
        ln = line(m, lid)
        ln.pop("audio", None)
        ln["tokens"] = fake_tokens(ln["text"], ln["focus"])
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
LAM3 = "al-fatihah:1:w3:compose:3"  # "huruf lam (ل)": the bare lam of the frame's ٱلرَّحْمَٰن


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
AUD = next(lid for lid, ln in MANIFESTS["al-ikhlas"]["lines"].items() if ":w" in lid and not V.held(ln["text"], LEX))
NA_EX = non_applicable_exercise()


def heavy_line():
    """A line without audio that speaks a heavy letter + a with no approved respelling (khabar…)."""
    return next(lid for man in MANIFESTS.values() for lid, ln in man["lines"].items()
                if "audio" not in ln and V.heavy_latin(ln["text"], LEX) and name_of(lid) != "al-fatihah")


HEAVY = heavy_line()


def latin_line():
    """A line without audio that says an Arabic term in Latin (mubtada', fa'il…) and no heavy letter."""
    return next(lid for man in MANIFESTS.values() for lid, ln in man["lines"].items()
                if "audio" not in ln and V.latin_terms(ln["text"], LEX) and not V.heavy_latin(ln["text"], LEX))


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


# --- the lesson map's lines (operator 2026-10-13, plan L23 and L26): one per group of the card
N1, N2, N3, N4 = (f"al-fatihah:{n}:map:new" for n in (1, 2, 3, 4))
L1, L2, L3, L4 = (f"al-fatihah:{n}:map:learnt" for n in (1, 2, 3, 4))
T1, T3 = (f"al-fatihah:{n}:map:later" for n in (1, 3))


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
    def f(_m, _l, _x, _c, _mp, _cur, pend):
        fn(pend["lines"])
    return f


def listed(lid, terms):
    """The list of what is tolerated for now says `lid` uses `terms` too early."""
    return in_pending(lambda p: p.__setitem__(lid, list(terms)))


def then(*faults):
    """Several changes as ONE planted fault (a use, and the list's entry for it)."""
    def f(*args):
        for fault in faults:
            fault(*args)
    return f


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
    old = lines.pop(L2)
    lines[L2 + ":a"] = dict(old)
    lines[L2 + ":b"] = dict(old)


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
    ("caption names the letter", replace_in(WBA, "display", "ba’ (بِ)", "ba’ (بَاء)"),
     "caption shows the letter ba’ by its name"),
    ("caption letter not as in the ayah", replace_in("al-ikhlas:4:w3", "display", f"lam ({LAHU_L})", "lam (لِ)"),
     f"the letter as in the ayah is {LAHU_L}"),
    ("quotes left in the spoken text", replace_in(WBA, "text", "artinya dengan.", "artinya “dengan”."),
     "character not allowed in spoken text"),
    ("tokens that do not join to the caption", with_audio(AUD, tweak=bad_token_text), "tokens do not join"),
    ("tokens out of time order", with_audio(AUD, tweak=swap_first_tokens), "starts before the token before it"),
    ("tokens without audio", tokens_only(AUD), "tokens without audio"),
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
    ("primer line missing", drop("al-fatihah:1:primer:2"), "missing line al-fatihah:1:primer:2"),
    ("primer on an ayah the primer does not open", add("al-fatihah:2:primer:1", "Harakat."),
     "unexpected line al-fatihah:2:primer:1"),
    ("compose line without its frame", drop_frame(C1), "is not the animation frame this line plays over"),
    ("compose line on the wrong frame", set_field(C1, "frame", 1), "is not the animation frame this line plays over"),
    ("a frame on a line without animation", set_field("al-fatihah:1:w1", "frame", 1), "only primer / compose lines have one"),
    ("compose line on another word's card", set_field(C1, "focus", "1:1:2"), "not what the stage shows"),
    ("compose caption too long beside the animation", set_display(C1, "Kata pertama. " * 14),
     "beside the animation"),
    ("a syllable the tiles show, spoken", append_text(WBA, " Dibaca bi."), "a syllable the tiles show in transliteration"),
    ("a compose line split", split_compose, "is never split"),
    ("letter not as the frame writes it", replace_in(LAM3, "display", "lam (ل)", "lam (لِ)"),
     "the letter as in the ayah is ل"),
    ("composition changed, narration stale",
     compose_say("1:1:1", 1, "Bagian pertama adalah huruf jar yang artinya “dengan”."), "out of date"),
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
    ("the lead said before a later item", both(S12, "Kata yang artinya", "Sekarang susunan kalimatnya. Kata yang artinya"), "out of date"),
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
     why_basic("1:7:1", "Akhirnya fathah karena menjadi badal bagi kata yang artinya “jalan” di ayat keenam."),
     "al-fatihah:7:ex:sort-case:1:why: uses the term 'badal' before the lesson that teaches it (taught in 114:2)"),
    ("a why_basic that names a next-level term",
     why_basic("1:5:2", "Akhirnya dhammah karena fi'il mudhari' ini tidak didahului penashab; pelakunya tersirat."),
     "uses the term 'nashib' before the lesson that teaches it (taught in tingkat lanjut)"),
    ("Qur'anic word in a why_basic", why_basic("1:5:1", "Dhamir iyyāka ini mabni: akhirnya tetap fathah."), "names the Qur'anic word(s)"),
    ("a why_basic with a Latin term the dictionary does not speak",
     both("al-fatihah:6:ex:sort-case:1:why", "fa’il (فَاعِل) kata ini", "fa'il-nya", "فَاعِل kata ini", "fa'il-nya"), "says \"fa'il\" in Latin"),
    # --- Arabic terms said in Latin (rule 1) and the dictionary's approvals (review 2026-10-10)
    ("a compose line with a Latin grammar term (mubtada')", append_text(C1, " Kata ini mubtada'."),
     "says \"mubtada'\" in Latin"),
    ("a compose line with Latin sukun", append_text(C1, " Huruf itu dengan sukun di atasnya."), "says 'sukun' in Latin"),
    ("a compose line with a letter name the dictionary lacks", append_text(WBA, " Lalu huruf jim."), "says 'jim' in Latin"),
    ("a composed word's lead with a Latin term", append_text("al-fatihah:1:w1", " Ia mabni."), "says 'mabni' in Latin"),
    # Caught by check_renderable while the line is unrendered, by the rendered-audio check once it
    # carries audio (Al-Fatihah was rendered 2026-10-11): both messages share this wording.
    ("a primer line with a heavy letter + a (mushaf)", append_text("al-fatihah:1:primer:1", " Lihat mushaf."),
     "a heavy letter + a with no approved respelling"),
    ("a rendered line with a Latin grammar term", with_audio(LATIN), "in Latin, an Arabic term"),
    ("a letter name spoken in Latin where the dictionary has it", replace_in(C1, "text", "مِيم", "mim"),
     "'mim' must be spoken from the pronunciation dictionary"),
    ("dictionary: a term without its approval", lex_drop("نَعْت", "approved"), "needs `approved`"),
    ("dictionary: an approval that is not a date", lex_term("نَعْت", approved="soon"), "approved must be a date"),
    ("a syllable of another word's tiles in the same ayah (hum)",
     append_text("al-fatihah:7:w7:compose:2", " Bunyi asalnya hum."), "a syllable the tiles show"),
    ("a letter's name read as a sound", append_text("al-fatihah:1:primer:3", " Huruf بَاء dibaca بَاء."),
     "reads a letter's name as a sound"),
    ("Indonesian spelling, long vowel doubled (maaliki)", append_text(W, " Seperti maaliki."),
     "Qur'anic word 'maaliki' (another spelling"),
    ("Indonesian spelling, ‘ain as k (nakbudu)", append_text(W, " Fi'il ini, nakbudu."),
     "Qur'anic word 'nakbudu' (another spelling"),
    ("Indonesian spelling, ‘ain as ng (nastangin)", append_text(W, " Lalu nastangin."),
     "Qur'anic word 'nastangin' (another spelling"),
    ("the doubled lam not as the frame pins it", replace_in(W79, "display", f"lam ({LAM79})", f"lam ({LAM79_BARE})"),
     f"the letter as in the ayah is {LAM79}"),
    # --- the lesson map (plan L23, L26): after the imam's recitation one line per group of the card
    # ("map:new", "map:learnt", "map:later"), and "learned" before the recap
    ("map:new line missing", drop(N1), f"missing line {N1}"),
    ("map:learnt line missing", drop(L3), f"missing line {L3}"),
    ("map:later line missing (an ayah with next-level topics only)", drop(T3), f"missing line {T3}"),
    ("learned line missing", drop("al-fatihah:7:learned"), "missing line al-fatihah:7:learned"),
    ("a map line in a surah without a lesson map", add("al-ikhlas:1:map:new", "Di ayat ini tidak ada hal baru."),
     "unexpected line al-ikhlas:1:map:new"),
    ("the one map line of before the curriculum", add("al-fatihah:1:map", "Di ayat ini ada dua hal baru."),
     "does not follow the step-id contract"),
    ("the surah's map switched off, its lines left behind", lambda _m, _l, _x, _c, mp, *_: mp.pop("al-fatihah"),
     f"unexpected line {N1}"),
    ("a map line split", split_map, "a map / learned line is never split"),
    ("a map line that highlights the ayah", set_field(N1, "highlight", [0]), "not what the stage shows for this step"),
    # what is new
    ("the count of new steps", both(N2, "tiga hal baru", "empat hal baru"), "says empat new step(s), the lesson map has 3"),
    ("a new step not named", both(N2, ", marfu’ (مَرْفُوع)", "", ", مَرْفُوع", ""),
     "names ['jumlah-ismiyyah', 'jamak-mudzakkar-salim'] as new step(s); the lesson map gives"),
    ("a learnt step named as new", both(N3, "dan na’t (نَعْت)", "dan majrur (مَجْرُور)", "dan نَعْت", "dan مَجْرُور"),
     "names ['alif-lam', 'majrur'] as new step(s); the lesson map gives ['alif-lam', 'naat']"),
    ("a name that is no step of the map", both(N4, "idhafah (إِضَافَة)", "isim (اِسْم)", "idhofah", "اِسْم"),
     "are not a list of the map's step names"),
    ("map:new says more than what is new", more(N1, "Mari kita mulai."), "does not say, in one sentence, how many steps are new"),
    # what has been learnt so far, and what of it comes up again here
    ("the count of steps learnt so far", both(L2, "mempelajari empat hal.", "mempelajari lima hal."),
     "says lima step(s) learnt so far, the lesson map has 4"),
    ("the count of repeated steps", both(L2, "ada tiga,", "ada empat,"), "says empat repeated step(s), the lesson map has 3"),
    ("a repeated step the map does not mark here", both(L3, "di antaranya majrur (مَجْرُور)", "di antaranya huruf jar (حَرْف جَرّ)", "di antaranya مَجْرُور", "di antaranya حَرْف جَرّ"),
     "names ['huruf-jar'] as repeated step(s)"),
    # … by recency (decision 8: "preferring the ones taught most recently"), and a step that
    # occurs in every ayah only when nothing else is met again (2026-10-13)
    ("the repeated steps named oldest first, as until 2026-10-13",
     both(L2, "huruf jar (حَرْف جَرّ) dan majrur (مَجْرُور)", "majrur (مَجْرُور) dan huruf jar (حَرْف جَرّ)", "حَرْف جَرّ dan مَجْرُور", "مَجْرُور dan حَرْف جَرّ"),
     "the most recently taught come first, and a step that occurs in every ayah is named only when no other is met again: ['huruf-jar', 'majrur']"),
    ("the step that occurs in every ayah named beside another", both(L3, "di antaranya majrur (مَجْرُور).", "di antaranya majrur (مَجْرُور) dan tiga jenis kata.", "di antaranya مَجْرُور.", "di antaranya مَجْرُور dan tiga jenis kata."),
     "names ['majrur', 'kalimah'] as repeated step(s)"),
    ("“di antaranya” where every repeated step is named", both(L1, "ada satu: ", "ada satu, di antaranya "),
     "“di antaranya” is said exactly when not every repeated step is named"),
    ("some repeated steps named without “di antaranya”", both(L4, "ada empat, di antaranya ", "ada empat: "),
     "“di antaranya” is said exactly when not every repeated step is named"),
    ("what comes up again left out", first_sentence_only(L3),
     "does not say how many steps have been learnt so far, then which of them come up again here"),
    # what is taught later, and how many next-level topics there are
    ("a postponed step, the wrong ayah",
     both(T1, "idhafah (إِضَافَة) di ayat keempat", "idhafah (إِضَافَة) di ayat kelima", "idhofah di ayat keempat", "idhofah di ayat kelima"),
     "says idhafah is taught in ayah 5; the lesson map says ayah 4"),
    ("a postponed step left out of the line", both(T1, "alif lam (ال) di ayat ketiga, ", "", "alif lam di ayat ketiga, ", ""),
     "names ['naat', 'idhafah'] as postponed step(s); the lesson map gives ['alif-lam', 'naat', 'idhafah']"),
    ("the count of postponed steps", both(T1, "Ada tiga hal lagi", "Ada dua hal lagi"), "says dua postponed step(s), the lesson map has 3"),
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
    # the closing: what was new, and the running total
    ("the closing's count of new steps", both("al-fatihah:7:learned", "tiga hal baru", "dua hal baru"),
     "al-fatihah:7:learned: says dua new step(s), the lesson map has 3"),
    ("the closing names the new steps in another order",
     both("al-fatihah:1:learned", "majrur (مَجْرُور) dan huruf jar (حَرْف جَرّ)", "huruf jar (حَرْف جَرّ) dan majrur (مَجْرُور)",
          "مَجْرُور dan حَرْف جَرّ", "حَرْف جَرّ dan مَجْرُور"),
     "al-fatihah:1:learned: names ['huruf-jar', 'majrur'] as new step(s)"),
    ("the opening names other new steps than the closing",
     both(N4, "satu hal baru: idhafah (إِضَافَة)", "satu hal baru: na’t (نَعْت)", "satu hal baru: idhofah", "satu hal baru: نَعْت"),
     "al-fatihah:4:learned: names ['idhafah'], not the new steps the ayah's map:new line names (['naat'])"),
    ("the running total", both("al-fatihah:3:learned", "sudah sembilan hal", "sudah delapan hal"),
     "al-fatihah:3:learned: says delapan step(s) learnt in all, the lesson map has 9"),
    ("the running total left out", first_sentence_only("al-fatihah:3:learned"),
     "does not say how many new steps the ayah taught, and which, then the running total"),
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
        # recite → what the ayah brings (the lesson map, plan L23 and L26: one line per group of its
        # card) → the primer → each word: its gloss line, then its frames' lines (rule 14)
        self.assertEqual(ids[1:6], ["al-fatihah:1:recite", "al-fatihah:1:map:new", "al-fatihah:1:map:learnt",
                                    "al-fatihah:1:map:later", "al-fatihah:1:primer:1"])
        w1 = ids.index("al-fatihah:1:w1")
        self.assertEqual(ids[w1 + 1], "al-fatihah:1:w1:compose:1")
        comp = COMPOSE["al-fatihah"]["words"]["1:1:1"]
        for k, ln in enumerate(comp["lines"], 1):
            self.assertEqual(lines[f"al-fatihah:1:w1:compose:{k}"]["frame"], ln["frame"])
        self.assertNotIn("frame", lines["al-fatihah:1:w1"])
        # The word line is the gloss and the lead; the why is said part by part in the frames.
        self.assertEqual(lines["al-fatihah:1:w1"]["display"], "Kata pertama artinya: “dengan nama”. Kata ini terdiri dari dua bagian.")
        # The narrator never says the tiles' syllables; the vowel sounds it may say.
        for lid, ln in lines.items():
            if ":compose:" in lid or ":primer:" in lid:
                self.assertNotRegex(ln["text"], r"\b(?:bi|ismu|ismi|bismi|ar-rahmanu|ar-rahmani)\b", lid)
        self.assertIn("bunyi a", lines["al-fatihah:1:primer:3"]["text"])

    def test_mutations_fail(self):
        for name, mutate, expect in MUTATIONS:
            with self.subTest(name):
                m, ls, lx, cp = copy.deepcopy(MANIFESTS), copy.deepcopy(LESSONS), copy.deepcopy(LEXDATA), copy.deepcopy(COMPOSE)
                mp, cur, pend = copy.deepcopy(LESSONMAP), copy.deepcopy(CURRICULUM), copy.deepcopy(PENDING)
                mutate(m, ls, lx, cp, mp, cur, pend)
                errs = run_check(m, ls, lx, cp, mp, cur, pend)
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
    def entry(new="", again="", rest="", later="", lanjut=0):
        """An ayah's entry: `again` the learnt steps that come up again here, `rest` the others."""
        return {"new": list(new), "learnt": [{"id": x, "here": True} for x in again] + [{"id": x, "here": False} for x in rest],
                "later": list(later), "lanjut": [f"r{i}" for i in range(lanjut)]}

    def test_wording(self):
        n = lambda new: B.map_new(self.entry(new), self.S)  # noqa: E731
        k = lambda again="", rest="", always=frozenset(): B.map_learnt(self.entry("", again, rest), self.S, always)  # noqa: E731
        t = lambda later="", lanjut=0: B.map_later(self.entry("", "", "", later, lanjut), self.S, 1)  # noqa: E731
        c = lambda new="", again="", rest="": B.map_closing(self.entry(new, again, rest), self.S)  # noqa: E731
        # what is new: every step named (at most three), a name with a "dan" of its own set apart
        self.assertEqual(n(""), "Di ayat ini tidak ada hal baru.")
        self.assertEqual(n("a"), "Di ayat ini ada satu hal baru: na't.")
        self.assertEqual(n("ab"), "Di ayat ini ada dua hal baru: na't dan badal.")
        self.assertEqual(n("abd"), "Di ayat ini ada tiga hal baru: na't, badal, dan idhafah.")
        self.assertEqual(n("ac"), "Di ayat ini ada dua hal baru: na't, serta mu'rab dan mabni.")
        # what has been learnt so far: the count of ALL of it, then what comes up again here
        self.assertIsNone(k())  # nothing learnt before: no line
        self.assertEqual(k("", "ab"), "Sebelum ayat ini, kita sudah mempelajari dua hal. Tidak ada yang kita temui lagi di ayat ini.")
        self.assertEqual(k("a", "bd"), "Sebelum ayat ini, kita sudah mempelajari tiga hal. Yang kita temui lagi di ayat ini ada satu: na't.")
        # … the most recently taught first (decision 8), all of them up to three
        self.assertEqual(k("zab", "d"), "Sebelum ayat ini, kita sudah mempelajari empat hal. Yang kita temui lagi di ayat ini ada tiga: "
                                         "badal, na't, dan tiga jenis kata.")
        # more than three come up again: the two most recent are named
        self.assertEqual(k("zabd", "e"), "Sebelum ayat ini, kita sudah mempelajari lima hal. Yang kita temui lagi di ayat ini ada empat, "
                                          "di antaranya idhafah dan badal.")
        # a step that occurs in every ayah ("z": the three kinds of word) is counted and not named
        # — so "di antaranya" — unless it is the only one met again
        self.assertEqual(k("zab", "d", {"z"}), "Sebelum ayat ini, kita sudah mempelajari empat hal. Yang kita temui lagi di ayat ini ada tiga, "
                                                "di antaranya badal dan na't.")
        self.assertEqual(k("zabd", "e", {"z"}), "Sebelum ayat ini, kita sudah mempelajari lima hal. Yang kita temui lagi di ayat ini ada empat, "
                                                 "di antaranya idhafah, badal, dan na't.")
        self.assertEqual(k("z", "ab", {"z"}), "Sebelum ayat ini, kita sudah mempelajari tiga hal. Yang kita temui lagi di ayat ini ada satu: "
                                               "tiga jenis kata.")
        self.assertEqual(V.named_again(self.entry("", "zabde"), {"z"}), (["e", "d"], False))
        self.assertEqual(V.named_again(self.entry("", "ab"), {"z"}), (["b", "a"], True))
        # The curriculum says which steps those are.
        self.assertEqual(CUR.always_steps(CURRICULUM), {"kalimah"})
        # what is taught later: one ayah, two ayat, another surah, more than three
        self.assertIsNone(t())
        self.assertEqual(t("b"), "Ada satu hal lagi di ayat ini, yaitu badal, tetapi baru kita bahas di ayat ketujuh.")
        self.assertEqual(t("cd"), "Ada dua hal lagi di ayat ini, yaitu mu'rab dan mabni, serta idhafah, tetapi baru kita bahas di ayat ketiga.")
        self.assertEqual(t("db"), "Ada dua hal lagi di ayat ini, tetapi baru kita bahas nanti: idhafah di ayat ketiga dan badal di ayat ketujuh.")
        self.assertEqual(t("be"), "Ada dua hal lagi di ayat ini, yaitu badal dan fi'il amr, tetapi baru kita bahas nanti.")
        self.assertEqual(t("abcd"), "Ada empat hal lagi di ayat ini, di antaranya na't dan badal, tetapi baru kita bahas nanti.")
        # the next-level topics: ONE sentence with their count, never a name
        self.assertEqual(t("", 2), "Di ayat ini ada dua hal tingkat lanjut, yang tidak kita bahas di tingkat dasar.")
        self.assertEqual(t("b", 1), "Ada satu hal lagi di ayat ini, yaitu badal, tetapi baru kita bahas di ayat ketujuh. "
                                    "Ada juga satu hal tingkat lanjut, yang tidak kita bahas di tingkat dasar.")
        # the closing: what was new and the running total; with nothing new, what was repeated
        self.assertEqual(c("ab", "z", "d"), "Di ayat ini kita mempelajari dua hal baru: na't dan badal. Dengan itu, sudah empat hal yang kita pelajari.")
        self.assertEqual(c("", "za", "d"), "Di ayat ini tidak ada hal baru; kita mengulang dua hal yang sudah kita pelajari.")
        self.assertEqual(c("", "", "ab"), "Di ayat ini tidak ada hal baru.")
        # which lines an ayah has
        self.assertEqual(V.map_opening_parts(self.entry("a")), ["map:new"])
        self.assertEqual(V.map_opening_parts(self.entry("a", "", "b")), ["map:new", "map:learnt"])
        self.assertEqual(V.map_opening_parts(self.entry("", "", "", "b")), ["map:new", "map:later"])
        self.assertEqual(V.map_opening_parts(self.entry("", "z", "", "", 1)), ["map:new", "map:learnt", "map:later"])
        self.assertEqual(V.map_opening_parts(None), [])

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
        # one whose postponed steps share an ayah, one taught in another surah.
        lesson = {"slug": "x", "surah": 1, "ayat": [{"ayah": n} for n in (1, 2, 3)]}
        shown = lambda prose: BC.Namer(LESSONS, LEX).shown(prose)  # noqa: E731
        mp = {"steps": self.S, "lanjut": {"r0": {"name": "Hal", "latin": "Hal", "from": "title"}}, "ayat": [
            {"ayah": 1, **self.entry("", "", "za", "cd")},
            {"ayah": 2, **self.entry("", "z", "a", "e", 1)},
            {"ayah": 3, **self.entry("", "", "za", "", 1)},
        ]}
        lines = {}
        for a in mp["ayat"]:
            base = f"x:{a['ayah']}"
            said = {"map:new": B.map_new(a, self.S), "map:learnt": B.map_learnt(a, self.S), "map:later": B.map_later(a, self.S, 1),
                    "learned": B.map_closing(a, self.S)}
            for part in [*V.map_opening_parts(a), "learned"]:
                lines[f"{base}:{part}"] = {"display": shown(said[part])}
        self.assertEqual(V.map_problems("x", lines, lesson, mp), [])
        self.assertIn("Tidak ada yang kita temui lagi di ayat ini.", lines["x:1:map:learnt"]["display"])
        self.assertIn("tetapi baru kita bahas di ayat ketiga.", lines["x:1:map:later"]["display"])
        # Said to come up again where none does; a shared ayah that is the wrong one; a count of none.
        bad = copy.deepcopy(lines)
        bad["x:1:map:learnt"]["display"] = lines["x:2:map:learnt"]["display"]
        self.assertTrue(any("no learnt step comes up again in this ayah" in e for e in V.map_problems("x", bad, lesson, mp)))
        bad = copy.deepcopy(lines)
        bad["x:1:map:later"]["display"] = bad["x:1:map:later"]["display"].replace("ketiga", "kelima")
        self.assertTrue(any("says the postponed steps are taught in ayah 5; the lesson map says ayah 3" in e
                            for e in V.map_problems("x", bad, lesson, mp)))
        bad = copy.deepcopy(lines)
        bad["x:3:learned"]["display"] = "Di ayat ini tidak ada hal baru; kita mengulang dua hal yang sudah kita pelajari."
        self.assertTrue(any("x:3:learned: the lesson map has no new step here (0 learnt step(s) come up again)" in e
                            for e in V.map_problems("x", bad, lesson, mp)))

    def test_al_fatihah_lines(self):
        lines = MANIFESTS["al-fatihah"]["lines"]
        is_map = lambda lid: lid.split(":", 2)[2] in V.MAP_PARTS  # noqa: E731
        ids = [lid for lid in lines if is_map(lid)]
        # Every ayah of Al-Fatihah has all three opening lines: something was learnt before each
        # (the lesson with no ayah comes first), and each has a next-level topic at least.
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
        self.assertEqual(order[at + 1:at + 4], [f"al-fatihah:2:{p}" for p in V.MAP_OPENING])
        self.assertEqual(order[order.index("al-fatihah:2:recap") - 1], "al-fatihah:2:learned")
        # Ayah 1: two new steps; two learnt before it (the lesson with no ayah), one of which every
        # ayah repeats; three steps seen and taught in ayat 3 and 4; one next-level topic, counted.
        self.assertEqual([lines[f"al-fatihah:1:{p}"]["display"] for p in V.MAP_PARTS], [
            "Di ayat ini ada dua hal baru: majrur (مَجْرُور) dan huruf jar (حَرْف جَرّ).",
            "Sebelum ayat ini, kita sudah mempelajari dua hal. Yang kita temui lagi di ayat ini ada satu: tiga jenis kata.",
            "Ada tiga hal lagi di ayat ini, tetapi baru kita bahas nanti: alif lam (ال) di ayat ketiga, na’t (نَعْت) di ayat ketiga, "
            "dan idhafah (إِضَافَة) di ayat keempat. Ada juga satu hal tingkat lanjut, yang tidak kita bahas di tingkat dasar.",
            "Di ayat ini kita mempelajari dua hal baru: majrur (مَجْرُور) dan huruf jar (حَرْف جَرّ). Dengan itu, sudah empat hal yang "
            "kita pelajari.",
        ])
        # The running total at each closing: 4, 7, 9, 10, 13, 16, 19 (kurikulum-dasar.md E).
        totals = [V.count_value(V._MAP_TOTAL.match(lines[f"al-fatihah:{n}:learned"]["display"].split(". ")[-1]).group("n")) for n in range(1, 8)]
        self.assertEqual(totals, [4, 7, 9, 10, 13, 16, 19])
        # No next-level topic is ever named by the narrator (nine of them, on seven cards): the
        # one sentence about them is their count.
        for n in range(1, 8):
            shown = lines[f"al-fatihah:{n}:map:later"]["display"]
            self.assertRegex(shown.split(". ")[-1], r"^(?:Ada juga|Di ayat ini ada) [a-z ]+ hal tingkat lanjut, yang tidak kita bahas di tingkat dasar\.$")
            for cid, c in LESSONMAP["al-fatihah"]["lanjut"].items():
                self.assertNotIn(V._low(c["name"]), shown, f"ayah {n} names {cid}")

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
        # The lesson with no ayah is not built yet: the kalimah record's line is said nowhere, and
        # the harakat primer stays where it is, in ayah 1.
        self.assertNotIn("concept:kalimah-isim-fiil-huruf", said)
        self.assertIn("al-fatihah:1:primer:1", fatihah)

    def test_a_moved_line_keeps_its_audio(self):
        # The curriculum moved four "Konsep baru" lines to another ayah of Al-Fatihah with their
        # text unchanged: the manifest keeps their audio, which is named by the text, not the place.
        lines = MANIFESTS["al-fatihah"]["lines"]
        for lid in ("al-fatihah:3:concept:naat", "al-fatihah:4:concept:idhafah", "al-fatihah:6:concept:jumlah-filiyyah",
                    "al-fatihah:7:concept:athaf"):
            self.assertIn("audio", lines[lid], lid)
        # A new line's text is new: no audio (the steps with their own text, the map's lines).
        for lid in ("al-fatihah:1:concept:majrur", "al-fatihah:2:concept:marfu", "al-fatihah:1:map:new", "al-fatihah:1:learned"):
            self.assertNotIn("audio", lines[lid], lid)
        # … and a word line whose text did not change kept its own: word 1 of ayah 1 (the karaoke
        # check's line), and most of the 170-odd word and composition lines — the ones reworded
        # since (2026-10-13: no term before its lesson) wait for a render, like any new text.
        self.assertIn("audio", lines["al-fatihah:1:w1"])
        word_lines = [ln for lid, ln in lines.items() if re.fullmatch(r"al-fatihah:\d:w\d(?::compose:\d+)?", lid)]
        self.assertGreater(sum("audio" in ln for ln in word_lines), 0.9 * len(word_lines))
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
        # not moved: the old line is still there, so a second line with the same text is a new line
        got = new({"x:1:concept:naat": bare(text), "x:3:concept:naat": bare(text)})
        self.assertIn("audio", got["x:1:concept:naat"])
        self.assertNotIn("audio", got["x:3:concept:naat"])
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
        is_map = lambda lid: lid.split(":", 2)[2] in V.MAP_PARTS if lid.count(":") >= 2 and not lid.startswith("shared:") else False  # noqa: E731
        for name in with_map:
            added = [lid for lid in with_map[name] if lid not in without[name]]
            self.assertEqual(len(added), 28 if name == "al-fatihah" else 0, name)
            self.assertTrue(all(is_map(lid) for lid in added))
            # … and every other line is what it was without the map, in the same order.
            self.assertEqual({k: v for k, v in with_map[name].items() if k not in added}, without[name], name)
            self.assertEqual([k for k in with_map[name] if k not in added], list(without[name]), name)

    def test_another_surah_switched_on(self):
        # An-Nas with a map of its own. Two of its steps have no text yet, so the real curriculum
        # refuses the switch (test_validate_map.py); here they are left out, and the surah's lines
        # are built in the CURRICULUM's order (An-Nas comes right after Al-Fatihah: 19 steps are
        # learnt before its first ayah), pass the validator, and move no other surah.
        import build_map as BM
        import lessonmap as LM
        import terms as TERMS
        authored = copy.deepcopy(CUR.load_authored())
        authored["steps"] = [s for s in authored["steps"] if s["id"] not in ("jamak-taksir", "mudzakkar-muannats")]
        cur = BC.build(authored, LESSONS, LIBRARY, TERMS.load_terms(), BC.Namer(LESSONS, LEX))
        maps = BM.build_all(LESSONS, LIBRARY, LEX, {"al-fatihah": LM.load_authored("al-fatihah"), "an-nas": {"slug": "an-nas", "names": {}}}, cur)
        self.assertEqual(maps["al-fatihah"], LESSONMAP["al-fatihah"])
        self.assertEqual(maps["an-nas"]["steps"]["fiil-amr"]["lesson"], "114:1")
        quiz = V.load_quiz()
        built = B.build_lines(LESSONS, LIBRARY, LEX, COMPOSE, quiz, maps, cur)
        new = [lid for lid in built["an-nas"] if lid not in MANIFESTS["an-nas"]["lines"]]
        self.assertEqual(sorted(new), sorted(f"an-nas:{n}:{p}" for n in range(1, 7) for p in V.MAP_PARTS))
        self.assertEqual(built["an-nas"]["an-nas:1:map:new"]["display"], "Di ayat ini ada satu hal baru: fi’il amr (فِعْل أَمْر).")
        self.assertTrue(built["an-nas"]["an-nas:1:map:learnt"]["display"].startswith("Sebelum ayat ini, kita sudah mempelajari sembilan belas hal."))
        self.assertEqual(built["an-nas"]["an-nas:3:map:new"]["display"], "Di ayat ini tidak ada hal baru.")
        self.assertTrue(built["an-nas"]["an-nas:3:learned"]["display"].startswith("Di ayat ini tidak ada hal baru; kita mengulang enam hal"))
        self.assertEqual(built["al-fatihah"], B.build_lines(LESSONS, LIBRARY, LEX, COMPOSE, quiz, LESSONMAP)["al-fatihah"])
        m = copy.deepcopy(MANIFESTS)
        m["an-nas"] = B.manifest(built["an-nas"], m["an-nas"], LEX, FORMS)
        self.assertEqual(V.check(m, LESSONS, LIBRARY, lex=LEX, compose=COMPOSE, lessonmap=maps, curriculum=cur), [])

    def test_rendered_map_lines_pass(self):
        # With the delivered file's audio and its tokens on each of the 28 lines, the validator
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
                    ln["tokens"] = fake_tokens(ln["text"])
        self.assertEqual(seen, 28)
        self.assertEqual(V.check(m, LESSONS, LIBRARY, lex=LEX, compose=COMPOSE, lessonmap=LESSONMAP), [])
        rebuilt = B.manifest(B.build_lines(LESSONS, LIBRARY, LEX, COMPOSE, V.load_quiz(), LESSONMAP)["al-fatihah"], man, LEX, FORMS,
                             V.letters_for("al-fatihah", LESSONS, FORMS, COMPOSE, LIBRARY))
        self.assertEqual(B.dump(rebuilt), B.dump(man))

    def test_unrendered_map_lines_pass(self):
        # The same 28 lines BEFORE a render — no audio, no tokens — are caption-only by design and
        # still valid, whatever the manifest on disk holds today.
        m = copy.deepcopy(MANIFESTS)
        stripped = 0
        for lid, ln in m["al-fatihah"]["lines"].items():
            if lid.split(":", 2)[2] in V.MAP_PARTS:
                stripped += 1
                ln.pop("audio", None)
                ln.pop("tokens", None)
        self.assertEqual(stripped, 28)
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
        # the letter of a preposition: its name is said, the letter as in the ayah is shown
        marked = sp.mark("Huruf lam yang artinya “bagi”.")
        self.assertEqual(sp.spoken(marked), "Huruf لَام yang artinya bagi.")
        self.assertEqual(sp.shown(marked, None), "Huruf lam (لِ) yang artinya “bagi”.")
        self.assertEqual(sp.shown(marked, FORMS.word_ar["112:4:3"]), f"Huruf lam ({LAHU_L}) yang artinya “bagi”.")
        self.assertEqual(sp.spoken(sp.mark("Sifat bagi “Allah”.")), "Sifat bagi Alloh.")

    def test_tokens(self):
        text = "Akhirnya dibaca كَسْرَة, karena didahului حَرْف جَرّ, yaitu huruf بَاء. Alloh."
        toks = fake_tokens(text)
        self.assertEqual([t["t"] for t in toks],
                         ["Akhirnya", "dibaca", "kasrah (كَسْرَة),", "karena", "didahului", "huruf jar (حَرْف جَرّ),",
                          "yaitu", "huruf", "ba’ (بِ).", "Allah."])
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
        rows = [("x", "x:1:w1", "Kata pertama adalah khabar."), ("x", "x:1:w2", "Akhirnya dibaca كَسْرَة.")]
        self.assertEqual(R.blocked(rows, LEX), [("x:1:w1", ["khabar"])])

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
        # alif is said as written (its Arabic name is refused, rule 3) and shown as on screen
        sp = B.Speech(LEX)
        marked = sp.mark("Alif lam dan alif.")
        self.assertEqual(sp.spoken(marked), "Alif lam dan alif.")
        self.assertEqual(sp.shown(marked, None), "Alif lam (ال) dan alif (ا).")

    def test_retext_keeps_timing(self):
        line = {"text": "Akhirnya dibaca كَسْرَة.", "focus": None}
        old = [{"t": "a", "s": 0.0, "e": 0.4}, {"t": "b", "s": 0.5, "e": 0.9}, {"t": "c", "s": 1.0, "e": 1.5}]
        new = B.retext_tokens(old, line, LEX, None)
        self.assertEqual([(t["t"], t["s"]) for t in new], [("Akhirnya", 0.0), ("dibaca", 0.5), ("kasrah (كَسْرَة).", 1.0)])


class WordPlaces(unittest.TestCase):
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
        # The primer marks the words whose letters its frame shows as they are (بِ of word 1).
        self.assertEqual(V.line_view(a, "primer:4", cp), ([1], None))
        self.assertEqual(V.line_view(a, "primer:3", cp), ([], None))  # بَ: an edit, not the ayah's letter
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
        # a word of ANOTHER ayah: by its meaning (only this ayah's words are numbered on screen)
        self.assertEqual(san.prose("Badal dari aṣ-ṣirāṭa di ayat 6.", 1, 7, 1),
                         "Badal dari kata yang artinya “jalan” di ayat enam.")
        self.assertEqual(san.prose("Sifat bagi lafaz Allah di ayat 2.", 1, 3),
                         "Sifat bagi lafaz “Allah” di ayat dua.")
        self.assertEqual(san.prose("Bergantung pada a‘ūżu (“aku berlindung”).", 113, 3),
                         "Bergantung pada kata yang artinya “aku berlindung” di ayat satu.")
        self.assertEqual(san.prose("Seperti khalaqa.", 1, 7), "Seperti kata yang artinya “Dia ciptakan”.")
        # the front of ‘alaihim (never spoken, not even in Arabic), and a title that is only the particle
        self.assertEqual(san.prose("‘Alā adalah huruf jar.", 1, 7, 4),
                         "Bagian depan kata ini adalah huruf jar yang artinya “atas”.")
        self.assertEqual(san.prose("Lam: menafikan dan menjazmkan fi'il mudhari'", 112, 3),
                         "Huruf yang menafikan dan menjazmkan fi'il mudhari'")
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
        self.assertIn("huruf ba' yang artinya “dengan”, dan huruf lam yang artinya “bagi”", hj)


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
        mutate(m, ls, lx, cp, mp, cur, pend)
        errs = run_check(m, ls, lx, cp, mp, cur, pend)
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
