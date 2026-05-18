from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.config import settings
from api.routers import health, users

log = structlog.get_logger()


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    log.info("api.startup", env=settings.environment)
    yield
    log.info("api.shutdown")


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description=(
        "Backend for DakwahLens — ingests Indonesian media, scores da'wah relevance, "
        "and generates kitab-grounded briefs."
    ),
    lifespan=lifespan,
)

# Refuse the wildcard-with-credentials combo at startup — it's a config
# footgun that turns any origin into an authorized one. If you actually
# want a public unauthenticated API, drop `allow_credentials`.
if "*" in settings.cors_origins and len(settings.cors_origins) == 1:
    raise RuntimeError(
        "CORS misconfig: allow_origins=['*'] with allow_credentials=True is "
        "insecure. Set CORS_ORIGINS to an explicit comma-separated list."
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    # Explicit allowlists — wildcards here mean a future endpoint that
    # accepts unusual headers / methods (PATCH, DELETE) won't accidentally
    # become reachable cross-origin without an explicit decision.
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type", "X-Requested-With"],
    max_age=600,
)

app.include_router(health.router)
app.include_router(users.router)
