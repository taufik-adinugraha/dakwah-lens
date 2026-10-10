#!/usr/bin/env python3
"""Stage 2 (Ilmu Waris): write the dalil files under belajar/content/waris/. Stdlib only.

    python3 build_waris.py           # writes the four files below; exit 1 if dalil.json != the docs copy
    python3 build_waris.py --rules-only   # step 4 only (needs no corpus: no api/data, no pipeline cache)

1. dalil.json        build_dalil.build(), serialised exactly as the research file. While
                     docs/waris-research/dalil.json exists it is canonical (the research phase):
                     the build fails unless the two are byte-identical.
2. dalil-gaps.json   the plan §8 gap list (docs/waris-plan.md §8 "Gaps to extract in M1" and
                     "Still external"). Located gaps are extracted here with the same record shapes
                     and byte rules as dalil.json; what the corpus cannot ground is an explicit
                     `kind: "gap"` record that names what is needed. They live in their own file
                     because dalil.json must stay byte-identical to the docs copy; record ids never
                     collide with dalil.json, so a reader can take the union.
3. dalil-provenance.json
                     for every record of both files that copies or points at corpus bytes: the
                     source (pinned input id or api/data file), the locator, the sha256 of the whole
                     source field and of the copied bytes. validate_waris.py recomputes all of it.
4. rules.json        the RuleNote drafts (plan §9.2, M1.6): pipeline/authored/waris.rules.json, one note
                     per engine rule id, re-ordered into the registry order of src/lib/waris/registry.ts
                     (the single source of rule ids) with every optional field written out. The build
                     fails if a registry id has no note, a note names an id the registry lacks, or an id
                     has two notes; validate_waris.py and assertWarisReferences() check the rest.

Nothing is retyped: Arabic and translations are whole fields or offset slices of the sources;
excerpt boundaries are located with ar.find_orig and cut from the original string. The Indonesian
`gist_id` lines and the English notes are authoring summaries for lesson writers (draft, not
reviewed); they are never shown as dalil and carry no Arabic script.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

import build_dalil
from ar import D, elide, find_orig, load, running_head_spans
from build_dalil import fawaz_path, muslim_canon_from, pinned_file, quranenc_path
from common import CONTENT_DIR, PIPELINE, load_sources, require_pinned

REPO = PIPELINE.parents[1]
OUT_DIR = CONTENT_DIR / "waris"
OUT_DALIL = OUT_DIR / "dalil.json"
OUT_GAPS = OUT_DIR / "dalil-gaps.json"
OUT_PROV = OUT_DIR / "dalil-provenance.json"
DOCS_DALIL = REPO / "docs" / "waris-research" / "dalil.json"
DRAFT = "draft"


def sha_text(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def sha_file(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def dump(data) -> str:
    return json.dumps(data, ensure_ascii=False, indent=1) + "\n"


# ---------------------------------------------------------------- corpus (loaded once)
class Corpus:
    def __init__(self, src: dict):
        self.src = src
        self.tanzil_path = require_pinned(src, "tanzil_uthmani")
        self.tanzil = {}
        for line in open(self.tanzil_path, encoding="utf-8"):
            p = line.rstrip("\n").split("|")
            if len(p) == 3 and p[0].isdigit():
                self.tanzil[(int(p[0]), int(p[1]))] = p[2]
        self.quran = {(int(r["surah"]), int(r["ayah"])): r for r in load("quran.json")}
        self.qe: dict[tuple[int, int], dict] = {}
        self.qe_file: dict[int, Path] = {}
        for s in src["inputs"]["quranenc_indonesian_affairs_waris"]["suras"]:
            p = quranenc_path(src, s)
            self.qe_file[s] = p
            for r in json.load(open(p, encoding="utf-8"))["result"]:
                self.qe[(int(r["sura"]), int(r["aya"]))] = r
        self.bukhari = {str(r["hadithnumber"]): r for r in load("bukhari.json")}
        self.muslim = {int(r["hadithnumber"]): r for r in load("muslim.json")}
        self.bulugh = {int(r["hadithnumber"]): r for r in load("bulugh-al-maram.json")}
        self.fiqh = {f: {str(r["section_id"]): r for r in load(f)}
                     for f in ("fath-al-qarib.json", "fath-al-muin.json", "fiqh-as-sunnah.json", "al-umm.json")}
        self.tafsir = {f: {(int(r["surah"]), int(r["ayah"])): r for r in load(f)}
                       for f in ("tafsir-ibn-kathir.json", "tafsir-al-tabari.json")}
        self.fz: dict[int, dict] = {}
        for n in src["inputs"]["fawazahmed0_muslim_sections"]["sections"]:
            for h in json.load(open(fawaz_path(src, n), encoding="utf-8"))["hadiths"]:
                self.fz[h["hadithnumber"]] = h


# ---------------------------------------------------------------- helpers shared with validate_waris.py
# The Bulugh editor's footnote block starts at the first "RLM 1 space RLM hyphen"; the matn ends with
# Ibn Hajar's attribution plus the in-text marker of that footnote. Same rule as build_dalil.py.
FOOT = re.compile("‏1 ‏-")
GRADE = re.compile(r"(?:^|‏)(\d) ‏- ([^.‏]+)")


def split_bulugh(t: str) -> tuple[str, str]:
    m = FOOT.search(t)
    if not m:
        return t, ""
    body = re.sub("\\s*\\d‏\\s*\\.?‏*$", "", t[:m.start()])
    return body, t[m.start() + 1:]


def excerpt(text: str, start: str, end: str, nth_start: int = 0) -> tuple[int, int, str]:
    ss = find_orig(text, start)
    if len(ss) <= nth_start:
        raise SystemExit(f"start not found: {start}")
    a = ss[nth_start][0]
    ee = [x for x in find_orig(text, end) if x[1] > a]
    if not ee:
        raise SystemExit(f"end not found: {end}")
    b = ee[0][1]
    return a, b, text[a:b]


# ---------------------------------------------------------------- the plan §8 gap list
SURAH = {2: "Al-Baqarah", 4: "An-Nisa'", 33: "Al-Ahzab", 42: "Asy-Syura", 49: "Al-Hujurat", 60: "Al-Mumtahanah"}
QE_LABEL = ('QuranEnc indonesian_affairs v1.0.1 ("Terjemahan Berbahasa Indonesia - Kementerian Agama" as QuranEnc '
            'names it; not the official Kemenag 2019 v1122 text)')
M1 = 'docs/waris-plan.md §8 "Gaps to extract in M1"'

# (surah, ayah), plan row it closes, rules it would ground once the rule table may change, gist, notes
GAP_QURAN = [
    ((33, 4), M1 + ": ayat QS 33:4-5 (row mani.anak_angkat; cited by Fatwa MUI Adopsi 1984); lessons L3, L8", [],
     "Allah tidak menjadikan anak angkat sebagai anak kandung; sebutan itu hanya ucapan di mulut.", []),
    ((33, 5), M1 + ": ayat QS 33:4-5 (row mani.anak_angkat; cited by Fatwa MUI Adopsi 1984); lessons L3, L8", [],
     "Anak angkat dipanggil dengan nama ayah kandungnya; bila ayahnya tidak diketahui, mereka saudara seagama dan maula.", []),
    ((4, 34), M1 + ": ayat QS 4:34 (lesson L5, the nafkah hikmah of 2:1)", [],
     "Laki-laki (suami) pelindung bagi perempuan (istri), antara lain karena memberi nafkah dari hartanya.",
     ["Plan L5: the nafkah explanation of 2:1 is a hikmah, never 'the reason' of the share. Only the first clause "
      "concerns the track; the rest of the ayah is about nusyuz. The reviewer decides whether a span of the first "
      "clause is shown."]),
    ((4, 128), M1 + ": ayat QS 4:128 (lesson L9, perdamaian)", [],
     "Bila istri khawatir suaminya nusyuz atau acuh, keduanya boleh berdamai; perdamaian itu lebih baik.",
     ["The ayah is about reconciliation between spouses; using it for a settlement among heirs is an analogy the "
      "lesson must present as such (reviewer)."]),
    ((49, 10), M1 + ": ayat QS 49:10 (lesson L9)", [],
     "Orang-orang mukmin bersaudara; damaikanlah saudara yang berselisih dan bertakwalah agar mendapat rahmat.", []),
    ((42, 38), M1 + ": ayat QS 42:38 (lesson L9, musyawarah)", [],
     "Urusan orang-orang beriman diputuskan dengan musyawarah di antara mereka.", []),
    ((2, 188), M1 + ": ayat QS 2:188 (lesson L9)", [],
     "Jangan memakan harta sesama dengan cara batil, termasuk membawanya kepada hakim untuk mengambil sebagian harta orang lain.", []),
    ((4, 10), M1 + ": ayat QS 4:10 (lesson L9, the orphan card)", [],
     "Orang yang memakan harta anak yatim secara zalim sebenarnya menelan api ke dalam perutnya.", []),
    ((60, 8), M1 + ": ayat QS 60:8 (only if the reviewer wants it for case 11's tone line)", [],
     "Allah tidak melarang berbuat baik dan berlaku adil kepada orang yang tidak memerangi kaum muslimin karena agama "
     "dan tidak mengusir mereka.",
     ["Plan §8: extract only if the reviewer wants it for case 11's tone line (a non-Muslim relative)."]),
]

# Bukhari number, plan row, would_ground, gist, notes
GAP_BUKHARI = [
    ("2586", M1 + ": Bukhari 2586 (row E-HIDUP: be fair among children; lesson L8)", [],
     "An-Nu'man bin Basyir: ayahnya memberinya seorang budak; Nabi bertanya apakah semua anaknya diberi yang sama, "
     "lalu menyuruh pemberian itu ditarik kembali.", []),
    ("2587", M1 + ": Bukhari 2587 (row E-HIDUP: be fair among children; lesson L8)", [],
     "An-Nu'man bin Basyir: Nabi memerintahkan bertakwa kepada Allah dan berlaku adil di antara anak-anak; ayahnya "
     "lalu menarik kembali pemberiannya.", []),
    ("5986", M1 + ": Bukhari 5986 (lesson L9, silaturahim)", [],
     "Siapa ingin dilapangkan rezekinya dan dipanjangkan umurnya, hendaklah menyambung silaturahim.", []),
    ("5987", M1 + ": Bukhari 5987 (lesson L9, silaturahim)", [],
     "Rahim (kekerabatan) berlindung kepada Allah dari pemutusan; Allah menyambung orang yang menyambungnya dan "
     "memutus orang yang memutusnya.",
     ["The matn ends with the Prophet saying 'read, if you wish' and QS 47:22; that ayah is not extracted here."]),
]
GAP_MUSLIM = [
    ("1623e", M1 + ": Muslim 1623e (row E-HIDUP: be fair among children; lesson L8)", [],
     "An-Nu'man bin Basyir: ayahnya bersedekah sebagian hartanya kepadanya; Nabi memerintahkan bertakwa dan berlaku "
     "adil di antara anak-anak, lalu sedekah itu dikembalikan.", []),
]
GAP_BULUGH = [
    (649, M1 + ": Bulugh local 649 (lesson L2, debt)", [],
     "Jiwa orang mukmin tergantung pada utangnya sampai utang itu dilunasi.",
     ["Supports the seriousness of debt; it does not state the order debt-before-wasiyya (that rests on 4:11-12 + "
      "reported ijma', F-ALUMM-572, T-IK-4-11-dayn).",
      "Ibn Hajar's attribution: Ahmad and at-Tirmidhi, who called it hasan; the tahqiq footnote grades it sahih by "
      "witnesses and names Ahmad 2/440, 475, 508 and at-Tirmidhi 1078, 1079 (primaries not in the corpus, see G-E6).",
      "Corpus 'book' field = 3; the chapter name is not in the record (not verified here)."]),
]

# id, (file, key), start phrase, end phrase, plan row, would_ground, gist, notes, nth start match
FQ_FILES = {"FM": "fath-al-muin.json", "FS": "fiqh-as-sunnah.json", "UM": "al-umm.json", "FQ": "fath-al-qarib.json"}
BOOK = {"fath-al-qarib.json": "Fath al-Qarib al-Mujib (Ibn Qasim al-Ghazzi), Kitab Ahkam al-Fara'id wa al-Wasaya",
        "fath-al-muin.json": "Fath al-Mu'in (Zayn al-Din al-Malibari)",
        "fiqh-as-sunnah.json": "Fiqh as-Sunnah (Sayyid Sabiq)",
        "al-umm.json": "al-Umm (al-Shafi'i)",
        "tafsir-ibn-kathir.json": "Tafsir Ibn Kathir (AR)",
        "tafsir-al-tabari.json": "Tafsir al-Tabari, Jami' al-Bayan (AR)"}
GAP_EXCERPTS = [
    ("T-IK-4-11-mother-siblings", ("tafsir-ibn-kathir.json", (4, 11)),
     "والحال الثالث من أحوال الأبوين", "أخذ الأب الباقي",
     M1 + ": Ibn Kathir 4:11, the sentence that blocked siblings still reduce the mother (row fardh.ibu_*; "
     "engine.md §0.1, EQ14; lesson L6)", ["R-mother-third-sixth", "R-hajb-siblings"],
     "Ibnu Katsir: bila ayah dan ibu bersama saudara-saudara (kandung, seayah, atau seibu), saudara tidak mewarisi "
     "bersama ayah, tetapi tetap menurunkan bagian ibu dari 1/3 ke 1/6; sisanya untuk ayah.",
     ["The next sentence (two brothers count as 'ikhwah' for the jumhur) is left out; T-TB-4-11-ikhwa-two covers it."], 0),
    ("T-IK-4-11-jahiliyyah", ("tafsir-ibn-kathir.json", (4, 11)),
     "أي يأمركم بالعدل فيهم", "فجعل للذكر مثل حظ الأنثين",
     M1 + ": Ibn Kathir 4:11, the jahiliyyah practice (lesson L1, from the Arabic, not the English edition)",
     ["R-women-inherit", "R-2to1"],
     "Ibnu Katsir: ayat ini memerintahkan adil di antara anak; orang Jahiliah memberikan seluruh warisan kepada "
     "laki-laki, lalu Allah menyamakan keduanya dalam hak dasar waris dan membedakan kadarnya (2:1).",
     ["Ends before Ibn Kathir's nafkah explanation of 2:1 (a hikmah, never 'the reason', plan L5). The source spells "
      "'al-untsayayn' without the second ya' here; the bytes are kept as they are."], 0),
    ("F-ALUMM-556-jadd", ("al-umm.json", "556"),
     "وقلنا إذا ورث الجد مع الإخوة", "وكان المال للجد دونهم",
     M1 + ": al-Umm §556 (C805), Zayd's muqasamah (row fardh.kakek_1_6, jadd.*)", ["R-grandfather"],
     "Asy-Syafi'i: kakek bersama saudara mendapat yang lebih baik antara muqasamah (berbagi bersama saudara) dan 1/3; "
     "ini pendapat Zaid bin Tsabit, juga diriwayatkan dari Umar dan Utsman. Pendapat lain (Abu Bakar, Aisyah, Ibnu "
     "Abbas, dan lainnya): kakek seperti ayah, sehingga saudara gugur.",
     ["'Ruwiya' (reported) for Umar and Uthman: no chain in the excerpt. Plan §8: never use H-BULUGH-1101 or "
      "H-BULUGH-1110 (both da'if) as the reason for following Zayd."], 0),
    ("F-ALUMM-559-musyarakah", ("al-umm.json", "559"),
     "قلنا: إن المشركة زوج وأم", "ويشركهم بنو الأب",
     M1 + ": al-Umm §559 (C809), the Syafi'i tasyrik (row musytarakah)", ["R-special-cases"],
     "Asy-Syafi'i: masalah musyarakah (suami, ibu, dua saudara laki-laki kandung, dua saudara seibu): suami 1/2, ibu "
     "1/6, saudara seibu 1/3, dan saudara kandung ikut berbagi bersama mereka.",
     ["The corpus record ends mid-sentence right after this clause; the reasoning continues in al-Umm §560 (not "
      "extracted). T-IK-4-12-musytaraka records that the case is a khilaf."], 0),
    ("F-FSUNNAH-843-syarat", ("fiqh-as-sunnah.json", "843"),
     "يشترط للارث شروط ثلاثة", "ألا يوجد مانع من موانع الارث",
     M1 + ": Fiqh as-Sunnah §843 (refusal pages: gharqa; the heir must outlive the deceased)", [],
     "Tiga syarat waris: pewaris wafat (nyata atau menurut putusan hakim), ahli waris hidup saat pewaris wafat, dan "
     "tidak ada penghalang. Korban tenggelam, terbakar, atau tertimpa reruntuhan yang tidak diketahui siapa wafat "
     "lebih dulu tidak saling mewarisi.", [], 0),
    ("F-FSUNNAH-847-mutallaqa", ("fiqh-as-sunnah.json", "847"),
     "الزوجة المطلقة طلاقا رجعيا ترث من زوجها", "وعليها عدة الوفاة",
     M1 + ": Fiqh as-Sunnah §847 (C1090), divorce in 'iddah (+ reviewer R14)", ["R-spouses"],
     "Istri yang ditalak raj'i mewarisi suaminya bila suami wafat sebelum iddahnya habis; mazhab Hanbali juga "
     "mewariskan istri yang ditalak saat suami sakit menjelang wafat, selama ia belum menikah lagi.",
     ["The Syafi'i position on a final divorce in the husband's last illness is not stated in this span. The next "
      "sentence quotes Egyptian law and is left out."], 0),
    ("F-FSUNNAH-860-mafqud", ("fiqh-as-sunnah.json", "860"),
     "إذا غاب الشخص وانقطع خبره", "لاحتمال أن يكون حيا",
     M1 + ": Fiqh as-Sunnah §860 (refusal page: mafqud)", [],
     "Mafqud: orang hilang yang tidak diketahui hidup atau matinya; kematiannya ditetapkan hakim, berdasarkan bukti "
     "(pasti) atau lewatnya waktu (secara hukum).",
     ["The corpus record ends mid-sentence in the scholars' views on the waiting period; that part is left out."], 0),
    ("F-FSUNNAH-861-mafqud-mirath", ("fiqh-as-sunnah.json", "861"),
     "ميراث المفقود يتعلق به أمران", "أو وقت الحكم بالموت",
     M1 + ": Fiqh as-Sunnah §861 (refusal page: mafqud)", [],
     "Bila orang hilang itu pewaris: hartanya tetap miliknya dan tidak dibagi sampai kematiannya pasti atau diputus "
     "hakim; lalu diwarisi ahli waris yang ada pada saat itu.",
     ["The Egyptian law article quoted earlier in the record is left out; the record ends mid-sentence after this span, "
      "and the case of the missing person as an heir is not in the corpus record."], 0),
    ("F-FSUNNAH-862-khuntsa", ("fiqh-as-sunnah.json", "862"),
     "الخنثى شخص اشتبه في أمره", "يقال له خنثى غير مشكل",
     M1 + ": Fiqh as-Sunnah §862 (refusal page: khuntsa)", [],
     "Khuntsa: orang yang tidak jelas laki-laki atau perempuan; bila tanda-tandanya jelas, ia mewarisi sesuai jenis "
     "itu (khuntsa ghairu musykil).", [], 0),
    ("F-FSUNNAH-863-ibn-zina", ("fiqh-as-sunnah.json", "863"),
     "ابن الزنا هو المولود من غير زواج شرعي", 'ولورثتها من بعدها "',
     M1 + ": Fiqh as-Sunnah §863 (row mani.anak_luar_nikah, note only; + Legal Fatwa MUI 11/2012, KHI 186)", [],
     "Anak zina dan anak li'an tidak saling mewarisi dengan ayahnya (dinukil sebagai ijma'), hanya dengan ibunya; "
     "lafaz riwayat yang dikutip menyebut juga ahli waris ibu sesudahnya.",
     ["Secondary citation: Sayyid Sabiq gives the li'an report as 'rawahu al-Bukhari wa Abu Dawud'; the primary is "
      "not extracted here. The Egyptian law article (47) that follows is left out."], 0),
    ("F-FSUNNAH-864-takharuj", ("fiqh-as-sunnah.json", "864"),
     "التخارج هو أن يتصالح الورثة", "والتخارج جائز متى كان عن تراض",
     M1 + ": Fiqh as-Sunnah §864 (row khi.perdamaian, takharuj; + Legal KHI 183)", [],
     "Takharuj: ahli waris berdamai untuk mengeluarkan salah seorang dari bagiannya dengan imbalan tertentu; hukumnya "
     "boleh bila atas dasar saling rela.",
     ["The report that follows (the widow of 'Abd al-Rahman ibn 'Awf and 'Uthman) is given without a chain and is "
      "left out, as is the Egyptian law article (48)."], 0),
    ("F-FSUNNAH-855-radd-zawj", ("fiqh-as-sunnah.json", "855"),
     "وقد أخذ القانون بهذا الرأي", 'أو أحد ذوي الارحام "',
     "review 2026-10-09: Fiqh as-Sunnah §855 (C1098), radd to a spouse as Sayyid Sabiq reports the Egyptian law "
     "(row radd.semua, comparison only; not a plan §8 item)", ["R-radd"],
     "Sayyid Sabiq: undang-undang waris Mesir mengembalikan sisa harta kepada ashabul furudh selain suami atau istri, "
     "kecuali satu keadaan yang mengikuti mazhab Utsman: bila suami atau istri tidak meninggalkan ahli waris lain, ia "
     "mengambil seluruh harta dengan fardh dan radd. Radd kepada suami atau istri itu baru berlaku bila tidak ada "
     "ashabah nasab, ashabul furudh nasabiyah, maupun dzawil arham (pasal 30).",
     ["Describes the Egyptian inheritance law (art. 30) as quoted by Sayyid Sabiq: not Indonesian law and not the "
      "Syafi'i school. It records 'Uthman's view only for a sole surviving spouse; 'Uthman's wider view (radd to "
      "every fardh heir, the spouse included) is G-RADD-SEMUA-UTSMAN.",
      "The span opens with 'this view', which points back to the end of section 854, missing from the corpus "
      "(F-FSUNNAH-854-radd-no-nass breaks off there)."], 0),
]

# What the corpus cannot ground (docs/waris-research/dalil.md §7; plan §8 "Still external" and the
# External cells of the §8 table). Each is an explicit record so a rule note or lesson that needs one
# can point at the gap instead of filling it from memory. English, no Arabic script (no corpus bytes).
EXT = 'docs/waris-plan.md §8 "Still external"'
GAP_EXTERNAL = [
    {"id": "G-E1-sad-ibn-ar-rabi", "source_doc": "docs/waris-research/dalil.md §7 E1", "plan_ref": EXT,
     "item": "Sa'd ibn ar-Rabi''s two daughters: two-thirds to the daughters, one-eighth to the widow, the rest to "
             "the uncle (the classic sabab al-nuzul of 4:11).",
     "corpus_has": "Second-hand only: Fiqh as-Sunnah 840 ('rawahu al-khamsah illa an-Nasa'i'); Ibn Kathir and "
                   "al-Tabari on 4:11.",
     "needed": "The primary source (Abu Dawud, at-Tirmidhi, Ibn Majah), its number, and a grade from a named muhaddith.",
     "related": ["F-FSUNNAH-840-sad-rabi", "S-IK-4-11", "S-TB-4-11"], "rules": ["R-daughters", "R-asbab-nuzul"],
     "plan_rows": ["fardh.anak_pr_*"],
     "display": "Never shown until a named grading is found (plan D10); the two daughters' 2/3 is taught through the 4:176 analogy (T-IK-4-176-two-daughters)."},
    {"id": "G-E2-grandmother-abu-bakr", "source_doc": "docs/waris-research/dalil.md §7 E2", "plan_ref": EXT,
     "item": "Abu Bakr gave the grandmother one-sixth on the testimony of al-Mughira and Muhammad ibn Maslama.",
     "corpus_has": "Not found (normalised search for the phrases of the report in fara'id contexts).",
     "needed": "The primary source (Muwatta', Abu Dawud, at-Tirmidhi) and a grade.",
     "related": ["H-BULUGH-1103", "F-FQARIB-117-furudh"], "rules": ["R-grandmother"], "plan_rows": ["fardh.nenek_1_6"],
     "display": "Meanwhile the grandmother's sixth rests on H-BULUGH-1103 (hasan in the tahqiq) and on fiqh."},
    {"id": "G-E3-first-awl-umar", "source_doc": "docs/waris-research/dalil.md §7 E3", "plan_ref": EXT,
     "item": "'Umar's first 'aul case (husband and two sisters), with al-'Abbas, 'Ali or Zayd advising.",
     "corpus_has": "Fiqh as-Sunnah 852 says only 'ruwiya' (it was reported), with no chain.",
     "needed": "The primary report and a grade, if a lesson tells the story.",
     "related": ["F-FSUNNAH-852-awl-umar", "F-FMUIN-35-awl"], "rules": ["R-awl"], "plan_rows": ["aul"],
     "display": "The rule itself is taught as the Companions' ijtihad (F-FMUIN-35-awl) plus Legal KHI 192."},
    {"id": "G-E4-funeral-first", "source_doc": "docs/waris-research/dalil.md §7 E4", "plan_ref": EXT,
     "item": "The order of claims: funeral costs, then debts, then bequests, then shares.",
     "corpus_has": "Debts before bequests: found (F-ALUMM-572, T-IK-4-11-dayn). Funeral costs from the estate: "
                   "found (F-FMUIN-11-tajhiz). That funeral costs come first: not found.",
     "needed": "A Syafi'i source for the order of claims on the estate.",
     "related": ["F-FMUIN-11-tajhiz", "F-ALUMM-572", "T-IK-4-11-dayn"], "rules": ["R-tajhiz", "R-debt-wasiyya-first"],
     "plan_rows": ["estate.biaya"],
     "display": "Cite Legal KHI 175(1) for the order until a kitab source is extracted."},
    {"id": "G-E5-bulugh-canonical-numbers", "source_doc": "docs/waris-research/dalil.md §7 E5", "plan_ref": EXT,
     "item": "Canonical sunnah.com numbers for the Bulugh fara'id and wasaya hadith.",
     "corpus_has": "Local AhmedBaset numbers (1095-1119, and 649); tohed.com shows a third numbering (805-817).",
     "needed": "A sunnah.com API key, or a manual read of sunnah.com/bulugh, then a mapping.",
     "related": ["H-BULUGH-1095", "H-BULUGH-1107", "H-BULUGH-1114", "H-BULUGH-649"], "rules": [], "plan_rows": [],
     "display": "Show the primary source a Bulugh entry names, never a Bulugh number (plan D10)."},
    {"id": "G-E6-bulugh-primary-collections", "source_doc": "docs/waris-research/dalil.md §7 E6", "plan_ref": EXT,
     "item": "The primary sources behind Bulugh entries that are not Bukhari or Muslim (Abu Dawud 2895, 2899, 3565; "
             "at-Tirmidhi 2103, 2120; Ibn Majah 2713, 2737; ad-Daraqutni 4/98; an-Nasa'i al-Kubra; for local 649: "
             "Ahmad 2/440, 475, 508 and at-Tirmidhi 1078, 1079).",
     "corpus_has": "Only as numbers inside the Bulugh editor's footnotes.",
     "needed": "Those collections in the corpus, checked against the cited numbers.",
     "related": ["H-BULUGH-1103", "H-BULUGH-1114", "H-BULUGH-649"], "rules": ["R-no-wasiyya-heir", "R-grandmother"],
     "plan_rows": [],
     "display": "Show them as 'dikutip dalam Bulugh al-Maram' until they are added and checked."},
    {"id": "G-E7-learn-faraid", "source_doc": "docs/waris-research/dalil.md §7 E7", "plan_ref": EXT,
     "item": "Hadith on the virtue of learning the fara'id ('learn the fara'id', 'half of knowledge').",
     "corpus_has": "Fiqh as-Sunnah 840-841 without grades; Bulugh 1110 (a related report) graded da'if.",
     "needed": "An external grading. Until then these are not used in a lesson.",
     "related": ["H-BULUGH-1110", "S-FIQH-AS-SUNNAH-840", "S-FIQH-AS-SUNNAH-841"], "rules": ["R-learn-faraid"],
     "plan_rows": [], "display": "Never shown (plan D10)."},
    {"id": "G-E8-id-translation-bukhari-bulugh", "source_doc": "docs/waris-research/dalil.md §7 E8", "plan_ref": EXT,
     "item": "Indonesian translations of the Bukhari and Bulugh texts (and of the kitab and tafsir spans).",
     "corpus_has": "None.",
     "needed": "In-house translations reviewed and signed by an ustadz.",
     "related": [], "rules": [], "plan_rows": [],
     "display": "Until signed, the card shows the Arabic, the citation and 'terjemahan menunggu tinjauan ustadz' (plan D10)."},
    {"id": "G-E9-indonesian-provisions", "source_doc": "docs/waris-research/dalil.md §7 E9", "plan_ref": "docs/waris-plan.md §8 rows marked Legal",
     "item": "Indonesia-specific provisions: KHI substitute heirs, wasiat wajibah, joint marital property, radd to a spouse.",
     "corpus_has": "Not in the corpus. Fiqh as-Sunnah 865-866 is Egyptian law (No. 71/1946) and is not used.",
     "needed": "Pinned official legal texts (KHI, SEMA, MA decisions, MUI fatwas): URL, sha256, page (plan M0).",
     "related": ["S-FIQH-AS-SUNNAH-865", "S-FIQH-AS-SUNNAH-866"], "rules": ["R-ext-mui-khi"], "plan_rows": [],
     "display": "Legal sources, not dalil; quoted only from pinned PDFs."},
    {"id": "G-E10-zayd-husband-sister", "source_doc": "docs/waris-research/dalil.md §7 E10", "plan_ref": EXT,
     "item": "Zayd ibn Thabit's report of the Prophet's ruling: husband one-half, full sister one-half.",
     "corpus_has": "Second-hand only (Ibn Kathir 4:176, who notes that Ahmad alone narrates it by this route).",
     "needed": "A grade, if it is used. The rule itself follows from the Qur'an text.",
     "related": ["T-IK-4-176-zayd-husband-sister"], "rules": ["R-siblings-kalala", "R-spouses"], "plan_rows": [],
     "display": "Not needed for the rule; do not show without a grade."},
    {"id": "G-E11-newborn-wording", "source_doc": "docs/waris-research/dalil.md §7 E11", "plan_ref": EXT,
     "item": "The newborn's sign of life (istihlal): which narration and which wording.",
     "corpus_has": "Bulugh 1106's footnote cites at-Tirmidhi 1032, Ibn Majah 2750-2751 and Ibn Hibban 1223, and says "
                   "the wording belongs to Abu Hurayra's hadith, not Jabir's.",
     "needed": "The primary texts, to settle which wording to quote (see G-E6).",
     "related": ["H-BULUGH-1106", "S-FIQH-AS-SUNNAH-857"], "rules": ["R-newborn"], "plan_rows": [],
     "display": "Refusal page only; quote with the tahqiq note."},
    {"id": "G-AKDARIYYAH", "source_doc": "docs/waris-research/engine.md §8.3", "plan_ref": EXT,
     "item": "Akdariyyah: husband, mother, grandfather and one full or paternal sister (and no other sibling).",
     "corpus_has": "No corpus record. engine.md §8.3 rests on Khairuddin pp. 89-92 and Achmad Yani, which are not "
                   "in the corpus.",
     "needed": "A kitab page (Syafi'i), extracted or pinned, before the rule note cites anything.",
     "related": [], "rules": ["R-special-cases", "R-grandfather"], "plan_rows": ["akdariyyah"],
     "display": "No dalil to show; the rule note says the source is pending."},
    {"id": "G-UMARIYYATAIN-JADD", "source_doc": "docs/waris-plan.md §8 (row fardh.kakek_1_6, jadd.*; External (review))",
     "plan_ref": "docs/waris-plan.md §8 External (review)",
     "item": "'Umariyyatain with the grandfather instead of the father: the mother takes one-third of the whole.",
     "corpus_has": "F-FMUIN-34-jadd-like-ab is a summary sentence and is not read as an exhaustive list; the "
                   "corpus has no explicit statement of this case.",
     "needed": "al-Mawardi, al-Hawi al-Kabir, vol. 8 p. 121, Bab mirath al-jadd (the review's source; engine.md "
               "source list, islamweb library edition), pinned with URL, sha256 and page.",
     "related": ["F-FMUIN-34-jadd-like-ab", "F-FMUIN-34-umariyyatain"], "rules": ["R-grandfather", "R-mother-third-sixth"],
     "plan_rows": ["fardh.kakek_1_6", "jadd.*", "umariyyatain"],
     "display": "No dalil to show for the grandfather variant until the page is pinned."},
    {"id": "G-RADD-SEMUA-UTSMAN", "source_doc": "docs/waris-research/engine.md §9.4 (residue = radd_all)",
     "plan_ref": "review 2026-10-09 of the radd.semua RuleNote (not a docs/waris-plan.md §8 item)",
     "item": "'Uthman's view that the residue returns to every fardh heir in proportion, the spouse included (the "
             "comparison profile residue = radd_all; the literal reading of KHI 193).",
     "corpus_has": "Fiqh as-Sunnah §854 says only that no text settles radd and that the scholars differ, and the "
                   "corpus record breaks off there; §855 records that the Egyptian law follows 'Uthman only for a sole "
                   "surviving spouse (F-FSUNNAH-855-radd-zawj).",
     "needed": "A text stating 'Uthman's radd to the spouse alongside other fardh heirs (engine.md §9.4 and plan D7 "
               "cite Khairuddin, Fikih Faraidh, pp. 54-55, which is not in the corpus), retrieved and pinned with URL, "
               "sha256 and page before the radd.semua note cites it.",
     "related": ["F-FSUNNAH-854-radd-no-nass", "F-FSUNNAH-855-radd-zawj"], "rules": ["R-radd"],
     "plan_rows": ["radd.semua"],
     "display": "No dalil to show for radd to a spouse alongside other heirs; the rule note says the source is pending."},
]


# ---------------------------------------------------------------- record builders (shapes as in dalil.json)
def m1_fields(closes: str, would: list, notes: list) -> dict:
    return {"closes_gap": closes, "would_ground": would, "status": DRAFT, "notes": notes}


def quran_rec(c: Corpus, s: int, a: int, closes: str, would: list, gist: str, notes: list) -> dict:
    qj, t, q = c.quran[(s, a)], c.tanzil[(s, a)], c.qe[(s, a)]
    r = {"id": f"Q-{s}-{a}", "kind": "quran", "citation": f"QS {SURAH[s]} [{s}]: {a}",
         "ref": {"surah": s, "ayah": a}, "ar": t, "ar_source": "tanzil",
         "ar_quran_json": qj["arabic"], "ar_quran_json_byte_identical_to_tanzil": qj["arabic"] == t,
         "translations": {
             "id_quranenc_indonesian_affairs": {"text": q["translation"], "footnotes": q["footnotes"], "label": QE_LABEL},
             "id_quran_json": {"text": qj["id"], "label": 'api/data/quran.json "id" = Tanzil/AlQuran.cloud id.indonesian (older edition; non-commercial licence)'},
             "en_quran_json": {"text": qj["en"], "label": 'api/data/quran.json "en" = Tanzil/AlQuran.cloud en.sahih (Sahih International; non-commercial)'},
         },
         "url": f"https://tanzil.net/#{s}:{a}", "grounds": [], "gist_id": gist}
    r.update(m1_fields(closes, would, notes))
    return r


def bukhari_rec(c: Corpus, n: str, closes: str, would: list, gist: str, notes: list) -> dict:
    r = c.bukhari[n]
    out = {"id": f"H-BUKHARI-{n}", "kind": "hadith", "collection": "Sahih al-Bukhari",
           "citation": r["citation_en"], "numbering": "sunnah.com (fawazahmed0 hadithnumber = sunnah.com for Bukhari)",
           "book": r["book"], "in_book_number": r["in_book_number"],
           "ar": r["ar"], "translations": {"en": {"text": r["en"], "label": 'api/data/bukhari.json "en" (no Indonesian in corpus)'}},
           "grade_field": r["grades"], "grade_note": "Record grade field is empty; the collection is Sahih al-Bukhari.",
           "url": f"https://sunnah.com/bukhari:{n}", "grounds": [], "gist_id": gist, "variants_in_corpus": []}
    out.update(m1_fields(closes, would, notes))
    return out


def muslim_rec(c: Corpus, canon: str, closes: str, would: list, gist: str, notes: list) -> dict:
    seqs = [k for k in c.fz if muslim_canon_from(c.fz, k) == canon]
    if len(seqs) != 1:
        raise SystemExit(f"Muslim {canon}: {len(seqs)} fawazahmed0 entries in the pinned sections")
    seq = seqs[0]
    r = c.muslim[seq]
    if c.fz[seq]["text"] != r["ar"]:
        raise SystemExit(f"Muslim {canon}: fawazahmed0 Arabic != api/data/muslim.json {seq}")
    out = {"id": f"H-MUSLIM-{canon}", "kind": "hadith", "collection": "Sahih Muslim",
           "citation": f"Sahih Muslim {canon}",
           "numbering": "Fuad Abd al-Baqi via fawazahmed0 arabicnumber (.01->a); local file key hadithnumber=%d is NOT canonical" % seq,
           "local_hadithnumber": seq, "local_citation_en": r["citation_en"], "ar": r["ar"],
           "translations": {"en": {"text": r["en"], "label": 'api/data/muslim.json "en"'},
                            "id": {"text": r.get("id", ""), "label": 'api/data/muslim.json "id" (in-house operator translation per project memory; not a published translation; needs ustadz review)'}},
           "grade_field": r["grades"], "grade_note": "Record grade field is empty; the collection is Sahih Muslim.",
           "url": f"https://sunnah.com/muslim:{canon}", "grounds": [], "gist_id": gist}
    out.update(m1_fields(closes, would, notes))
    return out


def bulugh_rec(c: Corpus, n: int, closes: str, would: list, gist: str, notes: list) -> dict:
    r = c.bulugh[n]
    body, foot = split_bulugh(r["ar"])
    assert r["ar"].startswith(body) and r["ar"].endswith(foot), n
    grades = [{"footnote": k, "text": g.strip()} for k, g in GRADE.findall(foot)]
    out = {"id": f"H-BULUGH-{n}", "kind": "hadith", "collection": "Bulugh al-Maram (Ibn Hajar)",
           "citation": f'{r["citation_en"]} (local AhmedBaset numbering)',
           "numbering": "AhmedBaset idInBook - NOT sunnah.com canonical (see project memory hadith-canonical-numbering); canonical number unresolved",
           "cross_numbering": None, "book": r["book"],
           "ar": r["ar"], "ar_matn_and_ibn_hajar_attribution": body, "ar_tahqiq_footnote": foot,
           "grade_field": r["grades"], "grades_from_tahqiq_footnotes": grades,
           "tahqiq_note": "Footnotes come from the corpus edition's muhaqqiq; the edition/editor is not named in the corpus file - verify before citing him by name.",
           "translations": {"en": {"text": r["en"], "label": 'api/data/bulugh-al-maram.json "en"'}},
           "url": None, "grounds": [], "gist_id": gist}
    out.update(m1_fields(closes, would, notes))
    return out


def excerpt_rec(c: Corpus, rid: str, where: tuple, start: str, end: str, closes: str, would: list, gist: str,
                notes: list, nth: int) -> dict:
    fname, key = where
    store = c.tafsir[fname][key] if fname.startswith("tafsir") else c.fiqh[fname][key]
    a, b, _ = excerpt(store["ar"], start, end, nth)
    # a span across the printed edition's running head is cut around it, as in build_dalil
    omit = running_head_spans(store["ar"], a, b)
    marks = {"char_range": [a, b], **({"omit": omit} if omit else {}), "ar": elide(store["ar"], a, b, omit)}
    if omit:
        notes = notes + [build_dalil.omit_note(store["ar"], omit)]
    if fname.startswith("tafsir"):
        out = {"id": rid, "kind": "tafsir", "book": BOOK[fname], "ref": {"surah": key[0], "ayah": key[1]},
               "record_key": f"{key[0]}:{key[1]}", **marks, "grounds": [], "gist_id": gist}
    else:
        out = {"id": rid, "kind": "fiqh", "book": BOOK[fname], "section_id": key, "anchor": store["anchor"],
               "qism": store.get("qism", ""), "title": store["title"], **marks, "grounds": [], "gist_id": gist}
    out.update(m1_fields(closes, would, notes))
    return out


def gap_rec(g: dict) -> dict:
    out = {"id": g["id"], "kind": "gap", "status": "external"}
    out.update({k: g[k] for k in ("source_doc", "plan_ref", "item", "corpus_has", "needed", "related", "rules",
                                  "plan_rows", "display")})
    return out


def build_gaps(c: Corpus, research_ids: set) -> list:
    recs: list[dict] = []
    for (s, a), closes, would, gist, notes in GAP_QURAN:
        recs.append(quran_rec(c, s, a, closes, would, gist, notes))
    for n, closes, would, gist, notes in GAP_BUKHARI:
        recs.append(bukhari_rec(c, n, closes, would, gist, notes))
    for canon, closes, would, gist, notes in GAP_MUSLIM:
        recs.append(muslim_rec(c, canon, closes, would, gist, notes))
    for n, closes, would, gist, notes in GAP_BULUGH:
        recs.append(bulugh_rec(c, n, closes, would, gist, notes))
    for rid, where, start, end, closes, would, gist, notes, nth in GAP_EXCERPTS:
        recs.append(excerpt_rec(c, rid, where, start, end, closes, would, gist, notes, nth))
    for g in GAP_EXTERNAL:
        recs.append(gap_rec(g))
    ids = [r["id"] for r in recs]
    dup = {i for i in ids if ids.count(i) > 1} | (set(ids) & research_ids)
    if dup:
        raise SystemExit(f"gap record ids collide: {sorted(dup)}")
    known = set(ids) | research_ids
    for r in recs:
        for x in r.get("related", []) + r.get("would_ground", []) + r.get("rules", []):
            if x not in known:
                raise SystemExit(f"{r['id']}: unknown id {x}")
    src = c.src["inputs"]
    meta = {
        "id": "META-GAPS", "kind": "meta",
        "generator": "belajar/pipeline/build_waris.py (byte copy from api/data + pinned Tanzil + pinned QuranEnc; no Arabic retyped)",
        "about": ("The plan §8 gap list (docs/waris-plan.md §8). Records of kind quran/hadith/fiqh/tafsir close a 'Gaps to "
                  "extract in M1' item and use the dalil.json shapes and byte rules; kind 'gap' records name what the corpus "
                  "cannot ground and what is needed. They extend belajar/content/waris/dalil.json, which stays byte-identical "
                  "to docs/waris-research/dalil.json during the research phase; ids do not collide, so readers take the union. "
                  "'would_ground' names the dalil.json rule a record supports; the rule records themselves are unchanged "
                  "until the docs copy stops being canonical."),
        "status": "Every record is draft: not reviewed by an ustadz. AI-assisted, not an authoritative fatwa.",
        "sources": {
            "tanzil_uthmani": {"file": "belajar/pipeline/" + src["tanzil_uthmani"]["cache_path"], "sha256": src["tanzil_uthmani"]["sha256"]},
            "quranenc_indonesian_affairs_waris": {
                "version": src["quranenc_indonesian_affairs_waris"]["version"],
                "sha256": {s: src["quranenc_indonesian_affairs_waris"]["files"][f"indonesian_affairs_sura{s}.json"]["sha256"]
                           for s in sorted({r["ref"]["surah"] for r in recs if r["kind"] == "quran"})}},
            "fawazahmed0_muslim_sections": {"sha256": {"24": src["fawazahmed0_muslim_sections"]["files"]["ara-muslim-sections-24.json"]["sha256"]}},
            **{f: {"file": "api/data/" + f, "sha256": sha_file(D / f)}
               for f in ("quran.json", "bukhari.json", "muslim.json", "bulugh-al-maram.json", "fiqh-as-sunnah.json",
                         "al-umm.json", "tafsir-ibn-kathir.json")},
        },
        "counts": {k: sum(1 for r in recs if r["kind"] == k) for k in ("quran", "hadith", "fiqh", "tafsir", "gap")},
    }
    return [meta] + recs


# ---------------------------------------------------------------- provenance
def copy_entry(field: str, source: str, locator: str, source_field: str, whole: str, copied: str,
               span: list | None = None, r: dict | None = None) -> dict:
    e = {"field": field, "source": source, "locator": locator, "source_field": source_field,
         "sha256": sha_text(whole), "copied_sha256": sha_text(copied)}
    if span is not None:
        e["span"] = span
    # an excerpt cut around running heads / ending where its record breaks off (build_dalil.excerpt_record)
    if r is not None and r.get("omit"):
        e["omit"] = r["omit"]
    if r is not None and r.get("source_truncated"):
        e["source_truncated"] = True
    return e


def provenance_of(c: Corpus, r: dict) -> list[dict]:
    k = r["kind"]
    out: list[dict] = []
    if k == "quran":
        s, a = r["ref"]["surah"], r["ref"]["ayah"]
        qj, q = c.quran[(s, a)], c.qe[(s, a)]
        qfile = f"quranenc_indonesian_affairs_waris:indonesian_affairs_sura{s}.json"
        loc_q, loc_j = f"aya={a}", f"surah={s},ayah={a}"
        tr = r["translations"]
        out += [copy_entry("ar", "tanzil_uthmani", f"{s}|{a}", "verse", c.tanzil[(s, a)], r["ar"]),
                copy_entry("ar_quran_json", "api/data/quran.json", loc_j, "arabic", qj["arabic"], r["ar_quran_json"]),
                copy_entry("translations.id_quranenc_indonesian_affairs.text", qfile, loc_q, "translation",
                           q["translation"], tr["id_quranenc_indonesian_affairs"]["text"]),
                copy_entry("translations.id_quranenc_indonesian_affairs.footnotes", qfile, loc_q, "footnotes",
                           q["footnotes"], tr["id_quranenc_indonesian_affairs"]["footnotes"]),
                copy_entry("translations.id_quran_json.text", "api/data/quran.json", loc_j, "id", qj["id"], tr["id_quran_json"]["text"]),
                copy_entry("translations.en_quran_json.text", "api/data/quran.json", loc_j, "en", qj["en"], tr["en_quran_json"]["text"])]
    elif k == "hadith" and r["collection"] == "Sahih al-Bukhari":
        n = r["id"].rsplit("-", 1)[1]
        h, loc = c.bukhari[n], f"hadithnumber={n}"
        out += [copy_entry("ar", "api/data/bukhari.json", loc, "ar", h["ar"], r["ar"]),
                copy_entry("translations.en.text", "api/data/bukhari.json", loc, "en", h["en"], r["translations"]["en"]["text"])]
    elif k == "hadith" and r["collection"] == "Sahih Muslim":
        h, loc = c.muslim[r["local_hadithnumber"]], f"hadithnumber={r['local_hadithnumber']}"
        out += [copy_entry("ar", "api/data/muslim.json", loc, "ar", h["ar"], r["ar"]),
                copy_entry("translations.en.text", "api/data/muslim.json", loc, "en", h["en"], r["translations"]["en"]["text"]),
                copy_entry("translations.id.text", "api/data/muslim.json", loc, "id", h.get("id", ""), r["translations"]["id"]["text"])]
    elif k == "hadith":
        n = int(r["id"].rsplit("-", 1)[1])
        h, loc = c.bulugh[n], f"hadithnumber={n}"
        body, foot = r["ar_matn_and_ibn_hajar_attribution"], r["ar_tahqiq_footnote"]
        out += [copy_entry("ar", "api/data/bulugh-al-maram.json", loc, "ar", h["ar"], r["ar"]),
                copy_entry("ar_matn_and_ibn_hajar_attribution", "api/data/bulugh-al-maram.json", loc, "ar", h["ar"], body,
                           [0, len(body)]),
                copy_entry("ar_tahqiq_footnote", "api/data/bulugh-al-maram.json", loc, "ar", h["ar"], foot,
                           [len(h["ar"]) - len(foot), len(h["ar"])]),
                copy_entry("translations.en.text", "api/data/bulugh-al-maram.json", loc, "en", h["en"], r["translations"]["en"]["text"])]
    elif k == "fiqh":
        fname = next(f for f, b in BOOK.items() if r["book"].startswith(b.split(" (")[0]))
        h = c.fiqh[fname][r["section_id"]]
        out.append(copy_entry("ar", "api/data/" + fname, f"section_id={r['section_id']}", "ar", h["ar"], r["ar"], r["char_range"], r))
    elif k == "tafsir":
        fname = "tafsir-ibn-kathir.json" if r["book"].startswith("Tafsir Ibn Kathir") else "tafsir-al-tabari.json"
        s, a = r["ref"]["surah"], r["ref"]["ayah"]
        h = c.tafsir[fname][(s, a)]
        out.append(copy_entry("ar", "api/data/" + fname, f"surah={s},ayah={a}", "ar", h["ar"], r["ar"], r["char_range"], r))
    elif k == "section_index":
        fname = r["file"].split("/")[-1]
        if "section_id" in r:
            h, loc = c.fiqh[fname][r["section_id"]], f"section_id={r['section_id']}"
        else:
            s, a = (int(x) for x in r["record_key"].split(":"))
            h, loc = c.tafsir[fname][(s, a)], f"surah={s},ayah={a}"
        e = copy_entry("(pointer)", r["file"], loc, "ar", h["ar"], "")
        del e["copied_sha256"]
        out.append(e)
    return out


def build_provenance(c: Corpus, files: dict[str, list]) -> dict:
    recs: dict[str, dict] = {}
    for fname, data in files.items():
        for r in data:
            p = provenance_of(c, r)
            if p:
                recs[r["id"]] = {"file": fname, "copies": p}
    return {"META": {"id": "META-PROVENANCE", "generator": "belajar/pipeline/build_waris.py",
                     "about": ("For every record of dalil.json and dalil-gaps.json that copies or points at corpus bytes: "
                               "where each copied field comes from. sha256 = sha256 of the whole source field as UTF-8 "
                               "(the source record); copied_sha256 = sha256 of the bytes in the dalil record (a span "
                               "[start, end) of the source field when 'span' is given; with 'omit', the span minus those "
                               "running-head spans, each shown as an ellipsis; with 'source_truncated', followed by a "
                               "space and an ellipsis). validate_waris.py recomputes both from the pinned inputs and "
                               "api/data."),
                     "sources": {"tanzil_uthmani": "belajar/pipeline/cache/tanzil/quran-uthmani.txt (sources.json pin)",
                                 "quranenc_indonesian_affairs_waris": "belajar/pipeline/cache/quranenc/ (sources.json pins)",
                                 "api/data/*.json": "the platform corpus (git-ignored)"}},
            "records": recs}


# ---------------------------------------------------------------- rules (RuleNote drafts, plan §9.2 / M1.6)
AUTHORED_RULES = PIPELINE / "authored" / "waris.rules.json"
OUT_RULES = OUT_DIR / "rules.json"
REGISTRY_TS = PIPELINE.parent / "src" / "lib" / "waris" / "registry.ts"
# Every RuleNote key, in output order, with the value an omitted optional key takes.
RULE_NOTE_DEFAULTS: dict = {
    "rule_id": None, "title_id": None, "summary_id": None, "dalil": [], "dalil_rule": [], "related_gaps": [],
    "legal": [], "ikhtilaf": None, "method": None, "reviewer_notes": [], "status": None,
}


def _strip_ts_comments(text: str) -> str:
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return re.sub(r"//[^\n]*", "", text)


def _ts_block(text: str, start: str, end: str) -> str:
    i = text.find(start)
    j = text.find(end, i + len(start)) if i >= 0 else -1
    if i < 0 or j < 0:
        raise SystemExit(f"registry.ts: cannot find the block {start!r} ... {end!r}")
    return text[i + len(start):j]


def registry_rule_ids(text: str) -> list[str]:
    """RULE_IDS of src/lib/waris/registry.ts, in its order: the RULES keys, then rujuk.<reason>,
    then catatan.<note> (registry.ts builds RULE_IDS the same way). Read from the TypeScript
    source so the pipeline needs no Node; validate_waris.py parses it independently."""
    rules = _strip_ts_comments(_ts_block(text, "export const RULES = {", "} as const satisfies Record<string, RuleMeta>;"))
    calc = [a or b for a, b in re.findall(r'^\s*(?:"([a-z0-9_.]+)"|([a-z_][a-z0-9_]*))\s*:\s*R\(', rules, flags=re.M)]
    rujuk = re.findall(r'"([a-z_]+)"', _strip_ts_comments(_ts_block(text, "export const RUJUK_REASONS = [", "] as const;")))
    notes = re.findall(r'"([a-z_]+)"', _strip_ts_comments(_ts_block(text, "export const NOTES = [", "] as const;")))
    if not calc or not rujuk or not notes:
        raise SystemExit("registry.ts: RULES, RUJUK_REASONS or NOTES parsed empty")
    return calc + [f"rujuk.{r}" for r in rujuk] + [f"catatan.{n}" for n in notes]


def build_rules() -> dict:
    raw = AUTHORED_RULES.read_bytes()
    authored = json.loads(raw)
    ids = registry_rule_ids(REGISTRY_TS.read_text(encoding="utf-8"))
    by_id: dict[str, dict] = {}
    problems: list[str] = []
    for n in authored["rules"]:
        rid = n.get("rule_id")
        if rid in by_id:
            problems.append(f"{rid}: more than one RuleNote")
        by_id[rid] = n
        unknown = sorted(set(n) - set(RULE_NOTE_DEFAULTS))
        if unknown:
            problems.append(f"{rid}: unknown RuleNote keys {unknown}")
    problems += [f"{i}: registry rule id has no RuleNote" for i in ids if i not in by_id]
    problems += [f"{i}: RuleNote for an id that is not in the engine registry" for i in by_id if i not in ids]
    if problems:
        raise SystemExit("rules step failed:\n  " + "\n  ".join(problems))
    rules = [{k: by_id[i].get(k, v) for k, v in RULE_NOTE_DEFAULTS.items()} for i in ids]
    meta = {"generator": "belajar/pipeline/build_waris.py (rules step)",
            "source": "belajar/pipeline/authored/waris.rules.json", "source_sha256": sha_text(raw.decode("utf-8")),
            "order": "registry order of belajar/src/lib/waris/registry.ts (RULE_IDS)", **authored["meta"]}
    return {"meta": meta, "legal_sources": authored["legal_sources"], "rules": rules}


def write_rules() -> None:
    out = build_rules()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    OUT_RULES.write_text(dump(out), encoding="utf-8")
    print(f"wrote {OUT_RULES.relative_to(REPO)} ({len(out['rules'])} RuleNotes, {len(out['legal_sources'])} legal sources)")


# ---------------------------------------------------------------- main
def main() -> int:
    if "--rules-only" in sys.argv[1:]:
        write_rules()
        return 0
    src = load_sources()
    research = build_dalil.build()
    text = build_dalil.dump(research)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    OUT_DALIL.write_text(text, encoding="utf-8")
    c = Corpus(src)
    # The Bulugh split here must agree with the research build's on every research record.
    for r in research:
        if r.get("kind") == "hadith" and "ar_matn_and_ibn_hajar_attribution" in r:
            if split_bulugh(r["ar"]) != (r["ar_matn_and_ibn_hajar_attribution"], r["ar_tahqiq_footnote"]):
                raise SystemExit(f"{r['id']}: split_bulugh disagrees with build_dalil")
    gaps = build_gaps(c, {r["id"] for r in research})
    OUT_GAPS.write_text(dump(gaps), encoding="utf-8")
    prov = build_provenance(c, {"dalil.json": research, "dalil-gaps.json": gaps})
    OUT_PROV.write_text(dump(prov), encoding="utf-8")
    n = gaps[0]["counts"]
    print(f"wrote {OUT_DALIL.relative_to(REPO)} ({len(research)} records, {len(text.encode('utf-8'))} bytes)")
    print(f"wrote {OUT_GAPS.relative_to(REPO)} ({len(gaps) - 1} records: {n})")
    print(f"wrote {OUT_PROV.relative_to(REPO)} ({len(prov['records'])} records with provenance)")
    write_rules()
    if DOCS_DALIL.exists():
        if DOCS_DALIL.read_bytes() != text.encode("utf-8"):
            print(f"FAIL: {OUT_DALIL.relative_to(REPO)} is not byte-identical to {DOCS_DALIL.relative_to(REPO)} "
                  f"(the docs copy is canonical during the research phase)", file=sys.stderr)
            return 1
        print(f"OK: dalil.json is byte-identical to {DOCS_DALIL.relative_to(REPO)}")
    else:
        print("note: docs/waris-research/dalil.json is absent; no reproduction check")
    return 0


if __name__ == "__main__":
    sys.exit(main())
