"""Loader + lookahead for the Islamic-calendar occasion catalog.

Reads ``api/data/hijri_occasions.yaml`` at module import. Exposes:

  - ``OCCASIONS``        — list[OccasionEntry] in source order
  - ``get_by_slug(slug)``  → OccasionEntry | None
  - ``upcoming(now, lookahead_days)`` → list[OccasionEntry] whose
    Gregorian date falls in [now, now + lookahead_days], sorted asc.

The catalog is hand-curated; entries that haven't been confirmed against
Kemenag SKB ship with ``confirmed: false`` and an approximate
``gregorian_date``. The 14-day lookahead window absorbs the ±1-2 day
rukyat drift on month-start days.

Used by:
  - ``api.workers.occasion_cron``         — Sunday 05:00 WIB cron lookup
  - ``api.services.kitab_retrieval.retrieve_occasion_daleel`` — query template
  - ``api.scripts.manual_briefing``       — operator ``dump <slug>`` cmd
  - ``api.services.briefing``             — occasion-mode prompt assembly
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, ConfigDict


class OccasionEntry(BaseModel):
    """One entry from hijri_occasions.yaml. Slugs are stable IDs; never
    rename a slug that's already in prod — the slug is the dedupe key
    + URL path component."""

    model_config = ConfigDict(extra="forbid")

    slug: str
    name: str
    hijri_year: int
    hijri_date: str
    gregorian_date: date
    query_template: str
    include_trending_headlines: bool = True
    confirmed: bool = False
    notes: str | None = None


# Resolve catalog path from this file's location:
#   .../api/src/api/services/occasion_catalog.py  →  .../api/src/api/catalogs/hijri_occasions.yaml
# 2 .parent hops (services → api package root) then /catalogs/hijri_occasions.yaml.
# Lives INSIDE the api package as a sibling of services/. Chose `catalogs/`
# instead of `data/` because the repo .gitignore has a bare `data/` rule
# that would otherwise exclude this file. catalogs/ ships with the wheel.
_CATALOG_PATH = (
    Path(__file__).resolve().parent.parent
    / "catalogs"
    / "hijri_occasions.yaml"
)


def _load_catalog() -> list[OccasionEntry]:
    if not _CATALOG_PATH.exists():
        return []
    raw: dict[str, Any] | None = yaml.safe_load(_CATALOG_PATH.read_text(encoding="utf-8"))
    if not raw or "occasions" not in raw:
        return []
    return [OccasionEntry(**entry) for entry in raw["occasions"]]


OCCASIONS: list[OccasionEntry] = _load_catalog()


def get_by_slug(slug: str) -> OccasionEntry | None:
    """Lookup by stable slug. Returns None if not found."""
    for o in OCCASIONS:
        if o.slug == slug:
            return o
    return None


def upcoming(
    now: date | datetime | None = None,
    lookahead_days: int = 14,
) -> list[OccasionEntry]:
    """Return occasions whose gregorian_date falls in
    [now, now + lookahead_days], sorted ascending by date.

    ``now=None`` defaults to today (WIB observer perspective is fine —
    the 14-day window is generous). Pass a ``datetime`` and it's
    truncated to date.
    """
    if now is None:
        now = date.today()
    elif isinstance(now, datetime):
        now = now.date()
    cutoff = now + timedelta(days=lookahead_days)
    matches = [o for o in OCCASIONS if now <= o.gregorian_date <= cutoff]
    return sorted(matches, key=lambda o: o.gregorian_date)
