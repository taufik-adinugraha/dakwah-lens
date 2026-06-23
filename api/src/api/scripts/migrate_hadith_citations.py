"""One-off migration: rewrite citation_id/citation_en in Qdrant for the
Muslim and Riyad as-Salihin collections to match sunnah.com / canonical
scholarly numbering.

Background — the original `download_hadith.py` used each source's internal
sequential `hadithnumber`. For Bukhari that already matched sunnah.com,
but for Muslim and Riyad it didn't:

  - Sahih Muslim: fawazahmed0 sequential (1-7563) vs sunnah.com /
    Fuad Abdul Baqi (1-1907 with sub-letter chain variants). Example:
    our "Sahih Muslim 2668" (Salama bin al-Akwa' Asyura announcement)
    is canonical "Sahih Muslim 1135".

  - Riyad as-Salihin: AhmedBaset orders chapters [1..19, 0] putting the
    Muqaddimat (chapter 0, 679 hadiths) LAST in their idInBook sequence.
    Sunnah.com canonical puts Muqaddimat first. Example: our
    "Riyad as-Salihin 572" (Ibn Abbas Asyura) is canonical
    "Riyad as-Salihin 1251".

Bulugh al-Maram is NOT migrated here — its AhmedBaset source inflates
the canonical count by ~170 takhrij/annotation entries treated as
standalone hadiths. Sunnah.com's Bulugh pages are AJAX-loaded so a
clean canonical scrape needs sunnah.com API access. Tracked as a
deferred TODO; see download_hadith.py module docstring.

This script is idempotent — re-running on already-canonical payloads
detects the no-op and skips.

Usage:
    uv run python -m api.scripts.migrate_hadith_citations
"""

from __future__ import annotations

import os
import sys
from typing import Any

import httpx
from qdrant_client import QdrantClient
from qdrant_client.models import Filter, FieldCondition, MatchValue

FAWAZAHMED_BASE = "https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions"
AHMEDBASET_BASE = "https://cdn.jsdelivr.net/gh/AhmedBaset/hadith-json@main/db/by_book"


def _muslim_canonical(arabicnumber: str | None, fallback_hadithnumber: int) -> str:
    """Translate fawazahmed0 arabicnumber to sunnah.com format.

    "1135"     -> "Sahih Muslim 1135"
    "1130.03"  -> "Sahih Muslim 1130c"   (3rd chain of hadith 1130)
    None       -> "Sahih Muslim {hadithnumber}"  (fallback, ~344 entries)
    """
    if not arabicnumber:
        return f"Sahih Muslim {fallback_hadithnumber}"
    s = str(arabicnumber).strip()
    if "." not in s:
        return f"Sahih Muslim {s}"
    head, _, tail = s.partition(".")
    try:
        sub = int(tail)
    except ValueError:
        return f"Sahih Muslim {s}"
    if sub == 0:
        return f"Sahih Muslim {head}"
    if 1 <= sub <= 26:
        return f"Sahih Muslim {head}{chr(ord('a') + sub - 1)}"
    return f"Sahih Muslim {head}.{sub:02d}"


def migrate_muslim(qc: QdrantClient) -> dict[str, int]:
    print("Fetching fawazahmed0 ara-muslim.json...")
    with httpx.Client(timeout=120) as c:
        src: dict[str, Any] = c.get(f"{FAWAZAHMED_BASE}/ara-muslim.json").json()

    canonical_by_hn: dict[int, str] = {}
    for h in src.get("hadiths", []):
        hn = h.get("hadithnumber")
        if hn is None:
            continue
        canonical_by_hn[int(hn)] = _muslim_canonical(h.get("arabicnumber"), int(hn))
    print(f"  built {len(canonical_by_hn)} canonical mappings")

    stats = {"total": 0, "updated": 0, "skipped": 0, "errors": 0}
    offset = None
    while True:
        pts, next_offset = qc.scroll(
            collection_name="muslim",
            limit=500,
            offset=offset,
            with_payload=True,
        )
        if not pts:
            break
        for p in pts:
            stats["total"] += 1
            hn = p.payload.get("hadithnumber") if p.payload else None
            if hn is None:
                stats["errors"] += 1
                continue
            new_cit = canonical_by_hn.get(int(hn))
            if not new_cit:
                stats["errors"] += 1
                continue
            if p.payload.get("citation_id") == new_cit:
                stats["skipped"] += 1
                continue
            qc.set_payload(
                collection_name="muslim",
                payload={"citation_id": new_cit, "citation_en": new_cit},
                points=[p.id],
                wait=False,
            )
            stats["updated"] += 1
        if next_offset is None:
            break
        offset = next_offset
    return stats


def _riyad_canonical(chapter_id: int, id_in_book: int) -> int:
    """AhmedBaset orders chapters [1..19, 0]; sunnah.com starts at 0
    (Muqaddimat, 679 hadiths) then chapters 1-19.

      chapter 0:  idInBook 1218-1896 -> canonical 1-679
      chapters 1-19: idInBook 1-1217 -> canonical 680-1896
    """
    return id_in_book - 1217 if chapter_id == 0 else id_in_book + 679


def migrate_riyad(qc: QdrantClient) -> dict[str, int]:
    print("Fetching AhmedBaset riyad_assalihin.json...")
    with httpx.Client(timeout=120) as c:
        src: dict[str, Any] = c.get(
            f"{AHMEDBASET_BASE}/other_books/riyad_assalihin.json"
        ).json()

    chap_by_inbook: dict[int, int] = {
        int(h["idInBook"]): int(h["chapterId"]) for h in src.get("hadiths", [])
    }
    print(f"  built {len(chap_by_inbook)} (idInBook -> chapterId) mappings")

    stats = {"total": 0, "updated": 0, "skipped": 0, "errors": 0}
    offset = None
    while True:
        pts, next_offset = qc.scroll(
            collection_name="riyad_as_salihin",
            limit=500,
            offset=offset,
            with_payload=True,
        )
        if not pts:
            break
        for p in pts:
            stats["total"] += 1
            hn = p.payload.get("hadithnumber") if p.payload else None
            if hn is None:
                stats["errors"] += 1
                continue
            cid = chap_by_inbook.get(int(hn))
            if cid is None:
                stats["errors"] += 1
                continue
            new_num = _riyad_canonical(cid, int(hn))
            new_cit = f"Riyad as-Salihin {new_num}"
            if p.payload.get("citation_en") == new_cit:
                stats["skipped"] += 1
                continue
            qc.set_payload(
                collection_name="riyad_as_salihin",
                payload={"citation_id": new_cit, "citation_en": new_cit},
                points=[p.id],
                wait=False,
            )
            stats["updated"] += 1
        if next_offset is None:
            break
        offset = next_offset
    return stats


def main() -> int:
    qdrant_url = os.environ.get("QDRANT_URL")
    if not qdrant_url:
        print("ERROR: QDRANT_URL not set", file=sys.stderr)
        return 1
    qc = QdrantClient(url=qdrant_url)

    print("=== Sahih Muslim canonical-citation migration ===")
    muslim_stats = migrate_muslim(qc)
    print(f"  {muslim_stats}")

    print()
    print("=== Riyad as-Salihin canonical-citation migration ===")
    riyad_stats = migrate_riyad(qc)
    print(f"  {riyad_stats}")

    print()
    print("Verify spot-checks:")
    for col, hn, expected in [
        ("muslim", 2668, "Sahih Muslim 1135"),
        ("muslim", 2658, "Sahih Muslim 1130c"),
        ("riyad_as_salihin", 572, "Riyad as-Salihin 1251"),
    ]:
        pts = qc.scroll(
            collection_name=col,
            limit=1,
            scroll_filter=Filter(
                must=[FieldCondition(key="hadithnumber", match=MatchValue(value=hn))]
            ),
            with_payload=True,
        )[0]
        actual = pts[0].payload.get("citation_id") if pts else "<NOT FOUND>"
        ok = "OK " if actual == expected else "FAIL"
        print(f"  [{ok}] {col} hadithnumber={hn}: {actual!r} (expected {expected!r})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
