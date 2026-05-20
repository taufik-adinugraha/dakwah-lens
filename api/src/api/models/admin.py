"""Admin / observability tables.

These tables back the `/admin/system` superadmin dashboard. They're append-only
event logs plus two configuration tables (RSS feeds, manual cost entries).

Tables in this module:
  - `usage_events`        — every paid API call (OpenAI, Gemini, Anthropic,
                            Apify, YouTube) with token counts + cost in USD.
                            Source for the "API costs" tab.
  - `system_metrics`      — psutil snapshot rows captured by Celery beat
                            every minute. Source for the CPU/mem/disk
                            charts on the "Infra" tab.
  - `ingest_runs`         — start/finish records for every Celery ingest
                            task (per platform + the BERTopic re-cluster).
                            Source for the "Pipeline health" tab.
  - `rss_feeds`           — configurable list of mainstream news RSS URLs.
                            Was a hardcoded dict in `services/rss.py`.
  - `manual_costs`        — human-entered cost rows for non-API spend
                            (VPS at IDCloudHost, domain renewal, etc).
  - `page_views`          — every request to a Next.js page route, signed-in
                            or anonymous. Source for the "Analytics" tab.

All tables are write-heavy but read in aggregate, so we index on the time
column + the natural filter (provider, platform, path). Retention isn't
configured — at prototype scale a few months fits comfortably in Postgres.
"""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from api.models.base import Base, TimestampMixin


class UsageEvent(Base):
    """One paid API call. Append-only — never updated after insert."""

    __tablename__ = "usage_events"

    id: Mapped[UUID] = mapped_column(
        primary_key=True, default=uuid4, server_default=text("gen_random_uuid()")
    )
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
        index=True,
    )
    provider: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    """One of: openai, gemini, anthropic, apify, youtube."""

    model: Mapped[str | None] = mapped_column(String(128))
    """Model name where applicable (`gpt-4o-mini`, `claude-sonnet-4-5`, …).
    For Apify this is the actor id; for YouTube it's the endpoint."""

    operation: Mapped[str] = mapped_column(String(64), nullable=False)
    """High-level operation tag: `embedding`, `classify_relevance`,
    `synth_brief`, `scrape`, `search`. Lets us group costs by feature."""

    tokens_in: Mapped[int | None] = mapped_column(Integer)
    tokens_out: Mapped[int | None] = mapped_column(Integer)
    units: Mapped[int | None] = mapped_column(Integer)
    """For non-token APIs (YouTube Data API uses 'quota units', Apify uses
    'items processed'). One of (tokens_in/out, units) is set, not both."""

    cost_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    meta: Mapped[dict | None] = mapped_column(JSONB)
    """Free-form: actor run_id for Apify, request id for OpenAI, etc."""

    __table_args__ = (
        Index("ix_usage_events_provider_time", "provider", "occurred_at"),
    )


class SystemMetric(Base):
    """One psutil snapshot — captured every minute by a Celery beat task."""

    __tablename__ = "system_metrics"

    id: Mapped[UUID] = mapped_column(
        primary_key=True, default=uuid4, server_default=text("gen_random_uuid()")
    )
    captured_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
        index=True,
    )
    cpu_pct: Mapped[float] = mapped_column(Float, nullable=False)
    """0-100. `psutil.cpu_percent(interval=1.0)` — wall-clock average over 1s."""

    mem_used_mb: Mapped[float] = mapped_column(Float, nullable=False)
    mem_total_mb: Mapped[float] = mapped_column(Float, nullable=False)

    disk_used_gb: Mapped[float] = mapped_column(Float, nullable=False)
    disk_total_gb: Mapped[float] = mapped_column(Float, nullable=False)

    load_1m: Mapped[float | None] = mapped_column(Float)
    """1-minute load average (UNIX). None on platforms without `getloadavg`."""


class IngestRun(Base):
    """Lifecycle record for one ingest task. Updated once at start, once at
    finish. Used to populate the 'Pipeline health' tab and to flag stuck runs.
    """

    __tablename__ = "ingest_runs"

    id: Mapped[UUID] = mapped_column(
        primary_key=True, default=uuid4, server_default=text("gen_random_uuid()")
    )
    task_name: Mapped[str] = mapped_column(String(128), nullable=False)
    platform: Mapped[str | None] = mapped_column(String(20), index=True)
    """NULL for cross-platform tasks like `recluster_all`."""

    status: Mapped[str] = mapped_column(String(20), nullable=False)
    """One of: running, success, failed."""

    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    items_scraped: Mapped[int | None] = mapped_column(Integer)
    items_stored: Mapped[int | None] = mapped_column(Integer)
    cost_usd: Mapped[float | None] = mapped_column(Float)

    error: Mapped[str | None] = mapped_column(Text)


class RssFeed(Base, TimestampMixin):
    """One configurable RSS source for the `mainstream` ingest platform."""

    __tablename__ = "rss_feeds"

    id: Mapped[UUID] = mapped_column(
        primary_key=True, default=uuid4, server_default=text("gen_random_uuid()")
    )
    name: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    """Outlet name used as the post `author` (Kompas, Detik, …)."""

    url: Mapped[str] = mapped_column(Text, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    scope: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=text("'national'"), index=True
    )
    """One of `national` or `regional`. Posts inherit this via `region`."""

    region: Mapped[str | None] = mapped_column(String(32), index=True)
    """Region code matching `UserProfile.location` (jabodetabek, jawa_barat,
    …). Required when `scope = 'regional'`, NULL otherwise."""

    fetch_body: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
    """When TRUE, the scraper follows each RSS item's `link` to extract the
    full article body via trafilatura. **On by default** — most outlet RSS
    ledes are too thin for the relevance classifier; flip OFF only when an
    outlet's RSS body is already substantive enough or you need to cut
    ingest time. Extra latency: ~5s per article fetch + 1s politeness per
    same-host request."""

    __table_args__ = (UniqueConstraint("name", name="uq_rss_feed_name"),)


class YoutubeChannel(Base, TimestampMixin):
    """One whitelisted YouTube channel — replaces the rotating-keyword
    strategy for the `youtube` platform.

    We hit `playlistItems.list` on each channel's auto-generated uploads
    playlist (`UU` + channel_id suffix), which is 1 quota unit per call
    vs. 100 for `search.list`. The curator picks the bucket via
    `category` (religious / family / youth / muamalah / social_justice /
    health / education / cultural — note: `current_events` was dropped
    after curation because Najwa / Narasi / Watchdoc cover that beat
    from `social_justice`).
    """

    __tablename__ = "youtube_channels"

    id: Mapped[UUID] = mapped_column(
        primary_key=True, default=uuid4, server_default=text("gen_random_uuid()")
    )
    channel_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    """YT-issued ID, e.g. `UCu7AHrqzz1ggvNCH8mqg9PA`. We derive the
    uploads playlist by replacing the leading `UC` with `UU`."""

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    """Display name. Used as `author` on the resulting social_posts rows
    and shown in the admin UI."""

    handle: Mapped[str | None] = mapped_column(String(128))
    """Optional @handle for human readability in the admin UI. Not used
    for scraping (handle → channel_id resolution happens once at seed time)."""

    category: Mapped[str] = mapped_column(String(32), nullable=False)
    """One of: religious, family, youth, muamalah, social_justice, health,
    education, cultural."""

    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    last_run_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        comment="Updated each time this channel is scraped. NULL = never; "
        "picked first on rotation.",
    )


class ManualCost(Base, TimestampMixin):
    """Human-entered cost line. Used for VPS + domain spend that we pay
    flat-rate outside of any metered API."""

    __tablename__ = "manual_costs"

    id: Mapped[UUID] = mapped_column(
        primary_key=True, default=uuid4, server_default=text("gen_random_uuid()")
    )
    kind: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    """One of: infra (monthly), domain (yearly), other."""

    vendor: Mapped[str] = mapped_column(String(64), nullable=False)
    """e.g. 'IDCloudHost', 'Niagahoster'."""

    period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    period_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    """Inclusive billing window."""

    amount_idr: Mapped[float] = mapped_column(Float, nullable=False)
    note: Mapped[str | None] = mapped_column(Text)

    covers_provider: Mapped[str | None] = mapped_column(String(32))
    """When this row is a flat-rate subscription covering a metered
    provider (e.g. Apify Starter), set to the provider name so the
    cost totals on the admin pages exclude that provider's usage_events
    for the period — avoids double-counting. NULL for pure-infra
    rows (VPS, domain)."""

    # Optional invoice file. Path is the on-disk filename under
    # UPLOAD_DIR (UUID-based, never user-supplied). Filename is the
    # original name for display/download — never trusted for the
    # filesystem path.
    attachment_path: Mapped[str | None] = mapped_column(Text)
    attachment_filename: Mapped[str | None] = mapped_column(Text)
    attachment_size_bytes: Mapped[int | None] = mapped_column(Integer)
    attachment_mime_type: Mapped[str | None] = mapped_column(String(64))


class AppSetting(Base, TimestampMixin):
    """Single-row-per-key config table for runtime-editable settings.

    Currently used for the USD→IDR display rate (key=`usd_to_idr`). Kept as
    text so future settings can land here without per-key migrations: parse
    on read in `lib/settings.ts`.
    """

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)


class Donation(Base, TimestampMixin):
    """Human-entered donation receipt.

    Counterpart of `ManualCost` on the income side. Surfaced on the public
    `/transparency` page so the team can be open about money coming in.
    Donor identity is shown only when `is_anonymous = False`.
    """

    __tablename__ = "donations"

    id: Mapped[UUID] = mapped_column(
        primary_key=True, default=uuid4, server_default=text("gen_random_uuid()")
    )
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    amount_idr: Mapped[float] = mapped_column(Float, nullable=False)
    donor: Mapped[str | None] = mapped_column(String(120))
    """Donor's display name. NULL when anonymous or unknown."""

    is_anonymous: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    """When TRUE, the public page shows 'Anonymous' regardless of `donor`."""

    channel: Mapped[str | None] = mapped_column(String(32))
    """How the donation came in: bank_transfer / qris / cash / other."""

    note: Mapped[str | None] = mapped_column(Text)

    # Optional receipt file. Same shape as ManualCost.attachment_*.
    attachment_path: Mapped[str | None] = mapped_column(Text)
    attachment_filename: Mapped[str | None] = mapped_column(Text)
    attachment_size_bytes: Mapped[int | None] = mapped_column(Integer)
    attachment_mime_type: Mapped[str | None] = mapped_column(String(64))


class IngestQuery(Base, TimestampMixin):
    """One scrape keyword for one platform.

    The Celery rotating-ingest task pulls the least-recently-used row per
    platform on each tick. This lets the team mix religious vocabulary
    (e.g. `dakwah`, `khutbah`) with societal-concern queries (e.g. `pinjol`,
    `mental health`) — letting the Gemini relevance classifier downstream
    decide which surfaced posts are da'wah-worthy, instead of pre-filtering
    in a religious bubble.
    """

    __tablename__ = "ingest_queries"

    id: Mapped[UUID] = mapped_column(
        primary_key=True, default=uuid4, server_default=text("gen_random_uuid()")
    )
    platform: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    """Platform this query runs against: x / instagram / tiktok / youtube."""

    query: Mapped[str] = mapped_column(String(160), nullable=False)
    """Raw query string. Hashtag prefixes (#) are added/stripped per platform
    by the scraper wrappers — store the canonical word."""

    category: Mapped[str | None] = mapped_column(String(32))
    """Optional grouping label: religious / family / youth / muamalah /
    social_justice / education / health / cultural / current_events. Purely
    organizational — no behavior depends on it."""

    enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )

    last_run_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        comment="Updated by the rotating task each time this query runs. "
        "NULL = never used; picked first on next rotation.",
    )

    __table_args__ = (
        UniqueConstraint("platform", "query", name="uq_ingest_query_platform"),
        Index("ix_ingest_queries_platform_enabled", "platform", "enabled"),
    )


class ContactMessage(Base, TimestampMixin):
    """Inbound message from the public /contact form.

    Persisted so admins can see history even if the forwarded email gets
    lost in spam. Surfaced at `/admin/system/inbox`.
    """

    __tablename__ = "contact_messages"

    id: Mapped[UUID] = mapped_column(
        primary_key=True, default=uuid4, server_default=text("gen_random_uuid()")
    )
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
        index=True,
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    """Reply-to address typed by the sender. We do not verify it; admin
    replies via their own mail client + this field as the destination."""

    subject: Mapped[str | None] = mapped_column(String(200))
    message: Mapped[str] = mapped_column(Text, nullable=False)

    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        server_default=text("'new'"),
        index=True,
    )
    """One of: new, read, archived. Soft-state for the admin inbox."""


class PageView(Base):
    """One page render. Signed-in user OR anonymous session-cookie scoped."""

    __tablename__ = "page_views"

    id: Mapped[UUID] = mapped_column(
        primary_key=True, default=uuid4, server_default=text("gen_random_uuid()")
    )
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
        index=True,
    )
    path: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    """Stripped of locale prefix and query string — `/insights/x` not `/en/insights/x?q=…`."""

    locale: Mapped[str | None] = mapped_column(String(8))
    user_id: Mapped[UUID | None] = mapped_column()
    """No FK on purpose: a deleted user shouldn't cascade-delete their history
    (and we frequently scrub PII without dropping analytics)."""

    session_id: Mapped[str | None] = mapped_column(String(64))
    """Random ID set in an httpOnly cookie. Same value across a visitor's
    session, never tied back to identity. Lets us count distinct visitors
    without storing IPs."""

    referer: Mapped[str | None] = mapped_column(Text)
    user_agent: Mapped[str | None] = mapped_column(Text)


class TermsVersion(Base):
    """One row per published Terms of Service version.

    Inserted on first admin page load after `TERMS_VERSION` in the web
    code drifts from the latest row here. Append-only.
    """

    __tablename__ = "terms_versions"

    id: Mapped[UUID] = mapped_column(
        primary_key=True, default=uuid4, server_default=text("gen_random_uuid()")
    )
    version: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    changelog: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
        index=True,
    )


class AdminFollowup(Base):
    """Pending admin task generated by the system.

    First citizens: the email-blast + post-banner follow-ups queued when
    terms drift is detected. `payload` carries task-specific data;
    `related_id` is a cheap pointer to the originating row (e.g. the
    terms_version row that triggered the follow-up).
    """

    __tablename__ = "admin_followups"

    id: Mapped[UUID] = mapped_column(
        primary_key=True, default=uuid4, server_default=text("gen_random_uuid()")
    )
    kind: Mapped[str] = mapped_column(String(48), nullable=False, index=True)
    """One of: terms_email_blast, terms_banner_post, ..."""

    status: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        server_default=text("'pending'"),
        index=True,
    )
    """One of: pending, completed, dismissed."""

    payload: Mapped[dict | None] = mapped_column(JSONB)
    related_id: Mapped[UUID | None] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_by: Mapped[UUID | None] = mapped_column()


class BriefError(Base):
    """Failed brief-generation attempts.

    Inserted on every error path in the Next.js
    `generateBriefAction` so the admin dashboard can compute an error
    rate (errors / (errors + briefs)). Successful generations are
    already tracked by the `briefs` table.

    `user_id` is unindexed and FK-less on purpose — when a user is
    removed, we still want the audit trail to survive.
    """

    __tablename__ = "brief_errors"

    id: Mapped[UUID] = mapped_column(
        primary_key=True, default=uuid4, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[UUID | None] = mapped_column()
    topic_title: Mapped[str | None] = mapped_column(Text)
    segment: Mapped[str | None] = mapped_column(String(32))
    tone: Mapped[str | None] = mapped_column(String(32))
    locale: Mapped[str | None] = mapped_column(String(8))
    error_code: Mapped[str] = mapped_column(String(64), nullable=False)
    """One of: error_weak_relevance, error_retrieval_unavailable,
    error_llm_unavailable, error_generation_failed, validation_failed,
    forbidden."""

    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
        index=True,
    )

    __table_args__ = (
        Index("ix_brief_errors_error_code", "error_code"),
    )


class AdminLog(Base):
    """Audit trail for admin server actions.

    Append-only. Each row records: who did it (actor_user_id, no FK
    so trail survives admin removal), what action (dot-notation
    string like `user.approve` / `cost.delete`), what target
    (type + id), and any payload context (jsonb — pre-fetched display
    strings, pre/post values).
    """

    __tablename__ = "admin_logs"

    id: Mapped[UUID] = mapped_column(
        primary_key=True, default=uuid4, server_default=text("gen_random_uuid()")
    )
    actor_user_id: Mapped[UUID | None] = mapped_column()
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    target_type: Mapped[str | None] = mapped_column(String(32))
    target_id: Mapped[str | None] = mapped_column(Text)
    payload: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    __table_args__ = (
        Index("ix_admin_logs_created_at", "created_at"),
        Index("ix_admin_logs_actor_time", "actor_user_id", "created_at"),
        Index("ix_admin_logs_action_time", "action", "created_at"),
    )


class AppNotice(Base):
    """Site-wide notice rendered between Header and main content.

    Used for 'terms updated' announcements (14-day window per the public
    /terms promise), reusable for planned downtime + other site-wide
    messages.
    """

    __tablename__ = "app_notices"

    id: Mapped[UUID] = mapped_column(
        primary_key=True, default=uuid4, server_default=text("gen_random_uuid()")
    )
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    """One of: terms_update, maintenance, policy, other."""

    message_en: Mapped[str] = mapped_column(Text, nullable=False)
    message_id: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=text("'info'")
    )
    """One of: info, warning, success."""

    starts_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    ends_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    __table_args__ = (
        Index("ix_app_notices_window", "starts_at", "ends_at"),
    )


class InsightsSummary(Base):
    """Daily AI-narrated executive briefing — surfaced as the hero card
    on the public `/insights` page.

    Generated by a Celery beat task at 04:30 WIB (just after the 04:00
    Gemini topic-discovery pass, so the narrative reads from fresh
    cluster labels). Append-only — never updated after insert. UI reads
    the most-recent row only.
    """

    __tablename__ = "insights_summaries"

    id: Mapped[UUID] = mapped_column(
        primary_key=True, default=uuid4, server_default=text("gen_random_uuid()")
    )
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
        index=True,
    )
    period_start: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    period_end: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    summary_md: Mapped[str] = mapped_column(Text, nullable=False)
    """Markdown narrative produced by the LLM. Bahasa Indonesia primary."""

    headline_stats: Mapped[dict] = mapped_column(JSONB, nullable=False)
    """Pre-computed numbers for the front-end pill row, so /insights
    doesn't recompute on every page load. Shape:
        {
          "sentiment": { current_pct_concerned, baseline_pct_concerned, delta_pp },
          "top_category": { name, share_pct, delta_pp },
          "fastest_rising_topic": { label, platform, growth_pct },
          "totals": { posts_7d, posts_prev_7d, delta_pct }
        }
    """

    model: Mapped[str] = mapped_column(String(64), nullable=False)
    tokens_in: Mapped[int | None] = mapped_column(Integer)
    tokens_out: Mapped[int | None] = mapped_column(Integer)
    cost_usd: Mapped[float | None] = mapped_column(Float)


class Bookmark(Base):
    """User-saved item (kitab citation, brief, or social post).

    Schema flexibility: `kind` discriminator + opaque `ref_id` +
    JSONB `payload` lets one table back multiple save targets without
    proliferating tables. Unique on (user_id, kind, ref_id) so the
    same item never gets saved twice.
    """

    __tablename__ = "bookmarks"

    id: Mapped[UUID] = mapped_column(
        primary_key=True, default=uuid4, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    """One of: 'kitab', 'brief', 'post'."""

    ref_id: Mapped[str] = mapped_column(String(512), nullable=False)
    """Opaque identifier per kind. See migration docstring."""

    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    """Snapshot of the saved item so it renders even if the source
    row is later deleted. For a kitab citation: arabic, translation,
    citation, corpus. For a brief: title, segment, locale. For a
    post: text snippet, author, platform, url."""

    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    __table_args__ = (
        UniqueConstraint(
            "user_id", "kind", "ref_id", name="uq_bookmark_user_kind_ref"
        ),
        Index("ix_bookmarks_user_kind_time", "user_id", "kind", "created_at"),
    )
