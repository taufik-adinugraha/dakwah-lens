"""Download Tafsir al-Tabari (Jāmiʿ al-Bayān) — ARABIC only — public domain.

Sibling of `download_tafsir.py` (Ibn Kathir). al-Tabari has NO complete
English translation (only Cooper's partial vol.1, copyrighted), so this is
Arabic-only; the "Tafsir Pekan Ini" composer renders AR→ID at compose time
(the track's retrieval is a keyed (surah,ayah) lookup, so the weak-for-
semantic Arabic embedding is irrelevant — see embed_tafsir_tabari.py).

Source: spa5k/tafsir_api on jsdelivr (mirrors quran.com's free content),
edition slug `ar-tafsir-al-tabari`. URL pattern `tafsir/{slug}/{surah}.json`
→ a bare list of `{"surah","ayah","text"}` (note: al-Tabari's per-surah shape
is a plain list, NOT the `{"ayahs":[…]}` wrapper Ibn Kathir uses).

Light-clean (removes Shakir-edition muhaqqiq apparatus, NOT al-Tabari's matn):
numbered athar/narration index prefixes, parenthetical footnote-reference
digits, and في المطبوعة/المخطوطة/انظر تفسير editor notes (~2% of chars). The
isnād-condensing + skip-isrāʾīlīyyāt curation happens at compose time (the
track guardrails), not here.

Output: `api/data/tafsir-al-tabari.json`, sorted by (surah, ayah):
    [{"surah": 1, "ayah": 1, "ar": "…"}, …]

Run:
    cd api && uv run python -m api.scripts.download_tafsir_tabari
Idempotent — re-running overwrites the file.
"""

from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any

import httpx

CDN_BASE = "https://cdn.jsdelivr.net/gh/spa5k/tafsir_api@main/tafsir"
SLUG = "ar-tafsir-al-tabari"
NUM_SURAHS = 114

OUT_DIR = Path(__file__).resolve().parents[3] / "data"
OUT_FILE = OUT_DIR / "tafsir-al-tabari.json"

# Muhaqqiq apparatus strippers (see module docstring).
_RE_ATHAR_ID = re.compile(
    r"\s*\b\d{3,6}\s*-\s*(?=حَ?دَّ?ث|أَ?خْ?بَ?ر|قَ?ال|عَ?ن\b)"
)
_RE_FOOTNOTE_NUM = re.compile(r"\s*\(\s*[\d٠-٩]{1,3}\s*\)\s*")
_RE_EDITOR_NOTE = re.compile(r"(في المطبوعة|في المخطوطة|انظر تفسير)\b[^.]*?[.。]")
_RE_WS = re.compile(r"[ \t]+")


def _light_clean(text: str) -> str:
    text = _RE_ATHAR_ID.sub(" ", text)
    text = _RE_FOOTNOTE_NUM.sub(" ", text)
    text = _RE_EDITOR_NOTE.sub(" ", text)
    return _RE_WS.sub(" ", text).strip()


def _fetch_surah(client: httpx.Client, surah: int) -> list[dict[str, Any]]:
    """Pull one surah's aggregated tafsir. al-Tabari returns a bare list;
    tolerate the `{"ayahs":[…]}` shape too. 404 → empty (survivable)."""
    resp = client.get(f"{CDN_BASE}/{SLUG}/{surah}.json")
    if resp.status_code == 404:
        return []
    resp.raise_for_status()
    payload = resp.json()
    if isinstance(payload, list):
        return payload
    ayahs = payload.get("ayahs")
    return ayahs if isinstance(ayahs, list) else []


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    merged: dict[tuple[int, int], dict[str, Any]] = {}
    start = time.time()
    raw_chars = clean_chars = 0

    with httpx.Client(
        timeout=60, headers={"User-Agent": "DakwahLens/0.1"}, follow_redirects=True
    ) as client:
        for surah in range(1, NUM_SURAHS + 1):
            for a in _fetch_surah(client, surah):
                s = int(a.get("surah", surah))
                v = int(a["ayah"])
                raw = (a.get("text") or "").strip()
                raw_chars += len(raw)
                cleaned = _light_clean(raw)
                clean_chars += len(cleaned)
                merged[(s, v)] = {"surah": s, "ayah": v, "ar": cleaned}
            if surah % 10 == 0 or surah == NUM_SURAHS:
                print(
                    f"  surah {surah:>3}/{NUM_SURAHS} · {len(merged):,} ayat · "
                    f"{time.time() - start:.0f}s",
                    flush=True,
                )

    out = sorted(merged.values(), key=lambda r: (r["surah"], r["ayah"]))
    OUT_FILE.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")

    removed = raw_chars - clean_chars
    pct = (removed / raw_chars * 100) if raw_chars else 0.0
    print()
    print(f"✓ wrote {len(out):,} ayah-tafsir entries → {OUT_FILE.name}")
    print(f"  size          : {OUT_FILE.stat().st_size / 1024 / 1024:.1f} MB")
    print(f"  raw → clean   : {raw_chars:,} → {clean_chars:,} chars "
          f"(stripped {removed:,} = {pct:.1f}% apparatus)")
    print(f"  elapsed       : {time.time() - start:.0f}s")
    if len(out) < 6000:
        print(f"  ⚠️ only {len(out)} verses — expected ~6,236; check the CDN shape.")


if __name__ == "__main__":
    main()
