#!/usr/bin/env python3
"""Mutation tests for validate_narration.py: each case plants one fault in a copy of the narration
manifests (content/narration/*.json), of the lessons they are built from or of the pronunciation
dictionary (authored/pronunciation.json), and asserts that the validator fails with the expected
message. The unmutated copies must pass. Also unit-tests the speech text, the dictionary rendering
(spoken text, caption, karaoke tokens), the Indonesian numbers and the render request body (no
network). Standard library only; run from belajar/pipeline after build_narration.py:

    python3 test_validate_narration.py          # table of faults and the message that caught each
    python3 -m unittest test_validate_narration # the same as a unittest run
"""
from __future__ import annotations

import copy
import json
import sys
import unittest

import build_narration as B
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


def good_audio(m, lid, text=None):
    text = text if text is not None else line(m, lid)["text"]
    return {"url": f"/belajar/media/narration/suara-uji/{name_of(lid)}/{V.audio_name(text, VOICE['id'])}.mp3",
            "ms": len(text) * 50 + 500, "sha256": SHA}


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
    ("a primer line with a heavy letter + a (mushaf)", append_text("al-fatihah:1:primer:1", " Lihat mushaf."),
     "a heavy letter + a with no approved respelling (rule 9), in a line written to be rendered"),
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
