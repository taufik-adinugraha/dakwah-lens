"""Download hadith collections in Arabic + English.

Sources (all free, no API key, public CDN):
  - fawazahmed0/hadith-api — Sahih al-Bukhari, Sahih Muslim
      AR + EN as separate editions, merged by `hadithnumber`.
  - AhmedBaset/hadith-json — Riyad as-Salihin
      AR + EN in a single combined file under `other_books/`.

The two sources use different JSON shapes, so we dispatch per collection.

Numbering is normalized to sunnah.com / canonical scholarly references:
  - Sahih al-Bukhari: fawazahmed0 `hadithnumber` already matches sunnah.com.
  - Sahih Muslim: fawazahmed0 `hadithnumber` is internal sequential and
    does NOT match sunnah.com. We remap to the canonical Fuad Abdul Baqi
    `arabicnumber` from the same source — "Sahih Muslim 1130c" style
    (sub-letter a/b/c for multi-chain variants of one hadith number).
  - Riyad as-Salihin: AhmedBaset orders chapters [1..19, 0] but
    sunnah.com canonical puts Muqaddimat (chapter 0) first — we remap
    via offset (chapter 0: idInBook - 1217; chapters 1-19: idInBook + 679).
  - Bulugh al-Maram: NOT yet remapped — its AhmedBaset numbering inflates
    canonical by ~170 entries (takhrij/annotation fragments treated as
    standalone hadiths). Deferred to a dedicated migration that uses the
    sunnah.com API to collapse sub-letter variants properly.
Indonesian translations are not on these CDNs — AR + EN only for now.

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
    arabic_numbers: dict[int, str] = {}
    for row in ar_rows:
        num = row.get("hadithnumber")
        if num is None:
            continue
        ref = row.get("reference") or {}
        an = row.get("arabicnumber")
        if an is not None:
            arabic_numbers[int(num)] = str(an).strip()
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

    # Citation strategy: for Muslim, fawazahmed0's `hadithnumber` is
    # their internal sequential (1-7563) and doesn't match sunnah.com /
    # standard scholarly references. The same source exposes
    # `arabicnumber` (Fuad Abdul Baqi numbering) which IS canonical.
    # Build "Sahih Muslim 1130c" style citations (with a/b/c sub-letters
    # when the source row carries a "1130.03"-style decimal).
    # Bukhari `hadithnumber` already matches sunnah.com, so no remap.
    use_canonical = slug == "muslim"
    for entry in by_num.values():
        entry.setdefault("en", "")
        if use_canonical:
            an = arabic_numbers.get(entry["hadithnumber"])
            entry["citation_en"] = _muslim_canonical_citation(
                citation_prefix, entry["hadithnumber"], an
            )
        else:
            entry["citation_en"] = f"{citation_prefix} {entry['hadithnumber']}"

    return sorted(by_num.values(), key=lambda r: r["hadithnumber"])


def _muslim_canonical_citation(
    prefix: str, hadithnumber: int, arabicnumber: str | None
) -> str:
    """Translate fawazahmed0 `arabicnumber` (Fuad Abdul Baqi, like
    "1130" or "1130.03") to sunnah.com display ("Sahih Muslim 1130" or
    "Sahih Muslim 1130c"). Falls back to fawazahmed0 hadithnumber when
    arabicnumber is absent (~344 entries in the source).
    """
    if not arabicnumber:
        return f"{prefix} {hadithnumber}"
    if "." not in arabicnumber:
        return f"{prefix} {arabicnumber}"
    head, _, tail = arabicnumber.partition(".")
    try:
        sub = int(tail)
    except ValueError:
        return f"{prefix} {arabicnumber}"
    if sub == 0:
        return f"{prefix} {head}"
    if 1 <= sub <= 26:
        letter = chr(ord("a") + sub - 1)
        return f"{prefix} {head}{letter}"
    return f"{prefix} {head}.{sub:02d}"


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
        chapter_id = h.get("chapterId")
        # Riyad as-Salihin remap: AhmedBaset orders chapters [1..19, 0]
        # with chapter 0 (Muqaddimat, 679 hadiths) last — idInBook
        # 1218-1896. Sunnah.com canonical orders [0, 1..19] with
        # Muqaddimat first (canonical 1-679, then chapters 1-19 at
        # canonical 680-1896). Bulugh al-Maram is NOT remapped here —
        # its AhmedBaset numbering doesn't cleanly map to sunnah.com's
        # sub-letter convention, deferred to a dedicated migration with
        # the sunnah.com API.
        if slug == "riyad-as-salihin" and chapter_id is not None:
            canonical = (
                int(num) - 1217 if int(chapter_id) == 0 else int(num) + 679
            )
            citation_en = f"{citation_prefix} {canonical}"
        else:
            citation_en = f"{citation_prefix} {num}"
        out.append(
            {
                "collection": slug,
                "hadithnumber": int(num),
                "in_book_number": int(num),
                "book": chapter_id,
                "ar": h.get("arabic", "") or "",
                "en": en_text,
                "grades": [],
                "citation_en": citation_en,
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
