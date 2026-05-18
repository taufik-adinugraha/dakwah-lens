from fastapi import APIRouter
from pydantic import BaseModel, EmailStr

from api.models import User
from api.services.auth import CurrentUser

router = APIRouter(prefix="/users", tags=["users"])


class UserProfile(BaseModel):
    id: str
    email: EmailStr
    name: str | None
    image: str | None
    status: str
    role: str

    @classmethod
    def from_db(cls, user: User) -> "UserProfile":
        return cls(
            id=str(user.id),
            email=user.email,
            name=user.name,
            image=user.image,
            status=user.status,
            role=user.role,
        )


@router.get("/me", response_model=UserProfile)
async def get_me(user: CurrentUser) -> UserProfile:
    """Return the authenticated user's profile.

    Requires a valid Auth.js-issued JWT in the `Authorization: Bearer …` header
    AND `status == approved`. Pending users get 403.
    """
    return UserProfile.from_db(user)
