import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  BookOpenCheck,
  Brain,
  Building2,
  CheckCircle2,
  Clock,
  Compass,
  Globe2,
  Heart,
  Newspaper,
  QrCode,
  Quote,
  Radar,
  Radio,
  Sparkles,
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
          sql`dawah_relevance IS NOT NULL`,
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
  const viewer: Viewer = session?.user
    ? {
        signedIn: true,
        approved: session.user.status === "approved",
        name:
          formatPanggilan(viewerProfile, session.user.name) ||
          session.user.email?.split("@")[0] ||
          "",
      }
    : { signedIn: false, approved: false, name: "" };

  return (
    <>
      <Hero t={tLanding} viewer={viewer} />
      <Features t={tLanding} />
      <WhyNotJustLlm t={tLanding} />
      <HowItWorks t={tLanding} coverage={coverage} />
      <Daleel t={tDaleel} />
      <Donate t={tDonate} />
      <FinalCTA t={tLanding} viewer={viewer} />
    </>
  );
}

type Viewer = {
  signedIn: boolean;
  approved: boolean;
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
            <SignedInCtas t={t} approved={viewer.approved} />
          ) : (
            <AnonymousCtas t={t} />
          )}
        </div>

        <div
          className="mx-auto mt-16 max-w-5xl animate-fade-up"
          style={{ animationDelay: "0.2s" }}
        >
          <HeroSlideshow />
        </div>
      </div>
    </section>
  );
}

function AnonymousCtas({ t }: { t: LandingT }) {
  return (
    <div className="mt-8 flex flex-col flex-wrap items-center justify-center gap-3 sm:flex-row">
      <Link
        href={{ pathname: "/login", query: { mode: "signup" } }}
        className="group inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-slate-900 px-6 text-sm font-semibold text-white shadow-lg shadow-slate-900/15 transition hover:bg-slate-800 sm:w-auto"
      >
        {t("cta_primary")}
        <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
      </Link>
      <Link
        href="#how-it-works"
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-6 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 sm:w-auto"
      >
        <Workflow className="h-4 w-4" />
        {t("cta_secondary")}
      </Link>
      <Link
        href="/insights"
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-emerald-200 bg-emerald-50/80 px-6 text-sm font-semibold text-emerald-700 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-100 sm:w-auto"
      >
        <Globe2 className="h-4 w-4" />
        <I18nText text={t("cta_tertiary")} />
      </Link>
    </div>
  );
}

function SignedInCtas({ t, approved }: { t: LandingT; approved: boolean }) {
  return (
    <>
      <div className="mt-8 flex flex-col flex-wrap items-center justify-center gap-3 sm:flex-row">
        {approved ? (
          <Link
            href="/briefs/new"
            className="group inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-slate-900 px-6 text-sm font-semibold text-white shadow-lg shadow-slate-900/15 transition hover:bg-slate-800 sm:w-auto"
          >
            <Sparkles className="h-4 w-4" />
            {t("signed_in_cta_primary")}
            <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
          </Link>
        ) : (
          <span className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-6 text-sm font-semibold text-amber-800 sm:w-auto">
            <Clock className="h-4 w-4" />
            {t("pending_account_note")}
          </span>
        )}
        <Link
          href="/insights"
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

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map(({ icon: Icon, title, body, tone }) => (
            <div
              key={title}
              className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
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
      </div>
    </section>
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

        <ol className="mt-14 grid gap-6 sm:grid-cols-3">
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
  // Approved signed-in user → invite them to generate a brief.
  // Pending user → encourage them to explore public insights while waiting.
  // Anonymous → original "Apply for Full Access" pitch.
  const variant =
    viewer.signedIn && viewer.approved
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
        ? "/insights"
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
