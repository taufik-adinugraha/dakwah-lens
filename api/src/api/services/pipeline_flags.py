"""Per-schedule kill switches for the Celery beat fleet.

State lives in `app_settings` table, one row per (task, platform) pair:
  key=`pipeline:<task_name>:<platform>`  value=`enabled` | `disabled`

Default-true semantics: a MISSING row means "never been touched, keep
the historical 'beat always fires' behavior". Only an explicit
`disabled` value flips it off — so a botched migration / dropped table
won't silently shut down every schedule.

Called at the very top of each Celery task body in
`api/src/api/workers/ingest.py`. The web UI at /admin/system/pipeline
flips rows via `togglePipelineSchedule`. Both sides agree on the key
format via `flag_key()` here ↔ `pipelineFlagKey()` in
`web/src/lib/settings.ts`.

Fails OPEN on DB errors — momentary connection blips would otherwise
disable every schedule until they cleared, which is far worse than
briefly being unable to honor an explicit `disabled` flag.
"""

from __future__ import annotations

import asyncio

import structlog
from sqlalchemy import select

from api.db import SessionLocal
from api.models.admin import AppSetting

log = structlog.get_logger()


def flag_key(task_name: str, platform: str) -> str:
    """Compose the `pipeline:<task>:<platform>` key. Mirror of
    `pipelineFlagKey()` in `web/src/lib/settings.ts`."""
    return f"pipeline:{task_name}:{platform}"


async def _async_lookup(key: str) -> str | None:
    async with SessionLocal() as session:
        return (
            await session.execute(
                select(AppSetting.value).where(AppSetting.key == key)
            )
        ).scalar_one_or_none()


def is_task_enabled(task_name: str, platform: str = "all") -> bool:
    """Sync kill-switch check. Call this at the top of each Celery
    task body — BEFORE any `asyncio.run()` the task does itself, since
    `asyncio.run()` cannot be nested within an already-running loop.

    Returns True when:
      - the (task, platform) row is missing (default-on), OR
      - the row exists with any value != "disabled", OR
      - the DB lookup fails (fail OPEN to avoid silent fleet outage).
    """
    key = flag_key(task_name, platform)
    try:
        value = asyncio.run(_async_lookup(key))
    except Exception:
        log.exception(
            "pipeline_flags.lookup_failed", task=task_name, platform=platform
        )
        return True
    return value != "disabled"
