import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowRight, BarChart3, Eye, Info, Sparkles } from "lucide-react";

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
    <>
      {showBriefsAdminNotice && (
        <div className="mx-auto mt-4 max-w-3xl px-4 sm:px-6">
          <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm leading-relaxed text-amber-900 shadow-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
            <div>
              <p className="font-semibold">
                {t("briefs_admin_only_title")}
              </p>
              <p className="mt-0.5 text-amber-800">
                {t("briefs_admin_only_body")}{" "}
                <Link
                  href="/contact"
                  className="font-semibold underline hover:text-amber-950"
                >
                  {t("briefs_admin_only_link")}
                </Link>
              </p>
            </div>
          </div>
        </div>
      )}
      <section className="relative isolate overflow-hidden pt-12 pb-8 sm:pt-16 sm:pb-10">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
        >
          <div className="absolute inset-0 grid-bg opacity-50" />
          <div className="absolute -top-20 left-1/2 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-brand-200 opacity-50 blur-3xl" />
        </div>

        <div className="mx-auto max-w-5xl px-4 text-center sm:px-6">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50/80 px-3 py-1 text-xs font-medium text-brand-700 shadow-sm backdrop-blur">
            <Eye className="h-3.5 w-3.5" />
            {t("badge")}
          </span>
          <h1 className="mt-5 text-balance text-3xl font-bold leading-[1.1] tracking-tight text-slate-900 sm:text-5xl">
            {t("title")}
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-pretty text-base leading-relaxed text-slate-600 sm:text-lg">
            {t("hub_hero_subtitle")}
          </p>
        </div>
      </section>

      <WatchedRoomsNudge />

      <BriefingsGrid
        briefings={briefings}
        volumes={volumes}
        occasion={occasion}
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
      <section className="pb-12 sm:pb-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Link
            href="/radar"
            className="group flex flex-col items-start gap-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-900 hover:shadow-md sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex items-start gap-3">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                <BarChart3 className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-base font-bold text-slate-900 sm:text-lg">
                  {t("hub_explore_title")}
                </h2>
                <p className="mt-0.5 text-sm leading-relaxed text-slate-600">
                  {t("hub_explore_body")}
                </p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1.5 self-end rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition group-hover:bg-emerald-700 sm:self-auto">
              {t("hub_explore_cta")}
              <ArrowRight className="h-3.5 w-3.5" />
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
            <div className="relative isolate overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-600 via-emerald-700 to-brand-700 px-6 py-12 text-center text-white shadow-2xl sm:px-12">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 -z-10"
              >
                <div className="absolute -top-24 left-1/3 h-72 w-72 rounded-full bg-amber-300 opacity-25 blur-3xl" />
                <div className="absolute -bottom-24 right-0 h-72 w-72 rounded-full bg-emerald-300 opacity-30 blur-3xl" />
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium text-white/90 backdrop-blur">
                <Sparkles className="h-3.5 w-3.5" />
                {t("cta_eyebrow_optional")}
              </span>
              <h2 className="mt-6 text-balance text-2xl font-bold tracking-tight sm:text-3xl">
                {t("cta_title_optional")}
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-pretty text-sm leading-relaxed text-white/85 sm:text-base">
                {t("cta_body_optional")}
              </p>
              <Link
                href="/login"
                className="mt-7 inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 text-sm font-semibold text-emerald-800 shadow-lg transition hover:bg-emerald-50"
              >
                {t("cta_button")}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
