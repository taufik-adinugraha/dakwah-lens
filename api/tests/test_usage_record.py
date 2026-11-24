"""`record_usage` must persist its row even when the caller's event loop
ends right after the call.

Worker tasks run `asyncio.run(...)` once per task. A YouTube search that
returns 0 items records its quota usage and the task returns ~100 ms
later; `asyncio.run` then cancelled the still-running insert task. That
logged "Exception closing connection ... CancelledError" (2026-11-24, two
of three 0-item searches) and, when the cancel landed before the commit,
dropped the usage row without a trace.
"""

from __future__ import annotations

import asyncio

import api.services.usage as usage


def _stub_insert(monkeypatch, delay: float, sink: list[str], fail: bool = False):
    async def fake_insert(**kw):
        await asyncio.sleep(delay)
        if fail:
            raise RuntimeError("db down")
        sink.append(kw["provider"])

    monkeypatch.setattr(usage, "_insert_async", fake_insert)


def test_insert_outlives_a_loop_that_ends_right_after_the_call(monkeypatch):
    done: list[str] = []
    # The insert takes longer than the caller's loop lives.
    _stub_insert(monkeypatch, 0.05, done)

    async def zero_item_task() -> int:
        usage.record_usage(provider="youtube", operation="search", units=100, cost_usd=0.0)
        return 0

    assert asyncio.run(zero_item_task()) == 0
    assert done == ["youtube"]


def test_every_insert_from_one_task_lands(monkeypatch):
    done: list[str] = []
    _stub_insert(monkeypatch, 0.02, done)

    async def task() -> None:
        for p in ("youtube", "rss", "gemini"):
            usage.record_usage(provider=p, operation="x", cost_usd=0.0)

    asyncio.run(task())
    assert sorted(done) == ["gemini", "rss", "youtube"]


def test_insert_without_a_running_loop_runs_inline(monkeypatch):
    done: list[str] = []
    _stub_insert(monkeypatch, 0.0, done)
    usage.record_usage(provider="rss", operation="fetch", cost_usd=0.0)
    assert done == ["rss"]


def test_a_failed_insert_never_breaks_the_caller(monkeypatch):
    _stub_insert(monkeypatch, 0.0, [], fail=True)

    async def task() -> str:
        usage.record_usage(provider="youtube", operation="search", cost_usd=0.0)
        return "ok"

    assert asyncio.run(task()) == "ok"
    # and from sync code
    usage.record_usage(provider="youtube", operation="search", cost_usd=0.0)
