import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  ArrowRight,
  BookOpenCheck,
  Code2,
  Database,
  ExternalLink,
  GitBranch,
  Layers,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";

import { Link } from "@/i18n/navigation";

const GITHUB_URL = "https://github.com/taufik-adinugraha/dakwah-lens";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/how-it-works">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "HowItWorks" });
  return { title: t("page_title") };
}

export default async function HowItWorksPage({
  params,
}: PageProps<"/[locale]/how-it-works">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("HowItWorks");

  return (
    <>
      <Hero t={t} />
      <TLDR t={t} />
      <StackGrid t={t} />
      <SystemDiagram t={t} />
      <IngestionPipeline t={t} />
      <DiscoveryStrategy t={t} />
      <InsightsBriefingPipeline t={t} />
      <BriefPipeline t={t} />
      <ModelsTable t={t} />
      <MonthlyCost t={t} />
      <KitabCorpus t={t} />
      <Observability t={t} />
      <Tradeoffs t={t} />
      <Repo t={t} />
    </>
  );
}

type T = Awaited<ReturnType<typeof getTranslations<"HowItWorks">>>;

function Hero({ t }: { t: T }) {
  return (
    <section className="relative isolate overflow-hidden pt-12 pb-10 sm:pt-16 sm:pb-14">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      >
        <div className="absolute inset-0 grid-bg opacity-40" />
        <div className="absolute -top-24 left-1/2 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-brand-200 opacity-40 blur-3xl" />
      </div>

      <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50/80 px-3 py-1 text-xs font-medium text-brand-700 shadow-sm backdrop-blur">
          <Code2 className="h-3.5 w-3.5" />
          {t("badge")}
        </span>
        <h1 className="mt-4 text-balance text-3xl font-bold leading-[1.1] tracking-tight text-slate-900 sm:text-5xl">
          {t("hero_title")}
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-pretty text-base leading-relaxed text-slate-600 sm:text-lg">
          {t("hero_subtitle")}
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 items-center gap-2 rounded-full bg-slate-900 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
          >
            <GithubIcon className="h-4 w-4" />
            {t("hero_cta_github")}
            <ExternalLink className="h-3.5 w-3.5 opacity-70" />
          </a>
          <Link
            href="/"
            className="inline-flex h-11 items-center gap-2 rounded-full border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            {t("hero_cta_back")}
          </Link>
        </div>
      </div>
    </section>
  );
}

function TLDR({ t }: { t: T }) {
  return (
    <section className="py-8 sm:py-12">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-6 shadow-sm sm:p-8">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
            {t("tldr_label")}
          </p>

          {/* Two facet cards: architecture + AI stack. Equal weight,
           * stacked on mobile, side-by-side on tablet+. */}
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <TldrFacet
              icon={Layers}
              label={t("tldr_arch_label")}
              body={t("tldr_arch_body")}
              tone="brand"
            />
            <TldrFacet
              icon={Sparkles}
              label={t("tldr_ai_label")}
              body={t("tldr_ai_body")}
              tone="violet"
            />
          </div>

          {/* The credibility-anchor callout — visually distinct from the
           * facets above so the reader's eye locks on the daleel-retrieval
           * guarantee. Matches the emerald/ShieldCheck idiom used on the
           * /kitab and onboarding "we don't hallucinate" surfaces. */}
          <div className="mt-4 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                {t("tldr_trust_label")}
              </p>
              <p className="mt-1 text-pretty text-sm leading-relaxed text-emerald-900">
                {t("tldr_trust_body")}
              </p>
            </div>
          </div>

          <p className="mt-4 text-center text-xs text-slate-500">
            {t("tldr_license")}
          </p>
        </div>
      </div>
    </section>
  );
}

function TldrFacet({
  icon: Icon,
  label,
  body,
  tone,
}: {
  icon: typeof Layers;
  label: string;
  body: string;
  tone: "brand" | "violet";
}) {
  const tones: Record<typeof tone, { border: string; bg: string; text: string }> = {
    brand: {
      border: "border-brand-200",
      bg: "bg-brand-50/60",
      text: "text-brand-700",
    },
    violet: {
      border: "border-violet-200",
      bg: "bg-violet-50/60",
      text: "text-violet-700",
    },
  };
  const s = tones[tone];
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div
        className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${s.border} ${s.bg} ${s.text}`}
      >
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <p className="mt-2 text-pretty text-sm leading-relaxed text-slate-700">
        {body}
      </p>
    </div>
  );
}

function StackGrid({ t }: { t: T }) {
  const groups = [
    {
      id: "frontend",
      icon: Layers,
      tone: "brand" as const,
      title: t("stack_frontend_title"),
      items: [
        { name: "Next.js 16", role: t("stack_frontend_nextjs") },
        { name: "React 19", role: t("stack_frontend_react") },
        { name: "Tailwind v4", role: t("stack_frontend_tailwind") },
        { name: "next-intl v4", role: t("stack_frontend_intl") },
        { name: "Auth.js v5", role: t("stack_frontend_auth") },
        { name: "Drizzle ORM", role: t("stack_frontend_drizzle") },
        { name: "lucide-react", role: t("stack_frontend_lucide") },
      ],
    },
    {
      id: "backend",
      icon: Workflow,
      tone: "emerald" as const,
      title: t("stack_backend_title"),
      items: [
        { name: "FastAPI", role: t("stack_backend_fastapi") },
        { name: "SQLAlchemy 2.0", role: t("stack_backend_sqla") },
        { name: "Alembic", role: t("stack_backend_alembic") },
        { name: "Celery + Redis", role: t("stack_backend_celery") },
        { name: "uv (Astral)", role: t("stack_backend_uv") },
        { name: "Pydantic v2", role: t("stack_backend_pydantic") },
        { name: "structlog", role: t("stack_backend_structlog") },
      ],
    },
    {
      id: "data",
      icon: Database,
      tone: "amber" as const,
      title: t("stack_data_title"),
      items: [
        { name: "PostgreSQL 16", role: t("stack_data_pg") },
        { name: "Qdrant", role: t("stack_data_qdrant") },
        { name: "Redis", role: t("stack_data_redis") },
      ],
    },
    {
      id: "ai",
      icon: Sparkles,
      tone: "violet" as const,
      title: t("stack_ai_title"),
      items: [
        { name: "OpenAI Embeddings", role: t("stack_ai_openai") },
        { name: "Gemini 2.5 Pro / Flash-Lite", role: t("stack_ai_gemini") },
        { name: "Anthropic Claude Sonnet 4.5", role: t("stack_ai_anthropic") },
        { name: "trafilatura", role: t("stack_ai_trafilatura") },
      ],
    },
    {
      id: "infra",
      icon: ShieldCheck,
      tone: "slate" as const,
      title: t("stack_infra_title"),
      items: [
        { name: "Docker Compose", role: t("stack_infra_docker") },
        { name: "IDCloudHost VPS", role: t("stack_infra_vps") },
        { name: "Resend", role: t("stack_infra_resend") },
        { name: "Apify", role: t("stack_infra_apify") },
        { name: "YouTube Data API v3", role: t("stack_infra_youtube") },
      ],
    },
  ];

  return (
    <section className="py-10 sm:py-14">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeader title={t("stack_title")} subtitle={t("stack_subtitle")} />
        <div className="mt-8 grid gap-4 lg:grid-cols-2">
          {groups.map((g) => (
            <StackCard key={g.id} {...g} />
          ))}
        </div>
      </div>
    </section>
  );
}

function StackCard({
  icon: Icon,
  tone,
  title,
  items,
}: {
  icon: typeof Layers;
  tone: "brand" | "emerald" | "amber" | "violet" | "slate";
  title: string;
  items: Array<{ name: string; role: string }>;
}) {
  const styles = TONE_STYLES[tone];
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-3">
        <span
          className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${styles.bg}`}
        >
          <Icon className={`h-4 w-4 ${styles.icon}`} />
        </span>
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-700">
          {title}
        </h3>
      </div>
      {/* Grid (not flex) so wrapped names — e.g. "Anthropic Claude Sonnet
       * 4.5" — keep the role column starting at the top of the row instead
       * of jumping to the first-line baseline. Column widths are explicit
       * so role text in every row starts at the same x-offset. */}
      <ul className="mt-4 space-y-2 text-sm">
        {items.map((it) => (
          <li
            key={it.name}
            className="grid gap-x-3 gap-y-0.5 sm:grid-cols-[12rem_1fr]"
          >
            <span className="font-mono text-xs font-semibold leading-snug text-slate-900">
              {it.name}
            </span>
            <span className="leading-snug text-slate-600">{it.role}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

const TONE_STYLES = {
  brand: { bg: "bg-brand-50", icon: "text-brand-700" },
  emerald: { bg: "bg-emerald-50", icon: "text-emerald-700" },
  amber: { bg: "bg-amber-50", icon: "text-amber-700" },
  violet: { bg: "bg-violet-50", icon: "text-violet-700" },
  slate: { bg: "bg-slate-100", icon: "text-slate-700" },
} as const;

/**
 * System-level diagram — three tiers (client / app / data) connected by
 * thin slate arrows. Built as nested grids + flexbox so it stays sharp at
 * any screen width (no SVG hand-positioning).
 */
function SystemDiagram({ t }: { t: T }) {
  return (
    <section className="border-y border-slate-100 bg-slate-50/40 py-12 sm:py-16">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <SectionHeader
          title={t("system_title")}
          subtitle={t("system_subtitle")}
        />

        <div className="mt-10 space-y-4">
          {/* Tier 1: clients */}
          <DiagramTier label={t("system_tier_client")}>
            <DiagramBox tone="brand" title={t("system_browser")} sub="Next.js SSR + RSC" />
            <DiagramBox tone="brand" title={t("system_celery_workers")} sub="Celery beat + worker" />
            <DiagramBox tone="brand" title={t("system_cli")} sub="uv run python -m api.scripts.*" />
          </DiagramTier>

          <Arrow />

          {/* Tier 2: app */}
          <DiagramTier label={t("system_tier_app")}>
            <DiagramBox tone="emerald" title="Next.js Server Actions" sub={t("system_next_actions")} />
            <DiagramBox tone="emerald" title="FastAPI" sub={t("system_fastapi")} />
          </DiagramTier>

          <Arrow />

          {/* Tier 3: data */}
          <DiagramTier label={t("system_tier_data")}>
            <DiagramBox tone="amber" title="PostgreSQL" sub={t("system_pg_role")} />
            <DiagramBox tone="amber" title="Qdrant" sub={t("system_qdrant_role")} />
            <DiagramBox tone="amber" title="Redis" sub={t("system_redis_role")} />
          </DiagramTier>

          <Arrow />

          {/* Tier 4: third-party */}
          <DiagramTier label={t("system_tier_external")}>
            <DiagramBox tone="violet" title="LLM providers" sub="OpenAI · Gemini · Anthropic" />
            <DiagramBox tone="violet" title={t("system_scrapers")} sub="Apify · YouTube API · RSS" />
            <DiagramBox tone="violet" title="Resend" sub={t("system_resend_role")} />
          </DiagramTier>
        </div>
      </div>
    </section>
  );
}

function DiagramTier({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-4">
      <span className="hidden w-32 shrink-0 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500 sm:block">
        {label}
      </span>
      <div className="grid w-full gap-3 sm:grid-cols-3">{children}</div>
    </div>
  );
}

function DiagramBox({
  tone,
  title,
  sub,
}: {
  tone: "brand" | "emerald" | "amber" | "violet";
  title: string;
  sub: string;
}) {
  const styles = TONE_STYLES[tone];
  return (
    <div
      className={`rounded-xl border ${styles.bg} ${tone === "brand" ? "border-brand-200" : tone === "emerald" ? "border-emerald-200" : tone === "amber" ? "border-amber-200" : "border-violet-200"} px-3 py-3 text-center shadow-sm`}
    >
      <p className={`text-sm font-bold ${styles.icon}`}>{title}</p>
      <p className="mt-0.5 text-xs font-mono text-slate-600">{sub}</p>
    </div>
  );
}

function Arrow() {
  return (
    <div className="flex items-center justify-center" aria-hidden>
      <div className="h-5 w-px bg-slate-300" />
    </div>
  );
}

function SectionHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <h2 className="text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
        {title}
      </h2>
      <p className="mt-2 text-pretty text-sm leading-relaxed text-slate-600 sm:text-base">
        {subtitle}
      </p>
    </div>
  );
}

/**
 * Ingestion pipeline — horizontal flow of 5 stages. Each stage has the
 * specific code module noted in monospace so a reader can immediately go
 * read it.
 */
function IngestionPipeline({ t }: { t: T }) {
  const stages = [
    {
      title: t("ingest_stage_1_title"),
      module: "services/{apify,rss,youtube}.py",
      body: t("ingest_stage_1_body"),
    },
    {
      title: t("ingest_stage_2_title"),
      module: "services/normalizers.py",
      body: t("ingest_stage_2_body"),
    },
    {
      title: t("ingest_stage_3_title"),
      module: "services/sentiment.py · relevance.py",
      body: t("ingest_stage_3_body"),
    },
    {
      title: t("ingest_stage_4_title"),
      module: "scripts/ingest.py → social_posts",
      body: t("ingest_stage_4_body"),
    },
    {
      title: t("ingest_stage_5_title"),
      module: "scripts/cluster_topics.py → topics",
      body: t("ingest_stage_5_body"),
    },
  ];

  return (
    <section className="py-12 sm:py-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeader
          title={t("ingest_title")}
          subtitle={t("ingest_subtitle")}
        />
        <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {stages.map((s, i) => (
            <li
              key={i}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
                {i + 1}
              </span>
              <p className="mt-3 text-sm font-bold text-slate-900">
                {s.title}
              </p>
              <p className="mt-1 font-mono text-[10px] text-brand-700">
                {s.module}
              </p>
              <p className="mt-3 text-xs leading-relaxed text-slate-600">
                {s.body}
              </p>
            </li>
          ))}
        </ol>

        <p className="mx-auto mt-6 max-w-3xl text-pretty text-center text-xs text-slate-500">
          {t("ingest_schedule_note")}
        </p>
      </div>
    </section>
  );
}

/* Discovery strategy: how keywords are picked. Sits between the
 * IngestionPipeline (which assumes you have a query) and BriefPipeline.
 * Two-card layout because there are exactly two complementary layers —
 * curated rotation and the daily trending overlay. */
function DiscoveryStrategy({ t }: { t: T }) {
  return (
    <section className="py-12 sm:py-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeader
          title={t("discovery_title")}
          subtitle={t("discovery_subtitle")}
        />
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2">
              <GitBranch className="h-5 w-5 text-brand-600" />
              <h3 className="text-base font-bold text-slate-900">
                {t("discovery_curated_title")}
              </h3>
            </div>
            <p className="mt-1 font-mono text-[10px] text-brand-700">
              {t("discovery_curated_module")}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-slate-700">
              {t("discovery_curated_body")}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-amber-500" />
              <h3 className="text-base font-bold text-slate-900">
                {t("discovery_trending_title")}
              </h3>
            </div>
            <p className="mt-1 font-mono text-[10px] text-brand-700">
              {t("discovery_trending_module")}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-slate-700">
              {t("discovery_trending_body")}
            </p>
          </div>
        </div>
        <p className="mx-auto mt-6 max-w-3xl text-pretty text-center text-xs text-slate-500">
          {t("discovery_why_note")}
        </p>
      </div>
    </section>
  );
}

function BriefPipeline({ t }: { t: T }) {
  const stages = [
    {
      title: t("brief_stage_1_title"),
      module: "app/[locale]/briefs/new",
      body: t("brief_stage_1_body"),
    },
    {
      title: t("brief_stage_2_title"),
      module: "lib/kitab-retrieval.ts",
      body: t("brief_stage_2_body"),
    },
    {
      title: t("brief_stage_3_title"),
      module: "Qdrant: all kitab collections",
      body: t("brief_stage_3_body"),
    },
    {
      title: t("brief_stage_4_title"),
      module: "lib/llm.ts → generateJson()",
      body: t("brief_stage_4_body"),
    },
    {
      title: t("brief_stage_5_title"),
      module: "Zod validation → briefs table",
      body: t("brief_stage_5_body"),
    },
  ];

  return (
    <section className="border-y border-slate-100 bg-emerald-50/30 py-12 sm:py-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeader
          title={t("brief_title")}
          subtitle={t("brief_subtitle")}
        />
        <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {stages.map((s, i) => (
            <li
              key={i}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-700 text-xs font-bold text-white">
                {i + 1}
              </span>
              <p className="mt-3 text-sm font-bold text-slate-900">
                {s.title}
              </p>
              <p className="mt-1 font-mono text-[10px] text-emerald-700">
                {s.module}
              </p>
              <p className="mt-3 text-xs leading-relaxed text-slate-600">
                {s.body}
              </p>
            </li>
          ))}
        </ol>
        <div className="mx-auto mt-6 max-w-3xl rounded-xl border border-amber-200 bg-amber-50/60 p-4 text-center text-xs text-amber-900">
          <strong>{t("brief_callout_strong")}</strong>{" "}
          {t("brief_callout_body")}
        </div>
      </div>
    </section>
  );
}

/**
 * Weekly insights briefings pipeline.
 *
 * Different from BriefPipeline (which describes the on-demand user-created
 * brief flow). Insights briefings are public, long-form analyst reports
 * that combine 5 markdown sections + 6 ready-to-use deliverables in
 * Section 4 + 2 share-ready flyers per briefing. See
 * insights_summary.py for the pipeline, scripts/manual_briefing.py for
 * the current manual operator flow, and /insights/brief/[id] for the
 * public viewer.
 *
 * The cron is wired for Thursday 05:00 WIB but currently PAUSED
 * (2026-05-23) — operator runs manually via Claude-in-the-loop to keep
 * Gemini Pro spend at zero during the dev phase.
 */
function InsightsBriefingPipeline({ t }: { t: T }) {
  const stages = [
    {
      title: t("insights_brief_stage_1_title"),
      module: "workers/celery_app.py + scripts/manual_briefing.py",
      body: t("insights_brief_stage_1_body"),
    },
    {
      title: t("insights_brief_stage_2_title"),
      module: "services/insights_summary.py::_compute_stats",
      body: t("insights_brief_stage_2_body"),
    },
    {
      title: t("insights_brief_stage_3_title"),
      module: "services/kitab_retrieval.py + rerank_daleel (top_n=10)",
      body: t("insights_brief_stage_3_body"),
    },
    {
      title: t("insights_brief_stage_4_title"),
      module: "Gemini 2.5 Pro (paused) → Claude manual",
      body: t("insights_brief_stage_4_body"),
    },
    {
      title: t("insights_brief_stage_5_title"),
      module: "insights_summaries → /insights/brief/[id] + Puppeteer flyers",
      body: t("insights_brief_stage_5_body"),
    },
  ];

  return (
    <section className="border-y border-slate-100 bg-brand-50/30 py-12 sm:py-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeader
          title={t("insights_brief_title")}
          subtitle={t("insights_brief_subtitle")}
        />
        <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {stages.map((s, i) => (
            <li
              key={i}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand-700 text-xs font-bold text-white">
                {i + 1}
              </span>
              <p className="mt-3 text-sm font-bold text-slate-900">
                {s.title}
              </p>
              <p className="mt-1 font-mono text-[10px] text-brand-700">
                {s.module}
              </p>
              <p className="mt-3 text-xs leading-relaxed text-slate-600">
                {s.body}
              </p>
            </li>
          ))}
        </ol>

        <BriefingAnatomy t={t} />

        <div className="mx-auto mt-6 max-w-3xl rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 text-center text-xs text-emerald-900">
          <strong>{t("insights_brief_callout_strong")}</strong>{" "}
          {t("insights_brief_callout_body")}
        </div>
      </div>
    </section>
  );
}

/**
 * "What's inside one briefing" — visual breakdown of the 5 markdown
 * sections (with Section 4 expanded into its 6 ready-to-use deliverables)
 * plus the 2 share-ready flyers Puppeteer renders alongside.
 *
 * Placed under the 5-stage pipeline so readers see HOW the system runs
 * AND then what they actually receive — closes the loop between the
 * tech explanation and the user-visible output.
 */
function BriefingAnatomy({ t }: { t: T }) {
  const sections = [
    {
      n: "1",
      title: t("anatomy_s1_title"),
      body: t("anatomy_s1_body"),
      words: "100-130",
    },
    {
      n: "2",
      title: t("anatomy_s2_title"),
      body: t("anatomy_s2_body"),
      words: "250-350",
    },
    {
      n: "3",
      title: t("anatomy_s3_title"),
      body: t("anatomy_s3_body"),
      words: "350-450",
    },
    {
      n: "5",
      title: t("anatomy_s5_title"),
      body: t("anatomy_s5_body"),
      words: "500-700",
    },
  ];

  const deliverables = [
    {
      key: "khutbah",
      title: t("anatomy_kit_khutbah_title"),
      body: t("anatomy_kit_khutbah_body"),
      words: "2,300-3,200",
    },
    {
      key: "kajian",
      title: t("anatomy_kit_kajian_title"),
      body: t("anatomy_kit_kajian_body"),
      words: "800-1,100",
    },
    {
      key: "home",
      title: t("anatomy_kit_home_title"),
      body: t("anatomy_kit_home_body"),
      words: "500-700",
    },
    {
      key: "content",
      title: t("anatomy_kit_content_title"),
      body: t("anatomy_kit_content_body"),
      words: "100-130",
    },
    {
      key: "genz",
      title: t("anatomy_kit_genz_title"),
      body: t("anatomy_kit_genz_body"),
      words: "800-1,100",
    },
    {
      key: "action",
      title: t("anatomy_kit_action_title"),
      body: t("anatomy_kit_action_body"),
      words: "600-900",
    },
  ];

  return (
    <div className="mt-12 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
      <h3 className="text-balance text-lg font-bold tracking-tight text-slate-900 sm:text-xl">
        {t("anatomy_title")}
      </h3>
      <p className="mt-1.5 max-w-2xl text-pretty text-sm leading-relaxed text-slate-600">
        {t("anatomy_subtitle")}
      </p>

      {/* Top row: 5-section structure (Section 4 expanded below) */}
      <div className="mt-6">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          {t("anatomy_sections_label")}
        </p>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {sections.map((s) => (
            <li
              key={s.n}
              className="rounded-xl border border-slate-200 bg-slate-50/60 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[10px] font-bold text-white">
                  {s.n}
                </span>
                <span className="text-[10px] font-mono text-slate-400 tabular-nums">
                  ~{s.words} kata
                </span>
              </div>
              <p className="mt-2 text-[13px] font-bold text-slate-900">
                {s.title}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                {s.body}
              </p>
            </li>
          ))}
        </ul>
      </div>

      {/* Section 4 deep-dive: 6 ready-to-use deliverables */}
      <div className="mt-7 rounded-xl border-2 border-emerald-200 bg-gradient-to-br from-emerald-50/50 to-white p-4">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
              {t("anatomy_section4_eyebrow")}
            </p>
            <p className="mt-1 text-balance text-sm font-bold text-slate-900 sm:text-base">
              {t("anatomy_section4_title")}
            </p>
          </div>
          <span className="text-[10px] font-mono text-emerald-700 tabular-nums">
            5,400-7,800 kata
          </span>
        </div>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {deliverables.map((d) => (
            <li
              key={d.key}
              className="rounded-xl border border-slate-200 bg-white p-3"
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-[13px] font-bold text-slate-900">
                  {d.title}
                </p>
                <span className="text-[10px] font-mono text-slate-400 tabular-nums">
                  ~{d.words}
                </span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                {d.body}
              </p>
            </li>
          ))}
        </ul>
      </div>

      {/* Flyer companions row */}
      <div className="mt-7 rounded-xl border-2 border-fuchsia-200 bg-gradient-to-br from-fuchsia-50/40 to-white p-4">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-fuchsia-700">
          {t("anatomy_flyer_eyebrow")}
        </p>
        <p className="mt-1 text-balance text-sm font-bold text-slate-900 sm:text-base">
          {t("anatomy_flyer_title")}
        </p>
        <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-slate-600">
          {t("anatomy_flyer_body")}
        </p>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          <li className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[13px] font-bold text-slate-900">
              {t("anatomy_flyer_general_title")}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              {t("anatomy_flyer_general_body")}
            </p>
          </li>
          <li className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[13px] font-bold text-slate-900">
              {t("anatomy_flyer_genz_title")}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              {t("anatomy_flyer_genz_body")}
            </p>
          </li>
        </ul>
        <p className="mt-3 text-xs text-slate-500">
          {t("anatomy_flyer_footnote")}
        </p>
      </div>
    </div>
  );
}

function ModelsTable({ t }: { t: T }) {
  const rows = [
    {
      name: "Gemini 2.5 Flash-Lite",
      id: "gemini-2.5-flash-lite",
      role: t("models_flash_role"),
      why: t("models_flash_why"),
      where: t("models_flash_where"),
    },
    {
      name: "Gemini 2.5 Pro",
      id: "gemini-2.5-pro",
      role: t("models_pro_role"),
      why: t("models_pro_why"),
      where: t("models_pro_where"),
    },
    {
      name: "Claude Sonnet 4.5",
      id: "claude-sonnet-4-5",
      role: t("models_claude_role"),
      why: t("models_claude_why"),
      where: t("models_claude_where"),
    },
    {
      name: "OpenAI text-embedding-3-large",
      id: "text-embedding-3-large",
      role: t("models_embedding_role"),
      why: t("models_embedding_why"),
      where: t("models_embedding_where"),
    },
  ];

  return (
    <section className="py-12 sm:py-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeader
          title={t("models_title")}
          subtitle={t("models_subtitle")}
        />
        <div className="mt-8 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3">{t("models_th_model")}</th>
                <th className="px-4 py-3">{t("models_th_role")}</th>
                <th className="px-4 py-3">{t("models_th_why")}</th>
                <th className="px-4 py-3">{t("models_th_where")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-3 align-top">
                    <p className="font-bold text-slate-900">{r.name}</p>
                    <p className="mt-0.5 font-mono text-[10px] text-slate-500">
                      {r.id}
                    </p>
                  </td>
                  <td className="px-4 py-3 align-top text-slate-700">
                    {r.role}
                  </td>
                  <td className="px-4 py-3 align-top text-slate-600">
                    {r.why}
                  </td>
                  <td className="px-4 py-3 align-top text-slate-500">
                    {r.where}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/**
 * Estimated monthly API spend across all providers. Hard-coded snapshot
 * — the real numbers live in `/admin/system/api-costs` (superadmin). The
 * point of this section is to be transparent about cost discipline.
 *
 * Numbers reflect the schedule as of 2026-05-27:
 *   mainstream RSS — every 2h, free
 *   X — weekly Wed 22:00 WIB · TikTok/IG — weekly Wed (eval phase)
 *   X trending overlay — daily 12:00 WIB
 *   YouTube — weekly whitelist channel sweep (Wed 21:00) + daily
 *     unbounded trending search (12:00); both free Data API quota
 *   topic discovery — daily 04:00 WIB (mainstream + YouTube)
 *   briefings — weekly Thursday 05:00 WIB cron (currently PAUSED — manual via scripts/manual_briefing.py)
 *
 * The YouTube split (2026-05-27) adds no cost line — both paths run on
 * the free 10K/day Data API quota (~800 units/day search + 160/wk
 * channels). Apify spend is unchanged.
 */
function MonthlyCost({ t }: { t: T }) {
  const rows = [
    {
      provider: "Gemini 2.5 Pro (briefings, scheduled — currently paused)",
      use: t("cost_gemini_pro_use"),
      // Paused per 2026-05-23 to keep dev-phase spend at zero. Projected
      // $5/mo if cron flips back on: 5 briefings × 4 Thursdays × ~$0.26.
      monthly: 0,
      note: "Paused; would be ~$5/mo if re-enabled (5 segmen × 1 bahasa × Kamis × ~$0.26)",
    },
    {
      provider: "Gemini Flash-Lite",
      use: t("cost_gemini_use"),
      monthly: 2.6,
      note: "$0.10/$0.40 per 1M tokens · klasifikasi + topik + rerank",
    },
    {
      provider: "OpenAI embeddings",
      use: t("cost_openai_use"),
      monthly: 0.1,
      note: "Embedding query daleel + one-shot corpus",
    },
    {
      provider: "YouTube Data API",
      use: t("cost_yt_use"),
      monthly: 0,
      note: t("cost_free_quota"),
    },
    {
      provider: "RSS (feedparser + trafilatura)",
      use: t("cost_rss_use"),
      monthly: 0,
      note: t("cost_free"),
    },
    {
      provider: "Anthropic Claude (fallback)",
      use: t("cost_claude_use"),
      monthly: 0,
      note: t("cost_on_demand"),
    },
    // ── Server / infrastructure (non-API) ──
    {
      provider: "VPS · IDCloudHost (Jakarta)",
      use: t("cost_vps_use"),
      monthly: 30,
      note: "≈ Rp 500K/bulan · server + DB + Redis + Qdrant",
    },
    // ── Apify scrapers ── X + trending re-activated 2026-05-25 after
    // IndoBERT retirement. TikTok + Instagram enabled 2026-05-25 for
    // one-week evaluation; reassess after first run.
    {
      provider: "Apify · X (apidojo)",
      use: t("cost_x_use"),
      monthly: 8,
      note: t("cost_active"),
    },
    {
      provider: "Apify · Instagram",
      use: t("cost_ig_use"),
      monthly: 9,
      note: t("cost_eval"),
    },
    {
      provider: "Apify · TikTok (free actor)",
      use: t("cost_tt_use"),
      monthly: 16,
      note: t("cost_eval"),
    },
    {
      provider: "Apify · Trending overlay (X)",
      use: t("cost_trending_use"),
      monthly: 1,
      note: t("cost_active"),
    },
  ];

  const total = rows.reduce((s, r) => s + r.monthly, 0);
  const totalIDR = total * 16300;
  // Total operating budget cap = ~IDR 2M / month (~$123). Covers
  // EVERYTHING — server + API + Apify scrapers when re-enabled. Earlier
  // value of $60 only covered the API portion; updated 2026-05-22 after
  // we added the VPS line item for full operating cost.
  const cap = 123;
  const capIDR = cap * 16300;
  const usedPct = Math.min(100, (total / cap) * 100);

  return (
    <section className="border-y border-slate-100 bg-gradient-to-b from-amber-50/30 to-white py-12 sm:py-16">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <SectionHeader
          title={t("cost_title")}
          subtitle={t("cost_subtitle")}
        />

        <div className="mt-8 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3">{t("cost_th_provider")}</th>
                <th className="px-4 py-3">{t("cost_th_use")}</th>
                <th className="px-4 py-3 text-right">{t("cost_th_monthly")}</th>
                <th className="px-4 py-3">{t("cost_th_note")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.provider} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-3 align-top">
                    <p className="font-semibold text-slate-900">{r.provider}</p>
                  </td>
                  <td className="px-4 py-3 align-top text-slate-700">{r.use}</td>
                  <td className="px-4 py-3 align-top text-right tabular-nums text-slate-900">
                    {r.monthly === 0
                      ? "—"
                      : `$${r.monthly.toFixed(2)}`}
                  </td>
                  <td className="px-4 py-3 align-top text-xs text-slate-500">
                    {r.note}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-200 bg-slate-50/60 font-semibold">
                <td className="px-4 py-3 text-slate-900" colSpan={2}>
                  {t("cost_total_row")}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-900">
                  ~${total.toFixed(2)}
                </td>
                <td className="px-4 py-3 text-xs text-slate-600">
                  ≈ Rp {Math.round(totalIDR / 1000).toLocaleString("id-ID")}K/bulan
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Budget cap bar */}
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50/60 p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <p className="font-semibold text-slate-900">
              {t("cost_budget_title")}
            </p>
            <p className="font-mono text-xs text-slate-700">
              ${total.toFixed(2)} / ${cap} · Rp {Math.round(capIDR / 1000).toLocaleString("id-ID")}K
            </p>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-amber-100">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-amber-500"
              style={{ width: `${usedPct}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-slate-600">
            {t("cost_budget_caveat")}
          </p>
        </div>
      </div>
    </section>
  );
}

function KitabCorpus({ t }: { t: T }) {
  return (
    <section className="border-y border-slate-100 bg-gradient-to-b from-emerald-50/30 to-white py-12 sm:py-16">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <SectionHeader
          title={t("kitab_title")}
          subtitle={t("kitab_subtitle")}
        />
        <ul className="mt-8 grid gap-3 sm:grid-cols-2">
          <KitabItem
            title="Al-Qur'an al-Karim"
            detail={t("kitab_quran")}
          />
          <KitabItem
            title="Sahih al-Bukhari"
            detail={t("kitab_bukhari")}
          />
          <KitabItem
            title="Sahih Muslim"
            detail={t("kitab_muslim")}
          />
          <KitabItem
            title="Riyad as-Salihin"
            detail={t("kitab_riyad")}
          />
          <KitabItem
            title="Tafsir Ibn Kathir"
            detail={t("kitab_tafsir")}
          />
        </ul>
        <p className="mx-auto mt-6 max-w-2xl text-pretty text-center text-xs leading-relaxed text-slate-600">
          {t("kitab_note")}
        </p>
      </div>
    </section>
  );
}

function KitabItem({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <li className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="flex items-baseline gap-2">
        <BookOpenCheck className="h-4 w-4 shrink-0 text-emerald-700" />
        <span className="text-sm font-bold text-slate-900">{title}</span>
      </p>
      <p className="mt-2 text-xs leading-relaxed text-slate-600">{detail}</p>
    </li>
  );
}

function Observability({ t }: { t: T }) {
  const tables = [
    { name: "social_posts", role: t("obs_social_posts") },
    { name: "topics", role: t("obs_topics") },
    { name: "briefs", role: t("obs_briefs") },
    { name: "usage_events", role: t("obs_usage_events") },
    { name: "system_metrics", role: t("obs_system_metrics") },
    { name: "ingest_runs", role: t("obs_ingest_runs") },
    { name: "page_views", role: t("obs_page_views") },
    { name: "donations · manual_costs", role: t("obs_costs") },
    { name: "contact_messages", role: t("obs_contact") },
    { name: "users · accounts · verification_tokens", role: t("obs_auth") },
  ];

  return (
    <section className="py-12 sm:py-16">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <SectionHeader title={t("obs_title")} subtitle={t("obs_subtitle")} />
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {tables.map((tbl) => (
            <div
              key={tbl.name}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <p className="font-mono text-xs font-bold text-brand-700">
                {tbl.name}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                {tbl.role}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Tradeoffs({ t }: { t: T }) {
  const items = [
    { q: t("tradeoff_1_q"), a: t("tradeoff_1_a") },
    { q: t("tradeoff_2_q"), a: t("tradeoff_2_a") },
    { q: t("tradeoff_3_q"), a: t("tradeoff_3_a") },
    { q: t("tradeoff_4_q"), a: t("tradeoff_4_a") },
    { q: t("tradeoff_5_q"), a: t("tradeoff_5_a") },
    { q: t("tradeoff_6_q"), a: t("tradeoff_6_a") },
  ];
  return (
    <section className="border-t border-slate-100 bg-slate-50/50 py-12 sm:py-16">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <SectionHeader
          title={t("tradeoffs_title")}
          subtitle={t("tradeoffs_subtitle")}
        />
        <dl className="mt-8 space-y-5">
          {items.map((it, i) => (
            <div
              key={i}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <dt className="text-sm font-bold text-slate-900">{it.q}</dt>
              <dd className="mt-2 text-[15px] leading-relaxed text-slate-600">
                {it.a}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function Repo({ t }: { t: T }) {
  return (
    <section className="py-16 sm:py-20">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <div className="relative isolate overflow-hidden rounded-3xl bg-slate-950 px-6 py-12 text-center text-white shadow-2xl sm:px-12">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10"
          >
            <div className="absolute -top-24 left-1/3 h-72 w-72 rounded-full bg-brand-500 opacity-20 blur-3xl" />
            <div className="absolute -bottom-24 right-0 h-72 w-72 rounded-full bg-emerald-500 opacity-15 blur-3xl" />
          </div>
          <GithubIcon className="mx-auto h-10 w-10 text-white" />
          <h2 className="mt-4 text-balance text-2xl font-bold tracking-tight sm:text-3xl">
            {t("repo_title")}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-pretty text-sm leading-relaxed text-white/75 sm:text-base">
            {t("repo_body")}
          </p>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-7 inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 text-sm font-semibold text-slate-900 shadow-lg transition hover:bg-slate-100"
          >
            <GitBranch className="h-4 w-4" />
            {t("repo_cta")}
            <ArrowRight className="h-4 w-4" />
          </a>
          <p className="mt-4 font-mono text-xs text-white/50">
            {GITHUB_URL.replace("https://", "")}
          </p>
        </div>
      </div>
    </section>
  );
}

/**
 * GitHub logo — lucide-react dropped brand logos a few versions back, so
 * we inline the SVG. Original mark from github.com/logos, simplified path.
 */
function GithubIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55v-2.07c-3.2.7-3.87-1.36-3.87-1.36-.52-1.32-1.28-1.67-1.28-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.7 1.25 3.36.95.1-.74.4-1.25.73-1.54-2.55-.29-5.23-1.28-5.23-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.18 1.18.92-.26 1.91-.39 2.89-.39.98 0 1.97.13 2.89.39 2.21-1.49 3.18-1.18 3.18-1.18.62 1.58.23 2.75.11 3.04.73.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.39-5.25 5.68.41.36.77 1.07.77 2.15v3.19c0 .31.21.67.8.55C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z" />
    </svg>
  );
}
