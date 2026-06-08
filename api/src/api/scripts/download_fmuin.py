"""Download + parse Fath al-Mu'in (Zainuddin al-Malibari) for kitab corpus.

Source: Shamela EPUB at https://old.shamela.ws/epubs/113/11327.epub
Edition: Standard Dar al-Fikr printing. Author Zayn al-Din Ahmad ibn
'Abd al-'Aziz al-Malibari (d. 987H/1579 CE) — a foundational Shafi'i
fiqh matn taught in nearly every Indonesian pesantren.

Why this kitab matters
----------------------
Fath al-Mu'in is the Shafi'i fiqh reference for the Indonesian
pesantren tradition. Together with its commentary I'anat al-Talibin,
it forms the standard NU/traditional fiqh curriculum. Adding it gives
the retrieval layer the actual madhhab voice most Indonesian dakwah
audiences study under — orthogonal to Fiqh as-Sunnah's modern dalil-
first approach.

Why Arabic-only for now
-----------------------
Same posture as the other AR-only kitabs added 2026-06-08:
text-embedding-3-large is multilingual so ID/EN queries still
retrieve. Translation pass is deferred.

Structure handling
------------------
Unlike Fiqh as-Sunnah (single xhtml per section) or Al-Umm (multiple
sub-anchors per file), Fathul Mu'in's TOC anchors point to the FIRST
page of each fasl while the body continues across many subsequent
pages. The 71 anchored TOC entries span 673 page files (P1-P673), so
slicing inside a single file (the download_fs/alumm pattern) yields
only ~440 chars/section — losing 95% of the text.

Strategy: walk pages numerically (P<N>.xhtml), accumulate text from
each TOC entry's start page through the next entry's start page (or
end-of-book for the final entry). The depth-1 navPoint label
propagates down as `qism` context.

Output
------
`api/data/fath-al-muin.json` — array of records:
  { section_id, qism, title, ar, char_count }
ready for `embed_fmuin.py` to embed.

Run
---
    cd api && uv run python -m api.scripts.download_fmuin
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

EPUB_URL = "https://old.shamela.ws/epubs/113/11327.epub"
DATA_DIR = Path(__file__).resolve().parents[3] / "data"
OUTPUT_PATH = DATA_DIR / "fath-al-muin.json"

NCX_NS = "{http://www.daisy.org/z3986/2005/ncx/}"
PAGE_RE = re.compile(r"xhtml/P(\d+)\.xhtml")
PAGE_PATH_RE = re.compile(r"OEBPS/xhtml/P(\d+)\.xhtml")


@dataclass
class TocEntry:
    depth: int
    label: str
    page: int | None  # numeric page index extracted from xhtml/P<n>.xhtml
    anchor: str
    qism: str  # depth-1 ancestor label, propagated down


def _fetch_epub() -> bytes:
    log.info("download_fmuin.fetching", url=EPUB_URL)
    req = urllib.request.Request(
        EPUB_URL, headers={"User-Agent": "Mozilla/5.0 (DakwahLens kitab ingester)"}
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = resp.read()
    log.info("download_fmuin.fetched", bytes=len(body))
    return body


def _walk_navpoint(
    nav: ET.Element,
    depth: int,
    qism: str,
    out: list[TocEntry],
) -> None:
    """Depth-first walk. `qism` is the label of the nearest depth-1
    ancestor (or "" at depths 0/1)."""
    label_el = nav.find(f"{NCX_NS}navLabel/{NCX_NS}text")
    content_el = nav.find(f"{NCX_NS}content")
    label = (label_el.text or "").strip() if label_el is not None else ""
    src = content_el.get("src", "") if content_el is not None else ""
    if "#" in src:
        path_part, anchor = src.split("#", 1)
    else:
        path_part, anchor = src, ""
    page_match = PAGE_RE.match(path_part)
    page = int(page_match.group(1)) if page_match else None
    out.append(TocEntry(depth=depth, label=label, page=page, anchor=anchor, qism=qism))
    child_qism = label if depth == 1 else qism
    for child in nav.findall(f"{NCX_NS}navPoint"):
        _walk_navpoint(child, depth + 1, child_qism, out)


def _parse_toc(zf: zipfile.ZipFile) -> list[TocEntry]:
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


def _max_page(zf: zipfile.ZipFile) -> int:
    pages = [
        int(m.group(1))
        for n in zf.namelist()
        if (m := PAGE_PATH_RE.match(n))
    ]
    return max(pages) if pages else 0


def _read_page(zf: zipfile.ZipFile, page: int) -> str:
    """Read and strip a single P<n>.xhtml. Returns "" if missing."""
    try:
        html = zf.read(f"OEBPS/xhtml/P{page}.xhtml").decode("utf-8")
    except KeyError:
        return ""
    return _strip_tags(html)


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    body = _fetch_epub()
    with zipfile.ZipFile(io.BytesIO(body)) as zf:
        toc = _parse_toc(zf)
        max_page = _max_page(zf)
        if max_page == 0:
            raise SystemExit("No P<n>.xhtml pages found in EPUB.")

        # Anchored, page-located TOC entries in document order. Other
        # entries (info.xhtml, bare containers without a page) are
        # discarded for content but their labels survive in `qism`
        # propagation.
        anchored = [e for e in toc if e.anchor and e.page is not None]
        log.info(
            "download_fmuin.toc",
            total_entries=len(toc),
            anchored=len(anchored),
            max_page=max_page,
        )

        # Same stacked-anchor merge pattern as Al-Umm: consecutive
        # near-empty sections push their titles into the next non-empty
        # one so chapter+sub-chapter compound titles ("باب الصلاة /
        # فصل في شروط الصلاة") stay attached to the merged body. Reset
        # across qism boundaries so a previous kitab's leftover titles
        # don't bleed into the next.
        records: list[dict[str, object]] = []
        section_id = 0
        skipped = 0
        pending_titles: list[str] = []
        last_qism = ""

        for i, entry in enumerate(anchored):
            if entry.qism != last_qism:
                pending_titles = []
                last_qism = entry.qism

            # Aggregate pages [entry.page, next_entry.page) — exclusive
            # upper bound so the next chapter's first page belongs to
            # that next chapter, not this one.
            end_page = (
                anchored[i + 1].page if i + 1 < len(anchored) else max_page + 1
            )
            text_parts: list[str] = []
            for p in range(entry.page, end_page or (max_page + 1)):
                page_text = _read_page(zf, p)
                if page_text:
                    text_parts.append(page_text)
            body_text = " ".join(text_parts).strip()
            if len(body_text) < 40:
                pending_titles.append(entry.label)
                skipped += 1
                continue
            section_id += 1
            merged_title = (
                " / ".join([*pending_titles, entry.label])
                if pending_titles
                else entry.label
            )
            pending_titles = []
            records.append({
                "section_id": section_id,
                "anchor": entry.anchor,
                "qism": entry.qism,
                "title": merged_title,
                "ar": body_text,
                "char_count": len(body_text),
            })

    total_chars = sum(int(r["char_count"]) for r in records)
    log.info(
        "download_fmuin.done",
        sections=len(records),
        skipped=skipped,
        total_chars=total_chars,
        avg_chars=total_chars // max(1, len(records)),
    )

    OUTPUT_PATH.write_text(
        json.dumps(records, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    log.info("download_fmuin.written", path=str(OUTPUT_PATH))


if __name__ == "__main__":
    main()
