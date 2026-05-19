from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from api.config import settings

# NullPool — each DB operation opens a fresh asyncpg connection and
# closes it on commit. We're paying a few ms per query for connection
# setup; in exchange we avoid the "Future attached to a different loop"
# crash that happens when Celery prefork workers reuse the engine
# across tasks (each task runs `asyncio.run()` with a fresh event loop,
# but the pool's existing connections were created on the previous,
# now-dead loop). FastAPI's single long-lived loop wouldn't need this,
# but the worker process is the same Python process importing the same
# module, so we err on the side of correctness everywhere.
engine = create_async_engine(
    settings.database_url,
    echo=False,
    poolclass=NullPool,
    pool_pre_ping=True,
)

SessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session
