"""Multi-tenant organization models."""

from enum import Enum
from uuid import UUID, uuid4

from sqlalchemy import ForeignKey, String, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.models.auth import User
from api.models.base import Base, TimestampMixin


class OrgRole(str, Enum):
    owner = "owner"
    admin = "admin"
    member = "member"


class Organization(Base, TimestampMixin):
    __tablename__ = "organizations"

    id: Mapped[UUID] = mapped_column(
        primary_key=True, default=uuid4, server_default=text("gen_random_uuid()")
    )
    slug: Mapped[str] = mapped_column(String(63), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    members: Mapped[list["OrgMember"]] = relationship(
        back_populates="organization", cascade="all, delete-orphan"
    )


class OrgMember(Base, TimestampMixin):
    __tablename__ = "org_members"

    id: Mapped[UUID] = mapped_column(
        primary_key=True, default=uuid4, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    org_id: Mapped[UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(String(20), default=OrgRole.member.value, nullable=False)

    user: Mapped[User] = relationship()
    organization: Mapped[Organization] = relationship(back_populates="members")

    __table_args__ = (UniqueConstraint("user_id", "org_id", name="uq_org_member"),)
