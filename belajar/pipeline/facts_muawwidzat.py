#!/usr/bin/env python3
"""Encyclopedia ("Tahukah kamu?") facts and hadith records for Al-Mu'awwidzat (QS 112, 113, 114).

    python3 facts_muawwidzat.py --corpus /path/to/api/data          # write the six files below
    python3 facts_muawwidzat.py --corpus /path/to/api/data --check  # recompute, compare, write nothing

Writes (all read by build_surah.py; keys starting with "_" are pipeline-only and never shipped):
    authored/{al-ikhlas,al-falaq,an-nas}.facts.generated.json   {"facts": [schema.ts Fact, ...]}
    authored/{al-ikhlas,al-falaq,an-nas}.hadith.json            {"hadith": [schema.ts Hadith, ...]}

Facts
  Every count and location list is derived here from the pinned Tanzil Uthmani 1.1 text and QAC 0.4
  (both verified by sha256 against sources.json); no figure is typed. Tanzil prepends the basmalah to
  ayah 1 of 112-114; it is removed (facts.Corpus, normalised comparison with 1:1) because QAC 0.4
  numbers the words without it. Qur'anic Arabic quoted in a fact is a «…» slice of space-separated
  Tanzil tokens (never typed); search keys are the normalised lesson tokens themselves.
  Facts that rest on a kitab quote it by volume/page (printed pagination, checked on Shamela page
  titles); facts that rest on a hadith cite the hadith record written to <slug>.hadith.json.
  `self_check()` recomputes every figure a second way (raw QAC lines; regex over the normalised verse
  text; Tanzil token search cross-checked against QAC lemmas, which also lists homographs) and the
  run fails if any figure or any output rule disagrees.

Hadith
  Records are found by searching the platform corpus (api/data/*.json; harakat stripped, see
  HADITH_NORM_RULE). `ar` is the corpus record's `ar` byte for byte; `id` (Indonesian) is the
  corpus `id` field verbatim and exists only for Sahih Muslim; `_en` keeps the corpus English. No
  translation is written here. Numbering is sunnah.com's:
    Bukhari  corpus hadithnumber = sunnah.com number;
    Muslim   corpus hadithnumber is fawazahmed0's sequence; mapped through fawazahmed0
             editions/ara-muslim/sections/{6,39}.json `arabicnumber` (811.01 -> 811a, the rule of
             api/src/api/scripts/download_hadith.py), after checking the Arabic is byte-identical;
    Riyad    corpus hadithnumber is AhmedBaset idInBook; mapped with the rule of
             api/src/api/scripts/migrate_hadith_citations.py (chapter 0: n - 1217, else n + 679),
             chapterId read from AhmedBaset's riyad_assalihin.json and checked equal to `book`.
  Grades: the corpus `grades` field is empty for every record used. Bukhari/Muslim records carry the
  collection's grade; Riyad as-Salihin records carry the grade an-Nawawi quotes at the end of the
  record (checked to be present in the record text).
  schema.ts Hadith requires `id`; records without a corpus Indonesian translation (Bukhari, Riyad)
  are therefore written under "_needs_indonesian" (never shipped) and cited by the facts through
  their SourceRefs, until a sourced Indonesian translation exists.
  Record sha256 = sha256 of json.dumps(record, ensure_ascii=False, sort_keys=True,
  separators=(",", ":")) in UTF-8; the corpus file sha256 values are recorded too.

There is no human review step (plan L11): every record has status "draft" as pipeline state, and no
text here promises a review. Python 3 standard library only; no LLM, no paid API. Network is used
only to fetch the three pinned mapping files when they are missing from cache/.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path

from common import (ARABIC_RUN, CACHE, NORMALISATION_RULE, PIPELINE, Segment, bw_to_ar, load_qac, load_sources,
                    load_tanzil, normalise, require_pinned, root_letters, sha256_file, stem_of)
from facts import BA, FA, LAM, QAC_TANZIL_HEADER, WAW, Corpus, fmt, kali, prefix_phrase, refs_text, uniq_refs

AUTHORED = PIPELINE / "authored"
SURAHS = {112: "al-ikhlas", 113: "al-falaq", 114: "an-nas"}
ALL3 = tuple(SURAHS.values())
PAIR = ("al-falaq", "an-nas")

# The basis note validate.py looks for (QAC_BASIS_RE); main() byte-checks the QAC words of 112-114.
QAC_BASIS = ("QAC 0.4 (disusun di atas teks Tanzil Uthmani 1.0.2; surah 112, 113 dan 114 identik byte-per-byte "
             "dengan 1.1 yang dipakai)")
QAC_BASIS_RE = re.compile(r"QAC 0\.4 \(disusun di atas teks Tanzil Uthmani 1\.0\.2; surah (\d+(?:(?:, | dan )\d+)*) "
                          r"identik byte-per-byte dengan 1\.1 yang dipakai\)")

# Indonesian surah names used in prose (pesantren spelling, as in the Al-Fatihah facts).
NAME = {1: "Al-Fatihah", 59: "Al-Hasyr", 72: "Al-Jinn", 109: "Al-Kafirun", 112: "Al-Ikhlas", 113: "Al-Falaq",
        114: "An-Nas"}
NUM_WORD = {2: "dua", 3: "tiga", 4: "empat", 5: "lima", 6: "enam", 7: "tujuh"}

# ---------------------------------------------------------------- kitab references (verified pages)
AD_DANI = "Abu 'Amr ad-Dani, al-Bayan fi 'Add Ay al-Qur'an"
# ad-Dani, al-Bayan, read on Shamela 5542 (page title = printed page). Figures are for COMPARISON with the
# recomputed ones only; the prose that reports ad-Dani's view is attributed to him, never counted here.
DANI = {
    112: {"page": 296, "sid": 278, "heading": "Surat ash-Shamad", "words": 15, "kufi": 4,
          "other": ("Makkah dan Syam", 5), "diff": (3, 0, 2),  # 112:3 tokens [0:2] closes an ayah there
          "makki": ["Mujahid", "'Atha'", "Qatadah"], "madani": ["Ibnu 'Abbas"]},
    113: {"page": 297, "sid": 279, "heading": "Surat al-Falaq", "words": 23, "kufi": 5, "other": None,
          "diff": None, "makki": ["Qatadah"], "madani": ["Ibnu 'Abbas", "Mujahid", "'Atha'"]},
    114: {"page": 298, "sid": 280, "heading": "Surat an-Nas", "words": 20, "kufi": 6,
          "other": ("Makkah dan Syam", 7), "diff": (4, 2, 3),  # 114:4 token [2:3]
          "makki": ["Qatadah"], "madani": ["Ibnu 'Abbas", "Mujahid", "'Atha'"]},
}

IBN_KATSIR = "Ibnu Katsir, Tafsir al-Qur'an al-'Azhim (tahqiq Sami as-Salamah, Dar Thayyibah)"
# (volume, printed page, Shamela 8473 page id, ayah of the platform-corpus record, normalised phrase
# that must occur in that corpus record). Page = Shamela page title "ج8 - صNNN", checked 2026-10-09.
IK = {
    "ahad": (8, "527–528", 4573, (112, 1), "الذي لا نظير له"),
    "samad": (8, "528", 4574, (112, 2), "يصمد اليه الخلايق"),
    "falaq": (8, "535", 4581, (113, 1), "الفلق الصبح"),
    "falaq-6-96": (8, "535", 4581, (113, 1), "فالق الاصباح"),
    "falaq-sawab": (8, "535", 4581, (113, 1), "والصواب القول الاول"),
    "ghasiq": (8, "535", 4581, (113, 3), "غاسق الليل اذا وقب غروب الشمس"),
    # the other views the gasiq fact mentions (az-Zuhri: the sun setting; a star; the moon) are on p. 536
    "ghasiq-lain": (8, "536", 4582, (113, 3), "وقال الزهري ومن شر غاسق اذا وقب الشمس اذا غربت"),
    "tirmidzi-hasan": (8, "534", 4580, (113, 1), "اخذ بهما وترك ما سواهما"),
    "three": (8, "539", 4585, (114, 1), "هذه ثلاث صفات من صفات الرب"),
    "khannas": (8, "540", 4586, (114, 4), "جاثم علي قلب ابن ادم فاذا سها وغفل وسوس فاذا ذكر الله خنس"),
}

DARWISY = "Muhyiddin Darwisy, I'rab al-Qur'an wa Bayanuh (cet. 4, 1415 H)"
DARWISY_MALIK = {"kitab": DARWISY, "ref": "jil. 1, hlm. 14 (bagian al-I'rab QS 1:4: mālik dari milk, malik dari mulk)",
                 "url": "https://shamela.ws/book/2163/11"}

TANZIL_META_URL = "https://tanzil.net/docs/quran_metadata"

# ---------------------------------------------------------------- hadith inputs
MAPPING_FILES = {
    "muslim-6": ("fawazahmed0/ara-muslim-sections-6.json",
                 "https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/ara-muslim/sections/6.json",
                 "1814326c0fefd9ed123a5e8ee55e6e4eef8dd303775c2028d95d8fef921666f1"),
    # jsDelivr refuses section 39 ("Package size exceeded"); GitHub raw serves the same repository file.
    "muslim-39": ("fawazahmed0/ara-muslim-sections-39.json",
                  "https://raw.githubusercontent.com/fawazahmed0/hadith-api/1/editions/ara-muslim/sections/39.json",
                  "a0e4d44329e0ae3b4b3b29b67dcc3aff430364ab6f1b6b2940cd7252f563f4a3"),
    "riyad": ("ahmedbaset/riyad_assalihin.json",
              "https://cdn.jsdelivr.net/gh/AhmedBaset/hadith-json@main/db/by_book/other_books/riyad_assalihin.json",
              "180171247ed9462c05164c80c4f938bd30936bfaf848125595be0b86361d7b75"),
}
CORPUS_FILES = {"bukhari": "bukhari.json", "muslim": "muslim.json", "riyad-as-salihin": "riyad-as-salihin.json",
                "tafsir-ibn-kathir": "tafsir-ibn-kathir.json"}

HADITH_NORM_RULE = ("harakat, tanwin, tatweel, alif kecil (U+0670), tanda Qur'ani dan tanda arah teks (U+200C–U+200F) "
                    "dibuang; tanda baca diganti spasi; أ إ آ ٱ → ا, ى → ي, ة → ه, ؤ → و, ئ → ي; spasi dirapatkan")
_HSTRIP = re.compile("[ؐ-ؚـً-ٰٟۖ-ۭ‌-‏‪-‮]")
_HFOLD = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ى": "ي", "ة": "ه", "ؤ": "و", "ئ": "ي"})


def hnorm(s: str) -> str:
    """Search key for hadith/tafsir text (never displayed)."""
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", _HSTRIP.sub("", s).translate(_HFOLD))).strip()


GRADE_COLLECTION = {
    "bukhari": "Shahih (termuat dalam Sahih al-Bukhari; kolom grades di korpus kosong)",
    "muslim": "Shahih (termuat dalam Sahih Muslim; kolom grades di korpus kosong)",
}
COLL_KITAB = {"bukhari": "Sahih al-Bukhari", "muslim": "Sahih Muslim", "riyad-as-salihin": "an-Nawawi, Riyad as-Salihin"}
COLL_URL = {"bukhari": "https://sunnah.com/bukhari:{n}", "muslim": "https://sunnah.com/muslim:{n}",
            "riyad-as-salihin": "https://sunnah.com/riyadussalihin:{n}"}
COLL_PROSE = {"bukhari": "Shahih al-Bukhari", "muslim": "Shahih Muslim", "riyad-as-salihin": "Riyadhush Shalihin"}

# Each hadith: corpus file, the corpus hadithnumber, the canonical number it must map to, and the
# normalised phrases (hadith words, or "Q:s:a" = the normalised Tanzil text of that lesson ayah) that the
# record must contain. Riyad records also name the grade words an-Nawawi gives at the end of the record.
HADITH_SPEC = [
    {"key": "bukhari-5013", "coll": "bukhari", "hn": 5013, "canon": "5013", "slugs": ("al-ikhlas",),
     "find": ["Q:112:1", "تعدل ثلث القران"], "topic": "Al-Ikhlas setara dengan sepertiga Al-Qur'an"},
    {"key": "muslim-811a", "coll": "muslim", "hn": 1886, "canon": "811a", "slugs": ("al-ikhlas",),
     "find": ["Q:112:1", "تعدل ثلث القران", "ايعجز احدكم"], "topic": "Al-Ikhlas setara dengan sepertiga Al-Qur'an"},
    {"key": "muslim-812a", "coll": "muslim", "hn": 1888, "canon": "812a", "slugs": ("al-ikhlas",),
     "find": ["Q:112:1", "تعدل ثلث القران", "احشدوا"], "topic": "Al-Ikhlas setara dengan sepertiga Al-Qur'an"},
    {"key": "bukhari-7375", "coll": "bukhari", "hn": 7375, "canon": "7375", "slugs": ("al-ikhlas",),
     "find": ["Q:112:1", "صفه الرحمن", "اخبروه ان الله يحبه"], "topic": "sahabat yang mencintai Al-Ikhlas"},
    {"key": "muslim-813", "coll": "muslim", "hn": 1890, "canon": "813", "slugs": ("al-ikhlas",),
     "find": ["Q:112:1", "صفه الرحمن", "اخبروه ان الله يحبه"], "topic": "sahabat yang mencintai Al-Ikhlas"},
    {"key": "riyad-1013", "coll": "riyad-as-salihin", "hn": 334, "canon": "1013", "slugs": ("al-ikhlas",),
     "find": ["Q:112:1", "ان حبها ادخلك الجنه"], "grade_words": ["رواه الترمذي وقال حديث حسن", "تعليقا"],
     "grade": "Hasan menurut at-Tirmidzi; al-Bukhari meriwayatkannya secara ta'liq (keduanya disebut an-Nawawi "
              "di akhir hadits)",
     "topic": "sahabat yang mencintai Al-Ikhlas"},
    {"key": "bukhari-4974", "coll": "bukhari", "hn": 4974, "canon": "4974", "slugs": ("al-ikhlas",),
     "find": ["وانا الاحد الصمد لم الد ولم اولد"], "topic": "hadits qudsi yang menggemakan Al-Ikhlas"},
    {"key": "muslim-726", "coll": "muslim", "hn": 1690, "canon": "726", "slugs": ("al-ikhlas",),
     "find": ["قرا في ركعتي الفجر", "Q:112:1"], "topic": "Al-Kafirun dan Al-Ikhlas di dua rakaat fajar"},
    {"key": "bukhari-5017", "coll": "bukhari", "hn": 5017, "canon": "5017", "slugs": ALL3,
     "find": ["اذا اوي الي فراشه", "Q:112:1", "Q:113:1", "Q:114:1"], "topic": "dibaca sebelum tidur"},
    {"key": "bukhari-5748", "coll": "bukhari", "hn": 5748, "canon": "5748", "slugs": ALL3,
     "find": ["اذا اوي الي فراشه", "Q:112:1", "وبالمعوذتين"], "topic": "dibaca sebelum tidur"},
    {"key": "riyad-1456", "coll": "riyad-as-salihin", "hn": 777, "canon": "1456", "slugs": ALL3,
     "find": ["Q:112:1", "والمعوذتين حين تمسي وحين تصبح ثلاث مرات"],
     "grade_words": ["رواه ابو داود والترمذي وقال حديث حسن صحيح"],
     "grade": "Hasan shahih menurut at-Tirmidzi; diriwayatkan Abu Dawud dan at-Tirmidzi (disebut an-Nawawi di "
              "akhir hadits)",
     "topic": "dibaca pagi dan petang"},
    {"key": "muslim-814a", "coll": "muslim", "hn": 1891, "canon": "814a", "slugs": PAIR,
     "find": ["لم ير مثلهن قط", "Q:113:1", "Q:114:1"], "topic": "ayat yang belum pernah terlihat semisalnya"},
    {"key": "muslim-814b", "coll": "muslim", "hn": 1892, "canon": "814b", "slugs": PAIR,
     "find": ["لم ير مثلهن قط المعوذتين"], "topic": "ayat yang belum pernah terlihat semisalnya"},
    {"key": "bukhari-5016", "coll": "bukhari", "hn": 5016, "canon": "5016", "slugs": PAIR,
     "find": ["يقرا علي نفسه بالمعوذات", "رجاء بركتها"], "topic": "dibaca saat sakit"},
    {"key": "muslim-2192a", "coll": "muslim", "hn": 5714, "canon": "2192a", "slugs": PAIR,
     "find": ["اذا مرض احد من اهله نفث عليه بالمعوذات"], "topic": "dibaca saat sakit"},
    {"key": "riyad-1015", "coll": "riyad-as-salihin", "hn": 336, "canon": "1015", "slugs": PAIR,
     "find": ["حتي نزلت المعوذتان"], "grade_words": ["رواه الترمذي وقال حديث حسن"],
     "grade": "Hasan menurut at-Tirmidzi (disebut an-Nawawi di akhir hadits)",
     "topic": "setelah al-mu‘awwiżatain turun"},
]
# Found in the corpus and deliberately not used (reported, never shipped).
HADITH_NOT_USED = [
    {"coll": "bukhari", "hn": 774, "find": ["حبك اياها ادخلك الجنه"], "slugs": ("al-ikhlas",),
     "why": "mu'allaq (dibuka «وقال عبيد الله» tanpa sanad bersambung dari al-Bukhari); kisah yang sama dipakai "
            "lewat Riyad as-Salihin 1013, yang menyebut penilaian at-Tirmidzi"},
    {"coll": "bukhari", "hn": 4977, "find": ["يا ابا المنذر ان اخاك ابن مسعود يقول كذا وكذا"], "slugs": PAIR,
     "why": "pertanyaan tentang pendapat Ibnu Mas'ud mengenai al-mu‘awwiżatain; matannya tidak menyebut "
            "pendapat itu ('kadza wa kadza') dan butuh penjelasan ulama; tidak cocok untuk kartu singkat"},
    {"coll": "bukhari", "hn": 5763, "find": ["لبيد بن الاعصم"], "slugs": PAIR,
     "why": "kisah sihir Labid bin al-A'sham: matan di korpus tidak menyebut turunnya Al-Falaq/An-Nas, jadi "
            "tidak dipakai sebagai sebab turun"},
]


def record_sha(rec: dict) -> str:
    return hashlib.sha256(json.dumps(rec, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
                          .encode("utf-8")).hexdigest()


def muslim_letter(arabicnumber: str) -> str:
    """fawazahmed0 arabicnumber -> sunnah.com display (download_hadith._muslim_canonical_citation)."""
    if "." not in arabicnumber:
        return arabicnumber
    head, _, tail = arabicnumber.partition(".")
    sub = int(tail)
    if sub == 0:
        return head
    if 1 <= sub <= 26:
        return head + chr(ord("a") + sub - 1)
    return f"{head}.{sub:02d}"


def riyad_canonical(chapter_id: int, id_in_book: int) -> int:
    """migrate_hadith_citations._riyad_canonical."""
    return id_in_book - 1217 if chapter_id == 0 else id_in_book + 679


def pinned_cache_file(key: str) -> Path:
    rel, url, sha = MAPPING_FILES[key]
    p = CACHE / rel
    if not p.exists():
        p.parent.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(url, headers={"User-Agent": "dakwah-lens-belajar-pipeline"})
        with urllib.request.urlopen(req, timeout=120) as r:
            p.write_bytes(r.read())
    got = sha256_file(p)
    if got != sha:
        raise SystemExit(f"[{key}] sha256 mismatch for {p}: pinned {sha}, got {got}")
    return p


# ---------------------------------------------------------------- Qur'an data
class Data:
    """Pinned Tanzil + QAC (via facts.Corpus), with the lesson tokens of every ayah (heading removed)."""

    def __init__(self, src: dict):
        tz_path = require_pinned(src, "tanzil_uthmani")
        qac_path = require_pinned(src, "qac_morphology")
        meta_path = require_pinned(src, "tanzil_metadata")
        self.T = load_tanzil(tz_path)
        segs, header = load_qac(qac_path)
        if QAC_TANZIL_HEADER not in header:
            raise SystemExit(f"QAC header no longer names {QAC_TANZIL_HEADER!r}; the basis note would be wrong")
        self.tz_sha, self.qac_sha, self.meta_sha = sha256_file(tz_path), sha256_file(qac_path), sha256_file(meta_path)
        self.C = Corpus(self.T, segs, self.tz_sha, self.qac_sha)
        self.qac_lines = [ln.rstrip("\r") for ln in qac_path.read_text(encoding="utf-8").split("\n")
                          if ln.startswith("(")]
        self.VT = {(s, a): toks for s, a, toks, _ in self.C.verses}
        self.VN = {(s, a): norm for s, a, _, norm in self.C.verses}
        self.meta = {int(e.get("index")): e.attrib for e in ET.parse(meta_path).getroot().iter("sura")}
        self.ayat = {s: sorted(a for (ss, a) in self.VT if ss == s) for s in SURAHS}
        self.check_basis()

    # QAC basis note: the words of 112-114 in QAC 0.4 are the Tanzil 1.1 lesson tokens byte for byte.
    def check_basis(self) -> None:
        for s in SURAHS:
            if s not in self.C.headings or s in self.C.heading_byte_variants:
                raise SystemExit(f"surah {s}: Tanzil heading basmalah not found byte-identical to 1:1")
            for a in self.ayat[s]:
                toks = self.VT[(s, a)]
                n_qac = max(w for (ss, aa, w) in self.C.words if (ss, aa) == (s, a))
                if n_qac != len(toks):
                    raise SystemExit(f"{s}:{a}: QAC has {n_qac} words, Tanzil {len(toks)}")
                for w, t in enumerate(toks, 1):
                    q = "".join(bw_to_ar(g.form) for g in self.C.words[(s, a, w)])
                    if q != t:
                        raise SystemExit(f"{s}:{a}:{w}: QAC {q!r} != Tanzil {t!r}")

    # ---- tokens and quotes (Tanzil bytes only)
    def tok(self, s: int, a: int, w: int) -> str:
        return self.VT[(s, a)][w - 1]

    def ntok(self, s: int, a: int, w: int) -> str:
        return normalise(self.tok(s, a, w))

    def q(self, s: int, a: int, i: int, j: int) -> str:
        """«…» of tokens [i:j] (0-based) of the lesson ayah s:a: a byte-exact slice of the Tanzil line."""
        return "«" + " ".join(self.VT[(s, a)][i:j]) + "»"

    def ayah_text(self, s: int, a: int) -> str:
        return " ".join(self.VT[(s, a)])

    # ---- QAC
    def stem(self, s: int, a: int, w: int) -> Segment:
        return stem_of(self.C.words[(s, a, w)])

    def lem_hits(self, lem: str, need: tuple[str, ...] = ()) -> list[Segment]:
        return [g for g in self.C.lemma_hits(lem) if all(f in g.flags for f in need)]

    def raw_count(self, **want) -> list[tuple[int, int, int]]:
        """Second method: scan the raw QAC lines (not load_qac) for STEM segments whose feature string
        carries every `key:value` / bare flag given; returns (s, a, w) per segment."""
        out = []
        for ln in self.qac_lines:
            loc, _form, _tag, feats = ln.split("\t")
            parts = feats.split("|")
            if "STEM" not in parts:
                continue
            if all((f"{k}:{v}" in parts) if k not in ("flag", "flags") else all(x in parts for x in v)
                   for k, v in want.items()):
                s, a, w, _ = (int(x) for x in loc.strip("()").split(":"))
                out.append((s, a, w))
        return out

    # ---- phrase search, second method: regex over the normalised verse string
    def regex_hits(self, keys: list[str], prefixes=("",)) -> list[tuple[int, int]]:
        alt = "|".join(re.escape(p) for p in prefixes)
        pat = re.compile(r"(?:^| )(?:" + alt + ")" + re.escape(" ".join(keys)) + r"(?= |$)")
        out = []
        for (s, a), norm in sorted(self.VN.items()):
            out += [(s, a)] * len(pat.findall(" ".join(norm)))
        return out

    def token_xcheck(self, variants: set[str], qac: set[tuple[int, int, int]], lems: set[str]) -> dict:
        """Tanzil tokens whose normalised form is in `variants`, against the QAC word locations `qac` (whose
        lemmas are `lems`). Every QAC location must be found by the token search; any extra token must carry
        another lemma (a homograph), and is listed."""
        tz = {(s, a, w) for (s, a), norm in self.VN.items() for w, t in enumerate(norm, 1) if t in variants}
        extra = sorted(tz - qac)
        homographs = []
        for (s, a, w) in extra:
            st = stem_of(self.C.words[(s, a, w)])
            homographs.append({"loc": f"{s}:{a}:{w}", "token": self.tok(s, a, w), "qac_lem": st.feat.get("LEM"),
                               "qac_root": st.feat.get("ROOT")})
        ok = qac <= tz and all(h["qac_lem"] not in lems for h in homographs)
        return {"qac": len(qac), "tanzil": len(tz), "missing": sorted(qac - tz), "homographs": homographs, "ok": ok}

    def variants(self, s: int, a: int, w: int) -> set[str]:
        """Normalised spellings of a lesson token with/without the article and the prefixes wa-, fa-, bi-,
        li-, ka- (li- + al- = لل)."""
        n = self.ntok(s, a, w)
        core = n[2:] if n.startswith("ال") else n
        base = {core, "ال" + core}
        out = set(base)
        for p in ("و", "ف"):
            out |= {p + x for x in base}
        for p in ("ب", "ك"):
            out |= {p + x for x in base} | {"و" + p + x for x in base} | {"ف" + p + x for x in base}
        out |= {"ل" + core, "لل" + core, "ولل" + core, "فلل" + core}
        return out

    # ---- sources
    def tanzil_src(self, query: str) -> dict:
        return self.C.tanzil_src(query)

    def qac_src(self, query: str) -> dict:
        return self.C.qac_src(query)

    def meta_src(self, s: int) -> dict:
        return {"kitab": "Tanzil Quran metadata (quran-data.xml) 1.0",
                "ref": f"sha256:{self.meta_sha[:16]}; sura index={s}, type={self.meta[s]['type']}",
                "url": TANZIL_META_URL}


def dani_src(s: int) -> dict:
    d = DANI[s]
    return {"kitab": AD_DANI, "ref": f"{d['heading']}, hlm. {d['page']}", "url": f"https://shamela.ws/book/5542/{d['sid']}"}


def ik_src(key: str, what: str) -> dict:
    vol, page, sid, (s, a), _ = IK[key]
    return {"kitab": IBN_KATSIR, "ref": f"jil. {vol}, hlm. {page} (tafsir QS {s}:{a}: {what})",
            "url": f"https://shamela.ws/book/8473/{sid}"}


def fact(fid: str, title: str, body: str, locations: list[str], method: str, sources: list[dict], **extra) -> dict:
    f = {"id": fid, "title": title, "body": body, "locations": sorted_locs(locations), "method": method,
         "sources": sources, "status": "draft"}
    f.update({"_" + k: v for k, v in extra.items()})
    return f


def sorted_locs(locs) -> list[str]:
    return [f"{s}:{a}" for s, a in sorted({tuple(int(x) for x in r.split(":")) for r in locs})]


def surah_refs(D: Data, *surahs: int) -> list[str]:
    """Every ayah of the given surahs (Tanzil line count)."""
    return [f"{s}:{a}" for (s, a) in sorted(D.VT) if s in surahs]


def ayah_range(refs: list[str]) -> str:
    """'113:2–5' for consecutive ayat of one surah, else the list."""
    pairs = [tuple(int(x) for x in r.split(":")) for r in refs]
    if len({s for s, _ in pairs}) == 1 and [a for _, a in pairs] == list(range(pairs[0][1], pairs[-1][1] + 1)) \
            and len(pairs) > 2:
        return f"{pairs[0][0]}:{pairs[0][1]}–{pairs[-1][1]}"
    return refs_text(refs)


# ---------------------------------------------------------------- hadith corpus
class Hadiths:
    def __init__(self, corpus_dir: Path, D: Data):
        self.dir = corpus_dir
        self.D = D
        self.file_sha, self.recs = {}, {}
        for coll, fn in CORPUS_FILES.items():
            p = corpus_dir / fn
            if not p.exists():
                raise SystemExit(f"corpus file missing: {p} (pass --corpus <dakwah-lens>/api/data)")
            self.file_sha[fn] = sha256_file(p)
            self.recs[coll] = json.loads(p.read_text(encoding="utf-8"))
        self.by_hn = {c: {r["hadithnumber"]: r for r in self.recs[c]} for c in ("bukhari", "muslim", "riyad-as-salihin")}
        self.tafsir = {(r["surah"], r["ayah"]): r for r in self.recs["tafsir-ibn-kathir"]}
        self.map_sha, self.muslim_map, self.muslim_text = {}, {}, {}
        for key in ("muslim-6", "muslim-39"):
            p = pinned_cache_file(key)
            self.map_sha[MAPPING_FILES[key][0]] = sha256_file(p)
            for h in json.loads(p.read_text(encoding="utf-8"))["hadiths"]:
                self.muslim_map[h["hadithnumber"]] = h["arabicnumber"]
                self.muslim_text[h["hadithnumber"]] = h["text"]
        p = pinned_cache_file("riyad")
        self.map_sha[MAPPING_FILES["riyad"][0]] = sha256_file(p)
        rj = json.loads(p.read_text(encoding="utf-8"))
        self.riyad_chapter = {int(h["idInBook"]): int(h["chapterId"]) for h in rj["hadiths"]}
        self.riyad_text = {int(h["idInBook"]): h["arabic"] for h in rj["hadiths"]}
        self.records: dict[str, dict] = {}
        self.anomalies: list[str] = []
        for spec in HADITH_SPEC:
            self.records[spec["key"]] = self.build(spec)
        self.not_used = [self.not_used_entry(x) for x in HADITH_NOT_USED]

    def key_of(self, phrase: str) -> str:
        if phrase.startswith("Q:"):
            _, s, a = phrase.split(":")
            return hnorm(self.D.ayah_text(int(s), int(a)))
        return phrase

    def search(self, coll: str, phrases: list[str]) -> list[dict]:
        keys = [self.key_of(p) for p in phrases]
        return [r for r in self.recs[coll] if r.get("ar") and all(k in hnorm(r["ar"]) for k in keys)]

    def canonical(self, coll: str, r: dict) -> tuple[str, str]:
        hn = r["hadithnumber"]
        if coll == "bukhari":
            return str(hn), "Bukhari: nomor korpus = nomor sunnah.com (fawazahmed0 hadithnumber)"
        if coll == "muslim":
            an = self.muslim_map.get(hn)
            if an is None:
                raise SystemExit(f"muslim local {hn}: no fawazahmed0 arabicnumber in the cached sections")
            if self.muslim_text[hn] != r["ar"]:
                raise SystemExit(f"muslim local {hn}: Arabic differs from fawazahmed0; mapping unsafe")
            return muslim_letter(str(an)), (f"Muslim: nomor urut korpus {hn} -> fawazahmed0 arabicnumber {an} -> "
                                            f"{muslim_letter(str(an))} (penomoran Fuad 'Abd al-Baqi, sunnah.com); teks "
                                            f"Arab korpus identik byte-per-byte dengan fawazahmed0")
        chap = self.riyad_chapter[hn]
        if chap != r["book"]:
            raise SystemExit(f"riyad local {hn}: AhmedBaset chapterId {chap} != corpus book {r['book']}")
        if self.riyad_text[hn] != r["ar"]:
            raise SystemExit(f"riyad local {hn}: Arabic differs from AhmedBaset")
        n = riyad_canonical(chap, hn)
        return str(n), (f"Riyad: idInBook korpus {hn}, chapterId {chap} -> {n} (aturan migrate_hadith_citations.py: "
                        f"bab 0 = n - 1217, lainnya n + 679); teks Arab identik dengan AhmedBaset")

    def build(self, spec: dict) -> dict:
        coll, hn = spec["coll"], spec["hn"]
        hits = self.search(coll, spec["find"])
        r = self.by_hn[coll].get(hn)
        if r is None or r not in hits:
            raise SystemExit(f"{spec['key']}: corpus {coll} {hn} not found by its phrases {spec['find']}")
        canon, numbering = self.canonical(coll, r)
        if canon != spec["canon"]:
            raise SystemExit(f"{spec['key']}: maps to {canon}, expected {spec['canon']}")
        if coll == "riyad-as-salihin":
            for gw in spec["grade_words"]:
                if gw not in hnorm(r["ar"]):
                    raise SystemExit(f"{spec['key']}: grade words {gw!r} not in the record")
            grade = spec["grade"]
        else:
            if r.get("grades"):
                raise SystemExit(f"{spec['key']}: corpus grades field is not empty ({r['grades']}); revisit")
            grade = GRADE_COLLECTION[coll]
        if r.get("grades"):
            self.anomalies.append(f"{spec['key']}: grades field {r['grades']!r}")
        citation = f"{r['citation_en'].rsplit(' ', 1)[0]} {canon}"
        rec = {"citation": citation, "ar": r["ar"]}
        if coll == "muslim" and r.get("id"):
            rec["id"] = r["id"]
        rec["grade"] = grade
        rec["provenance"] = {"collection": coll, "point": f"api/data/{CORPUS_FILES[coll]} hadithnumber {hn}",
                             "sha256": record_sha(r)}
        rec["status"] = "draft"
        rec["_en"] = r.get("en", "")
        if coll == "muslim" and r.get("id"):
            rec["_id_label"] = ("api/data/muslim.json kolom 'id', disalin apa adanya (terjemahan internal platform, "
                                "bukan edisi terbitan)")
        rec["_local_citation"] = r["citation_en"]
        rec["_numbering"] = numbering
        rec["_url"] = COLL_URL[coll].format(n=canon)
        rec["_topic"] = spec["topic"]
        rec["_slugs"] = list(spec["slugs"])
        variants = [x["citation_en"] for x in hits if x is not r]
        if variants:
            rec["_variants_in_corpus"] = variants
        en = rec["_en"]
        if coll == "riyad-as-salihin" and en.count('"') % 2:
            self.anomalies.append(f"{citation}: corpus English stops mid-quotation (truncated): {en[-60:]!r}")
        if r["ar"].count('"') % 2:
            # Muslim 813: the Prophet's quoted saying is opened and never closed; the fawazahmed0
            # section file the corpus came from ends the same way. Kept byte for byte (never repaired).
            self.anomalies.append(f"{citation}: corpus Arabic has an odd number of quotation marks; the last quoted "
                                  f"saying is never closed (truncated at the end?), kept byte for byte: "
                                  f"{r['ar'][-60:]!r}")
        return rec

    def not_used_entry(self, x: dict) -> dict:
        r = self.by_hn[x["coll"]][x["hn"]]
        if r not in self.search(x["coll"], x["find"]):
            raise SystemExit(f"not-used entry {x['coll']} {x['hn']} not found by its phrase")
        canon, _ = self.canonical(x["coll"], r)
        return {"citation": f"{r['citation_en'].rsplit(' ', 1)[0]} {canon}", "why": x["why"], "slugs": list(x["slugs"]),
                "variants_in_corpus": [y["citation_en"] for y in self.search(x["coll"], x["find"]) if y is not r]}

    def src(self, key: str) -> dict:
        rec = self.records[key]
        coll = rec["provenance"]["collection"]
        canon = rec["citation"].rsplit(" ", 1)[1]
        hn = rec["provenance"]["point"].rsplit(" ", 1)[1]
        ref = f"no. {canon} (penomoran sunnah.com); korpus platform {CORPUS_FILES[coll]} hadithnumber {hn}, " \
              f"rekaman sha256:{rec['provenance']['sha256'][:16]}"
        if coll == "riyad-as-salihin":
            ref += f"; penilaian: {rec['grade']}"
        return {"kitab": COLL_KITAB[coll], "ref": ref, "url": rec["_url"]}

    def cite(self, key: str) -> str:
        rec = self.records[key]
        coll = rec["provenance"]["collection"]
        return f"{COLL_PROSE[coll]} no. {rec['citation'].rsplit(' ', 1)[1]}"

    def tafsir_has(self, key: str) -> bool:
        _, _, _, (s, a), phrase = IK[key]
        return phrase in hnorm(self.tafsir[(s, a)]["ar"])


# ---------------------------------------------------------------- self-check ledger
class Ledger:
    """Every figure a fact states, next to the same figure obtained a second way."""

    def __init__(self):
        self.rows: list[dict] = []

    def add(self, fid: str, what: str, value, recheck, how: str) -> None:
        ok = value == recheck

        def brief(v):  # long location lists are recorded as count + sha256 (both sides were compared in full)
            if isinstance(v, list) and len(v) > 12:
                return {"n": len(v), "sha256": hashlib.sha256(json.dumps(v).encode()).hexdigest()[:16]}
            return v
        self.rows.append({"fact": fid, "what": what, "value": brief(value), "recheck": brief(recheck), "how": how,
                          "ok": ok})

    def need(self, fid: str, what: str, cond: bool) -> None:
        """A condition the prose depends on (e.g. 'all hits are in 113-114')."""
        self.add(fid, what, bool(cond), True, "syarat kalimat")


def seg_locs(hits) -> list[tuple[int, int, int]]:
    return sorted((g.s, g.a, g.w) for g in hits)


def ayat_of(locs) -> list[str]:
    return uniq_refs((s, a) for s, a, *_ in locs)


def hit_pairs(hits) -> list[tuple[int, int]]:
    return sorted((s, a) for s, a, *_ in hits)


def letters(root: str) -> str:
    return " ".join(root_letters(root))


def count_word(n: int) -> str:
    return {1: "sekali", 2: "dua kali", 3: "tiga kali"}.get(n, f"{n} kali")


HADITH_METHOD = {
    "bukhari": "nomor al-Bukhari = nomor korpus (sama dengan sunnah.com)",
    "muslim": "nomor Muslim dipetakan dari nomor urut korpus ke penomoran Fuad 'Abdul Baqi (sunnah.com) lewat "
              "fawazahmed0, setelah teks Arabnya dicek identik",
    "riyad-as-salihin": "nomor Riyadhush Shalihin dipetakan dari nomor korpus ke penomoran sunnah.com; penilaian "
                        "dikutip apa adanya dari akhir teks an-Nawawi",
}


def hadith_method(H: Hadiths, keys: list[str]) -> str:
    colls = []
    for k in keys:
        c = H.records[k]["provenance"]["collection"]
        if c not in colls:
            colls.append(c)
    # Operator decision 2026-10-10: hadith-based facts keep an Indonesian
    # summary, labelled as AI-assisted (the corpus has no Indonesian for
    # Bukhari/Riyad). Provenance (Arabic bytes, corpus translation, sha256)
    # stays in authored/*.hadith.json; the card shows learner-facing words.
    return ("Makna ringkas hadits, dibantu AI — bukan terjemahan resmi. Isinya dirangkum dari teks Arab hadits "
            "di korpus kitab platform, tanpa menambah makna. "
            + "; ".join(HADITH_METHOD[c] for c in colls) + ".")


# ---------------------------------------------------------------- facts: counts and phrases
def f_ayat_kata(D: Data, L: Ledger, s: int) -> dict:
    per = [len(D.VT[(s, a)]) for a in D.ayat[s]]
    n_ayat, n_words = len(per), sum(per)
    fid = f"{NUM_WORD[n_ayat]}-ayat"
    qac_words = len([k for k in D.C.words if k[0] == s])
    d = DANI[s]
    L.add(fid, "ayat (baris Tanzil)", n_ayat, int(D.meta[s]["ayas"]), "quran-data.xml atribut ayas")
    L.add(fid, "ayat vs ad-Dani (hitungan Kufah)", n_ayat, d["kufi"], "angka ad-Dani hlm. %d" % d["page"])
    L.add(fid, "kata (token Tanzil)", n_words, qac_words, "jumlah lokasi kata QAC 0.4")
    L.add(fid, "kata vs ad-Dani", n_words, d["words"], "angka ad-Dani hlm. %d" % d["page"])
    body = (f"Dalam hitungan Kufah (riwayat Hafs) yang dipakai modul ini, {NAME[s]} terdiri atas {n_ayat} ayat dan "
            f"{n_words} kata ({' + '.join(map(str, per))}). Basmalah di atas surah tidak diberi nomor ayat dalam "
            f"hitungan ini. ")
    if s == 112:
        body += f"Ad-Dani, yang menamainya Surah Ash-Shamad, mencatat jumlah kata yang sama. "
    else:
        body += f"Ad-Dani mencatat jumlah kata yang sama. "
    if d["other"]:
        a, i, j = d["diff"]
        body += (f"Menurut ad-Dani, hitungan {d['other'][0]} menjadikannya {d['other'][1]} ayat, karena "
                 f"{D.q(s, a, i, j)} dihitung sebagai akhir ayat.")
    else:
        body += f"Menurut ad-Dani, surah ini {n_ayat} ayat dalam semua hitungan, tanpa perbedaan."
    method = (f"Ayat = baris surah {s} dalam Tanzil Uthmani 1.1 (sama dengan atribut ayas di quran-data.xml); kata = "
              f"token yang dipisah spasi setelah basmalah pembuka surah (yang ditaruh Tanzil di awal ayat 1) dibuang. "
              f"Penomoran kata {QAC_BASIS} untuk surah {s} juga berisi {qac_words} kata dan cocok satu per satu. "
              + ("Hitungan ayat negeri lain" if d["other"] else "Kesepakatan semua hitungan ayat")
              + (" dan nama surah" if s == 112 else "") + " dikutip dari ad-Dani, bukan hasil hitungan data.")
    return fact(fid, f"{n_ayat} ayat, {n_words} kata", body, surah_refs(D, s), method,
                [D.tanzil_src(f"baris {s}|1 sampai {s}|{n_ayat}; basmalah pembuka dibuang"),
                 D.qac_src(f"jumlah lokasi ({s}:a:w)"), dani_src(s)])


def f_makkiyah(D: Data, L: Ledger, s: int, slug: str) -> dict:
    d = DANI[s]
    first = "makki" if s == 112 else "madani"  # the view ad-Dani states first
    label = {"makki": "Makkiyah", "madani": "Madaniyah"}
    second = "madani" if first == "makki" else "makki"
    tz = {"Meccan": "Makkiyah", "Medinan": "Madaniyah"}[D.meta[s]["type"]]
    fid = f"makkiyah-madaniyah-{slug}"
    L.add(fid, "type quran-data.xml", D.meta[s]["type"], D.meta[s]["type"], "atribut type dibaca ulang")
    body = (f"Ad-Dani mencatat perbedaan pendapat: {NAME[s]} {label[first]} menurut {refs_text(d[first])}, "
            f"sedangkan menurut {refs_text(d[second])} {label[second]}. Data surah Tanzil yang dipakai modul ini "
            f"menandainya {tz}.")
    method = "Bukan hitungan. Pendapat ulama dikutip dari ad-Dani; penanda Tanzil dari atribut type di quran-data.xml."
    return fact(fid, "Makkiyah atau Madaniyah?", body, surah_refs(D, s), method, [dani_src(s), D.meta_src(s)])


def f_lima_qul(D: Data, L: Ledger) -> dict:
    fid = "lima-surah-qul"
    key = D.ntok(112, 1, 1)
    openers = [(s, a) for s, a, toks, norm in D.C.verses if a == 1 and norm and norm[0] == key]
    raw = sorted((s, a) for s, a, w in D.raw_count(LEM="qaAla", flags=("IMPV", "2MS")) if a == 1 and w == 1)
    L.add(fid, "surah dibuka qul (Tanzil vs QAC kata 1 ayat 1)", openers, raw, "baris QAC mentah")
    if any(s not in NAME for s, _ in openers):
        raise SystemExit(f"{fid}: no Indonesian name for an opener surah {openers}")
    n = len(openers)
    body = (f"Ada {n} surah yang ayat pertamanya dibuka dengan {D.q(112, 1, 0, 1)} (katakanlah): "
            f"{refs_text([f'{NAME[s]} ({s}:{a})' for s, a in openers])}.")
    method = (f"Token pertama ayat 1 setiap surah di Tanzil Uthmani 1.1, setelah basmalah pembuka surah dibuang, "
              f"dibandingkan dengan token 112:1:1 (tanpa awalan); {NORMALISATION_RULE}. Dicek di {QAC_BASIS}: kata "
              f"pertama kelima ayat itu berlemma qāla dengan tanda IMPV 2MS.")
    return fact(fid, f"{NUM_WORD[n].capitalize()} surah dibuka dengan qul", body, [f"{s}:{a}" for s, a in openers],
                method, [D.tanzil_src("token pertama ayat 1 setiap surah"),
                         D.qac_src("LEM:qaAla IMPV 2MS pada kata 1 ayat 1")])


def f_qul(D: Data, L: Ledger) -> dict:
    fid = "qul"
    hits = D.lem_hits("qaAla", ("IMPV", "2MS"))
    refs = ayat_of(seg_locs(hits))
    n2mp = len(D.lem_hits("qaAla", ("IMPV", "2MP")))
    L.add(fid, "qul 2MS segmen", seg_locs(hits), D.raw_count(LEM="qaAla", flags=("IMPV", "2MS")), "baris QAC mentah")
    L.add(fid, "qul 2MP segmen", n2mp, len(D.raw_count(LEM="qaAla", flags=("IMPV", "2MP"))), "baris QAC mentah")
    key = D.ntok(112, 1, 1)
    xc = D.token_xcheck({key, WAW + key, FA + key}, set(seg_locs(hits)), {"qaAla"})
    L.add(fid, "token Tanzil qul vs QAC", xc["ok"], True, "pencarian token + lemma QAC")
    others = Counter(h["qac_lem"] for h in xc["homographs"])
    other_txt = ", ".join(f"{k} {v}" for k, v in sorted(others.items()))
    body = (f"Perintah qul (katakanlah), bentuk perintah kata kerja qāla untuk satu orang (dalam tata bahasa Arab "
            f"berbentuk mudzakkar), muncul {kali(len(hits), refs, True)}, termasuk yang berawalan wa- atau fa-. "
            f"Bentuk untuk orang banyak, qūlū, muncul {n2mp} kali.")
    method = (f"{QAC_BASIS}: segmen STEM dengan LEM:qaAla, POS V, bertanda IMPV dan 2MS = {len(hits)} dalam "
              f"{len(refs)} ayat (ayat dihitung sekali walau memuat qul lebih dari sekali); IMPV 2MP = {n2mp}. Dicek di "
              f"Tanzil: {xc['tanzil']} token qul (boleh berawalan wa- atau fa-); {len(xc['homographs'])} di antaranya "
              f"kata lain yang tulisannya sama tanpa harakat (lemma QAC: {other_txt}).")
    return fact(fid, f"Qul: {fmt(len(hits))} kali", body, refs, method,
                [D.qac_src("LEM:qaAla, IMPV 2MS dan 2MP"), D.tanzil_src("token 112:1:1, awalan wa-/fa-")],
                homographs=xc["homographs"])


def f_huwallah(D: Data, L: Ledger) -> dict:
    fid = "huwa-allahu"
    keys = [D.ntok(112, 1, 2), D.ntok(112, 1, 3)]
    hits = D.C.find_seq(keys, prefixes=("", WAW, FA))
    refs = uniq_refs(hit_pairs(hits))
    L.add(fid, "huwa Allāhu (find_seq vs regex)", hit_pairs(hits), D.regex_hits(keys, ("", WAW, FA)), "regex")
    L.need(fid, "kata kedua berlemma Allah (QAC)", all(D.stem(s, a, i + 2).feat.get("LEM") == "{ll~ah"
                                                       for s, a, i, *_ in hits))
    triple = D.C.find_seq([D.ntok(112, 1, 1)] + keys, prefixes=("", WAW, FA))
    t_refs = uniq_refs(hit_pairs(triple))
    L.add(fid, "qul huwa Allāhu", hit_pairs(triple), D.regex_hits([D.ntok(112, 1, 1)] + keys, ("", WAW, FA)), "regex")
    # longest run of >= 3 consecutive ayat in one surah
    pairs = sorted({(s, a) for s, a, *_ in hits})
    run, best = [], []
    for p in pairs:
        run = run + [p] if run and p == (run[-1][0], run[-1][1] + 1) else [p]
        if len(run) > len(best):
            best = list(run)
    run_txt = ""
    if len(best) >= 3:
        s0 = best[0][0]
        last = max(a for (ss, a) in D.VT if ss == s0)
        where = "di akhir Surah" if best[-1][1] == last else "di Surah"
        run_txt = (f" {NUM_WORD[len(best)].capitalize()} di antaranya berurutan {where} {NAME[s0]} "
                   f"({s0}:{best[0][1]}–{best[-1][1]}).")
    body = (f"Ungkapan {D.q(112, 1, 1, 3)} (Dialah Allah), {prefix_phrase(hits)}, muncul di {len(refs)} ayat: "
            f"{refs_text(refs)}.{run_txt} Kalimat {D.q(112, 1, 0, 3)} hanya ada di {refs_text(t_refs)}.")
    method = (f"Dua token berurutan huwa + Allāh (diambil dari 112:1), token pertama boleh berawalan wa- atau fa-; "
              f"dihitung per ayat; {NORMALISATION_RULE}. Kalimat qul + huwa + Allāh (tiga token 112:1) dicari dengan "
              f"cara yang sama. Dicek di {QAC_BASIS}: di setiap tempat kata kedua berlemma Allāh.")
    return fact(fid, f"Huwa Allāhu di {len(refs)} ayat", body, refs, method,
                [D.tanzil_src("token 112:1:2 + 112:1:3 berurutan; 112:1:1–3"), D.qac_src("LEM:{ll~ah pada kata kedua")])


def f_ahad(D: Data, L: Ledger) -> dict:
    fid = "ahad"
    st = D.stem(112, 1, 4)
    lem, root = st.feat["LEM"], st.feat["ROOT"]
    hits = D.C.lemma_hits(lem)
    refs = ayat_of(seg_locs(hits))
    L.add(fid, f"LEM:{lem}", seg_locs(hits), D.raw_count(LEM=lem), "baris QAC mentah")
    here = sorted({g.a for g in hits if g.s == 112})
    last = max(D.ayat[112])
    L.need(fid, "di Al-Ikhlas tepat di ayat pertama dan terakhir", here == [1, last])
    others = Counter(g.feat["LEM"] for g in D.C.root_hits(root) if g.feat.get("LEM") != lem)
    other_n = sum(others.values())
    body = (f"Kata aḥad muncul {kali(len(hits), refs, True)}. Di surah ini ia muncul {count_word(len(here))}, di ayat "
            f"pertama dan ayat terakhir ({refs_text([f'112:{a}' for a in here])}). Ibnu Katsir menjelaskan aḥad di "
            f"112:1: Dialah Yang Esa, yang tidak ada tandingan-Nya, tidak ada pembantu-Nya, tidak ada saingan-Nya, "
            f"tidak ada yang menyerupai-Nya, dan tidak ada yang sebanding dengan-Nya.")
    method = (f"{QAC_BASIS}: segmen STEM dengan LEM:{lem} (lemma 112:1:4) = {len(hits)} dalam {len(refs)} ayat. Akar "
              f"ROOT:{root} juga memuat {other_n} segmen lemma lain ({', '.join(f'LEM:{k}' for k in sorted(others))}, "
              f"bentuk perempuan iḥdā), yang tidak dihitung. Penjelasan makna dikutip dari Ibnu Katsir.")
    return fact(fid, f"Aḥad: {fmt(len(hits))} kali", body, refs, method,
                [D.qac_src(f"LEM:{lem}"), ik_src("ahad", "makna aḥad")])


def f_hapax(D: Data, L: Ledger, s: int, slug: str, root_note: bool) -> dict:
    fid = f"kata-tunggal-{slug}"
    found, seen = [], set()
    for (ss, a, w) in sorted(D.C.words):
        if ss != s:
            continue
        st = D.stem(s, a, w)
        lem = st.feat.get("LEM")
        if not lem or lem in seen:
            continue
        seen.add(lem)
        hits = D.C.lemma_hits(lem)
        if all(g.s == s for g in hits):
            found.append({"lem": lem, "root": st.feat.get("ROOT"), "loc": (s, a, w), "hits": seg_locs(hits)})
    if not found:
        raise SystemExit(f"{fid}: no lemma occurs only in surah {s}")
    # second method: raw QAC lines, and the Tanzil token search with its homographs
    homographs, locs = [], set()
    for x in found:
        L.add(fid, f"LEM:{x['lem']}", x["hits"], D.raw_count(LEM=x["lem"]), "baris QAC mentah")
        xc = D.token_xcheck(D.variants(*x["loc"]), set(x["hits"]), {x["lem"]})
        L.add(fid, f"token Tanzil LEM:{x['lem']}", xc["ok"], True, "pencarian token + lemma QAC")
        x["homographs"] = xc["homographs"]
        homographs += [dict(h, of=x["lem"]) for h in xc["homographs"]]
        locs |= {f"{a_}:{b_}" for a_, b_, _ in x["hits"]}
    only_root = [x for x in found if x["root"] and all(g.s == s for g in D.C.root_hits(x["root"]))]
    for x in only_root:
        L.add(fid, f"ROOT:{x['root']} hanya di surah {s}", seg_locs(D.C.root_hits(x["root"])),
              D.raw_count(ROOT=x["root"]), "baris QAC mentah")

    def qw(x):
        s_, a_, w_ = x["loc"]
        return D.q(s_, a_, w_ - 1, w_)

    groups: dict[tuple[int, int], list] = {}
    for x in found:
        groups.setdefault(x["loc"][:2], []).append(x)
    listed = [" dan ".join(qw(x) for x in xs) + f" ({s_}:{a_})" for (s_, a_), xs in groups.items()]
    n = len(found)
    body = (f"{NUM_WORD.get(n, str(n)).capitalize()} kata dalam surah ini tidak dipakai di tempat lain dalam "
            f"Al-Qur'an: {refs_text(listed)}.")
    if only_root:
        rl = refs_text([letters(x["root"]) for x in only_root])
        if len(only_root) == n:
            body += f" Akar {'kedua' if n == 2 else 'semua'} kata itu pun ({rl}) tidak muncul di ayat lain."
        else:
            body += (f" Untuk {refs_text([qw(x) for x in only_root])}, akarnya pun ({rl}) hanya ada di sini.")
    if root_note:
        parts = []
        for x in found:
            if x in only_root or not x["root"]:
                continue
            other = [r for r in ayat_of(seg_locs(D.C.root_hits(x["root"]))) if r != f"{x['loc'][0]}:{x['loc'][1]}"]
            parts.append(f"{letters(x['root'])} di {refs_text(other)}")
            locs |= set(other)
        if parts:
            body += f" Akarnya dipakai di ayat lain: {'; '.join(parts)}."
    for h in homographs:
        hs, ha, hw = (int(v) for v in h["loc"].split(":"))
        if hs == s:
            continue
        x = next(y for y in found if y["lem"] == h["of"])
        root_txt = f" dari akar {letters(h['qac_root'])}" if h["qac_root"] else ""
        body += (f" Tanpa harakat, {qw(x)} tertulis sama dengan {D.q(hs, ha, hw - 1, hw)} di {hs}:{ha}, kata "
                 f"lain{root_txt}.")
        locs.add(f"{hs}:{ha}")
    lem_q = "; ".join(f"LEM:{x['lem']}" for x in found)
    root_q = "; ".join(f"ROOT:{x['root']}" for x in only_root)
    method = (f"{QAC_BASIS}: lemma (LEM) segmen STEM surah {s} yang semua kemunculannya di seluruh Al-Qur'an ada di "
              f"surah ini ({lem_q})" + (f"; akar yang juga hanya ada di sini: {root_q}" if root_q else "") +
              f". Dicek di Tanzil: token dengan tulisan sama tanpa harakat (boleh dengan al- dan awalan wa-, fa-, bi-, "
              f"ka-, li-) hanya ada di tempat itu" + (", kecuali homograf yang disebut, yang lemma QAC-nya lain"
                                                      if homographs else "") + ".")
    return fact(fid, f"{n} kata yang hanya ada di {NAME[s]}", body, sorted(locs), method,
                [D.qac_src(lem_q + (f"; {root_q}" if root_q else "")), D.tanzil_src("token yang sama tanpa harakat")],
                homographs=homographs)


def f_samad(D: Data, L: Ledger, H: Hadiths) -> dict:
    fid = "ash-shamad-menurut-ibnu-abbas"
    L.need(fid, "kalimat Ibnu Katsir ada di rekaman tafsir korpus 112:2", H.tafsir_has("samad"))
    body = (f"Ibnu Katsir menukil beberapa penafsiran ulama salaf tentang {D.q(112, 2, 1, 2)}. Salah satunya dari "
            f"Ibnu 'Abbas (riwayat 'Ikrimah): Dialah yang menjadi tujuan seluruh makhluk dalam kebutuhan dan "
            f"permohonan mereka.")
    method = ("Bukan hitungan; dikutip dari Ibnu Katsir (tafsir 112:2). Kalimatnya juga dicek ada di rekaman tafsir "
              "Ibnu Katsir korpus platform (api/data/tafsir-ibn-kathir.json, 112:2).")
    return fact(fid, "Aṣ-ṣamad menurut Ibnu 'Abbas", body, ["112:2"], method, [ik_src("samad", "makna aṣ-ṣamad")])


def f_lam_yakun(D: Data, L: Ledger) -> dict:
    fid = "wa-lam-yakun-lahu"
    keys = [D.ntok(112, 4, w) for w in (1, 2, 3)]
    hits = D.C.find_seq(keys)
    refs = uniq_refs(hit_pairs(hits))
    L.add(fid, "wa lam yakun lahu (find_seq vs regex)", hit_pairs(hits), D.regex_hits(keys), "regex")
    per = Counter(hit_pairs(hits))
    others = [r for r in refs if r != "112:4"]
    first = {}
    for s, a, i, *_ in hits:
        first.setdefault((s, a), i)
    s0, a0 = (int(x) for x in others[0].split(":"))
    i0 = first[(s0, a0)]
    before = D.VN[(s0, a0)][i0 - 3:i0]
    after = D.VN[(s0, a0)][i0 + 3:i0 + 6]
    for r in others:
        s, a = (int(x) for x in r.split(":"))
        i = first[(s, a)]
        b = list(D.VN[(s, a)][i - 3:i])
        if b and b[0] == WAW + before[0]:
            b[0] = b[0][len(WAW):]
        L.need(fid, f"{r}: tiga token sebelum = {others[0]}", b == before)
        L.need(fid, f"{r}: tiga token sesudah = {others[0]}", D.VN[(s, a)][i + 3:i + 6] == after)
    desc = refs_text([f"{count_word(per[tuple(int(x) for x in r.split(':'))])} di {r}" for r in refs])
    body = (f"Rangkaian {D.q(112, 4, 0, 3)} (dan tidak ada bagi-Nya) muncul {kali(len(hits), refs)}: {desc}. Di "
            f"{refs_text(others)}, kemunculan pertamanya didahului {D.q(s0, a0, i0 - 3, i0)} (tidak mengambil anak) "
            f"dan diikuti {D.q(s0, a0, i0 + 3, i0 + 6)} (sekutu dalam kerajaan).")
    method = (f"Tiga token berurutan wa-lam + yakun + lahu (diambil dari 112:4) di teks Tanzil setelah basmalah pembuka "
              f"surah dibuang; {NORMALISATION_RULE}. Tiga token sebelum dan sesudah kemunculan pertamanya di "
              f"{refs_text(others)} dibandingkan dengan cara yang sama (token pertama boleh berawalan wa-).")
    return fact(fid, f"Wa lam yakun lahu di {len(refs)} ayat", body, refs, method,
                [D.tanzil_src("token 112:4:1–3 berurutan; tiga token sebelum/sesudah di ayat lain")])


def f_qul_audzu(D: Data, L: Ledger) -> dict:
    fid = "qul-a-udzu-bi-rabbi"
    keys = [D.ntok(113, 1, w) for w in (1, 2, 3)]
    hits = D.C.find_seq(keys, prefixes=("", WAW, FA))
    refs = uniq_refs(hit_pairs(hits))
    L.add(fid, "qul a‘ūżu bi-rabbi (find_seq vs regex)", hit_pairs(hits), D.regex_hits(keys, ("", WAW, FA)), "regex")
    L.need(fid, "hanya 113:1 dan 114:1", refs == ["113:1", "114:1"])
    body = (f"Kalimat {D.q(113, 1, 0, 3)} (katakanlah: aku berlindung kepada Tuhan) hanya ada di {NUM_WORD[len(refs)]} "
            f"tempat dalam Al-Qur'an: awal Al-Falaq (113:1) dan awal An-Nas (114:1). Lanjutannya berbeda: "
            f"{D.q(113, 1, 3, 4)} di Al-Falaq dan {D.q(114, 1, 3, 4)} di An-Nas.")
    method = (f"Tiga token berurutan qul + a‘ūżu + bi-rabbi (diambil dari 113:1), token pertama boleh berawalan wa- "
              f"atau fa-; {NORMALISATION_RULE}.")
    return fact(fid, "Dua surah dengan pembuka yang sama", body, refs, method,
                [D.tanzil_src("token 113:1:1–3 berurutan")], shared=list(PAIR))


def window(D: Data, g: Segment) -> str:
    """Quote a root hit: an isim with the word after it, a verb alone."""
    j = g.w + 1 if g.feat.get("POS") in ("N", "ADJ") and g.w < len(D.VT[(g.s, g.a)]) else g.w
    return D.q(g.s, g.a, g.w - 1, j)


def f_root_family(D: Data, L: Ledger, fid: str, s: int, a: int, w: int) -> tuple[dict, list, list[str]]:
    st = D.stem(s, a, w)
    root = st.feat["ROOT"]
    hits = D.C.root_hits(root)
    refs = ayat_of(seg_locs(hits))
    L.add(fid, f"ROOT:{root}", seg_locs(hits), D.raw_count(ROOT=root), "baris QAC mentah")
    return st.feat, hits, refs


def f_falaq(D: Data, L: Ledger, H: Hadiths) -> dict:
    fid = "akar-falaq"
    feat, hits, refs = f_root_family(D, L, fid, 113, 1, 4)
    L.need(fid, "LEM falaq hanya di 113:1", ayat_of(seg_locs(D.C.lemma_hits(feat["LEM"]))) == ["113:1"])
    for k in ("falaq", "falaq-6-96", "falaq-sawab"):
        L.need(fid, f"kalimat Ibnu Katsir ({k}) ada di rekaman tafsir korpus", H.tafsir_has(k))
    g696 = next((g for g in hits if (g.s, g.a) == (6, 96)), None)
    L.need(fid, "6:96 termasuk keluarga akar ini", g696 is not None)
    listed = [f"{window(D, g)} ({g.s}:{g.a})" for g in hits if g.s != 113] + ["113:1"]
    body = (f"Kata {D.q(113, 1, 3, 4)} hanya ada di 113:1, tetapi keluarga akar {letters(feat['ROOT'])} muncul "
            f"{kali(len(hits), refs)}: {refs_text(listed)}. Ibnu Katsir menukil dari Jabir dan Ibnu 'Abbas (riwayat "
            f"al-'Aufi), juga dari banyak ulama salaf, bahwa al-falaq adalah subuh; al-Qurazhi, Ibnu Zaid, dan Ibnu "
            f"Jarir menyamakannya dengan {window(D, g696)} (6:96). Ada pendapat lain, tetapi Ibnu Jarir memilih makna "
            f"ini, dan Ibnu Katsir menyebutnya pendapat yang benar serta pilihan al-Bukhari.")
    method = (f"{QAC_BASIS}: segmen STEM dengan ROOT:{feat['ROOT']} = {len(hits)} dalam {len(refs)} ayat; "
              f"LEM:{feat['LEM']} = 1. Kutipan diambil dari token Tanzil di lokasi QAC itu (isim beserta kata "
              f"sesudahnya). Penafsiran dikutip dari Ibnu Katsir.")
    return fact(fid, "Al-falaq dan keluarga katanya", body, refs, method,
                [D.qac_src(f"ROOT:{feat['ROOT']}; LEM:{feat['LEM']}"), ik_src("falaq", "makna al-falaq")])


def f_ghasiq(D: Data, L: Ledger, H: Hadiths) -> dict:
    fid = "akar-ghasiq"
    feat, hits, refs = f_root_family(D, L, fid, 113, 3, 3)
    L.need(fid, "kalimat Ibnu Katsir (ghasiq) ada di rekaman tafsir korpus", H.tafsir_has("ghasiq"))
    L.need(fid, "kalimat Ibnu Katsir (ghasiq-lain) ada di rekaman tafsir korpus", H.tafsir_has("ghasiq-lain"))
    ex = next(g for g in hits if g.s != 113)
    body = (f"Kata {D.q(113, 3, 2, 3)} hanya ada di 113:3, tetapi keluarga akar {letters(feat['ROOT'])} muncul "
            f"{kali(len(hits), refs)}, misalnya {window(D, ex)} ({ex.s}:{ex.a}). Ibnu Katsir menukil Mujahid: gāsiq "
            f"adalah malam, dan {D.q(113, 3, 3, 5)} adalah saat matahari terbenam; Ibnu 'Abbas dan sejumlah ulama lain "
            f"menyebutnya malam ketika datang dengan kegelapannya. Ibnu Katsir juga mencatat pendapat lain.")
    method = (f"{QAC_BASIS}: segmen STEM dengan ROOT:{feat['ROOT']} = {len(hits)} dalam {len(refs)} ayat; "
              f"LEM:{feat['LEM']} = {len(D.C.lemma_hits(feat['LEM']))}. Penafsiran dikutip dari Ibnu Katsir.")
    return fact(fid, "Gāsiq dan keluarga katanya", body, refs, method,
                [D.qac_src(f"ROOT:{feat['ROOT']}; LEM:{feat['LEM']}"), ik_src("ghasiq", "makna gāsiq"),
                 ik_src("ghasiq-lain", "pendapat lain tentang gāsiq: matahari terbenam, bintang, bulan")])


def f_hasad(D: Data, L: Ledger) -> dict:
    fid = "akar-hasad"
    feat, hits, refs = f_root_family(D, L, fid, 113, 5, 3)
    hasid = ayat_of(seg_locs(D.C.lemma_hits(feat["LEM"])))
    L.need(fid, "ḥāsid hanya di 113:5", hasid == ["113:5"])
    lems = Counter(g.feat["LEM"] for g in hits)
    body = (f"Kata-kata dari akar {letters(feat['ROOT'])} (dengki), seperti {D.q(113, 5, 2, 3)} dan "
            f"{D.q(113, 5, 4, 5)} di 113:5, muncul {kali(len(hits), refs)}: {refs_text(refs)}. Bentuk ḥāsid (orang "
            f"yang dengki) hanya ada di 113:5.")
    method = (f"{QAC_BASIS}: segmen STEM dengan ROOT:{feat['ROOT']} = {len(hits)} dalam {len(refs)} ayat "
              f"({', '.join(f'LEM:{k} {v}' for k, v in sorted(lems.items()))}); LEM:{feat['LEM']} hanya di 113:5.")
    return fact(fid, f"Keluarga kata ḥasad: {len(hits)} kali", body, refs, method,
                [D.qac_src(f"ROOT:{feat['ROOT']}; LEM:{feat['LEM']}")])


def f_min_syarri(D: Data, L: Ledger) -> dict:
    fid = "min-syarri"
    keys = [D.ntok(113, 2, 1), D.ntok(113, 2, 2)]
    hits = D.C.find_seq(keys, prefixes=("", WAW, FA))
    refs = uniq_refs(hit_pairs(hits))
    L.add(fid, "min syarri (find_seq vs regex)", hit_pairs(hits), D.regex_hits(keys, ("", WAW, FA)), "regex")
    L.need(fid, "lemma QAC min + syarr di setiap tempat",
           all(D.stem(s, a, i + 1).feat.get("LEM") == "min" and D.stem(s, a, i + 2).feat.get("LEM") == "$ar~"
               for s, a, i, *_ in hits))
    by = Counter(s for s, *_ in hits)
    L.need(fid, "semua di 113 dan 114", set(by) == {113, 114})
    r113 = [r for r in refs if r.startswith("113:")]
    body = (f"Ungkapan {D.q(113, 2, 0, 2)} (dari kejahatan), {prefix_phrase(hits)}, muncul {kali(len(hits), refs)} "
            f"dalam Al-Qur'an, dan semuanya ada di dua surah ini: {NUM_WORD.get(by[113], by[113])} di Al-Falaq "
            f"({ayah_range(r113)}) dan {('satu' if by[114] == 1 else NUM_WORD.get(by[114], by[114]))} di An-Nas "
            f"({refs_text([r for r in refs if r.startswith('114:')])}).")
    method = (f"Dua token berurutan min + syarri (diambil dari 113:2), token pertama boleh berawalan wa- atau fa-; "
              f"{NORMALISATION_RULE}. Dicek di {QAC_BASIS}: di setiap tempat kata pertama berlemma min dan kata kedua "
              f"berlemma syarr.")
    return fact(fid, f"Min syarri: {len(hits)} kali", body, refs, method,
                [D.tanzil_src("token 113:2:1 + 113:2:2 berurutan"), D.qac_src("LEM:min lalu LEM:$ar~")],
                shared=list(PAIR))


def f_audzu(D: Data, L: Ledger) -> dict:
    fid = "keluarga-kata-a-udzu"
    feat, hits, refs = f_root_family(D, L, fid, 113, 1, 2)
    lems = Counter(g.feat["LEM"] for g in hits)
    au = D.lem_hits(feat["LEM"], ("IMPF", "1S"))
    au_refs = ayat_of(seg_locs(au))
    L.add(fid, "a‘ūżu IMPF 1S", seg_locs(au), D.raw_count(LEM=feat["LEM"], flags=("IMPF", "1S")), "baris QAC mentah")
    key = D.ntok(113, 1, 2)
    xc = D.token_xcheck({key, WAW + key, FA + key}, set(seg_locs(au)), {feat["LEM"]})
    L.add(fid, "token Tanzil a‘ūżu vs QAC", xc["ok"] and not xc["homographs"], True, "pencarian token + lemma QAC")
    au_tz = D.C.find_seq([key], prefixes=("", WAW, FA))
    ist = [g for g in hits if g.feat.get("POS") == "V" and "IMPV" in g.flags]
    ist_refs = ayat_of(seg_locs(ist))
    ist_lem = Counter(g.feat["LEM"] for g in ist)
    L.need(fid, "perintah = satu lemma bentuk X", len(ist_lem) == 1 and all("(X)" in g.flags for g in ist))
    g98 = next((g for g in ist if (g.s, g.a) == (16, 98)), None)
    L.need(fid, "16:98 memuat perintah itu", g98 is not None)
    g0 = ist[0]
    body = (f"Keluarga kata {letters(feat['ROOT'])} (berlindung) muncul {kali(len(hits), refs, True)}, dalam "
            f"{len(lems)} lemma. Bentuk {D.q(113, 1, 1, 2)} (aku berlindung), {prefix_phrase(au_tz)}, ada di "
            f"{len(au_refs)} ayat: {refs_text(au_refs)}. Perintah {D.q(g0.s, g0.a, g0.w - 1, g0.w)} (maka "
            f"berlindunglah) muncul {len(ist)} kali ({refs_text(ist_refs)}); salah satunya "
            f"{D.q(16, 98, 0, g98.w + 1)} (16:98), yaitu perintah berlindung kepada Allah ketika membaca Al-Qur'an.")
    method = (f"{QAC_BASIS}: segmen STEM dengan ROOT:{feat['ROOT']} = {len(hits)} dalam {len(refs)} ayat "
              f"({', '.join(f'LEM:{k} {v}' for k, v in sorted(lems.items()))}); a‘ūżu = LEM:{feat['LEM']} bertanda IMPF "
              f"1S; perintah = LEM:{next(iter(ist_lem))} bertanda IMPV (bentuk X). Dicek di Tanzil: token a‘ūżu (boleh "
              f"berawalan wa- atau fa-) ada {xc['tanzil']}, sama dengan QAC.")
    return fact(fid, f"Keluarga kata a‘ūżu: {len(hits)} kali", body, refs, method,
                [D.qac_src(f"ROOT:{feat['ROOT']}; LEM:{feat['LEM']} IMPF 1S; LEM:{next(iter(ist_lem))} IMPV"),
                 D.tanzil_src("token 113:1:2, awalan wa-/fa-; 16:98 token 1–5")], shared=list(PAIR))


def f_an_nas(D: Data, L: Ledger) -> dict:
    fid = "an-nas"
    st = D.stem(114, 1, 4)
    lem = st.feat["LEM"]
    hits = D.C.lemma_hits(lem)
    refs = ayat_of(seg_locs(hits))
    L.add(fid, f"LEM:{lem}", seg_locs(hits), D.raw_count(LEM=lem), "baris QAC mentah")
    here = [(g.a, g.w) for g in hits if g.s == 114]
    last = all(w == len(D.VT[(114, a)]) for a, w in here)
    L.need(fid, "an-nās di surah ini selalu kata terakhir ayat", last)
    no = [a for a in D.ayat[114] if a not in {x for x, _ in here}]
    xc = D.token_xcheck(D.variants(114, 1, 4), set(seg_locs(hits)), {lem})
    L.add(fid, "token Tanzil an-nās vs QAC", xc["ok"], True, "pencarian token + lemma QAC")
    body = (f"Kata an-nās (manusia) muncul {kali(len(hits), refs, True)}. {NUM_WORD[len(here)].capitalize()} di "
            f"antaranya ada di surah ini, sebagai kata terakhir ayat {refs_text([str(a) for a, _ in here])}; ayat "
            f"{refs_text([str(a) for a in no])} berakhir dengan "
            f"{refs_text([D.q(114, a, len(D.VT[(114, a)]) - 1, len(D.VT[(114, a)])) for a in no])}.")
    method = (f"{QAC_BASIS}: segmen STEM dengan LEM:{lem} (lemma 114:1:4) = {len(hits)} dalam {len(refs)} ayat (ayat "
              f"dihitung sekali walau memuat kata ini lebih dari sekali). Dicek di Tanzil: {xc['tanzil']} token "
              f"bertulisan an-nās (dengan al-, boleh berawalan wa-, fa-, bi-, ka-, li-), sama dengan QAC.")
    return fact(fid, f"An-nās: {fmt(len(hits))} kali", body, refs, method,
                [D.qac_src(f"LEM:{lem}"), D.tanzil_src("token 114:1:4 dengan awalan")])


def f_rabb_malik_ilah(D: Data, L: Ledger, H: Hadiths) -> dict:
    fid = "rabb-malik-ilah"
    rabb = normalise(D.tok(1, 2, 3))  # rabb without a prefix, from 1:2
    nas = D.ntok(114, 1, 4)
    found = []
    for a, key, w in ((1, rabb, 3), (2, D.ntok(114, 2, 1), 1), (3, D.ntok(114, 3, 1), 1)):
        hits = D.C.find_seq([key, nas], prefixes=("", WAW, FA, BA, LAM))
        L.add(fid, f"{key} + an-nās", hit_pairs(hits), D.regex_hits([key, nas], ("", WAW, FA, BA, LAM)), "regex")
        L.need(fid, f"{key} + an-nās hanya di 114:{a}", uniq_refs(hit_pairs(hits)) == [f"114:{a}"])
        found.append(D.stem(114, a, w).feat.get("LEM"))
    L.add(fid, "lemma QAC tiga sebutan", found, [D.stem(1, 2, 3).feat["LEM"], "malik", "<ila`h"],
          "lemma rabb dari 1:2:3; malik dan ilāh diharapkan")
    L.need(fid, "kalimat Ibnu Katsir ada di rekaman tafsir korpus 114:1", H.tafsir_has("three"))
    body = (f"Tiga ayat pertama surah ini menyandarkan tiga sebutan kepada an-nās (manusia): {D.q(114, 1, 2, 4)}, "
            f"{D.q(114, 2, 0, 2)}, dan {D.q(114, 3, 0, 2)}. Ketiga rangkaian ini tidak muncul di tempat lain dalam "
            f"Al-Qur'an. Ibnu Katsir menyebut ketiganya sifat Allah: rubūbiyyah, mulk, dan ilāhiyyah. Dia Rabb "
            f"segala sesuatu, Raja-nya, dan Ilah-nya, sehingga orang yang berlindung diperintahkan berlindung kepada "
            f"Yang bersifat demikian.")
    method = (f"Untuk masing-masing, dua token berurutan (rabb, malik, atau ilāh + an-nās) dicari di seluruh teks "
              f"Tanzil, token pertama boleh berawalan wa-, fa-, bi-, atau li-; {NORMALISATION_RULE}. Kunci rabb diambil "
              f"dari 1:2:3. Dicek di {QAC_BASIS}: ketiga kata itu berlemma rabb, malik, dan ilāh, masing-masing lemma "
              f"tersendiri. Penjelasan sifat dikutip dari Ibnu Katsir.")
    return fact(fid, "Rabb, malik, ilāh", body, ["114:1", "114:2", "114:3"], method,
                [D.tanzil_src("token 1:2:3 / 114:2:1 / 114:3:1 + 114:1:4 berurutan"),
                 D.qac_src("lemma 114:1:3, 114:2:1, 114:3:1"), ik_src("three", "tiga sifat")])


def f_malik(D: Data, L: Ledger) -> dict:
    fid = "malik-dan-malik"
    st_n, st_f = D.stem(114, 2, 1), D.stem(1, 4, 1)
    L.need(fid, "akar sama, lemma beda", st_n.feat["ROOT"] == st_f.feat["ROOT"] and st_n.feat["LEM"] != st_f.feat["LEM"])
    h1, h2 = D.C.lemma_hits(st_n.feat["LEM"]), D.C.lemma_hits(st_f.feat["LEM"])
    r1, r2 = ayat_of(seg_locs(h1)), ayat_of(seg_locs(h2))
    L.add(fid, f"LEM:{st_n.feat['LEM']}", seg_locs(h1), D.raw_count(LEM=st_n.feat["LEM"]), "baris QAC mentah")
    L.add(fid, f"LEM:{st_f.feat['LEM']}", seg_locs(h2), D.raw_count(LEM=st_f.feat["LEM"]), "baris QAC mentah")
    pos1 = Counter(g.feat.get("POS") for g in h1)
    L.need(fid, f"LEM:{st_f.feat['LEM']} semua ACT PCPL", all({"ACT", "PCPL"} <= set(g.flags) for g in h2))
    body = (f"Kata {D.q(114, 2, 0, 1)} (raja) di 114:2 dan {D.q(1, 4, 0, 1)} di 1:4 seakar "
            f"({letters(st_n.feat['ROOT'])}), tetapi lemmanya berbeda. Darwisy membedakan: mālik adalah pemilik (dari "
            f"milk), sedangkan malik adalah raja (dari mulk). Lemma malik muncul {kali(len(h1), r1, True)}; mālik "
            f"sebagai isim fa'il hanya {len(h2)} kali: {refs_text(r2)}.")
    method = (f"{QAC_BASIS}: LEM:{st_n.feat['LEM']} = {len(h1)} segmen dalam {len(r1)} ayat (POS "
              f"{', '.join(f'{k} {v}' for k, v in sorted(pos1.items()))}); LEM:{st_f.feat['LEM']} = {len(h2)} (POS N, ACT "
              f"PCPL). Keduanya ROOT:{st_n.feat['ROOT']}. Mengikuti teks Hafs (Tanzil); di 1:4 ada qira'at lain yang "
              f"membaca maliki. Perbedaan makna dikutip dari Darwisy.")
    return fact(fid, "Malik dan mālik", body, r1 + r2, method,
                [D.qac_src(f"LEM:{st_n.feat['LEM']}; LEM:{st_f.feat['LEM']}; ROOT:{st_n.feat['ROOT']}"), DARWISY_MALIK])


def f_khannas(D: Data, L: Ledger, H: Hadiths) -> dict:
    fid = "mundur-saat-allah-diingat"
    L.need(fid, "kalimat Ibnu Katsir ada di rekaman tafsir korpus 114:4", H.tafsir_has("khannas"))
    body = (f"Ibnu Katsir menukil penafsiran Ibnu 'Abbas (riwayat Sa'id bin Jubair) tentang {D.q(114, 4, 2, 4)}: setan "
            f"bercokol di hati manusia; ketika manusia lalai dan lengah, ia berbisik, dan ketika manusia mengingat "
            f"Allah, ia mundur. Penafsiran yang sama dinukil dari Mujahid dan Qatadah.")
    method = ("Bukan hitungan; dikutip dari Ibnu Katsir (tafsir 114:4). Kalimatnya juga dicek ada di rekaman tafsir "
              "Ibnu Katsir korpus platform (api/data/tafsir-ibn-kathir.json, 114:4).")
    return fact(fid, "Mundur ketika Allah diingat", body, ["114:4"], method, [ik_src("khannas", "makna al-khannās")])


def f_jinnah(D: Data, L: Ledger) -> dict:
    fid = "jin-dan-manusia"
    keys = [D.ntok(114, 6, w) for w in (1, 2, 3)]
    hits = D.C.find_seq(keys)
    refs = uniq_refs(hit_pairs(hits))
    L.add(fid, "min al-jinnati wa an-nās (find_seq vs regex)", hit_pairs(hits), D.regex_hits(keys), "regex")
    jin = D.stem(114, 6, 2).feat["LEM"]
    L.need(fid, "kata kedua berlemma jin~ap di setiap tempat",
           all(D.stem(s, a, i + 2).feat.get("LEM") == jin for s, a, i, *_ in hits))
    same = [(s, a, w) for (s, a), norm in D.VN.items() for w, t in enumerate(norm, 1) if t == keys[1]]
    lems = Counter(stem_of(D.C.words[x]).feat.get("LEM") for x in same)
    L.need(fid, "token bertulisan al-jinnah hanya dua lemma", len(lems) == 2 and jin in lems)
    other = next(k for k in lems if k != jin)
    body = (f"Rangkaian {D.q(114, 6, 0, 3)} (dari golongan jin dan manusia) muncul di {len(refs)} ayat: "
            f"{refs_text(refs)}. Tanpa harakat, al-jinnah (jin) ditulis sama dengan al-jannah (surga): dari "
            f"{len(same)} token bertulisan itu, {lems[jin]} adalah al-jinnah dan {lems[other]} al-jannah.")
    method = (f"Tiga token berurutan min + al-jinnah + wa-an-nās (diambil dari 114:6); {NORMALISATION_RULE}. Karena "
              f"tanpa harakat keduanya sama, setiap token dicek lemmanya di {QAC_BASIS} (LEM:{jin} untuk jin, "
              f"LEM:{other} untuk surga).")
    return fact(fid, f"Dari golongan jin dan manusia: {len(refs)} ayat", body, refs, method,
                [D.tanzil_src("token 114:6:1–3 berurutan; token 114:6:2"), D.qac_src(f"LEM:{jin}; LEM:{other}")])


def f_pembuka_penutup(D: Data, L: Ledger) -> dict:
    fid = "dibuka-dan-ditutup-dengan-rabb"
    last = max(s for s, _ in D.VT)
    L.need(fid, "An-Nas surah terakhir", last == 114)
    L.add(fid, "lemma rabb di 1:2:3 dan 114:1:3", D.stem(1, 2, 3).feat["LEM"], D.stem(114, 1, 3).feat["LEM"], "QAC")
    body = (f"Mushaf dibuka dengan Al-Fatihah, yang memuji Allah sebagai {D.q(1, 2, 2, 4)} (Tuhan seluruh alam, 1:2), "
            f"dan ditutup dengan An-Nas, yang mengajarkan berlindung {D.q(114, 1, 2, 4)} (kepada Tuhan manusia, 114:1).")
    method = (f"Bukan hitungan; pengamatan pada surah pertama dan terakhir dalam susunan mushaf (Tanzil: surah 1 dan "
              f"{last}) dan pada token 1:2:3–4 serta 114:1:3–4. Dicek di {QAC_BASIS}: kedua kata rabb berlemma sama.")
    return fact(fid, "Rabb di surah pertama dan terakhir", body, ["1:2", "114:1"], method,
                [D.tanzil_src("token 1:2:3–4 dan 114:1:3–4"), D.qac_src("LEM:rab~ di 1:2:3 dan 114:1:3")])


# ---------------------------------------------------------------- facts resting on hadith
def hfact(H: Hadiths, fid: str, title: str, body: str, locs: list[str], keys: list[str], extra_src=(), **kw) -> dict:
    return fact(fid, title, body, locs, hadith_method(H, keys), [H.src(k) for k in keys] + list(extra_src),
                hadith=[H.records[k]["citation"] for k in keys], **kw)


def hadith_facts(D: Data, L: Ledger, H: Hadiths) -> dict[str, dict]:
    c = H.cite
    n = lambda k: H.records[k]["citation"].rsplit(" ", 1)[1]  # noqa: E731
    F = {}
    F["sepertiga"] = hfact(
        H, "setara-sepertiga-al-quran", "Setara dengan sepertiga Al-Qur'an",
        f"Abu Sa'id al-Khudri meriwayatkan: seseorang mendengar orang lain membaca surah ini berulang-ulang, lalu "
        f"menceritakannya kepada Rasulullah ﷺ seolah menganggapnya sedikit. Rasulullah ﷺ bersumpah bahwa surah ini "
        f"setara dengan sepertiga Al-Qur'an ({c('bukhari-5013')}). Makna yang sama ada dalam riwayat Abu ad-Darda' dan "
        f"Abu Hurairah ({COLL_PROSE['muslim']} no. {n('muslim-811a')} dan {n('muslim-812a')}).",
        surah_refs(D, 112), ["bukhari-5013", "muslim-811a", "muslim-812a"])
    F["dicintai"] = hfact(
        H, "mencintai-surah-ini", "Mencintai surah ini",
        f"Aisyah meriwayatkan bahwa seorang sahabat yang memimpin pasukan kecil selalu menutup bacaan shalatnya dengan "
        f"surah ini. Ketika ditanya, ia menjawab bahwa surah ini adalah sifat ar-raḥmān dan ia senang membacanya. "
        f"Rasulullah ﷺ lalu menyuruh agar orang itu diberi kabar bahwa Allah mencintainya ({c('bukhari-7375')}; "
        f"{c('muslim-813')}). Dalam riwayat Anas yang dicantumkan an-Nawawi ({c('riyad-1013')}), seseorang berkata "
        f"kepada Rasulullah ﷺ bahwa ia mencintai surah ini, dan beliau bersabda bahwa kecintaannya kepada surah ini "
        f"memasukkannya ke surga. An-Nawawi menyebut at-Tirmidzi menilainya hasan, dan al-Bukhari meriwayatkannya "
        f"secara ta'liq.",
        surah_refs(D, 112), ["bukhari-7375", "muslim-813", "riyad-1013"])
    F["qudsi"] = hfact(
        H, "hadits-qudsi-al-ikhlas", "Al-Ikhlas dalam hadits qudsi",
        f"Abu Hurairah meriwayatkan sebuah hadits qudsi: Allah menyebut ucapan anak Adam (manusia) bahwa Allah "
        f"mengambil anak sebagai celaan kepada-Nya, lalu menyebut diri-Nya dengan sifat-sifat yang juga ada dalam "
        f"surah ini: al-aḥad, aṣ-ṣamad, tidak beranak dan tidak diperanakkan, serta tidak ada seorang pun yang setara "
        f"dengan-Nya ({c('bukhari-4974')}).",
        surah_refs(D, 112), ["bukhari-4974"])
    F["fajar"] = hfact(
        H, "dua-rakaat-fajar", "Dibaca di dua rakaat fajar",
        f"Abu Hurairah meriwayatkan bahwa Rasulullah ﷺ membaca surah Al-Kafirun dan Al-Ikhlas dalam dua rakaat fajar "
        f"({c('muslim-726')}).",
        surah_refs(D, 109, 112), ["muslim-726"])
    F["tidur"] = hfact(
        H, "sebelum-tidur", "Dibaca sebelum tidur",
        f"Aisyah menuturkan: setiap malam, ketika beranjak ke tempat tidurnya, Rasulullah ﷺ menyatukan kedua telapak "
        f"tangannya, meniupnya, dan membaca ke dalamnya Al-Ikhlas, Al-Falaq, dan An-Nas. Kemudian beliau mengusapkan "
        f"kedua tangannya ke tubuh sejauh yang terjangkau, dimulai dari kepala, wajah, dan bagian depan tubuh. Beliau "
        f"melakukannya tiga kali ({c('bukhari-5017')}). Dalam riwayat lain, Aisyah menyebut bahwa ketika beliau "
        f"sakit, beliau menyuruh Aisyah melakukannya untuk beliau ({c('bukhari-5748')}).",
        surah_refs(D, 112, 113, 114), ["bukhari-5017", "bukhari-5748"], shared=list(ALL3))
    F["pagi-petang"] = hfact(
        H, "pagi-dan-petang", "Pagi dan petang, tiga kali",
        f"'Abdullah bin Khubaib meriwayatkan bahwa Rasulullah ﷺ menyuruhnya membaca Al-Ikhlas dan al-mu‘awwiżatain "
        f"pada petang dan pagi hari, tiga kali, dan bersabda bahwa bacaan itu mencukupinya dari segala sesuatu. "
        f"An-Nawawi mencantumkannya ({c('riyad-1456')}) dari riwayat Abu Dawud dan at-Tirmidzi, dan menyebut "
        f"at-Tirmidzi menilainya hasan shahih.",
        surah_refs(D, 112, 113, 114), ["riyad-1456"], shared=list(ALL3))
    F["tiada-banding"] = hfact(
        H, "belum-pernah-terlihat-semisalnya", "Belum pernah terlihat semisalnya",
        f"'Uqbah bin 'Amir meriwayatkan sabda Rasulullah ﷺ: malam ini telah diturunkan ayat-ayat yang belum "
        f"pernah terlihat yang serupa dengannya, yaitu Al-Falaq dan An-Nas ({c('muslim-814a')}). Dalam riwayat "
        f"berikutnya keduanya disebut al-mu‘awwiżatain ({c('muslim-814b')}).",
        surah_refs(D, 113, 114), ["muslim-814a", "muslim-814b"], shared=list(PAIR))
    F["ruqyah"] = hfact(
        H, "dibaca-saat-sakit", "Dibaca saat sakit",
        f"Aisyah menuturkan bahwa apabila sakit, Rasulullah ﷺ membaca al-mu‘awwiżāt untuk dirinya sendiri lalu "
        f"meniupkannya. Ketika sakitnya bertambah berat, Aisyah yang membacakannya dan mengusap tubuh beliau dengan "
        f"tangan beliau sendiri, karena mengharap keberkahannya ({c('bukhari-5016')}). Aisyah juga menuturkan bahwa "
        f"apabila ada anggota keluarga yang sakit, beliau meniupnya dengan al-mu‘awwiżāt ({c('muslim-2192a')}). Teks "
        f"kedua hadits ini tidak merinci surah mana saja yang dimaksud dengan al-mu‘awwiżāt.",
        surah_refs(D, 113, 114), ["bukhari-5016", "muslim-2192a"], shared=list(PAIR))
    F["turunnya"] = hfact(
        H, "setelah-al-muawwidzatain-turun", "Setelah al-mu‘awwiżatain turun",
        f"Abu Sa'id al-Khudri meriwayatkan: Rasulullah ﷺ dahulu memohon perlindungan dari jin dan dari mata manusia, "
        f"sampai turun al-mu‘awwiżatain. Setelah keduanya turun, beliau memakai keduanya dan meninggalkan yang lain. "
        f"An-Nawawi mencantumkannya ({c('riyad-1015')}) dan menyebut at-Tirmidzi menilainya hasan.",
        surah_refs(D, 113, 114), ["riyad-1015"],
        extra_src=[ik_src("tirmidzi-hasan", "riwayat Abu Sa'id, penilaian at-Tirmidzi: hasan")], shared=list(PAIR),
        notes=["Rekaman tafsir Ibnu Katsir di korpus platform (113:1) menulis penilaian at-Tirmidzi 'hasan shahih'; "
               "cetakan as-Salamah jil. 8 hlm. 534 dan Riyad as-Salihin menulis 'hasan'. Kartu memakai 'hasan'."])
    L.need("setelah-al-muawwidzatain-turun", "riwayat ini ada di rekaman tafsir korpus 113:1",
           H.tafsir_has("tirmidzi-hasan"))
    return F


# ---------------------------------------------------------------- not sourced / needs an external source
NOT_SOURCED = {
    "al-ikhlas": [
        "Sebab turun (kaum musyrik meminta Nabi menyebut nasab Tuhannya): riwayat Ubay bin Ka'b lewat Ahmad dan "
        "at-Tirmidzi tidak ada di koleksi hadits korpus; Ibnu Katsir (jil. 8, hlm. 518) menukilnya bersama catatan "
        "at-Tirmidzi bahwa jalur mursal lebih sahih. Tidak dimuat; perlu sumber takhrij luar.",
        "Nama-nama lain surah selain Surah Ash-Shamad (ad-Dani): perlu sumber seperti al-Itqan dengan halaman; tidak "
        "dimuat.",
        "Pernyataan Ibnu Katsir (jil. 8, hlm. 528) bahwa lafaz aḥad dalam kalimat positif hanya dipakai untuk Allah: "
        "tidak dimuat, karena daftar 74 kemunculan memuat bentuk positif seperti aḥadakum (18:19) sehingga mudah "
        "disalahpahami tanpa penjelasan ulama.",
        "Makna 'setara dengan sepertiga Al-Qur'an' (pahala atau kandungan): tidak dimuat; perlu syarah hadits "
        "(mis. Fath al-Bari) dengan halaman.",
        "Qira'at kufuwan (kufu’an, kuf’an): perlu an-Nasyr dengan halaman; tidak dimuat.",
        "Jumlah huruf (ad-Dani: 47): tidak dimuat, karena plan §4.5 melarang klaim hitungan huruf.",
    ],
    "al-falaq": [
        "Sebab turun Al-Falaq dan An-Nas terkait sihir Labid bin al-A'sham: hadits sihir di korpus (Sahih al-Bukhari "
        "3268, 5763, 5766, 6391; Sahih Muslim 2189a) tidak menyebut turunnya kedua surah; kaitan itu ada dalam "
        "riwayat ats-Tsa'labi tanpa sanad yang dinukil Ibnu Katsir. Tidak dimuat; perlu sumber takhrij luar.",
        "Membaca al-mu‘awwiżāt setiap selesai shalat (Abu Dawud, at-Tirmidzi, an-Nasa'i): tidak ada di korpus.",
        "Hadits 'Uqbah bin 'Amir bahwa tidak ada bacaan perlindungan yang menyamai keduanya (an-Nasa'i, Abu Dawud): "
        "tidak ada di koleksi korpus (hanya dinukil Ibnu Katsir).",
        "Penafsiran gāsiq sebagai bulan (hadits Aisyah dari Ahmad dan at-Tirmidzi, dinukil Ibnu Katsir): tidak dimuat "
        "sebagai hadits karena tidak ada di koleksi korpus.",
        "Arti dasar akar kata (Maqayis, al-Mishbah) untuk akar di surah ini: tidak ditulis di kartu; tempatnya di "
        "perpustakaan Akar.",
        "Jumlah huruf (ad-Dani: 79): tidak dimuat (plan §4.5).",
    ],
    "an-nas": [
        "Sebab turun terkait sihir Labid bin al-A'sham: lihat catatan Al-Falaq; tidak dimuat.",
        "Membaca al-mu‘awwiżāt setiap selesai shalat: tidak ada di korpus.",
        "Hadits Abu Dzarr tentang berlindung dari setan manusia dan jin (Ahmad, dinukil Ibnu Katsir di 114:6): tidak "
        "ada di koleksi korpus.",
        "Dua pendapat apakah an-nās di 114:5 mencakup jin (Ibnu Katsir, jil. 8, hlm. 540): tidak dibuat kartu; perlu "
        "penjelasan yang lebih panjang.",
        "Jumlah huruf (ad-Dani: 79): tidak dimuat (plan §4.5).",
    ],
}

ORDER = {
    "al-ikhlas": ["ayat-112", "makki-112", "hapax-112", "samad", "ahad", "huwallah", "lam-yakun", "qul", "lima-qul",
                  "sepertiga", "dicintai", "qudsi", "fajar", "tidur", "pagi-petang"],
    "al-falaq": ["ayat-113", "makki-113", "qul-audzu", "hapax-113", "falaq", "ghasiq", "hasad", "min-syarri", "audzu",
                 "lima-qul", "tiada-banding", "turunnya", "ruqyah", "tidur", "pagi-petang"],
    "an-nas": ["ayat-114", "makki-114", "qul-audzu", "an-nas", "rabb-malik-ilah", "malik", "hapax-114", "khannas",
               "jinnah", "min-syarri", "audzu", "pembuka-penutup", "lima-qul", "tiada-banding", "turunnya", "ruqyah",
               "tidur", "pagi-petang"],
}


def build_all(D: Data, H: Hadiths) -> tuple[dict[str, list[dict]], Ledger]:
    L = Ledger()
    F: dict[str, dict] = {}
    for s, slug in SURAHS.items():
        F[f"ayat-{s}"] = f_ayat_kata(D, L, s)
        F[f"makki-{s}"] = f_makkiyah(D, L, s, slug)
        F[f"hapax-{s}"] = f_hapax(D, L, s, slug, root_note=(s == 114))
    F["samad"] = f_samad(D, L, H)
    F["ahad"] = f_ahad(D, L)
    F["huwallah"] = f_huwallah(D, L)
    F["lam-yakun"] = f_lam_yakun(D, L)
    F["qul"] = f_qul(D, L)
    F["lima-qul"] = f_lima_qul(D, L)
    F["lima-qul"]["_shared"] = list(ALL3)
    F["qul-audzu"] = f_qul_audzu(D, L)
    F["falaq"] = f_falaq(D, L, H)
    F["ghasiq"] = f_ghasiq(D, L, H)
    F["hasad"] = f_hasad(D, L)
    F["min-syarri"] = f_min_syarri(D, L)
    F["audzu"] = f_audzu(D, L)
    F["an-nas"] = f_an_nas(D, L)
    F["rabb-malik-ilah"] = f_rabb_malik_ilah(D, L, H)
    F["malik"] = f_malik(D, L)
    F["khannas"] = f_khannas(D, L, H)
    F["jinnah"] = f_jinnah(D, L)
    F["pembuka-penutup"] = f_pembuka_penutup(D, L)
    F.update(hadith_facts(D, L, H))
    out = {slug: [F[k] for k in keys] for slug, keys in ORDER.items()}
    unused = set(F) - {k for keys in ORDER.values() for k in keys}
    if unused:
        raise SystemExit(f"facts built but not placed: {sorted(unused)}")
    return out, L


def inputs_block(D: Data, H: Hadiths) -> dict:
    return {
        "tanzil": f"uthmani-1.1 sha256:{D.tz_sha}",
        "tanzil_metadata": f"1.0 sha256:{D.meta_sha}",
        "qac": f"0.4 sha256:{D.qac_sha}",
        "corpus": {fn: f"sha256:{sha}" for fn, sha in H.file_sha.items()},
        "hadith_mapping": {fn: f"sha256:{sha}" for fn, sha in H.map_sha.items()},
        "kitab_pages": "ad-Dani al-Bayan (Shamela 5542), Ibnu Katsir ed. as-Salamah (Shamela 8473), Darwisy "
                       "(Shamela 2163): halaman cetak dari judul halaman Shamela, dicek 2026-10-09",
    }


COMMENT_FACTS = ("Kartu 'Tahukah kamu?' surah {name} (schema.ts Fact), dihasilkan oleh "
                 "belajar/pipeline/facts_muawwidzat.py dari Tanzil Uthmani 1.1 + QAC 0.4 (dipin sha256), kutipan kitab "
                 "dengan jilid/halaman, dan hadits dari korpus platform. Jangan diedit tangan: jalankan ulang skripnya. "
                 "status 'draft' adalah status pipeline (plan L11). Kunci berawalan '_' "
                 "hanya untuk pipeline dan tidak dikirim ke aplikasi.")
COMMENT_HADITH = ("Hadits surah {name} (schema.ts Hadith), dicari di korpus platform api/data dan disalin byte-per-byte "
                  "oleh belajar/pipeline/facts_muawwidzat.py. 'hadith' = rekaman yang lengkap menurut schema.ts (punya "
                  "terjemahan Indonesia dari korpus). '_needs_indonesian' = rekaman tanpa terjemahan Indonesia di korpus "
                  "(al-Bukhari, Riyad as-Salihin); tidak dikirim sampai ada terjemahan bersumber. Tidak ada terjemahan "
                  "yang ditulis di sini. status 'draft' = status pipeline (plan L11).")


def payloads(D: Data, H: Hadiths) -> tuple[dict[str, dict], Ledger]:
    facts, L = build_all(D, H)
    inp = inputs_block(D, H)
    out = {}
    for s, slug in SURAHS.items():
        ids = {f["id"] for f in facts[slug]}
        rows = [r for r in L.rows if r["fact"] in ids]
        out[f"{slug}.facts.generated.json"] = {
            "_comment": COMMENT_FACTS.format(name=NAME[s]), "surah": s, "slug": slug,
            "_generated_by": "belajar/pipeline/facts_muawwidzat.py (Python stdlib, tanpa LLM)",
            "_inputs": inp,
            "_self_check": {"figures": len(rows), "failed": sum(1 for r in rows if not r["ok"]), "rows": rows},
            "_not_sourced": NOT_SOURCED[slug],
            "facts": facts[slug],
        }
        recs = [dict(r, _used_by_facts=sorted(f["id"] for f in facts[slug] if r["citation"] in f.get("_hadith", [])))
                for r in H.records.values() if slug in r["_slugs"]]
        out[f"{slug}.hadith.json"] = {
            "_comment": COMMENT_HADITH.format(name=NAME[s]), "surah": s, "slug": slug,
            "_generated_by": "belajar/pipeline/facts_muawwidzat.py (Python stdlib, tanpa LLM)",
            "_inputs": {k: inp[k] for k in ("corpus", "hadith_mapping")},
            "_search_normalisation": HADITH_NORM_RULE,
            "_record_sha256": ("sha256 dari json.dumps(rekaman korpus, ensure_ascii=False, sort_keys=True, "
                               "separators=(',', ':')) dalam UTF-8"),
            "hadith": [r for r in recs if "id" in r],
            "_needs_indonesian": [r for r in recs if "id" not in r],
            "_not_used": [x for x in H.not_used if slug in x["slugs"]],
            "_en_note": ("_en adalah kolom en korpus apa adanya (terjemahan Inggris pihak ketiga, berhak cipta menurut "
                         "docs/belajar-research/kitabs.md); di beberapa tempat penerjemah menambah keterangan dalam "
                         "kurung yang tidak ada di teks Arab (mis. Sahih al-Bukhari 5016: '(Surat Al-Falaq and Surat "
                         "An- Nas)'). Dipakai hanya sebagai pembanding, tidak untuk ditampilkan."),
            "_anomalies": [x for x in H.anomalies if any(x.startswith(r["citation"] + ":") for r in recs)],
        }
    return out, L


# ---------------------------------------------------------------- output rules (independent of the builders)
QUOTE = re.compile(r"«([^»]*)»")
KALI_DALAM = re.compile(r"(\d[\d.]*) kali dalam (\d[\d.]*) ayat")
QAC_QUERY = re.compile(r"\b(LEM|ROOT):([^\s;,]+)")
SKB_MARKS = set("āīūḥṣḍṭẓṡż‘’ĀĪŪḤṢḌṬẒṠŻ")
WORD_TOKEN = re.compile(r"[A-Za-zĀāĪīŪūḤḥṢṣḌḍṬṭẒẓṠṡŻż‘’'-]+")
_DEGRADE = str.maketrans({"ā": "a", "ī": "i", "ū": "u", "ḥ": "h", "ṣ": "s", "ḍ": "d", "ṭ": "t", "ẓ": "z", "ṡ": "s",
                          "ż": "z", "‘": "'", "’": "'"})
KNOWN_ASCII = re.compile(r"(?<![\w'‘’])(istaf'ala|al-musta'an|abtadi'u|ibtida'i|hada|ila)(?![\w'‘’])")
NO_REVIEW = re.compile(r"ustadz|tinjauan|ditinjau|menunggu|direview|review", re.I)
FACT_KEYS = ["id", "title", "body", "locations", "method", "sources", "status"]
HADITH_KEYS = ["citation", "ar", "id", "grade", "provenance", "status"]


def check_outputs(P: dict[str, dict], D: Data, H: Hadiths) -> list[str]:
    errs: list[str] = []
    stems = D.C.stems
    prose: list[tuple[str, str]] = []
    for name, data in P.items():
        for k, v in data.items():
            if k in ("_comment", "_not_sourced") and NO_REVIEW.search(json.dumps(v, ensure_ascii=False)):
                errs.append(f"{name}: {k} mentions a review")
        if name.endswith(".facts.generated.json"):
            ids = [f["id"] for f in data["facts"]]
            for dup in sorted({i for i in ids if ids.count(i) > 1}):
                errs.append(f"{name}: duplicate fact id {dup}")
            for f in data["facts"]:
                fp = f"{name} {f['id']}"
                extra = [k for k in f if k not in FACT_KEYS and not k.startswith("_")]
                missing = [k for k in FACT_KEYS if k not in f]
                if extra or missing:
                    errs.append(f"{fp}: keys extra {extra} missing {missing}")
                if not re.fullmatch(r"[a-z0-9-]+", f["id"]):
                    errs.append(f"{fp}: bad id")
                if len(f["title"]) < 5 or len(f["body"]) < 10 or len(f["method"]) < 5:
                    errs.append(f"{fp}: title/body/method too short")
                if f["status"] != "draft":
                    errs.append(f"{fp}: status must be draft")
                if not f["locations"] or f["locations"] != sorted_locs(f["locations"]):
                    errs.append(f"{fp}: locations empty or not sorted/unique")
                for loc in f["locations"]:
                    s, a = (int(x) for x in loc.split(":"))
                    if (s, a) not in D.T.verses:
                        errs.append(f"{fp}: {loc} is not an ayah")
                if not f["sources"]:
                    errs.append(f"{fp}: no sources")
                for sr in f["sources"]:
                    if not isinstance(sr.get("kitab"), str) or len(sr["kitab"]) < 2:
                        errs.append(f"{fp}: source without kitab")
                    if "url" in sr and not re.match(r"https?://\S+$", sr["url"]):
                        errs.append(f"{fp}: bad url {sr['url']}")
                    if re.search(r"Darwis[yh]", sr["kitab"]) and (sr["kitab"] != DARWISY or
                                                                   not re.search(r"hlm\. \d+", sr.get("ref", ""))):
                        errs.append(f"{fp}: Darwisy ref malformed")
                for fld in ("title", "body", "method"):
                    text = f[fld]
                    prose.append((f"{fp}.{fld}", text))
                    for m in QUOTE.finditer(text):
                        if m.group(1) not in D.T.raw:
                            errs.append(f"{fp}.{fld}: «{m.group(1)}» is not a byte-exact Tanzil substring")
                    for run in ARABIC_RUN.findall(QUOTE.sub(" ", text)):
                        if any(len(tok) != 1 for tok in run.split()):
                            errs.append(f"{fp}.{fld}: unquoted Arabic {run!r}")
                    if NO_REVIEW.search(text):
                        errs.append(f"{fp}.{fld}: mentions a review")
                for fld in ("title", "body"):
                    if re.search(r"\b[A-Z]{3,}\b", f[fld]):
                        errs.append(f"{fp}.{fld}: ALL CAPS word")
                    if re.search(r"\bkamu\b", f[fld], re.I):
                        errs.append(f"{fp}.{fld}: 'kamu' register (use Anda)")
                n_loc = len(f["locations"])
                for m in KALI_DALAM.finditer(f["body"]):
                    n, a = int(m.group(1).replace(".", "")), int(m.group(2).replace(".", ""))
                    if a != n_loc or n <= a:
                        errs.append(f"{fp}: '{m.group(0)}' does not fit {n_loc} locations")
                m = re.search(r"(\d[\d.]*) kali", f["title"])
                if m:
                    n = int(m.group(1).replace(".", ""))
                    if n != n_loc and f"{fmt(n)} kali dalam {fmt(n_loc)} ayat" not in f["body"]:
                        errs.append(f"{fp}: title count {n} vs {n_loc} locations not restated in body")
                for sr in f["sources"]:
                    if not sr["kitab"].startswith("Quranic Arabic Corpus"):
                        continue
                    for key, val in QAC_QUERY.findall(sr.get("ref", "")):
                        hits = [g for g in stems if g.feat.get(key) == val]
                        ayat = {f"{g.s}:{g.a}" for g in hits}
                        if not hits:
                            errs.append(f"{fp}: QAC query {key}:{val} matches nothing")
                        elif ayat == set(f["locations"]) and len(hits) != len(ayat) and \
                                f"{fmt(len(hits))} kali dalam {fmt(len(ayat))} ayat" not in f["body"]:
                            errs.append(f"{fp}: {key}:{val} needs '{len(hits)} kali dalam {len(ayat)} ayat'")
                if "QAC" in f["method"]:
                    mm = QAC_BASIS_RE.search(f["method"])
                    if not mm or {int(x) for x in re.findall(r"\d+", mm.group(1))} - set(SURAHS):
                        errs.append(f"{fp}: QAC basis note missing or names an unchecked surah")
        else:
            for part in ("hadith", "_needs_indonesian"):
                for h in data[part]:
                    hp = f"{name} {h.get('citation')}"
                    extra = [k for k in h if k not in HADITH_KEYS and not k.startswith("_")]
                    if extra:
                        errs.append(f"{hp}: keys outside schema {extra}")
                    need = HADITH_KEYS if part == "hadith" else [k for k in HADITH_KEYS if k != "id"]
                    for k in need:
                        if k not in h:
                            errs.append(f"{hp}: missing {k}")
                    if part == "_needs_indonesian" and "id" in h:
                        errs.append(f"{hp}: has id but is filed under _needs_indonesian")
                    if h.get("status") != "draft" or len(h.get("citation", "")) < 5 or len(h.get("grade", "")) < 3:
                        errs.append(f"{hp}: status/citation/grade")
                    pv = h["provenance"]
                    coll, hn = pv["collection"], int(pv["point"].rsplit(" ", 1)[1])
                    r = H.by_hn[coll][hn]
                    if h["ar"] != r["ar"]:
                        errs.append(f"{hp}: ar is not the corpus record's ar byte for byte")
                    if "id" in h and h["id"] != r.get("id"):
                        errs.append(f"{hp}: id is not the corpus record's id verbatim")
                    if h.get("_en") != r.get("en"):
                        errs.append(f"{hp}: _en is not the corpus record's en verbatim")
                    if pv["sha256"] != record_sha(r):
                        errs.append(f"{hp}: provenance sha256 mismatch")
                    canon, _ = H.canonical(coll, r)
                    if h["citation"] != f"{r['citation_en'].rsplit(' ', 1)[0]} {canon}":
                        errs.append(f"{hp}: citation does not re-derive")
                    if NO_REVIEW.search(h["grade"] + " ".join(h.get("_notes", []))):
                        errs.append(f"{hp}: grade/notes mention a review")
    # transliteration: SKB words never mixed with ASCII apostrophes, no capital after the article hyphen
    skb = {t for _, text in prose for t in WORD_TOKEN.findall(text) if set(t) & SKB_MARKS}
    degraded = {t.lower().translate(_DEGRADE).strip("'-"): t for t in skb}
    for path, text in prose:
        for m in KNOWN_ASCII.finditer(text):
            errs.append(f"{path}: ASCII transliteration {m.group(1)!r} (validate.py rule 10)")
        for t in WORD_TOKEN.findall(text):
            if set(t) & SKB_MARKS:
                if "'" in t:
                    errs.append(f"{path}: {t!r} mixes an ASCII apostrophe with SKB letters")
                if any(x[:1].isupper() and not x.startswith("All") for x in t.split("-")[1:]):
                    errs.append(f"{path}: {t!r}: capital after the hyphen")
            elif "'" in t and t.lower().strip("'-") in degraded:
                errs.append(f"{path}: {t!r} is an ASCII spelling of {degraded[t.lower().strip(chr(39) + '-')]!r}")
    # shared facts must be identical wherever they appear
    seen: dict[str, str] = {}
    for name, data in P.items():
        for f in data.get("facts", []):
            js = json.dumps(f, ensure_ascii=False, sort_keys=True)
            if f["id"] in seen and seen[f["id"]] != js:
                errs.append(f"fact id {f['id']} differs between files")
            seen.setdefault(f["id"], js)
    return errs


def dump(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=2) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--corpus", default=os.environ.get("BELAJAR_HADITH_CORPUS"),
                    help="platform corpus directory (api/data); env BELAJAR_HADITH_CORPUS")
    ap.add_argument("--check", action="store_true", help="recompute and compare with the files; write nothing")
    args = ap.parse_args()
    corpus = Path(args.corpus) if args.corpus else PIPELINE.parent.parent / "api" / "data"
    D = Data(load_sources())
    H = Hadiths(corpus, D)
    P, L = payloads(D, H)
    bad_rows = [r for r in L.rows if not r["ok"]]
    errs = [f"self-check {r['fact']}: {r['what']}: {r['value']!r} != {r['recheck']!r} ({r['how']})"
            for r in bad_rows]
    errs += check_outputs(P, D, H)
    if args.check:
        for name, data in P.items():
            p = AUTHORED / name
            if not p.exists():
                errs.append(f"{name}: missing on disk")
            elif p.read_text(encoding="utf-8") != dump(data):
                errs.append(f"{name}: differs from a fresh run (stale or hand-edited)")
            else:
                errs += [f"(on disk) {e}" for e in check_outputs({name: json.loads(p.read_text(encoding='utf-8'))}, D, H)]
    if errs:
        print("FAILED:", file=sys.stderr)
        for e in errs:
            print("  - " + e, file=sys.stderr)
        return 1
    if not args.check:
        for name, data in P.items():
            (AUTHORED / name).write_text(dump(data), encoding="utf-8")
    n_f = {n: len(d["facts"]) for n, d in P.items() if "facts" in d}
    n_h = {n: (len(d["hadith"]), len(d["_needs_indonesian"])) for n, d in P.items() if "hadith" in d}
    print(("checked" if args.check else "wrote") + f": facts {n_f}; hadith (with id, needs Indonesian) {n_h}; "
          f"{len(L.rows)} figures re-derived, 0 differ")
    for a in H.anomalies:
        print("anomaly: " + a)
    return 0


if __name__ == "__main__":
    sys.exit(main())
