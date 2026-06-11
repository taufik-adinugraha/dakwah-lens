import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  AlertCircle,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  BookOpenCheck,
  Brain,
  Building2,
  CheckCircle2,
  Clock,
  Coins,
  Compass,
  Eye,
  Globe2,
  Heart,
  ListChecks,
  Mail,
  Newspaper,
  QrCode,
  Quote,
  ScrollText,
  Radar,
  Radio,
  ShieldCheck,
  Sparkles,
  UserCircle2,
  Workflow,
} from "lucide-react";
import { and, count, eq, sql } from "drizzle-orm";

import { auth } from "@/auth";
import { db, schema } from "@/db";
import { Link } from "@/i18n/navigation";
import { HeroBackground } from "@/components/HeroBackground";
import { HeroSlideshow } from "@/components/HeroSlideshow";
import { I18nText } from "@/components/I18nText";
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
  // Run all three counts in parallel. Each hits an indexed column so the
  // landing page stays fast (<10ms on the queries themselves).
  const [outletRows, postRows] = await Promise.all([
    db
      .select({ n: count() })
      .from(schema.rssFeeds)
      .where(eq(schema.rssFeeds.enabled, true)),
    // "Posts analyzed" = ones that actually completed the classification
    // pipeline (Gemini relevance set). Heuristic-skipped + failed-classification
    // rows stay in the table but don't count toward the figure shown on the
    // homepage — the card promises "Sentiment + relevance classified". We
    // count mainstream RSS too; it's the majority of the corpus.
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
  // This must run BEFORE setRequestLocale / getTranslations / getCoverage.
  // Once those start, Next.js 16 commits to streaming the response body
  // and `redirect()` falls back to embedding a `<meta http-equiv=refresh>`
  // tag instead of sending an HTTP 307. Browsers render the half-page
  // and then meta-refresh after 1s — visible as a flash of "page can't
  // load" before the dashboard appears (reported by user 2026-05-21).
  const session = await auth();
  if (session?.user?.status === "approved" && view !== "marketing") {
    redirect("/dashboard");
  }

  // From here on, the user is either anonymous OR pending OR explicitly
  // chose marketing-view. Safe to start the heavier rendering work.
  setRequestLocale(locale);

  const [tLanding, tDaleel, tDonate, coverage] = await Promise.all([
    getTranslations("Landing"),
    getTranslations("Daleel"),
    getTranslations("Donate"),
    getCoverage(),
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

  // Compute `approved` from session.user.status — NOT hardcoded false.
  // Without this, an approved user who lands on /?view=marketing (via
  // "Features"/"How it works"/"Donate" header links that intentionally
  // skip the dashboard redirect) was being shown the pending-review CTA
  // even though they're already approved.
  const role = session?.user?.role;
  const canCreateBriefs = role === "admin" || role === "superadmin";
  const viewer: Viewer = session?.user
    ? {
        signedIn: true,
        approved: session.user.status === "approved",
        canCreateBriefs,
        name:
          formatPanggilan(viewerProfile, session.user.name) ||
          session.user.email?.split("@")[0] ||
          "",
      }
    : { signedIn: false, approved: false, canCreateBriefs: false, name: "" };

  return (
    <>
      <Hero t={tLanding} viewer={viewer} />
      <Features t={tLanding} />
      <WhyNotJustLlm t={tLanding} />
      <HowItWorks t={tLanding} coverage={coverage} />
      <Daleel t={tDaleel} />
      <Donate t={tDonate} />
      {!viewer.approved && <SignupJourney t={tLanding} />}
      {/* "Ready for more targeted da'wah?" CTA hidden (2026-05-23) —
          we paused account signups + the apply-for-full-access pitch
          while the brief feature is admin-only and experimental. */}
      {false && <FinalCTA t={tLanding} viewer={viewer} />}
    </>
  );
}

type Viewer = {
  signedIn: boolean;
  approved: boolean;
  /** Brief generation is admin-only while the feature is experimental
   *  (2026-05-23). `canCreateBriefs` reflects role, NOT just approval. */
  canCreateBriefs: boolean;
  name: string;
};

type LandingT = Awaited<ReturnType<typeof getTranslations<"Landing">>>;
type DaleelT = Awaited<ReturnType<typeof getTranslations<"Daleel">>>;
type DonateT = Awaited<ReturnType<typeof getTranslations<"Donate">>>;

function Hero({ t, viewer }: { t: LandingT; viewer: Viewer }) {
  return (
    <section className="relative isolate overflow-hidden pt-10 pb-20 sm:pt-16 sm:pb-28">
      <HeroBackground />

      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div
          className="mx-auto max-w-3xl text-center animate-fade-up"
          style={{ animationDelay: "0.05s" }}
        >
          {viewer.signedIn ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50/80 px-3 py-1 text-xs font-medium text-brand-700 shadow-sm backdrop-blur">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {t("signed_in_greeting", { name: viewer.name })}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50/80 px-3 py-1 text-xs font-medium text-emerald-700 shadow-sm backdrop-blur">
              <Sparkles className="h-3.5 w-3.5" />
              {t("badge")}
            </span>
          )}

          <h1 className="mt-6 text-balance text-4xl font-bold leading-[1.05] tracking-tight text-slate-900 sm:text-5xl md:text-6xl">
            {t("hero_title_top")}{" "}
            <span className="text-gradient-brand">
              {t("hero_title_gradient")}
            </span>{" "}
            {t("hero_title_bottom")}
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-pretty text-base leading-relaxed text-slate-600 sm:text-lg">
            {t("hero_body")}
          </p>

          {viewer.signedIn ? (
            <SignedInCtas
              t={t}
              approved={viewer.approved}
              canCreateBriefs={viewer.canCreateBriefs}
            />
          ) : (
            <AnonymousCtas t={t} />
          )}
        </div>

        {/* Hero slideshow temporarily hidden (2026-05-23) — the slides
            referenced features we've since reorganized. Resurrect once
            the new content kit is ready to showcase visually. */}
        {false && (
          <div
            className="mx-auto mt-16 max-w-5xl animate-fade-up"
            style={{ animationDelay: "0.2s" }}
          >
            <HeroSlideshow />
          </div>
        )}
      </div>
    </section>
  );
}

function AnonymousCtas({ t }: { t: LandingT }) {
  // Primary CTA: a substantial card pointing first-time visitors at
  // Public Insights — the lowest-friction surface (no signup, real data,
  // immediately useful). The user-feedback finding that drove this
  // redesign: in the previous three-button row, new visitors didn't
  // know which to click first. Promoting Insights to the visual hero
  // gives a clear "start here" path; the signup + how-it-works actions
  // sit below as smaller pills for users who already know they want
  // them.
  return (
    <div className="mt-10 flex flex-col items-center">
      {/* Primary: Insights card */}
      <Link
        href="/briefings"
        className="group relative w-full max-w-xl overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-600 px-7 py-7 text-left shadow-xl shadow-emerald-500/25 transition hover:shadow-2xl hover:shadow-emerald-500/35 hover:scale-[1.01] sm:px-9 sm:py-8"
      >
        {/* Subtle radial glow in top-right corner */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-white/15 blur-3xl"
        />
        <div className="relative flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-100">
              <Sparkles className="h-3 w-3" />
              {t("hero_start_here_label")}
            </span>
            <h2 className="mt-2 text-balance text-2xl font-bold leading-tight text-white sm:text-3xl">
              {t("hero_insights_card_title")}
            </h2>
            <p className="mt-2 text-pretty text-sm leading-relaxed text-emerald-50/95 sm:text-base">
              {t("hero_insights_card_body")}
            </p>
          </div>
          <span className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/15 text-white transition group-hover:translate-x-1 group-hover:bg-white/25 sm:flex">
            <ArrowRight className="h-5 w-5" />
          </span>
        </div>
      </Link>

      {/* No-login reassurance under the primary card — directly addresses
           user research showing first-time visitors assumed they needed to
           sign up before reading anything. */}
      <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
        {t("hero_no_login_required")}
      </p>

      {/* Bridge text: login is for personalization + team review.
          The follow-up link gives a concrete path for users who decide
          they want beta access — the open self-serve sign-up button
          stays hidden (manual approval queue) but the intent has
          somewhere to go. */}
      <p className="mt-6 max-w-md text-center text-xs leading-relaxed text-slate-500">
        {t("hero_login_purpose")}
      </p>
      <Link
        href="/contact"
        className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 transition hover:underline"
      >
        {t("hero_request_access")}
        <ArrowRight className="h-3 w-3" />
      </Link>

      {/* Secondary actions */}
      {/* Sign-up CTA hidden 2026-05-23 — beta quota is limited; we review
          each request manually before approving access, so the front-door
          flow is "read public insights, contact us if you need access"
          rather than an open self-serve sign-up button. */}
      <div className="mt-4 flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:items-center sm:gap-3">
        <Link
          href="#how-it-works"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
        >
          <Workflow className="h-3.5 w-3.5" />
          {t("cta_secondary")}
        </Link>
      </div>
    </div>
  );
}

function SignedInCtas({
  t,
  approved,
  canCreateBriefs,
}: {
  t: LandingT;
  approved: boolean;
  canCreateBriefs: boolean;
}) {
  return (
    <>
      <div className="mt-8 flex flex-col flex-wrap items-center justify-center gap-3 sm:flex-row">
        {canCreateBriefs ? (
          // Admin / superadmin → still gets the "create brief" CTA. The
          // feature is experimental but available to the team.
          <Link
            href="/briefs/new"
            className="group inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-slate-900 px-6 text-sm font-semibold text-white shadow-lg shadow-slate-900/15 transition hover:bg-slate-800 sm:w-auto"
          >
            <Sparkles className="h-4 w-4" />
            {t("signed_in_cta_primary")}
            <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
          </Link>
        ) : approved ? (
          // Approved user (but not admin) → brief generation is paused
          // for them while the feature is experimental. Steer to insights.
          <Link
            href="/briefings"
            className="group inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-slate-900 px-6 text-sm font-semibold text-white shadow-lg shadow-slate-900/15 transition hover:bg-slate-800 sm:w-auto"
          >
            <Sparkles className="h-4 w-4" />
            {t("signed_in_cta_tertiary")}
            <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
          </Link>
        ) : (
          <span className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-6 text-sm font-semibold text-amber-800 sm:w-auto">
            <Clock className="h-4 w-4" />
            {t("pending_account_note")}
          </span>
        )}
        <Link
          href="/briefings"
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-emerald-200 bg-emerald-50/80 px-6 text-sm font-semibold text-emerald-700 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-100 sm:w-auto"
        >
          <Globe2 className="h-4 w-4" />
          {t("signed_in_cta_secondary")}
        </Link>
        <Link
          href="/kitab"
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-6 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 sm:w-auto"
        >
          <BookOpen className="h-4 w-4" />
          {t("signed_in_cta_tertiary")}
        </Link>
      </div>
    </>
  );
}

function Features({ t }: { t: LandingT }) {
  // Four cards arranged as a left-to-right pipeline: signal → meaning →
  // output → foundation. The "Briefing Mingguan" card is the focal one
  // because it's the actual deliverable — the other three describe how
  // it's built.
  const items = [
    {
      icon: Radar,
      title: t("feature_monitor_title"),
      body: t("feature_monitor_body"),
      tone: "from-brand-500 to-cyan-500",
    },
    {
      icon: Brain,
      title: t("feature_analyze_title"),
      body: t("feature_analyze_body"),
      tone: "from-cyan-500 to-emerald-500",
    },
    {
      icon: Newspaper,
      title: t("feature_briefing_title"),
      body: t("feature_briefing_body"),
      tone: "from-emerald-500 to-teal-500",
      featured: true,
    },
    {
      icon: BookOpenCheck,
      title: t("feature_advise_title"),
      body: t("feature_advise_body"),
      tone: "from-emerald-500 to-emerald-600",
    },
  ];

  return (
    <section id="features" className="py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            {t("features_title")}
          </h2>
          <p className="mt-4 text-pretty text-base leading-relaxed text-slate-600">
            {t("features_subtitle")}
          </p>
        </div>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {items.map(({ icon: Icon, title, body, tone, featured }) => (
            <div
              key={title}
              className={`group relative overflow-hidden rounded-2xl border bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                featured
                  ? "border-emerald-300 ring-2 ring-emerald-100"
                  : "border-slate-200"
              }`}
            >
              {featured && (
                <span className="absolute right-4 top-4 inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                  {t("feature_briefing_badge")}
                </span>
              )}
              <div
                className={`mb-5 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${tone} text-white shadow-sm`}
              >
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="text-balance text-lg font-semibold text-slate-900">{title}</h3>
              <p className="mt-2 text-pretty text-sm leading-relaxed text-slate-600">
                <I18nText text={body} />
              </p>
              <span className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-gradient-to-br from-brand-100/0 to-emerald-100/40 opacity-0 transition group-hover:opacity-100" />
            </div>
          ))}
        </div>

        <BriefingShowcase t={t} />
      </div>
    </section>
  );
}

/**
 * Featured callout below the four feature cards — goes deeper on the
 * weekly briefing as the actual deliverable. Lists what's inside one
 * briefing, the schedule cadence, and links to the briefings hub.
 *
 * Keeps the homepage's "what you'll get" story concrete and removes the
 * need for new visitors to click through to /briefings to understand
 * what we actually publish.
 */
function BriefingShowcase({ t }: { t: LandingT }) {
  const ingredients = [
    {
      icon: BookOpen,
      title: t("briefing_showcase_item_khutbah_title"),
      body: t("briefing_showcase_item_khutbah_body"),
    },
    {
      icon: Compass,
      title: t("briefing_showcase_item_kajian_title"),
      body: t("briefing_showcase_item_kajian_body"),
    },
    {
      icon: ScrollText,
      title: t("briefing_showcase_item_kisah_title"),
      body: t("briefing_showcase_item_kisah_body"),
    },
    {
      icon: Heart,
      title: t("briefing_showcase_item_home_title"),
      body: t("briefing_showcase_item_home_body"),
    },
    {
      icon: Sparkles,
      title: t("briefing_showcase_item_content_title"),
      body: t("briefing_showcase_item_content_body"),
    },
    {
      icon: ArrowUpRight,
      title: t("briefing_showcase_item_genz_title"),
      body: t("briefing_showcase_item_genz_body"),
    },
    {
      icon: Building2,
      title: t("briefing_showcase_item_action_title"),
      body: t("briefing_showcase_item_action_body"),
    },
  ];

  return (
    <div className="mt-16 overflow-hidden rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50/70 via-white to-cyan-50/40 shadow-sm">
      <div className="grid gap-0 lg:grid-cols-[1fr_1.4fr]">
        {/* Left: pitch */}
        <div className="border-b border-emerald-100 px-7 py-8 sm:px-9 lg:border-b-0 lg:border-r">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
            <Sparkles className="h-3 w-3" />
            {t("briefing_showcase_eyebrow")}
          </span>
          <h3 className="mt-4 text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            {t("briefing_showcase_title")}
          </h3>
          <p className="mt-3 text-pretty text-sm leading-relaxed text-slate-600 sm:text-base">
            {t("briefing_showcase_body")}
          </p>

          <ul className="mt-5 space-y-2.5 text-sm text-slate-700">
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span>{t("briefing_showcase_bullet_cadence")}</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span>{t("briefing_showcase_bullet_segments")}</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span>{t("briefing_showcase_bullet_daleel")}</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span>{t("briefing_showcase_bullet_discussion")}</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span>{t("briefing_showcase_bullet_free")}</span>
            </li>
          </ul>

          <Link
            href="/briefings"
            className="mt-7 inline-flex h-11 items-center gap-2 rounded-full bg-emerald-700 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800"
          >
            {t("briefing_showcase_cta")}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        {/* Right: 6-item content-kit grid — shows what's inside ONE briefing */}
        <div className="bg-white px-7 py-8 sm:px-9">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            {t("briefing_showcase_kit_label")}
          </p>
          <h4 className="mt-1 text-balance text-base font-bold text-slate-900 sm:text-lg">
            {t("briefing_showcase_kit_title")}
          </h4>

          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {ingredients.map(({ icon: Icon, title, body }) => (
              <li
                key={title}
                className="flex items-start gap-2.5 rounded-xl border border-slate-100 bg-slate-50/50 px-3 py-3"
              >
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-bold text-slate-900">{title}</p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-slate-600">
                    {body}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/**
 * Positioning section answering the natural objection: "ChatGPT / Claude /
 * DeepSeek can already do this — why a dedicated tool?" Side-by-side card
 * pair: a generic LLM column vs the Dakwah-Lens column. Anchored on four
 * things general LLMs structurally can't deliver: retrieved-not-generated
 * daleel (PRD §12), live Indonesian discourse signal, sharia-compliance
 * guardrails, and pre-computed da'wah-opportunity context.
 */
function WhyNotJustLlm({ t }: { t: LandingT }) {
  const rows = [
    { llm: t("why_llm_row1_llm"), us: t("why_llm_row1_us") },
    { llm: t("why_llm_row2_llm"), us: t("why_llm_row2_us") },
    { llm: t("why_llm_row3_llm"), us: t("why_llm_row3_us") },
    { llm: t("why_llm_row4_llm"), us: t("why_llm_row4_us") },
  ];

  return (
    <section id="why-not-llm" className="border-t border-slate-100 bg-gradient-to-b from-white to-slate-50/40 py-20 sm:py-28">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
            {t("why_llm_eyebrow")}
          </span>
          <h2 className="mt-4 text-balance text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            {t("why_llm_title")}
          </h2>
          <I18nText
            text={t("why_llm_subtitle")}
            className="mx-auto mt-4 block max-w-xl text-pretty text-base leading-relaxed text-slate-600"
          />
        </div>

        <div className="mt-14 grid gap-5 lg:grid-cols-2">
          {/* Generic LLM column */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
            <I18nText
              text={t("why_llm_col_llm_eyebrow")}
              className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500"
            />
            <h3 className="mt-2 text-balance text-lg font-semibold text-slate-900">
              {t("why_llm_col_llm_title")}
            </h3>
            <ul className="mt-5 space-y-3 text-sm leading-relaxed text-slate-700">
              {rows.map((r, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span aria-hidden className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
                  <span>{r.llm}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Dakwah-Lens column */}
          <div className="relative overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-br from-white via-emerald-50/40 to-brand-50/30 p-6 shadow-sm ring-1 ring-emerald-100 sm:p-7">
            <span
              aria-hidden
              className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-emerald-200 opacity-25 blur-2xl"
            />
            <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
              {t("why_llm_col_us_eyebrow")}
            </p>
            <h3 className="mt-2 text-balance text-lg font-semibold text-slate-900">
              {t("why_llm_col_us_title")}
            </h3>
            <ul className="mt-5 space-y-3 text-sm leading-relaxed text-slate-800">
              {rows.map((r, i) => (
                <li key={i} className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <span>{r.us}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <p className="mx-auto mt-10 max-w-2xl text-pretty text-center text-sm text-slate-500">
          {t("why_llm_footnote")}
        </p>
      </div>
    </section>
  );
}

function HowItWorks({
  t,
  coverage,
}: {
  t: LandingT;
  coverage: Coverage;
}) {
  const steps = [
    {
      icon: Radar,
      title: t("how_step_1_title"),
      body: t("how_step_1_body"),
    },
    {
      icon: Compass,
      title: t("how_step_2_title"),
      body: t("how_step_2_body"),
    },
    {
      icon: BookOpenCheck,
      title: t("how_step_3_title"),
      body: t("how_step_3_body"),
    },
  ];

  // Skip the analyzed-posts card when the corpus is empty — better to show
  // nothing than a 0 that reads like the product doesn't work.
  const showPostsCard = coverage.postsAnalyzed30d > 0;

  return (
    <section
      id="how-it-works"
      className="relative bg-gradient-to-b from-white to-slate-50 py-20 sm:py-28"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            {t("how_title")}
          </h2>
        </div>

        <ol className="mt-10 grid gap-6 sm:grid-cols-3">
          {steps.map(({ icon: Icon, title, body }, i) => (
            <li
              key={title}
              className="relative rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <div className="absolute -top-3 left-6 inline-flex h-7 items-center rounded-full bg-slate-900 px-2.5 text-xs font-semibold text-white shadow">
                Step {i + 1}
              </div>
              <Icon className="h-6 w-6 text-brand-600" />
              <h3 className="mt-4 text-balance text-base font-semibold text-slate-900">
                {title}
              </h3>
              <p className="mt-2 text-pretty text-sm leading-relaxed text-slate-600">
                {body}
              </p>
            </li>
          ))}
        </ol>

        <div
          className={`mt-16 grid gap-4 ${
            showPostsCard ? "sm:grid-cols-3" : "sm:grid-cols-2"
          }`}
        >
          <CoverageCard
            icon={Newspaper}
            value={coverage.outlets.toString()}
            label={t("how_coverage_outlets_label", {
              count: coverage.outlets,
            })}
            hint={t("how_coverage_outlets_hint")}
            tone="brand"
          />
          <CoverageCard
            icon={Radio}
            value={coverage.socialPlatforms.toString()}
            label={t("how_coverage_platforms_label", {
              count: coverage.socialPlatforms,
            })}
            hint={t("how_coverage_platforms_hint")}
            tone="emerald"
          />
          {showPostsCard && (
            <CoverageCard
              icon={Sparkles}
              value={coverage.postsAnalyzed30d.toLocaleString()}
              label={t("how_coverage_posts_label", {
                count: coverage.postsAnalyzed30d,
              })}
              hint={t("how_coverage_posts_hint")}
              tone="violet"
            />
          )}
        </div>

        <div className="mx-auto mt-6 flex max-w-2xl flex-col items-center gap-1 text-pretty text-center text-sm text-slate-600">
          <p className="inline-flex items-center gap-2">
            <Clock className="h-4 w-4 shrink-0 text-slate-400" />
            <span className="font-semibold text-slate-700">
              {t("how_schedule_intro")}
            </span>
          </p>
          <p>{t("how_schedule_detail")}</p>
        </div>

        <div className="mt-8 flex justify-center">
          <Link
            href="/how-it-works"
            className="inline-flex h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-5 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
          >
            <BookOpen className="h-3.5 w-3.5 text-brand-600" />
            {t("how_technical_link")}
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </section>
  );
}

function CoverageCard({
  icon: Icon,
  value,
  label,
  hint,
  tone,
}: {
  icon: typeof Newspaper;
  value: string;
  label: string;
  hint: string;
  tone: "brand" | "emerald" | "violet";
}) {
  const iconBg =
    tone === "brand"
      ? "bg-brand-50 text-brand-700"
      : tone === "emerald"
        ? "bg-emerald-50 text-emerald-700"
        : "bg-violet-50 text-violet-700";
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start gap-3">
        <span className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${iconBg}`}>
          <Icon className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0">
          <p className="text-3xl font-bold tabular-nums text-slate-900 sm:text-4xl">
            {value}
          </p>
          <p className="mt-0.5 text-sm font-semibold text-slate-900">{label}</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">{hint}</p>
        </div>
      </div>
    </div>
  );
}

function Daleel({ t }: { t: DaleelT }) {
  const items = [
    {
      kind: "quran" as const,
      arabic: t("verse_1_arabic"),
      translation: t("verse_1_translation"),
      source: t("verse_1_source"),
      note: t("verse_1_note"),
    },
    {
      kind: "quran" as const,
      arabic: t("verse_2_arabic"),
      translation: t("verse_2_translation"),
      source: t("verse_2_source"),
      note: t("verse_2_note"),
    },
    {
      kind: "hadith" as const,
      arabic: t("verse_3_arabic"),
      translation: t("verse_3_translation"),
      source: t("verse_3_source"),
      note: t("verse_3_note"),
    },
  ];

  return (
    <section id="daleel" className="relative overflow-hidden py-20 sm:py-28">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-to-b from-white via-emerald-50/40 to-white" />
        <div className="absolute left-1/2 top-1/3 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-emerald-100 opacity-40 blur-3xl" />
      </div>

      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            {t("title")}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-pretty text-base leading-relaxed text-slate-600">
            {t("subtitle")}
          </p>
        </div>

        <div className="mt-14 grid gap-5 lg:grid-cols-3">
          {items.map(({ kind, arabic, translation, source, note }) => (
            <article
              key={source}
              className="relative flex flex-col rounded-2xl border border-emerald-100 bg-white/80 p-6 shadow-sm ring-1 ring-emerald-50 backdrop-blur"
            >
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 ring-1 ring-emerald-100">
                  {kind === "quran" ? t("label_quran") : t("label_hadith")}
                </span>
                <Quote className="h-4 w-4 text-emerald-300" />
              </div>

              <p
                dir="rtl"
                lang="ar"
                className="mt-5 font-arabic text-2xl leading-[2.1] text-slate-900 sm:text-[1.65rem]"
              >
                {arabic}
              </p>

              <p className="mt-5 text-pretty text-sm leading-relaxed text-slate-700">
                <span aria-hidden>“</span>
                {translation}
                <span aria-hidden>”</span>
              </p>

              <p className="mt-3 text-xs font-medium tracking-wide text-emerald-700">
                — {source}
              </p>

              <div className="mt-5 border-t border-emerald-100/80 pt-4">
                <p className="text-pretty text-xs leading-relaxed text-slate-500">{note}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function Donate({ t }: { t: DonateT }) {
  return (
    <section
      id="donate"
      className="relative overflow-hidden py-20 sm:py-28"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
      >
        <div className="absolute top-1/2 left-1/2 h-[400px] w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-200 opacity-30 blur-3xl" />
      </div>

      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
            <Heart className="h-3.5 w-3.5" />
            {t("badge")}
          </span>
          <h2 className="mt-6 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            {t("title")}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-pretty text-base leading-relaxed text-slate-600">
            {t("body")}
          </p>
        </div>

        <div className="mt-12">
          <h3 className="text-center text-xs font-semibold uppercase tracking-wider text-slate-500">
            {t("methods_title")}
          </h3>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <DonateMethod
              icon={Building2}
              label={t("bank_label")}
              status={t("bank_status")}
              comingSoon
            />
            <DonateMethod
              icon={QrCode}
              label={t("qris_label")}
              status={t("qris_status")}
              comingSoon
            />
          </div>

          <p className="mx-auto mt-8 max-w-xl text-pretty text-center text-xs leading-relaxed text-slate-500">
            {t("note")}
          </p>

          <div className="mt-6 flex justify-center">
            <Link
              href="/transparency"
              className="inline-flex h-10 items-center gap-2 rounded-full border border-emerald-200 bg-white px-5 text-xs font-semibold text-emerald-800 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50"
            >
              {t("transparency_link")}
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function DonateMethod({
  icon: Icon,
  label,
  status,
  comingSoon,
  email,
}: {
  icon: typeof Heart;
  label: string;
  status: string;
  comingSoon?: boolean;
  email?: string;
}) {
  return (
    <div className="relative rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
          <Icon className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <p className="text-sm font-semibold text-slate-900">{label}</p>
          {comingSoon && (
            <span className="text-[10px] font-medium uppercase tracking-wider text-amber-600">
              Coming Soon
            </span>
          )}
        </div>
      </div>
      <p className="mt-3 text-pretty text-sm leading-relaxed text-slate-600">{status}</p>
      {email && (
        <a
          href={`mailto:${email}`}
          className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:text-emerald-900"
        >
          {email}
          <ArrowRight className="h-3.5 w-3.5" />
        </a>
      )}
    </div>
  );
}

function FinalCTA({ t, viewer }: { t: LandingT; viewer: Viewer }) {
  // Admin → invite them to generate a brief (still experimental).
  // Approved non-admin → invite them to explore insights (brief
  // generation is paused for regular users).
  // Pending user → encourage them to explore public insights.
  // Anonymous → original "Apply for Full Access" pitch.
  const variant =
    viewer.signedIn && viewer.canCreateBriefs
      ? "create_brief"
      : viewer.signedIn
        ? "pending_explore"
        : "apply";

  const title =
    variant === "create_brief"
      ? t("signed_in_final_cta_title")
      : variant === "pending_explore"
        ? t("pending_account_note")
        : t("cta_section_title");
  const body =
    variant === "create_brief"
      ? t("signed_in_final_cta_body")
      : variant === "pending_explore"
        ? t("cta_section_body")
        : t("cta_section_body");
  const buttonLabel =
    variant === "create_brief"
      ? t("signed_in_final_cta_button")
      : variant === "pending_explore"
        ? t("signed_in_cta_secondary")
        : t("cta_section_button");
  const buttonHref =
    variant === "create_brief"
      ? "/briefs/new"
      : variant === "pending_explore"
        ? "/briefings"
        : "/login?mode=signup";

  return (
    <section className="py-20 sm:py-28">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <div className="relative isolate overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-600 via-emerald-700 to-brand-700 px-6 py-14 text-center text-white shadow-2xl sm:px-12">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10"
          >
            <div className="absolute -top-24 left-1/3 h-72 w-72 rounded-full bg-amber-300 opacity-25 blur-3xl" />
            <div className="absolute -bottom-24 right-0 h-72 w-72 rounded-full bg-emerald-300 opacity-30 blur-3xl" />
          </div>

          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium text-white/90 backdrop-blur">
            <Sparkles className="h-3.5 w-3.5" />
            {variant === "create_brief" ? t("signed_in_badge") : t("badge")}
          </span>

          <h2 className="mt-6 text-balance text-3xl font-bold tracking-tight sm:text-4xl">
            {title}
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-pretty text-sm leading-relaxed text-white/85 sm:text-base">
            {body}
          </p>

          <Link
            href={buttonHref}
            className="mt-8 inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 text-sm font-semibold text-emerald-800 shadow-lg transition hover:bg-emerald-50"
          >
            {buttonLabel}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}

/**
 * "What do you get from signing in?" section — placed near the bottom
 * of the landing page so first-time visitors who scrolled this far get
 * a clear answer to "should I sign up?".
 *
 * Communicates three things:
 *   1. The concrete benefits of a personalized account (vs. the public
 *      briefings everyone gets at /briefings).
 *   2. The registration process (profiling → team review → approval).
 *   3. The current pause on new approvals — with a direct nudge to
 *      /briefings as the right starting point right now.
 *
 * Hidden for already-approved users (the section is sales/onboarding
 * copy, not relevant once they're in).
 */
function SignupJourney({ t }: { t: LandingT }) {
  const benefits = [
    {
      icon: UserCircle2,
      title: t("signup_benefit_personalized_title"),
      body: t("signup_benefit_personalized_body"),
    },
    {
      icon: BookOpenCheck,
      title: t("signup_benefit_saved_title"),
      body: t("signup_benefit_saved_body"),
    },
    {
      icon: ShieldCheck,
      title: t("signup_benefit_reviewed_title"),
      body: t("signup_benefit_reviewed_body"),
    },
  ];

  const steps = [
    {
      icon: UserCircle2,
      title: t("signup_step_1_title"),
      body: t("signup_step_1_body"),
    },
    {
      icon: ListChecks,
      title: t("signup_step_2_title"),
      body: t("signup_step_2_body"),
    },
    {
      icon: ShieldCheck,
      title: t("signup_step_3_title"),
      body: t("signup_step_3_body"),
    },
    {
      icon: Sparkles,
      title: t("signup_step_4_title"),
      body: t("signup_step_4_body"),
    },
  ];

  return (
    <section
      id="signup-journey"
      className="border-t border-slate-100 bg-gradient-to-b from-white to-slate-50/60 py-20 sm:py-28"
    >
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        {/* Pause notice — placed FIRST so visitors aren't surprised
             after reading through the benefits + process. */}
        <div className="mb-12 rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-5 shadow-sm sm:p-6">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
              <AlertCircle className="h-5 w-5" />
            </span>
            <div className="flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">
                {t("signup_pause_eyebrow")}
              </p>
              <h3 className="mt-1 text-balance text-base font-bold text-amber-950 sm:text-lg">
                {t("signup_pause_title")}
              </h3>
              <p className="mt-1 text-pretty text-sm leading-relaxed text-amber-900">
                {t("signup_pause_body")}
              </p>
              <Link
                href="/briefings"
                className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-amber-700 px-4 py-2 text-xs font-semibold text-white transition hover:bg-amber-800"
              >
                <Eye className="h-3.5 w-3.5" />
                {t("signup_pause_cta")}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </div>

        {/* Header */}
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700">
            <UserCircle2 className="h-3.5 w-3.5" />
            {t("signup_section_eyebrow")}
          </span>
          <h2 className="mt-4 text-balance text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            {t("signup_section_title")}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-pretty text-sm leading-relaxed text-slate-600 sm:text-base">
            {t("signup_section_subtitle")}
          </p>
        </div>

        {/* Benefits — 3 cards */}
        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {benefits.map(({ icon: Icon, title, body }) => (
            <article
              key={title}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                <Icon className="h-5 w-5" />
              </span>
              <h3 className="mt-3 text-base font-bold text-slate-900">
                {title}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                {body}
              </p>
            </article>
          ))}
        </div>

        {/* Registration process — 4 steps in a single panel */}
        <div className="mt-12">
          <h3 className="text-center text-balance text-xl font-bold text-slate-900 sm:text-2xl">
            {t("signup_process_title")}
          </h3>
          <p className="mx-auto mt-2 max-w-2xl text-center text-pretty text-sm leading-relaxed text-slate-600">
            {t("signup_process_subtitle")}
          </p>

          <ol className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map(({ icon: Icon, title, body }, i) => (
              <li
                key={title}
                className="relative rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <span className="absolute -top-3 left-5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
                  {i + 1}
                </span>
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                  <Icon className="h-4 w-4" />
                </span>
                <p className="mt-3 text-sm font-bold text-slate-900">{title}</p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-slate-600">
                  {body}
                </p>
              </li>
            ))}
          </ol>
        </div>

        {/* Cost transparency callout — placed AFTER the benefits + process
             so the reader sees the "what you'd get" first, then the honest
             trade-off about future cost. Sky/blue palette (informational,
             not urgent) — distinct from the amber pause notice at the top. */}
        <div className="mt-12 rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50/80 to-white p-5 shadow-sm sm:p-6">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-700">
              <Coins className="h-5 w-5" />
            </span>
            <div className="flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-sky-700">
                {t("signup_cost_eyebrow")}
              </p>
              <h3 className="mt-1 text-balance text-base font-bold text-sky-950 sm:text-lg">
                {t("signup_cost_title")}
              </h3>
              <p className="mt-2 text-pretty text-sm leading-relaxed text-sky-900">
                {t("signup_cost_body")}
              </p>
              <p className="mt-2 text-pretty text-sm leading-relaxed text-sky-900">
                {t("signup_cost_apology")}
              </p>
              <Link
                href="/contact"
                className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-sky-300 bg-white px-4 py-2 text-xs font-semibold text-sky-800 transition hover:border-sky-500 hover:bg-sky-50"
              >
                <Mail className="h-3.5 w-3.5" />
                {t("signup_cost_contact_cta")}
              </Link>
            </div>
          </div>
        </div>

        {/* Closing pointer back to Insights — reinforces the pause note */}
        <div className="mt-12 text-center">
          <p className="text-sm text-slate-600">
            {t("signup_closing_pointer")}
          </p>
          <Link
            href="/briefings"
            className="mt-3 inline-flex h-11 items-center gap-2 rounded-full bg-emerald-700 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800"
          >
            <Eye className="h-4 w-4" />
            {t("signup_closing_cta")}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
