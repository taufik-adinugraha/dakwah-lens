"""Download hadith collections in Arabic + English.

Sources (all free, no API key, public CDN):
  - fawazahmed0/hadith-api — Sahih al-Bukhari, Sahih Muslim
      AR + EN as separate editions, merged by `hadithnumber`.
  - AhmedBaset/hadith-json — Riyad as-Salihin
      AR + EN in a single combined file under `other_books/`.

The two sources use different JSON shapes, so we dispatch per collection.

Numbering follows the sunnah.com convention (so "Sahih al-Bukhari 6502"
maps 1:1 to the row with `hadithnumber=6502`). Indonesian translations
are not on these CDNs — AR + EN only for now per spec.

Output: one JSON file per collection in `api/data/`. Each entry shape:

    {
        "collection": "bukhari",
        "hadithnumber": 1,
        "in_book_number": 1,
        "book": 1,
        "ar": "حدثنا الحميدي ...",
        "en": "Narrated 'Umar bin Al-Khattab: ...",
        "grades": ["Sahih"],
        "citation_en": "Sahih al-Bukhari 1"
    }

Run:
    cd api && uv run python -m api.scripts.download_hadith

Idempotent — re-running overwrites the JSON files.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx

FAWAZAHMED_BASE = "https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions"
AHMEDBASET_BASE = "https://cdn.jsdelivr.net/gh/AhmedBaset/hadith-json@main/db/by_book"

# One entry per output file. `source` selects the parser branch.
COLLECTIONS: list[dict[str, Any]] = [
    {
        "source": "fawazahmed0",
        "slug": "bukhari",
        "filename": "bukhari.json",
        "citation_prefix": "Sahih al-Bukhari",
    },
    {
        "source": "fawazahmed0",
        "slug": "muslim",
        "filename": "muslim.json",
        "citation_prefix": "Sahih Muslim",
    },
    {
        "source": "ahmedbaset",
        "slug": "riyad-as-salihin",
        "path": "other_books/riyad_assalihin.json",
        "filename": "riyad-as-salihin.json",
        "citation_prefix": "Riyad as-Salihin",
    },
    {
        "source": "ahmedbaset",
        "slug": "bulugh-al-maram",
        "path": "other_books/bulugh_almaram.json",
        "filename": "bulugh-al-maram.json",
        "citation_prefix": "Bulugh al-Maram",
    },
]

OUT_DIR = Path(__file__).resolve().parents[3] / "data"


def _fetch_json(client: httpx.Client, url: str) -> dict[str, Any]:
    print(f"  → {url}", flush=True)
    resp = client.get(url)
    resp.raise_for_status()
    return resp.json()


def _from_fawazahmed(
    client: httpx.Client, slug: str, citation_prefix: str
) -> list[dict[str, Any]]:
    """Pull `ara-<slug>` and `eng-<slug>` editions and merge by `hadithnumber`.

    The two editions are aligned by number on this CDN — defensive merge
    still covers the rare gap (recorded with empty string).
    """
    ar_payload = _fetch_json(client, f"{FAWAZAHMED_BASE}/ara-{slug}.json")
    en_payload = _fetch_json(client, f"{FAWAZAHMED_BASE}/eng-{slug}.json")
    ar_rows = ar_payload.get("hadiths") or []
    en_rows = en_payload.get("hadiths") or []
    if not isinstance(ar_rows, list) or not isinstance(en_rows, list):
        raise RuntimeError(
            f"Unexpected payload shape for {slug!r}: `hadiths` is not a list"
        )

    by_num: dict[int, dict[str, Any]] = {}
    for row in ar_rows:
        num = row.get("hadithnumber")
        if num is None:
            continue
        ref = row.get("reference") or {}
        by_num[int(num)] = {
            "collection": slug,
            "hadithnumber": int(num),
            "ar": row.get("text", ""),
            "in_book_number": ref.get("hadith"),
            "book": ref.get("book"),
            "grades": [
                g.get("grade") for g in (row.get("grades") or []) if g.get("grade")
            ],
        }

    for row in en_rows:
        num = row.get("hadithnumber")
        if num is None:
            continue
        entry = by_num.get(int(num))
        if entry is None:
            ref = row.get("reference") or {}
            entry = {
                "collection": slug,
                "hadithnumber": int(num),
                "ar": "",
                "in_book_number": ref.get("hadith"),
                "book": ref.get("book"),
                "grades": [],
            }
            by_num[int(num)] = entry
        entry["en"] = row.get("text", "")

    for entry in by_num.values():
        entry.setdefault("en", "")
        entry["citation_en"] = f"{citation_prefix} {entry['hadithnumber']}"

    return sorted(by_num.values(), key=lambda r: r["hadithnumber"])


def _from_ahmedbaset(
    client: httpx.Client, path: str, slug: str, citation_prefix: str
) -> list[dict[str, Any]]:
    """Pull a single combined AR+EN file.

    English is stored as a nested object `{narrator, text}` — we splice it
    back into a single string so the downstream format matches the
    fawazahmed0 path. Arabic is flat.
    """
    payload = _fetch_json(client, f"{AHMEDBASET_BASE}/{path}")
    hadiths = payload.get("hadiths") or []
    if not isinstance(hadiths, list):
        raise RuntimeError(f"Unexpected payload shape at {path!r}")

    out: list[dict[str, Any]] = []
    for h in hadiths:
        en_obj = h.get("english")
        if isinstance(en_obj, dict):
            narrator = (en_obj.get("narrator") or "").strip()
            text = (en_obj.get("text") or "").strip()
            en_text = f"{narrator}\n{text}".strip() if narrator else text
        elif isinstance(en_obj, str):
            en_text = en_obj
        else:
            en_text = ""

        num = h.get("idInBook")
        if num is None:
            continue
        out.append(
            {
                "collection": slug,
                "hadithnumber": int(num),
                "in_book_number": int(num),
                "book": h.get("chapterId"),
                "ar": h.get("arabic", "") or "",
                "en": en_text,
                "grades": [],
                "citation_en": f"{citation_prefix} {num}",
            }
        )
    return sorted(out, key=lambda r: r["hadithnumber"])


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    with httpx.Client(
        timeout=180,
        headers={"User-Agent": "DakwahLens/0.1"},
        follow_redirects=True,
    ) as client:
        for cfg in COLLECTIONS:
            print(f"\n→ {cfg['citation_prefix']} ({cfg['slug']})")
            if cfg["source"] == "fawazahmed0":
                rows = _from_fawazahmed(
                    client, cfg["slug"], cfg["citation_prefix"]
                )
            elif cfg["source"] == "ahmedbaset":
                rows = _from_ahmedbaset(
                    client, cfg["path"], cfg["slug"], cfg["citation_prefix"]
                )
            else:
                raise RuntimeError(f"Unknown source: {cfg['source']!r}")

            out_path = OUT_DIR / cfg["filename"]
            out_path.write_text(
                json.dumps(rows, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            size_mb = out_path.stat().st_size / 1024 / 1024
            both = sum(1 for r in rows if r["ar"] and r["en"])
            missing_ar = sum(1 for r in rows if not r["ar"])
            missing_en = sum(1 for r in rows if not r["en"])
            print(
                f"  ✓ {len(rows):,} hadith → {out_path.name} "
                f"(~{size_mb:.1f} MB, {both:,} with both AR+EN)"
            )
            if missing_ar or missing_en:
                print(
                    f"    ⚠ missing translations: {missing_ar} AR, "
                    f"{missing_en} EN — these rows saved with empty strings"
                )


if __name__ == "__main__":
    main()
