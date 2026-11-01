"""Celery tasks for the Claude jobs (operator decision 2026-11-01).

  label_daily_submit   00:00 WIB daily   submit the theme + sentiment batch
  label_batch_poll     every 10 min      apply batches that have ended; after
                                         Thursday's batch is applied, start
                                         the weekly recluster
  recluster_weekly     Thursday          after that batch (or at 06:00 WIB as
                                         a fallback, if it has not run yet)

Both jobs skip, with a log line, when `anthropic_labeling_api_key` is unset.
Kill switches (admin → System → Pipeline): `claude_label_batch` stops new
submissions — a batch already submitted is still applied, since it is
already paid for — and `claude_recluster_weekly` stops the recluster.
"""

from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import structlog

from api.config import settings
from api.services import ingest_runs
from api.services.pipeline_flags import is_task_enabled
from api.services.usage import record_usage
from api.workers.celery_app import celery_app

log = structlog.get_logger()

WIB = ZoneInfo("Asia/Jakarta")
THURSDAY = 3  # datetime.weekday()
LABEL_TASK = "claude_label_batch"
RECLUSTER_TASK = "claude_recluster_weekly"


def _no_key(job: str) -> bool:
    if settings.anthropic_labeling_api_key:
        return False
    log.warning("claude_jobs.no_key", job=job, env="ANTHROPIC_LABELING_API_KEY")
    return True


@celery_app.task(
    name="api.workers.claude_jobs.label_daily_submit", bind=True, max_retries=2
)
def label_daily_submit(self: Any) -> dict[str, Any]:
    if not is_task_enabled(LABEL_TASK, "all"):
        log.info("pipeline.disabled", task=LABEL_TASK)
        return {"disabled": True}
    if _no_key(LABEL_TASK):
        return {"skipped": "no key"}
    from api.services import claude_labels

    try:
        return asyncio.run(claude_labels.submit_daily_batch())
    except Exception as exc:
        log.exception("claude_labels.submit_failed")
        raise self.retry(exc=exc, countdown=1800) from exc


@celery_app.task(name="api.workers.claude_jobs.label_batch_poll")
def label_batch_poll() -> dict[str, Any]:
    if not settings.anthropic_labeling_api_key:
        return {"skipped": "no key"}  # silent: this fires every 10 minutes
    from api.services import claude_labels

    applied = asyncio.run(claude_labels.poll_batches())
    for a in applied:
        record_usage(
            provider="anthropic",
            operation="label_batch",
            model=a.model,
            tokens_in=a.usage.tokens_in,
            tokens_out=a.usage.output_tokens,
            cost_usd=a.cost_usd,
            meta={
                "batch_id": a.batch_id,
                "run_id": a.run_id,
                "posts_sent": a.posts_sent,
                "posts_labelled": a.posts_labelled,
                "requests_failed": a.requests_failed,
                "cache_write_tokens": a.usage.cache_write_tokens,
                "cache_read_tokens": a.usage.cache_read_tokens,
            },
        )
        submitted = datetime.fromisoformat(a.started_at).astimezone(WIB)
        if submitted.weekday() == THURSDAY:
            recluster_weekly.delay()
    return {"applied": [a.batch_id for a in applied]}


def _redis() -> Any:
    import redis

    return redis.Redis.from_url(settings.redis_url)


def _claim_day(day: str, task_id: str) -> bool:
    """Once per WIB day, across the poll trigger and the beat fallback.
    A redelivered task (same id, after a worker restart) keeps its claim."""
    r = _redis()
    key = f"claude_recluster:{day}"
    if r.set(key, task_id, nx=True, ex=36 * 3600):
        return True
    held = r.get(key)
    return held is not None and held.decode() == task_id


def _release_day(day: str, task_id: str) -> None:
    r = _redis()
    key = f"claude_recluster:{day}"
    held = r.get(key)
    if held is not None and held.decode() == task_id:
        r.delete(key)


# Under Redis's 1h visibility timeout: with acks_late, a task still running
# at that point would be handed to a second worker.
@celery_app.task(
    name="api.workers.claude_jobs.recluster_weekly",
    bind=True,
    time_limit=3000,
    soft_time_limit=2900,
)
def recluster_weekly(self: Any, fallback: bool = False) -> dict[str, Any]:
    if not is_task_enabled(RECLUSTER_TASK, "all"):
        log.info("pipeline.disabled", task=RECLUSTER_TASK)
        return {"disabled": True}
    if _no_key(RECLUSTER_TASK):
        return {"skipped": "no key"}
    from api.services import claude_recluster

    day = datetime.now(WIB).date().isoformat()
    task_id = self.request.id or "manual"
    if not _claim_day(day, task_id):
        log.info("claude_recluster.already_ran", day=day, fallback=fallback)
        return {"skipped": f"already ran on {day}"}

    run_id = asyncio.run(ingest_runs.start_run(RECLUSTER_TASK, platform="all"))
    result = claude_recluster.ReclusterResult(model=settings.labeling_model)
    try:
        claude_recluster.run_weekly(result)
    except BaseException as exc:
        # BaseException: the soft time limit raises SoftTimeLimitExceeded.
        _record_recluster_usage(result, failed=True)
        asyncio.run(
            ingest_runs.finish_run(
                run_id,
                status="failed",
                items_scraped=result.posts or None,
                cost_usd=round(result.cost_usd, 4),
                error=f"{type(exc).__name__}: {exc}",
            )
        )
        _release_day(day, task_id)
        raise

    _record_recluster_usage(result, failed=False)
    warning = None
    if result.warnings:
        warning = f"{len(result.warnings)} warnings: " + "; ".join(result.warnings)
    asyncio.run(
        ingest_runs.finish_run(
            run_id,
            status="success",
            items_scraped=result.posts,
            items_stored=result.assigned,
            cost_usd=round(result.cost_usd, 4),
            error=warning,
        )
    )
    log.info(
        "claude_recluster.done",
        themes=result.themes_persisted,
        assigned=result.assigned,
        concrete_purity=round(result.concrete_purity, 3),
        dry_runs=result.dry_runs,
        best_round=result.best_round,
        cost_usd=round(result.cost_usd, 4),
        warnings=result.warnings,
    )
    return {
        "themes": result.themes_persisted,
        "assigned": result.assigned,
        "concrete_purity": round(result.concrete_purity, 3),
        "warnings": len(result.warnings),
    }


def _record_recluster_usage(result: Any, *, failed: bool) -> None:
    if not result.usage.tokens_in and not result.usage.output_tokens:
        return
    record_usage(
        provider="anthropic",
        operation="recluster",
        model=result.model,
        tokens_in=result.usage.tokens_in,
        tokens_out=result.usage.output_tokens,
        cost_usd=result.cost_usd,
        meta={
            "failed": failed,
            "dry_runs": result.dry_runs,
            "cache_write_tokens": result.usage.cache_write_tokens,
            "cache_read_tokens": result.usage.cache_read_tokens,
        },
    )
