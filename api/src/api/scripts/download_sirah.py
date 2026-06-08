"""Download + parse As-Sirah an-Nabawiyyah (Ibn Hisham) for the kitab corpus.

Source: Shamela EPUB at https://old.shamela.ws/epubs/074/7450.epub
Edition: ed. Taha 'Abd al-Ra'uf Sa'd. Author 'Abd al-Malik ibn Hisham
(d. 218H/833 CE) — clearly public domain (~1192 years post-author-death).
This is the foundational redaction of Ibn Ishaq's earlier sirah, the
canonical Prophetic biography taught across all Indonesian pesantren
sirah curricula.

Structure handling — why this kitab needs a different pattern
-------------------------------------------------------------
Sirah Ibn Hisham's Shamela EPUB has an EXTREMELY coarse TOC: only
2 anchored entries per volume ("المتن" + "الفهارس"). Aggregating
between TOC anchors (the pattern used for Fath al-Mu'in, Adab al-'Alim,
Syamail) would produce 2 sections of ~290 pages each — useless for
retrieval. Each section would chunk to ~75 vectors with no chapter
context.

Strategy: chunk by fixed page windows (3 pages per section ≈ 6k chars,
fits one 8k vector) and harvest the FIRST inline heading found in each
chunk's pages as the section title. Inline headings in Ibn Hisham
follow predictable patterns:
  - Short line (<120 chars) ending in `:` or `؟`
  - Event-style prefixes: أَمْرُ X, ذِكْرُ X, حَدِيثُ X, قِصَّةُ X,
    سِيَاقَةُ X, بَيَانُ X, بَدْءُ X, مَوْتُ X, وَفَاةُ X, غَزْوَةُ X,
    بَعْثُ X, إسْلَامُ X, هِجْرَةُ X, فَتْحُ X
  - Lines starting with chain narrator markers (قَالَ ابْنُ هِشَامٍ,
    حَدَّثَنَا) are skipped — they're body, not headings.

About 37% of pages have a clean inline heading. For chunks that don't,
the title falls back to "ص X-Y" (page range). Volume tracking: V1
covers P1-P294, V2 covers P307-P588; we skip the index (الفهارس)
sections at P295-P306 and P589-P594.

Output
------
`api/data/sirah-ibn-hisham.json` — array of records:
  { section_id, qism, title, ar, char_count }
ready for `embed_sirah.py` to embed.

Run
---
    cd api && uv run python -m api.scripts.download_sirah
"""

from __future__ import annotations

import io
import json
import re
import urllib.request
import zipfile
from pathlib import Path

import structlog

log = structlog.get_logger()

EPUB_URL = "https://old.shamela.ws/epubs/074/7450.epub"
DATA_DIR = Path(__file__).resolve().parents[3] / "data"
OUTPUT_PATH = DATA_DIR / "sirah-ibn-hisham.json"

# Page-window size. 3 pages × ~2k chars = ~6k chars, fits one 8k vector
# with comfortable headroom for the qism/title header we prepend.
PAGES_PER_SECTION = 3

# Volume boundaries (from TOC inspection 2026-06-08). Index sections
# are skipped — they're just navigation tables, not narrative content.
VOLUMES: list[tuple[str, int, int]] = [
    # (qism, start_page, end_page_inclusive)
    ("المجلد: الأول", 1, 294),
    ("المجلد: الثاني", 307, 588),
]

_PAGE_FOOTER_RE = re.compile(
    r'<div\s+class="center">[^<]*الجزء[^<]*</div>',
    re.IGNORECASE,
)
_TAG_RE = re.compile(r"<[^>]+>")
_BOOK_TITLE_BANNER_RE = re.compile(r"سيرة ابن هشام ت طه عبد الرؤوف سعد")

_CHAIN_PREFIXES = (
    "قَالَ ابْنُ", "قال ابن", "حَدَّثَنَا", "حدثنا", "أَخْبَرَنَا", "أخبرنا",
)
_EVENT_PREFIX_RE = re.compile(
    r"^(أَمْرُ|ذِكْرُ|حَدِيثُ|قِصَّةُ|سِيَاقَةُ|بَيَانُ|بَدْءُ|مَوْتُ|وَفَاةُ|"
    r"غَزْوَةُ|بَعْثُ|إسْلَامُ|هِجْرَةُ|فَتْحُ|بَابُ)"
)


def _fetch_epub() -> bytes:
    log.info("download_sirah.fetching", url=EPUB_URL)
    req = urllib.request.Request(
        EPUB_URL, headers={"User-Agent": "Mozilla/5.0 (DakwahLens kitab ingester)"}
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = resp.read()
    log.info("download_sirah.fetched", bytes=len(body))
    return body


def _strip_tags(html_fragment: str) -> str:
    text = _PAGE_FOOTER_RE.sub(" ", html_fragment)
    text = _TAG_RE.sub(" ", text)
    text = (
        text.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
    )
    text = _BOOK_TITLE_BANNER_RE.sub(" ", text)
    return re.sub(r"\s+", " ", text).strip()


def _read_page(zf: zipfile.ZipFile, page: int) -> str | None:
    try:
        return zf.read(f"OEBPS/xhtml/P{page}.xhtml").decode("utf-8")
    except KeyError:
        return None


def _first_inline_heading(html: str) -> str | None:
    """Scan the first ~10 line-broken segments of a page for a heading-
    shaped fragment. Returns None if nothing matches — caller falls back
    to a page-range title."""
    body_match = re.search(r"<body[^>]*>(.*?)</body>", html, re.DOTALL)
    if not body_match:
        return None
    body = body_match.group(1)
    lines = re.split(r"<br\s*/?>", body)
    for line in lines[:10]:
        clean = _strip_tags(line).strip()
        if not clean or len(clean) > 120:
            continue
        if any(clean.startswith(m) for m in _CHAIN_PREFIXES):
            continue
        if clean.endswith(":") or clean.endswith("؟"):
            return clean.rstrip(":؟").strip()
        if _EVENT_PREFIX_RE.match(clean):
            return clean
    return None


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    body = _fetch_epub()

    records: list[dict[str, object]] = []
    section_id = 0
    skipped = 0

    with zipfile.ZipFile(io.BytesIO(body)) as zf:
        for qism, vol_start, vol_end in VOLUMES:
            log.info("download_sirah.volume", qism=qism, start=vol_start, end=vol_end)
            for chunk_start in range(vol_start, vol_end + 1, PAGES_PER_SECTION):
                chunk_end = min(chunk_start + PAGES_PER_SECTION - 1, vol_end)
                title_from_pages: str | None = None
                body_parts: list[str] = []
                for p in range(chunk_start, chunk_end + 1):
                    raw = _read_page(zf, p)
                    if raw is None:
                        continue
                    if title_from_pages is None:
                        title_from_pages = _first_inline_heading(raw)
                    stripped = _strip_tags(raw)
                    if stripped:
                        body_parts.append(stripped)
                body_text = " ".join(body_parts).strip()
                if len(body_text) < 40:
                    skipped += 1
                    continue
                section_id += 1
                title = title_from_pages or f"ص {chunk_start}-{chunk_end}"
                records.append({
                    "section_id": section_id,
                    "anchor": f"p{chunk_start}",
                    "qism": qism,
                    "title": title,
                    "ar": body_text,
                    "char_count": len(body_text),
                })

    total_chars = sum(int(r["char_count"]) for r in records)
    with_heading = sum(1 for r in records if not str(r["title"]).startswith("ص "))
    log.info(
        "download_sirah.done",
        sections=len(records),
        skipped=skipped,
        total_chars=total_chars,
        avg_chars=total_chars // max(1, len(records)),
        with_heading=with_heading,
        heading_coverage=f"{100 * with_heading // max(1, len(records))}%",
    )

    OUTPUT_PATH.write_text(
        json.dumps(records, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    log.info("download_sirah.written", path=str(OUTPUT_PATH))


if __name__ == "__main__":
    main()
