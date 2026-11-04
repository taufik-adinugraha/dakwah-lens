"""social_posts: a covering index on created_at, built without blocking writes.

Why: six queries pick posts by `created_at >= now() - interval 'N days'`, and
`created_at` had no index, so each one read the whole 638 MB heap (a seq scan,
2.0-3.4 s apiece on 2026-11-04):

  - the landing page's "posts analysed" figure, 30 days
    (web/src/lib/landing-data.ts; since #151 it runs once an hour, not per visit)
  - the admin pipeline page's same count over 7 days
  - /dashboard, four per load (web/src/lib/dashboard-metrics.ts):
    getPulseSnapshot 14d, getDailyInsights (sentiment 14d, platform 7d) and
    getSentimentTrend30d

Shape: the key is `created_at`; the four other columns those queries read
(platform, theme_group, sentiment_label, topic_id) ride along in INCLUDE, so
the planner can answer them from the index alone (an index-only scan) instead
of visiting the heap for every matching row. A plain `(created_at)` would still
do that visit, and at 13% of the rows (the 30-day windows) the planner would be
weighing it against the seq scan rather than choosing it outright.

Not a partial index (`WHERE theme_group IS NOT NULL AND sentiment_label IS NOT
NULL`, the shape of the landing count): it would serve two of the six.

One cost, shared by either shape: a column that is in an index (or named in its
predicate) counts as an indexed column for HOT, so an update that changes only
`sentiment_label` can no longer be a HOT update. It costs little here: the
nightly label batch writes theme_group, sentiment_label and dawah_opportunity in
one statement and the recluster writes topic_id, and every one of those but
sentiment_label is indexed already, so those updates already write an indexed
column. The writer it does change is the manual `sent_relabel` ingest, which
writes sentiment_label and sentiment_score alone, in occasional waves.

Not for the label batch's own select (`claude_labels.select_posts`): it asks for
rows that are unlabelled OR recent, newest first, and expects fewer rows than
its LIMIT, so it keeps reading the table.

CONCURRENTLY: a plain CREATE INDEX holds a lock that stops every INSERT and
UPDATE for the whole build, and ingest and the nightly batch write to this
table. The concurrent build reads the heap twice instead.

Revision ID: a3f9c2e8b5d1
Revises: d4e5f6g7h8i9
Create Date: 2026-11-04 09:00:00.000000+00:00
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "a3f9c2e8b5d1"
down_revision = "d4e5f6g7h8i9"
branch_labels = None
depends_on = None

TABLE = "social_posts"
INDEX = "ix_social_posts_created_at"
# Keep in step with the Index in api/models/social.py; tests/test_social_posts_created_at_index.py
# fails when they differ.
INCLUDE = ["platform", "theme_group", "sentiment_label", "topic_id"]


def upgrade() -> None:
    # CREATE INDEX CONCURRENTLY refuses to run inside a transaction, and env.py wraps the
    # whole run in one, so the build gets its own autocommit block.
    with op.get_context().autocommit_block():
        if not op.get_context().as_sql:
            # A concurrent build that is cut off (deploy killed, connection lost) leaves an
            # INVALID index under this name, and IF NOT EXISTS would then skip it for good.
            # indexrelid = NULL (no such index) matches no row, so `valid` is None then.
            valid = (
                op.get_bind()
                .execute(
                    sa.text(
                        "SELECT indisvalid FROM pg_index WHERE indexrelid = to_regclass(:name)"
                    ),
                    {"name": INDEX},
                )
                .scalar()
            )
            if valid is False:
                op.drop_index(INDEX, table_name=TABLE, postgresql_concurrently=True, if_exists=True)
        op.create_index(
            INDEX,
            TABLE,
            ["created_at"],
            postgresql_include=INCLUDE,
            postgresql_concurrently=True,
            if_not_exists=True,
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.drop_index(INDEX, table_name=TABLE, postgresql_concurrently=True, if_exists=True)
