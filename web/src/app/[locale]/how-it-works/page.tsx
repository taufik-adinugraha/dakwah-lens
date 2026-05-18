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
      <BriefPipeline t={t} />
      <ModelsTable t={t} />
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
        <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-6 sm:p-8">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            {t("tldr_label")}
          </p>
          <p className="mt-2 text-pretty text-[15px] leading-relaxed text-slate-700">
            {t("tldr_body")}
          </p>
        </div>
      </div>
    </section>
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
        { name: "IndoBERT", role: t("stack_ai_indobert") },
        { name: "BERTopic", role: t("stack_ai_bertopic") },
        { name: "sentence-transformers", role: t("stack_ai_st") },
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
      <ul className="mt-4 space-y-2 text-sm">
        {items.map((it) => (
          <li key={it.name} className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
            <span className="font-mono text-xs font-semibold text-slate-900 sm:w-44">
              {it.name}
            </span>
            <span className="text-slate-600">{it.role}</span>
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
      <p className="mt-0.5 text-[11px] font-mono text-slate-600">{sub}</p>
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
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[11px] font-bold text-white">
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

function BriefPipeline({ t }: { t: T }) {
  const stages = [
    {
      title: t("brief_stage_1_title"),
      module: "app/[locale]/briefs/new",
      body: t("brief_stage_1_body"),
    },
    {
      title: t("brief_stage_2_title"),
      module: "lib/quran-retrieval.ts",
      body: t("brief_stage_2_body"),
    },
    {
      title: t("brief_stage_3_title"),
      module: "Qdrant `quran` collection",
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
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-700 text-[11px] font-bold text-white">
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

function ModelsTable({ t }: { t: T }) {
  const rows = [
    {
      name: "IndoBERT",
      id: "mdhugol/indonesia-bert-sentiment-classification",
      role: t("models_indobert_role"),
      why: t("models_indobert_why"),
      where: t("models_indobert_where"),
    },
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
    {
      name: "BERTopic + MiniLM",
      id: "paraphrase-multilingual-MiniLM-L12-v2",
      role: t("models_bertopic_role"),
      why: t("models_bertopic_why"),
      where: t("models_bertopic_where"),
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
          <p className="mt-4 font-mono text-[11px] text-white/50">
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
