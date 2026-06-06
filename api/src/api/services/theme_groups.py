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
        "(BUKAN polemik kebijakan/pejabat — itu Pemerintahan & Kebijakan)"
    ),
    "Sosial & Keluarga": "KS, KDRT, perlindungan anak, dinamika sosial",
    "Ekonomi & Bisnis": (
        "ekonomi rakyat, bisnis halal, investasi, UMKM, daya beli"
    ),
    "Aqidah & Ibadah": (
        "ibadah ISLAM pilar (haji/kurban/idul adha), hijrah, fatwa, polemik "
        "aqidah, hadith/ayat dengan framing pengajaran Islam — HANYA untuk "
        "konten Islam; konten Kristen/Katolik/Buddha/Hindu/lintas-iman → "
        "Toleransi & Lintas-Iman; cerita politik tentang ibadah → "
        "Pemerintahan & Kebijakan"
    ),
    "Kesehatan & Kehidupan": "kesehatan fisik & mental, kesejahteraan jiwa",
    "Pendidikan & SDM": (
        "sekolah, kampus, literasi, pembangunan SDM kelembagaan — BUKAN "
        "akademi sepak bola/sport (itu Lainnya), BUKAN wisata yang "
        "kebetulan menyasar libur sekolah (itu Lainnya), BUKAN HR "
        "awards korporasi (itu Lainnya)"
    ),
    "Lingkungan & Bencana": (
        "bencana alam, kebakaran, kecelakaan, lingkungan, fenomena alam "
        "misterius"
    ),
    "Pemerintahan & Kebijakan": (
        "pemerintahan, kebijakan publik, otonomi daerah, program negara, "
        "ideologi negara (Pancasila), polemik kebijakan/pejabat, hari "
        "nasional"
    ),
    "Patologi Sosial Digital": (
        "judi online, pinjol, narkoba, kekerasan berbasis gender online "
        "(AI deepfake nude tanpa persetujuan, sextortion, doxing korban), "
        "porn-spam thread"
    ),
    "Teknologi & AI": "kecerdasan buatan, teknologi baru, etika digital",
    "Pekerja & Pertanian Rakyat": (
        "buruh, tenaga kerja, petani, nelayan, ketahanan pangan"
    ),
    "Konflik & Geopolitik": (
        "Palestina, konflik internasional, geopolitik, hubungan luar negeri"
    ),
    "Inspirasi & Kisah Pribadi": (
        "kisah hidup orang BIASA (bukan selebritas/atlet), pengalaman "
        "pribadi reflektif, renungan, motivasi — BUKAN K-pop chart, "
        "BUKAN profil aktris/atlet, BUKAN pengajaran hadith (itu Aqidah & "
        "Ibadah), BUKAN ajaran agama non-Islam (itu Toleransi & "
        "Lintas-Iman)"
    ),
    "Toleransi & Lintas-Iman": (
        "moderasi beragama, pluralisme, lintas-iman"
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
