"""Coarse thematic grouping of fine-grained topic labels.

Mirror of `THEME_GROUPS` + `classifyThemeGroup` in
`web/src/lib/dashboard-metrics.ts`. Both sides MUST stay in sync —
the daily topic-discovery pass produces fine-grained topic labels,
and BOTH the web dashboard (group breakdown UI) and the briefing
pipeline (one briefing per group) classify those labels into groups
via the patterns below.

When you change either side, mirror the change here. The Python
side uses `re.IGNORECASE` to match the JS `/.../i` regex flag.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

LAINNYA_GROUP = "Lainnya"


@dataclass(frozen=True)
class ThemeGroup:
    group: str
    patterns: tuple[re.Pattern[str], ...]


def _patterns(*sources: str) -> tuple[re.Pattern[str], ...]:
    return tuple(re.compile(src, re.IGNORECASE) for src in sources)


THEME_GROUPS: tuple[ThemeGroup, ...] = (
    ThemeGroup(
        "Hukum & Keadilan",
        _patterns(
            r"korupsi",
            r"pengkhianatan amanah",
            r"kriminalitas",
            r"kejahatan",
            r"pembunuhan",
            r"penipuan",
        ),
    ),
    ThemeGroup(
        "Sosial & Keluarga",
        _patterns(
            r"kekerasan seksual",
            r"perlindungan anak",
            r"isu sosial",
            r"keluarga",
            r"kdrt",
        ),
    ),
    ThemeGroup(
        "Ekonomi & Bisnis",
        _patterns(
            r"ekonomi",
            r"kesejahteraan rakyat",
            r"bisnis",
            r"wirausaha",
            r"rupiah",
            r"crypto",
            r"trading",
            r"investasi",
            r"umkm",
        ),
    ),
    ThemeGroup(
        "Aqidah & Ibadah",
        _patterns(
            r"ibadah",
            r"haji",
            r"kurban",
            r"idul adha",
            r"hijrah",
            r"mualaf",
            r"inspirasi spiritual",
            r"fatwa",
            r"hukum islam",
            r"polemik aqidah",
            r"sektarian",
        ),
    ),
    ThemeGroup(
        "Kesehatan & Kehidupan",
        _patterns(r"kesehatan", r"penyakit", r"kesehatan mental", r"kesejahteraan jiwa"),
    ),
    ThemeGroup(
        "Pendidikan & SDM",
        _patterns(r"pendidikan", r"sekolah", r"literasi", r"sdm", r"kualitas sdm"),
    ),
    ThemeGroup(
        "Lingkungan & Bencana",
        _patterns(
            r"bencana",
            r"lingkungan",
            r"pengelolaan sampah",
            r"tragedi",
            r"kecelakaan",
            r"lalu lintas",
        ),
    ),
    ThemeGroup(
        "Pemerintahan & Kebijakan",
        _patterns(
            r"pemerintahan",
            r"otonomi daerah",
            r"kebijakan publik",
            r"birokrasi",
            r"otda",
            r"program pemerintah",
            r"makan bergizi",
            r"\bmbg\b",
        ),
    ),
    ThemeGroup(
        "Patologi Sosial Digital",
        _patterns(
            r"judi online",
            r"\bjudi\b",
            r"\bjudol\b",
            r"pinjol",
            r"pinjaman online",
            r"\butang\b",
            r"\bhutang\b",
            r"narkoba",
            r"penyalahgunaan obat",
        ),
    ),
    ThemeGroup(
        "Teknologi & AI",
        _patterns(
            r"teknologi",
            r"kecerdasan buatan",
            r"\bai\b",
            r"chatgpt",
            r"gemini",
            r"artificial intelligence",
            r"machine learning",
        ),
    ),
    ThemeGroup(
        "Pekerja & Pertanian Rakyat",
        _patterns(
            r"buruh",
            r"tenaga kerja",
            r"pekerja rumah tangga",
            r"upah minimum",
            r"bpjs ketenagakerjaan",
            r"ketahanan pangan",
            r"pertanian",
            r"petani",
            r"pupuk",
            r"bulog",
            r"nelayan",
        ),
    ),
    ThemeGroup(
        "Konflik & Geopolitik",
        _patterns(
            r"palestina",
            r"solidaritas umat",
            r"konflik internasional",
            r"hubungan internasional",
            r"geopolitik",
        ),
    ),
    ThemeGroup(
        "Inspirasi & Kisah Pribadi",
        _patterns(
            r"inspirasi", r"kisah hidup", r"pengalaman pribadi", r"renungan", r"motivasi"
        ),
    ),
    ThemeGroup(
        "Toleransi & Lintas-Iman",
        _patterns(
            r"toleransi",
            r"keberagaman",
            r"lintas[\s-]?iman",
            r"moderasi beragama",
            r"pluralisme",
        ),
    ),
)


def classify_theme_group(label: str) -> str:
    """Map a fine-grained topic label to one of the 14 coarse groups,
    or `LAINNYA_GROUP` when no pattern matches. First-match wins."""
    for tg in THEME_GROUPS:
        if any(p.search(label) for p in tg.patterns):
            return tg.group
    return LAINNYA_GROUP


def slugify_group(group: str) -> str:
    """Stable URL/storage slug for a group name.

    "Hukum & Keadilan" -> "hukum-keadilan"
    "Pekerja & Pertanian Rakyat" -> "pekerja-pertanian-rakyat"
    "Teknologi & AI" -> "teknologi-ai"
    "Lintas-Iman" -> "lintas-iman" (hyphen preserved)
    """
    s = group.lower()
    # Replace "&" + surrounding whitespace with a single space first so
    # we don't end up with a `--` token in the slug.
    s = re.sub(r"\s*&\s*", " ", s)
    # Collapse any non-alphanumeric (except existing hyphens) to spaces.
    s = re.sub(r"[^a-z0-9-]+", " ", s)
    # Collapse whitespace runs to a single hyphen, trim hyphens.
    return re.sub(r"\s+", "-", s.strip())


# Pre-computed slug → group map for fast inverse lookup.
GROUP_BY_SLUG: dict[str, str] = {slugify_group(tg.group): tg.group for tg in THEME_GROUPS}
LAINNYA_SLUG: str = slugify_group(LAINNYA_GROUP)


# Per-group one-line semantic hint — fed to the relevance.py prompt
# so Gemini classifies each post into the right THEME_GROUP using
# meaning (not surface keyword match). Order mirrors THEME_GROUPS;
# the read-time regex `classify_theme_group` stays as a fallback for
# rows the LLM hasn't tagged yet.
GROUP_INTENT_HINTS: dict[str, str] = {
    "Hukum & Keadilan": (
        "korupsi, kriminalitas, penipuan, pembunuhan, keadilan publik "
        "(BUKAN polemik kebijakan/pejabat — itu Pemerintahan & Kebijakan). "
        "BUKAN acara komunitas/baksos/lomba mancing/CFD/nobar/SIM gratis "
        "dari kepolisian (Hari Bhayangkara, Polres/Polsek event) — itu "
        "Lainnya. BUKAN kecelakaan lalu lintas rutin tanpa unsur kriminal "
        "(mengantuk, gorong-gorong terbuka, tabrakan beruntun) — itu "
        "Lingkungan & Bencana. BUKAN iklan/promo jasa (jasa balikin akun, "
        "hapus akun) — itu Lainnya. BUKAN insiden teknis/keselamatan "
        "(eskalator mall overload) tanpa unsur kriminal — itu Lainnya"
    ),
    "Sosial & Keluarga": (
        "KS, KDRT, perlindungan anak, kebijakan keluarga, dinamika sosial "
        "berbasis isu/komunitas — BUKAN gosip selebriti / drama perceraian "
        "artis / reaksi fans K-pop / komentar sinetron / cuitan fandom "
        "/ cuitan singkat <10 kata yang sekadar mengulang frase trigger "
        "('bunuh diri', 'broken home', 'cere') tanpa narasi substansi "
        "/ shitpost meme / fiksi anime-light-novel / cuitan fandom politik "
        "(itu Lainnya). BUKAN protes kesejahteraan hewan/isu sosial di luar "
        "negeri tanpa kaitan Indonesia (itu Lainnya)"
    ),
    "Ekonomi & Bisnis": (
        "ekonomi rakyat, bisnis halal, investasi, UMKM, daya beli"
    ),
    "Aqidah & Ibadah": (
        "ibadah ISLAM pilar (haji/kurban/idul adha), hijrah, fatwa, polemik "
        "aqidah, hadith/ayat dengan framing pengajaran Islam — HANYA untuk "
        "konten Islam dengan SUBSTANSI pengajaran/refleksi/polemik agama. "
        "BUKAN tasyakuran kelulusan / wisuda santri / pentas seni sekolah "
        "Islam (itu Pendidikan & SDM). BUKAN bisnis komersial dengan "
        "branding syar'i / properti / kuliner halal (itu Ekonomi & Bisnis). "
        "BUKAN kasus pidana yang melibatkan istilah Islam — badal haji "
        "fiktif, penipuan umrah (itu Hukum & Keadilan). BUKAN nasyid / lagu "
        "religi pop yang tidak mengajarkan aqidah (itu Lainnya). BUKAN "
        "oleh-oleh / kebiasaan jamaah haji yang fokus konsumsi (itu "
        "Lainnya). BUKAN laporan operasional haji murni — kedatangan "
        "kloter, jumlah jemaah tiba, manifes risti/kursi roda, transit, "
        "sambutan ceremonial Wali Kota/Menhaj di asrama haji, statistik "
        "Kemenhaj, jamaah meninggal/sakit tanpa refleksi ibadah, anekdot "
        "WC Masjidil Haram, pakaian tradisional jamaah saat pulang (itu "
        "Lainnya). BUKAN human-interest petugas haji / kisah personal "
        "jemaah individu (kisah ketua kloter, jemaah jual sawah untuk "
        "haji, kisah suami-istri jamaah) — itu Inspirasi & Kisah Pribadi. "
        "BUKAN lowongan kerja amil zakat / Lazismu / fundraiser ZIS "
        "(itu Lainnya). Cerita politik tentang ibadah / kartel haji / "
        "reformasi Kemenhaj → Pemerintahan & Kebijakan. Konten "
        "SINGLE-FAITH non-Islam (devosional Kristen, doa Katolik, "
        "kalender Hindu) → Lainnya kecuali ada framing lain. BUKAN daftar "
        "hasil lomba MTQ/STQ, CSR khitanan massal / santunan anak yatim, "
        "atau logistik & politik kepemimpinan muktamar/munas ormas Islam "
        "(NU/Muhammadiyah) — hasil lomba & CSR itu Lainnya, sedangkan "
        "kepemimpinan/politik ormas itu Pemerintahan & Kebijakan (audit#89)"
    ),
    "Kesehatan & Kehidupan": "kesehatan fisik & mental, kesejahteraan jiwa",
    "Pendidikan & SDM": (
        "sekolah, kampus, literasi, pembangunan SDM kelembagaan — BUKAN "
        "akademi sepak bola/sport (itu Lainnya), BUKAN wisata yang "
        "kebetulan menyasar libur sekolah (itu Lainnya), BUKAN HR "
        "awards korporasi (itu Lainnya). BUKAN brand activation/event "
        "olahraga merek yang menyasar siswa (Bebelac Little Star Fun Run, "
        "AQUA × DBL basketball, AQUA Fun Run) — itu Lainnya. BUKAN "
        "profesi guru/dosen yang disebut INSIDENTAL dalam cerita "
        "non-pendidikan (kecelakaan, kasus pidana, obituari) — pakai "
        "tema inti cerita. BUKAN tata kelola organisasi profesi "
        "non-pendidikan (Musda IDI dokter) — itu Kesehatan & Kehidupan. "
        "BUKAN lowongan kerja non-pendidikan (Kemenkes IHSS consultant, "
        "konsultan kementerian) — itu Lainnya. BUKAN cuitan sarkasme/"
        "meta tentang algoritma X/medsos yang mention 'dosen' — itu "
        "Lainnya"
    ),
    "Lingkungan & Bencana": (
        "bencana alam, kebakaran, kecelakaan, lingkungan, fenomena alam "
        "misterius"
    ),
    "Pemerintahan & Kebijakan": (
        "pemerintahan, kebijakan publik, otonomi daerah, program negara, "
        "ideologi negara (Pancasila), polemik kebijakan/pejabat, hari "
        "nasional. BUKAN notifikasi lalu lintas/maintenance jalan tol/"
        "penutupan ruas (Jasa Marga, plustrafik, llminfotrafik, NKVE, "
        "BKE, LDP) — itu Lainnya. BUKAN konten asing tanpa kaitan "
        "Indonesia (lalu lintas/politik Malaysia, K-pop celebrity wamil, "
        "berita China, dll) — itu Lainnya. BUKAN pemakaman/obituari "
        "mantan pejabat tanpa konten kebijakan — itu Lainnya. BUKAN "
        "promo acara olahraga/lari maraton/race expo/konser/event Ancol "
        "walaupun diselenggarakan instansi pemerintah — itu Lainnya. "
        "BUKAN vlog perjalanan/wisata via transportasi umum / sunrise "
        "tour / stream-of-consciousness lifestyle musing — itu Lainnya. "
        "BUKAN cuitan fandom politik singkat tanpa diskusi kebijakan "
        "('Anak Abah ganteng') — itu Lainnya. BUKAN kegiatan rutin/"
        "seremonial/human-interest TNI-Polri (latihan/lari fisik, bakti "
        "sosial bangun jembatan, silat/bela diri, upacara kenaikan "
        "pangkat, rekrutmen, yel/slogan, klip alutsista) atau Latsar/"
        "diklat ASN tanpa substansi kebijakan — itu Lainnya (audit#89)"
    ),
    "Patologi Sosial Digital": (
        "judi online, pinjol, narkoba (konteks distribusi/peredaran digital), "
        "kekerasan berbasis gender ONLINE (AI deepfake nude tanpa "
        "persetujuan, sextortion, doxing korban), porn-spam thread, hoax / "
        "ujaran kebencian sebagai fenomena digital. HARUS punya elemen "
        "online/digital eksplisit. BUKAN kasus pidana di venue fisik (mis. "
        "razia THM, pesta gay tempat hiburan) — itu Hukum & Keadilan bila "
        "penetapan tersangka, atau Sosial & Keluarga bila demo "
        "warga/moralitas komunitas. BUKAN kesehatan publik (vape, rokok "
        "elektrik) tanpa dimensi distribusi digital → itu Kesehatan & "
        "Kehidupan"
    ),
    "Teknologi & AI": "kecerdasan buatan, teknologi baru, etika digital",
    "Pekerja & Pertanian Rakyat": (
        "buruh, tenaga kerja, petani, nelayan, ketahanan pangan, "
        "PHK/pemutusan hubungan kerja massal, sengketa & hak "
        "ketenagakerjaan, upah, BPJS Ketenagakerjaan — isu yang berpusat "
        "pada nasib pekerja. PHK massal korporasi (mis. karyawan Tokopedia/"
        "TikTok) masuk sini, BUKAN Lainnya / Ekonomi & Bisnis, karena "
        "dampak intinya pada pekerja"
    ),
    "Konflik & Geopolitik": (
        "Palestina, konflik bersenjata internasional, geopolitik, perang, "
        "solidaritas umat lintas negara, hubungan luar negeri. HANYA untuk "
        "peristiwa yang intinya konflik/diplomasi/geopolitik — BUKAN semata "
        "karena kejadiannya di luar negeri. Peristiwa asing yang intinya "
        "kriminal/korupsi/penegakan hukum (razia/penggerebekan narkoba, "
        "operasi antikorupsi, kasus penipuan atau gugatan di pengadilan "
        "asing) → Hukum & Keadilan. Penghargaan/kunjungan diplomatik "
        "seremonial dan gerakan politik domestik (mis. gerakan menjatuhkan "
        "pemerintah) → Pemerintahan & Kebijakan. Sejarah/perdagangan kuno "
        "tanpa dimensi geopolitik terkini → Lainnya"
    ),
    "Inspirasi & Kisah Pribadi": (
        "kisah hidup orang BIASA (bukan selebritas/atlet), pengalaman "
        "pribadi reflektif, renungan, motivasi — BUKAN K-pop chart, "
        "BUKAN profil aktris/atlet, BUKAN pengajaran hadith (itu Aqidah & "
        "Ibadah), BUKAN ajaran agama non-Islam (itu Toleransi & "
        "Lintas-Iman)"
    ),
    "Toleransi & Lintas-Iman": (
        "konten yang SECARA EKSPLISIT mendiskusikan dialog antar-iman, "
        "moderasi beragama, kerukunan lintas-agama, polemik intoleransi "
        "antar-agama, atau kebijakan pluralisme. HARUS ada elemen LINTAS "
        "AGAMA — dua atau lebih agama bertemu dalam satu cerita, atau "
        "narasi eksplisit tentang toleransi sebagai topik. BUKAN konten "
        "single-faith non-Islam (devosional/lirik+chord lagu rohani "
        "Kristen termasuk Nikita/Hillsong, renungan Sunday Catholic, "
        "renungan Kristen citing ayat spesifik Ibrani/Mazmur/Korintus/"
        "Yohanes, doa harian Katolik, opini Katolik tentang sakramen/"
        "cyber & faith, kalender liturgi Hindu/Bali termasuk Galungan/"
        "Kuningan/Penyajaan/Padudusan Agung, jadwal misa, template doa "
        "untuk jemaat sakit/pernikahan, Pesparawi/lomba paduan suara "
        "gereja, workshop Keuskupan/Wisma Lorenzo) — itu Lainnya. "
        "Ucapan selamat hari raya non-Islam DARI pejabat/DPRD/instansi "
        "pemerintah BUKAN Toleransi (itu rutinitas seremonial, masuk "
        "Lainnya) kecuali artikel eksplisit membahas dialog/pluralisme. "
        "Warisan budaya/tradisi adat (Pule Sele, dll) BUKAN Toleransi "
        "kecuali ada framing lintas-iman eksplisit. PENGECUALIAN "
        "cross-faith framing (gunakan tema lain, bukan Toleransi): "
        "kebakaran gereja → Lingkungan & Bencana; kasus pidana di rumah "
        "ibadah → Hukum & Keadilan; ujian agama Katolik di SMA → "
        "Pendidikan & SDM"
    ),
}


def llm_group_options_prompt() -> str:
    """Render the 14 groups + Lainnya as a labelled list for the
    relevance.py system prompt — gives Gemini a semantic anchor per
    group instead of just a bare name.

    Public so the relevance prompt builder can pull it directly
    without restating the hints (keeps the two in sync)."""
    lines = [
        f"- {g}: {GROUP_INTENT_HINTS[g]}" for g in (tg.group for tg in THEME_GROUPS)
    ]
    lines.append(
        f"- {LAINNYA_GROUP}: tidak fit ke salah satu kategori di atas"
    )
    return "\n".join(lines)


# All valid group names (14 + Lainnya) — used by relevance.py to
# validate Gemini output and by backfills.
ALL_GROUP_NAMES: frozenset[str] = frozenset(
    [tg.group for tg in THEME_GROUPS] + [LAINNYA_GROUP]
)


def _normalize_group(s: str) -> str:
    """Canonical-key form of a group name for tolerant matching.

    Folds the harmless ways the LLM drifts from the exact stored name:
    surrounding whitespace/quotes/periods, internal whitespace runs,
    case, and `&` vs the spelled-out `dan`. Purely lexical — it never
    maps one distinct group onto another (verified: the 15 canonical
    names all normalize to distinct keys).
    """
    s = s.strip().strip("\"'.").strip().casefold()
    s = s.replace("&", " dan ")
    return re.sub(r"\s+", " ", s).strip()


# Normalized lookup → canonical name. Built once; used by resolve_group_name.
_NORM_TO_CANONICAL: dict[str, str] = {
    _normalize_group(g): g for g in ALL_GROUP_NAMES
}
# Guard against a future group whose normalized form collides with another's
# (that would silently swallow one). Cheap import-time invariant.
assert len(_NORM_TO_CANONICAL) == len(ALL_GROUP_NAMES), (
    "theme-group normalization collision — two groups share a normalized key"
)


def resolve_group_name(raw: object) -> str | None:
    """Map an LLM-returned theme_group to its exact canonical name.

    Returns the canonical group string if `raw` matches one of the 15
    names after tolerant normalization (case/whitespace/`&`↔`dan`/stray
    quotes), else None. A valid exact name resolves to itself, so this
    only ever *rescues* near-misses that strict equality would have
    dropped to NULL — it cannot cause a misassignment.
    """
    if not isinstance(raw, str):
        return None
    return _NORM_TO_CANONICAL.get(_normalize_group(raw))
