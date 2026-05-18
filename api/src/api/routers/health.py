from fastapi import APIRouter
from pydantic import BaseModel

from api import __version__
from api.config import settings

router = APIRouter(tags=["meta"])


class HealthResponse(BaseModel):
    status: str
    version: str
    environment: str


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        version=__version__,
        environment=settings.environment,
    )
