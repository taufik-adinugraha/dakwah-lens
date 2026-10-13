"""Which platforms are fetched: the schedule, the trending fan-out and the
site's own statement must agree.

Operator, 2026-10-13: "we will also disable X for now, and we need to show
the info in the web, so now X, IG, FB etc are not fetched, only youtube and
mainstream media."

The fact lives in three places — the Celery beat schedule, the trending
overlay's fan-out, and web/src/lib/ingest-status.ts, which the public pages
read. Each is a separate copy, and separate copies of one rule drift (the
recurring manual/auto parity class). This test fails when one of them is
changed without the others: resume a platform in all three, then update the
expectations here.
"""

from __future__ import annotations

import re
from pathlib import Path

from api.workers import ingest
from api.workers.celery_app import celery_app

REPO = Path(__file__).resolve().parents[2]
SOCIAL = {"x", "instagram", "tiktok", "facebook", "youtube"}


def _web_list(name: str) -> set[str]:
    """One `export const NAME = [...] as const` list of ingest-status.ts."""
    src = (REPO / "web/src/lib/ingest-status.ts").read_text(encoding="utf-8")
    m = re.search(rf"export const {name} = \[([^\]]*)\] as const", src)
    assert m, f"{name} not found in web/src/lib/ingest-status.ts"
    return set(re.findall(r'"([a-z]+)"', m.group(1)))


def _scheduled_platforms() -> set[str]:
    """The social platforms some beat entry fetches."""
    out: set[str] = set()
    for entry in celery_app.conf.beat_schedule.values():
        task = entry["task"].rsplit(".", 1)[-1]
        platform = (entry.get("kwargs") or {}).get("platform")
        if task in {"run_ingest", "rotating_ingest"} and platform in SOCIAL:
            out.add(platform)
        elif task == "youtube_channels_ingest":
            out.add("youtube")
        elif task == "trending_ingest":
            out.update(ingest.TRENDING_PLATFORMS)
    return out


def test_only_youtube_is_fetched_among_social_platforms() -> None:
    assert _scheduled_platforms() == {"youtube"}


def test_trending_overlay_does_not_fan_out_to_x() -> None:
    assert "x" not in ingest.TRENDING_PLATFORMS
    assert ingest.TRENDING_PLATFORMS == ("youtube",)


def test_mainstream_rss_still_runs() -> None:
    platforms = {
        (e.get("kwargs") or {}).get("platform")
        for e in celery_app.conf.beat_schedule.values()
    }
    assert "mainstream" in platforms


def test_the_site_states_what_the_schedule_does() -> None:
    active = _web_list("ACTIVE_SOCIAL_PLATFORMS")
    paused = _web_list("PAUSED_PLATFORMS")
    assert active == _scheduled_platforms()
    assert paused == SOCIAL - active
    assert not active & paused
