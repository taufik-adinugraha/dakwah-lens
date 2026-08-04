"""Loader + lookahead for the Indonesian national-occasion catalog.

Gregorian-calendar sibling of ``occasion_catalog.py`` (which is Hijri-only).
Reads ``api/src/api/catalogs/national_occasions.yaml`` at module import.
Exposes:

  - ``NATIONAL_OCCASIONS``          — list[NationalOccasionEntry] in source order
  - ``get_national_by_slug(slug)``  → NationalOccasionEntry | None
  - ``national_upcoming(now, lookahead_days)`` → list[NationalOccasionEntry]
    whose Gregorian date falls in [now, now + lookahead_days], sorted asc.

Unlike the Hijri catalog these dates are FIXED civil dates (17 Agustus,
Hari Santri 22 Oktober, etc.) — no rukyat drift, so ``confirmed`` defaults
True and there are no ``hijri_year`` / ``hijri_date`` fields.

The two catalogs are kept as separate models + loaders on purpose: the
Hijri occasion pipeline is live in prod, and a shared/generalized model
would risk a national entry validating as Hijri (or vice-versa). The
downstream briefing pipeline (daleel retrieval, prompt, validators, full
weekly deliverable set incl. flyers) is calendar-agnostic and reused via
sibling functions (``retrieve_national_daleel``, ``NATIONAL_SYSTEM_PROMPT_ID``,
``_build_national_user_prompt``, ``scan_national_section_structure``).

Used by:
  - ``api.services.kitab_retrieval.retrieve_national_daleel`` — query template
  - ``api.scripts.manual_briefing``  — operator ``dump-national`` / ``save-national``
  - ``api.services.briefing``        — national-mode prompt assembly
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, ConfigDict


class NationalOccasionEntry(BaseModel):
    """One entry from national_occasions.yaml. Slugs are stable IDs; never
    rename a slug that's already in prod — the slug is the dedupe key
    + URL path component (shares the ``occasion_slug`` column).

    No Hijri fields: national days are fixed Gregorian civil dates.
    ``confirmed`` defaults True for the same reason (nothing to verify
    against a Kemenag SKB rukyat notice)."""

    model_config = ConfigDict(extra="forbid")

    slug: str
    name: str
    gregorian_date: date
    query_template: str
    include_trending_headlines: bool = True
    confirmed: bool = True
    notes: str | None = None


# Resolve catalog path from this file's location:
#   services/national_catalog.py → catalogs/national_occasions.yaml
# Same `catalogs/` dir as hijri_occasions.yaml (a bare `data/` .gitignore
# rule would otherwise exclude a data/ location). catalogs/ ships with the wheel.
_CATALOG_PATH = (
    Path(__file__).resolve().parent.parent
    / "catalogs"
    / "national_occasions.yaml"
)


def _load_catalog() -> list[NationalOccasionEntry]:
    if not _CATALOG_PATH.exists():
        return []
    raw: dict[str, Any] | None = yaml.safe_load(_CATALOG_PATH.read_text(encoding="utf-8"))
    if not raw or "occasions" not in raw:
        return []
    return [NationalOccasionEntry(**entry) for entry in raw["occasions"]]


NATIONAL_OCCASIONS: list[NationalOccasionEntry] = _load_catalog()


def get_national_by_slug(slug: str) -> NationalOccasionEntry | None:
    """Lookup by stable slug. Returns None if not found."""
    for o in NATIONAL_OCCASIONS:
        if o.slug == slug:
            return o
    return None


def national_upcoming(
    now: date | datetime | None = None,
    lookahead_days: int = 14,
) -> list[NationalOccasionEntry]:
    """Return national occasions whose gregorian_date falls in
    [now, now + lookahead_days], sorted ascending by date.

    ``now=None`` defaults to today. Pass a ``datetime`` and it's
    truncated to date.
    """
    if now is None:
        now = date.today()
    elif isinstance(now, datetime):
        now = now.date()
    cutoff = now + timedelta(days=lookahead_days)
    matches = [o for o in NATIONAL_OCCASIONS if now <= o.gregorian_date <= cutoff]
    return sorted(matches, key=lambda o: o.gregorian_date)
