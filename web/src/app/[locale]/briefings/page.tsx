import { ForestWash } from "@/components/ForestWash";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowRight, Info } from "lucide-react";

import { Link } from "@/i18n/navigation";

// Always render on demand — this page queries `insights_summaries` for
// each of 5 segments via getAllLatestBriefings(). Static pre-rendering
// at `next build` time has no DB available and would fail.
export const dynamic = "force-dynamic";
import { auth } from "@/auth";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { BriefingsGrid } from "@/components/BriefingsGrid";
import { DigestOptInPrompt } from "@/components/DigestOptInPrompt";
import {
  getAllLatestBriefings,
  getGroupVolumes7d,
  getLatestOccasionBriefing,
} from "@/lib/briefing-data";
import { WatchedRoomsNudge } from "./WatchedRoomsNudge";

/**
 * /briefings — the briefings hub.
 *
 * The page is intentionally minimal: a small hero, the 5 weekly
 * briefings as a grid (the actual product), an optional digest opt-in
 * for signed-in users, an "Explore raw data" link to /radar
 * (where the trending/sentiment/category/per-platform widgets live),
 * and a footer CTA for anonymous visitors.
 *
 * Briefings-first redesign 2026-05-23 — previously the page led with
 * one big "overall-view" hero and buried the 4 segment briefings as
 * small chips. User research showed first-time visitors didn't realize
 * we publish 5 distinct briefings per week.
 */
export async function generateMetadata({
  params,
}: PageProps<"/[locale]/briefings">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Briefing" });
  return { title: t("page_title") };
}

export default async function InsightsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/briefings">) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);

  const t = await getTranslations("Briefing");
  // Proxy.ts redirects non-admin users hitting /briefs/* here with
  // `?notice=briefs-admin-only` — render a small banner so they know
  // why they got bounced (was previously silent, see audit 2026-05-26).
  const showBriefsAdminNotice = sp.notice === "briefs-admin-only";

  const [briefings, volumes, occasion, session] = await Promise.all([
    getAllLatestBriefings(),
    getGroupVolumes7d(),
    getLatestOccasionBriefing(),
    auth(),
  ]);

  let showDigestPrompt = false;
  if (session?.user?.id) {
    const [row] = await db
      .select({ optedIn: schema.users.emailDigestOptIn })
      .from(schema.users)
      .where(eq(schema.users.id, session.user.id))
      .limit(1);
    showDigestPrompt = !row?.optedIn;
  }

  return (
    <div className="relative isolate overflow-hidden bg-paper font-body text-ink">
      <ForestWash />
      {showBriefsAdminNotice && (
        <div className="mx-auto mt-4 max-w-3xl px-4 sm:px-6">
          <div className="flex items-start gap-3 border border-hairline bg-paper-deep px-4 py-3 text-sm leading-relaxed text-ink">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" />
            <div>
              <p className="font-semibold">
                {t("briefs_admin_only_title")}
              </p>
              <p className="mt-0.5 text-ink-muted">
                {t("briefs_admin_only_body")}{" "}
                <Link
                  href="/contact"
                  className="font-semibold text-forest underline hover:text-forest-hover"
                >
                  {t("briefs_admin_only_link")}
                </Link>
              </p>
            </div>
          </div>
        </div>
      )}
      <section className="pt-14 pb-10 sm:pt-20 sm:pb-12">
        <div className="mx-auto max-w-5xl px-4 text-center sm:px-6">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-ink-faint">
            {t("badge")}
          </p>
          <h1 className="mt-5 text-balance font-display text-[clamp(2rem,4.5vw,3.25rem)] font-medium leading-[1.1] tracking-[-0.015em] text-ink">
            {t("title")}
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-pretty text-base leading-[1.7] text-ink-muted sm:text-lg">
            {t("hub_hero_subtitle")}
          </p>
        </div>
      </section>

      <WatchedRoomsNudge />

      <BriefingsGrid
        briefings={briefings}
        volumes={volumes}
        /* "Acara Kalender Islam" occasion card temporarily hidden
           (2026-07-07) — the latest occasion briefing is outdated. The
           query (getLatestOccasionBriefing) + `occasion` var are kept so
           un-hiding is a one-line swap back to `occasion={occasion}`. */
        occasion={null}
        locale={locale}
      />

      {showDigestPrompt && (
        <div className="mx-auto max-w-6xl px-4 pb-8 sm:px-6">
          <DigestOptInPrompt
            title={t("digest_prompt_title")}
            body={t("digest_prompt_body")}
            yesLabel={t("digest_prompt_yes")}
            noLabel={t("digest_prompt_no")}
          />
        </div>
      )}

      {/* "Explore raw data" — pointer to the secondary widgets that used
           to live below the briefings (trending topics, sentiment chart,
           per-platform breakdown). Demoted to a single link so the hub
           stays briefings-focused. */}
      <section className="pb-14 sm:pb-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Link
            href="/radar"
            className="group flex flex-col items-start gap-3 border-t border-hairline pt-6 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <h2 className="font-display text-lg font-medium tracking-[-0.015em] text-ink sm:text-xl">
                {t("hub_explore_title")}
              </h2>
              <p className="mt-1 max-w-xl text-pretty text-sm leading-[1.7] text-ink-muted">
                {t("hub_explore_body")}
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-forest transition group-hover:text-forest-hover">
              {t("hub_explore_cta")}
              <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
            </span>
          </Link>
        </div>
      </section>

      {/* Footer "Apply for Full Access" CTA hidden (2026-05-23) —
          signups paused while the brief feature is admin-only and
          experimental. Anonymous visitors can still browse insights
          without needing the upsell. */}
      {false && !session?.user && (
        <section className="pb-20 sm:pb-28">
          <div className="mx-auto max-w-5xl px-4 sm:px-6">
            <div className="bg-forest px-6 py-12 text-center text-paper sm:px-12">
              <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-paper/60">
                {t("cta_eyebrow_optional")}
              </p>
              <h2 className="mt-6 text-balance font-display text-2xl font-medium tracking-[-0.015em] sm:text-3xl">
                {t("cta_title_optional")}
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-pretty text-sm leading-[1.7] text-paper/80 sm:text-base">
                {t("cta_body_optional")}
              </p>
              <Link
                href="/login"
                className="mt-7 inline-flex h-12 items-center gap-2 rounded-full bg-paper px-6 text-sm font-semibold text-forest transition hover:bg-paper-deep"
              >
                {t("cta_button")}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
