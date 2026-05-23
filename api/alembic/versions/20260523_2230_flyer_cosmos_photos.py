"""Add night-cosmos photos to flyer_assets pool.

21 new CC0 photos from Unsplash on the night-sky / milky way /
aurora / galaxy themes. Reviewed for dakwah appropriateness (5 of an
initial 25 flagged for couples + off-theme content, removed pre-ship).

Revision ID: p9t0v2x4z6a8
Revises: o8s9u1w3y5b7
Create Date: 2026-05-23 22:30:00.000000+00:00
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "p9t0v2x4z6a8"
down_revision = "o8s9u1w3y5b7"
branch_labels = None
depends_on = None


SEED_COSMOS: list[tuple[str, str, str, list[str]]] = [
    ('photo-night-cosmos-3Bsw31s1', '/flyer-assets/photos/uploads/night-cosmos-01-3Bsw31s1.jpg', '1:1', ['langit', 'malam', 'kosmos', 'bintang']),
    ('photo-night-cosmos-AaNNuyN8', '/flyer-assets/photos/uploads/night-cosmos-02-AaNNuyN8.jpg', '1:1', ['langit', 'malam', 'kosmos', 'bintang']),
    ('photo-night-cosmos-rdE5QcMS', '/flyer-assets/photos/uploads/night-cosmos-03-rdE5QcMS.jpg', '1:1', ['langit', 'malam', 'kosmos', 'bintang']),
    ('photo-night-cosmos-qIhrkPtv', '/flyer-assets/photos/uploads/night-cosmos-04-qIhrkPtv.jpg', '1:1', ['langit', 'malam', 'kosmos', 'bintang']),
    ('photo-night-cosmos-HFn0mFCQ', '/flyer-assets/photos/uploads/night-cosmos-05-HFn0mFCQ.jpg', '1:1', ['langit', 'malam', 'kosmos', 'bintang']),
    ('photo-night-cosmos-xBlXoMzy', '/flyer-assets/photos/uploads/night-cosmos-06-xBlXoMzy.jpg', '1:1', ['langit', 'malam', 'kosmos', 'bintang']),
    ('photo-night-cosmos-OnfrIjZ3', '/flyer-assets/photos/uploads/night-cosmos-07-OnfrIjZ3.jpg', '1:1', ['langit', 'malam', 'kosmos', 'bintang']),
    ('photo-night-cosmos-LhD5dmoh', '/flyer-assets/photos/uploads/night-cosmos-08-LhD5dmoh.jpg', '1:1', ['langit', 'malam', 'kosmos', 'bintang']),
    ('photo-night-cosmos-eKpBUgbS', '/flyer-assets/photos/uploads/night-cosmos-09-eKpBUgbS.jpg', '1:1', ['langit', 'malam', 'kosmos', 'bintang']),
    ('photo-night-cosmos-0zlJK2Ax', '/flyer-assets/photos/uploads/night-cosmos-10-0zlJK2Ax.jpg', '1:1', ['langit', 'malam', 'kosmos', 'bintang']),
    ('photo-night-cosmos-pX7HyiEY', '/flyer-assets/photos/uploads/night-cosmos-12-pX7HyiEY.jpg', '1:1', ['langit', 'malam', 'kosmos', 'bintang']),
    ('photo-night-cosmos-tLUAqlbx', '/flyer-assets/photos/uploads/night-cosmos-13-tLUAqlbx.jpg', '1:1', ['langit', 'malam', 'kosmos', 'bintang']),
    ('photo-night-cosmos-fJqlFdzf', '/flyer-assets/photos/uploads/night-cosmos-14-fJqlFdzf.jpg', '1:1', ['langit', 'malam', 'kosmos', 'bintang']),
    ('photo-night-cosmos-OTXkfJZk', '/flyer-assets/photos/uploads/night-cosmos-16-OTXkfJZk.jpg', '1:1', ['langit', 'malam', 'kosmos', 'bintang']),
    ('photo-night-cosmos-kKdLDEwp', '/flyer-assets/photos/uploads/night-cosmos-17-kKdLDEwp.jpg', '1:1', ['langit', 'malam', 'kosmos', 'bintang']),
    ('photo-night-cosmos-OBDsPq5S', '/flyer-assets/photos/uploads/night-cosmos-20-OBDsPq5S.jpg', '1:1', ['langit', 'malam', 'kosmos', 'bintang']),
    ('photo-night-cosmos-Qy96SQyW', '/flyer-assets/photos/uploads/night-cosmos-21-Qy96SQyW.jpg', '1:1', ['langit', 'malam', 'kosmos', 'bintang']),
    ('photo-night-cosmos-1Y5jLuUM', '/flyer-assets/photos/uploads/night-cosmos-22-1Y5jLuUM.jpg', '1:1', ['langit', 'malam', 'kosmos', 'bintang']),
    ('photo-night-cosmos-ej4giSmN', '/flyer-assets/photos/uploads/night-cosmos-23-ej4giSmN.jpg', '1:1', ['langit', 'malam', 'kosmos', 'bintang']),
    ('photo-night-cosmos-vUlSRGRM', '/flyer-assets/photos/uploads/night-cosmos-25-vUlSRGRM.jpg', '1:1', ['langit', 'malam', 'kosmos', 'bintang']),
    ('photo-night-cosmos-N1VE2t-n', '/flyer-assets/photos/uploads/night-cosmos-15-N1VE2t-n.jpg', '1:1', ['langit', 'malam', 'kosmos', 'bintang']),
]


def upgrade() -> None:
    bind = op.get_bind()
    for asset_id, src, aspect, tags in SEED_COSMOS:
        bind.execute(
            sa.text(
                "INSERT INTO flyer_assets (id, kind, src, aspect, tags) "
                "VALUES (:id, 'photo', :src, :aspect, :tags) "
                "ON CONFLICT (id) DO NOTHING"
            ),
            {"id": asset_id, "src": src, "aspect": aspect, "tags": tags},
        )


def downgrade() -> None:
    op.execute("DELETE FROM flyer_assets WHERE id LIKE 'photo-night-cosmos-%'")
