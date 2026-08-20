"""Regression guards for `retry_failed_sentiment`'s repair semantics.

Context (2026-08-20): the task selected on `sentiment_label IS NULL` and
wrote only the two sentiment columns, DISCARDING the `theme_group` that
`classify_batch` returns from the very same Gemini call. Because its own
predicate keyed off sentiment, every row it repaired became permanently
unreachable with `theme_group` still NULL — 848 rows were already stranded
that way and a further 9,327 were queued to strand the moment the depleted
Gemini prepay balance was topped up.

Two properties have to hold, and both are cheap to pin here (the helpers
are pure — they build SQL expressions, no DB and no IO):

  1. the filter must REACH rows whose `theme_group` alone is NULL, and
  2. the write must COALESCE rather than blind-set — `theme_group` is also
     written directly by the manual theme audits (232k+ hand-verified rows),
     so a blind write would silently undo that work.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy.dialects import postgresql

from api.workers.ingest import (
    RETRY_SENTIMENT_ROW_CAP,
    RETRY_SENTIMENT_WINDOW_DAYS,
    retry_repair_filter,
    retry_repair_values,
)


def _sql(expr) -> str:
    return str(
        expr.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True})
    )


# ───────────────────────────── the filter ─────────────────────────────


def test_filter_reaches_theme_only_nulls() -> None:
    """The stranding bug: a row with sentiment SET but theme NULL must
    still be selected, or it can never be repaired."""
    sql = _sql(retry_repair_filter(datetime.now(UTC) - timedelta(days=14)))
    assert "theme_group IS NULL" in sql
    assert "sentiment_label IS NULL" in sql
    # ...and the two must be OR'd, not AND'd — an AND would only ever
    # reach rows missing BOTH, which is what left the 848 unreachable.
    assert " OR " in sql


def test_filter_still_bounds_window_and_requires_text() -> None:
    cutoff = datetime(2026, 8, 6, tzinfo=UTC)
    sql = _sql(retry_repair_filter(cutoff))
    assert "text IS NOT NULL" in sql
    assert "posted_at >=" in sql
    assert "2026-08-06" in sql


# ───────────────────────────── the write ──────────────────────────────


def test_values_coalesce_every_column() -> None:
    """Every write is coalesce(existing, new) so nothing already present
    is overwritten."""
    vals = retry_repair_values("positive", 0.91, "Ekonomi & Bisnis")
    assert set(vals) == {"sentiment_label", "sentiment_score", "theme_group"}
    for col, expr in vals.items():
        sql = _sql(expr)
        assert sql.startswith("coalesce("), f"{col} is not coalesced: {sql}"
        # The EXISTING column must be the first argument — coalesce is
        # order-sensitive, and reversing it would clobber good data.
        assert f"social_posts.{col}," in sql, f"{col} has existing value second: {sql}"


def test_values_preserve_manual_theme_audit() -> None:
    """The load-bearing case: a hand-audited theme_group must win over
    whatever the classifier now says."""
    sql = _sql(retry_repair_values("neutral", 0.5, "Lainnya")["theme_group"])
    assert sql == "coalesce(social_posts.theme_group, 'Lainnya')"


def test_values_tolerate_missing_theme_from_model() -> None:
    """`classify_batch` returns theme_group=None when the model omitted it
    or emitted an invalid name — the row must stay NULL and be retried,
    not be written as the literal string 'None'."""
    sql = _sql(retry_repair_values("neutral", 0.5, None)["theme_group"])
    assert "'None'" not in sql
    assert "NULL" in sql.upper()


# ─────────────────────────── drain arithmetic ─────────────────────────


def test_cap_can_outpace_ingest() -> None:
    """At the 2h schedule (12 runs/day) the cap must clear more rows per
    day than the ~2,000-3,500/day ingest, or a backlog inside the window
    can never drain (the old 200 cap gave 2,400/day and did not)."""
    assert RETRY_SENTIMENT_ROW_CAP * 12 > 3_500
    assert RETRY_SENTIMENT_WINDOW_DAYS == 14
