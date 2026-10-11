#!/usr/bin/env python3
"""Mutation tests for validate_narration.py: each case plants one fault in a copy of the narration
manifests (content/narration/*.json), of the lessons they are built from or of the pronunciation
dictionary (authored/pronunciation.json), and asserts that the validator fails with the expected
message. The unmutated copies must pass. Also unit-tests the speech text, the dictionary rendering
(spoken text, caption, karaoke tokens), the Indonesian numbers, the render request body (no
network) and the delivery encode (its name, its fixed flags, drift and token fit; with ffmpeg on
the machine, one real encode of a generated tone). Standard library only; run from belajar/pipeline
after build_narration.py:

    python3 test_validate_narration.py          # table of faults and the message that caught each
    python3 -m unittest test_validate_narration # the same as a unittest run
"""
from __future__ import annotations

import argparse
import contextlib
import copy
import io
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import build_narration as B
import encode_narration as E
import render_narration as R
import validate_narration as V

MANIFESTS, LESSONS, LIBRARY = V.load_all()
COMPOSE = V.load_compose()
LEXDATA = json.loads(V.PRONUNCIATION_JSON.read_text(encoding="utf-8"))
LEX = V.Lexicon(LEXDATA)
FORMS = V.Forms(LESSONS)
SHA = "a" * 64
VOICE = {"id": "v123", "name": "Suara Uji", "model": "eleven_v3"}


def run_check(m, ls, lx, cp=None):
    return V.check(m, ls, LIBRARY, lex=V.Lexicon(lx), compose=COMPOSE if cp is None else cp)


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
LAM3 = "al-fatihah:1:w3:compose:3"  # "huruf lam (ل)": the bare lam of the frame's ٱلرَّحْمَٰن


def compose_say(loc, k, text):
    """A composition's k-th `say` changed in the content (the narration then lags behind it)."""
    def f(_m, _l, _x, cp):
        cp["al-fatihah"]["words"][loc]["lines"][k - 1]["say"] = text
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


# (name, mutation(manifests, lessons, pronunciation data), substring the failure message must contain)
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
    ("heavy-letter term spoken from Arabic", replace_in("al-fatihah:1:w2:compose:2", "text", "mudhof ilaih", "مُضَاف إِلَيْه"),
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
    ("compose line past the frames' says", add("al-fatihah:1:w2:compose:3", "Lagi."),
     "unexpected line al-fatihah:1:w2:compose:3"),
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
]


class NarrationValidation(unittest.TestCase):
    def test_unmutated_passes(self):
        self.assertEqual(run_check(copy.deepcopy(MANIFESTS), copy.deepcopy(LESSONS), copy.deepcopy(LEXDATA)), [])

    def test_build_is_deterministic(self):
        self.assertEqual(B.build_lines(LESSONS, LIBRARY, LEX), B.build_lines(LESSONS, LIBRARY, LEX))

    def test_compose_lines_follow_the_frames(self):
        lines = B.build_lines(LESSONS, LIBRARY, LEX, COMPOSE)["al-fatihah"]
        ids = [lid for lid in lines if lid.startswith("al-fatihah:1:")]
        # recite → the primer → each word: its gloss line, then its frames' lines (rule 14)
        self.assertEqual(ids[1:3], ["al-fatihah:1:recite", "al-fatihah:1:primer:1"])
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
                mutate(m, ls, lx, cp)
                errs = run_check(m, ls, lx, cp)
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
        self.assertEqual(V.line_view(a, "next"), ([], None))
        self.assertEqual(V.line_view(None, "start"), ([], None))


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
                # the upload it prints is the delivery directory, never the masters
                self.assertIn(f"scp -r {(root / 'out').resolve() / 'delivery' / 'suara-uji'} ", said.getvalue())
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
            d = E.deliver(master, text, voice, "shared", toks, root)
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
            # A damaged delivered file: made again while its master is here, a failure once it is not.
            whole = d.path.read_bytes()
            for damaged in (whole[: len(whole) // 2], b"", b"not an mp3" * 50):
                d.path.write_bytes(damaged)
                self.assertIsNone(E.standing(line, voice, "shared", root))
                self.assertEqual(settle(write=False)[0], "encoded")
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
    width = max(len(n) for n, _, _ in MUTATIONS)
    failed = 0
    base = run_check(copy.deepcopy(MANIFESTS), copy.deepcopy(LESSONS), copy.deepcopy(LEXDATA))
    print(f"{'unmutated copies':{width}s}  {'PASS' if not base else 'FAIL'}" + (f"  {base[:3]}" if base else ""))
    failed += bool(base)
    for name, mutate, expect in MUTATIONS:
        m, ls, lx, cp = copy.deepcopy(MANIFESTS), copy.deepcopy(LESSONS), copy.deepcopy(LEXDATA), copy.deepcopy(COMPOSE)
        mutate(m, ls, lx, cp)
        errs = run_check(m, ls, lx, cp)
        hit = next((e for e in errs if expect in e), None)
        failed += hit is None
        print(f"{name:{width}s}  {'caught' if hit else 'MISSED'}  {hit or errs[:2]}")
    suite = unittest.TestSuite()
    loader = unittest.defaultTestLoader
    for cls in (NarrationValidation, Dictionary, WordPlaces, SpeechAndRender):
        suite.addTests(loader.loadTestsFromTestCase(cls))
    res = unittest.TextTestRunner(verbosity=1, stream=sys.stdout).run(suite)
    print(f"\n{len(MUTATIONS)} planted faults, {len(MUTATIONS) - failed + bool(base)} caught"
          if not base else "\nunmutated copies fail")
    return 1 if failed or not res.wasSuccessful() else 0


if __name__ == "__main__":
    sys.exit(main())
