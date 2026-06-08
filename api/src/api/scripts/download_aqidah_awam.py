"""Download + parse 'Aqidat al-'Awam (Ahmad al-Marzuqi) for the kitab corpus.

Source: Arabic Wikipedia article wikitext (extracted via the MediaWiki
API). The matn itself is a 1258H/1842 CE poem by Ahmad ibn Muhammad
al-Marzuqi al-Maliki (d. 1262H/1846 CE) — clearly public domain (~180
years post-author-death). Wikipedia is the cleanest structured source;
Shamela book 1815 has no EPUB and the rep.php endpoint 404s.

Why this kitab matters
----------------------
'Aqidat al-'Awam is the canonical entry-level Ash'ari aqidah text in
Indonesian pesantren: 57 verses of poetry covering tawhid, the 20
attributes of Allah, the prophets, and angelology. Taught from kindergarten
through ibtidaiyyah across NU and other traditional madrasahs. The 1923
sharh by Sheikh Nawawi al-Bantani (`Nur al-Zalam`) is one of the most
widely-read sharhs in Indonesia.

Structure
---------
The poem has 5 thematic sub-sections in pesantren teaching: muqaddimah
(2 verses), sifat Allah 20 + 3 mustahil/jaiz (~25), nubuwwat (~15),
mu'jizat + sahabat (~10), and khatimah (~5). We parse verses in document
order from the `== منظومة عقيدة العوام ==` section of the wiki article
and group every 5 consecutive verses into one retrievable section. Short
sections like a 57-verse poem don't need fine-grained TOC anchors —
5-verse windows give the embedder enough context (~250 chars per chunk)
without diluting the cosine score with chapter-level qism noise.

Output
------
`api/data/aqidah-awam.json` — array of records:
  { section_id, qism, title, ar, char_count }
ready for `embed_aqidah_awam.py` to embed.

Run
---
    cd api && uv run python -m api.scripts.download_aqidah_awam
"""

from __future__ import annotations

import json
import re
import urllib.parse
import urllib.request
from pathlib import Path

import structlog

log = structlog.get_logger()

WIKI_TITLE = "عقيدة العوام"
WIKI_API = "https://ar.wikipedia.org/w/api.php"
DATA_DIR = Path(__file__).resolve().parents[3] / "data"
OUTPUT_PATH = DATA_DIR / "aqidah-awam.json"

# 5 consecutive verses per embedding section. Aqidat al-'Awam is short
# (~57 verses); too-fine chunking (per-verse) gives high-variance cosine
# scores and tiny contexts; too-coarse (whole sub-section) buries the
# specific verse the query actually matches. 5 is the empirical sweet
# spot for short poetic matns.
VERSES_PER_SECTION = 5

USER_AGENT = "Mozilla/5.0 (DakwahLens kitab ingester)"


def _fetch_wikitext() -> str:
    """Hit the MediaWiki parse API for the article's raw wikitext."""
    params = {
        "action": "parse",
        "page": WIKI_TITLE,
        "format": "json",
        "prop": "wikitext",
    }
    url = f"{WIKI_API}?{urllib.parse.urlencode(params)}"
    log.info("download_aqidah_awam.fetching", url=url)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data["parse"]["wikitext"]["*"]


# Verses sit between `{{أبيات|` and the closing `}}` inside the
# `== منظومة عقيدة العوام ==` section. Each verse is one line with the
# two hemistichs separated by `\\` (literal backslashes in wikitext).
_VERSES_SECTION_RE = re.compile(
    r"==\s*منظومة عقيدة العوام\s*==\s*\{\{أبيات\|(.*?)\}\}",
    re.DOTALL,
)
# Strip wiki link markup: [[target|display]] → display, [[target]] → target.
_WIKI_LINK_RE = re.compile(r"\[\[([^\]\|]+)(?:\|([^\]]+))?\]\]")
# Bold/italic markup: '''text''' → text, ''text'' → text.
_WIKI_BOLD_RE = re.compile(r"'''([^']+)'''")
_WIKI_ITALIC_RE = re.compile(r"''([^']+)''")


def _clean_wiki_markup(line: str) -> str:
    line = _WIKI_LINK_RE.sub(lambda m: m.group(2) or m.group(1), line)
    line = _WIKI_BOLD_RE.sub(r"\1", line)
    line = _WIKI_ITALIC_RE.sub(r"\1", line)
    # Drop residual {{templates}} that don't represent verses.
    line = re.sub(r"\{\{[^}]*\}\}", "", line)
    # Collapse whitespace, normalise the inter-hemistich separator to ' · '
    # so retrieval treats both halves as one verse without losing the visual
    # break.
    line = line.replace("\\\\", " · ").replace("\\", " · ")
    line = re.sub(r"\s+", " ", line).strip()
    return line


def _extract_verses(wikitext: str) -> list[str]:
    m = _VERSES_SECTION_RE.search(wikitext)
    if not m:
        raise SystemExit(
            "Could not find `== منظومة عقيدة العوام ==` + `{{أبيات|...}}` "
            "in the Wikipedia article — page may have been restructured."
        )
    raw = m.group(1)
    verses: list[str] = []
    for raw_line in raw.split("\n"):
        cleaned = _clean_wiki_markup(raw_line)
        # Drop lines that no longer contain Arabic content after cleanup
        # (separator lines, leftover template fragments).
        if cleaned and any("؀" <= ch <= "ۿ" for ch in cleaned):
            verses.append(cleaned)
    return verses


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    wikitext = _fetch_wikitext()
    verses = _extract_verses(wikitext)
    log.info("download_aqidah_awam.verses_parsed", count=len(verses))
    if not verses:
        raise SystemExit("No verses extracted — aborting.")

    # Group into VERSES_PER_SECTION-line blocks. Title = "بيت N-M"
    # (verse range) so a chip can read like "Aqidat al-'Awam — بيت 6-10".
    records: list[dict[str, object]] = []
    for sec_idx, start in enumerate(range(0, len(verses), VERSES_PER_SECTION), start=1):
        chunk = verses[start : start + VERSES_PER_SECTION]
        end_v = start + len(chunk)
        title = f"بيت {start + 1}-{end_v}"
        body = "  \n".join(chunk)
        records.append({
            "section_id": sec_idx,
            "anchor": f"v{start + 1}",
            "qism": "",
            "title": title,
            "ar": body,
            "char_count": len(body),
        })

    total_chars = sum(int(r["char_count"]) for r in records)
    log.info(
        "download_aqidah_awam.done",
        verses=len(verses),
        sections=len(records),
        total_chars=total_chars,
    )

    OUTPUT_PATH.write_text(
        json.dumps(records, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    log.info("download_aqidah_awam.written", path=str(OUTPUT_PATH))


if __name__ == "__main__":
    main()
