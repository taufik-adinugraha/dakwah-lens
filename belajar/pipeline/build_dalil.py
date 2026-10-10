#!/usr/bin/env python3
"""Ilmu Waris dalil, research stage: rebuild docs/waris-research/dalil.json from the local corpus.

Moved into the repo from the DALIL researcher's session scratchpad (plan §9.2, task 1), where it
built docs/waris-research/dalil.json on 2026-10-09. The record tables (Qur'an, hadith, excerpts,
rules) are the researcher's, unchanged; the inputs now come from pinned files:

  - Qur'an Arabic: the Tanzil file pinned in sources.json (tanzil_uthmani);
  - QuranEnc indonesian_affairs suras 2, 4, 8, 33: sources.json quranenc_indonesian_affairs_waris
    (the same bytes the scratchpad held: sha256 equal, checked by validate_waris.py);
  - Muslim numbering map: sources.json fawazahmed0_muslim_sections (sections 23 and 25);
  - hadith, fiqh and tafsir: api/data/*.json (the platform corpus; git-ignored, so each file's
    sha256 is written into META.sources and re-checked by validate_waris.py).

Every Arabic / translation string in the output is a byte-for-byte copy (a whole field, or a
substring located by ar.find_orig and cut from the original by offsets) of a source file.
Nothing is retyped. One exception, marked in the shown text: an excerpt that crosses the printed
edition's running head (a page break in the corpus text) is cut around it, the cuts listed as
`omit` offsets and shown as '…'; an excerpt that ends where its corpus record breaks off
mid-sentence ends with ' …' (`source_truncated`). See excerpt_record() and ar.running_head_spans(). The 2026-10-09 review edits that were made to the JSON after the research
build are applied by apply_review_2026_10_09(), so a rebuild no longer reverts them.

    python3 build_dalil.py > dalil.json     # print the research file (as the scratchpad script did)

build_waris.py imports build()/dump() and writes belajar/content/waris/dalil.json, which must be
byte-identical to docs/waris-research/dalil.json while the docs copy is canonical.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

from ar import D, elide, find_orig, load, running_head_spans
from common import PIPELINE, load_sources, require_pinned

REPO = PIPELINE.parents[1]

# Strings in META that describe where the research build read its inputs on 2026-10-09. They are
# kept verbatim so the rebuild is byte-identical to the research file; the bytes they name now
# come from the pinned cache (identical sha256, re-checked by validate_waris.py).
RESEARCH_GENERATOR = ("scratchpad/build_dalil.py (programmatic byte copy from api/data + pinned Tanzil + "
                      "QuranEnc API; no Arabic retyped)")
RESEARCH_QURANENC_PATH = "scratchpad/quranenc/indonesian_affairs_sura{s}.json"
RESEARCH_SURAS = (2, 4, 8, 33)
RESEARCH_MUSLIM_SECTIONS = (23, 25)
GENERATED = "2026-10-09"


def sha(p) -> str:
    with open(p, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def pinned_file(src: dict, input_id: str, name: str) -> Path:
    """Cached file `name` of a multi-file input in sources.json, failing on a missing file or a drifted pin."""
    meta = src["inputs"][input_id]
    f = meta["files"].get(name)
    if not f or not f.get("sha256"):
        raise SystemExit(f"[{input_id}] {name} not pinned in sources.json; run fetch.py first")
    p = PIPELINE / meta["cache_dir"] / name
    if not p.exists():
        raise SystemExit(f"[{input_id}] missing {p}; run fetch.py first")
    got = sha(p)
    if got != f["sha256"]:
        raise SystemExit(f"[{input_id}] {name}: sha256 {got} does not match pin {f['sha256']}")
    return p


def quranenc_path(src: dict, s: int) -> Path:
    return pinned_file(src, "quranenc_indonesian_affairs_waris", f"indonesian_affairs_sura{s}.json")


def fawaz_path(src: dict, n: int) -> Path:
    return pinned_file(src, "fawazahmed0_muslim_sections", f"ara-muslim-sections-{n}.json")


def muslim_canon_from(fz: dict, seq: int) -> str:
    """Fuad Abd al-Baqi number from fawazahmed0's arabicnumber ('1615.03' -> '1615c'; '1614' -> '1614')."""
    an = str(fz[seq]['arabicnumber'])
    if '.' not in an:
        return an
    head, _, tail = an.partition('.')
    sub = int(tail)
    return head if sub == 0 else head + chr(ord('a') + sub - 1)


def build() -> list:
    """Return [META] + records, exactly as docs/waris-research/dalil.json holds them."""
    src = load_sources()
    TANZIL = require_pinned(src, "tanzil_uthmani")

    # ------------------------------------------------------------ sources
    quran = {(int(r['surah']), int(r['ayah'])): r for r in load('quran.json')}
    tanzil = {}
    for line in open(TANZIL, encoding='utf-8'):
        p = line.rstrip('\n').split('|')
        if len(p) == 3 and p[0].isdigit():
            tanzil[(int(p[0]), int(p[1]))] = p[2]
    qe = {}
    for s in RESEARCH_SURAS:
        for r in json.load(open(quranenc_path(src, s), encoding='utf-8'))['result']:
            qe[(int(r['sura']), int(r['aya']))] = r
    bukhari = {str(r['hadithnumber']): r for r in load('bukhari.json')}
    muslim = {int(r['hadithnumber']): r for r in load('muslim.json')}
    bulugh = {int(r['hadithnumber']): r for r in load('bulugh-al-maram.json')}
    fqarib = {str(r['section_id']): r for r in load('fath-al-qarib.json')}
    fmuin = {str(r['section_id']): r for r in load('fath-al-muin.json')}
    fsunnah = {str(r['section_id']): r for r in load('fiqh-as-sunnah.json')}
    alumm = {str(r['section_id']): r for r in load('al-umm.json')}
    ik = {(int(r['surah']), int(r['ayah'])): r for r in load('tafsir-ibn-kathir.json')}
    tb = {(int(r['surah']), int(r['ayah'])): r for r in load('tafsir-al-tabari.json')}

    # fawazahmed0 sections give the Muslim sequential -> Fuad Abdul Baqi map
    fz = {}
    for n in RESEARCH_MUSLIM_SECTIONS:
        for h in json.load(open(fawaz_path(src, n), encoding='utf-8'))['hadiths']:
            fz[h['hadithnumber']] = h

    def muslim_canon(seq):
        return muslim_canon_from(fz, seq)

    SOURCES = {
        'tanzil': {'file': 'belajar/pipeline/cache/tanzil/quran-uthmani.txt', 'sha256': sha(TANZIL),
                   'edition': 'Tanzil Quran Text (Uthmani, Version 1.1)',
                   'licence': 'CC BY 3.0 + verbatim-only; credit Tanzil Project + link https://tanzil.net (https://tanzil.net/docs/text_license)'},
        'quran_json': {'file': 'api/data/quran.json', 'sha256': sha(D / 'quran.json'),
                       'producer': 'api/src/api/scripts/download_quran.py (AlQuran.cloud editions quran-uthmani / id.indonesian / en.sahih)'},
        'quranenc': {'files': {s: RESEARCH_QURANENC_PATH.format(s=s) for s in RESEARCH_SURAS},
                     'sha256': {s: sha(quranenc_path(src, s)) for s in RESEARCH_SURAS},
                     'key': 'indonesian_affairs', 'version': '1.0.1',
                     'title_as_named_by_quranenc': 'Terjemahan Berbahasa Indonesia - Kementerian Agama',
                     'api': 'https://quranenc.com/api/v1/translation/sura/indonesian_affairs/{sura}', 'retrieved': '2026-10-09'},
    }
    for f in ['bukhari.json', 'muslim.json', 'bulugh-al-maram.json', 'fath-al-qarib.json', 'fath-al-muin.json',
              'fiqh-as-sunnah.json', 'al-umm.json', 'tafsir-ibn-kathir.json', 'tafsir-al-tabari.json']:
        SOURCES[f] = {'file': 'api/data/' + f, 'sha256': sha(D / f)}

    records = []

    def add(r):
        assert r['id'] not in {x['id'] for x in records}, r['id']
        records.append(r)

    # ---------------------------------------------------------------- Qur'an
    SURAH = {2: "Al-Baqarah", 4: "An-Nisa'", 8: "Al-Anfal", 33: "Al-Ahzab"}
    QURAN = [
        ((4, 7), ['R-women-inherit'], 'Laki-laki dan perempuan sama-sama punya hak waris dari orang tua dan kerabat; bagiannya ditetapkan.'),
        ((4, 8), ['R-gift-at-division'], 'Kerabat bukan ahli waris, anak yatim dan orang miskin yang hadir saat pembagian diberi sekadarnya dan dijawab dengan kata yang baik.'),
        ((4, 11), ['R-debt-wasiyya-first', 'R-2to1', 'R-daughters', 'R-parents', 'R-mother-third-sixth'], 'Ayat inti: anak (2:1, satu putri 1/2, putri >2 2/3), ayah-ibu (1/6, ibu 1/3 atau 1/6), setelah wasiat dan utang.'),
        ((4, 12), ['R-spouses', 'R-maternal-siblings', 'R-debt-wasiyya-first', 'R-no-harm-wasiyya'], 'Suami (1/2 atau 1/4), istri (1/4 atau 1/8), saudara seibu dalam kalalah (1/6 atau berbagi 1/3), wasiat tanpa menyusahkan ahli waris.'),
        ((4, 13), ['R-obligation'], 'Pembagian ini adalah batas-batas Allah; taat kepadanya dijanjikan surga.'),
        ((4, 14), ['R-obligation'], 'Melanggar batas-batas ini diancam neraka.'),
        ((4, 33), ['R-kinship-priority', 'R-no-inheritance-by-oath'], 'Allah menetapkan ahli waris bagi setiap harta peninggalan; ayat ini juga dibahas sebagai penghapus waris karena sumpah setia (lihat Bukhari 6747/4580).'),
        ((4, 141), ['R-barrier-religion'], 'Allah tidak memberi jalan bagi orang kafir atas orang mukmin - dikutip Fatwa MUI 5/MUNAS VII/MUI/9/2005 (kewarisan beda agama) sebagai dalil; lihat docs/waris-research/standard.md 1.1. Ayat ini sendiri tidak menyebut waris.'),
        ((4, 176), ['R-siblings-kalala', 'R-2to1', 'R-hajb-siblings'], 'Kalalah: saudari kandung/seayah 1/2, dua saudari 2/3, saudara laki-laki mewarisi semuanya, campuran 2:1.'),
        ((8, 75), ['R-kinship-priority', 'R-dzawil-arham'], 'Kerabat lebih berhak satu sama lain dalam Kitab Allah.'),
        ((33, 6), ['R-kinship-priority', 'R-no-inheritance-by-oath', 'R-wasiyya-third'], 'Kerabat sedarah lebih berhak (waris-mewarisi) daripada ikatan iman/hijrah; kebaikan kepada saudara seagama lewat wasiat (catatan QuranEnc [667]).'),
        ((2, 180), ['R-wasiyya-history'], 'Kewajiban wasiat untuk orang tua dan kerabat; status hukumnya (nasakh) dibahas di tafsir.'),
        ((2, 240), ['R-wasiyya-history'], 'Wasiat nafkah setahun untuk janda; status hukumnya (nasakh) dibahas di tafsir.'),
    ]
    for (s, a), rules, gist in QURAN:
        qj = quran[(s, a)]
        t = tanzil[(s, a)]
        q = qe[(s, a)]
        add({
            'id': f'Q-{s}-{a}', 'kind': 'quran',
            'citation': f'QS {SURAH[s]} [{s}]: {a}',
            'ref': {'surah': s, 'ayah': a},
            'ar': t,
            'ar_source': 'tanzil',
            'ar_quran_json': qj['arabic'],
            'ar_quran_json_byte_identical_to_tanzil': qj['arabic'] == t,
            'translations': {
                'id_quranenc_indonesian_affairs': {'text': q['translation'], 'footnotes': q['footnotes'],
                                                   'label': 'QuranEnc indonesian_affairs v1.0.1 ("Terjemahan Berbahasa Indonesia - Kementerian Agama" as QuranEnc names it; not the official Kemenag 2019 v1122 text)'},
                'id_quran_json': {'text': qj['id'], 'label': 'api/data/quran.json "id" = Tanzil/AlQuran.cloud id.indonesian (older edition; non-commercial licence)'},
                'en_quran_json': {'text': qj['en'], 'label': 'api/data/quran.json "en" = Tanzil/AlQuran.cloud en.sahih (Sahih International; non-commercial)'},
            },
            'url': f'https://tanzil.net/#{s}:{a}',
            'grounds': rules, 'gist_id': gist,
        })

    # ---------------------------------------------------------------- hadith helpers
    def bukhari_rec(n, rules, gist, notes=None, variants=None):
        r = bukhari[n]
        add({'id': f'H-BUKHARI-{n}', 'kind': 'hadith', 'collection': 'Sahih al-Bukhari',
             'citation': r['citation_en'], 'numbering': 'sunnah.com (fawazahmed0 hadithnumber = sunnah.com for Bukhari)',
             'book': r['book'], 'in_book_number': r['in_book_number'],
             'ar': r['ar'], 'translations': {'en': {'text': r['en'], 'label': 'api/data/bukhari.json "en" (no Indonesian in corpus)'}},
             'grade_field': r['grades'], 'grade_note': 'Record grade field is empty; the collection is Sahih al-Bukhari.',
             'url': f'https://sunnah.com/bukhari:{n}', 'grounds': rules, 'gist_id': gist,
             'variants_in_corpus': variants or [], 'notes': notes or []})

    def muslim_rec(seq, rules, gist, notes=None):
        r = muslim[seq]
        c = muslim_canon(seq)
        assert fz[seq]['text'] == r['ar']
        add({'id': f'H-MUSLIM-{c}', 'kind': 'hadith', 'collection': 'Sahih Muslim',
             'citation': f'Sahih Muslim {c}', 'numbering': 'Fuad Abd al-Baqi via fawazahmed0 arabicnumber (.01->a); local file key hadithnumber=%d is NOT canonical' % seq,
             'local_hadithnumber': seq, 'local_citation_en': r['citation_en'],
             'ar': r['ar'],
             'translations': {'en': {'text': r['en'], 'label': 'api/data/muslim.json "en"'},
                              'id': {'text': r.get('id', ''), 'label': 'api/data/muslim.json "id" (in-house operator translation per project memory; not a published translation; needs ustadz review)'}},
             'grade_field': r['grades'], 'grade_note': 'Record grade field is empty; the collection is Sahih Muslim.',
             'url': f'https://sunnah.com/muslim:{c}', 'grounds': rules, 'gist_id': gist, 'notes': notes or []})

    FOOT = re.compile('\u200f1 \u200f-')  # RLM 1 space RLM hyphen: the editor's first footnote marker
    def split_bulugh(t):
        m = FOOT.search(t)
        if not m:
            return t, ''
        body = re.sub('\\s*\\d\u200f\\s*\\.?\u200f*$', '', t[:m.start()])
        return body, t[m.start() + 1:]

    def bulugh_rec(n, rules, gist, notes=None, tohed=None):
        r = bulugh[n]
        body, foot = split_bulugh(r['ar'])
        assert body in r['ar'] and foot in r['ar']
        grades = [{'footnote': n, 'text': g.strip()} for n, g in re.findall(r'(?:^|\u200f)(\d) \u200f- ([^.\u200f]+)', foot)]
        add({'id': f'H-BULUGH-{n}', 'kind': 'hadith', 'collection': "Bulugh al-Maram (Ibn Hajar), Kitab al-Buyu' > Bab al-Fara'id / Bab al-Wasaya",
             'citation': f'{r["citation_en"]} (local AhmedBaset numbering)',
             'numbering': 'AhmedBaset idInBook - NOT sunnah.com canonical (see project memory hadith-canonical-numbering); canonical number unresolved',
             'cross_numbering': tohed,
             'book': r['book'],
             'ar': r['ar'], 'ar_matn_and_ibn_hajar_attribution': body, 'ar_tahqiq_footnote': foot,
             'grade_field': r['grades'],
             'grades_from_tahqiq_footnotes': grades,
             'tahqiq_note': 'Footnotes come from the corpus edition\'s muhaqqiq (he refers to al-Albani as "shaykhuna"); the edition/editor is not named in the corpus file - verify before citing him by name.',
             'translations': {'en': {'text': r['en'], 'label': 'api/data/bulugh-al-maram.json "en"'}},
             'url': None, 'grounds': rules, 'gist_id': gist, 'notes': notes or []})

    # ---------------------------------------------------------------- Bukhari
    bukhari_rec('6732', ['R-furudh-then-asabah'], 'Berikan bagian pasti kepada pemiliknya; sisanya untuk laki-laki terdekat.', variants=['6735', '6737', '6746'])
    bukhari_rec('6736', ['R-sons-daughter-sixth', 'R-sister-asabah-maal-ghayr'], 'Putri 1/2, cucu putri dari anak laki-laki 1/6 (penyempurna 2/3), sisanya untuk saudari - putusan Nabi menurut Ibnu Mas\'ud.', variants=['6742'])
    bukhari_rec('6734', ['R-sister-asabah-maal-ghayr'], "Mu'adh di Yaman: putri 1/2, saudari 1/2.", variants=['6741'])
    bukhari_rec('6739', ['R-2to1', 'R-parents', 'R-spouses', 'R-wasiyya-history'], 'Ibnu Abbas: dulu harta untuk anak dan wasiat untuk orang tua; Allah menghapus sebagian dan menetapkan 2:1, 1/6 orang tua, 1/8-1/4 istri, 1/2-1/4 suami.', variants=['2747', '4578'])
    bukhari_rec('6764', ['R-barrier-religion'], 'Muslim tidak mewarisi kafir dan kafir tidak mewarisi Muslim.')
    bukhari_rec('2742', ['R-wasiyya-third'], "Sa'd bin Abi Waqqash: wasiat sepertiga, dan sepertiga itu banyak; meninggalkan ahli waris kaya lebih baik.", variants=['6733', '2744'])
    bukhari_rec('2743', ['R-wasiyya-third'], 'Ibnu Abbas: sebaiknya orang menurunkan wasiat ke seperempat.')
    bukhari_rec('2738', ['R-write-wasiyya'], 'Muslim yang punya sesuatu untuk diwasiatkan hendaknya wasiatnya tertulis.')
    bukhari_rec('6731', ['R-debt-wasiyya-first'], 'Nabi menanggung utang mukmin yang wafat tanpa harta; harta peninggalan untuk ahli waris.', notes=['Supports the seriousness of debt; it does not itself state the order debt-before-distribution (that rests on 4:11-12 + ijma\' reports, see F-ALUMM-572 and T-IK-4-11-dayn).'], variants=['6745', '6763'])
    bukhari_rec('6745', ['R-furudh-then-asabah'], "Siapa meninggalkan harta, hartanya untuk 'ashabah.")
    bukhari_rec('6738', ['R-grandfather'], 'Abu Bakar menempatkan kakek seperti ayah (riwayat Ibnu Abbas).', notes=["Corpus has only this report; the khilaf on grandfather with siblings is in al-Umm 556 (F-ALUMM-556) and Fath al-Mu'in 34. Do not present as the only view."])
    bukhari_rec('6744', ['R-siblings-kalala'], "Al-Bara': ayat terakhir yang turun adalah penutup An-Nisa' (4:176).")
    bukhari_rec('6723', ['R-asbab-nuzul'], 'Jabir sakit dan bertanya tentang hartanya; lalu turun ayat waris (tanpa menyebut ayat mana).', variants=['6743'])
    bukhari_rec('4577', ['R-asbab-nuzul'], 'Jabir: lalu turun "Yushikumullah fi auladikum" (4:11).', notes=['Muslim 1616a (same Jabir story, Sufyan from Ibn al-Munkadir) names 4:176 instead. Keep the two narrations apart.'])
    bukhari_rec('6747', ['R-no-inheritance-by-oath'], "Ibnu Abbas: waris Muhajirin-Anshar karena persaudaraan dihapus oleh 4:33.", variants=['4580'])
    bukhari_rec('4576', ['R-gift-at-division'], 'Ibnu Abbas: ayat 4:8 muhkam, tidak mansukh.', notes=['Ibn Kathir 4:8 reports the opposite (abrogated) view as that of the jumhur; present both (T-IK-4-7-muhkam, T-IK-4-8-naskh, T-TB-4-8).'])
    bukhari_rec('2759', ['R-gift-at-division'], "Ibnu Abbas: 'demi Allah ayat itu tidak mansukh, tetapi orang meremehkannya'.", notes=['The Arabic does not name the verse; the link to 4:8 depends on the chapter heading, which is not in the corpus. Prefer 4576.'])
    bukhari_rec('6752', ['R-wala'], "Wala' hanya untuk orang yang memerdekakan.", notes=['The corpus EN reads "The Wala\' is for the manumitted" - a mistranslation (the Arabic li-man a\'taqa = for the one who manumits). Do not display this EN line.', 'Historical (slavery); low priority for a lay lesson.'])

    # ---------------------------------------------------------------- Muslim
    muslim_rec(4140, ['R-barrier-religion'], 'Muslim tidak mewarisi kafir dan sebaliknya.')
    muslim_rec(4141, ['R-furudh-then-asabah'], 'Berikan bagian pasti kepada pemiliknya; sisanya untuk laki-laki terdekat.')
    muslim_rec(4143, ['R-furudh-then-asabah'], "Bagikan harta di antara ahli fara'idh sesuai Kitab Allah; sisanya untuk laki-laki terdekat.")
    muslim_rec(4145, ['R-asbab-nuzul', 'R-siblings-kalala'], 'Jabir: Nabi tidak menjawab sampai turun ayat kalalah.')
    muslim_rec(4150, ['R-siblings-kalala'], "Umar: tidak ada yang lebih penting baginya daripada kalalah; Nabi: 'tidakkah cukup ayat shaif di akhir An-Nisa'?'")
    muslim_rec(4152, ['R-siblings-kalala'], "Al-Bara': ayat terakhir yang turun adalah ayat kalalah.")
    muslim_rec(4161, ['R-debt-wasiyya-first'], 'Siapa meninggalkan harta, untuk ahli waris; siapa meninggalkan tanggungan, kepada kami.')
    muslim_rec(4204, ['R-write-wasiyya'], 'Wasiat hendaknya tertulis.')
    muslim_rec(4209, ['R-wasiyya-third'], "Sa'd: sepertiga, dan sepertiga itu banyak.")
    muslim_rec(4218, ['R-wasiyya-third'], 'Ibnu Abbas: sebaiknya diturunkan ke seperempat.')

    # ---------------------------------------------------------------- Bulugh
    TOHED = 'https://en.tohed.com/hadith/bulugh-al-maram/chapter/730/sub/22474/'
    bulugh_rec(1095, ['R-furudh-then-asabah'], 'Alhiqu al-fara\'idh (muttafaq \'alaih).', tohed={'tohed.com': 805, 'url': TOHED})
    bulugh_rec(1096, ['R-barrier-religion'], 'Muslim tidak mewarisi kafir (muttafaq \'alaih).', tohed={'tohed.com': 806, 'url': TOHED})
    bulugh_rec(1097, ['R-sons-daughter-sixth', 'R-sister-asabah-maal-ghayr'], 'Ibnu Mas\'ud: putri 1/2, cucu putri 1/6, sisa untuk saudari (Bukhari).', tohed={'tohed.com': 807, 'url': TOHED})
    bulugh_rec(1098, ['R-barrier-religion'], 'Pemeluk dua agama tidak saling mewarisi.', tohed={'tohed.com': 808, 'url': TOHED}, notes=['Tahqiq footnote quotes an Ibn al-Jarud addition (spouse who kills the other inherits neither diya nor property) and calls its chain hasan - a secondary support for R-barrier-killer.'])
    bulugh_rec(1101, ['R-grandfather'], "Kakek: 'untukmu seperenam' lalu seperenam lagi sebagai tambahan (thu'mah).", tohed={'tohed.com': 809, 'url': TOHED}, notes=['Graded da\'if in the tahqiq footnote (Qatada and al-Hasan are mudallis; al-Hasan did not hear from Imran per 1102). Do NOT use as a primary dalil.'])
    bulugh_rec(1103, ['R-grandmother'], 'Nabi memberi nenek 1/6 bila tidak ada ibu.', tohed={'tohed.com': 810, 'url': TOHED})
    bulugh_rec(1104, ['R-dzawil-arham'], "Paman dari pihak ibu (khal) adalah ahli waris orang yang tidak punya ahli waris.", tohed={'tohed.com': 811, 'url': TOHED})
    bulugh_rec(1105, ['R-dzawil-arham'], "Allah dan Rasul-Nya wali bagi yang tak punya wali; khal ahli waris bagi yang tak punya ahli waris.", tohed={'tohed.com': 812, 'url': TOHED})
    bulugh_rec(1106, ['R-newborn'], 'Bayi yang lahir bersuara (istihlal) mewarisi.', tohed={'tohed.com': 813, 'url': TOHED}, notes=['Tahqiq: sahih by its routes and witnesses, but the wording is Abu Hurayra\'s, not Jabir\'s, and Abu Dawud did not narrate Jabir\'s version. The corpus EN says "treated as a hair" (typo for heir) - do not display.'])
    bulugh_rec(1107, ['R-barrier-killer'], 'Pembunuh tidak mendapat warisan apa pun.', tohed={'tohed.com': 814, 'url': TOHED}, notes=["Ibn Hajar himself writes in the matn: an-Nasa'i found a defect and 'the correct view is that it is mawquf on Umar'. The tahqiq footnote says al-Albani authenticated it in al-Irwa' no. 1671. Show both; pair with al-Umm 550 (reported no-disagreement for deliberate killing)."])
    bulugh_rec(1108, ['R-asabah-order'], "Apa yang didapat ayah atau anak adalah untuk 'ashabahnya.", tohed={'tohed.com': 815, 'url': TOHED})
    bulugh_rec(1109, ['R-wala'], "Wala' adalah kekerabatan seperti nasab; tidak dijual, tidak dihibahkan.", tohed={'tohed.com': 816, 'url': TOHED}, notes=["Graded da'if in the tahqiq footnote. Fiqh as-Sunnah 843 cites it as sahih via Ibn Hibban/al-Hakim - conflicting grades; do not use as a primary dalil."])
    bulugh_rec(1110, ['R-learn-faraid'], 'Yang paling paham fara\'idh di antara kalian adalah Zaid bin Tsabit.', tohed={'tohed.com': 817, 'url': TOHED}, notes=["Graded da'if in the tahqiq footnote."])
    bulugh_rec(1111, ['R-write-wasiyya'], 'Wasiat hendaknya tertulis (muttafaq \'alaih: Bukhari 2738, Muslim 1627).')
    bulugh_rec(1112, ['R-wasiyya-third'], "Sa'd: sepertiga, dan sepertiga itu banyak (muttafaq 'alaih).")
    bulugh_rec(1114, ['R-no-wasiyya-heir'], 'Allah telah memberi setiap pemilik hak haknya; maka tidak ada wasiat untuk ahli waris.')
    bulugh_rec(1115, ['R-no-wasiyya-heir'], "Tambahan 'kecuali bila ahli waris menghendaki' (riwayat ad-Daraquthni).", notes=["Ibn Hajar calls its chain hasan; the tahqiq footnote grades the addition munkar. Shafi'i fiqh in the corpus (Fath al-Qarib 118, Fath al-Mu'in 33) still permits a bequest to an heir with the other heirs' consent - reasoning not given in the corpus. Flag for the MUI/KHI researcher."])
    bulugh_rec(1116, ['R-wasiyya-third'], 'Allah bersedekah kepada kalian dengan sepertiga harta saat wafat, sebagai tambahan kebaikan.', notes=["Tahqiq: hasan by its witnesses; 1117-1119 say all chains are weak but strengthen one another."])

    # ---------------------------------------------------------------- excerpt helper
    def excerpt(text, start, end, nth_start=0):
        ss = find_orig(text, start)
        if len(ss) <= nth_start:
            raise SystemExit(f'start not found: {start}')
        a = ss[nth_start][0]
        ee = [x for x in find_orig(text, end) if x[1] > a]
        if not ee:
            raise SystemExit(f'end not found: {end}')
        b = ee[0][1]
        return a, b, text[a:b]

    def fiqh_ex(rid, book, store, sec, start, end, rules, gist, notes=None, nth=0):
        r = store[sec]
        a, b, _ = excerpt(r['ar'], start, end, nth)
        head = {'id': rid, 'kind': 'fiqh', 'book': book, 'section_id': sec, 'anchor': r['anchor'],
                'qism': r.get('qism', ''), 'title': r['title']}
        add(excerpt_record(head, r['ar'], a, b, {'grounds': rules, 'gist_id': gist}, notes or [],
                           SOURCE_TRUNCATED.get(rid)))

    def tafsir_ex(rid, which, key, start, end, rules, gist, notes=None, nth=0):
        store = ik if which == 'IK' else tb
        r = store[key]
        a, b, _ = excerpt(r['ar'], start, end, nth)
        head = {'id': rid, 'kind': 'tafsir',
                'book': 'Tafsir Ibn Kathir (AR)' if which == 'IK' else 'Tafsir al-Tabari, Jami\' al-Bayan (AR)',
                'ref': {'surah': key[0], 'ayah': key[1]}, 'record_key': f'{key[0]}:{key[1]}'}
        add(excerpt_record(head, r['ar'], a, b, {'grounds': rules, 'gist_id': gist}, notes or [],
                           SOURCE_TRUNCATED.get(rid)))

    FQ = "Fath al-Qarib al-Mujib (Ibn Qasim al-Ghazzi), Kitab Ahkam al-Fara'id wa al-Wasaya"
    FM = "Fath al-Mu'in (Zayn al-Din al-Malibari)"
    FS = 'Fiqh as-Sunnah (Sayyid Sabiq)'
    UM = "al-Umm (al-Shafi'i)"

    # ---------------------------------------------------------------- Fath al-Qarib
    fiqh_ex('F-FQARIB-116-heirs', FQ, fqarib, '116', 'والوارثون من الرجال', 'ولا يكون الميت في هذه الصورة إلا رجلا', ['R-heirs-list'], '10 laki-laki dan 7 perempuan yang disepakati sebagai ahli waris; lima yang tidak pernah gugur.', nth=0)
    fiqh_ex('F-FQARIB-116-barriers', FQ, fqarib, '116', 'ومن لا يرث بحال سبعة', 'والمرتد لا يرث من مرتد ولا من مسلم ولا من كافر', ['R-barrier-killer', 'R-barrier-religion'], 'Tujuh yang tidak mewarisi: budak (dst.), pembunuh, murtad, dua agama berbeda.')
    fiqh_ex('F-FQARIB-116-asabah', FQ, fqarib, '116', 'وأقرب العصبات', 'فالمولى المعتق', ['R-asabah-order'], "Urutan 'ashabah: anak laki-laki, cucu laki-laki, ayah, kakek, saudara kandung, saudara seayah, keponakan, paman, sepupu.")
    fiqh_ex('F-FQARIB-117-furudh', FQ, fqarib, '117', 'والفروض المذكورة', 'فرض الواحد من ولد الأم) ذكرا كان أو أنثى', ['R-six-shares', 'R-daughters', 'R-spouses', 'R-parents', 'R-maternal-siblings', 'R-grandmother', 'R-grandfather', 'R-sons-daughter-sixth'], 'Enam bagian pasti dan siapa pemiliknya (1/2, 1/4, 1/8, 2/3, 1/3, 1/6).')
    fiqh_ex('F-FQARIB-117-hajb', FQ, fqarib, '117', 'وتسقط الجدات', 'وبالأخ للأب والأم', ['R-hajb-siblings', 'R-hajb-grandparents'], 'Hajb: nenek gugur oleh ibu, kakek oleh ayah, saudara seibu oleh anak/cucu/ayah/kakek, saudara kandung oleh anak/cucu laki-laki/ayah, saudara seayah juga oleh saudara kandung.')
    fiqh_ex('F-FQARIB-118-asabah-bil-ghayr', FQ, fqarib, '118', 'وأربعة يعصبون أخواتهم', 'وأخواتهم من ذوي الأرحام لا يرثون', ['R-2to1'], 'Empat laki-laki yang menarik saudarinya menjadi ashabah (2:1); saudara seibu tidak.')
    fiqh_ex('F-FQARIB-118-wasiyya', FQ, fqarib, '118', 'وهي) أي الوصية (من الثلث', 'إلا أن يجيزها باقي الورثة) المطلقين التصرف', ['R-wasiyya-third', 'R-no-wasiyya-heir'], 'Wasiat dari sepertiga; lebih dari itu bergantung izin ahli waris; wasiat untuk ahli waris tidak boleh kecuali disetujui ahli waris lain.')

    # ---------------------------------------------------------------- Fath al-Mu'in
    fiqh_ex('F-FMUIN-34-radd-dzawil-arham', FM, fmuin, '34', 'ولو فقد الورثة كلهم', 'وولد أخ لام', ['R-radd', 'R-dzawil-arham'], "Asal mazhab: tidak ada radd dan dzawil arham (harta ke baitul mal); bila baitul mal tidak teratur: radd kepada ashabul furudh selain suami/istri, lalu dzawil arham (11 golongan).")
    fiqh_ex('F-FMUIN-34-umariyyatain', FM, fmuin, '34', 'وثلث باق بعد فرض الزوج', 'وفي الثانية ربع', ['R-mother-third-sixth'], "Gharrawain/'Umariyyatain: ibu mendapat 1/3 sisa bersama suami/istri dan ayah.")
    fiqh_ex('F-FMUIN-34-hajb', FM, fmuin, '34', 'ويحجب ولد ابن بابن أو ابن ابن أقرب منه ويحجب جد', 'بأخت لأبوين معها بنت أو بنت ابن كما سيأتي', ['R-hajb-siblings', 'R-hajb-grandparents'], 'Daftar hajb rinci.')
    fiqh_ex('F-FMUIN-34-jadd-like-ab', FM, fmuin, '34', 'واعلم أن ابن الابن كالابن', 'ليس له مع الأخت لأبوين مثلاها', ['R-grandfather', 'R-grandmother'], 'Cucu seperti anak, nenek seperti ibu (selalu 1/6), kakek seperti ayah kecuali tidak menghalangi saudara.')
    fiqh_ex('F-FMUIN-34-asabah-order', FM, fmuin, '34', 'وهي ابن ف بعده ابنه', 'وأخ لأب كأخ لأبوين فيما ذكر', ['R-asabah-order', 'R-2to1'], "Urutan 'ashabah dan alasan 2:1 menurut penulis.")
    fiqh_ex('F-FMUIN-35-awl', FM, fmuin, '35', 'وتعول من أصول مسائل الفرائض ثلاثة', 'إذا ضاق المال عن قدر حصتهم', ['R-awl'], "'Aul: asal 6 naik sampai 10, 12 sampai 17, 24 sampai 27 (Minbariyyah, Ali); kekurangan dibagi rata seperti utang.")
    fiqh_ex('F-FMUIN-35-usul', FM, fmuin, '35', 'أصل المسألة عدد الرؤوس إن كانت الورثة عصبات كثلاثة', 'ثمانية واثنا عشر وأربعة وعشرون', ['R-calc-method'], 'Asal masalah dan tujuh angka penyebut (2, 3, 4, 6, 8, 12, 24).', nth=0)
    fiqh_ex('F-FMUIN-33-heir-consent', FM, fmuin, '33', 'وتصح لوارث للموصي مع إجازة بقية ورثته', 'إذ لا حق لهم حينئذ', ['R-no-wasiyya-heir'], 'Wasiat untuk ahli waris sah dengan izin ahli waris lain setelah pewaris wafat; izin semasa hidup tidak berpengaruh.')
    fiqh_ex('F-FMUIN-33-above-third', FM, fmuin, '33', 'وتكره الزيادة على الثلث', 'حرمت', ['R-wasiyya-third'], 'Lebih dari sepertiga makruh; haram bila bermaksud menghalangi ahli waris.')
    fiqh_ex('F-FMUIN-11-tajhiz', FM, fmuin, '11', 'ومحل تجهيزه', 'فعلى مياسير المسلمين', ['R-tajhiz'], 'Biaya pengurusan jenazah diambil dari tirkah (kecuali istri: ditanggung suami yang mampu).')

    # ---------------------------------------------------------------- al-Umm
    fiqh_ex('F-ALUMM-572', UM, alumm, '572', 'ثم ما لم أعلم أهل العلم', 'قضى بالدين قبل الوصية', ['R-debt-wasiyya-first'], "Asy-Syafi'i: utang didahulukan atas wasiat dan warisan berdasarkan 'au dain' dan ijma'; hadits Ali 'qadha bid-dain qablal washiyyah' tidak dianggap tsabit oleh ahli hadits.")
    fiqh_ex('F-ALUMM-550-killer', UM, alumm, '550', 'ولم أسمع اختلافا في أن قاتل الرجل عمدا', 'أشبه بعموم أن لا يرث قاتل ممن قتل', ['R-barrier-killer'], "Asy-Syafi'i: tidak ada perbedaan bahwa pembunuh sengaja tidak mewarisi; pembunuh tidak sengaja diperselisihkan; ia memilih: tidak mewarisi sama sekali.")
    fiqh_ex('F-ALUMM-903-umar', UM, alumm, '903', 'ثم قال أين أخو المقتول', 'ليس لقاتل شيء', ['R-barrier-killer'], "Umar memberikan diyat kepada saudara korban, bukan kepada ayah pembunuh, berdalil sabda Nabi 'laisa li qatilin syai''.")

    # ---------------------------------------------------------------- Fiqh as-Sunnah
    fiqh_ex('F-FSUNNAH-840-sad-rabi', FS, fsunnah, '840', 'سبب نزول الاية', 'رواه الخمسة إلا النسائي', ['R-daughters', 'R-asbab-nuzul'], "Sebab turun 4:11: dua putri Sa'd bin ar-Rabi' - 'berikan kepada dua putri Sa'd dua pertiga, ibu mereka seperdelapan, sisanya untukmu'.", notes=["Only a secondary citation (Sayyid Sabiq: 'rawahu al-khamsah illa an-Nasa'i'). The primary (Abu Dawud/Tirmidhi/Ibn Majah) is not in the corpus; grade not given in the corpus -> needs external source for number + grade."])
    fiqh_ex('F-FSUNNAH-844-mawani', FS, fsunnah, '844', 'والموانع أربعة', 'ولا يرث الكافر المسلم', ['R-barrier-killer', 'R-barrier-religion'], "Empat penghalang; perbedaan mazhab tentang jenis pembunuhan (Syafi'i: semua pembunuhan; Maliki: sengaja dan zalim).", notes=["Quotes the Egyptian inheritance law (art. 5) - not Indonesian law."])
    fiqh_ex('F-FSUNNAH-852-awl-umar', FS, fsunnah, '852', 'وروي أن أول فريضة عالت في الاسلام', 'وقيل: زيد بن ثابت', ['R-awl'], "Kasus 'aul pertama: Umar, suami + dua saudari; diusulkan oleh Abbas (atau Ali/Zaid).", notes=['"Ruwiya" (reported) - no chain or source given in the corpus; needs external source for the primary report.'])
    fiqh_ex('F-FSUNNAH-854-radd-no-nass', FS, fsunnah, '854', 'رأي العلماء في الرد', 'فمنهم من رأى عدم الرد على أحد من أصحاب', ['R-radd'], "Tidak ada nash tentang radd; ulama berbeda pendapat.")
    fiqh_ex('F-FSUNNAH-856-dzawil-arham', FS, fsunnah, '856', 'ذوو الارحام هم كل قريب ليس بذي فرض ولا عصبة', 'وعن سعيد بن المسيب: أن الخال يرث مع البنت', ['R-dzawil-arham'], "Dzawil arham: Malik dan Syafi'i tidak mewariskan (ke baitul mal); Abu Hanifah dan Ahmad mewariskan.")
    fiqh_ex('F-FSUNNAH-859-pregnancy', FS, fsunnah, '859', 'من يختلف نصيبه من أصحاب الفروض باختلاف ذكورة الحمل وأنوثته', 'ووزعت التركة كلها على الورثة دون اعتبار للحمل', ['R-newborn'], 'Bila ada janin: ahli waris yang bagiannya berubah diberi bagian terkecil; janin dicadangkan bagian terbesar.')

    # ---------------------------------------------------------------- Tafsir Ibn Kathir
    tafsir_ex('T-IK-2-180-naskh', 'IK', (2, 180), 'اشتملت هذه الآية الكريمة', 'منسوخ بالإجماع بل منهى عنه', ['R-wasiyya-history', 'R-no-wasiyya-heir'], 'Wasiat wajib untuk orang tua/kerabat dihapus oleh ayat waris; pendapat "mansukh bagi yang mewarisi, tetap bagi yang tidak mewarisi"; Ibnu Katsir: kewajiban wasiat kepada kerabat yang mewarisi dihapus secara ijma\'.')
    tafsir_ex('T-IK-2-240-naskh', 'IK', (2, 240), 'قال الأكثرون هذه الآية منسوخة بالتي قبلها', 'فجعل لهن الثمن أو الربع مما ترك الزوج', ['R-wasiyya-history', 'R-spouses'], "Mayoritas: 2:240 dihapus (iddah oleh 2:234; nafkah setahun oleh ayat waris: istri 1/8 atau 1/4).")
    tafsir_ex('T-IK-4-7-muhkam', 'IK', (4, 7), 'وقوله"وإذا حضر القسمة" الآية', 'هي قائمة يعمل بها', ['R-gift-at-division'], '4:8: ada dua pendapat (mansukh atau tidak); Bukhari dari Ibnu Abbas: muhkam.')
    tafsir_ex('T-IK-4-8-naskh', 'IK', (4, 8), 'ذكر من قال إن هذه الآية منسوخة بالكلية', 'وهذا مذهب جمهور الفقهاء والأئمة الأربعة وأصحابهم', ['R-gift-at-division'], 'Pendapat yang menyatakan 4:8 mansukh; Ibnu Katsir menisbatkannya kepada jumhur dan imam empat.')
    tafsir_ex('T-IK-4-11-dayn', 'IK', (4, 11), 'أجمع العلماء من السلف والخلف على أن الدين مقدم على الوصية', 'فالله أعلم', ['R-debt-wasiyya-first'], "Ijma' salaf dan khalaf: utang didahulukan atas wasiat; hadits Ali (Ahmad, Tirmidzi, Ibnu Majah) dengan catatan tentang al-Harits.")
    tafsir_ex('T-IK-4-12-kalala', 'IK', (4, 12), 'كنت آخر الناس عهدا بعمر', 'أي من أم كما هو في قراءة بعض السلف منهم سعد بن أبي وقاص', ['R-maternal-siblings', 'R-hajb-siblings'], "Kalalah = tidak punya anak dan ayah; dihikayatkan ijma'; 'akh au ukht' di 4:12 = saudara seibu.")
    tafsir_ex('T-IK-4-12-musytaraka', 'IK', (4, 12), 'واختلف العلماء في المسألة المشتركة', 'فشرك بينهم', ['R-special-cases'], "Masalah musyarakah (himariyah) di masa Umar.")
    tafsir_ex('T-IK-4-12-no-harm', 'IK', (4, 12), 'ومتى كان حيلة ووسيلة إلى زيادة بعض الورثة', 'غير مضار وصية من الله والله عليم حليم', ['R-no-harm-wasiyya'], "Wasiat/pengakuan sebagai siasat menambah atau mengurangi bagian ahli waris: haram secara ijma' dan nash 4:12.")
    tafsir_ex('T-IK-4-176-father-blocks', 'IK', (4, 176), 'وقضاء الصديق أنه الذي لا ولد له ولا والد', 'بل ليس لها ميراث بالكلية', ['R-hajb-siblings'], "Kalalah = tanpa anak dan ayah; ayah menghalangi saudari 'bil-ijma''.")
    tafsir_ex('T-IK-4-176-two-daughters', 'IK', (4, 176), 'كلالة أختان فرض لهما الثلثان', 'فإن كن نساء فوق اثنتين فلهن ثلثا ما ترك', ['R-daughters', 'R-siblings-kalala'], "Dua saudari mendapat 2/3; 'dari sinilah jumhur mengambil hukum dua putri' (2/3), sebagaimana hukum saudari diambil dari ayat anak perempuan.")
    tafsir_ex('T-IK-4-176-zayd-husband-sister', 'IK', (4, 176), 'عن زيد بن ثابت أنه سئل عن زوج وأخت لأب وأم', 'تفرد به أحمد من هذا الوجه', ['R-siblings-kalala', 'R-spouses'], "Zaid bin Tsabit: suami 1/2 dan saudari kandung 1/2, 'aku menyaksikan Rasulullah memutuskan demikian' (Ahmad saja dari jalur ini).", notes=["Primary (Musnad Ahmad) not in the corpus; grade not given - needs external takhrij before use."])
    tafsir_ex('T-IK-4-33-hilf', 'IK', (4, 33), 'وقد كان هذا في ابتداء الإسلام ثم نسخ', 'ولا ينسوا بعد نزول هذه الآية معاقدة', ['R-no-inheritance-by-oath'], 'Waris karena sumpah setia (hilf) pada awal Islam lalu dihapus.')

    # ---------------------------------------------------------------- Tafsir al-Tabari
    tafsir_ex('T-TB-2-180-view', 'TB', (2, 180), 'وأولى هذه الأقوال بالصواب في تأويل قوله', 'كما قال الله جل ذكره وأمر به', ['R-wasiyya-history'], "Ath-Thabari: wasiat wajib bagi yang punya harta, sedikit atau banyak, untuk kerabat yang tidak mewarisi (pandangan beliau; berbeda dengan jumhur).")
    tafsir_ex('T-TB-2-240-naskh', 'TB', (2, 240), 'وأولى هذه الأقوال عندي في ذلك بالصواب أن يقال', 'وردهن إلى أربعة أشهر وعشر', ['R-wasiyya-history'], 'Ath-Thabari: nafkah setahun dihapus oleh ayat waris; tempat tinggal dikembalikan ke 4 bulan 10 hari.')
    tafsir_ex('T-TB-4-8-muhkam', 'TB', (4, 8), 'وأولى الأقوال في ذلك بالصحة', 'أن يقال لهم قول معروف', ['R-gift-at-division'], 'Ath-Thabari: 4:8 muhkam, berkaitan dengan wasiat untuk kerabat; yatim dan miskin diberi kata yang baik.')
    tafsir_ex('T-TB-4-11-ikhwa-two', 'TB', (4, 11), 'والصواب من القول في ذلك عندي، أن المعني بقوله', 'وإنكارهم ما قاله ابن عباس في ذلك', ['R-mother-third-sixth'], "'Ikhwah' yang menurunkan ibu ke 1/6 = dua saudara atau lebih (bukan pendapat Ibnu Abbas).")
    tafsir_ex('T-TB-4-11-father-blocks', 'TB', (4, 11), 'وأما الذي روي عن طاوس عن ابن عباس', 'أن لا ميراث لأخي ميت مع والده', ['R-hajb-siblings'], 'Tidak ada perbedaan: saudara tidak mewarisi bersama ayah mayit.')
    tafsir_ex('T-TB-4-12-kalala', 'TB', (4, 12), 'والصواب من القول في ذلك عندي ما قاله هؤلاء', 'من عدا ولده ووالده', ['R-maternal-siblings', 'R-hajb-siblings'], 'Kalalah = ahli waris selain anak dan ayah.')
    tafsir_ex('T-TB-4-176-daughter-sister', 'TB', (4, 176), 'ولقد علمت اتفاق جميع أهل القبلة', 'إذا كانت أخته لأبيه وأمه، أو لأبيه', ['R-sister-asabah-maal-ghayr'], 'Kesepakatan (kecuali Ibnu Abbas dan Ibnu az-Zubair): putri 1/2, sisanya untuk saudari kandung/seayah.')

    # ---------------------------------------------------------------- section index (no text): where lessons can cite
    SECTION_INDEX = [
        ('fath-al-qarib.json', fqarib, ['116', '117', '118']),
        ('fath-al-muin.json', fmuin, ['11', '33', '34', '35']),
        ('fiqh-as-sunnah.json', fsunnah, [str(i) for i in range(828, 867)]),
        ('al-umm.json', alumm, [str(i) for i in range(549, 560)] + ['572', '580', '581', '584', '585']),
    ]
    for fname, store, secs in SECTION_INDEX:
        for s in secs:
            r = store[s]
            add({'id': f'S-{fname.replace(".json", "").upper()}-{s}', 'kind': 'section_index', 'file': 'api/data/' + fname,
                 'section_id': s, 'anchor': r['anchor'], 'qism': r.get('qism', ''), 'title': r['title'], 'char_count': r['char_count']})
    for key in [(4, 11), (4, 12), (4, 176), (4, 7), (4, 8), (4, 33), (2, 180), (2, 240), (8, 75), (33, 6)]:
        for which, store in (('IK', ik), ('TB', tb)):
            r = store[key]
            add({'id': f'S-{which}-{key[0]}-{key[1]}', 'kind': 'section_index',
                 'file': 'api/data/' + ('tafsir-ibn-kathir.json' if which == 'IK' else 'tafsir-al-tabari.json'),
                 'record_key': f'{key[0]}:{key[1]}', 'char_count': len(r['ar'])})

    # ---------------------------------------------------------------- rule map
    # status: found = strongest dalil is in the corpus; partial = some of the rule
    # is in the corpus, the rest is flagged; external = needs external source.
    RULES = [
        ('R-debt-wasiyya-first', 'Harta dibagi sesudah utang dilunasi dan wasiat (yang sah) ditunaikan; utang didahulukan atas wasiat.',
         ['Q-4-11', 'Q-4-12', 'F-ALUMM-572', 'T-IK-4-11-dayn'], ['H-BUKHARI-6731', 'H-MUSLIM-1619e'], 'found',
         "The order debt > wasiyya rests on the ayat + reported ijma' (al-Umm 572, Ibn Kathir 4:11). The marfu' report of Ali ('qada bid-dayn qabl al-wasiyya') is judged not established by al-Shafi'i and criticised via al-Harith (Ibn Kathir) - do not present it as the main dalil."),
        ('R-tajhiz', 'Biaya pengurusan jenazah diambil dari harta peninggalan.',
         ['F-FMUIN-11-tajhiz'], [], 'partial',
         "Corpus states tajhiz comes from the estate (and that a wife's tajhiz falls on a solvent husband). Its priority BEFORE debts is not stated in any corpus text found -> needs external source (classical Syafi'i order of huquq al-tarika / KHI)."),
        ('R-wasiyya-third', 'Wasiat paling banyak sepertiga harta; lebih kecil lebih baik.',
         ['H-BUKHARI-2742', 'H-MUSLIM-1628a'], ['H-BUKHARI-2743', 'H-MUSLIM-1629', 'H-BULUGH-1112', 'H-BULUGH-1116', 'F-FQARIB-118-wasiyya', 'F-FMUIN-33-above-third', 'Q-33-6'], 'found', ''),
        ('R-no-wasiyya-heir', 'Tidak ada wasiat untuk ahli waris.',
         ['H-BULUGH-1114', 'T-IK-2-180-naskh'], ['H-BUKHARI-6739', 'F-FQARIB-118-wasiyya', 'F-FMUIN-33-heir-consent', 'H-BULUGH-1115'], 'partial',
         "Bulugh 1114 (Abu Umamah) is graded sahih in the tahqiq footnote, which names Abu Dawud 3565, Tirmidhi 2120, Ibn Majah 2713 - those primaries are NOT in the corpus. Exception 'unless the other heirs consent': the hadith addition (1115) is graded munkar in the tahqiq, but Syafi'i fiqh in the corpus allows it with the other heirs' consent after death. Which one the calculator follows is an MUI/KHI decision."),
        ('R-write-wasiyya', 'Orang yang punya sesuatu untuk diwasiatkan hendaknya menuliskannya.',
         ['H-BUKHARI-2738', 'H-MUSLIM-1627a'], ['H-BULUGH-1111'], 'found', ''),
        ('R-no-harm-wasiyya', 'Wasiat tidak boleh dipakai untuk merugikan ahli waris.',
         ['Q-4-12', 'T-IK-4-12-no-harm'], ['F-FMUIN-33-above-third'], 'found', ''),
        ('R-furudh-then-asabah', "Bagian pasti (furudh) diberikan dulu; sisanya untuk 'ashabah (laki-laki terdekat).",
         ['H-BUKHARI-6732', 'H-MUSLIM-1615a'], ['H-MUSLIM-1615c', 'H-BULUGH-1095', 'H-BUKHARI-6745'], 'found', ''),
        ('R-six-shares', 'Enam bagian pasti dalam Al-Qur\'an: 1/2, 1/4, 1/8, 2/3, 1/3, 1/6.',
         ['Q-4-11', 'Q-4-12', 'Q-4-176'], ['F-FQARIB-117-furudh'], 'found', ''),
        ('R-2to1', 'Bila anak (atau saudara kandung/seayah) laki-laki dan perempuan bersama, laki-laki mendapat dua kali bagian perempuan.',
         ['Q-4-11', 'Q-4-176'], ['H-BUKHARI-6739', 'F-FQARIB-118-asabah-bil-ghayr', 'F-FMUIN-34-asabah-order'], 'found',
         "Maternal siblings share EQUALLY (Q 4:12; F-FQARIB-118 says the maternal brother does not make his sister 'asabah). Reasons for 2:1 in the corpus are scholars' explanations (Fath al-Mu'in; QuranEnc footnote 181), not part of the dalil."),
        ('R-daughters', 'Satu putri 1/2; dua putri atau lebih 2/3; bersama putra: 2:1.',
         ['Q-4-11', 'T-IK-4-176-two-daughters'], ['F-FSUNNAH-840-sad-rabi', 'S-IK-4-11', 'S-TB-4-11', 'F-FQARIB-117-furudh'], 'partial',
         "'Fawqa ithnatayn' (more than two) vs two daughters: the two-thirds for TWO daughters is grounded in the Sa'd ibn ar-Rabi' report, which the corpus has only second-hand (Fiqh as-Sunnah 840: 'rawahu al-khamsah illa an-Nasa'i'; Ibn Kathir/Tabari 4:11). Primary (Abu Dawud/Tirmidhi/Ibn Majah) number and grade: needs external source. Ibn Kathir 4:176 gives the corpus-internal argument: the jumhur took the two daughters' 2/3 from the two sisters' 2/3 in 4:176."),
        ('R-sons-daughter-sixth', 'Cucu perempuan dari anak laki-laki mendapat 1/6 bersama satu putri (penyempurna 2/3).',
         ['H-BUKHARI-6736'], ['H-BULUGH-1097', 'F-FQARIB-117-furudh'], 'found', ''),
        ('R-sister-asabah-maal-ghayr', "Saudari kandung/seayah bersama putri (atau cucu putri) menjadi 'ashabah: mengambil sisa.",
         ['H-BUKHARI-6736', 'H-BUKHARI-6734'], ['T-TB-4-176-daughter-sister', 'H-BULUGH-1097', 'F-FMUIN-34-hajb'], 'found',
         "Al-Tabari notes Ibn Abbas and Ibn az-Zubayr dissented; present as the majority/consensus position, not unanimous."),
        ('R-parents', 'Ayah dan ibu masing-masing 1/6 bila ada anak.',
         ['Q-4-11'], ['H-BUKHARI-6739'], 'found', ''),
        ('R-mother-third-sixth', "Ibu 1/3 bila tidak ada anak dan tidak ada (dua atau lebih) saudara; 1/6 bila ada. Kasus 'Umariyyatain: 1/3 sisa.",
         ['Q-4-11', 'T-TB-4-11-ikhwa-two'], ['F-FMUIN-34-umariyyatain', 'F-FQARIB-117-furudh'], 'found', ''),
        ('R-spouses', 'Suami 1/2 (tanpa anak) atau 1/4 (ada anak); istri 1/4 atau 1/8, dibagi rata bila lebih dari satu.',
         ['Q-4-12'], ['H-BUKHARI-6739', 'F-FQARIB-117-furudh'], 'found', ''),
        ('R-maternal-siblings', 'Saudara seibu (dalam kalalah): satu orang 1/6, dua atau lebih berbagi 1/3 sama rata.',
         ['Q-4-12', 'T-IK-4-12-kalala'], ['F-FQARIB-117-furudh', 'T-TB-4-12-kalala'], 'found',
         "That 'akh aw ukht' in 4:12 means maternal siblings is from tafsir (Sa'd's reading, Abu Bakr), not the Tanzil text itself."),
        ('R-siblings-kalala', 'Kalalah: saudari kandung/seayah 1/2, dua atau lebih 2/3; saudara laki-laki mewarisi semuanya; campuran 2:1.',
         ['Q-4-176'], ['H-MUSLIM-1618a', 'H-BUKHARI-6744', 'H-MUSLIM-1617a', 'H-MUSLIM-1616a'], 'found', ''),
        ('R-hajb-siblings', 'Saudara (kandung, seayah, seibu) terhalang oleh anak laki-laki, cucu laki-laki, dan ayah; saudara seibu juga oleh anak perempuan dan kakek.',
         ['T-IK-4-176-father-blocks', 'T-TB-4-11-father-blocks', 'Q-4-176'], ['F-FQARIB-117-hajb', 'F-FMUIN-34-hajb', 'T-IK-4-12-kalala', 'T-TB-4-12-kalala'], 'found',
         "No marfu' hadith in the corpus states it directly; it rests on the kalala ayat (4:12, 4:176) plus reported ijma' (Ibn Kathir 4:176; al-Tabari 4:11 'la khilaf')."),
        ('R-hajb-grandparents', 'Nenek terhalang oleh ibu; kakek terhalang oleh ayah; cucu oleh anak laki-laki.',
         ['F-FQARIB-117-hajb', 'F-FMUIN-34-hajb'], ['H-BULUGH-1103'], 'found', ''),
        ('R-grandmother', 'Nenek mendapat 1/6 bila tidak ada ibu (beberapa nenek berbagi 1/6).',
         ['H-BULUGH-1103'], ['F-FQARIB-117-furudh', 'F-FMUIN-34-jadd-like-ab'], 'partial',
         "Bulugh 1103 is graded hasan in the tahqiq (cites Abu Dawud 2895; primary not in corpus). The Abu Bakr / al-Mughira / Muhammad ibn Maslama report on the grandmother's sixth was NOT found in the corpus -> needs external source."),
        ('R-grandfather', 'Kakek menggantikan ayah (1/6 bila ada anak, atau ashabah) bila ayah tidak ada; bersama saudara ada perbedaan pendapat.',
         ['F-FQARIB-117-furudh', 'F-FMUIN-34-jadd-like-ab'], ['H-BUKHARI-6738', 'S-AL-UMM-556'], 'partial',
         "Grandfather + siblings is a classical khilaf (Abu Bakr's view in Bukhari 6738 vs the Syafi'i muqasama rules in al-Umm 556 / Fath al-Qarib 117). The calculator needs an explicit MUI/KHI choice. Bulugh 1101 (grandson's sixth) is da'if - do not use."),
        ('R-barrier-religion', 'Beda agama menghalangi saling mewarisi.',
         ['H-BUKHARI-6764', 'H-MUSLIM-1614'], ['H-BULUGH-1096', 'H-BULUGH-1098', 'Q-4-141', 'F-FQARIB-116-barriers', 'F-FSUNNAH-844-mawani'], 'found', "MUI Fatwa 5/MUNAS VII/MUI/9/2005 cites Q 4:11, Q 4:141, the Usama hadith and the 'Abdullah ibn 'Amr hadith (= Bulugh 1098) - all four are in this file (see standard.md 1.1 for the fatwa source)."),
        ('R-barrier-killer', 'Pembunuh tidak mewarisi dari orang yang dibunuhnya.',
         ['F-ALUMM-550-killer', 'H-BULUGH-1107'], ['F-ALUMM-903-umar', 'F-FQARIB-116-barriers', 'F-FSUNNAH-844-mawani', 'H-BULUGH-1098'], 'partial',
         "Deliberate killing: al-Shafi'i reports no disagreement (al-Umm 550). Accidental killing: khilaf (al-Shafi'i: also barred; Maliki: only deliberate wrongful). The marfu' wording in Bulugh 1107 is disputed (Ibn Hajar: correct is mawquf on Umar; tahqiq: authenticated by al-Albani, Irwa' 1671). Which killing types bar inheritance in the questionnaire is an MUI/KHI decision."),
        ('R-asabah-order', "Urutan 'ashabah: jalur anak, lalu ayah/kakek, lalu saudara, lalu paman; yang lebih dekat menghalangi yang jauh.",
         ['F-FQARIB-116-asabah', 'F-FMUIN-34-asabah-order'], ['H-BUKHARI-6732', 'H-BULUGH-1108', 'S-FIQH-AS-SUNNAH-849', 'S-FIQH-AS-SUNNAH-850'], 'found', ''),
        ('R-awl', "'Aul: bila jumlah bagian melebihi harta, semua bagian dikurangi secara proporsional.",
         ['F-FMUIN-35-awl', 'F-FSUNNAH-852-awl-umar'], ['S-FIQH-AS-SUNNAH-853'], 'partial',
         "No Qur'an/hadith text; it is the ijtihad of the Companions as reported. The corpus gives no chain for 'the first 'awl under Umar' (Fiqh as-Sunnah: 'ruwiya') -> primary report needs external source."),
        ('R-radd', 'Radd: sisa harta (tanpa ashabah) dikembalikan kepada ashabul furudh selain suami/istri, proporsional.',
         ['F-FSUNNAH-854-radd-no-nass', 'F-FMUIN-34-radd-dzawil-arham'], ['S-AL-UMM-552', 'S-AL-UMM-553', 'S-AL-UMM-555'], 'partial',
         "Fiqh as-Sunnah: 'there is no nass on radd'. Original Syafi'i doctrine (al-Umm): no radd, surplus to bayt al-mal; later Syafi'i (Fath al-Mu'in): radd when bayt al-mal is not orderly. Radd to a spouse is a further khilaf. MUI/KHI decision needed."),
        ('R-dzawil-arham', 'Kerabat yang bukan ashabul furudh dan bukan ashabah (dzawil arham) mewarisi bila tidak ada keduanya (menurut sebagian ulama).',
         ['Q-8-75', 'Q-33-6', 'H-BULUGH-1104'], ['H-BULUGH-1105', 'F-FSUNNAH-856-dzawil-arham', 'F-FMUIN-34-radd-dzawil-arham'], 'partial',
         "Khilaf: Malik and al-Shafi'i (original) did not give dzawil arham; Abu Hanifa and Ahmad did; later Syafi'i accept it when bayt al-mal is not orderly."),
        ('R-newborn', 'Bayi yang lahir hidup mewarisi; selama masih janin, bagian terbesar dicadangkan.',
         ['H-BULUGH-1106'], ['F-FSUNNAH-859-pregnancy', 'S-FIQH-AS-SUNNAH-857', 'S-FIQH-AS-SUNNAH-858'], 'found',
         "Bulugh 1106: tahqiq says sahih by routes/witnesses but notes the wording belongs to Abu Hurayra's hadith, not Jabir's."),
        ('R-women-inherit', 'Laki-laki dan perempuan sama-sama berhak waris (berbeda dengan adat jahiliyah).',
         ['Q-4-7'], ['S-FIQH-AS-SUNNAH-839', 'H-BUKHARI-6739'], 'found', ''),
        ('R-obligation', 'Pembagian waris adalah batas-batas Allah; menaatinya berpahala, melanggarnya berdosa.',
         ['Q-4-13', 'Q-4-14'], ['Q-4-11'], 'found', ''),
        ('R-gift-at-division', 'Kerabat bukan ahli waris, anak yatim, dan orang miskin yang hadir saat pembagian diberi sekadarnya dan disapa dengan baik.',
         ['Q-4-8', 'H-BUKHARI-4576'], ['T-IK-4-7-muhkam', 'T-IK-4-8-naskh', 'T-TB-4-8-muhkam', 'H-BUKHARI-2759'], 'found',
         "Khilaf on whether 4:8 is abrogated: Ibn Abbas (Bukhari 4576) and al-Tabari: muhkam; Ibn Kathir attributes 'abrogated' to the jumhur and the four imams. Present it as a recommended kindness, not a fixed share."),
        ('R-kinship-priority', 'Kerabat lebih berhak satu sama lain dalam hal waris.',
         ['Q-8-75', 'Q-33-6'], ['Q-4-33'], 'found', ''),
        ('R-no-inheritance-by-oath', 'Waris karena sumpah setia atau persaudaraan Muhajirin-Anshar dihapus; yang tersisa adalah tolong-menolong dan wasiat.',
         ['H-BUKHARI-6747', 'T-IK-4-33-hilf'], ['Q-4-33', 'Q-33-6'], 'found', ''),
        ('R-wasiyya-history', 'Ayat wasiat untuk orang tua/kerabat (2:180) dan wasiat nafkah janda (2:240) dibahas para mufassir sebagai mansukh oleh ayat waris (dengan rincian perbedaan).',
         ['T-IK-2-180-naskh', 'T-IK-2-240-naskh', 'H-BUKHARI-6739'], ['Q-2-180', 'Q-2-240', 'T-TB-2-180-view', 'T-TB-2-240-naskh'], 'found',
         "Ibn Kathir: wajib wasiyya to inheriting parents/relatives is abrogated by ijma'; some held it remains for non-inheriting relatives; al-Tabari holds wasiyya to non-inheriting relatives is still obligatory. Present as tafsir discussion, not a ruling."),
        ('R-asbab-nuzul', 'Sebab turunnya ayat waris (Jabir; istri Sa\'d bin ar-Rabi\').',
         ['H-BUKHARI-6723', 'H-MUSLIM-1616a'], ['F-FSUNNAH-840-sad-rabi', 'H-BUKHARI-4577'], 'found',
         "Jabir's reports in Bukhari/Muslim name different verses (Bukhari 4577: 4:11; Muslim 1616a: 4:176). Do not merge them into one story."),
        ('R-heirs-list', 'Daftar ahli waris yang disepakati (10 laki-laki, 7 perempuan secara ringkas).',
         ['F-FQARIB-116-heirs'], [], 'found', ''),
        ('R-calc-method', 'Cara hitung: asal masalah dari penyebut bagian (2, 3, 4, 6, 8, 12, 24).',
         ['F-FMUIN-35-usul'], [], 'found', 'A method, not a dalil.'),
        ('R-special-cases', "Kasus khusus: musyarakah (himariyah), 'umariyyatain, minbariyyah.",
         ['T-IK-4-12-musytaraka', 'F-FMUIN-34-umariyyatain', 'F-FMUIN-35-awl'], ['S-AL-UMM-559'], 'found', 'Musyarakah is a khilaf case (Ibn Kathir 4:12).'),
        ('R-wala', "Wala' (hak waris bekas tuan atas budak yang dimerdekakan).",
         ['H-BUKHARI-6752'], ['H-BULUGH-1109'], 'found', 'Historical; leave out of a lay lesson.'),
        ('R-learn-faraid', "Keutamaan belajar fara'idh.",
         [], ['H-BULUGH-1110', 'S-FIQH-AS-SUNNAH-840', 'S-FIQH-AS-SUNNAH-841'], 'external',
         "The corpus has these reports only via Fiqh as-Sunnah (no grades) and Bulugh 1110 (graded da'if). Needs external takhrij before any use; do not use as lesson motivation."),
        ('R-ext-mui-khi', 'Ketentuan khas Indonesia (KHI/MUI): ahli waris pengganti, wasiat wajibah, harta bersama, dsb.',
         [], ['S-FIQH-AS-SUNNAH-865', 'S-FIQH-AS-SUNNAH-866'], 'external',
         "Not in the corpus. Fiqh as-Sunnah 865-866 describe EGYPTIAN wasiyya wajiba law (no. 71/1946), not Indonesian law. Must be sourced by the MUI/KHI researcher."),
    ]
    idset = {r['id'] for r in records}
    for rid, stmt, strongest, supporting, status, caveat in RULES:
        for x in strongest + supporting:
            assert x in idset, (rid, x)
        add({'id': rid, 'kind': 'rule', 'statement_id': stmt, 'strongest': strongest, 'supporting': supporting,
             'status': status, 'caveat': caveat})
    used = {g for r in records for g in r.get('grounds', [])}
    missing = used - {r[0] for r in RULES}
    assert not missing, missing

    apply_review_2026_10_09(records)
    idset = {r['id'] for r in records}
    for r in records:
        if r['kind'] == 'rule':
            for x in r['strongest'] + r['supporting']:
                assert x in idset, (r['id'], x)
    used = {g for r in records for g in r.get('grounds', [])}
    missing = used - {r['id'] for r in records if r['kind'] == 'rule'}
    assert not missing, missing

    # ------------------------------------------------------------ verification
    ok = 0
    for r in records:
        if r['kind'] == 'quran':
            assert r['ar'] == tanzil[(r['ref']['surah'], r['ref']['ayah'])]
            ok += 1
        elif r['kind'] in ('fiqh', 'tafsir'):
            if r['kind'] == 'fiqh':
                src_ = {"Fath al-Qarib": fqarib, "Fath al-Mu'in": fmuin, 'Fiqh as-Sunnah': fsunnah, 'al-Umm': alumm}
                store = next(v for k, v in src_.items() if r['book'].startswith(k))
                full = store[r['section_id']]['ar']
            else:
                store = ik if r['book'].startswith('Tafsir Ibn') else tb
                full = store[(r['ref']['surah'], r['ref']['ayah'])]['ar']
            a, b = r['char_range']
            assert elide(full, a, b, r.get('omit', []), r.get('source_truncated', False)) == r['ar']
            assert not r.get('source_truncated') or b == len(full)
            ok += 1
        elif r['kind'] == 'hadith':
            ok += 1
    print('records', len(records), 'verified', ok, file=sys.stderr)

    meta = {'id': 'META', 'kind': 'meta', 'generated': GENERATED,
            'generator': RESEARCH_GENERATOR,
            'sources': SOURCES,
            'id_scheme': {'Q-s-a': "Qur'an ayah", 'H-<COLL>-<n>': 'hadith (Muslim by Fuad Abd al-Baqi canonical; Bulugh by LOCAL AhmedBaset number)',
                          'F-...': 'fiqh excerpt (char_range into the section record; omit = running-head spans cut out, shown as an ellipsis)', 'T-IK/TB-...': 'tafsir excerpt (char_range into the ayah record)',
                          'S-...': 'section index pointer (no text)', 'R-...': 'rule -> strongest/supporting record ids'}}
    meta['post_generation_edits'] = REVIEW_2026_10_09_SUMMARY
    meta['excerpt_marks'] = EXCERPT_MARKS
    return [meta] + records


# ---------------------------------------------------------------- excerpt marks (review 2026-10-09)
EXCERPT_MARKS = (
    "2026-10-09 review: a kitab excerpt never shows the printed edition's running head. Where the corpus text "
    "carries one inside an excerpt (a page break: Fath al-Qarib, Fath al-Mu'in), its source offsets are listed "
    "in 'omit', it is cut out, and the cut is shown as an ellipsis; the rest of 'ar' is the source bytes "
    "[char_range] unchanged. 'source_truncated' marks an excerpt that ends where its corpus record itself "
    "breaks off mid-sentence; 'ar' then ends with a space and an ellipsis.")

# Excerpts whose corpus record ends mid-sentence at the end of the span: id -> note.
SOURCE_TRUNCATED = {
    'F-FSUNNAH-854-radd-no-nass': (
        "[review 2026-10-09] The corpus record (Fiqh as-Sunnah section 854, 456 characters) breaks off "
        "mid-sentence inside the first of the scholars' views on radd; the shown text ends with an ellipsis. The rest "
        "of the views is not in the corpus: section 855 resumes later in the discussion, with the Egyptian law's "
        "position."),
}


def omit_note(src: str, omit: list) -> str:
    junk = sum(1 for x, y in omit if src[x:y].rstrip()[-1:].isdigit())
    return (f"[review 2026-10-09] The corpus text carries the printed edition's running head (the book's title line "
            f"at a page break) {len(omit)} time(s) inside this span"
            + (f", {junk} time(s) followed by a run of zero digits" if junk else "")
            + "; it is cut out at the 'omit' offsets and each cut is shown as an ellipsis. No word of the kitab is "
              "removed.")


def excerpt_record(head: dict, src: str, a: int, b: int, tail: dict, notes: list, truncated_note: str | None) -> dict:
    """An excerpt record: `head` fields, char_range, omit (running heads cut out, if any),
    source_truncated (if the corpus record ends mid-sentence at b), the shown ar, then `tail` and notes."""
    omit = running_head_spans(src, a, b)
    truncated = truncated_note is not None
    if truncated and b != len(src):
        raise SystemExit(f"{head['id']}: marked source_truncated but the span ends at {b}, not at the record end {len(src)}")
    rec = dict(head)
    rec['char_range'] = [a, b]
    if omit:
        rec['omit'] = omit
        notes = notes + [omit_note(src, omit)]
    if truncated:
        rec['source_truncated'] = True
        notes = notes + [truncated_note]
    rec['ar'] = elide(src, a, b, omit, truncated)
    rec.update(tail)
    rec['notes'] = notes
    return rec


# ---------------------------------------------------------------- 2026-10-09 review edits
# Made to docs/waris-research/dalil.json after the research build (its META.post_generation_edits
# says so). Each edit asserts the value it replaces, so a change to the tables above fails here
# instead of being silently overwritten. New keys are appended, as the edit did, so the key
# order (and the bytes) match the reviewed file. No Arabic text byte of a record is touched; the
# Arabic inside the reviewer's English notes is the reviewer's quotation, not a dalil field.
REVIEW = "[review 2026-10-09] "
REVIEW_2026_10_09_SUMMARY = (
    "2026-10-09 review: rule statements R-hajb-siblings and R-hajb-grandparents amended; links R-asabah-order/R-wala, "
    "R-wasiyya-third/Q-33-6 changed; notes added to H-MUSLIM-1619e, T-IK-4-7-muhkam (display_label), H-BUKHARI-6734, "
    "H-BULUGH-1108. No Arabic byte was changed. build_dalil.py must carry these edits (its rule table lives in the "
    "scratchpad) or a rebuild will revert them.")


def apply_review_2026_10_09(records: list) -> None:
    by = {r['id']: r for r in records}

    def replace(rid, key, old, new):
        assert by[rid][key] == old, (rid, key, by[rid][key])
        by[rid][key] = new

    def append_new(rid, key, value):
        assert key not in by[rid], (rid, key)
        by[rid][key] = value

    replace('Q-33-6', 'grounds', ['R-kinship-priority', 'R-no-inheritance-by-oath', 'R-wasiyya-third'],
            ['R-kinship-priority', 'R-no-inheritance-by-oath'])
    append_new('Q-33-6', 'notes', [REVIEW + "no longer grounds R-wasiyya-third (it does not state the 1/3 limit)."])
    replace('H-BUKHARI-6734', 'notes', [], [
        REVIEW + "This is Mu'adh ibn Jabal's own ruling in Yemen (an atsar), not a saying of the Prophet ﷺ. In the variant "
        "Bukhari 6741, one chain adds 'على عهد رسول الله ﷺ' but the narrator records that Sulaiman's narration omits it "
        "('ثم قال سليمان قضى فينا. ولم يذكر على عهد رسول الله'). Present as 'putusan Mu'adh (atsar)'. It concerns a sister, "
        "not a brother; for a brother taking the residue cite H-BUKHARI-6732."])
    replace('H-MUSLIM-1619e', 'notes', [], [
        REVIEW + "Scope: says the estate belongs to the heirs and the destitute dependants fall to the Prophet ﷺ; it does "
        "not itself state the order debt-before-wasiat-before-division (that rests on 4:11-12 + reported ijma', "
        "F-ALUMM-572, T-IK-4-11-dayn). Supporting only."])
    replace('H-BULUGH-1108', 'grounds', ['R-asabah-order'], ['R-wala'])
    replace('H-BULUGH-1108', 'notes', [], [
        REVIEW + "re-grounded from R-asabah-order to R-wala (the tahqiq story is a dispute over wala')."])
    replace('T-IK-4-7-muhkam', 'notes', [], [
        REVIEW + "The excerpt begins 'وقوله وإذا حضر القسمة' - it is Ibn Kathir's comment on 4:8, stored under the 4:7 "
        "record. Cite it as 'Ibn Kathir on 4:8'."])
    append_new('T-IK-4-7-muhkam', 'display_label', "Tafsir Ibn Kathir, pada QS 4:8 (teks tersimpan di rekaman 4:7)")
    sup = by['R-wasiyya-third']['supporting']
    replace('R-wasiyya-third', 'supporting', sup, [x for x in sup if x != 'Q-33-6'])
    assert len(by['R-wasiyya-third']['supporting']) == len(sup) - 1
    append_new('R-wasiyya-third', 'notes', [
        REVIEW + "Q-33-6 removed: the ayah (with QuranEnc note [667]) speaks of kindness to non-heir allies by wasiat, "
        "not of the 1/3 limit."])
    cav = by['R-sister-asabah-maal-ghayr']['caveat']
    replace('R-sister-asabah-maal-ghayr', 'caveat', cav, cav + (
        " H-BUKHARI-6734 is Mu'adh's own ruling (atsar); H-BUKHARI-6736 is Ibn Mas'ud reporting the Prophet's ruling - "
        "label them differently."))
    replace('R-hajb-siblings', 'statement_id',
            'Saudara (kandung, seayah, seibu) terhalang oleh anak laki-laki, cucu laki-laki, dan ayah; saudara seibu juga oleh anak perempuan dan kakek.',
            'Saudara (kandung, seayah, seibu) terhalang oleh anak laki-laki, cucu laki-laki dari anak laki-laki, dan ayah; '
            'saudara seibu juga terhalang oleh anak perempuan, cucu (laki-laki maupun perempuan) dari anak laki-laki, dan kakek.')
    append_new('R-hajb-siblings', 'notes', [
        REVIEW + "statement amended: it omitted that a son's daughter also excludes uterine siblings (Fath al-Qarib §117: "
        "'ويسقط ولد الأم مع أربعة الولد ذكرا كان أو أنثى ومع ولد الابن كذلك ومع الأب والجد'); engine.md §6.1 already "
        "applies it."])
    replace('R-hajb-grandparents', 'statement_id',
            'Nenek terhalang oleh ibu; kakek terhalang oleh ayah; cucu oleh anak laki-laki.',
            'Nenek terhalang oleh ibu; nenek dari pihak ayah juga terhalang oleh ayah; kakek terhalang oleh ayah; '
            'cucu terhalang oleh anak laki-laki.')
    append_new('R-hajb-grandparents', 'notes', [
        REVIEW + "statement amended: it omitted that the father excludes the father's mother (Fath al-Mu'in §34: "
        "'وجدة لأب بأب لأنها أدلت به وأم'); engine.md §6.1 already applies it."])
    sup = by['R-asabah-order']['supporting']
    replace('R-asabah-order', 'supporting', sup, [x for x in sup if x != 'H-BULUGH-1108'])
    assert len(by['R-asabah-order']['supporting']) == len(sup) - 1
    append_new('R-asabah-order', 'notes', [
        REVIEW + "H-BULUGH-1108 removed from supporting: its own tahqiq footnote shows the report concerns wala' passing "
        "to 'asabah ('جاء بنو معمر يخاصمونه في ولاء أختهم، إلى عمر'), not the order of 'asabah by kinship. "
        "Re-grounded under R-wala."])
    sup = by['R-wala']['supporting']
    replace('R-wala', 'supporting', sup, sup + ['H-BULUGH-1108'])


def dump(data: list) -> str:
    """The research file's serialisation: one-space indent, UTF-8 as-is, no trailing newline."""
    return json.dumps(data, ensure_ascii=False, indent=1)


def main() -> int:
    sys.stdout.write(dump(build()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
