"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { db, schema } from "@/db";
import {
  generateDeliverable,
  type GeneratedDeliverable,
} from "@/lib/deliverable-generator";
import { computeCost } from "@/lib/brief-cost";
import { LlmUnavailableError } from "@/lib/llm";
import { reserveWeeklyQuota } from "@/lib/weekly-quota";
import type { Brief, BriefDaleel, KajianFormat } from "@/db/schema";

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
const FORMATS = ["khutbah_jumat", "kultum", "kajian_umum"] as const;

const GenerateKajianSchema = z.object({
  brief_id: z.string().uuid(),
  format: z.enum(FORMATS),
  segment: z.enum(SEGMENTS),
  tone: z.enum(TONES),
  locale: z.enum(LOCALES).default("id"),
  pages: z.coerce.number().int().min(1).max(4).default(2),
  include_profile: z
    .union([z.literal("on"), z.literal("true"), z.literal("false"), z.literal("")])
    .optional()
    .transform((v) => v === "on" || v === "true"),
  /** Comma-separated 1-based daleel indices the user ticked, or "all". */
  daleel_indices: z.string().min(1),
  extra_context: z
    .string()
    .trim()
    .max(2000, "extra_context_too_long")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
});

export type GenerateKajianResult =
  | { ok: true; kajianId: string }
  | { ok: false; error: string };

export async function generateKajianAction(
  formData: FormData,
): Promise<GenerateKajianResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "auth_required" };
  }

  // Atomic per-user weekly reservation — counts against the immutable
  // `weekly_quota_usage` row so deleting a kajian doesn't free up a
  // slot. Reserved BEFORE the LLM call so a failed generation still
  // costs a slot.
  const reservation = await reserveWeeklyQuota(session.user.id, "kajian");
  if (!reservation.ok) {
    return { ok: false, error: "weekly_limit_reached" };
  }

  const parsed = GenerateKajianSchema.safeParse({
    brief_id: formData.get("brief_id"),
    format: formData.get("format"),
    segment: formData.get("segment"),
    tone: formData.get("tone"),
    locale: formData.get("locale") ?? undefined,
    pages: formData.get("pages") ?? 2,
    include_profile: formData.get("include_profile") ?? "",
    daleel_indices: formData.get("daleel_indices") ?? "all",
    extra_context: formData.get("extra_context"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  const {
    brief_id,
    format,
    segment,
    tone,
    locale,
    pages,
    include_profile,
    daleel_indices,
    extra_context,
  } = parsed.data;

  // Load the source brief + verify ownership.
  const [brief] = await db
    .select()
    .from(schema.briefs)
    .where(
      and(
        eq(schema.briefs.id, brief_id),
        eq(schema.briefs.userId, session.user.id),
      ),
    )
    .limit(1);
  if (!brief) {
    return { ok: false, error: "brief_not_found" };
  }

  const allDaleel = brief.content.daleel ?? [];
  if (allDaleel.length === 0) {
    return { ok: false, error: "brief_has_no_daleel" };
  }

  // Select the daleel subset the user ticked. "all" = use everything;
  // otherwise comma-separated 1-based indices into brief.content.daleel.
  let selectedDaleel: BriefDaleel[];
  if (daleel_indices === "all") {
    selectedDaleel = allDaleel;
  } else {
    const idxs = daleel_indices
      .split(",")
      .map((s) => Number.parseInt(s.trim(), 10))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= allDaleel.length);
    selectedDaleel = idxs.map((i) => allDaleel[i - 1]);
  }
  if (selectedDaleel.length === 0) {
    return { ok: false, error: "no_daleel_selected" };
  }

  let generated: GeneratedDeliverable;
  try {
    generated = await generateDeliverable({
      brief: brief as Brief,
      format: format as KajianFormat,
      segment,
      tone,
      locale,
      pages,
      includeProfile: include_profile,
      selectedDaleel,
      extraContext: extra_context,
    });
  } catch (err) {
    if (err instanceof LlmUnavailableError) {
      return { ok: false, error: "llm_unavailable" };
    }
    console.error("[kajian] generation failed:", err);
    return { ok: false, error: "generation_failed" };
  }

  const cost = computeCost({
    provider: generated.provider,
    model: generated.model,
    tokensIn: generated.tokensIn ?? 0,
    tokensOut: generated.tokensOut ?? 0,
  });

  const [row] = await db
    .insert(schema.deliverables)
    .values({
      briefId: brief.id,
      userId: session.user.id,
      format,
      segment,
      tone,
      locale,
      pages,
      includeProfile: include_profile,
      title: generated.title,
      content: generated.content,
      tokensIn: generated.tokensIn,
      tokensOut: generated.tokensOut,
      costUsd: cost.totalUsd.toFixed(6),
      provider: generated.provider,
      model: generated.model,
    })
    .returning({ id: schema.deliverables.id });

  revalidatePath("/dashboard");
  revalidatePath(`/briefs/${brief.id}`);
  redirect(`/${locale}/kajian/${row.id}`);
}

/* ─── Publish / unpublish / delete ─────────────────────────────────── */

export async function publishKajianAction(
  kajianId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "auth_required" };

  const result = await db
    .update(schema.deliverables)
    .set({ status: "published", publishedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(schema.deliverables.id, kajianId),
        eq(schema.deliverables.userId, session.user.id),
      ),
    )
    .returning({ id: schema.deliverables.id });

  if (result.length === 0) return { ok: false, error: "not_found" };
  revalidatePath("/pustaka-kajian");
  revalidatePath(`/kajian/${kajianId}`);
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function unpublishKajianAction(
  kajianId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "auth_required" };

  const result = await db
    .update(schema.deliverables)
    .set({ status: "draft", publishedAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(schema.deliverables.id, kajianId),
        eq(schema.deliverables.userId, session.user.id),
      ),
    )
    .returning({ id: schema.deliverables.id });

  if (result.length === 0) return { ok: false, error: "not_found" };
  revalidatePath("/pustaka-kajian");
  revalidatePath(`/kajian/${kajianId}`);
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function deleteKajianAction(
  kajianId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "auth_required" };

  const result = await db
    .delete(schema.deliverables)
    .where(
      and(
        eq(schema.deliverables.id, kajianId),
        eq(schema.deliverables.userId, session.user.id),
      ),
    )
    .returning({ id: schema.deliverables.id });

  if (result.length === 0) return { ok: false, error: "not_found" };
  revalidatePath("/dashboard");
  revalidatePath("/pustaka-kajian");
  return { ok: true };
}
