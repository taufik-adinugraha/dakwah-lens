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
            r"pinjol",
            r"pinjaman online",
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
