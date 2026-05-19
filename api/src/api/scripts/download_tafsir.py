"""Download Tafsir Ibn Kathir in Arabic + English.

Source: spa5k/tafsir_api on jsdelivr (mirrors quran.com's licensed content,
free, no API key). Editions used:

    AR:  ar-tafsir-ibn-kathir         (original, Hafiz Ibn Kathir)
    EN:  en-tafisr-ibn-kathir         (abridged — Mubarakpuri's edition,
                                       note the upstream typo in 'tafisr')

URL pattern: `tafsir/{slug}/{surah}.json` — per-surah aggregated. 114
surah × 2 editions = 228 HTTP calls, vs ~6,236 × 2 = ~12,500 for the
per-ayah pattern. Same data, much cheaper to pull.

Per-surah JSON shape:
    {"ayahs": [{"surah": 1, "ayah": 1, "text": "..."}, ...]}

Some ayat have no commentary (Ibn Kathir groups some verses) — those
appear as empty `text` or are missing from the list. We save what's
there; the downstream embedder / brief writer treats empty AR/EN as
'no commentary available for this ayah from this source.'

Output: `api/data/tafsir-ibn-kathir.json` — sorted by (surah, ayah):

    [
        {"surah": 1, "ayah": 1, "ar": "...", "en": "..."},
        ...
    ]

Run:
    cd api && uv run python -m api.scripts.download_tafsir

Idempotent — re-running overwrites the file.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import httpx

CDN_BASE = "https://cdn.jsdelivr.net/gh/spa5k/tafsir_api@main/tafsir"
NUM_SURAHS = 114

# (slug, payload-key) — slug is the upstream edition identifier (preserve
# the 'tafisr' typo in the EN slug, that's the actual upstream path).
EDITIONS: list[tuple[str, str]] = [
    ("ar-tafsir-ibn-kathir", "ar"),
    ("en-tafisr-ibn-kathir", "en"),
]

OUT_DIR = Path(__file__).resolve().parents[3] / "data"
OUT_FILE = OUT_DIR / "tafsir-ibn-kathir.json"


def _fetch_surah(
    client: httpx.Client, slug: str, surah: int
) -> list[dict[str, Any]]:
    """Pull one surah's aggregated tafsir. Returns the `ayahs` list or [].

    A 404 means the upstream just doesn't have that surah in that edition —
    survivable, we move on with an empty list.
    """
    url = f"{CDN_BASE}/{slug}/{surah}.json"
    resp = client.get(url)
    if resp.status_code == 404:
        return []
    resp.raise_for_status()
    payload = resp.json()
    ayahs = payload.get("ayahs")
    return ayahs if isinstance(ayahs, list) else []


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # merged[(surah, ayah)] = {"surah": …, "ayah": …, "ar": …, "en": …}
    merged: dict[tuple[int, int], dict[str, Any]] = {}

    start = time.time()
    with httpx.Client(
        timeout=60,
        headers={"User-Agent": "DakwahLens/0.1"},
        follow_redirects=True,
    ) as client:
        for slug, key in EDITIONS:
            print(f"\n→ {slug}", flush=True)
            edition_chars = 0
            edition_ayahs = 0
            for surah in range(1, NUM_SURAHS + 1):
                ayahs = _fetch_surah(client, slug, surah)
                for a in ayahs:
                    s = int(a.get("surah", surah))
                    v = int(a["ayah"])
                    text = (a.get("text") or "").strip()
                    entry = merged.setdefault(
                        (s, v), {"surah": s, "ayah": v, "ar": "", "en": ""}
                    )
                    entry[key] = text
                    edition_chars += len(text)
                    edition_ayahs += 1
                # Tight progress signal — print every 10 surahs so a slow
                # CDN doesn't look like a hang.
                if surah % 10 == 0 or surah == NUM_SURAHS:
                    elapsed = time.time() - start
                    print(
                        f"  surah {surah:>3}/{NUM_SURAHS} · "
                        f"{edition_ayahs:,} ayat so far · "
                        f"{elapsed:.0f}s elapsed",
                        flush=True,
                    )
            mb = edition_chars / 1024 / 1024
            print(f"  ✓ {edition_ayahs:,} ayat covered ({mb:.1f} MB of text)")

    out = sorted(merged.values(), key=lambda r: (r["surah"], r["ayah"]))
    OUT_FILE.write_text(
        json.dumps(out, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    size_mb = OUT_FILE.stat().st_size / 1024 / 1024
    both = sum(1 for r in out if r["ar"] and r["en"])
    ar_only = sum(1 for r in out if r["ar"] and not r["en"])
    en_only = sum(1 for r in out if r["en"] and not r["ar"])

    print()
    print(f"✓ wrote {len(out):,} ayah-tafsir entries → {OUT_FILE.name}")
    print(f"  size           : {size_mb:.1f} MB")
    print(f"  AR + EN        : {both:,}")
    print(f"  AR only        : {ar_only:,}")
    print(f"  EN only        : {en_only:,}")
    print(f"  total elapsed  : {time.time() - start:.0f}s")


if __name__ == "__main__":
    main()
