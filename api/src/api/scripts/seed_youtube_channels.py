"""One-off seed for the `youtube_channels` table.

Each entry is a (display_name_query, category) pair. The script resolves
each display name to a YT channel_id via YouTube Data API `search.list`
(type=channel), prints the resolved channel for spot-checking, then
upserts into the table. Re-runnable: skips entries whose `channel_id`
already exists.

Quota cost: ~100 units per *new* channel resolved (search.list).
Resolving all 83 seeds from scratch ≈ 8,300 units — one-time burn,
fits in the 10K/day free tier.

    uv run python -m api.scripts.seed_youtube_channels

Add new channels by appending to SEED_CHANNELS below and re-running.
The admin UI at /admin/system/youtube-channels is the everyday tool;
this script is only for bulk seeding.
"""

from __future__ import annotations

import asyncio
import sys

import httpx
from sqlalchemy import select

from api.config import settings
from api.db import SessionLocal
from api.models.admin import YoutubeChannel

# Curated by Taufik on 2026-05-20. 8 buckets; current_events dropped after
# observing Najwa/Narasi/Watchdoc in social_justice already cover that beat.
SEED_CHANNELS: list[tuple[str, str]] = [
    # ── Religious / Dakwah (12) ────────────────────────────────────────
    ("Adi Hidayat Official", "religious"),
    ("Ustadz Abdul Somad Official", "religious"),
    ("Khalid Basalamah Official", "religious"),
    ("Al-Bahjah TV Buya Yahya", "religious"),
    ("Yufid.TV", "religious"),
    ("Felix Siauw", "religious"),
    ("Syafiq Riza Basalamah Official", "religious"),
    ("Habib Novel Alaydrus", "religious"),
    ("Hanan Attaki Lentera Project", "religious"),
    ("NU Online", "religious"),
    ("Gus Iqdam Sabilu Taubah", "religious"),
    ("Gus Muwafiq Channel", "religious"),
    # ── Family / Vlog Keluarga (9) ─────────────────────────────────────
    ("Rans Entertainment", "family"),
    ("AH Atta Halilintar", "family"),
    ("Ricis Official", "family"),
    ("Gen Halilintar", "family"),
    ("The Sungkars Family", "family"),
    ("Aurel Hermansyah", "family"),
    ("SAAIHALILINTAR", "family"),
    ("Anneth Delliecia", "family"),
    ("Onad Vlog", "family"),
    # ── Youth / Podcast / Lifestyle (11) ───────────────────────────────
    ("Deddy Corbuzier", "youth"),
    ("Raditya Dika", "youth"),
    ("VINDES Vincent Desta", "youth"),
    ("Curhat Bang Denny Sumargo", "youth"),
    ("Satu Persen Indonesian Life School", "youth"),
    ("Rintik Sedu", "youth"),
    ("Raymond Chin", "youth"),
    ("Pandji Pragiwaksono", "youth"),
    ("Boy William", "youth"),
    ("Maell Lee Arif Muhammad", "youth"),
    ("Cinta Laura Kiehl", "youth"),
    # ── Muamalah (10) ──────────────────────────────────────────────────
    ("Yufid Edu", "muamalah"),
    ("Masyarakat Ekonomi Syariah", "muamalah"),
    ("Rumah Fiqih Indonesia", "muamalah"),
    ("Bimbingan Islam", "muamalah"),
    ("dr Erwandi Tarmizi", "muamalah"),
    ("Ammar TV", "muamalah"),
    ("Sunnah Channel", "muamalah"),
    ("Bayt Al-Hikmah Bayt Al-Quran", "muamalah"),
    ("Muamalah Daily", "muamalah"),
    ("KEUSY OJK Syariah", "muamalah"),
    # ── Social Justice / Accountability (12) ───────────────────────────
    ("Najwa Shihab Mata Najwa", "social_justice"),
    ("Narasi", "social_justice"),
    ("Narasi Newsroom", "social_justice"),
    ("Watchdoc Documentary", "social_justice"),
    ("Asumsi", "social_justice"),
    ("Bossman Mardigu TS Media", "social_justice"),
    ("Refly Harun", "social_justice"),
    ("Total Politik", "social_justice"),
    ("Pinter Politik", "social_justice"),
    ("Bocor Alus Politik Tempo", "social_justice"),
    ("KontraS", "social_justice"),
    ("Magdalene", "social_justice"),
    # ── Health (11) ────────────────────────────────────────────────────
    ("dr Richard Lee MARS", "health"),
    ("Tirta PengPengPeng", "health"),
    ("dr Sung", "health"),
    ("SB30 Health", "health"),
    ("Saddam Ismail", "health"),
    ("dr Gia Pratama", "health"),
    ("Mata Dokter", "health"),
    ("Ade Rai", "health"),
    ("Yulia Baltschun", "health"),
    ("Emasuperr", "health"),
    ("dr Frieda", "health"),
    # ── Education / Edukasi (11) ───────────────────────────────────────
    ("Ruangguru", "education"),
    ("Malaka Project", "education"),
    ("Kok Bisa", "education"),
    ("Guru Gembul", "education"),
    ("Ferry Irwandi", "education"),
    ("Sepulang Sekolah", "education"),
    ("Kamu Harus Tahu KHT", "education"),
    ("Sains Bro", "education"),
    ("Kontekstual", "education"),
    ("Cania Citta Irlanie", "education"),
    ("Makin Pandai", "education"),
    # ── Cultural / Budaya & Travel (7) ─────────────────────────────────
    ("IndonesiaKaya Galeri Indonesia Kaya", "cultural"),
    ("KEMENBUD", "cultural"),
    ("Kanal Budaya Indonesia", "cultural"),
    ("Rumah Budaya Indonesia", "cultural"),
    ("Warisan Budaya Indonesia", "cultural"),
    ("Farida Nurhan", "cultural"),
    ("Ki Seno Nugroho Wayang", "cultural"),
]


_YT_SEARCH = "https://www.googleapis.com/youtube/v3/search"


def resolve_channel(query: str, api_key: str) -> dict[str, str] | None:
    """Search YT for `query` filtered to channels; return the top hit's
    id + display name + handle (if any). Returns None when no match.
    """
    with httpx.Client(timeout=15) as client:
        resp = client.get(
            _YT_SEARCH,
            params={
                "part": "snippet",
                "q": query,
                "type": "channel",
                "maxResults": 1,
                "regionCode": "ID",
                "relevanceLanguage": "id",
                "key": api_key,
            },
        )
        resp.raise_for_status()
        payload = resp.json()
    items = payload.get("items", [])
    if not items:
        return None
    top = items[0]
    channel_id = top["snippet"].get("channelId") or top["id"].get("channelId")
    if not channel_id:
        return None
    snippet = top.get("snippet") or {}
    return {
        "channel_id": channel_id,
        "name": snippet.get("title") or query,
        "handle": (snippet.get("customUrl") or "").lstrip("@") or None,
    }


async def main() -> None:
    if not settings.youtube_api_key:
        print("✗ YOUTUBE_API_KEY is not set. Aborting.", file=sys.stderr)
        sys.exit(1)

    async with SessionLocal() as session:
        existing = {
            row[0]
            for row in (await session.execute(select(YoutubeChannel.channel_id))).all()
        }
        existing_names = {
            row[0]
            for row in (await session.execute(select(YoutubeChannel.name))).all()
        }
        added = 0
        skipped_already_seeded = 0
        not_found: list[str] = []

        for query, category in SEED_CHANNELS:
            # Skip if a same-name row exists (cheap dedup before paying YT
            # quota — re-runs after partial failures shouldn't re-search).
            if query in existing_names:
                skipped_already_seeded += 1
                continue

            try:
                resolved = resolve_channel(query, settings.youtube_api_key)
            except httpx.HTTPError as exc:
                print(f"  ✗ {query!r} HTTP error: {exc}", file=sys.stderr)
                not_found.append(query)
                continue

            if resolved is None:
                print(f"  ⚠ {query!r} — no channel match")
                not_found.append(query)
                continue

            if resolved["channel_id"] in existing:
                print(
                    f"  · {query!r} → {resolved['name']!r} "
                    f"({resolved['channel_id']}) — already in DB, skipping"
                )
                skipped_already_seeded += 1
                continue

            session.add(
                YoutubeChannel(
                    channel_id=resolved["channel_id"],
                    name=resolved["name"],
                    handle=resolved["handle"],
                    category=category,
                    enabled=True,
                )
            )
            existing.add(resolved["channel_id"])
            added += 1
            print(
                f"  ✓ {query!r} → {resolved['name']!r} "
                f"({resolved['channel_id']}) [{category}]"
            )

        await session.commit()

        print()
        print(f"✓ Added {added} new channel(s).")
        print(f"  Already seeded: {skipped_already_seeded}")
        if not_found:
            print(f"  Unresolved ({len(not_found)}): {not_found}")
            print(
                "    → spot-check the queries above; add a more specific "
                "query string (e.g. with the official handle)."
            )


if __name__ == "__main__":
    asyncio.run(main())
