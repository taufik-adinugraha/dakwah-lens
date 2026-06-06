"""Download + parse Nashaihul Ibad (Nawawi al-Bantani's commentary on
Ibn Hajar's Munabbihat) for kitab corpus.

Source: archive.org PDF at
  https://ia800605.us.archive.org/5/items/book2_20140128_1312/book7.pdf
The text layer is clean (not OCR'd image scans like the heavily-mangled
other archive.org upload at /details/KitabNashaihulibad) — pdftotext
extracts full Arabic with harakat preserved.

Authors / edition:
- Original Munabbihat compilation by Ibn Hajar al-Asqalani (d. 852H/1449 CE).
- Sharh / commentary by Sheikh Muhammad Nawawi al-Bantani (d. 1316H/1898 CE).
Public domain both.

Why this is the highest-value kitab for the Indonesian audience:
- Sheikh Nawawi al-Bantani was a Banten-born scholar, widely studied in
  pesantren Indonesian — his commentary is THE canonical Nashaihul Ibad
  in the Indonesian Islamic tradition.
- Topical content: akhlak + tasawuf + advice for the afterlife.

Why pdftotext (system binary) rather than a Python PDF lib:
We don't ship any PDF dep on prod, and the parsing happens locally on
the dev machine (output JSON is shipped to prod for embed, same as
Al-Umm). pdftotext is universally available via Poppler on macOS / Linux
and produces cleaner Arabic-with-harakat extraction than pypdf.

Structure
---------
9 sections after parsing:
  intro + 8 numbered باب (Threes, Fours, Fives, ... Tens) — Ibn Hajar's
  classification of advice in numerical groups with Nawawi's commentary.

Output
------
`api/data/nashaihul-ibad.json` — array of records:
  { section_id, qism, title, ar, char_count }
ready for `embed_nashaih.py` to embed.

Run (local — needs pdftotext, won't run in the api container)
---
    cd api && uv run python -m api.scripts.download_nashaih
"""

from __future__ import annotations

import json
import re
import subprocess
import tempfile
import urllib.request
from pathlib import Path

import structlog

log = structlog.get_logger()

PDF_URL = (
    "https://ia800605.us.archive.org/5/items/"
    "book2_20140128_1312/book7.pdf"
)
DATA_DIR = Path(__file__).resolve().parents[3] / "data"
OUTPUT_PATH = DATA_DIR / "nashaihul-ibad.json"

# Chapter markers — Ibn Hajar's numerical groupings. Order matters: we
# walk top-down splitting the text at each marker's first occurrence.
# Final tuple field is the display title (kept Arabic so chips render
# consistently with other kitab labels).
_CHAPTERS: list[tuple[str, str]] = [
    ("الثنائي", "باب الثنائي"),
    ("الثالثي", "باب الثالثي"),
    ("الرباعي", "باب الرباعي"),
    ("الخماسي", "باب الخماسي"),
    ("السداسي", "باب السداسي"),
    ("السباعي", "باب السباعي"),
    ("الثماني", "باب الثماني"),
    ("التساعي", "باب التساعي"),
    ("العشاري", "باب العشاري"),
]


def _fetch_pdf() -> bytes:
    log.info("download_nashaih.fetching", url=PDF_URL)
    req = urllib.request.Request(
        PDF_URL,
        headers={"User-Agent": "Mozilla/5.0 (DakwahLens kitab ingester)"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = resp.read()
    log.info("download_nashaih.fetched", bytes=len(body))
    return body


def _pdftotext(pdf_bytes: bytes) -> str:
    """Extract clean text via Poppler's pdftotext. Run with `-layout` to
    preserve line ordering; Arabic harakat survive cleanly."""
    with tempfile.NamedTemporaryFile(suffix=".pdf") as tmp:
        tmp.write(pdf_bytes)
        tmp.flush()
        proc = subprocess.run(
            ["pdftotext", "-layout", tmp.name, "-"],
            capture_output=True,
            timeout=60,
        )
        if proc.returncode != 0:
            raise SystemExit(
                f"pdftotext failed (rc={proc.returncode}): "
                f"{proc.stderr.decode(errors='replace')}\n"
                "Install Poppler: `brew install poppler` (macOS) or "
                "`apt-get install poppler-utils` (Linux)."
            )
    return proc.stdout.decode("utf-8", errors="replace")


def _clean_text(raw: str) -> str:
    """Strip the U+202B...U+202C bidi marks pdftotext sprinkles around
    RTL text, and collapse runs of whitespace while preserving newlines
    (we still need line breaks to find chapter boundaries)."""
    # Bidi controls and zero-width chars.
    bidi = "‪‫‬‭‮‎‏​‌‍"
    out = raw.translate({ord(c): None for c in bidi})
    # Collapse runs of spaces but keep newlines.
    out = re.sub(r"[ \t]+", " ", out)
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out.strip()


def _split_into_sections(text: str) -> list[tuple[str, str]]:
    """Walk top-down, splitting at each chapter marker's FIRST occurrence
    so a marker word appearing inside another chapter's body doesn't
    re-split. Returns [(title, body), …] starting with the intro."""
    positions: list[tuple[int, str, str]] = []
    cursor = 0
    for marker, title in _CHAPTERS:
        idx = text.find(marker, cursor)
        if idx == -1:
            log.warning("download_nashaih.chapter_missing", marker=marker)
            continue
        positions.append((idx, marker, title))
        cursor = idx + len(marker)

    sections: list[tuple[str, str]] = []
    if not positions:
        return [("Pendahuluan", text)]

    intro = text[: positions[0][0]].strip()
    if intro and len(intro) > 200:
        sections.append(("Pendahuluan", intro))

    for i, (start, _marker, title) in enumerate(positions):
        end = positions[i + 1][0] if i + 1 < len(positions) else len(text)
        body = text[start:end].strip()
        if body:
            sections.append((title, body))
    return sections


def _chunk_body(body: str, target_chars: int = 3000) -> list[str]:
    """Split a chapter into ~target_chars chunks at paragraph boundaries.

    Some Nashaihul Ibad chapters run to ~17k chars (Twos, Tens). Single-
    vector embedding loses thematic granularity. Splitting at the
    paragraph breaks pdftotext preserves (`\\n\\n`) keeps each chunk
    coherent — every paragraph here is typically one narration ("وعن
    النبي ...") or one numbered group ("هذه أربعة كذا").

    If a paragraph itself exceeds target_chars (rare for this kitab),
    it lands in its own chunk as-is rather than being broken mid-
    sentence — better than risking a cut inside an Arabic quote.
    """
    if len(body) <= target_chars:
        return [body]
    paras = [p.strip() for p in body.split("\n\n") if p.strip()]
    chunks: list[str] = []
    cur: list[str] = []
    cur_len = 0
    for p in paras:
        if cur and cur_len + len(p) > target_chars:
            chunks.append("\n\n".join(cur))
            cur = [p]
            cur_len = len(p)
        else:
            cur.append(p)
            cur_len += len(p) + 2  # +2 for the \n\n separator
    if cur:
        chunks.append("\n\n".join(cur))
    return chunks


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    pdf_bytes = _fetch_pdf()
    raw = _pdftotext(pdf_bytes)
    cleaned = _clean_text(raw)
    pairs = _split_into_sections(cleaned)

    records: list[dict[str, object]] = []
    section_id = 0
    for title, body in pairs:
        chunks = _chunk_body(body)
        total = len(chunks)
        for chunk_idx, chunk_body in enumerate(chunks, start=1):
            section_id += 1
            label = (
                title if total == 1 else f"{title} ({chunk_idx}/{total})"
            )
            records.append({
                "section_id": section_id,
                "qism": "",  # Nashaihul Ibad has no super-chapter level
                "title": label,
                "ar": chunk_body,
                "char_count": len(chunk_body),
            })

    total_chars = sum(int(r["char_count"]) for r in records)
    log.info(
        "download_nashaih.done",
        sections=len(records),
        total_chars=total_chars,
        avg_chars=total_chars // max(1, len(records)),
    )

    OUTPUT_PATH.write_text(
        json.dumps(records, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    log.info("download_nashaih.written", path=str(OUTPUT_PATH))


if __name__ == "__main__":
    main()
