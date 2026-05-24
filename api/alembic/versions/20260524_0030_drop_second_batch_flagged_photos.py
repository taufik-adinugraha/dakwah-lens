"""Drop 12 newly-flagged photos from the flyer_assets bulk seed.

Second hand-review pass after the first drop_flagged_photos migration
(`o8s9u1w3y5b7`) caught these 12 — same idempotent DELETE pattern.

These were part of the original n6r8t0v2x4z6 bulk seed. JPGs deleted
from `web/public/flyer-assets/photos/uploads/` and the seed data
trimmed in the same commit, so a fresh setup never re-introduces them.

Idempotent: DELETE WHERE id IN (…) is a no-op if the row doesn't exist.

Revision ID: r2v4x6z8b0d2
Revises: q1u3w5y7a9c1
Create Date: 2026-05-24 00:30:00.000000+00:00
"""

from __future__ import annotations

from alembic import op


revision = "r2v4x6z8b0d2"
down_revision = "q1u3w5y7a9c1"
branch_labels = None
depends_on = None


FLAGGED_IDS = [
    "photo-writing-hands-p-LLnsEG",
    "photo-writing-hands-Ua-xaK8b",
    "photo-writing-hands-iwAjdUsN",
    "photo-writing-hands-CYUIOyjJ",
    "photo-writing-hands-WWUi9NbG",
    "photo-writing-hands-9TucEPaZ",
    "photo-writing-hands-FDAIlESG",
    "photo-children-learning-zT08bgl0",
    "photo-children-learning-87d_Yq1O",
    "photo-prayer-objects-lW72DTPY",
    "photo-prayer-objects-nyOIF_y4",
    "photo-sky-light-TsifxiSl",
]


def upgrade() -> None:
    quoted = ",".join(f"'{i}'" for i in FLAGGED_IDS)
    op.execute(f"DELETE FROM flyer_assets WHERE id IN ({quoted})")


def downgrade() -> None:
    # No-op — these photos were flagged for content / quality reasons.
    # If you really need them back, restore from the bulk seed history.
    pass
