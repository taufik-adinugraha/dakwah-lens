"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { auth } from "@/auth";
import { db, schema } from "@/db";
import {
  retrieveDaleel,
  RetrievalUnavailableError,
  WeakRelevanceError,
} from "@/lib/kitab-retrieval";
import { generateBriefContent } from "@/lib/brief-generator";
import { computeCost, estimateBriefCost } from "@/lib/brief-cost";
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
  "rural_communities",
  "students",
] as const;
const TONES = ["scholarly", "casual", "motivational", "empathetic"] as const;
const LOCALES = ["en", "id"] as const;

const GenerateSchema = z.object({
  topic_title: z.string().trim().min(4, "topic_too_short").max(200),
  segment: z.enum(SEGMENTS),
  tone: z.enum(TONES),
  locale: z.enum(LOCALES),
  /** Free-text notes appended to the LLM prompt for this brief. Capped at
   *  2k chars so a runaway paste can't blow our token budget. Trimmed on
   *  parse; empty → undefined. */
  extra_context: z
    .string()
    .trim()
    .max(2000, "extra_context_too_long")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
});

export type GenerateResult =
  | { ok: true; briefId: string }
  | { ok: false; error: string };

export async function generateBriefAction(formData: FormData): Promise<GenerateResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "auth_required" };
  }
  if (session.user.status !== "approved") {
    return { ok: false, error: "account_not_approved" };
  }

  const parsed = GenerateSchema.safeParse({
    topic_title: formData.get("topic_title"),
    segment: formData.get("segment"),
    tone: formData.get("tone"),
    locale: formData.get("locale"),
    extra_context: formData.get("extra_context"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  const { topic_title, segment, tone, locale, extra_context } = parsed.data;

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
  const enrichedQuery = `${topic_title} for ${SEGMENT_LABELS[segment].en} audience`;
  let daleel: BriefDaleel[];
  try {
    const matched = await retrieveDaleel(enrichedQuery, {
      corpus: "all",
      topK: 2,
      locale,
    });
    daleel = matched.map((d) => ({
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
        errorCode: "error_weak_relevance",
        errorMessage: `top_score=${err.topScore}`,
      });
      return { ok: false, error: "error_weak_relevance" };
    }
    if (err instanceof RetrievalUnavailableError) {
      console.error("[brief] retrieval unavailable:", err.reason);
      await logBriefError({
        ...errCtx,
        errorCode: "error_retrieval_unavailable",
        errorMessage: err.reason,
      });
      return { ok: false, error: "error_retrieval_unavailable" };
    }
    console.error("[brief] retrieval error:", err);
    await logBriefError({
      ...errCtx,
      errorCode: "error_generation_failed",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: "error_generation_failed" };
  }

  // Load the requester's onboarding profile so the LLM can tailor the
  // angle to their region / role / audience. Profile may be null (skipped
  // onboarding) — that's fine, the prompt just omits the personalization
  // block in that case.
  const [profileRow] = await db
    .select({ profile: schema.users.profile })
    .from(schema.users)
    .where(eq(schema.users.id, session.user.id))
    .limit(1);
  const profile: UserProfile | null = profileRow?.profile ?? null;

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
      daleel,
      profile,
      extraContext: extra_context,
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
        errorCode: "error_llm_unavailable",
        errorMessage: err.message,
      });
      return { ok: false, error: "error_llm_unavailable" };
    }
    console.error("[brief] generation error:", err);
    await logBriefError({
      ...errCtx,
      errorCode: "error_generation_failed",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: "error_generation_failed" };
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

  const [row] = await db
    .insert(schema.briefs)
    .values({
      userId: session.user.id,
      topicTitle: topic_title,
      segment,
      tone,
      locale,
      isPlaceholder: false,
      content,
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
  redirect(`/briefs/${row.id}`);
}

/* ──────────────────────────────────────────────────────────────
 * Cost preview — runs BEFORE generation so the form can show
 * "this will cost ~$X" in a confirmation step.
 * ──────────────────────────────────────────────────────────── */

const EstimateSchema = z.object({
  topic_title: z.string().trim().min(4, "topic_too_short").max(200),
  locale: z.enum(LOCALES),
  extra_context: z
    .string()
    .trim()
    .max(2000, "extra_context_too_long")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
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
  if (session.user.status !== "approved") {
    return { ok: false, error: "account_not_approved" };
  }

  const parsed = EstimateSchema.safeParse({
    topic_title: formData.get("topic_title"),
    locale: formData.get("locale"),
    extra_context: formData.get("extra_context"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const cost = estimateBriefCost({
    topicTitle: parsed.data.topic_title,
    extraContext: parsed.data.extra_context,
    locale: parsed.data.locale,
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
  rural_communities: { id: "Komunitas Pedesaan", en: "Rural Communities" },
  students: { id: "Pelajar & Mahasiswa", en: "Students" },
};
