import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { eq } from "drizzle-orm";

import { auth } from "@/auth";
import { db, schema } from "@/db";
import { localeAlternates } from "@/lib/seo";
import { JsonLd } from "@/components/JsonLd";
import { organizationSchema, websiteSchema } from "@/lib/seo-schema";
import { Hero } from "@/components/landing/Hero";
import { InsightsPreview } from "@/components/landing/InsightsPreview";
import { WhyNotLlm } from "@/components/landing/WhyNotLlm";
import { DaleelMoment } from "@/components/landing/DaleelMoment";
import { HowItWorksSection } from "@/components/landing/HowItWorksSection";
import { ForWhom } from "@/components/landing/ForWhom";
import { Support } from "@/components/landing/Support";
import { ACTIVE_SOCIAL_PLATFORMS } from "@/lib/ingest-status";
import { getLandingCoverage, getLandingInsights } from "@/lib/landing-data";
import { formatPanggilan } from "@/lib/panggilan";
import type { UserProfile } from "@/db/schema";

/** Live coverage stats surfaced on the landing page. */
type Coverage = {
  outlets: number;
  socialPlatforms: number;
  postsAnalyzed30d: number;
};


/**
 * Landing page — 2026-07 "serene spiritual minimalism" redesign.
 *
 * One design language throughout (see components/landing/): warm paper
 * ground, ink text, a single forest-green accent, Fraunces display over
 * Inter body, hairline separators, and subtle reveal motion. The page's
 * one job is to move visitors into the public Insights with zero
 * friction — every section either shows live value or removes a doubt.
 */
export async function generateMetadata({
  params,
}: PageProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  return { alternates: localeAlternates({ locale, canonicalPath: "" }) };
}

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

  // The two data reads come from lib/landing-data.ts, which keeps them for an
  // hour: the post count scans the whole table (~3 s), and this page used to
  // run it on every visit. Do not put a query for either back in this file.
  const [tLanding, tDaleel, tDonate, counts, insights] = await Promise.all([
    getTranslations("Landing"),
    getTranslations("Daleel"),
    getTranslations("Donate"),
    getLandingCoverage(),
    getLandingInsights(),
  ]);
  const coverage: Coverage = {
    ...counts,
    // The social platforms fetched TODAY (YouTube only since 2026-10-13),
    // not every platform a scraper exists for: lib/ingest-status.ts.
    socialPlatforms: ACTIVE_SOCIAL_PLATFORMS.length,
  };

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
      <JsonLd data={[organizationSchema(), websiteSchema()]} />
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
