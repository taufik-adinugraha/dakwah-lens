"""Drop 8 flagged photos from the flyer_assets bulk seed.

These 8 photos were part of the original n6r8t0v2x4z6 bulk seed but
flagged during a final hand-review (off-topic / inappropriate / weak
match). The bulk-seed migration was edited to drop them locally, but
prod already applied that revision — so we need a follow-up to remove
the rows from the prod DB.

Idempotent: DELETE WHERE id IN (…) is a no-op if the row doesn't exist.

Revision ID: o8s9u1w3y5b7
Revises: n6r8t0v2x4z6
Create Date: 2026-05-23 20:30:00.000000+00:00
"""

from __future__ import annotations

from alembic import op


revision = "o8s9u1w3y5b7"
down_revision = "n6r8t0v2x4z6"
branch_labels = None
depends_on = None


# Unsplash IDs of photos hand-flagged in the final review pass.
FLAGGED_IDS = [
    "photo-children-learning-3CYJkMKK",
    "photo-children-learning-fvxG34jv",
    "photo-children-learning-IxfPGP3b",
    "photo-children-learning-dPee-Mbg",
    "photo-children-learning-JKq3NPV_",
    "photo-children-learning-lN7bRp6f",
    "photo-prayer-objects-LS8FaYad",
    "photo-writing-hands-XjzFoGO7",
]


def upgrade() -> None:
    # Quote each ID, comma-join — small + fixed list, no parameterisation
    # gymnastics needed.
    quoted = ",".join(f"'{i}'" for i in FLAGGED_IDS)
    op.execute(f"DELETE FROM flyer_assets WHERE id IN ({quoted})")


def downgrade() -> None:
    # No-op — restoring flagged photos isn't desirable. If you really
    # need them back, re-run the seed script.
    pass
