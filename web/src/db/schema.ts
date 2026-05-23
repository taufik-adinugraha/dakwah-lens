/**
 * Drizzle schema — mirrors the SQLAlchemy models in `api/src/api/models/`.
 *
 * Alembic is the source of truth for migrations. This file just reflects
 * the existing tables for Auth.js + custom queries on the Next.js side.
 * If you change a column here, also change it in the corresponding
 * SQLAlchemy model + run `uv run alembic revision --autogenerate`.
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  uuid,
  primaryKey,
  uniqueIndex,
  index,
  boolean,
  jsonb,
  doublePrecision,
  numeric,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name"),
    email: text("email").notNull().unique(),
    emailVerified: timestamp("email_verified", { withTimezone: true }),
    image: text("image"),
    passwordHash: text("password_hash"),
    status: text("status").notNull().default("pending"),
    role: text("role").notNull().default("user"),
    profile: jsonb("profile").$type<UserProfile>(),
    onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
    emailDigestOptIn: boolean("email_digest_opt_in").notNull().default(false),
    digestUnsubscribeToken: text("digest_unsubscribe_token"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [uniqueIndex("ix_users_email_unique").on(table.email)],
);

/**
 * Shape of `users.profile` collected by the /onboarding wizard. Every
 * preset-choice field has a paired `*_other` string for free-text overrides.
 * All fields nullable so partial saves are valid.
 */
export type UserProfile = {
  /** Preferred panggilan (Indonesian honorific). One of: ust, ustadzah,
   *  hj, kh, prof, dr, drs, buya, habib, bapak, ibu, none, or "other". */
  honorific?: string;
  /** Free-text honorific when `honorific === "other"`. Also keeps abbreviation. */
  honorific_other?: string;
  age_range?: string;
  age_range_other?: string;
  location?: string;
  location_other?: string;
  profession?: string;
  profession_other?: string;
  audience?: string[];
  audience_other?: string;
  focus?: string[];
  output_lang?: string;
};

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => [
    index("ix_accounts_user_id").on(table.userId),
    uniqueIndex("uq_account_provider").on(
      table.provider,
      table.providerAccountId,
    ),
  ],
);

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.identifier, table.token],
      name: "pk_verification_token",
    }),
  ],
);

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [uniqueIndex("ix_organizations_slug_unique").on(table.slug)],
);

export const orgMembers = pgTable(
  "org_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("ix_org_members_user_id").on(table.userId),
    index("ix_org_members_org_id").on(table.orgId),
    uniqueIndex("uq_org_member").on(table.userId, table.orgId),
  ],
);

export const briefs = pgTable(
  "briefs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    topicTitle: text("topic_title").notNull(),
    segment: text("segment").notNull(),
    tone: text("tone").notNull(),
    locale: text("locale").notNull().default("en"),
    isPlaceholder: boolean("is_placeholder").notNull().default(true),
    content: jsonb("content").notNull().$type<BriefContent>(),
    status: text("status").notNull().default("draft"),
    /** Generation cost metrics. NULL for legacy rows (pre-2026-05-23) and
     *  for any error path that fails before the LLM responds. */
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    /** Drizzle returns numeric as string to avoid IEEE-754 precision loss
     *  — callers should `Number()`-cast for display arithmetic. */
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }),
    provider: text("provider"),
    model: text("model"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("ix_briefs_user_id").on(table.userId),
    index("ix_briefs_org_id").on(table.orgId),
  ],
);

export type BriefDaleel = {
  surah: number;
  ayah: number;
  arabic: string;
  translation: string;
  /** Citation string, e.g. "QS. An-Nahl: 125" or "Qur'an, An-Nahl 16:125". */
  source: string;
  /** Where this daleel came from — Qdrant semantic search or keyword fallback. */
  retrieval_source?: "qdrant" | "keyword";
  /** Cosine similarity score from Qdrant (0–1). Undefined for keyword fallback. */
  retrieval_score?: number;
  /** For tafsir daleel only: the Qur'an ayah being commented on, fetched
   *  by exact key from the quran collection. Lets the brief renderer
   *  show the source verse alongside the commentary. */
  linked_ayah?: {
    arabic: string;
    translation: string;
    source: string;
  };
  /** Same hadith found in other corpora (Bukhari + Muslim share many
   *  entries; Riyad / Bulugh drew from both). Primary `source` above is
   *  the highest-scoring citation; this carries the rest so the brief
   *  can render "agreed upon by ..." attributions. */
  also_found_in?: Array<{
    corpus: string;
    source: string;
  }>;
};

export type BriefContent = {
  situation_summary: string;
  issue_analysis: string;
  audience_segmentation: {
    primary: string;
    perception: string;
    angle: string;
  };
  daleel: BriefDaleel[];
  recommendations: string[];
  content_templates: {
    khutbah_outline: string;
    social_caption: string;
  };
  /** Anticipated audience pushback + concrete responses. Optional on the
   *  TS type so older briefs in the DB still type-check; the LLM schema
   *  requires it for newly generated briefs. */
  anticipated_objections?: Array<{
    objection: string;
    response: string;
  }>;
  /** 2-3 concrete narrative hooks / illustrations the da'i can drop into
   *  delivery. Same back-compat story as above. */
  story_illustrations?: string[];
};

/**
 * Mirror of the SQLAlchemy `SocialPost` model. The Python side owns the
 * canonical schema (Alembic migrations); this Drizzle table just lets the
 * Next.js server side read what the ingestion pipeline writes.
 */
export const socialPosts = pgTable(
  "social_posts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    platform: text("platform").notNull(),
    externalId: text("external_id").notNull(),
    author: text("author"),
    url: text("url"),
    text: text("text").notNull(),
    language: text("language"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    rawPayload: jsonb("raw_payload"),

    // Sentiment (IndoBERT)
    sentimentLabel: text("sentiment_label"),
    sentimentScore: doublePrecision("sentiment_score"),

    // Relevance (Gemini Flash-Lite, 9-category) — mean-of-top-2 since
    // 2026-05-21 (was max(); see relevance.py for rationale).
    dawahRelevance: doublePrecision("dawah_relevance"),
    // 'Would a da'i actually use this?' second-pass score, 0-1
    // continuous. UI sorts top-posts by this; falls back to
    // dawahRelevance when NULL on pre-migration rows.
    dawahOpportunity: doublePrecision("dawah_opportunity"),
    categories: jsonb("categories").$type<Record<string, number>>(),

    // Cluster assignment from the latest topic-discovery run (FK to `topics.id`).
    topicId: uuid("topic_id"),

    // Region code for mainstream regional outlets — NULL for national /
    // non-mainstream platforms. Mirrors `UserProfile.location`.
    region: text("region"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("ix_social_posts_platform").on(table.platform),
    index("ix_social_posts_relevance").on(table.dawahRelevance),
    index("ix_social_posts_topic_id").on(table.topicId),
    index("ix_social_posts_platform_region").on(table.platform, table.region),
    uniqueIndex("uq_social_post_platform_external").on(
      table.platform,
      table.externalId,
    ),
  ],
);

/**
 * Topic-discovery clusters per platform (Gemini Flash-Lite themes).
 * Refreshed in batch by `cluster_topics.py`. Each topic has a `label`
 * (human-readable Bahasa Indonesia theme) and a `keywords[]` array
 * used for richer rendering on the insights page.
 */
export const topics = pgTable(
  "topics",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    platform: text("platform").notNull(),
    clusterId: integer("cluster_id").notNull(),
    label: text("label").notNull(),
    keywords: text("keywords").array().notNull(),
    postCount: integer("post_count").notNull().default(0),
    firstSeen: timestamp("first_seen", { withTimezone: true }),
    lastSeen: timestamp("last_seen", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("ix_topics_platform").on(table.platform),
    index("ix_topics_platform_postcount").on(table.platform, table.postCount),
  ],
);

/**
 * Admin / observability mirrors. Source of truth is
 * `api/src/api/models/admin.py` — keep columns aligned.
 */
export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    provider: text("provider").notNull(),
    model: text("model"),
    operation: text("operation").notNull(),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    units: integer("units"),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    meta: jsonb("meta"),
  },
  (table) => [
    index("ix_usage_events_occurred_at").on(table.occurredAt),
    index("ix_usage_events_provider").on(table.provider),
    index("ix_usage_events_provider_time").on(table.provider, table.occurredAt),
  ],
);

export const systemMetrics = pgTable(
  "system_metrics",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    cpuPct: doublePrecision("cpu_pct").notNull(),
    memUsedMb: doublePrecision("mem_used_mb").notNull(),
    memTotalMb: doublePrecision("mem_total_mb").notNull(),
    diskUsedGb: doublePrecision("disk_used_gb").notNull(),
    diskTotalGb: doublePrecision("disk_total_gb").notNull(),
    load1m: doublePrecision("load_1m"),
  },
  (table) => [index("ix_system_metrics_captured_at").on(table.capturedAt)],
);

export const ingestRuns = pgTable(
  "ingest_runs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    taskName: text("task_name").notNull(),
    platform: text("platform"),
    status: text("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    itemsScraped: integer("items_scraped"),
    itemsStored: integer("items_stored"),
    costUsd: doublePrecision("cost_usd"),
    error: text("error"),
  },
  (table) => [
    index("ix_ingest_runs_platform").on(table.platform),
    index("ix_ingest_runs_started_at").on(table.startedAt),
  ],
);

export const rssFeeds = pgTable(
  "rss_feeds",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    name: text("name").notNull().unique(),
    url: text("url").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    /** "national" or "regional". Defaults to "national" for back-compat. */
    scope: text("scope").notNull().default("national"),
    /** One of the 8 onboarding region codes when scope = regional. NULL otherwise. */
    region: text("region"),
    /** When true, follow each item's `link` and extract the article body
     *  via trafilatura. On by default — adds ~5s + 1s/host politeness per
     *  article, but RSS ledes alone are usually too thin for the classifier. */
    fetchBody: boolean("fetch_body").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("ix_rss_feeds_scope").on(table.scope),
    index("ix_rss_feeds_region").on(table.region),
  ],
);

/**
 * Whitelisted YouTube channels — replaces keyword search.list for YT
 * (100× cheaper on quota via playlistItems.list on the channel's
 * uploads playlist). One row per curated channel. `category` is one
 * of the 8 buckets: religious, family, youth, muamalah, social_justice,
 * health, education, cultural.
 */
export const youtubeChannels = pgTable(
  "youtube_channels",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    channelId: text("channel_id").notNull().unique(),
    name: text("name").notNull(),
    handle: text("handle"),
    category: text("category").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("ix_youtube_channels_category_enabled").on(
      table.category,
      table.enabled,
    ),
  ],
);

export const manualCosts = pgTable(
  "manual_costs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    kind: text("kind").notNull(),
    vendor: text("vendor").notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    amountIdr: doublePrecision("amount_idr").notNull(),
    note: text("note"),
    // When this manual cost is a flat-rate subscription that covers a
    // metered provider (e.g. Apify Starter $29/mo), set this to the
    // provider name so the cost totals on /admin/system + costs page
    // exclude that provider's usage_events for the period — avoids
    // double-counting subscription + per-call usage. Null when the
    // entry is pure infrastructure (VPS, domain) with no usage offset.
    coversProvider: text("covers_provider"),
    // Optional invoice file. Path is the on-disk filename under
    // UPLOAD_DIR (UUID-based, never the user's filename — that's kept
    // in attachmentFilename for display + download). Filename always
    // sanitized at upload time. Null when no invoice was attached.
    attachmentPath: text("attachment_path"),
    attachmentFilename: text("attachment_filename"),
    attachmentSizeBytes: integer("attachment_size_bytes"),
    attachmentMimeType: text("attachment_mime_type"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [index("ix_manual_costs_kind").on(table.kind)],
);

/**
 * Single-row-per-key runtime settings. First citizen: `usd_to_idr` —
 * editable from the superadmin overview page so the team can update FX
 * without a redeploy.
 */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

/**
 * Income side of the ledger. Counterpart to `manualCosts`. Shown publicly
 * on `/transparency` (anonymized when `isAnonymous` is true).
 */
export const donations = pgTable(
  "donations",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    amountIdr: doublePrecision("amount_idr").notNull(),
    donor: text("donor"),
    isAnonymous: boolean("is_anonymous").notNull().default(false),
    channel: text("channel"),
    note: text("note"),
    // Optional receipt file (e.g. transfer proof). Same shape as the
    // invoice columns on manual_costs — see that table's doc for the
    // storage contract. Admin-only download endpoint at
    // /api/admin/attachments/donation/[id].
    attachmentPath: text("attachment_path"),
    attachmentFilename: text("attachment_filename"),
    attachmentSizeBytes: integer("attachment_size_bytes"),
    attachmentMimeType: text("attachment_mime_type"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [index("ix_donations_received_at").on(table.receivedAt)],
);

/**
 * Inbound contact form submissions. Surfaced at /admin/system/inbox.
 */
/**
 * Per-platform scrape keywords. The Celery rotating-ingest task pulls the
 * least-recently-used enabled row per platform on each tick. Editable from
 * /admin/system/queries so the team can mix religious + societal terms
 * without redeploys.
 */
export const ingestQueries = pgTable(
  "ingest_queries",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    platform: text("platform").notNull(),
    query: text("query").notNull(),
    category: text("category"),
    enabled: boolean("enabled").notNull().default(true),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("ix_ingest_queries_platform").on(table.platform),
    index("ix_ingest_queries_platform_enabled").on(
      table.platform,
      table.enabled,
    ),
    uniqueIndex("uq_ingest_query_platform").on(table.platform, table.query),
  ],
);

export const contactMessages = pgTable(
  "contact_messages",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    name: text("name").notNull(),
    email: text("email").notNull(),
    subject: text("subject"),
    message: text("message").notNull(),
    /** new / read / archived */
    status: text("status").notNull().default("new"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("ix_contact_messages_received_at").on(table.receivedAt),
    index("ix_contact_messages_status").on(table.status),
  ],
);

export const pageViews = pgTable(
  "page_views",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    path: text("path").notNull(),
    locale: text("locale"),
    userId: uuid("user_id"),
    sessionId: text("session_id"),
    referer: text("referer"),
    userAgent: text("user_agent"),
    // IP-derived Indonesian region bucket (jabodetabek / jawa_barat /
    // jawa_tengah_diy / jawa_timur / sumatera / kalimantan / sulawesi /
    // indonesia_timur). NULL when geoip lookup fails or the visitor is
    // outside Indonesia. The IP itself is never stored — PDP §15.
    region: text("region"),
  },
  (table) => [
    index("ix_page_views_occurred_at").on(table.occurredAt),
    index("ix_page_views_path").on(table.path),
    index("ix_page_views_region").on(table.region),
  ],
);

/**
 * One row per published Terms of Service version. Inserted on first
 * admin page load after `TERMS_VERSION` in code drifts from the latest
 * row here. Append-only — never updated after insert.
 */
export const termsVersions = pgTable(
  "terms_versions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    version: text("version").notNull().unique(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    changelog: text("changelog"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [index("ix_terms_versions_created_at").on(table.createdAt)],
);

/**
 * Pending admin tasks generated by the system itself. First citizens:
 * the two follow-ups queued when terms drift is detected — send the
 * notice email and post the in-app banner. The `payload` carries
 * task-specific data (e.g. the terms_version_id), `relatedId` keeps a
 * cheap pointer for joins.
 */
export const adminFollowups = pgTable(
  "admin_followups",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("pending"),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    relatedId: uuid("related_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: uuid("completed_by"),
  },
  (table) => [
    index("ix_admin_followups_status").on(table.status),
    index("ix_admin_followups_kind").on(table.kind),
  ],
);

/**
 * Site-wide notices rendered between Header and main content. Used for
 * "terms updated" announcements (14-day window per our promise on
 * /terms) but reusable for planned downtime / policy changes.
 */
export const appNotices = pgTable(
  "app_notices",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    kind: text("kind").notNull(),
    messageEn: text("message_en").notNull(),
    messageId: text("message_id").notNull(),
    severity: text("severity").notNull().default("info"),
    startsAt: timestamp("starts_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [index("ix_app_notices_window").on(table.startsAt, table.endsAt)],
);

/**
 * Failed brief-generation attempts. Inserted on every error path in
 * `generateBriefAction` so we can compute an error rate (errors /
 * (errors + briefs)) for the operational dashboard. Successes are
 * already tracked by the `briefs` table.
 *
 * Keeps a copy of the user inputs (topic / segment / tone / locale)
 * because the brief row never gets created on failure — without these
 * we'd lose the diagnostic signal.
 */
export const briefErrors = pgTable(
  "brief_errors",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id"),
    topicTitle: text("topic_title"),
    segment: text("segment"),
    tone: text("tone"),
    locale: text("locale"),
    errorCode: text("error_code").notNull(),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("ix_brief_errors_created_at").on(table.createdAt),
    index("ix_brief_errors_error_code").on(table.errorCode),
  ],
);

export type User = typeof users.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Organization = typeof organizations.$inferSelect;
export type Brief = typeof briefs.$inferSelect;
export type SocialPost = typeof socialPosts.$inferSelect;
export type Topic = typeof topics.$inferSelect;
export type UsageEvent = typeof usageEvents.$inferSelect;
export type SystemMetric = typeof systemMetrics.$inferSelect;
export type IngestRun = typeof ingestRuns.$inferSelect;
export type RssFeed = typeof rssFeeds.$inferSelect;
export type YoutubeChannel = typeof youtubeChannels.$inferSelect;
export type ManualCost = typeof manualCosts.$inferSelect;
export type PageView = typeof pageViews.$inferSelect;
export type AppSetting = typeof appSettings.$inferSelect;
export type Donation = typeof donations.$inferSelect;
export type ContactMessage = typeof contactMessages.$inferSelect;
export type IngestQuery = typeof ingestQueries.$inferSelect;
export type TermsVersion = typeof termsVersions.$inferSelect;
export type AdminFollowup = typeof adminFollowups.$inferSelect;
export type AppNotice = typeof appNotices.$inferSelect;
export type BriefError = typeof briefErrors.$inferSelect;
export type AdminLog = typeof adminLogs.$inferSelect;

/**
 * Audit trail for admin-initiated actions. Append-only. Every server
 * action under /admin/* writes a row via the `logAdminAction` helper —
 * see lib/admin-log.ts. The actor link is a bare UUID (no FK) so the
 * trail survives if the admin's own row is later removed.
 *
 * `action` uses dot-notation namespacing: `user.approve`, `cost.delete`,
 * `rss.toggle_enabled`, etc. Keep the namespace stable — the audit page
 * filters by exact match.
 *
 * `payload` carries any pre-fetched display strings (target email,
 * vendor name, etc.) so the audit page renders rows without needing
 * cross-table joins to long-since-deleted targets.
 */
export const adminLogs = pgTable(
  "admin_logs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    actorUserId: uuid("actor_user_id"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("ix_admin_logs_created_at").on(table.createdAt),
    index("ix_admin_logs_actor_time").on(table.actorUserId, table.createdAt),
    index("ix_admin_logs_action_time").on(table.action, table.createdAt),
  ],
);

/**
 * Weekly AI-narrated executive briefing for /insights. One row per
 * generation. Celery beat `generate_insights_summary` task writes
 * this every Sunday at 05:00 WIB (one hour after the topic-discovery
 * pass). The /insights page reads the most-recent row to render the
 * hero card.
 */
export const insightsSummaries = pgTable(
  "insights_summaries",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    generatedAt: timestamp("generated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    summaryMd: text("summary_md").notNull(),
    /** Parallel English narrative. NULL on rows generated before the
     *  2026-05-21 migration — UI falls back to `summaryMd` then. */
    summaryMdEn: text("summary_md_en"),
    headlineStats: jsonb("headline_stats")
      .$type<Record<string, unknown>>()
      .notNull(),
    model: text("model").notNull(),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    costUsd: doublePrecision("cost_usd"),
    /** NULL = all-platform briefing. Otherwise one of `spiritual` /
     *  `family` / `youth` / `justice` per the 2026-05-20 expansion. */
    segment: text("segment"),
    /** Kitab passages the LLM was permitted to cite for this
     *  briefing. The render layer surfaces these as clickable chips
     *  beneath the narrative. Shape:
     *    [{ corpus, citation, score, arabic, translation_id,
     *       translation_en, ref_id }] */
    daleelRefs: jsonb("daleel_refs").$type<DaleelRef[] | null>(),
  },
  (table) => [
    index("ix_insights_summaries_generated_at").on(table.generatedAt),
    index("ix_insights_summaries_segment").on(table.segment, table.generatedAt),
  ],
);

/** Shape of one item in `insightsSummaries.daleelRefs`. Mirrors what the
 *  Python service writes — kept in sync by convention. */
export type DaleelRef = {
  corpus: string;
  citation: string;
  score: number | null;
  arabic: string;
  translation_id: string;
  translation_en: string;
  ref_id: string;
};

/**
 * User-saved items — kitab citations, briefs, social posts.
 *
 * `kind` discriminator + opaque `ref_id` + JSONB `payload` keeps
 * one table flexible across save targets. UNIQUE on
 * (userId, kind, refId) makes a re-save idempotent.
 */
export const bookmarks = pgTable(
  "bookmarks",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    refId: text("ref_id").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_bookmark_user_kind_ref").on(
      table.userId,
      table.kind,
      table.refId,
    ),
    index("ix_bookmarks_user_kind_time").on(
      table.userId,
      table.kind,
      table.createdAt,
    ),
  ],
);

// Deploy status persists as a single JSON-encoded value under the
// `deploy_status` key in `app_settings` — no new table needed.
// See /api/internal/deploy-event (write) and /api/deploy-status (read).

/**
 * DB-backed registry for the modular flyer system.
 *
 * Was a hand-edited TS file (web/src/lib/flyer/images/registry.ts);
 * promoted to a DB table 2026-05-23 so admins can upload new photos /
 * SVGs via /admin/system/flyer-assets without a code redeploy.
 *
 * Files referenced by `src` live under web/public/flyer-assets/. The
 * seed migration writes the 13 originally-committed assets; new rows
 * come from admin uploads landing in public/flyer-assets/uploads/*.
 */
export const flyerAssets = pgTable(
  "flyer_assets",
  {
    /** Stable identifier — used as the compose() seed. Lowercase
     *  kebab-case by convention. */
    id: text("id").primaryKey(),
    /** "photo" | "ornament" | "pattern" — enforced by a CHECK. */
    kind: text("kind").notNull(),
    /** Path relative to the web root, e.g. "/flyer-assets/photos/x.jpg". */
    src: text("src").notNull(),
    /** "1:1" | "wide" | "tall" — enforced by a CHECK. */
    aspect: text("aspect").notNull(),
    /** Free-form mood tags used by compose() to filter candidates. */
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    /** NULL for seeded entries, admin user id for runtime uploads. */
    uploadedById: uuid("uploaded_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [index("ix_flyer_assets_kind").on(table.kind)],
);
