"""The `social_posts.created_at` index: the migration, the model and the build agree.

Operator, 2026-11-04: "add created at index", after the landing page was found
to read the whole table to count 30 days of posts. Seven queries (the landing
count, the pipeline page's count and four on /dashboard, plus the label batch's
select, which the index does not serve) filter on `created_at`, which had no
index, and each was a 2-3 s seq scan of a 638 MB heap.

There is no database in the test run, so this checks what can be checked
without one:
  - the migration renders the SQL it should, as a concurrent, idempotent build
    outside a transaction (CREATE INDEX CONCURRENTLY refuses to run inside one,
    and a plain build would stop ingest writing for its whole length);
  - the model declares the same index, so `alembic revision --autogenerate`
    does not propose to drop it;
  - a build that was cut off (an INVALID index of the same name) is dropped and
    rebuilt rather than skipped for good by IF NOT EXISTS.
How the planner uses it is read off EXPLAIN on the real table after deploy.
"""

from __future__ import annotations

import contextlib
import importlib.util
import io
import re
from pathlib import Path
from types import SimpleNamespace

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory

from alembic import command
from api.models import SocialPost

ALEMBIC = Path(__file__).resolve().parents[1] / "alembic"
PREVIOUS = "d4e5f6g7h8i9"
REVISION = "a3f9c2e8b5d1"
INDEX = "ix_social_posts_created_at"


def _config() -> Config:
    # No ini file on purpose: env.py would then call logging.config.fileConfig, which
    # switches off the loggers other tests read.
    cfg = Config()
    cfg.set_main_option("script_location", str(ALEMBIC))
    return cfg


def _sql(start: str, end: str, *, down: bool = False) -> str:
    """The SQL alembic would emit for start:end, without connecting anywhere."""
    cfg = _config()
    cfg.output_buffer = io.StringIO()
    (command.downgrade if down else command.upgrade)(cfg, f"{start}:{end}", sql=True)
    return cfg.output_buffer.getvalue()


def _migration():
    (path,) = (ALEMBIC / "versions").glob("*_social_posts_created_at_index.py")
    spec = importlib.util.spec_from_file_location("social_posts_created_at_index", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_revision_follows_the_previous_head_and_history_has_one_head():
    script = ScriptDirectory.from_config(_config())
    assert script.get_revision(REVISION).down_revision == PREVIOUS
    assert len(script.get_heads()) == 1, "two migrations branch from the same parent"


def test_upgrade_builds_the_index_concurrently_outside_a_transaction():
    sql = _sql(PREVIOUS, REVISION)
    # COMMIT before and BEGIN after: alembic's autocommit block, so the build is not inside
    # the transaction env.py wraps the run in.
    assert re.search(
        r"COMMIT;\s+CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_social_posts_created_at "
        r"ON social_posts \(created_at\) INCLUDE \([^)]+\);\s+BEGIN;",
        sql,
    ), sql
    assert f"UPDATE alembic_version SET version_num='{REVISION}'" in sql


def test_downgrade_drops_it_concurrently():
    sql = _sql(REVISION, PREVIOUS, down=True)
    assert re.search(
        r"COMMIT;\s+DROP INDEX CONCURRENTLY IF EXISTS ix_social_posts_created_at;\s+BEGIN;",
        sql,
    ), sql


def test_the_model_declares_the_index_the_migration_builds():
    index = next(i for i in SocialPost.__table__.indexes if i.name == INDEX)
    assert [c.name for c in index.columns] == ["created_at"]
    assert not index.unique
    built = re.search(r"INCLUDE \(([^)]+)\)", _sql(PREVIOUS, REVISION))
    assert built, "the migration builds no INCLUDE list"
    assert index.dialect_options["postgresql"]["include"] == [
        c.strip() for c in built.group(1).split(",")
    ]


class _FakeOp:
    """`op` while a migration runs online, minus the database: records what it was asked."""

    def __init__(self, index_valid: bool | None):
        self.index_valid = index_valid
        self.calls: list[tuple] = []

    def get_context(self):
        calls = self.calls

        @contextlib.contextmanager
        def autocommit_block():
            calls.append(("enter",))
            yield
            calls.append(("exit",))

        return SimpleNamespace(as_sql=False, autocommit_block=autocommit_block)

    def get_bind(self):
        valid = self.index_valid
        return SimpleNamespace(execute=lambda *_a, **_k: SimpleNamespace(scalar=lambda: valid))

    def drop_index(self, name, **kw):
        self.calls.append(("drop", name, kw))

    def create_index(self, name, table, columns, **kw):
        self.calls.append(("create", name, table, columns, kw))


@pytest.mark.parametrize(
    ("index_valid", "steps"),
    [
        (None, ["create"]),  # no such index: build it
        (True, ["create"]),  # already there and valid: IF NOT EXISTS makes this a no-op
        (False, ["drop", "create"]),  # a cut-off build left it INVALID: remove it, build again
    ],
    ids=["absent", "valid", "cut-off"],
)
def test_a_cut_off_build_is_replaced_not_skipped(monkeypatch, index_valid, steps):
    module = _migration()
    fake = _FakeOp(index_valid)
    monkeypatch.setattr(module, "op", fake)
    module.upgrade()

    assert [c[0] for c in fake.calls] == ["enter", *steps, "exit"], "everything inside the block"
    created = next(c for c in fake.calls if c[0] == "create")
    assert created[1:4] == (INDEX, "social_posts", ["created_at"])
    assert created[4]["postgresql_concurrently"] is True
    assert created[4]["if_not_exists"] is True
    for dropped in (c for c in fake.calls if c[0] == "drop"):
        assert dropped[1] == INDEX
        assert dropped[2]["postgresql_concurrently"] is True
