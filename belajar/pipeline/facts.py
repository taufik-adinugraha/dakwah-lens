"""Encyclopedia ("Tahukah kamu?") facts for Al-Fatihah — plan Appendix B, recomputed.

Every count and every location list is derived here from the pinned Tanzil text and
QAC 0.4; nothing is copied from the plan. Search keys for phrases are built by
normalising the Al-Fatihah tokens themselves (never retyped). Qur'anic Arabic quoted in
a fact body is sliced from Tanzil and wrapped in «…» so validate.py can byte-check it.

compute_facts() returns (facts, comparisons): `comparisons` lines up each recomputed
number with the figure printed in Appendix B so differences can be reported.
"""
from __future__ import annotations

from collections import Counter

from common import NORMALISATION_RULE, Segment, normalise, qac_words, root_letters, stem_of

# Prefix letters allowed on the first token of a phrase search (code points, not text).
WAW, FA, BA, LAM = "و", "ف", "ب", "ل"

# The 28 hijaiyah letters (alif..ya) as code points, for the absent-letter fact.
HIJAIYAH = [chr(c) for c in (0x0627, 0x0628, 0x062A, 0x062B, 0x062C, 0x062D, 0x062E, 0x062F, 0x0630,
                              0x0631, 0x0632, 0x0633, 0x0634, 0x0635, 0x0636, 0x0637, 0x0638, 0x0639,
                              0x063A, 0x0641, 0x0642, 0x0643, 0x0644, 0x0645, 0x0646, 0x0647, 0x0648, 0x064A)]
# Folding of letter variants onto the 28 (alif/hamzah forms -> alif; ta marbutah -> ta; alif maqsurah -> ya).
LETTER_FOLD = {0x0621: 0x0627, 0x0622: 0x0627, 0x0623: 0x0627, 0x0624: 0x0627, 0x0625: 0x0627, 0x0626: 0x0627,
               0x0671: 0x0627, 0x0670: 0x0627, 0x0629: 0x062A, 0x0649: 0x064A}

# Figures as printed in docs/belajar-plan.md Appendix B (for comparison only; never output).
PLAN = {
    "ayat": 7, "words": 29, "words_wo_basmalah": 25, "absent_letters": 7,
    "basmalah_total": 114, "basmalah_headings": 112, "basmalah_in_verse": ["1:1", "27:30"],
    "bismillah_verses": ["1:1", "11:41", "27:30"],
    "rahman_rahim_verses": ["1:1", "1:3", "2:163", "27:30", "41:2", "59:22"],
    "rahman": 57, "rahman_maryam": 16, "rahim": 116, "root_rhm": 339,
    "alhamdulillah_verses": 23, "alhamdulillah_openers": [1, 6, 18, 34, 35],
    "full_phrase_verses": ["1:2", "6:45", "10:10", "37:182", "39:75", "40:65"],
    "rabbil_alamin_verses": 42, "rabb": 975, "allah": 2699,
    "yaumiddin": 13, "yaumiddin_infitar": 3,
    "malik_actpcpl": ["1:4", "3:26", "36:71"],
    "iyyaka_2ms": ["1:5", "1:5"],
    "istaana_verb": ["1:5", "2:45", "2:153", "7:128"], "mustaan": ["12:18", "21:112"], "root_ewn": 11,
    "ihdina": ["1:6", "38:22"],
    "sirat_mustaqim_def": ["1:6", "37:118"], "siratak_mustaqim": ["7:16"],
    "sirat": 45, "maghdub": 1, "root_gdb": 24,
}

TANZIL_URL = "https://tanzil.net/download/"
QAC_URL = "https://corpus.quran.com/"

# The QAC 0.4 header names the Tanzil text it was built on; build_fatihah.py fails if it stops
# saying so, and checks that every surah-1 word of QAC equals the Tanzil 1.1 token byte for byte.
QAC_TANZIL_HEADER = "Tanzil Quran Text (Uthmani, version 1.0.2)"
QAC_BASIS = ("QAC 0.4 (disusun di atas teks Tanzil Uthmani 1.0.2; surah 1 identik byte-per-byte "
             "dengan 1.1 yang dipakai)")

DARWISY = "Muhyiddin Darwisy, I'rab al-Qur'an wa Bayanuh (cet. 4, 1415 H)"


def fmt(n: int) -> str:
    return f"{n:,}".replace(",", ".")


def refs_text(refs: list[str]) -> str:
    if len(refs) == 1:
        return refs[0]
    return ", ".join(refs[:-1]) + " dan " + refs[-1]


def uniq_refs(pairs) -> list[str]:
    return [f"{s}:{a}" for s, a in sorted(set(pairs))]


def kali(n: int, refs: list[str], quran: bool = False) -> str:
    """'N kali', or 'N kali dalam M ayat' when some listed ayat hold the word more than once
    (M = the fact's location list). quran=True appends "dalam Al-Qur'an" / "Al-Qur'an"."""
    if n == len(refs):
        return f"{fmt(n)} kali" + (" dalam Al-Qur'an" if quran else "")
    return f"{fmt(n)} kali dalam {fmt(len(refs))} ayat" + (" Al-Qur'an" if quran else "")


PREFIX_NAME = {"\u0648": "wa-", "\u0641": "fa-", "\u0628": "bi-", "\u0644": "li-"}


def prefix_phrase(hits) -> str:
    """'dengan atau tanpa awalan wa-' built from the prefixes actually found."""
    found = [PREFIX_NAME[p] for p in sorted({h[4] for h in hits if h[4]})]
    if not found:
        return "tanpa awalan"
    return "dengan atau tanpa awalan " + refs_text(found).replace(" dan ", " atau ")


class Corpus:
    """Tanzil verses with the surah-heading basmalah removed, plus QAC indices."""

    def __init__(self, tanzil, segs: list[Segment], tanzil_sha: str, qac_sha: str):
        self.T = tanzil
        self.tanzil_sha = tanzil_sha
        self.qac_sha = qac_sha
        self.bas_tokens = tanzil.verses[(1, 1)].split(" ")
        bas_norm = [normalise(t) for t in self.bas_tokens]
        self.headings: list[int] = []
        self.heading_byte_variants: dict[int, str] = {}
        self.verses: list[tuple[int, int, list[str], list[str]]] = []
        for (s, a), text in sorted(tanzil.verses.items()):
            toks = text.split(" ")
            norm = [normalise(t) for t in toks]
            if a == 1 and s != 1 and norm[:4] == bas_norm:
                self.headings.append(s)
                if toks[:4] != self.bas_tokens:
                    self.heading_byte_variants[s] = " ".join(toks[:4])
                toks, norm = toks[4:], norm[4:]
            self.verses.append((s, a, toks, norm))
        self.segs = segs
        self.words = qac_words(segs)
        self.stems = [g for g in segs if "STEM" in g.flags]

    # ---- Tanzil helpers
    def tok(self, s: int, a: int, w: int) -> str:
        return self.T.verses[(s, a)].split(" ")[w - 1]

    def ntok(self, s: int, a: int, w: int) -> str:
        return normalise(self.tok(s, a, w))

    def find_seq(self, keys: list[str], prefixes=("",)):
        """Occurrences of consecutive normalised tokens; only the first may carry a prefix.
        Returns (surah, ayah, index, exact_bytes, prefix)."""
        hits = []
        n = len(keys)
        for s, a, toks, norm in self.verses:
            for i in range(len(norm) - n + 1):
                pre = next((p for p in prefixes if norm[i] == p + keys[0]), None)
                if pre is None:
                    continue
                if all(norm[i + j] == keys[j] for j in range(1, n)):
                    hits.append((s, a, i, " ".join(toks[i:i + n]), pre))
        return hits

    def tanzil_src(self, query: str) -> dict:
        return {"kitab": "Tanzil Quran Text (Uthmani) 1.1",
                "ref": f"sha256:{self.tanzil_sha[:16]}; {query}", "url": TANZIL_URL}

    def qac_src(self, query: str) -> dict:
        return {"kitab": "Quranic Arabic Corpus 0.4 (morfologi)",
                "ref": f"sha256:{self.qac_sha[:16]}; {query}", "url": QAC_URL}

    # ---- QAC helpers
    def stem(self, s: int, a: int, w: int) -> Segment:
        return stem_of(self.words[(s, a, w)])

    def lemma_hits(self, lem: str, pos: tuple[str, ...] | None = None) -> list[Segment]:
        return [g for g in self.stems if g.feat.get("LEM") == lem and (pos is None or g.feat.get("POS") in pos)]

    def root_hits(self, root: str) -> list[Segment]:
        return [g for g in self.stems if g.feat.get("ROOT") == root]


def fact(fid, title, body, locations, method, sources):
    return {"id": fid, "title": title, "body": body, "locations": locations, "method": method,
            "sources": sources, "status": "draft"}


def compute_facts(C: Corpus) -> tuple[list[dict], list[dict]]:
    F: list[dict] = []
    cmp: list[dict] = []

    def compare(fid, what, ours, plan):
        cmp.append({"fact": fid, "what": what, "computed": ours, "plan": plan, "match": ours == plan})

    fat = {a: C.T.verses[(1, a)].split(" ") for a in range(1, 8)}
    fat_refs = [f"1:{a}" for a in range(1, 8)]
    q = lambda toks: "«" + " ".join(toks) + "»"  # noqa: E731 — quote exact Tanzil bytes

    # 1. seven ayat
    n_ayat = len(fat)
    compare("tujuh-ayat", "ayat", n_ayat, PLAN["ayat"])
    F.append(fact(
        "tujuh-ayat", "Tujuh ayat menurut semua hitungan",
        f"Al-Fatihah terdiri atas {n_ayat} ayat. Ibnu Katsir menyebut jumlah ini tanpa perselisihan; yang berbeda "
        f"hanya letak batas ayatnya. Menurut ad-Dani, hitungan Kufah dan Makkah menjadikan basmalah ayat pertama, "
        f"sedangkan hitungan lain menjadikan {q(fat[7][2:4])} sebagai akhir ayat. Modul ini memakai hitungan Kufah "
        f"(riwayat Hafs), dengan basmalah sebagai 1:1.",
        fat_refs,
        f"Jumlah baris surah 1 dalam Tanzil Uthmani 1.1 = {n_ayat}. Keterangan tentang batas ayat dikutip dari "
        f"ad-Dani dan Ibnu Katsir, bukan hasil hitungan data.",
        [C.tanzil_src("baris 1|1 sampai 1|7"),
         {"kitab": "Abu 'Amr ad-Dani, al-Bayan fi 'Add Ay al-Qur'an", "ref": "Surat al-Hamd, hlm. 139",
          "url": "https://shamela.ws/book/5542/121"},
         {"kitab": "Ibnu Katsir, Tafsir al-Qur'an al-'Azhim", "ref": "pendahuluan tafsir QS 1:1",
          "url": "https://tafsir.app/ibn-katheer/1/1"}]))

    # 2. word count
    per = [len(fat[a]) for a in range(1, 8)]
    total, wo = sum(per), sum(per) - per[0]
    qac_n = len([k for k in C.words if k[0] == 1])
    compare("jumlah-kata", "words", total, PLAN["words"])
    compare("jumlah-kata", "words without basmalah", wo, PLAN["words_wo_basmalah"])
    compare("jumlah-kata", "QAC words in chapter 1", qac_n, PLAN["words"])
    F.append(fact(
        "jumlah-kata", f"{total} kata, atau {wo} tanpa basmalah",
        f"Teks Al-Fatihah terdiri atas {total} kata ({' + '.join(map(str, per))}). Tanpa basmalah jumlahnya "
        f"{wo} kata, sama dengan angka yang dinukil Ibnu Katsir.",
        fat_refs,
        f"Kata = token yang dipisah spasi dalam teks Tanzil Uthmani 1.1, ayat 1:1–1:7. Penomoran kata {QAC_BASIS} "
        f"untuk surah 1 juga berisi {qac_n} kata dan cocok satu per satu.",
        [C.tanzil_src("token dipisah spasi, 1:1–1:7"), C.qac_src("jumlah lokasi (1:a:w) unik untuk surah 1"),
         {"kitab": "Ibnu Katsir, Tafsir al-Qur'an al-'Azhim", "ref": "pendahuluan tafsir QS 1:1 ('kalimatnya 25')",
          "url": "https://tafsir.app/ibn-katheer/1/1"}]))

    # 3. absent letters
    present = set()
    for a in range(1, 8):
        for ch in C.T.verses[(1, a)]:
            cp = LETTER_FOLD.get(ord(ch), ord(ch))
            present.add(chr(cp))
    absent = [L for L in HIJAIYAH if L not in present]
    compare("huruf-tidak-muncul", "absent letters", len(absent), PLAN["absent_letters"])
    F.append(fact(
        "huruf-tidak-muncul", f"{len(absent)} huruf yang tidak muncul",
        f"Dari 28 huruf hijaiyah, ada {len(absent)} huruf yang tidak muncul sama sekali dalam teks Al-Fatihah: "
        f"{' '.join(absent)}.",
        fat_refs,
        "Himpunan huruf dasar dalam teks Tanzil 1:1–1:7 dibandingkan dengan 28 huruf hijaiyah. Harakat dan tanda "
        "diabaikan; semua bentuk alif dan hamzah dihitung sebagai alif, ta marbuthah sebagai ta, alif maqshurah "
        "sebagai ya. Hanya faktanya yang dimuat, tanpa tafsiran populer tentang huruf-huruf ini.",
        [C.tanzil_src("karakter 1:1–1:7"),
         {"kitab": "as-Suyuthi, al-Itqan fi 'Ulum al-Qur'an", "ref": "jil. 1, hlm. 189 (menyebut tujuh huruf ini)",
          "url": "https://shamela.ws/book/11728/182"}]))

    # 4. basmalah x114
    bas_keys = [normalise(t) for t in C.bas_tokens]
    in_verse = C.find_seq(bas_keys)
    in_refs = uniq_refs((s, a) for s, a, *_ in in_verse)
    H = len(C.headings)
    no_heading = [s for s in range(1, 115) if s not in C.headings]
    total_bas = H + len(in_verse)
    compare("basmalah-114", "headings", H, PLAN["basmalah_headings"])
    compare("basmalah-114", "in-verse refs", in_refs, PLAN["basmalah_in_verse"])
    compare("basmalah-114", "total", total_bas, PLAN["basmalah_total"])
    variants = sorted(C.heading_byte_variants)
    F.append(fact(
        "basmalah-114", f"Basmalah tertulis {total_bas} kali",
        f"Dalam mushaf, basmalah tertulis {total_bas} kali: sebagai pembuka {H} surah (semua surah selain "
        f"Al-Fatihah dan At-Taubah), sebagai ayat pertama Al-Fatihah (1:1), dan di dalam ayat 27:30, pada surat "
        f"Nabi Sulaiman yang dibacakan Ratu negeri Saba'. Surah At-Taubah dibuka tanpa basmalah.",
        in_refs,
        f"Tanzil menaruh basmalah di awal ayat 1 pada {H} surah (semua kecuali surah {refs_text([str(s) for s in no_heading])}); "
        f"itu dihitung sebagai pembuka surah, bukan bagian ayat, lalu dibuang dari teks ayat. Setelah itu empat kata "
        f"basmalah dicari berurutan di teks ayat: {len(in_verse)} tempat ({refs_text(in_refs)}). {H} + {len(in_verse)} = "
        f"{total_bas}. Pada pembuka surah {refs_text([str(s) for s in variants])} Tanzil menulis ba' bertasydid; "
        f"pencocokan tanpa harakat tetap mengenalinya. Pencocokan memakai {NORMALISATION_RULE}.",
        [C.tanzil_src("awal ayat 1 setiap surah; empat token basmalah (dari 1:1) berurutan")]))

    # 5. bismillah in verse text
    bism = C.find_seq(bas_keys[:2], prefixes=("", WAW, FA))
    bism_refs = uniq_refs((s, a) for s, a, *_ in bism)
    compare("bismillah-dalam-ayat", "verses", bism_refs, PLAN["bismillah_verses"])
    ctx = {"11:41": "kisah bahtera Nabi Nuh", "27:30": "surat Nabi Sulaiman"}
    parts = [f"{r} ({ctx[r]})" if r in ctx else r for r in bism_refs]
    F.append(fact(
        "bismillah-dalam-ayat", f"Bismillāh di {len(bism_refs)} ayat",
        f"Ungkapan {q(C.bas_tokens[:2])} muncul di {len(bism_refs)} tempat dalam teks ayat: {refs_text(parts)}.",
        bism_refs,
        "Dua token berurutan bismi + lafaz Allah (diambil dari 1:1), token pertama boleh berawalan wa- atau fa-, "
        f"di teks Tanzil setelah basmalah pembuka surah dibuang. {NORMALISATION_RULE[0].upper()}{NORMALISATION_RULE[1:]}.",
        [C.tanzil_src("token 1:1:1 + 1:1:2 berurutan")]))

    # 6. ar-rahman ar-rahim side by side
    rr = C.find_seq([C.ntok(1, 1, 3), C.ntok(1, 1, 4)])
    rr_refs = uniq_refs((s, a) for s, a, *_ in rr)
    compare("rahman-rahim-berdampingan", "verses", rr_refs, PLAN["rahman_rahim_verses"])
    F.append(fact(
        "rahman-rahim-berdampingan", "Ar-raḥmān ar-raḥīm berdampingan",
        f"Pasangan {q(C.bas_tokens[2:4])} (dengan harakat akhir apa pun) muncul berdampingan di "
        f"{len(rr_refs)} ayat: {refs_text(rr_refs)}.",
        rr_refs,
        "Dua token berurutan ar-raḥmān + ar-raḥīm (diambil dari 1:1) di teks Tanzil setelah basmalah pembuka surah "
        "dibuang; harakat diabaikan sehingga akhiran -u/-a/-i ikut terhitung.",
        [C.tanzil_src("token 1:1:3 + 1:1:4 berurutan")]))

    # 7a/7b/7c rahman, rahim, root
    lem_rahman = C.stem(1, 1, 3).feat["LEM"]
    lem_rahim = C.stem(1, 1, 4).feat["LEM"]
    root_rhm = C.stem(1, 1, 3).feat["ROOT"]
    h_rahman = C.lemma_hits(lem_rahman)
    h_rahim = C.lemma_hits(lem_rahim)
    h_rhm = C.root_hits(root_rhm)
    n_maryam = sum(1 for g in h_rahman if g.s == 19)
    compare("ar-rahman", "count", len(h_rahman), PLAN["rahman"])
    compare("ar-rahman", "in Maryam", n_maryam, PLAN["rahman_maryam"])
    compare("ar-rahim", "count", len(h_rahim), PLAN["rahim"])
    compare("akar-rhm", "count", len(h_rhm), PLAN["root_rhm"])
    rahman_refs = uniq_refs((g.s, g.a) for g in h_rahman)
    F.append(fact(
        "ar-rahman", f"Ar-raḥmān: {len(h_rahman)} kali",
        f"Kata raḥmān muncul {kali(len(h_rahman), rahman_refs, True)}, tidak termasuk basmalah pembuka "
        f"surah. {n_maryam} di antaranya ada di Surah Maryam.",
        rahman_refs,
        f"{QAC_BASIS}: jumlah segmen STEM dengan LEM:{lem_rahman} (lemma kata 1:1:3); ayat dihitung sekali walau "
        f"memuat kata ini lebih dari sekali. QAC tidak memuat basmalah pembuka surah, tetapi memuat 1:1 dan 27:30.",
        [C.qac_src(f"LEM:{lem_rahman}")]))
    rahim_refs = uniq_refs((g.s, g.a) for g in h_rahim)
    F.append(fact(
        "ar-rahim", f"Ar-raḥīm: {len(h_rahim)} kali",
        f"Kata raḥīm muncul {kali(len(h_rahim), rahim_refs, True)}, tidak termasuk basmalah pembuka surah.",
        rahim_refs,
        f"{QAC_BASIS}: jumlah segmen STEM dengan LEM:{lem_rahim} (lemma kata 1:1:4).",
        [C.qac_src(f"LEM:{lem_rahim}")]))
    rl = " ".join(root_letters(root_rhm))
    n_lem_rhm = len({g.feat["LEM"] for g in h_rhm})
    rhm_refs = uniq_refs((g.s, g.a) for g in h_rhm)
    F.append(fact(
        "akar-rhm", f"Keluarga kata {rl}: {len(h_rhm)} kali",
        f"Kata-kata dari akar {rl}, misalnya raḥmah, raḥmān, dan raḥīm, muncul {kali(len(h_rhm), rhm_refs, True)} "
        f"({n_lem_rhm} lemma). Ini hitungan satu keluarga kata, bukan satu kata; tidak semuanya "
        f"berarti 'kasih sayang' secara langsung (mis. arḥām: rahim/kerabat).",
        rhm_refs,
        f"{QAC_BASIS}: jumlah segmen STEM dengan ROOT:{root_rhm} (akar kata 1:1:3); ayat dihitung sekali walau "
        f"memuat lebih dari satu kata seakar.",
        [C.qac_src(f"ROOT:{root_rhm}")]))

    # 8. (wa/fa) al-hamdu lillah
    hl = C.find_seq([C.ntok(1, 2, 1), C.ntok(1, 2, 2)], prefixes=("", WAW, FA))
    hl_refs = uniq_refs((s, a) for s, a, *_ in hl)
    openers = []
    for s, a, toks, norm in C.verses:
        first_ayah = 2 if s == 1 else 1
        if a == first_ayah and norm[:2] == [C.ntok(1, 2, 1), C.ntok(1, 2, 2)]:
            openers.append((s, a))
    compare("alhamdulillah", "verses", len(hl_refs), PLAN["alhamdulillah_verses"])
    compare("alhamdulillah", "surah openers", [s for s, _ in openers], PLAN["alhamdulillah_openers"])
    names = {1: "Al-Fatihah", 6: "Al-An'am", 18: "Al-Kahf", 34: "Saba'", 35: "Fathir"}
    op_txt = refs_text([f"{names.get(s, 'surah ' + str(s))} ({s}:{a})" for s, a in openers])
    F.append(fact(
        "alhamdulillah", f"Alḥamdulillāh di {len(hl_refs)} ayat",
        f"{q(fat[2][:2])}, {prefix_phrase(hl)}, muncul di {len(hl_refs)} ayat. "
        f"{len(openers)} surah dibuka dengannya: {op_txt}.",
        hl_refs,
        "Dua token berurutan al-ḥamdu + lillāhi (diambil dari 1:2); token pertama boleh berawalan wa- atau fa-; "
        "dihitung per ayat. 'Dibuka' = ayat pertama setelah basmalah (untuk Al-Fatihah: 1:2).",
        [C.tanzil_src("token 1:2:1 + 1:2:2 berurutan")]))

    # 9. full phrase of 1:2
    fp = C.find_seq([normalise(t) for t in fat[2]], prefixes=("", WAW, FA))
    fp_refs = uniq_refs((s, a) for s, a, *_ in fp)
    compare("ayat-2-utuh", "verses", fp_refs, PLAN["full_phrase_verses"])
    F.append(fact(
        "ayat-2-utuh", f"Kalimat ayat 2 utuh di {len(fp_refs)} ayat",
        f"Kalimat {q(fat[2])}, {prefix_phrase(fp)}, muncul di {len(fp_refs)} ayat: {refs_text(fp_refs)}.",
        fp_refs,
        "Empat token ayat 1:2 berurutan; token pertama boleh berawalan wa- atau fa-; harakat diabaikan.",
        [C.tanzil_src("token 1:2:1–1:2:4 berurutan")]))

    # 10a. rabbi al-alamin
    ra = C.find_seq([C.ntok(1, 2, 3), C.ntok(1, 2, 4)], prefixes=("", WAW, FA, BA, LAM))
    ra_refs = uniq_refs((s, a) for s, a, *_ in ra)
    ra_plain = uniq_refs((s, a) for s, a, i, b, p in ra if p == "")
    compare("rabbil-alamin", "verses (any prefix)", len(ra_refs), PLAN["rabbil_alamin_verses"])
    F.append(fact(
        "rabbil-alamin", f"Rabbil-‘ālamīn di {len(ra_refs)} ayat",
        f"Ungkapan {q(fat[2][2:4])}, dengan harakat akhir apa pun dan {prefix_phrase(ra)}, muncul di "
        f"{len(ra_refs)} ayat ({len(ra)} kali).",
        ra_refs,
        f"Dua token berurutan rabb + al-‘ālamīn (diambil dari 1:2); token pertama boleh berawalan wa-, fa-, bi-, "
        f"atau li-. Tanpa awalan sama sekali: {len(ra_plain)} ayat.",
        [C.tanzil_src("token 1:2:3 + 1:2:4 berurutan")]))

    # 10b. rabb lemma rank
    lem_rabb = C.stem(1, 2, 3).feat["LEM"]
    lem_allah = C.stem(1, 1, 2).feat["LEM"]
    nominal = Counter(g.feat["LEM"] for g in C.stems if g.feat.get("POS") in ("N", "PN") and "LEM" in g.feat)
    ranking = [lem for lem, _ in nominal.most_common()]
    rank_rabb = ranking.index(lem_rabb) + 1
    h_rabb = C.lemma_hits(lem_rabb)
    compare("rabb", "count", len(h_rabb), PLAN["rabb"])
    compare("rabb", "allah count", nominal[lem_allah], PLAN["allah"])
    compare("rabb", "rank among N/PN lemmas", rank_rabb, 2)
    above = ranking[:rank_rabb - 1]
    rabb_refs = uniq_refs((g.s, g.a) for g in h_rabb)
    F.append(fact(
        "rabb", "Rabb: kata benda tersering setelah lafaz Allah",
        f"Kata rabb (Tuhan, Pemelihara) muncul {kali(len(h_rabb), rabb_refs, True)}. Di antara lemma "
        f"kata benda, {'hanya lafaz Allah' if above == [lem_allah] else 'beberapa lemma'} "
        f"({fmt(nominal[lem_allah])} kali) yang lebih sering.",
        rabb_refs,
        f"{QAC_BASIS}: lemma segmen STEM ber-POS N atau PN diurutkan menurut jumlah segmen; LEM:{lem_rabb} "
        f"(lemma 1:2:3) berada di peringkat {rank_rabb}, di bawah LEM:{lem_allah}. Ayat dihitung sekali walau "
        f"memuat kata ini lebih dari sekali.",
        [C.qac_src(f"LEM:{lem_rabb}; peringkat lemma POS N/PN")]))

    # 11. yaumi ad-din
    yd = C.find_seq([C.ntok(1, 4, 2), C.ntok(1, 4, 3)], prefixes=("", WAW, FA, BA, LAM))
    yd_refs = uniq_refs((s, a) for s, a, *_ in yd)
    inf = [f"{s}:{a}" for s, a, *_ in yd if s == 82]
    yd_exact_bytes = " ".join(fat[4][1:3])
    yd_exact = uniq_refs((s, a) for s, a, i, b, p in yd if b == yd_exact_bytes)
    yd_prefixed = [(s, a, b) for s, a, i, b, p in yd if p]
    # final vowel of the yaum token in each hit (harakat code points, not text)
    vowel_name = {"\u064F": "yaumu", "\u064E": "yauma", "\u0650": "yaumi"}
    yd_seen = {b.split(" ")[0][-1] for s, a, i, b, p in yd}
    yd_vowels = [name for v, name in vowel_name.items() if v in yd_seen]
    compare("yaumid-din", "occurrences", len(yd), PLAN["yaumiddin"])
    compare("yaumid-din", "in al-Infitar", len(inf), PLAN["yaumiddin_infitar"])
    compare("yaumid-din", "exact 1:4 spelling, no prefix", yd_exact, ["1:4", "15:35", "38:78"])
    eg = f", misalnya {q([yd_prefixed[0][2]])} ({yd_prefixed[0][0]}:{yd_prefixed[0][1]})" if yd_prefixed else ""
    F.append(fact(
        "yaumid-din", f"Yaumid-dīn: {len(yd)} kali",
        f"Ungkapan {q(fat[4][1:3])} (hari pembalasan) muncul {kali(len(yd), yd_refs)}, {len(inf)} di antaranya di "
        f"Surah Al-Infithar ({refs_text(inf)}). Hitungan ini memasukkan harakat akhir apa pun "
        f"({', '.join(yd_vowels)}) dan bentuk berawalan{eg}; tulisan yang persis sama dengan 1:4 hanya ada di "
        f"{refs_text(yd_exact)}.",
        yd_refs,
        "Dua token berurutan yaum + ad-dīn (diambil dari 1:4); token pertama boleh berawalan wa-, fa-, bi-, atau "
        f"li-; harakat diabaikan, jadi yaumu, yauma, yaumi dan bentuk berawalan ikut terhitung. Tulisan persis 1:4 "
        f"(byte sama, tanpa awalan): {refs_text(yd_exact)}.",
        [C.tanzil_src("token 1:4:2 + 1:4:3 berurutan")]))

    # 12. the lemma malik (active participle) — 3 forms; the proper name Malik (43:77) is another lemma
    st = C.stem(1, 4, 1)
    lem_malik, root_mlk = st.feat["LEM"], st.feat["ROOT"]
    h_malik = C.lemma_hits(lem_malik, pos=("N",))
    h_other = C.lemma_hits(lem_malik, pos=None)
    if len(h_other) != len(h_malik):
        raise ValueError(f"LEM:{lem_malik} has non-N segments; revisit the maliki fact")
    pn_like = [g for g in C.stems if g.feat.get("POS") == "PN" and g.feat.get("ROOT") == root_mlk
               and g.feat.get("LEM", "").startswith(lem_malik) and g.feat.get("LEM") != lem_malik]
    malik_refs = uniq_refs((g.s, g.a) for g in h_malik)
    compare("maliki", "N occurrences", [f"{g.s}:{g.a}" for g in h_malik], PLAN["malik_actpcpl"])
    ending = {("M", "NOM"): "u", ("M", "ACC"): "a", ("M", "GEN"): "i",
              ("MP", "NOM"): "ūna", ("MP", "ACC"): "īna", ("MP", "GEN"): "īna"}

    def malik_form(g: Segment) -> str:  # SKB transliteration from the QAC number + case tags
        num = next(f for f in g.flags if f in ("M", "MP"))
        case = next(f for f in g.flags if f in ("NOM", "ACC", "GEN"))
        return "mālik" + ending[(num, case)]

    if not all({"ACT", "PCPL"} <= set(g.flags) for g in h_malik):
        raise ValueError("an occurrence of LEM malik is not tagged ACT PCPL")
    forms = [f"{malik_form(g)} ({g.s}:{g.a})" for g in h_malik]
    pn_txt = ""
    if pn_like:
        pn_refs = uniq_refs((g.s, g.a) for g in pn_like)
        pn_lems = sorted({g.feat["LEM"] for g in pn_like})
        pn_txt = (f" Mālik di {refs_text(pn_refs)} adalah nama diri dengan lemma lain "
                  f"({', '.join('LEM:' + x for x in pn_lems)}, POS:PN), jadi tidak ikut dihitung.")
    F.append(fact(
        "maliki", f"Mālik sebagai isim fa'il: {len(h_malik)} kali",
        f"Kata mālik (isim fa'il, lemma yang sama dengan 1:4) muncul {kali(len(h_malik), malik_refs)}: "
        f"{', '.join(forms)}.",
        malik_refs,
        f"{QAC_BASIS}: segmen STEM dengan LEM:{lem_malik} (lemma 1:4:1), hanya POS N; ketiganya bertanda ACT PCPL "
        f"(isim fa'il).{pn_txt} Hitungan ini mengikuti teks Hafs (Tanzil); bacaan maliki tanpa alif adalah "
        f"qira'at lain.",
        [C.qac_src(f"LEM:{lem_malik} POS:N" + (f"; {', '.join('LEM:' + x for x in pn_lems)} POS:PN tidak dihitung"
                                                  if pn_like else ""))]))

    # 13. iyyaka (2MS) only in 1:5
    st = C.stem(1, 5, 1)
    lem_iyya = st.feat["LEM"]
    pers = next(f for f in st.flags if f[:1] in "123")  # person/gender/number, e.g. 2MS
    h_iyya = C.lemma_hits(lem_iyya)
    h_2ms = [g for g in h_iyya if pers in g.flags]
    iy_refs = [f"{g.s}:{g.a}" for g in h_2ms]
    tz_iyyaka = C.find_seq([C.ntok(1, 5, 1)], prefixes=("", WAW, FA))
    compare("iyyaka", f"{pers} occurrences (QAC)", iy_refs, PLAN["iyyaka_2ms"])
    compare("iyyaka", "token occurrences (Tanzil)", [f"{s}:{a}" for s, a, *_ in tz_iyyaka], PLAN["iyyaka_2ms"])
    F.append(fact(
        "iyyaka", "Iyyāka hanya di Al-Fatihah",
        f"Bentuk {q([fat[5][0]])} (kata ganti orang kedua tunggal; dalam tata bahasa Arab berbentuk mudzakkar) "
        f"hanya muncul di {refs_text(sorted(set(iy_refs)))}, dan di sana {len(h_2ms)} kali. Kata ganti yang sama "
        f"dengan akhiran lain (untuk 'aku', 'dia', 'kalian', dan seterusnya) muncul {len(h_iyya) - len(h_2ms)} kali "
        f"di tempat lain, sehingga seluruhnya {kali(len(h_iyya), uniq_refs((g.s, g.a) for g in h_iyya))}.",
        uniq_refs((g.s, g.a) for g in h_iyya),
        f"{QAC_BASIS}: semua segmen STEM dengan LEM:{lem_iyya} ({len(h_iyya)} kali); yang bertanda {pers} hanya di "
        f"{refs_text(sorted(set(iy_refs)))}. Dicek ulang di Tanzil: token iyyāka (boleh berawalan wa-/fa-) muncul "
        f"{len(tz_iyyaka)} kali.",
        [C.qac_src(f"LEM:{lem_iyya}, fitur {pers}"), C.tanzil_src("token 1:5:1, awalan wa-/fa-")]))

    # 14. ista'ana
    root_ewn = C.stem(1, 5, 4).feat["ROOT"]
    h_ewn = C.root_hits(root_ewn)
    verb_x = [g for g in h_ewn if g.feat.get("POS") == "V" and "(X)" in g.flags]
    noun_x = [g for g in h_ewn if g.feat.get("POS") == "N" and "(X)" in g.flags]
    v_refs = uniq_refs((g.s, g.a) for g in verb_x)
    n_refs = uniq_refs((g.s, g.a) for g in noun_x)
    compare("istaana", "verb form X verses", v_refs, PLAN["istaana_verb"])
    compare("istaana", "form X noun verses", n_refs, PLAN["mustaan"])
    compare("istaana", "root count", len(h_ewn), PLAN["root_ewn"])
    rl = " ".join(root_letters(root_ewn))
    ewn_refs = uniq_refs((g.s, g.a) for g in h_ewn)
    F.append(fact(
        "istaana", "Ista‘āna: memohon pertolongan",
        f"Kata kerja ista‘āna (memohon pertolongan, wazan istaf‘ala) hanya muncul di {refs_text(v_refs)}. "
        f"Bentuk al-musta‘ān (Yang dimohon pertolongan-Nya) ada di {refs_text(n_refs)}. Seluruh keluarga akar "
        f"{rl} muncul {kali(len(h_ewn), ewn_refs)} ({len({g.feat['LEM'] for g in h_ewn})} lemma); hitungan akar "
        f"ini menggabungkan semua kata seakar, termasuk yang maknanya berjauhan.",
        ewn_refs,
        f"{QAC_BASIS}: segmen STEM dengan ROOT:{root_ewn} (akar 1:5:4): POS V bertanda (X) = kata kerja wazan "
        f"istaf‘ala; POS N bertanda (X) = al-musta‘ān; jumlah semua segmen akar = {len(h_ewn)}, dalam "
        f"{len(ewn_refs)} ayat.",
        [C.qac_src(f"ROOT:{root_ewn}, bentuk (X)")]))

    # 15. ihdina
    ih = C.find_seq([C.ntok(1, 6, 1)], prefixes=("", WAW, FA))
    ih_refs = [f"{s}:{a}" for s, a, *_ in ih]
    compare("ihdina", "occurrences", ih_refs, PLAN["ihdina"])
    parts = [f"{s}:{a}" + (" (dengan awalan wa-)" if p == WAW else " (dengan awalan fa-)" if p == FA else "")
             for s, a, i, b, p in ih]
    F.append(fact(
        "ihdina", f"Ihdinā hanya {len(ih)} kali",
        f"Kata {q([fat[6][0]])} (tunjukilah kami) hanya muncul {len(ih)} kali dalam Al-Qur'an: {refs_text(parts)}.",
        uniq_refs((s, a) for s, a, *_ in ih),
        "Token ihdinā (diambil dari 1:6), boleh berawalan wa- atau fa-; harakat diabaikan.",
        [C.tanzil_src("token 1:6:1, awalan wa-/fa-")]))

    # 16. as-sirat al-mustaqim (definite) + 7:16
    key_def = [C.ntok(1, 6, 2), C.ntok(1, 6, 3)]
    sd = C.find_seq(key_def, prefixes=("", WAW, BA, LAM))
    sd_refs = uniq_refs((s, a) for s, a, *_ in sd)
    sirat_bare = C.ntok(1, 7, 1)
    suffixed = []
    for s, a, toks, norm in C.verses:
        for i in range(len(norm) - 1):
            if norm[i].startswith(sirat_bare) and norm[i] != sirat_bare and norm[i + 1] == key_def[1]:
                suffixed.append((s, a, " ".join(toks[i:i + 2])))
    compare("ash-shirathal-mustaqim", "definite verses", sd_refs, PLAN["sirat_mustaqim_def"])
    compare("ash-shirathal-mustaqim", "suffixed sirat + al-mustaqim", [f"{s}:{a}" for s, a, _ in suffixed],
            PLAN["siratak_mustaqim"])
    extra = ""
    if len(suffixed) == 1 and (suffixed[0][0], suffixed[0][1]) == (7, 16):
        extra = f" Di 7:16, Iblis menyebut «{suffixed[0][2]}» (jalan-Mu yang lurus)."
    F.append(fact(
        "ash-shirathal-mustaqim", "Aṣ-ṣirāṭal-mustaqīm yang ber-al",
        f"Bentuk ber-al {q(fat[6][1:3])} hanya ada di {refs_text(sd_refs)}.{extra}",
        uniq_refs([(s, a) for s, a, *_ in sd] + [(s, a) for s, a, _ in suffixed]),
        "Dua token berurutan aṣ-ṣirāṭ + al-mustaqīm (diambil dari 1:6), token pertama boleh berawalan; lalu dicari "
        "token ṣirāṭ yang berakhiran kata ganti dan diikuti al-mustaqīm. Harakat diabaikan.",
        [C.tanzil_src("token 1:6:2 + 1:6:3 berurutan; token berawal 1:7:1 + 1:6:3")]))

    # 17. sirat 45x, singular only
    st = C.stem(1, 6, 2)
    lem_sirat, root_srt = st.feat["LEM"], st.feat["ROOT"]
    h_sirat = C.lemma_hits(lem_sirat)
    h_srt = C.root_hits(root_srt)
    non_sing = [g for g in h_sirat if set(g.flags) & {"MP", "FP", "MD", "FD", "P", "D"}]
    tz_sirat = sum(1 for s, a, toks, norm in C.verses for t in norm if sirat_bare in t)
    compare("shirath", "lemma count", len(h_sirat), PLAN["sirat"])
    compare("shirath", "root count", len(h_srt), PLAN["sirat"])
    compare("shirath", "Tanzil tokens containing the stem", tz_sirat, PLAN["sirat"])
    compare("shirath", "dual/plural tagged", len(non_sing), 0)
    F.append(fact(
        "shirath", f"Ṣirāṭ: {len(h_sirat)} kali, selalu tunggal",
        f"Kata ṣirāṭ (jalan) muncul {len(h_sirat)} kali dalam Al-Qur'an dan selalu dalam bentuk tunggal; "
        f"bentuk jamaknya tidak pernah dipakai.",
        uniq_refs((g.s, g.a) for g in h_sirat),
        f"{QAC_BASIS}: LEM:{lem_sirat} (lemma 1:6:2) = {len(h_sirat)} segmen, tidak satu pun bertanda dual atau jamak; "
        f"akar ROOT:{root_srt} juga {len(h_srt)} segmen, jadi tidak ada kata lain dari akar ini. Dicek di Tanzil: "
        f"{tz_sirat} token memuat kata ini.",
        [C.qac_src(f"LEM:{lem_sirat}; ROOT:{root_srt}"), C.tanzil_src("token yang memuat 1:7:1 (tanpa harakat)")]))

    # 18. al-maghdub once
    st = C.stem(1, 7, 6)
    lem_mg, root_gdb = st.feat["LEM"], st.feat["ROOT"]
    h_mg = C.lemma_hits(lem_mg)
    tz_mg = C.find_seq([C.ntok(1, 7, 6)], prefixes=("", WAW, FA, BA, LAM))
    h_gdb = C.root_hits(root_gdb)
    compare("al-maghdhub", "lemma count", len(h_mg), PLAN["maghdub"])
    compare("al-maghdhub", "Tanzil token count", len(tz_mg), PLAN["maghdub"])
    compare("al-maghdhub", "root count", len(h_gdb), PLAN["root_gdb"])
    rl = " ".join(root_letters(root_gdb))
    gdb_refs = uniq_refs((g.s, g.a) for g in h_gdb)
    F.append(fact(
        "al-maghdhub", "Al-magḍūb hanya sekali",
        f"Kata {q([fat[7][5]])} (yang dimurkai) hanya muncul {'sekali' if len(h_mg) == 1 else str(len(h_mg)) + ' kali'} "
        f"dalam Al-Qur'an, yaitu di {refs_text(uniq_refs((g.s, g.a) for g in h_mg))}. Keluarga akar {rl} "
        f"(marah, murka) muncul {kali(len(h_gdb), gdb_refs)}.",
        gdb_refs,
        f"{QAC_BASIS}: LEM:{lem_mg} (lemma 1:7:6) = {len(h_mg)}; ROOT:{root_gdb} = {len(h_gdb)} segmen dalam "
        f"{len(gdb_refs)} ayat. Dicek di "
        f"Tanzil: token al-magḍūb (boleh berawalan) muncul {len(tz_mg)} kali.",
        [C.qac_src(f"LEM:{lem_mg}; ROOT:{root_gdb}"), C.tanzil_src("token 1:7:6")]))

    # 19. 4:69 (Ibn Kathir's link)
    lem_an = C.stem(1, 7, 3).feat["LEM"]
    an_refs = uniq_refs((g.s, g.a) for g in C.lemma_hits(lem_an))
    has_469 = "4:69" in an_refs
    compare("yang-diberi-nikmat", "4:69 contains the verb lemma of 1:7:3", has_469, True)
    if has_469:
        F.append(fact(
            "yang-diberi-nikmat", "Siapa yang diberi nikmat?",
            f"Ibnu Katsir menghubungkan {q(fat[7][1:4])} dengan 4:69, yang menyebut para nabi, para shiddiqin, "
            f"para syuhada, dan orang-orang saleh.",
            ["1:7", "4:69"],
            f"Bukan hitungan. Kaitan kedua ayat dikutip dari Ibnu Katsir (tafsir 1:7). Dicek di {QAC_BASIS}: 4:69 memuat "
            f"kata kerja dengan LEM:{lem_an}, lemma yang sama dengan an‘amta (1:7:3).",
            [{"kitab": "Ibnu Katsir, Tafsir al-Qur'an al-'Azhim", "ref": "tafsir QS 1:7",
              "url": "https://tafsir.app/ibn-katheer/1/7"},
             C.qac_src(f"LEM:{lem_an} di 4:69")]))

    # 20. Amin
    F.append(fact(
        "amin-bukan-ayat", "Āmīn bukan bagian Al-Qur'an",
        "Ucapan āmīn setelah membaca Al-Fatihah bukan bagian dari Al-Fatihah dan bukan ayat Al-Qur'an; artinya "
        "'kabulkanlah'. Darwisy menyebutnya sunnah diucapkan sesudah Al-Fatihah.",
        ["1:7"],
        "Bukan hitungan; dikutip dari al-Mujtaba dan Darwisy (pembahasan QS 1:7).",
        [{"kitab": "Ahmad al-Kharrath, al-Mujtaba min Musykil I'rab al-Qur'an",
          "ref": "QS 1:7 (halaman cetak belum diverifikasi)", "url": "https://tafsir.app/mujtaba-mushkil-iraab/1/7"},
         {"kitab": DARWISY,
          "ref": "jil. 1, hlm. 20 (bagian al-Fawa'id, QS 1:7)",
          "url": "https://tafsir.app/iraab-aldarweesh/1/7"}]))

    return F, cmp
