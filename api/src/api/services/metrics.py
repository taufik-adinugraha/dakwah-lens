"""Host-level metrics snapshot via psutil.

Used by:
- Celery beat (`system-metrics-snapshot` task, every minute) — persists rows
  into `system_metrics` for the admin dashboard time-series chart.
- The admin overview page — calls `current_snapshot()` directly for the
  live gauges without a DB read.

The 1-minute cadence + ~120 bytes/row works out to ~5MB/month on disk,
acceptable for prototype scale. Compress with a 30-day retention TTL when
data volume becomes an issue.
"""

from __future__ import annotations

from dataclasses import dataclass

import psutil
import structlog

from api.db import SessionLocal
from api.models.admin import SystemMetric

log = structlog.get_logger()


@dataclass(frozen=True)
class HostSnapshot:
    cpu_pct: float
    mem_used_mb: float
    mem_total_mb: float
    disk_used_gb: float
    disk_total_gb: float
    load_1m: float | None


def current_snapshot() -> HostSnapshot:
    """Read host metrics right now. The `cpu_percent` call blocks for 1s
    to measure CPU utilisation across that interval — that's how psutil
    works. Worth it for an accurate number."""
    cpu = psutil.cpu_percent(interval=1.0)
    mem = psutil.virtual_memory()
    disk = psutil.disk_usage("/")
    try:
        load1, _, _ = psutil.getloadavg()
    except (AttributeError, OSError):
        load1 = None

    return HostSnapshot(
        cpu_pct=float(cpu),
        mem_used_mb=mem.used / (1024 * 1024),
        mem_total_mb=mem.total / (1024 * 1024),
        disk_used_gb=disk.used / (1024**3),
        disk_total_gb=disk.total / (1024**3),
        load_1m=float(load1) if load1 is not None else None,
    )


async def persist_snapshot() -> None:
    snap = current_snapshot()
    async with SessionLocal() as session:
        session.add(
            SystemMetric(
                cpu_pct=snap.cpu_pct,
                mem_used_mb=snap.mem_used_mb,
                mem_total_mb=snap.mem_total_mb,
                disk_used_gb=snap.disk_used_gb,
                disk_total_gb=snap.disk_total_gb,
                load_1m=snap.load_1m,
            )
        )
        await session.commit()
