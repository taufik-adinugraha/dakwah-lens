"""Billing reconciliation against external providers.

Per-call cost capture (in `services/apify.py`, `services/usage.py`) is a best-
effort approximation. Reasons we drift below truth:

  1. Apify's `run.usageTotalUsd` is the tally at completion time — proxy
     compute / dataset storage settle a few minutes later.
  2. Failed runs raise before reaching `record_usage`, so their compute
     cost goes unrecorded on our side but is still billed by Apify.
  3. Apify rounds to fractions of a cent per usage unit; small runs
     return $0 to us while still incrementing the dashboard.

This module pulls the authoritative monthly total straight from Apify's
billing endpoint and writes a single `usage_events` delta row, so the
`/admin/system/api-costs` dashboard stays in lockstep with reality
within ~24h.
"""

from __future__ import annotations

from datetime import UTC, date, datetime

import httpx
import structlog
from sqlalchemy import func, select

from api.config import settings
from api.db import SessionLocal
from api.models.admin import UsageEvent
from api.services.usage import record_usage

log = structlog.get_logger()


async def reconcile_apify_monthly() -> dict[str, object]:
    """Fetch this month's authoritative Apify usage, write a delta row.

    Idempotent across days: the delta is `apify_total - SUM(our_rows)`
    INCLUDING any prior reconcile rows, so cumulative sum stays equal
    to Apify's truth.
    """
    if not settings.apify_token:
        log.info("billing.reconcile_skipped", reason="no_apify_token")
        return {"skipped": "no_apify_token"}

    today = date.today()
    month_start = datetime(today.year, today.month, 1, tzinfo=UTC)

    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.get(
            "https://api.apify.com/v2/users/me/usage/monthly",
            headers={"Authorization": f"Bearer {settings.apify_token}"},
            params={"date": today.isoformat()},
        )
        resp.raise_for_status()
        payload = resp.json()

    # Apify wraps responses in `{"data": ...}`. The monthly endpoint
    # historically returned the total under either `usageTotalUsd` or
    # `monthlyServiceUsageTotalUsd` depending on plan — tolerate both.
    data = payload.get("data") or {}
    apify_total = float(
        data.get("usageTotalUsd")
        or data.get("monthlyServiceUsageTotalUsd")
        or 0.0
    )

    async with SessionLocal() as session:
        result = await session.execute(
            select(func.coalesce(func.sum(UsageEvent.cost_usd), 0.0))
            .where(UsageEvent.provider == "apify")
            .where(UsageEvent.occurred_at >= month_start)
        )
        db_total = float(result.scalar() or 0.0)

    delta = round(apify_total - db_total, 4)

    if abs(delta) < 0.001:
        log.info(
            "billing.reconcile_no_op",
            apify_total=apify_total,
            db_total=db_total,
        )
        return {
            "apify_total": apify_total,
            "db_total": db_total,
            "delta": delta,
            "wrote_row": False,
        }

    record_usage(
        provider="apify",
        operation="billing_reconcile",
        model=None,
        cost_usd=delta,
        meta={
            "month": today.strftime("%Y-%m"),
            "apify_total_usd": apify_total,
            "db_total_before_delta_usd": db_total,
            "reconciled_at": datetime.now(UTC).isoformat(),
        },
    )

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
        "wrote_row": True,
    }
