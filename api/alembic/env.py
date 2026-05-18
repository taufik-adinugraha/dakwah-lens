"""Alembic migration environment.

Uses a SYNC SQLAlchemy engine (psycopg2) — even though the app runs async,
migrations are a one-shot CLI operation where blocking is fine and avoids
needing async-friendly migration recipes.
"""

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from api.config import settings
from api.models import Base  # noqa: F401 — registers all models

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Resolve the URL: convert async driver → sync for Alembic.
sync_url = settings.database_url.replace("+asyncpg", "")
config.set_main_option("sqlalchemy.url", sync_url)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode — emits SQL without connecting."""
    context.configure(
        url=sync_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode — actually connects and applies."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
