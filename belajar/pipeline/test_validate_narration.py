#!/usr/bin/env python3
"""Mutation tests for validate_narration.py: each case plants one fault in a copy of the narration
manifests (content/narration/*.json) or of the lessons they are built from, and asserts that the
validator fails with the expected message. The unmutated copies must pass. Also unit-tests the
speech text, the Indonesian numbers and the render request body (no network). Standard library
only; run from belajar/pipeline after build_narration.py:

    python3 test_validate_narration.py          # table of faults and the message that caught each
    python3 -m unittest test_validate_narration # the same as a unittest run
"""
from __future__ import annotations

import copy
import sys
import unittest

import build_narration as B
import render_narration as R
import validate_narration as V

MANIFESTS, LESSONS, LIBRARY = V.load_all()
SHA = "a" * 64


def line(m, lid):
    name = "shared" if lid.startswith("shared:") else lid.split(":")[0]
    return m[name]["lines"][lid]


def set_text(lid, text):
    def f(m, _l):
        line(m, lid)["text"] = text
    return f


def append_text(lid, extra):
    def f(m, _l):
        line(m, lid)["text"] += extra
    return f


def drop(lid):
    def f(m, _l):
        name = lid.split(":")[0]
        del m[name]["lines"][lid]
    return f


def add(lid, text):
    def f(m, _l):
        name = "shared" if lid.startswith("shared:") else lid.split(":")[0]
        m[name]["lines"][lid] = {"text": text}
    return f


def with_audio(lid, audio, voice=True):
    def f(m, _l):
        name = "shared" if lid.startswith("shared:") else lid.split(":")[0]
        if voice:
            m[name]["voice"] = {"id": "v123", "name": "Suara Uji", "model": "eleven_v3"}
        line(m, lid)["audio"] = audio
    return f


def good_audio(lid):
    name = lid.split(":")[0]
    return {"url": f"/belajar/media/narration/suara-uji/{name}/{V.media_file(lid)}", "ms": 4200, "sha256": SHA}


def split_without_b(m, _l):
    lines = m["al-fatihah"]["lines"]
    text = lines.pop("al-fatihah:2:recap")["text"]
    lines["al-fatihah:2:recap:a"] = {"text": text}


def gloss_changed(_m, lessons):
    lessons["al-fatihah"]["ayat"][0]["words"][0]["gloss"] = "atas nama"


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


W = "al-fatihah:2:w1"
NA_EX = non_applicable_exercise()

# (name, mutation(manifests, lessons), substring the failure message must contain)
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
    ("bare Allah outside a quote or honorific", set_text("shared:correct", "Benar, Allah Maha Tahu."), "Qur'anic word 'Allah'"),
    ("lam not naming the letter", append_text("al-ikhlas:3:w2", " Lam meniadakan."), "Qur'anic word 'Lam'"),
    ("surah name without 'Surah'", append_text(W, " Seperti di An-Nas."), "Qur'anic word 'An-Nas'"),
    ("transliteration diacritic", append_text(W, " Ini ḥamd."), "transliteration diacritic"),
    ("a word of another ayah by its place", append_text("al-fatihah:3:w1", " Lihat kata kedua di ayat dua."),
     "names a word of another ayah by its place"),
    ("a place inside a place", append_text(W, " Seperti kata kedua dalam kata ketiga."), "a word place inside another"),
    ("a concept title turned into a place",
     lambda m, _l: line(m, concept_line()).__setitem__("text", "Konsep baru: Kata pertama: menafikan."),
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
    ("concept line missing", lambda m, _l: m["al-fatihah"]["lines"].pop(concept_line()), "missing line"),
    ("exercise the ayah does not show", add(NA_EX, "Latihan."), f"unexpected line {NA_EX}"),
    ("id outside the contract", add("al-fatihah:1:word1", "Kata."), "does not follow the step-id contract"),
    ("shared line missing", lambda m, _l: m["shared"]["lines"].pop("shared:reminder"), "missing line shared:reminder"),
    ("split part without its partner", split_without_b, "split parts of 'al-fatihah:2:recap'"),
    ("audio without a voice", with_audio(W, good_audio(W), voice=False), "names no voice"),
    ("audio url off the media path", with_audio(W, {**good_audio(W), "url": "https://cdn.example.com/a.mp3"}),
     "under /belajar/media/narration/"),
    ("audio ms zero", with_audio(W, {**good_audio(W), "ms": 0}), "ms must be a positive integer"),
    ("audio without sha256", with_audio(W, {"url": good_audio(W)["url"], "ms": 4200}), "exactly {url, ms, sha256}"),
    ("audio file named with colons", with_audio(W, {**good_audio(W), "url": f"/belajar/media/narration/suara-uji/al-fatihah/{W}.mp3"}),
     "is not '/belajar/media/narration/suara-uji/al-fatihah/al-fatihah__2__w1.mp3'"),
    ("voice model not the house standard",
     lambda m, _l: m["al-fatihah"].__setitem__("voice", {"id": "v", "name": "n", "model": "eleven_v4"}),
     "not the house standard"),
    ("hand-edited line", set_text(W, "Kata pertama artinya “segala puji”. Akhirnya dhammah."), "out of date"),
    ("content changed, narration stale", gloss_changed, "does not give the gloss"),
    ("intro without the translation", set_text("al-fatihah:3:intro", "Ayat ketiga Surah Al-Fatihah."),
     "does not read the translation"),
]


class NarrationValidation(unittest.TestCase):
    def test_unmutated_passes(self):
        self.assertEqual(V.check(copy.deepcopy(MANIFESTS), copy.deepcopy(LESSONS), LIBRARY), [])

    def test_build_is_deterministic(self):
        self.assertEqual(B.build_texts(LESSONS, LIBRARY), B.build_texts(LESSONS, LIBRARY))

    def test_mutations_fail(self):
        for name, mutate, expect in MUTATIONS:
            with self.subTest(name):
                m, ls = copy.deepcopy(MANIFESTS), copy.deepcopy(LESSONS)
                mutate(m, ls)
                errs = V.check(m, ls, LIBRARY)
                self.assertTrue(any(expect in e for e in errs), f"{name}: expected {expect!r} in {errs[:5]}")

    def test_allowed_exceptions_pass(self):
        forms = V.Forms(LESSONS)
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
                self.assertEqual(V.check_text("t", text, forms), [])


class WordPlaces(unittest.TestCase):
    def test_word_places(self):
        self.assertEqual(V.word_places("Kata pertama artinya “x”; kata ketiga dan keempat, lalu kata kedua sampai keempat."),
                         [1, 3, 4, 2])
        self.assertEqual(V.word_places("Kata kedua di ayat dua; kata ini; sifat keempat."), [])
        self.assertEqual(V.word_places("kata kedua belas"), [12])


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
        self.assertEqual(t, "Kata kedua artinya bagi Alloh. Akhirnya kasrah karena kata ini, nama, didahului huruf jar.")
        # An ellipsis is an open phrase, not a full stop; an open prefix is read without its hyphen.
        self.assertEqual(B.tts_text("bentuk mubalaghah (“yang banyak …”) dari isim fa'il."),
                         "bentuk mubalaghah, yang banyak, dari isim fa'il.")
        self.assertEqual(B.tts_text("Fi'il majhul (kata kerja pasif: berawalan “di-”). Lalu."),
                         "Fi'il majhul, kata kerja pasif: berawalan di. Lalu.")
        self.assertNotRegex(B.tts_text("Isim fa'il (kata pelaku: “yang...”)."), r"[()“”]")

    def test_render_request_uses_house_settings(self):
        body = R.request_body("Benar.")
        self.assertEqual(body["model_id"], "eleven_v3")
        self.assertEqual(body["apply_text_normalization"], "off")
        self.assertEqual(body["voice_settings"],
                         {"stability": 0.5, "style": 0.35, "similarity_boost": 0.75, "use_speaker_boost": True})
        self.assertNotIn("previous_text", body)
        self.assertNotIn("next_text", body)

    def test_sanitiser_names_places(self):
        san = B.Sanitiser(LESSONS)
        # a word of the ayah, the line's own word, a word of another ayah, a run of words
        self.assertEqual(san.prose("Mudhaf ilaih bagi māliki.", 1, 4, 2), "Mudhaf ilaih bagi kata pertama.")
        self.assertEqual(san.prose("Min adalah huruf jar.", 113, 2, 1), "Kata ini adalah huruf jar.")
        # a word of ANOTHER ayah: by its meaning (only this ayah's words are numbered on screen)
        self.assertEqual(san.prose("Badal dari aṣ-ṣirāṭa di ayat 6.", 1, 7, 1),
                         "Badal dari kata yang berarti “jalan” di ayat enam.")
        self.assertEqual(san.prose("Sifat bagi lafaz Allah di ayat 2.", 1, 3),
                         "Sifat bagi lafaz “Allah” di ayat dua.")
        self.assertEqual(san.prose("Bergantung pada a‘ūżu (“aku berlindung”).", 113, 3),
                         "Bergantung pada kata yang berarti “aku berlindung” di ayat satu.")
        self.assertEqual(san.prose("Seperti khalaqa.", 1, 7), "Seperti kata yang berarti “Dia ciptakan”.")
        # the front of ‘alaihim, and a title that is only the particle
        self.assertEqual(san.prose("‘Alā adalah huruf jar.", 1, 7, 4),
                         "Bagian depan kata ini adalah huruf jar yang berarti “atas”.")
        self.assertEqual(san.prose("Lam: menafikan dan menjazmkan fi'il mudhari'", 112, 3),
                         "Huruf yang menafikan dan menjazmkan fi'il mudhari'")
        self.assertEqual(san.prose("Kalimat huwa Allāhu aḥadun.", 112, 1), "Kalimat kata kedua sampai keempat.")
        self.assertEqual(san.prose("Disambung dengan wa.", 1, 5), "Disambung dengan wawu.")


def main() -> int:
    width = max(len(n) for n, _, _ in MUTATIONS)
    failed = 0
    base = V.check(copy.deepcopy(MANIFESTS), copy.deepcopy(LESSONS), LIBRARY)
    print(f"{'unmutated copies':{width}s}  {'PASS' if not base else 'FAIL'}" + (f"  {base[:3]}" if base else ""))
    failed += bool(base)
    for name, mutate, expect in MUTATIONS:
        m, ls = copy.deepcopy(MANIFESTS), copy.deepcopy(LESSONS)
        mutate(m, ls)
        errs = V.check(m, ls, LIBRARY)
        hit = next((e for e in errs if expect in e), None)
        failed += hit is None
        print(f"{name:{width}s}  {'caught' if hit else 'MISSED'}  {hit or errs[:2]}")
    suite = unittest.TestSuite()
    loader = unittest.defaultTestLoader
    for cls in (NarrationValidation, WordPlaces, SpeechAndRender):
        suite.addTests(loader.loadTestsFromTestCase(cls))
    res = unittest.TextTestRunner(verbosity=1, stream=sys.stdout).run(suite)
    print(f"\n{len(MUTATIONS)} planted faults, {len(MUTATIONS) - failed + bool(base)} caught"
          if not base else "\nunmutated copies fail")
    return 1 if failed or not res.wasSuccessful() else 0


if __name__ == "__main__":
    sys.exit(main())
