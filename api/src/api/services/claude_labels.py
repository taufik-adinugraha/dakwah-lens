"""Daily `theme_group` + `sentiment_label` labels by Claude, via the Message
Batches API (50% of standard price; most batches end within the hour).

Operator decision 2026-11-01: Claude is the theme + sentiment labeller of
record. The ingest-time Gemini call has failed since 2026-10-29 (depleted
prepay), leaving every new post with both labels NULL; this job is what fills
them. It runs on a separate key (`anthropic_labeling_api_key`, the org holding
the promotional Claude credit) so the spend never mixes with the briefing
fallback's `anthropic_api_key`.

Lifecycle — two Celery tasks (`workers/claude_jobs.py`):

  submit (00:00 WIB)  pick posts → one `ingest_runs` row (status=running)
                      → manifest file → one batch of POSTS_PER_REQUEST-post
                      requests
  poll  (every 10m)   for each manifest whose batch has ended: write the
                      labels, close the run row (success, items, cost), move
                      the manifest to done/

Which posts: every post that arrived since the last successful run, plus
every post still missing either label, whatever its age. A NULL label is a
failure state, not a category (the theme-audit lesson): a post whose request
errored stays NULL and is picked up again the next night, so nulls never age
out of scope. Newest first, capped at MAX_POSTS_PER_RUN.

What is written: `theme_group`, `sentiment_label`, and `sentiment_score =
NULL` — NULL score is the existing marker for a Claude label (the manual
`scripts/sent_relabel` pipeline writes the same).

The manifest (custom_id → post ids) lives on the persistent attachments
volume because the batch results carry only the custom_id; without the
manifest the results cannot be mapped back to posts.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import UUID

import structlog
from sqlalchemy import bindparam, func, or_, select, update

from api.config import settings
from api.db import SessionLocal
from api.models.admin import IngestRun
from api.models.social import SentimentLabel, SocialPost
from api.services import ingest_runs
from api.services.theme_groups import (
    ALL_GROUP_NAMES,
    llm_group_options_prompt,
    resolve_group_name,
)
from api.services.usage import PRICES

log = structlog.get_logger()

TASK_NAME = "claude_label_batch"
PLATFORM = "all"  # matches the admin pipeline page's (beatTask, beatPlatform)

POSTS_PER_REQUEST = 50
MAX_POSTS_PER_RUN = 15_000
TEXT_CHARS = 600  # same cut as the manual theme audit (scripts/theme_audit/fetch.sh)
MAX_TOKENS = 8_000  # ~25 tokens per label × 50, plus low-effort thinking
EFFORT = "low"

# Window when there is no successful run yet.
FIRST_RUN_LOOKBACK = timedelta(days=1)
# A run still `running` after this is treated as dead (batches end within
# 24h) and no longer blocks the next submit.
RUN_STALE_AFTER = timedelta(hours=30)
# A manifest with no batch id (submit died between writing it and the API
# call) is abandoned after this.
UNSUBMITTED_STALE_AFTER = timedelta(hours=1)
# A claimed manifest whose worker died mid-apply is released after this.
APPLYING_STALE_AFTER = timedelta(minutes=30)

# Batch price = half the standard price. The system prompt is cached with a
# 1h TTL: a 1h cache write costs 2x base input, a cache read 0.1x.
BATCH_DISCOUNT = 0.5
CACHE_WRITE_MULT = 2.0
CACHE_READ_MULT = 0.1

MANIFEST_DIR = Path(os.environ.get("CLAUDE_LABEL_BATCH_DIR", "/data/attachments/label-batches"))
PROMPT_DIR = Path(__file__).resolve().parent.parent / "prompts"

VALID_THEMES: list[str] = sorted(ALL_GROUP_NAMES)
VALID_SENTIMENTS: list[str] = [s.value for s in SentimentLabel]


# ─── prompt ──────────────────────────────────────────────────────────


def sentiment_rubric() -> str:
    """The manual relabel rubric minus its title and its TSV output
    contract — the batch answers in JSON, so that contract does not apply."""
    text = (PROMPT_DIR / "sentiment_rubric.md").read_text(encoding="utf-8")
    body = text.split("\n## Output contract", 1)[0].rstrip()
    body = body.removesuffix("---").rstrip()
    lines = body.splitlines()
    if lines and lines[0].startswith("# "):
        body = "\n".join(lines[1:]).strip()
    return body


def build_system_prompt() -> str:
    tmpl = (PROMPT_DIR / "label_batch_instructions.md").read_text(encoding="utf-8")
    return (
        tmpl.replace("{{RULEBOOK}}", llm_group_options_prompt())
        .replace("{{SENTIMENT_RUBRIC}}", sentiment_rubric())
        .replace("{{TEXT_CHARS}}", str(TEXT_CHARS))
    )


def output_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "labels": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "i": {"type": "integer"},
                        "theme": {"type": "string", "enum": VALID_THEMES},
                        "sentiment": {"type": "string", "enum": VALID_SENTIMENTS},
                    },
                    "required": ["i", "theme", "sentiment"],
                    "additionalProperties": False,
                },
            }
        },
        "required": ["labels"],
        "additionalProperties": False,
    }


def clean_text(text: str | None) -> str:
    t = " ".join((text or "").split())
    return t if len(t) <= TEXT_CHARS else t[:TEXT_CHARS].rstrip() + "…"


def build_user_message(texts: list[str]) -> str:
    return "\n".join(f"[{i}] {clean_text(t)}" for i, t in enumerate(texts))


def build_request_params(system_prompt: str, texts: list[str], *, model: str) -> dict[str, Any]:
    return {
        "model": model,
        "max_tokens": MAX_TOKENS,
        "system": [
            {
                "type": "text",
                "text": system_prompt,
                "cache_control": {"type": "ephemeral", "ttl": "1h"},
            }
        ],
        "messages": [{"role": "user", "content": build_user_message(texts)}],
        "output_config": {
            "effort": EFFORT,
            "format": {"type": "json_schema", "schema": output_schema()},
        },
    }


# ─── results ─────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Label:
    theme: str
    sentiment: str


def parse_labels(text: str, n: int) -> tuple[dict[int, Label], list[str]]:
    """Map the model's JSON back to positions 0..n-1.

    An index outside the range, an index given twice, or a value outside
    the label sets is dropped (an index given twice is dropped entirely —
    which of the two is right is unknowable). Dropped and missing posts
    keep their current labels; NULL ones are retried next night."""
    try:
        entries = json.loads(text).get("labels", [])
    except (json.JSONDecodeError, AttributeError):
        return {}, ["unparseable JSON"]
    out: dict[int, Label] = {}
    twice: set[int] = set()
    problems: list[str] = []
    for e in entries:
        if not isinstance(e, dict):
            problems.append("non-object entry")
            continue
        i = e.get("i")
        if not isinstance(i, int) or isinstance(i, bool) or not 0 <= i < n:
            problems.append(f"index {i!r} out of range")
            continue
        theme = resolve_group_name(e.get("theme"))
        sentiment = str(e.get("sentiment", "")).strip().lower()
        if theme is None or sentiment not in VALID_SENTIMENTS:
            problems.append(f"index {i}: invalid label")
            continue
        if i in out:
            twice.add(i)
            continue
        out[i] = Label(theme, sentiment)
    for i in twice:
        out.pop(i, None)
        problems.append(f"index {i} labelled twice")
    if len(out) < n:
        problems.append(f"{n - len(out)} of {n} posts unlabelled")
    return out, problems


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_write_tokens: int = 0
    cache_read_tokens: int = 0

    def add(self, u: Any) -> None:
        self.input_tokens += getattr(u, "input_tokens", 0) or 0
        self.output_tokens += getattr(u, "output_tokens", 0) or 0
        self.cache_write_tokens += getattr(u, "cache_creation_input_tokens", 0) or 0
        self.cache_read_tokens += getattr(u, "cache_read_input_tokens", 0) or 0

    @property
    def tokens_in(self) -> int:
        return self.input_tokens + self.cache_write_tokens + self.cache_read_tokens


def cost_usd(model: str, usage: Usage, *, discount: float = BATCH_DISCOUNT) -> float:
    """Price `usage` from `usage.PRICES`; 0.0 for an unpriced model (better
    to under-report than invent a number, as `estimate_cost` does)."""
    table = PRICES.get("anthropic", {})
    rin = table.get(f"{model}_in")
    rout = table.get(f"{model}_out")
    if rin is None or rout is None:
        return 0.0
    full = (
        usage.input_tokens * rin
        + usage.cache_write_tokens * rin * CACHE_WRITE_MULT
        + usage.cache_read_tokens * rin * CACHE_READ_MULT
        + usage.output_tokens * rout
    ) / 1_000_000
    return full * discount


@dataclass
class AppliedBatch:
    run_id: str
    batch_id: str
    model: str
    posts_sent: int = 0
    posts_labelled: int = 0
    requests_failed: int = 0
    problems: list[str] = field(default_factory=list)
    usage: Usage = field(default_factory=Usage)
    started_at: str = ""

    @property
    def cost_usd(self) -> float:
        return cost_usd(self.model, self.usage)


def collect_updates(
    manifest: dict[str, Any], results: Any, applied: AppliedBatch
) -> list[dict[str, Any]]:
    """Turn batch results into row updates; counts failures on `applied`."""
    requests: dict[str, list[str]] = manifest["requests"]
    updates: list[dict[str, Any]] = []
    for r in results:
        ids = requests.get(r.custom_id)
        if ids is None:
            applied.problems.append(f"{r.custom_id}: unknown custom_id")
            continue
        res = r.result
        if res.type != "succeeded":
            applied.requests_failed += 1
            applied.problems.append(f"{r.custom_id}: {res.type}")
            continue
        msg = res.message
        applied.usage.add(msg.usage)
        if msg.stop_reason != "end_turn":
            applied.requests_failed += 1
            applied.problems.append(f"{r.custom_id}: stop_reason={msg.stop_reason}")
            continue
        text = next((b.text for b in msg.content if b.type == "text"), "")
        labels, problems = parse_labels(text, len(ids))
        applied.problems.extend(f"{r.custom_id}: {p}" for p in problems)
        for i, lab in labels.items():
            updates.append({"b_id": UUID(ids[i]), "b_theme": lab.theme, "b_sent": lab.sentiment})
    return updates


# ─── manifest files ──────────────────────────────────────────────────


def _done_dir() -> Path:
    return MANIFEST_DIR / "done"


def _write_json(path: Path, data: dict[str, Any]) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data), encoding="utf-8")
    tmp.replace(path)


def _age(data: dict[str, Any], now: datetime) -> timedelta:
    return now - datetime.fromisoformat(data["created_at"])


def make_client() -> Any:
    import anthropic

    return anthropic.Anthropic(api_key=settings.anthropic_labeling_api_key)


# ─── submit ──────────────────────────────────────────────────────────


async def _blocking_run(session: Any, now: datetime) -> IngestRun | None:
    return await session.scalar(
        select(IngestRun)
        .where(
            IngestRun.task_name == TASK_NAME,
            IngestRun.status == "running",
            IngestRun.started_at >= now - RUN_STALE_AFTER,
        )
        .order_by(IngestRun.started_at.desc())
        .limit(1)
    )


async def _window_start(session: Any, now: datetime) -> datetime:
    last = await session.scalar(
        select(func.max(IngestRun.started_at)).where(
            IngestRun.task_name == TASK_NAME, IngestRun.status == "success"
        )
    )
    return last or now - FIRST_RUN_LOOKBACK


async def select_posts(session: Any, since: datetime) -> list[tuple[UUID, str]]:
    res = await session.execute(
        select(SocialPost.id, SocialPost.text)
        .where(
            or_(
                SocialPost.theme_group.is_(None),
                SocialPost.sentiment_label.is_(None),
                SocialPost.created_at >= since,
            )
        )
        .order_by(SocialPost.created_at.desc())
        .limit(MAX_POSTS_PER_RUN)
    )
    return [(row.id, row.text) for row in res.all()]


async def submit_daily_batch(client: Any | None = None) -> dict[str, Any]:
    """Pick the posts and submit one batch. Returns a summary dict."""
    now = datetime.now(UTC)
    async with SessionLocal() as session:
        blocking = await _blocking_run(session, now)
        if blocking is not None:
            log.info("claude_labels.previous_run_pending", run_id=str(blocking.id))
            return {"skipped": "previous batch not applied yet", "run_id": str(blocking.id)}
        since = await _window_start(session, now)

    # Open the run row BEFORE selecting: the next window starts at this
    # row's started_at, so windows overlap by a moment instead of leaving
    # a gap that posts arriving mid-selection could fall into.
    run_id = await ingest_runs.start_run(TASK_NAME, platform=PLATFORM)
    try:
        async with SessionLocal() as session:
            posts = await select_posts(session, since)
    except Exception as exc:
        await ingest_runs.finish_run(run_id, status="failed", error=f"select: {exc}")
        raise
    if not posts:
        await ingest_runs.finish_run(run_id, status="success", items_scraped=0, items_stored=0)
        return {"run_id": str(run_id), "posts": 0}

    model = settings.labeling_model
    system_prompt = build_system_prompt()
    chunks = [posts[k : k + POSTS_PER_REQUEST] for k in range(0, len(posts), POSTS_PER_REQUEST)]
    manifest: dict[str, Any] = {
        "run_id": str(run_id),
        "batch_id": None,
        "model": model,
        "created_at": now.isoformat(),
        "since": since.isoformat(),
        "n_posts": len(posts),
        "requests": {f"r{n:05d}": [str(pid) for pid, _ in chunk] for n, chunk in enumerate(chunks)},
    }
    MANIFEST_DIR.mkdir(parents=True, exist_ok=True)
    path = MANIFEST_DIR / f"{run_id}.json"
    client = client or make_client()
    batch = None
    try:
        _write_json(path, manifest)
        batch = client.messages.batches.create(
            requests=[
                {
                    "custom_id": f"r{n:05d}",
                    "params": build_request_params(
                        system_prompt, [t for _, t in chunk], model=model
                    ),
                }
                for n, chunk in enumerate(chunks)
            ]
        )
        manifest["batch_id"] = batch.id
        _write_json(path, manifest)
    except Exception as exc:
        if batch is not None:
            # Created but the manifest could not record it: its results
            # could never be mapped back to posts, so stop paying for it.
            try:
                client.messages.batches.cancel(batch.id)
            except Exception:
                log.exception("claude_labels.cancel_failed", batch_id=batch.id)
        path.unlink(missing_ok=True)
        await ingest_runs.finish_run(
            run_id, status="failed", items_scraped=len(posts), error=f"submit: {exc}"
        )
        raise
    log.info(
        "claude_labels.submitted",
        run_id=str(run_id),
        batch_id=batch.id,
        posts=len(posts),
        requests=len(chunks),
        since=since.isoformat(),
    )
    return {
        "run_id": str(run_id),
        "batch_id": batch.id,
        "posts": len(posts),
        "requests": len(chunks),
    }


# ─── poll + apply ────────────────────────────────────────────────────


async def _write_updates(updates: list[dict[str, Any]]) -> None:
    table = SocialPost.__table__
    stmt = (
        update(table)
        .where(table.c.id == bindparam("b_id"))
        .values(
            theme_group=bindparam("b_theme"),
            sentiment_label=bindparam("b_sent"),
            sentiment_score=None,
        )
    )
    async with SessionLocal() as session:
        for k in range(0, len(updates), 1000):
            await session.execute(stmt, updates[k : k + 1000])
        await session.commit()


def _release_stale_claims(now: datetime) -> None:
    for claimed in MANIFEST_DIR.glob("*.applying"):
        age = now - datetime.fromtimestamp(claimed.stat().st_mtime, UTC)
        if age > APPLYING_STALE_AFTER:
            claimed.replace(claimed.with_suffix(".json"))


async def poll_batches(client: Any | None = None) -> list[AppliedBatch]:
    """Apply every batch that has ended. Returns what was applied."""
    if not MANIFEST_DIR.is_dir():
        return []
    now = datetime.now(UTC)
    _release_stale_claims(now)
    applied_all: list[AppliedBatch] = []
    for path in sorted(MANIFEST_DIR.glob("*.json")):
        manifest = json.loads(path.read_text(encoding="utf-8"))
        run_id = UUID(manifest["run_id"])
        if not manifest.get("batch_id"):
            if _age(manifest, now) > UNSUBMITTED_STALE_AFTER:
                await ingest_runs.finish_run(
                    run_id, status="failed", error="submit died before the batch was created"
                )
                path.unlink(missing_ok=True)
            continue

        client = client or make_client()
        try:
            batch = client.messages.batches.retrieve(manifest["batch_id"])
        except Exception:
            log.exception("claude_labels.retrieve_failed", batch_id=manifest["batch_id"])
            continue
        if batch.processing_status != "ended":
            continue

        claimed = path.with_suffix(".applying")
        try:
            path.replace(claimed)
        except FileNotFoundError:
            continue  # another poll got it
        applied = AppliedBatch(
            run_id=manifest["run_id"],
            batch_id=manifest["batch_id"],
            model=manifest["model"],
            posts_sent=manifest["n_posts"],
            started_at=manifest["created_at"],
        )
        try:
            updates = collect_updates(
                manifest, client.messages.batches.results(manifest["batch_id"]), applied
            )
            await _write_updates(updates)
            applied.posts_labelled = len(updates)
            warning = None
            if applied.problems:
                head = "; ".join(applied.problems[:8])
                more = len(applied.problems) - 8
                warning = f"{len(applied.problems)} problems: {head}" + (
                    f" … (+{more})" if more > 0 else ""
                )
            # Nothing labelled → `failed`, so the next submit's window still
            # starts at the last good run and re-covers these arrivals.
            await ingest_runs.finish_run(
                run_id,
                status="success" if applied.posts_labelled else "failed",
                items_scraped=applied.posts_sent,
                items_stored=applied.posts_labelled,
                cost_usd=round(applied.cost_usd, 4),
                error=warning,
            )
        except Exception:
            claimed.replace(path)  # leave it for the next poll
            log.exception("claude_labels.apply_failed", batch_id=manifest["batch_id"])
            continue
        _done_dir().mkdir(exist_ok=True)
        claimed.replace(_done_dir() / path.name)
        log.info(
            "claude_labels.applied",
            run_id=applied.run_id,
            batch_id=applied.batch_id,
            sent=applied.posts_sent,
            labelled=applied.posts_labelled,
            requests_failed=applied.requests_failed,
            cost_usd=round(applied.cost_usd, 4),
        )
        applied_all.append(applied)
    return applied_all
