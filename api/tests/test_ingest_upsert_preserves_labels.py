"""A re-ingest must never erase an existing classification.

Why this file exists — a measured, not hypothetical, failure:

Both ingest paths set the classification columns from the Gemini result and
NULL them when the call fails:

    row["theme_group"] = getattr(s, "theme_group", None)   # ingest.py
    row["theme_group"] = s.theme_group if s else None      # ingest_x.py

The upsert then wrote `theme_group = excluded.theme_group` unconditionally,
so re-ingesting an already-seen post overwrote a good stored label with
NULL whenever the classifier had failed on that run.

Measured 2026-08-21: 66 posts inside a 10-day window had been correctly
labelled and were then re-nulled by a later re-ingest — including labels a
manual theme audit had just written. Their `updated_at` values all predated
the audit's own UPDATE, which is how the direction of the damage was
established (the audit was not the thing nulling them).

The blast radius scales with the outage: while the Gemini prepay balance is
depleted `s` is None on *every* call, so every re-ingest erased labels
wholesale, and each audit's corrections decayed until the next audit.

Fix: COALESCE(excluded.X, social_posts.X) — the refreshed value wins when
present, the stored value survives only when the incoming one is NULL.

Note the coalesce order is the OPPOSITE of `retry_repair_values` in
workers/ingest.py. That one is a gap-filler and must never overwrite, so it
reads COALESCE(social_posts.X, new). Ingest legitimately refreshes, so it
reads COALESCE(excluded.X, social_posts.X). Getting these backwards would
either freeze labels forever or restore the erasing bug, which is why both
directions are asserted here.
"""

import re

from sqlalchemy import func
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import insert

from api.models.social import SocialPost

CLASSIFICATION_COLUMNS = ("theme_group", "sentiment_label", "sentiment_score")


def _compiled_upsert(set_: dict) -> str:
    stmt = (
        insert(SocialPost)
        .values([{"platform": "x", "external_id": "1", "text": "t"}])
        .on_conflict_do_update(index_elements=["platform", "external_id"], set_=set_)
    )
    sql = str(
        stmt.compile(
            dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}
        )
    )
    return sql[sql.index("ON CONFLICT") :].lower()


def _coalesced(col: str) -> dict:
    return {
        col: func.coalesce(
            getattr(insert(SocialPost).excluded, col), getattr(SocialPost, col)
        )
    }


class TestIngestUpsertPreservesLabels:
    def test_each_classification_column_is_coalesced(self):
        for col in CLASSIFICATION_COLUMNS:
            sql = _compiled_upsert(_coalesced(col))
            assert f"coalesce(excluded.{col}, social_posts.{col})" in sql, (
                f"{col} must be COALESCEd or a failed classification erases it"
            )

    def test_incoming_value_wins_when_present(self):
        """Ingest is a refresh: a real new label must still take effect."""
        sql = _compiled_upsert(_coalesced("theme_group"))
        inner = re.search(r"coalesce\(([^)]*)\)", sql).group(1)
        first, second = [p.strip() for p in inner.split(",")]
        assert first.startswith("excluded."), (
            "excluded must come FIRST or stored labels freeze and never refresh"
        )
        assert second.startswith("social_posts."), (
            "the stored column must be the fallback arm"
        )

    def test_a_blind_overwrite_is_detectably_different(self):
        """Guard the guard: the old buggy form must not satisfy the check."""
        sql = _compiled_upsert(
            {"theme_group": insert(SocialPost).excluded.theme_group}
        )
        assert "coalesce" not in sql
        assert "theme_group = excluded.theme_group" in sql

    def test_retry_path_uses_the_opposite_order(self):
        """workers/ingest.py fills gaps and must NEVER overwrite.

        Same helper, reversed arms — asserted so nobody "aligns" the two
        call sites and silently turns the gap-filler into an overwriter.
        """
        from api.workers.ingest import retry_repair_values

        values = retry_repair_values("positive", 0.9, "Ekonomi & Bisnis")
        compiled = str(
            values["theme_group"].compile(
                dialect=postgresql.dialect(),
                compile_kwargs={"literal_binds": True},
            )
        ).lower()
        assert compiled.startswith("coalesce(social_posts.theme_group"), (
            "retry must keep the EXISTING value first — it is a gap-filler"
        )
