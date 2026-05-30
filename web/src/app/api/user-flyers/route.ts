import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { db, schema } from "@/db";
import { getOverviewInsights } from "@/lib/insights-data";
import { getCurrentTopicContext } from "@/lib/dashboard-metrics";
import { translateHadithToId } from "@/lib/hadith-translation";
import { searchKitabBrowse, type KitabCorpus } from "@/lib/kitab-retrieval";
import {
  generateUserFlyerContent,
  FlyerGenUnavailableError,
} from "@/lib/user-flyer/content-gen";
import {
  assertQuotaAvailable,
  getQuotaSnapshot,
  QuotaExceededError,
} from "@/lib/user-flyer/quota";

/**
 * GET  /api/user-flyers           — list THIS user's flyers (auth required)
 * POST /api/user-flyers           — generate a new flyer (auth required, quota-gated)
 *
 * The PNG itself is served by a sibling route `[id]/png`.
 *
 * POST body shape (`UserFlyerCreateInput`):
 *   {
 *     layout: "hero-ayat" | "hero-headline" | "split-image" | "quote-card" | "dua-hero",
 *     imageRef: string,                    // `flyer_assets.id` OR "upload:<uploadId>"
 *     userPrompt: string,                  // free-text intent, 4-400 chars
 *     includeNewsContext: boolean,
 *     visibility: "private" | "public",
 *   }
 *
 * On success: { id, headline, body, daleel, quota }
 * On quota exhaustion: 429 { error: "quota_exhausted", quota: { ... } }
 * On bad input: 400 { error: "invalid_input", issues: [...] }
 * On LLM/retrieval failure: 503 { error: "generation_failed", detail: ... }
 */

const LAYOUTS = [
  "hero-ayat",
  "hero-headline",
  "split-image",
  "quote-card",
  "dua-hero",
] as const;

const TONES = [
  "scholarly",
  "casual",
  "motivational",
  "empathetic",
  "fiery",
  "gentle",
] as const;
const AUDIENCES = [
  "general",
  "urban_gen_z",
  "working_professionals",
  "parents_families",
  "ibu_pengajian",
  "rural_communities",
  "students",
] as const;

const CreateInput = z.object({
  layout: z.enum(LAYOUTS),
  imageRef: z.string().min(1).max(200),
  userPrompt: z.string().trim().min(4).max(400),
  includeNewsContext: z.boolean(),
  visibility: z.enum(["private", "public"]),
  // Tone + audience are optional and default to "gentle" / "general"
  // when the client doesn't send them — older clients (before the
  // 2026-05-29 form expansion) keep working without sending them.
  tone: z.enum(TONES).optional().default("gentle"),
  audience: z.enum(AUDIENCES).optional().default("general"),
  // Optional. When the user ticked includeNewsContext AND picked a
  // specific topic from the dropdown, this carries its UUID. The route
  // hydrates the topic's keywords + 5 sample headlines and threads
  // them into the LLM prompt as a focused anchor instead of the broad
  // top-category + top-5 trending aggregate.
  selectedTopicId: z.string().uuid().nullable().optional(),
});

// Corpora to consult for daleel retrieval. Skip tafsir (commentary, not
// stand-alone daleel) — matches the briefing-flyer default.
const KITAB_FOR_USER_FLYERS: KitabCorpus[] = [
  "quran",
  "bukhari",
  "muslim",
  "riyad",
  "bulugh",
];

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const rows = await db
    .select({
      id: schema.userFlyers.id,
      layout: schema.userFlyers.layout,
      imageRef: schema.userFlyers.imageRef,
      headline: schema.userFlyers.headline,
      body: schema.userFlyers.body,
      visibility: schema.userFlyers.visibility,
      createdAt: schema.userFlyers.createdAt,
    })
    .from(schema.userFlyers)
    .where(eq(schema.userFlyers.userId, session.user.id))
    .orderBy(desc(schema.userFlyers.createdAt))
    .limit(50);

  const quota = await getQuotaSnapshot(session.user.id);
  return NextResponse.json({ items: rows, quota });
}

export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = CreateInput.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const input = parsed.data;

  // Validate imageRef shape — either a known flyer_assets.id or an
  // "upload:<uuid>" pointer the user owns.
  const imageRefOk = await validateImageRef(userId, input.imageRef);
  if (!imageRefOk) {
    return NextResponse.json({ error: "invalid_image_ref" }, { status: 400 });
  }

  // Quota gate BEFORE we spend on LLM / Qdrant.
  try {
    await assertQuotaAvailable(userId);
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      return NextResponse.json(
        { error: "quota_exhausted", quota: err.snapshot },
        { status: 429 },
      );
    }
    throw err;
  }

  // Optional news context — only pulled when the user opted in.
  // Two modes:
  //  · Specific topic picked from the dropdown → hydrate THAT topic's
  //    keywords + 5 sample headlines so the LLM grounds the flyer in
  //    concrete current conversation.
  //  · No specific topic → fall back to the broad aggregate (top
  //    category + top 5 trending topic labels).
  let news: {
    topCategory: string;
    topTopics: string[];
    pickedLabel?: string;
    pickedKeywords?: string[];
    pickedSampleHeadlines?: string[];
  } | null = null;
  if (input.includeNewsContext) {
    try {
      if (input.selectedTopicId) {
        const ctx = await getCurrentTopicContext(input.selectedTopicId);
        if (ctx) {
          news = {
            // topCategory is required downstream as the "primary
            // anchor"; reuse the picked topic's label there so the
            // generator's existing schema doesn't need a new field.
            topCategory: ctx.label,
            topTopics: ctx.keywords.slice(0, 5),
            pickedLabel: ctx.label,
            pickedKeywords: ctx.keywords,
            pickedSampleHeadlines: ctx.sampleHeadlines,
          };
        }
      }
      // Fallback: stale topic-id (deleted between page-load and submit)
      // or no topic picked → broad aggregate.
      if (!news) {
        const overview = await getOverviewInsights();
        const topCat = overview?.dominantCategories?.[0]?.category ?? null;
        const trending = (overview?.trendingTopics ?? [])
          .map((t) => t.label)
          .filter(Boolean)
          .slice(0, 5);
        if (topCat) {
          news = { topCategory: topCat, topTopics: trending };
        }
      }
    } catch (err) {
      // Non-fatal — degrade to no-news-context mode.
      console.warn(
        "[user-flyers] news context fetch failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  // 1. Flash-Lite writes the copy + search theme.
  let content;
  try {
    content = await generateUserFlyerContent({
      userPrompt: input.userPrompt,
      news,
      tone: input.tone,
      audience: input.audience,
    });
  } catch (err) {
    if (err instanceof FlyerGenUnavailableError) {
      return NextResponse.json(
        { error: "generation_unavailable" },
        { status: 503 },
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "generation_failed", detail: msg },
      { status: 503 },
    );
  }

  // 2. Retrieve daleel from Qdrant — never invent. PRD §12.
  let daleel: {
    citation: string;
    arabic: string;
    translation: string;
    corpus: string;
  } | null = null;
  try {
    const hits = await searchKitabBrowse(content.searchTheme, {
      corpora: KITAB_FOR_USER_FLYERS,
      limit: 5,
      locale: "id",
    });
    const top = hits[0];
    if (top && top.arabic && top.translation && top.citation) {
      // Hadith corpora ship only EN in Qdrant — without this enrichment
      // Indonesian flyers show English daleel even when the user asked
      // for Bahasa. Hits the (corpus, hadithnumber) cache first; falls
      // back to a Flash-Lite translate-then-persist on miss. Quran hits
      // already carry Kemenag ID — skip them.
      let translation = top.translation;
      if (top.corpus !== "quran" && top.corpus !== "tafsir" && top.hadithNumber !== undefined) {
        const id = await translateHadithToId({
          corpus: top.corpus,
          hadithNumber: top.hadithNumber,
          textEn: top.translation,
        });
        if (id) translation = id;
      }

      daleel = {
        citation: top.citation,
        arabic: top.arabic,
        translation,
        corpus: top.corpus,
      };
    }
  } catch (err) {
    // Non-fatal — flyer still renders without a daleel card. Some
    // layouts (HeroHeadline, QuoteCard) don't surface one anyway.
    console.warn(
      "[user-flyers] daleel retrieval failed:",
      err instanceof Error ? err.message : err,
    );
  }

  // 3. Persist.
  const [row] = await db
    .insert(schema.userFlyers)
    .values({
      userId,
      layout: input.layout,
      imageRef: input.imageRef,
      headline: content.headline,
      body: content.body,
      daleelCitation: daleel?.citation ?? null,
      daleelArabic: daleel?.arabic ?? null,
      daleelTranslation: daleel?.translation ?? null,
      daleelCorpus: daleel?.corpus ?? null,
      userPrompt: input.userPrompt,
      includeNewsContext: input.includeNewsContext,
      visibility: input.visibility,
      meta: {
        searchTheme: content.searchTheme,
        newsTopCategory: news?.topCategory ?? null,
        // Tone + audience persisted to meta so a future PNG re-render
        // could re-derive the prompt; no schema column yet because the
        // sort/filter UI doesn't need them as indexed fields.
        tone: input.tone,
        audience: input.audience,
      },
    })
    .returning({ id: schema.userFlyers.id });

  const quota = await getQuotaSnapshot(userId);

  return NextResponse.json(
    {
      id: row.id,
      headline: content.headline,
      body: content.body,
      daleel,
      quota,
    },
    { status: 201 },
  );
}

async function validateImageRef(
  userId: string,
  imageRef: string,
): Promise<boolean> {
  if (imageRef.startsWith("upload:")) {
    const uploadId = imageRef.slice("upload:".length);
    if (!/^[0-9a-f-]{36}$/i.test(uploadId)) return false;
    const [up] = await db
      .select({ id: schema.userFlyerUploads.id })
      .from(schema.userFlyerUploads)
      .where(
        and(
          eq(schema.userFlyerUploads.id, uploadId),
          eq(schema.userFlyerUploads.userId, userId),
        ),
      )
      .limit(1);
    return !!up;
  }

  // Otherwise must reference an existing flyer_assets row (admin pool).
  const [asset] = await db
    .select({ id: schema.flyerAssets.id })
    .from(schema.flyerAssets)
    .where(eq(schema.flyerAssets.id, imageRef))
    .limit(1);
  return !!asset;
}
