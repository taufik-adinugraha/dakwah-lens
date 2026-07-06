import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { and, count, eq, sql } from "drizzle-orm";

import { auth } from "@/auth";
import { db, schema } from "@/db";
import { Hero } from "@/components/landing/Hero";
import { InsightsPreview } from "@/components/landing/InsightsPreview";
import { WhyNotLlm } from "@/components/landing/WhyNotLlm";
import { DaleelMoment } from "@/components/landing/DaleelMoment";
import { HowItWorksSection } from "@/components/landing/HowItWorksSection";
import { ForWhom } from "@/components/landing/ForWhom";
import { Support } from "@/components/landing/Support";
import { getLandingInsights } from "@/lib/landing-data";
import { formatPanggilan } from "@/lib/panggilan";
import type { UserProfile } from "@/db/schema";

/** Live coverage stats surfaced on the landing page. */
type Coverage = {
  outlets: number;
  socialPlatforms: number;
  postsAnalyzed30d: number;
};

const SOCIAL_PLATFORMS = ["x", "instagram", "tiktok", "youtube"] as const;

async function getCoverage(): Promise<Coverage> {
  // Run the counts in parallel. Each hits an indexed column so the
  // landing page stays fast (<10ms on the queries themselves).
  const [outletRows, postRows] = await Promise.all([
    db
      .select({ n: count() })
      .from(schema.rssFeeds)
      .where(eq(schema.rssFeeds.enabled, true)),
    // "Posts analyzed" = ones that actually completed the classification
    // pipeline (Gemini relevance set). Heuristic-skipped + failed-classification
    // rows stay in the table but don't count toward the figure shown on the
    // homepage. We count mainstream RSS too; it's the majority of the corpus.
    db
      .select({ n: count() })
      .from(schema.socialPosts)
      .where(
        and(
          sql`created_at >= now() - interval '30 days'`,
          sql`dawah_opportunity IS NOT NULL`,
        ),
      ),
  ]);
  return {
    outlets: outletRows[0]?.n ?? 0,
    socialPlatforms: SOCIAL_PLATFORMS.length,
    postsAnalyzed30d: postRows[0]?.n ?? 0,
  };
}

/**
 * Landing page — 2026-07 "serene spiritual minimalism" redesign.
 *
 * One design language throughout (see components/landing/): warm paper
 * ground, ink text, a single forest-green accent, Fraunces display over
 * Inter body, hairline separators, and subtle reveal motion. The page's
 * one job is to move visitors into the public Insights with zero
 * friction — every section either shows live value or removes a doubt.
 */
export default async function LandingPage({
  params,
  searchParams,
}: PageProps<"/[locale]">) {
  const { locale } = await params;
  const { view } = await searchParams;

  // CHECK AUTH + REDIRECT FIRST, before any streaming work begins.
  //
  // Signed-in approved users belong on the dashboard, not the marketing
  // landing — UNLESS they explicitly asked for the marketing view (e.g.
  // they clicked "Features" / "How it works" / "Donate" in the header,
  // which append `?view=marketing` precisely for this purpose).
  //
  // This must run BEFORE setRequestLocale / getTranslations / data
  // fetches. Once those start, Next.js 16 commits to streaming the
  // response body and `redirect()` falls back to a `<meta refresh>`
  // tag — visible as a flash of broken page before the dashboard
  // appears (reported by user 2026-05-21).
  const session = await auth();
  if (session?.user?.status === "approved" && view !== "marketing") {
    redirect("/dashboard");
  }

  // From here on, the user is either anonymous OR pending OR explicitly
  // chose marketing-view. Safe to start the heavier rendering work.
  setRequestLocale(locale);

  const [tLanding, tDaleel, tDonate, coverage, insights] = await Promise.all([
    getTranslations("Landing"),
    getTranslations("Daleel"),
    getTranslations("Donate"),
    getCoverage(),
    getLandingInsights(),
  ]);

  // Look up the profile so we can address signed-in viewers by their
  // preferred panggilan instead of their bare first name.
  let viewerProfile: UserProfile | null = null;
  if (session?.user?.id) {
    const [row] = await db
      .select({ profile: schema.users.profile })
      .from(schema.users)
      .where(eq(schema.users.id, session.user.id))
      .limit(1);
    viewerProfile = row?.profile ?? null;
  }

  const approved = session?.user?.status === "approved";
  const viewer = {
    signedIn: Boolean(session?.user),
    name: session?.user
      ? formatPanggilan(viewerProfile, session.user.name) ||
        session.user.email?.split("@")[0] ||
        ""
      : "",
  };

  return (
    <div className="bg-paper font-body">
      <Hero t={tLanding} locale={locale} viewer={viewer} coverage={coverage} />
      <InsightsPreview t={tLanding} locale={locale} insights={insights} />
      <WhyNotLlm t={tLanding} />
      <DaleelMoment t={tLanding} tDaleel={tDaleel} />
      <HowItWorksSection t={tLanding} locale={locale} coverage={coverage} />
      <ForWhom t={tLanding} />
      {/* The access note half of Support is onboarding copy — hidden
          for already-approved users viewing the marketing page. */}
      <Support t={tLanding} tDonate={tDonate} showAccessNote={!approved} />
    </div>
  );
}
