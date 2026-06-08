"""Download + parse Tadhkirat al-Sami' wa al-Mutakallim fi Adab al-'Alim
wa al-Muta'allim (Ibn Jama'ah) for the kitab corpus.

Source: Shamela web pages at https://shamela.ws/book/151180/{1..204}
Edition: Dar al-Bashair al-Islamiyyah, ed. Muhammad Hashim al-Nadawi
(1354H/1935 CE). Author Badr al-Din Ibn Jama'ah al-Kinani (d. 733H).

Why this kitab matters
----------------------
The foundational adab text on the etiquette of teaching and learning.
KH Hasyim Asy'ari's 1923 "Adab al-'Alim wa al-Muta'allim" — the
canonical NU pesantren teacher/student adab curriculum — is built
directly on this source. Retrieval against Ibn Jama'ah's matn surfaces
the same content the Indonesian pesantren tradition organises around.

Why HTML scrape instead of EPUB
-------------------------------
Shamela book 151180 has no EPUB mirror (verified 2026-06-08 — both
old.shamela.ws/epubs/<prefix>/151180.epub and the new shamela.ws/epub
endpoints return 404). The book DOES exist as 204 per-page HTML pages
at /book/151180/{N}, each with a `<div class="nass">` content
container. We scrape those and group by TOC anchor.

Structure handling
------------------
TOC has 109 anchored entries (extracted from the book main page) with
labels like "الباب الأول", "الفصل الأول", "النوع الأول". Multi-level
hierarchy: bab → fasl → naw'. We propagate the depth-1 bab label as
qism context.

Output
------
`api/data/adab-alim-mutaallim.json` — array of records:
  { section_id, qism, title, ar, char_count }
ready for `embed_adab.py` to embed.

Run
---
    cd api && uv run python -m api.scripts.download_adab
"""

from __future__ import annotations

import json
import re
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import structlog

log = structlog.get_logger()

BOOK_ID = 151180
BASE_URL = f"https://shamela.ws/book/{BOOK_ID}"
DATA_DIR = Path(__file__).resolve().parents[3] / "data"
OUTPUT_PATH = DATA_DIR / "adab-alim-mutaallim.json"

# Confirmed by probing 2026-06-08 — pages 1-204 exist, p205+ return 404.
MAX_PAGE = 204

# Bab-level labels start with "الباب " — anything else (الفصل, النوع,
# الأول, الثاني, ...) is a sub-section and inherits the active bab as qism.
BAB_RE = re.compile(r"^الباب\s")

# Throttle between requests so we don't hammer Shamela.
REQUEST_DELAY_S = 0.4

USER_AGENT = "Mozilla/5.0 (DakwahLens kitab ingester)"


@dataclass
class TocAnchor:
    page: int
    label: str
    qism: str  # active bab when this anchor appeared


def _fetch_url(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8")


def _parse_toc(html: str) -> list[TocAnchor]:
    """Pull `<a href=".../book/151180/N">label</a>` pairs in document
    order, propagating the active bab as qism.

    Same page can host multiple anchors (a bab AND its first fasl both
    start at the same page). We keep the order and let downstream
    section-building merge or skip empties as needed."""
    anchors: list[TocAnchor] = []
    active_qism = ""
    for m in re.finditer(
        rf'<a[^>]*href="[^"]*/book/{BOOK_ID}/(\d+)"[^>]*>([^<]+)</a>',
        html,
    ):
        page = int(m.group(1))
        label = m.group(2).strip()
        if BAB_RE.match(label):
            active_qism = label
        anchors.append(TocAnchor(page=page, label=label, qism=active_qism))
    return anchors


_COPY_BTN_RE = re.compile(r'<a\s+href="#p\d+"[^>]*>.*?</a>', re.DOTALL)
_ANCHOR_SPAN_RE = re.compile(r'<span[^>]*class="anchor"[^>]*></span>')
_TAG_RE = re.compile(r"<[^>]+>")


def _extract_nass(html: str) -> str:
    """Pull the per-page Arabic body out of `<div class="nass">...</div>`.

    Drops the inline copy buttons (which surround each <p> with a
    `<a href="#pN">copy-icon</a>` link) and anchor spans, then strips
    remaining tags + collapses whitespace. Some pages have multiple
    nass divs (the main content + the optional translation panel) — we
    concatenate to keep all Arabic body content."""
    parts: list[str] = []
    for m in re.finditer(
        r'<div[^>]+class="nass[^"]*"[^>]*>(.*?)</div>', html, re.DOTALL
    ):
        text = _COPY_BTN_RE.sub(" ", m.group(1))
        text = _ANCHOR_SPAN_RE.sub(" ", text)
        text = _TAG_RE.sub(" ", text)
        text = (
            text.replace("&nbsp;", " ")
            .replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", '"')
        )
        text = re.sub(r"\s+", " ", text).strip()
        if text:
            parts.append(text)
    return " ".join(parts)


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    log.info("download_adab.fetching_toc", url=BASE_URL)
    toc_html = _fetch_url(BASE_URL)
    anchors = _parse_toc(toc_html)
    log.info("download_adab.toc_parsed", anchors=len(anchors))

    # Fetch every page once.
    page_bodies: dict[int, str] = {}
    log.info("download_adab.fetching_pages", count=MAX_PAGE)
    for p in range(1, MAX_PAGE + 1):
        try:
            html = _fetch_url(f"{BASE_URL}/{p}")
        except Exception as exc:
            log.warning("download_adab.page_failed", page=p, error=str(exc))
            continue
        body = _extract_nass(html)
        if body:
            page_bodies[p] = body
        if p % 30 == 0:
            log.info("download_adab.progress", done=p, total=MAX_PAGE)
        time.sleep(REQUEST_DELAY_S)
    log.info("download_adab.pages_done", fetched=len(page_bodies))

    # Build sections: each anchor owns pages from its start through the
    # next anchor's start (or end-of-book). Stacked anchors (multiple
    # anchors on the same page) merge — earlier ones' labels prefix
    # the next non-empty section's title, matching the pattern used in
    # download_fmuin / download_fs.
    records: list[dict[str, object]] = []
    section_id = 0
    skipped = 0
    pending_titles: list[str] = []
    last_qism = ""

    for i, anchor in enumerate(anchors):
        if anchor.qism != last_qism:
            pending_titles = []
            last_qism = anchor.qism

        end_page = (
            anchors[i + 1].page if i + 1 < len(anchors) else MAX_PAGE + 1
        )
        text_parts: list[str] = []
        for p in range(anchor.page, end_page):
            if p in page_bodies:
                text_parts.append(page_bodies[p])
        body = " ".join(text_parts).strip()
        if len(body) < 40:
            pending_titles.append(anchor.label)
            skipped += 1
            continue
        section_id += 1
        merged_title = (
            " / ".join([*pending_titles, anchor.label])
            if pending_titles
            else anchor.label
        )
        pending_titles = []
        records.append({
            "section_id": section_id,
            "anchor": f"p{anchor.page}",
            "qism": anchor.qism,
            "title": merged_title,
            "ar": body,
            "char_count": len(body),
        })

    total_chars = sum(int(r["char_count"]) for r in records)
    log.info(
        "download_adab.done",
        sections=len(records),
        skipped=skipped,
        total_chars=total_chars,
        avg_chars=total_chars // max(1, len(records)),
    )

    OUTPUT_PATH.write_text(
        json.dumps(records, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    log.info("download_adab.written", path=str(OUTPUT_PATH))


if __name__ == "__main__":
    main()
