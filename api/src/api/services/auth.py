"""JWT verification + current-user dependency for FastAPI.

Auth.js (Next.js) signs JWTs using `NEXTAUTH_SECRET` and HS256. We verify them
here using the same secret. Claims layout (set by the Auth.js `jwt` callback):

    {
        "sub": "<user uuid>",
        "email": "user@example.com",
        "name": "...",
        "status": "approved" | "pending" | "rejected" | "blocked",
        "role": "user" | "admin" | "superadmin",
        "iat": 1234567890,
        "exp": 1234567890,
        "jti": "..."
    }
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

import jwt
import structlog
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import settings
from api.db import get_session
from api.models import User, UserStatus

log = structlog.get_logger()

_bearer = HTTPBearer(auto_error=False)


class _Claims:
    """Minimal typed wrapper around a verified JWT payload."""

    def __init__(self, payload: dict[str, object]) -> None:
        self.sub = str(payload["sub"])
        self.email = str(payload.get("email", ""))
        self.status = str(payload.get("status", UserStatus.pending.value))
        self.role = str(payload.get("role", "user"))


def _decode(token: str) -> _Claims:
    if settings.nextauth_secret is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Server missing NEXTAUTH_SECRET — auth disabled.",
        )
    try:
        payload = jwt.decode(
            token,
            settings.nextauth_secret,
            algorithms=["HS256"],
            options={"require": ["exp", "sub"]},
        )
    except jwt.ExpiredSignatureError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token expired") from e
    except jwt.InvalidTokenError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token") from e
    return _Claims(payload)


async def get_current_user(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> User:
    """Resolve the current user from an Authorization: Bearer <jwt> header.

    Raises 401 if no valid token. Raises 403 if the user's status is not
    `approved` (covers pending review, rejected, blocked).
    """
    if credentials is None:
        # Fall back to a session cookie set by the Next.js frontend in the
        # future; for now, header-only.
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")

    claims = _decode(credentials.credentials)

    user = (
        await session.execute(select(User).where(User.id == UUID(claims.sub)))
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found")
    if user.status != UserStatus.approved.value:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            f"Account is {user.status} — full access not yet granted.",
        )
    return user


async def get_optional_user(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> User | None:
    """Like `get_current_user` but returns None for unauthenticated requests.

    Use for endpoints that serve both anonymous (public insights) and signed-in users.
    """
    if credentials is None:
        return None
    try:
        return await get_current_user(request, credentials, session)
    except HTTPException:
        return None


CurrentUser = Annotated[User, Depends(get_current_user)]
OptionalUser = Annotated[User | None, Depends(get_optional_user)]
