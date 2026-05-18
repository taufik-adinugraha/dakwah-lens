"""Brief model.

A `Brief` is the structured advisory report described in PRD §03 — situation
summary, audience segmentation, supporting daleel, and content templates.
For the prototype the `content` JSONB blob holds all of that; once we settle
on a final schema we can promote individual sections to typed columns.
"""

from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import Boolean, ForeignKey, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.models.auth import User
from api.models.base import Base, TimestampMixin
from api.models.orgs import Organization


class Brief(Base, TimestampMixin):
    __tablename__ = "briefs"

    id: Mapped[UUID] = mapped_column(
        primary_key=True, default=uuid4, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    org_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True, index=True
    )

    # Inputs the user provided to the wizard.
    topic_title: Mapped[str] = mapped_column(Text, nullable=False)
    segment: Mapped[str] = mapped_column(String(50), nullable=False)
    tone: Mapped[str] = mapped_column(String(50), nullable=False)
    locale: Mapped[str] = mapped_column(String(8), nullable=False, default="en")

    # When True, the brief was produced by the deterministic placeholder
    # generator (no API key wired). Surface this prominently in the UI so
    # users know it's a stand-in for the real Claude-powered output.
    is_placeholder: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )

    # Structured brief content. See `services/briefs/generator.py` for the
    # exact shape — for now a permissive JSONB so we can iterate.
    content: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)

    # Optional human-readable status (draft / published / archived). Defaults
    # to "draft" so users can edit/re-generate before sharing.
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")

    user: Mapped[User] = relationship()
    organization: Mapped[Organization | None] = relationship()
