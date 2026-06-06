"""Download + parse Bidayatul Hidayah (Imam al-Ghazali) for kitab corpus.

Source: Shamela EPUB at https://old.shamela.ws/epubs/127/12718.epub
Edition: Maktabat Madbouli, Cairo, 1413H/1993 — published Arabic edition,
public domain (Ghazali d. 505H/1111 CE).

Why Arabic-only for now:
  Translation (ID/EN) is deferred — the user instructed 2026-06-08 to
  embed Arabic-only first, plan to add translations later. text-embedding-
  3-large is multilingual so cross-lingual retrieval from ID/EN queries
  still works; chips render Arabic-only until a translation pass is added.
  This matches the existing posture for Bukhari/Riyad/Bulugh (AR + EN
  in payload but ID translation deferred until manually filled).

Structure
---------
The EPUB has 46 content sections (anchor ids C1..C46) distributed across
xhtml page files. The Table of Contents maps each section to a label and
file fragment. We walk TOC top-down so the qism (top-level part) heading
context propagates to each section below it.

Output
------
`api/data/bidayat-al-hidayah.json` — array of records:
  { section_id, qism, title, ar, char_count }
ready for `embed_bidayat.py` to chunk + embed.

Run
---
    cd api && uv run python -m api.scripts.download_bidayat
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

EPUB_URL = "https://old.shamela.ws/epubs/127/12718.epub"
DATA_DIR = Path(__file__).resolve().parents[3] / "data"
OUTPUT_PATH = DATA_DIR / "bidayat-al-hidayah.json"

# `قسم` (qism, lit. "part") prefixes the top-level division headings.
# Sections AFTER one of these labels and BEFORE the next qism heading
# inherit it as their qism context.
_QISM_RE = re.compile(r"^القسم\s+(الأول|الثاني|الثالث|الرابع)")


def _fetch_epub() -> bytes:
    log.info("download_bidayat.fetching", url=EPUB_URL)
    req = urllib.request.Request(
        EPUB_URL, headers={"User-Agent": "Mozilla/5.0 (DakwahLens kitab ingester)"}
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = resp.read()
    log.info("download_bidayat.fetched", bytes=len(body))
    return body


def _parse_toc(zf: zipfile.ZipFile) -> list[tuple[str, str, str]]:
    """Read OEBPS/toc.ncx → list of (label, xhtml_path, anchor_id) in order."""
    toc_xml = zf.read("OEBPS/toc.ncx").decode("utf-8")
    pattern = re.compile(
        r'<navPoint[^>]*>\s*<navLabel><text>([^<]+)</text></navLabel>\s*'
        r'<content src="([^"]+)"',
        re.DOTALL,
    )
    entries: list[tuple[str, str, str]] = []
    for match in pattern.finditer(toc_xml):
        label = match.group(1).strip()
        src = match.group(2).strip()
        # src looks like "xhtml/P5.xhtml#C5" or "xhtml/info.xhtml" (no anchor)
        if "#" in src:
            path, anchor = src.split("#", 1)
        else:
            path, anchor = src, ""
        entries.append((label, f"OEBPS/{path}", anchor))
    return entries


_PAGE_FOOTER_RE = re.compile(
    r'<div\s+class="center">[^<]*الجزء[^<]*</div>',
    re.IGNORECASE,
)


def _strip_tags(html_fragment: str) -> str:
    """HTML/CSS-aware → plain text. Strips tags, collapses whitespace,
    preserves Arabic + harakat. Also drops the per-page volume/page-number
    footer Shamela injects into every xhtml file (`<div class="center">
    الجزء: 1 ¦ الصفحة: 30</div>`) — those would otherwise pollute every
    section body with bibliographic noise."""
    text = _PAGE_FOOTER_RE.sub(" ", html_fragment)
    text = re.sub(r"<[^>]+>", " ", text)
    # Decode the few HTML entities Shamela actually emits.
    text = (
        text.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
    )
    return re.sub(r"\s+", " ", text).strip()


def _extract_section_bodies(
    zf: zipfile.ZipFile, entries: list[tuple[str, str, str]]
) -> dict[str, str]:
    """Map anchor_id → Arabic body. Walks each xhtml file once, slicing
    between consecutive `id="C\\d+"` anchors so a file containing multiple
    sections splits correctly."""
    # Group entries by xhtml path, preserving order within each file.
    by_file: dict[str, list[tuple[str, str]]] = {}
    for label, path, anchor in entries:
        if not anchor:
            continue
        by_file.setdefault(path, []).append((anchor, label))

    bodies: dict[str, str] = {}
    for path, anchors in by_file.items():
        try:
            html = zf.read(path).decode("utf-8")
        except KeyError:
            log.warning("download_bidayat.missing_file", path=path)
            continue
        # Find every anchor id in document order. Shamela emits single
        # quotes (`<a id='C5'></a>`), allow both for safety.
        anchor_iter = list(re.finditer(r"""id=['"](C\d+)['"]""", html))
        positions = {m.group(1): (m.start(), m.end()) for m in anchor_iter}
        for anchor, _label in anchors:
            if anchor not in positions:
                log.warning(
                    "download_bidayat.missing_anchor",
                    file=path,
                    anchor=anchor,
                )
                continue
            start = positions[anchor][1]
            # End = start of the next anchor in this file (any anchor, not
            # just the ones in our TOC list — some intra-file headings may
            # not be in TOC but still anchor-marked).
            next_starts = [
                m.start() for m in anchor_iter if m.start() > positions[anchor][0]
            ]
            end = next_starts[0] if next_starts else len(html)
            body = _strip_tags(html[start:end])
            bodies[anchor] = body
    return bodies


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    body = _fetch_epub()
    with zipfile.ZipFile(io.BytesIO(body)) as zf:
        toc = _parse_toc(zf)
        bodies = _extract_section_bodies(zf, toc)

    # Shamela stacks back-to-back anchors at conceptual section boundaries:
    # `<a id='C7'></a><a id='C8'></a>` followed by ONE block of mixed
    # ghusl+tayammum text. Naive extraction gives C7 an empty body and C8
    # the whole block. We walk TOC top-down; any near-empty section gets
    # its title PUSHED to the next non-empty section so titles like
    # "آداب الغسل / آداب التيمم" survive together with the merged body.
    records: list[dict[str, object]] = []
    current_qism = ""
    section_id = 0
    skipped = 0
    pending_titles: list[str] = []
    for label, _path, anchor in toc:
        # Track qism context as we walk top-down.
        if _QISM_RE.match(label):
            current_qism = label
            # Qism heading entries are containers, not content — skip.
            # Don't carry pending_titles across a qism boundary.
            pending_titles = []
            continue
        if not anchor:
            # info.xhtml (book card) — skip metadata-only entries.
            continue
        body = bodies.get(anchor, "").strip()
        if not body or len(body) < 40:
            # Stacked anchor with empty body — remember its title to merge
            # into the next non-empty section.
            pending_titles.append(label)
            skipped += 1
            continue
        section_id += 1
        merged_title = " / ".join([*pending_titles, label]) if pending_titles else label
        pending_titles = []
        records.append({
            "section_id": section_id,
            "anchor": anchor,
            "qism": current_qism,
            "title": merged_title,
            "ar": body,
            "char_count": len(body),
        })

    total_chars = sum(int(r["char_count"]) for r in records)
    log.info(
        "download_bidayat.done",
        sections=len(records),
        skipped=skipped,
        total_chars=total_chars,
        avg_chars=total_chars // max(1, len(records)),
    )

    OUTPUT_PATH.write_text(
        json.dumps(records, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    log.info("download_bidayat.written", path=str(OUTPUT_PATH))


if __name__ == "__main__":
    main()
