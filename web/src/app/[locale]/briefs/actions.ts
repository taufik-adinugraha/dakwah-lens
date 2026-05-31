"use server";

import { revalidatePath } from "next/cache";
import { and, count, eq, gte } from "drizzle-orm";
import { z } from "zod";

import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { db, schema } from "@/db";
import {
  rerankDaleel,
  retrieveDaleel,
  RetrievalUnavailableError,
  WeakRelevanceError,
} from "@/lib/kitab-retrieval";
import { generateBriefContent } from "@/lib/brief-generator";
import { computeCost, estimateBriefCost } from "@/lib/brief-cost";
import { getCurrentTopicContext } from "@/lib/dashboard-metrics";
import {
  getPlatformSamplesForTopic,
  getPlatformStatsForTopic,
} from "@/lib/draft-grounding";
import { currentWeekStartUtc } from "@/lib/user-flyer/quota";
import { LlmUnavailableError } from "@/lib/llm";
import type { BriefDaleel, UserProfile } from "@/db/schema";

/**
 * Best-effort failure log. The brief-error tile on /admin/system/analytics
 * reads this to compute a 7-day error rate; we never want logging to
 * derail an already-failing action, so swallow any insert error.
 */
async function logBriefError(input: {
  userId: string | null;
  topicTitle?: string;
  segment?: string;
  tone?: string;
  locale?: string;
  errorCode: string;
  errorMessage?: string;
}): Promise<void> {
  try {
    await db.insert(schema.briefErrors).values({
      userId: input.userId,
      topicTitle: input.topicTitle?.slice(0, 200),
      segment: input.segment?.slice(0, 32),
      tone: input.tone?.slice(0, 32),
      locale: input.locale?.slice(0, 8),
      errorCode: input.errorCode.slice(0, 64),
      errorMessage: input.errorMessage?.slice(0, 2000),
    });
  } catch (err) {
    console.warn("[brief] failed to log brief error:", err);
  }
}

const SEGMENTS = [
  "urban_gen_z",
  "working_professionals",
  "parents_families",
  "ibu_pengajian",
  "rural_communities",
  "students",
] as const;
const TONES = [
  "scholarly",
  "casual",
  "motivational",
  "empathetic",
  "fiery",
  "gentle",
] as const;
const LOCALES = ["en", "id"] as const;

/** Output format. `kajian_umum` = current default (general da'wah brief).
 *  `khutbah_jumat` = formal Friday-khutbah style (Khutbah Pertama + Kedua,
 *  Arabic with harakat, traditional opening/closing formulas) — mirrors
 *  the weekly briefing's Khutbah Jumat sub-section rules. */
const FORMATS = ["kajian_umum", "khutbah_jumat"] as const;

const GenerateSchema = z.object({
  topic_title: z.string().trim().min(4, "topic_too_short").max(200),
  // Drafts are audience-neutral as of 2026-05-31 — segment/tone/locale
  // are picked at deliverable-generation time, not here. Defaults below
  // give the brief LLM something to lean on for the research phase
  // (neutral analytical voice; Indonesian by default).
  segment: z.enum(SEGMENTS).default("urban_gen_z"),
  tone: z.enum(TONES).default("scholarly"),
  locale: z.enum(LOCALES).default("id"),
  format: z.enum(FORMATS).default("kajian_umum"),
  /** Whether the LLM should personalize examples + framing using the
   *  caller's onboarding profile (honorific, location, profession,
   *  audience, focus). FormData carries it as "on"/"off" or absent;
   *  coerce to boolean with default true (the historical behaviour). */
  include_profile: z
    .union([z.literal("on"), z.literal("true"), z.literal("false"), z.literal("")])
    .optional()
    .transform((v) => v === "on" || v === "true"),
  /** Free-text notes appended to the LLM prompt for this brief. Capped at
   *  2k chars so a runaway paste can't blow our token budget. Trimmed on
   *  parse; empty → undefined. */
  extra_context: z
    .string()
    .trim()
    .max(2000, "extra_context_too_long")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  /** Target length 1-4 pages. Default 2. Scales the LLM's maxOutputTokens
   *  budget (≈2000 tokens/page Indonesian). `z.coerce.number` handles the
   *  string-typed FormData value. */
  pages: z.coerce.number().int().min(1).max(4).default(2),
  /** Optional. When the user ticks "Berdasarkan topik yang sedang ramai"
   *  and picks a topic from the dropdown, its UUID arrives here. The
   *  action fetches the topic's keywords + 5 sample headlines and
   *  threads them into the LLM prompt as "anchor headlines" so the
   *  brief grounds itself in this week's actual conversation rather
   *  than generic examples. */
  current_topic_id: z
    .string()
    .uuid()
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export type GenerateResult =
  | { ok: true; briefId: string }
  | { ok: false; error: string };

/** Max draft kajian a user may generate per rolling 7-day window. */
const DRAFTS_PER_WEEK = 5;

export async function generateBriefAction(formData: FormData): Promise<GenerateResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "auth_required" };
  }
  // Brief generation is open to all signed-in users (2026-05-29).
  // Approval (status === "approved") still gates admin surfaces and
  // any per-user privilege beyond the default quota — but the brief
  // wizard itself is now part of the standard onboarding journey.

  // Per-user weekly cap (2026-05-31). Anchored to Sunday-00:00 WIB so
  // the draft, kajian, and flyer quota meters all reset together —
  // matches `currentWeekStartUtc` from lib/user-flyer/quota.ts.
  const weekStart = currentWeekStartUtc();
  const [weekCount] = await db
    .select({ n: count() })
    .from(schema.briefs)
    .where(
      and(
        eq(schema.briefs.userId, session.user.id),
        gte(schema.briefs.createdAt, weekStart),
      ),
    );
  if (Number(weekCount?.n ?? 0) >= DRAFTS_PER_WEEK) {
    return { ok: false, error: "weekly_limit_reached" };
  }

  const parsed = GenerateSchema.safeParse({
    topic_title: formData.get("topic_title"),
    // segment/tone/locale removed from /briefs/new (2026-05-31). Schema
    // defaults apply via `formData.get() ?? undefined` so legacy callers
    // that still send these continue to work.
    segment: formData.get("segment") ?? undefined,
    tone: formData.get("tone") ?? undefined,
    locale: formData.get("locale") ?? undefined,
    format: formData.get("format") ?? "kajian_umum",
    include_profile: formData.get("include_profile") ?? "",
    extra_context: formData.get("extra_context"),
    pages: formData.get("pages") ?? 2,
    current_topic_id: formData.get("current_topic_id") ?? "",
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  const {
    topic_title,
    segment,
    tone,
    locale,
    format,
    include_profile,
    extra_context,
    pages,
    current_topic_id,
  } = parsed.data;

  // 1) Retrieve daleel via Qdrant semantic search across the full kitab
  // corpus. Enrich the query with the target segment so retrieved daleel
  // leans toward what that audience would benefit from.
  //
  // `corpus: "all"` queries quran + hadith + tafsir_ibn_kathir in parallel,
  // merges by similarity score, returns top-K. Per-corpus failures (e.g.
  // before embed_hadith.py / embed_tafsir.py have run) are skipped; the
  // merge proceeds with whatever IS embedded.
  //
  // If NO corpus produces hits (Qdrant down, no collection embedded,
  // OpenAI embed failed), kitab-retrieval throws RetrievalUnavailableError
  // and we refuse to generate the brief — per PRD §12, a brief must never
  // ship without verified daleel.
  // Drafts are audience-neutral (2026-05-31) — no segment suffix on the
  // query. The deliverable generator does audience-specific work later
  // when the da'i picks a target.
  const enrichedQuery = topic_title;
  void segment;
  void SEGMENT_LABELS;
  let daleel: BriefDaleel[];
  try {
    const matched = await retrieveDaleel(enrichedQuery, {
      corpus: "all",
      // 10 per corpus × 6 corpora = up to ~60 candidates before dedup +
      // the 0.32 cosine floor + per-corpus skips. Gives the rerank step
      // a wider pool so it can drop surface-keyword matches and the
      // synthesis LLM only sees thematically-strong hits.
      topK: 10,
      locale,
    });
    // Gemini Flash-Lite thematic rerank. Cosine alone surfaces passages
    // that share surface tokens with the topic (e.g. "pemuda" matching
    // verses about youthful paradise servants instead of real-world
    // youth issues). The rerank reads each candidate against the topic
    // and picks the ones that ACTUALLY discuss the theme. ~$0.0001/call.
    const reranked = await rerankDaleel(enrichedQuery, matched, { topN: 10 });
    daleel = reranked.map((d) => ({
      surah: d.surah ?? 0,
      ayah: d.ayah ?? 0,
      arabic: d.arabic,
      translation: d.translation,
      source: d.citation,
      retrieval_source: d.retrievalSource,
      retrieval_score: d.score,
      linked_ayah: d.linkedAyah
        ? {
            arabic: d.linkedAyah.arabic,
            translation: d.linkedAyah.translation,
            source: d.linkedAyah.citation,
          }
        : undefined,
      also_found_in: d.alsoFoundIn?.map((a) => ({
        corpus: a.corpus,
        source: a.citation,
      })),
    }));
  } catch (err) {
    const errCtx = {
      userId: session.user.id,
      topicTitle: topic_title,
      segment,
      tone,
      locale,
    };
    if (err instanceof WeakRelevanceError) {
      console.warn(
        "[brief] weak relevance for topic:",
        topic_title,
        "top score:",
        err.topScore,
      );
      await logBriefError({
        ...errCtx,
        errorCode: "weak_relevance",
        errorMessage: `top_score=${err.topScore}`,
      });
      // Returned codes are UN-prefixed; the client wraps them as
      // `t("error_" + code)` for the i18n lookup. (Prefixing here used
      // to double-prefix into "error_error_weak_relevance" and render
      // the raw key in the UI.)
      return { ok: false, error: "weak_relevance" };
    }
    if (err instanceof RetrievalUnavailableError) {
      console.error("[brief] retrieval unavailable:", err.reason);
      await logBriefError({
        ...errCtx,
        errorCode: "retrieval_unavailable",
        errorMessage: err.reason,
      });
      return { ok: false, error: "retrieval_unavailable" };
    }
    console.error("[brief] retrieval error:", err);
    await logBriefError({
      ...errCtx,
      errorCode: "generation_failed",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: "generation_failed" };
  }

  // Load the requester's onboarding profile so the LLM can tailor the
  // angle to their region / role / audience. Profile may be null (skipped
  // onboarding, or user explicitly toggled "include profile" off for this
  // brief) — the prompt just omits the personalization block.
  let profile: UserProfile | null = null;
  if (include_profile) {
    const [profileRow] = await db
      .select({ profile: schema.users.profile })
      .from(schema.users)
      .where(eq(schema.users.id, session.user.id))
      .limit(1);
    profile = profileRow?.profile ?? null;
  }

  // Optional "anchor to this week's actual topic" context. When the
  // user ticked the "current topic" checkbox + picked one from the
  // dropdown, we hydrate the topic's keywords + 5 sample headlines so
  // the LLM grounds the brief in real conversation rather than
  // invented examples. Best-effort: a stale topic id (deleted between
  // page-load and submit) silently degrades to no-anchor mode.
  let currentTopic = null;
  if (current_topic_id) {
    try {
      currentTopic = await getCurrentTopicContext(current_topic_id);
    } catch (err) {
      console.warn(
        "[brief] current-topic context fetch failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Real per-platform sample posts + per-platform sentiment stats for
  // the topic. Both go through the SAME topic_id resolution path the
  // weekly briefings use (no ILIKE on text). Best-effort: query
  // failure or zero matches just degrades to a no-platform-grounding
  // draft. Fetched in parallel since they share the resolution cost
  // but query distinct subsets.
  let platformSamples: Awaited<
    ReturnType<typeof getPlatformSamplesForTopic>
  > = [];
  let platformStats: Awaited<
    ReturnType<typeof getPlatformStatsForTopic>
  > = [];
  try {
    [platformSamples, platformStats] = await Promise.all([
      getPlatformSamplesForTopic({
        topicText: topic_title,
        topicId: current_topic_id ?? null,
      }),
      getPlatformStatsForTopic({
        topicText: topic_title,
        topicId: current_topic_id ?? null,
      }),
    ]);
    const totalSamples = platformSamples.reduce(
      (acc, g) => acc + g.samples.length,
      0,
    );
    const totalPosts = platformStats.reduce((acc, s) => acc + s.total, 0);
    console.info(
      "[brief] platform grounding:",
      JSON.stringify({
        topic: topic_title.slice(0, 80),
        topic_id_provided: !!current_topic_id,
        samples_fetched: totalSamples,
        posts_in_stats: totalPosts,
        per_platform: platformStats.map((s) => ({
          p: s.platform,
          n: s.total,
        })),
      }),
    );
  } catch (err) {
    console.warn(
      "[brief] platform-grounding fetch failed:",
      err instanceof Error ? err.message : err,
    );
  }

  // 2) Generate the brief content via the LLM fallback chain:
  //    Anthropic Claude → Gemini → throw.
  let content;
  let provider: "anthropic" | "gemini";
  let model: string;
  let tokensIn: number | null = null;
  let tokensOut: number | null = null;
  try {
    const generated = await generateBriefContent({
      topic: topic_title,
      segment,
      tone,
      locale,
      format,
      daleel,
      profile,
      extraContext: extra_context,
      pages,
      currentTopic,
      platformSamples,
      platformStats,
    });
    content = generated.content;
    provider = generated.provider;
    model = generated.model;
    tokensIn = generated.tokensIn;
    tokensOut = generated.tokensOut;
  } catch (err) {
    const errCtx = {
      userId: session.user.id,
      topicTitle: topic_title,
      segment,
      tone,
      locale,
    };
    if (err instanceof LlmUnavailableError) {
      console.error("[brief] all LLM providers failed:", err.message);
      await logBriefError({
        ...errCtx,
        errorCode: "llm_unavailable",
        errorMessage: err.message,
      });
      return { ok: false, error: "llm_unavailable" };
    }
    console.error("[brief] generation error:", err);
    await logBriefError({
      ...errCtx,
      errorCode: "generation_failed",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: "generation_failed" };
  }

  // Compute actual cost from the tokens the provider reported. NULL
  // when the SDK didn't surface usage (rare); we persist NULL rather
  // than guess so analytics doesn't pretend it knows.
  const costUsd =
    tokensIn != null && tokensOut != null
      ? computeCost({
          tokensIn,
          tokensOut,
          provider,
          model,
        }).totalUsd
      : null;

  // Freeze the grounding snapshot onto the brief BEFORE insert.
  // Stats + samples are computed at draft-generation time; persisting
  // them means the detail page renders the same numbers later even
  // after ingestion has moved on, AND gives the da'i visible
  // evidence ("Sumber percakapan" section) of which real posts the
  // LLM's paragraph-1 platform breakdown was anchored to.
  const contentWithGrounding = {
    ...content,
    platform_stats: platformStats.map((s) => ({
      platform: s.platform,
      total: s.total,
      positive: s.positive,
      neutral: s.neutral,
      negative: s.negative,
      other: s.other,
    })),
    platform_samples: platformSamples.map((g) => ({
      platform: g.platform,
      samples: g.samples.map((s) => ({
        text: s.text,
        author: s.author,
        postedAt: s.postedAt,
        sentimentLabel: s.sentimentLabel,
      })),
    })),
  };

  const [row] = await db
    .insert(schema.briefs)
    .values({
      userId: session.user.id,
      topicTitle: topic_title,
      segment,
      tone,
      locale,
      isPlaceholder: false,
      content: contentWithGrounding,
      status: "draft",
      tokensIn,
      tokensOut,
      costUsd: costUsd != null ? costUsd.toFixed(6) : null,
      provider,
      model,
    })
    .returning({ id: schema.briefs.id });

  console.info(
    `[brief] generated via ${provider} (id=${row.id}, tokens=${tokensIn}/${tokensOut}, cost=$${costUsd?.toFixed(4) ?? "?"})`,
  );
  // Include the locale prefix explicitly. Without it the redirect lands
  // at `/briefs/{id}`, the next-intl middleware re-routes it to
  // `/{locale}/briefs/{id}`, and the auth context gets dropped during
  // that hop — user lands on /login instead of the new brief.
  redirect(`/${locale}/briefs/${row.id}`);
}

/* ──────────────────────────────────────────────────────────────
 * Cost preview — runs BEFORE generation so the form can show
 * "this will cost ~$X" in a confirmation step.
 * ──────────────────────────────────────────────────────────── */

const EstimateSchema = z.object({
  topic_title: z.string().trim().min(4, "topic_too_short").max(200),
  locale: z.enum(LOCALES).default("id"),
  extra_context: z
    .string()
    .trim()
    .max(2000, "extra_context_too_long")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  pages: z.coerce.number().int().min(1).max(4).default(2),
});

export type EstimateResult =
  | {
      ok: true;
      tokensIn: number;
      tokensOut: number;
      totalUsd: number;
      totalIdr: number;
      provider: string;
      model: string;
    }
  | { ok: false; error: string };

/**
 * Cheap heuristic cost preview. Calibrated against historic briefs so
 * the estimate is within ±20% of actual — accurate enough to surface a
 * budget warning, not precise enough to bill against.
 *
 * Auth-gated (signed-in approved users only) so it can't be abused
 * to enumerate cost characteristics of the prompt assembly.
 */
export async function estimateBriefCostAction(
  formData: FormData,
): Promise<EstimateResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "auth_required" };
  }
  // Estimate is intentionally open to all signed-in users — same
  // policy as generateBriefAction (the wizard's two halves should
  // gate identically).

  const parsed = EstimateSchema.safeParse({
    topic_title: formData.get("topic_title"),
    locale: formData.get("locale") ?? undefined,
    extra_context: formData.get("extra_context"),
    pages: formData.get("pages") ?? 2,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const cost = estimateBriefCost({
    topicTitle: parsed.data.topic_title,
    extraContext: parsed.data.extra_context,
    locale: parsed.data.locale,
    pages: parsed.data.pages,
  });

  return {
    ok: true,
    tokensIn: cost.tokensIn,
    tokensOut: cost.tokensOut,
    totalUsd: cost.totalUsd,
    totalIdr: cost.totalIdr,
    provider: cost.provider,
    model: cost.model,
  };
}

const SEGMENT_LABELS: Record<string, { id: string; en: string }> = {
  urban_gen_z: { id: "Gen Z Perkotaan", en: "Urban Gen Z" },
  working_professionals: { id: "Profesional Muda", en: "Working Professionals" },
  parents_families: { id: "Orang Tua & Keluarga", en: "Parents & Families" },
  ibu_pengajian: { id: "Ibu-Ibu Pengajian", en: "Mothers' Study Circle" },
  rural_communities: { id: "Komunitas Pedesaan", en: "Rural Communities" },
  students: { id: "Pelajar & Mahasiswa", en: "Students" },
};

/* ────────────────────────────────────────────────────────────
 * Delete a brief.
 *
 * Owner-only — non-owners get a not_found response (we don't leak
 * existence). After deletion we revalidate /briefs so the list re-
 * renders without the row. Per-brief detail page returns 404 on its
 * own (DB row gone) so no extra cleanup needed.
 * ──────────────────────────────────────────────────────────── */

const DeleteBriefSchema = z.object({
  brief_id: z.string().uuid(),
});

export type DeleteBriefResult =
  | { ok: true }
  | { ok: false; error: "auth_required" | "not_found" };

export async function deleteBriefAction(
  briefId: string,
): Promise<DeleteBriefResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "auth_required" };
  }
  const parsed = DeleteBriefSchema.safeParse({ brief_id: briefId });
  if (!parsed.success) {
    return { ok: false, error: "not_found" };
  }

  const res = await db
    .delete(schema.briefs)
    .where(
      and(
        eq(schema.briefs.id, parsed.data.brief_id),
        eq(schema.briefs.userId, session.user.id),
      ),
    )
    .returning({ id: schema.briefs.id });

  if (res.length === 0) {
    return { ok: false, error: "not_found" };
  }

  revalidatePath("/briefs");
  return { ok: true };
}
