from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, func, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


# Postgres 13+ has `gen_random_uuid()` built-in (no pgcrypto extension needed).
# Server default lets non-SQLAlchemy clients (Drizzle, raw SQL) insert without
# providing an `id`. Keeping the Python `default=uuid4` as a fallback for
# SQLAlchemy inserts (e.g. scripts/tests).
UUID_PK_SERVER_DEFAULT = text("gen_random_uuid()")


class UUIDPKMixin:
    id: Mapped[UUID] = mapped_column(
        primary_key=True, default=uuid4, server_default=UUID_PK_SERVER_DEFAULT
    )
