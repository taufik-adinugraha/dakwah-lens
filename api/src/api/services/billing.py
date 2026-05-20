"""Billing reconciliation against external providers.

Per-call cost capture (in `services/apify.py`, `services/usage.py`) is a best-
effort approximation. Reasons we drift below truth:

  1. Apify's `run.usageTotalUsd` is the tally at completion time — proxy
     compute / dataset storage settle a few minutes later.
  2. Failed runs raise before reaching `record_usage`, so their compute
     cost goes unrecorded on our side but is still billed by Apify.
  3. Apify rounds to fractions of a cent per usage unit; small runs
     return $0 to us while still incrementing the dashboard.
  4. Some actors (notably `apidojo/tweet-scraper`) report ~$0 compute
     at run-completion and bill the per-event fee LATER — our DB sees
     none of that until reconcile.

This module pulls the authoritative monthly total straight from Apify's
billing endpoint (`/v2/users/me/limits` → `data.current.monthlyUsageUsd`)
and writes a single `usage_events` delta row so the cost dashboard stays
within ~24h of reality.
"""

from __future__ import annotations

from datetime import UTC, date, datetime

import httpx
import structlog
from sqlalchemy import func, select

from api.config import settings
from api.db import SessionLocal
from api.models.admin import UsageEvent

log = structlog.get_logger()


async def reconcile_apify_monthly() -> dict[str, object]:
    """Fetch this billing-cycle's authoritative Apify usage, write a delta row.

    Idempotent across days: the delta is `apify_total - SUM(our_rows)`
    INCLUDING any prior reconcile rows, so cumulative sum stays equal
    to Apify's truth.

    Note: Apify's billing cycle is the user's account anniversary, not
    the calendar month. We use whatever start date Apify reports so the
    DB aggregate window matches the apify_total window.
    """
    if not settings.apify_token:
        log.info("billing.reconcile_skipped", reason="no_apify_token")
        return {"skipped": "no_apify_token"}

    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.get(
            "https://api.apify.com/v2/users/me/limits",
            headers={"Authorization": f"Bearer {settings.apify_token}"},
        )
        resp.raise_for_status()
        payload = resp.json()

    data = payload.get("data") or {}
    current = data.get("current") or {}
    apify_total = float(current.get("monthlyUsageUsd") or 0.0)

    # Apify's cycle starts on the user's account anniversary day. Use
    # the cycle start it reports so our DB aggregate matches the same
    # window — calendar-month would over- or under-count near the
    # boundary.
    cycle = data.get("monthlyUsageCycle") or {}
    cycle_start_str = cycle.get("startAt")
    if cycle_start_str:
        cycle_start = datetime.fromisoformat(cycle_start_str.replace("Z", "+00:00"))
    else:
        today = date.today()
        cycle_start = datetime(today.year, today.month, 1, tzinfo=UTC)

    async with SessionLocal() as session:
        result = await session.execute(
            select(func.coalesce(func.sum(UsageEvent.cost_usd), 0.0))
            .where(UsageEvent.provider == "apify")
            .where(UsageEvent.occurred_at >= cycle_start)
        )
        db_total = float(result.scalar() or 0.0)

        delta = round(apify_total - db_total, 4)

        if abs(delta) < 0.001:
            log.info(
                "billing.reconcile_no_op",
                apify_total=apify_total,
                db_total=db_total,
                cycle_start=cycle_start.isoformat(),
            )
            return {
                "apify_total": apify_total,
                "db_total": db_total,
                "delta": delta,
                "cycle_start": cycle_start.isoformat(),
                "wrote_row": False,
            }

        # Insert delta row directly. We tried using `usage.record_usage`
        # here originally but it's a sync function that does
        # `ensure_future` from inside an async caller — the coroutine
        # was scheduled but never awaited, so the row never landed.
        event = UsageEvent(
            provider="apify",
            operation="billing_reconcile",
            model=None,
            tokens_in=None,
            tokens_out=None,
            units=None,
            cost_usd=delta,
            meta={
                "cycle_start": cycle_start.isoformat(),
                "apify_total_usd": apify_total,
                "db_total_before_delta_usd": db_total,
                "reconciled_at": datetime.now(UTC).isoformat(),
            },
        )
        session.add(event)
        await session.commit()

    log.info(
        "billing.reconcile_done",
        apify_total=apify_total,
        db_total=db_total,
        delta=delta,
    )

    return {
        "apify_total": apify_total,
        "db_total": db_total,
        "delta": delta,
        "cycle_start": cycle_start.isoformat(),
        "wrote_row": True,
    }
