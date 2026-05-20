"""Auth-related models.

Schema mirrors Auth.js v5 conventions so the same tables are readable from
both Drizzle (on the Next.js side, for OAuth account creation) and SQLAlchemy
(on the FastAPI side, for app data). All column names are snake_case.
"""

from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    PrimaryKeyConstraint,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.models.base import Base, TimestampMixin


class UserStatus(StrEnum):
    """Account approval status — every new signup starts as `pending`."""

    pending = "pending"
    approved = "approved"
    rejected = "rejected"
    blocked = "blocked"


class UserRole(StrEnum):
    user = "user"
    admin = "admin"
    superadmin = "superadmin"


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[UUID] = mapped_column(
        primary_key=True, default=uuid4, server_default=text("gen_random_uuid()")
    )
    name: Mapped[str | None] = mapped_column(String(255))
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    email_verified: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    image: Mapped[str | None] = mapped_column(Text)

    # Set when the user signs up via the Credentials provider. NULL for users
    # who only sign in via OAuth (no password to verify).
    password_hash: Mapped[str | None] = mapped_column(Text)

    # Approval workflow — see §12 in the PRD.
    status: Mapped[str] = mapped_column(
        String(20), default=UserStatus.pending.value, nullable=False
    )
    role: Mapped[str] = mapped_column(
        String(20), default=UserRole.user.value, nullable=False
    )

    # ── Onboarding profile ─────────────────────────────────────────
    # Collected by the post-signup wizard at /onboarding. JSONB so we can
    # add or remove questions without schema migrations. Shape:
    #   { age_range, location, profession, audience[], focus[], output_lang }
    # Each preset value lives alongside an optional `_other` free-text field.
    profile: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    onboarded_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        comment="Set when the user finishes the /onboarding wizard.",
    )

    # ── Weekly email digest opt-in ─────────────────────────────────
    # Default False — PDP §22 requires explicit consent for marketing
    # / informational emails. Toggled on via a UI prompt or onboarding.
    email_digest_opt_in: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    # Per-user opaque token used by the unsubscribe link in each
    # digest email — lets users opt out without logging in. Generated
    # on first opt-in.
    digest_unsubscribe_token: Mapped[str | None] = mapped_column(String(64))

    accounts: Mapped[list["Account"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class Account(Base):
    """OAuth provider link, populated by Auth.js when a user signs in via Google.

    Standard Auth.js schema (see https://authjs.dev/reference/core/adapters).
    One row per (provider, providerAccountId).
    """

    __tablename__ = "accounts"

    id: Mapped[UUID] = mapped_column(
        primary_key=True, default=uuid4, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    type: Mapped[str] = mapped_column(String(50), nullable=False)
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    provider_account_id: Mapped[str] = mapped_column(String(255), nullable=False)
    refresh_token: Mapped[str | None] = mapped_column(Text)
    access_token: Mapped[str | None] = mapped_column(Text)
    expires_at: Mapped[int | None] = mapped_column(Integer)
    token_type: Mapped[str | None] = mapped_column(String(50))
    scope: Mapped[str | None] = mapped_column(Text)
    id_token: Mapped[str | None] = mapped_column(Text)
    session_state: Mapped[str | None] = mapped_column(String(255))

    user: Mapped[User] = relationship(back_populates="accounts")

    __table_args__ = (
        UniqueConstraint("provider", "provider_account_id", name="uq_account_provider"),
    )


class VerificationToken(Base):
    """Used by Auth.js for email magic-link verification (deferred until email is wired)."""

    __tablename__ = "verification_tokens"

    identifier: Mapped[str] = mapped_column(String(255), nullable=False)
    token: Mapped[str] = mapped_column(String(255), nullable=False)
    expires: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        PrimaryKeyConstraint("identifier", "token", name="pk_verification_token"),
    )
