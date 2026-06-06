"""Download + parse Fiqh as-Sunnah (Sayyid Sabiq) for kitab corpus.

Source: Shamela EPUB at https://old.shamela.ws/epubs/094/9486.epub
Edition: Dar al-Kitab al-Arabi (Beirut), 3rd ed., 1397H/1977 CE.
Author Sayyid Sabiq (d. 1420H/2000 CE).

Why this kitab matters
----------------------
Sabiq's Fiqh as-Sunnah is the most widely-used modern fiqh reference in
Indonesia after the traditional madhhab matn. It organizes rulings by
topic with daleel from Qur'an + hadith rather than by school, which makes
it the natural retrieval source for "what does fiqh say about X" content
queries — the bulk of dakwah audience questions.

Why Arabic-only for now
-----------------------
Per 2026-06-08 decision (see download_alumm.py header). text-embedding-
3-large is multilingual, so ID/EN queries still retrieve. Translation
pass is deferred.

Structure handling
------------------
Unlike Al-Umm (top-level books prefixed with `كتاب X`), Fiqh as-Sunnah's
top-level dividers are bare topic names (الطهارة, الصلاة, الزكاة, ...).
A regex on labels won't work. The Shamela EPUB DOES expose the
hierarchy via nested `<navPoint>` elements in toc.ncx, so we walk that
tree depth-first and treat any depth-1 ancestor's label as the qism
(book-level context) for everything beneath it.

Output
------
`api/data/fiqh-as-sunnah.json` — array of records:
  { section_id, qism, title, ar, anchor, char_count }
ready for `embed_fs.py` to embed.

Run
---
    cd api && uv run python -m api.scripts.download_fs
"""

from __future__ import annotations

import io
import json
import re
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass
from pathlib import Path

import structlog

log = structlog.get_logger()

EPUB_URL = "https://old.shamela.ws/epubs/094/9486.epub"
DATA_DIR = Path(__file__).resolve().parents[3] / "data"
OUTPUT_PATH = DATA_DIR / "fiqh-as-sunnah.json"

NCX_NS = "{http://www.daisy.org/z3986/2005/ncx/}"


@dataclass
class TocEntry:
    label: str
    path: str  # "OEBPS/xhtml/P12.xhtml"
    anchor: str  # "C5" (empty if the navPoint has no anchor)
    qism: str  # depth-1 ancestor label, propagated down


def _fetch_epub() -> bytes:
    log.info("download_fs.fetching", url=EPUB_URL)
    req = urllib.request.Request(
        EPUB_URL, headers={"User-Agent": "Mozilla/5.0 (DakwahLens kitab ingester)"}
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = resp.read()
    log.info("download_fs.fetched", bytes=len(body))
    return body


def _walk_navpoint(
    nav: ET.Element,
    depth: int,
    qism: str,
    out: list[TocEntry],
) -> None:
    """Depth-first walk over a single <navPoint>, emitting one TocEntry
    per navPoint with content. `qism` is the label of the nearest depth-1
    ancestor (or "" at depths 0/1)."""
    label_el = nav.find(f"{NCX_NS}navLabel/{NCX_NS}text")
    content_el = nav.find(f"{NCX_NS}content")
    label = (label_el.text or "").strip() if label_el is not None else ""
    src = content_el.get("src", "") if content_el is not None else ""
    if "#" in src:
        path_part, anchor = src.split("#", 1)
    else:
        path_part, anchor = src, ""
    out.append(
        TocEntry(
            label=label,
            path=f"OEBPS/{path_part}" if path_part else "",
            anchor=anchor,
            qism=qism,
        )
    )
    # Children inherit *this* navPoint as qism IF we're at depth 1
    # (i.e. the top-level book/topic dividers). Below that we keep the
    # same qism so a chapter-of-chapter doesn't shadow its book.
    child_qism = label if depth == 1 else qism
    for child in nav.findall(f"{NCX_NS}navPoint"):
        _walk_navpoint(child, depth + 1, child_qism, out)


def _parse_toc(zf: zipfile.ZipFile) -> list[TocEntry]:
    """Walk OEBPS/toc.ncx in document order, propagating depth-1 labels
    as qism context to all descendants."""
    toc_xml = zf.read("OEBPS/toc.ncx")
    root = ET.fromstring(toc_xml)
    navmap = root.find(f"{NCX_NS}navMap")
    if navmap is None:
        raise SystemExit("toc.ncx has no <navMap>")
    out: list[TocEntry] = []
    for top in navmap.findall(f"{NCX_NS}navPoint"):
        _walk_navpoint(top, depth=1, qism="", out=out)
    return out


_PAGE_FOOTER_RE = re.compile(
    r'<div\s+class="center">[^<]*الجزء[^<]*</div>',
    re.IGNORECASE,
)


def _strip_tags(html_fragment: str) -> str:
    text = _PAGE_FOOTER_RE.sub(" ", html_fragment)
    text = re.sub(r"<[^>]+>", " ", text)
    text = (
        text.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
    )
    return re.sub(r"\s+", " ", text).strip()


def _extract_section_bodies(
    zf: zipfile.ZipFile, entries: list[TocEntry]
) -> dict[tuple[str, str], str]:
    """Map (path, anchor) → Arabic body. Walks each xhtml file once,
    slicing between consecutive `id='Cn'` anchors so multi-section files
    split correctly. Same logic as download_alumm.py — Shamela's xhtml
    layout is identical across books."""
    by_file: dict[str, list[tuple[str, str]]] = {}
    for e in entries:
        if not e.anchor or not e.path:
            continue
        by_file.setdefault(e.path, []).append((e.anchor, e.label))

    bodies: dict[tuple[str, str], str] = {}
    for path, anchors in by_file.items():
        try:
            html = zf.read(path).decode("utf-8")
        except KeyError:
            log.warning("download_fs.missing_file", path=path)
            continue
        anchor_iter = list(re.finditer(r"""id=['"](C\d+)['"]""", html))
        positions = {m.group(1): (m.start(), m.end()) for m in anchor_iter}
        for anchor, _label in anchors:
            if anchor not in positions:
                log.warning("download_fs.missing_anchor", file=path, anchor=anchor)
                continue
            start = positions[anchor][1]
            next_starts = [
                m.start() for m in anchor_iter if m.start() > positions[anchor][0]
            ]
            end = next_starts[0] if next_starts else len(html)
            bodies[(path, anchor)] = _strip_tags(html[start:end])
    return bodies


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    body = _fetch_epub()
    with zipfile.ZipFile(io.BytesIO(body)) as zf:
        toc = _parse_toc(zf)
        bodies = _extract_section_bodies(zf, toc)

    # Same stacked-anchor merge pattern as Al-Umm: consecutive empty
    # anchors push their titles forward into the next non-empty section
    # so titles like "الميتة / الدم" stay attached to the merged body.
    records: list[dict[str, object]] = []
    section_id = 0
    skipped = 0
    pending_titles: list[str] = []
    last_qism = ""
    for e in toc:
        if e.qism != last_qism:
            # Crossed a top-level book boundary — don't drag pending
            # titles from the previous kitab into this one.
            pending_titles = []
            last_qism = e.qism
        if not e.anchor or not e.path:
            # navPoints without content (rare in Shamela, but skip).
            continue
        body_text = bodies.get((e.path, e.anchor), "").strip()
        if not body_text or len(body_text) < 40:
            pending_titles.append(e.label)
            skipped += 1
            continue
        section_id += 1
        merged_title = (
            " / ".join([*pending_titles, e.label]) if pending_titles else e.label
        )
        pending_titles = []
        records.append({
            "section_id": section_id,
            "anchor": e.anchor,
            "qism": e.qism,
            "title": merged_title,
            "ar": body_text,
            "char_count": len(body_text),
        })

    total_chars = sum(int(r["char_count"]) for r in records)
    log.info(
        "download_fs.done",
        sections=len(records),
        skipped=skipped,
        total_chars=total_chars,
        avg_chars=total_chars // max(1, len(records)),
    )

    OUTPUT_PATH.write_text(
        json.dumps(records, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    log.info("download_fs.written", path=str(OUTPUT_PATH))


if __name__ == "__main__":
    main()
