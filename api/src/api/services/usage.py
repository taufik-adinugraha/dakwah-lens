"""Cost-logging service for paid + free APIs.

Every call site that talks to an external paid (or quota-metered) API calls
`record_usage(...)` after the call returns. We persist one `usage_events` row
per call. The `/admin/system/api-costs` page sums these rows.

Why we record free/zero-cost calls too:
- It shows usage volume (e.g. RSS feeds aren't billed but we want to know
  how many ingests ran).
- It future-proofs us: if pricing changes, we only need to back-fill the
  `cost_usd` column on existing rows.

Pricing constants below are the **public list price** at time of writing.
They're best-effort and conservative — the actual bill from the provider is
the source of truth, but these get us within ~5% for routine ops.
"""

from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any
from uuid import UUID

import structlog

from api.db import SessionLocal
from api.models.admin import UsageEvent

log = structlog.get_logger()


# ── Pricing (USD) ────────────────────────────────────────────────────
# Updated 2026-05-17. If your bill diverges by >10%, revise these and
# back-fill recent rows: UPDATE usage_events SET cost_usd = ... WHERE …
PRICES: dict[str, dict[str, float]] = {
    # OpenAI embeddings — $/1M tokens
    "openai": {
        "text-embedding-3-small": 0.02,
        "text-embedding-3-large": 0.13,
    },
    # Gemini — $/1M tokens (input / output)
    "gemini": {
        # Flash-Lite has paid + free tiers. Free tier 250 RPD; paid:
        "gemini-2.5-flash-lite_in": 0.10,
        "gemini-2.5-flash-lite_out": 0.40,
        "gemini-2.5-flash_in": 0.30,
        "gemini-2.5-flash_out": 2.50,
        "gemini-2.5-pro_in": 1.25,
        "gemini-2.5-pro_out": 10.00,
    },
    # Anthropic — $/1M tokens (input / output)
    "anthropic": {
        "claude-sonnet-4-5_in": 3.00,
        "claude-sonnet-4-5_out": 15.00,
        "claude-sonnet-4-6_in": 3.00,
        "claude-sonnet-4-6_out": 15.00,
    },
    # YouTube Data API — $0 inside free quota (10K units/day), $0 outside
    # (Google doesn't sell extra quota). We still log unit usage so we can
    # see when we're at risk of throttling.
    # Resend transactional email — free tier 3K/month + 100/day. Pro
    # ($20/mo for 50K) works out to $0.0004 per email amortized. Logged
    # as $0 cost while in free tier; flip on if you exceed.
    "resend": {
        "send_email": 0.0004,
    },
}


def gemini_output_tokens(usage_md: Any) -> int | None:
    """Sum `candidates_token_count` + `thoughts_token_count` from a Gemini
    `usage_metadata` object.

    Google bills thinking tokens at the same rate as output tokens but
    exposes them on a SEPARATE field. Reading only `candidates_token_count`
    under-counts cost by up to (thinking_budget × output_rate) per call —
    on Pro briefings (budget 4096 @ $10/M) that's ~$0.04 per call missed.
    """
    if usage_md is None:
        return None
    candidates = getattr(usage_md, "candidates_token_count", None) or 0
    thoughts = getattr(usage_md, "thoughts_token_count", None) or 0
    total = candidates + thoughts
    return total if total > 0 else None


def estimate_cost(
    *,
    provider: str,
    model: str | None,
    tokens_in: int | None = None,
    tokens_out: int | None = None,
) -> float:
    """Best-effort price calculation. Returns 0.0 if we don't have pricing
    for this model — better to under-report than fabricate a number."""
    if not model:
        return 0.0
    table = PRICES.get(provider, {})
    if provider == "openai":
        rate = table.get(model)
        if rate is None or tokens_in is None:
            return 0.0
        return (tokens_in / 1_000_000) * rate
    # Token-split providers (Gemini, Anthropic) charge in/out separately.
    in_rate = table.get(f"{model}_in", 0.0)
    out_rate = table.get(f"{model}_out", 0.0)
    cost = 0.0
    if tokens_in is not None:
        cost += (tokens_in / 1_000_000) * in_rate
    if tokens_out is not None:
        cost += (tokens_out / 1_000_000) * out_rate
    return cost


async def _insert_async(
    *,
    provider: str,
    model: str | None,
    operation: str,
    tokens_in: int | None,
    tokens_out: int | None,
    units: int | None,
    cost_usd: float,
    meta: dict[str, Any] | None,
) -> UUID:
    async with SessionLocal() as session:
        event = UsageEvent(
            provider=provider,
            model=model,
            operation=operation,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            units=units,
            cost_usd=cost_usd,
            meta=meta,
        )
        session.add(event)
        await session.commit()
        return event.id


def record_usage(
    *,
    provider: str,
    operation: str,
    model: str | None = None,
    tokens_in: int | None = None,
    tokens_out: int | None = None,
    units: int | None = None,
    cost_usd: float | None = None,
    meta: dict[str, Any] | None = None,
) -> None:
    """Persist one usage event. Safe to call from sync code — internally
    runs the async insert on the running loop (or spins one up). Errors are
    swallowed and logged: telemetry must never break the request that
    generated it.

    `cost_usd` is optional: if omitted, we compute it from `PRICES`.
    """
    final_cost = (
        cost_usd
        if cost_usd is not None
        else estimate_cost(
            provider=provider,
            model=model,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
        )
    )

    try:
        try:
            loop = asyncio.get_running_loop()
            # We're inside an event loop — fire-and-forget the insert.
            loop.create_task(
                _insert_async(
                    provider=provider,
                    model=model,
                    operation=operation,
                    tokens_in=tokens_in,
                    tokens_out=tokens_out,
                    units=units,
                    cost_usd=final_cost,
                    meta=meta,
                )
            )
        except RuntimeError:
            # No running loop (typical: called from a Celery sync task or
            # the ingest CLI). Run synchronously.
            asyncio.run(
                _insert_async(
                    provider=provider,
                    model=model,
                    operation=operation,
                    tokens_in=tokens_in,
                    tokens_out=tokens_out,
                    units=units,
                    cost_usd=final_cost,
                    meta=meta,
                )
            )
    except Exception:
        log.exception(
            "usage.record_failed",
            provider=provider,
            operation=operation,
            model=model,
        )


async def aggregate_costs(
    *,
    since: datetime | None = None,
) -> dict[str, dict[str, float | int]]:
    """Aggregate {provider: {cost_usd, calls, tokens}} since `since`.

    Used by the admin dashboard. Cheap query — we already index on
    (provider, occurred_at).
    """
    from sqlalchemy import func, select

    async with SessionLocal() as session:
        stmt = select(
            UsageEvent.provider,
            func.sum(UsageEvent.cost_usd).label("cost_usd"),
            func.count(UsageEvent.id).label("calls"),
            func.sum(UsageEvent.tokens_in).label("tokens_in"),
            func.sum(UsageEvent.tokens_out).label("tokens_out"),
        )
        if since is not None:
            stmt = stmt.where(UsageEvent.occurred_at >= since)
        stmt = stmt.group_by(UsageEvent.provider)
        res = await session.execute(stmt)
        return {
            row.provider: {
                "cost_usd": float(row.cost_usd or 0),
                "calls": int(row.calls or 0),
                "tokens_in": int(row.tokens_in or 0),
                "tokens_out": int(row.tokens_out or 0),
            }
            for row in res.all()
        }
