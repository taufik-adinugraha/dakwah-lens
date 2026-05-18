"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { auth } from "@/auth";
import { db, schema } from "@/db";
import { retrieveDaleelSemantic } from "@/lib/quran-retrieval";
import { generateBriefContent } from "@/lib/brief-generator";
import { LlmUnavailableError } from "@/lib/llm";
import type { BriefDaleel, UserProfile } from "@/db/schema";

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

  // 1) Retrieve daleel via Qdrant semantic search.
  // Enrich the query with the target segment so the retrieved verses lean
  // toward what that audience would benefit from.
  const enrichedQuery = `${topic_title} for ${SEGMENT_LABELS[segment].en} audience`;
  const matched = await retrieveDaleelSemantic(enrichedQuery, 3);
  const daleel: BriefDaleel[] = matched.map((d) => ({
    surah: d.surah,
    ayah: d.ayah,
    arabic: d.arabic,
    translation: locale === "id" ? d.translation_id : d.translation_en,
    source: locale === "id" ? d.source_id : d.source_en,
    retrieval_source: d.source,
    retrieval_score: d.score,
  }));

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
  } catch (err) {
    if (err instanceof LlmUnavailableError) {
      console.error("[brief] all LLM providers failed:", err.message);
      return { ok: false, error: "error_llm_unavailable" };
    }
    console.error("[brief] generation error:", err);
    return { ok: false, error: "error_generation_failed" };
  }

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
    })
    .returning({ id: schema.briefs.id });

  console.info(`[brief] generated via ${provider} (id=${row.id})`);
  redirect(`/briefs/${row.id}`);
}

const SEGMENT_LABELS: Record<string, { id: string; en: string }> = {
  urban_gen_z: { id: "Gen Z Perkotaan", en: "Urban Gen Z" },
  working_professionals: { id: "Profesional Muda", en: "Working Professionals" },
  parents_families: { id: "Orang Tua & Keluarga", en: "Parents & Families" },
  rural_communities: { id: "Komunitas Pedesaan", en: "Rural Communities" },
  students: { id: "Pelajar & Mahasiswa", en: "Students" },
};
