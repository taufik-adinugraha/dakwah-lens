import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { eq, and } from "drizzle-orm";
import {
  ArrowLeft,
  BarChart3,
  BookOpenCheck,
  ChevronRight,
  MessageSquareText,
  Sparkles,
} from "lucide-react";
import ReactMarkdown from "react-markdown";

import { auth } from "@/auth";
import { Link } from "@/i18n/navigation";
import { db, schema } from "@/db";
import type { BriefContent, BriefDaleel } from "@/db/schema";
import { PlaceholderBanner, PlaceholderChip } from "@/components/PlaceholderBadge";
import { PrintButton } from "@/components/PrintButton";
import { DeliverableGeneratorForm } from "@/app/[locale]/kajian/DeliverableGeneratorForm";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/briefs/[id]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Briefs" });
  return { title: t("page_title_detail") };
}

export default async function BriefDetailPage({
  params,
}: PageProps<"/[locale]/briefs/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=/briefs/${id}`);
  }

  // Only the owner can read the brief for now. Org-level sharing comes later.
  const [brief] = await db
    .select()
    .from(schema.briefs)
    .where(
      and(eq(schema.briefs.id, id), eq(schema.briefs.userId, session.user.id)),
    )
    .limit(1);

  if (!brief) notFound();

  const t = await getTranslations("Briefs");
  const content = brief.content as BriefContent;

  return (
    <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16 print:py-0">
      <div className="flex items-center justify-between print:hidden">
        <Link
          href="/briefs/new"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t("regenerate")}
        </Link>
        <div className="flex items-center gap-2">
          {brief.isPlaceholder && <PlaceholderChip label={t("placeholder_label")} />}
          <PrintButton namespace="Briefs" />
        </div>
      </div>

      <h1 className="mt-6 text-balance text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
        {brief.topicTitle}
      </h1>

      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
        <span className="tabular-nums">
          {new Date(brief.createdAt).toLocaleDateString(
            locale === "id" ? "id-ID" : "en-US",
            {
              year: "numeric",
              month: "short",
              day: "numeric",
              timeZone: "Asia/Jakarta",
            },
          )}
        </span>
      </div>


      {brief.isPlaceholder && (
        <div className="mt-6">
          <PlaceholderBanner
            label={t("placeholder_label")}
            note={t("placeholder_note")}
          />
        </div>
      )}

      <Section icon={Sparkles} title={t("section_summary")}>
        <p className="text-pretty leading-relaxed text-slate-700">
          {content.situation_summary}
        </p>
      </Section>

      {content.platform_stats && content.platform_stats.some((s) => s.total > 0) && (
        <Section icon={BarChart3} title={t("section_statistics")}>
          <PlatformStatsTable
            stats={content.platform_stats}
            labels={{
              platform: t("stats_platform"),
              total: t("stats_total"),
              positive: t("stats_positive"),
              neutral: t("stats_neutral"),
              negative: t("stats_negative"),
              other: t("stats_other"),
              empty: t("stats_empty_row"),
            }}
          />
        </Section>
      )}

      <Section icon={ChevronRight} title={t("section_analysis")}>
        <div className="prose prose-slate max-w-none text-pretty leading-relaxed text-slate-700 prose-p:my-3 prose-li:my-1 prose-strong:text-slate-900 prose-ul:my-3">
          <ReactMarkdown>{content.issue_analysis}</ReactMarkdown>
        </div>
      </Section>

      <CollapsibleSection
        icon={BookOpenCheck}
        title={t("section_daleel")}
        tone="emerald"
        summarySuffix={`${content.daleel.length} dalil`}
      >
        <div className="space-y-4">
          {content.daleel.map((d: BriefDaleel, i) => (
            <DaleelCard key={`${d.surah}_${d.ayah}_${i}`} d={d} t={t} />
          ))}
        </div>
      </CollapsibleSection>

      {content.platform_samples &&
        content.platform_samples.some((g) => g.samples.length > 0) && (
          <CollapsibleSection
            icon={MessageSquareText}
            title={t("section_sources")}
            summarySuffix={`${content.platform_samples.reduce(
              (acc, g) => acc + g.samples.length,
              0,
            )} post`}
          >
            <p className="text-xs leading-relaxed text-slate-500">
              {t("section_sources_hint")}
            </p>
            <div className="mt-3 space-y-4">
              {content.platform_samples.map((group) =>
                group.samples.length === 0 ? null : (
                  <PlatformSampleGroup
                    key={group.platform}
                    group={group}
                    platformLabel={platformLabel(group.platform)}
                  />
                ),
              )}
            </div>
          </CollapsibleSection>
        )}

      <div className="mt-12 print:hidden">
        <DeliverableGeneratorForm
          briefId={brief.id}
          daleel={content.daleel}
          defaultLocale={brief.locale === "en" ? "en" : "id"}
        />
      </div>
    </article>
  );
}

function Section({
  icon: Icon,
  title,
  tone = "slate",
  children,
}: {
  icon: typeof Sparkles;
  title: string;
  tone?: "slate" | "emerald";
  children: React.ReactNode;
}) {
  const iconCls = tone === "emerald" ? "text-emerald-600" : "text-brand-600";
  return (
    <section className="mt-10">
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${iconCls}`} />
        <h2 className="text-balance text-base font-semibold text-slate-900 sm:text-lg">
          {title}
        </h2>
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Same visual structure as `Section` but rendered as `<details>` so
 *  the body is collapsed by default and toggleable without any JS.
 *  Native browser disclosure triangle replaced by a Tailwind-styled
 *  chevron that rotates via `[&[open]>summary>...]:rotate-90`. */
function CollapsibleSection({
  icon: Icon,
  title,
  tone = "slate",
  summarySuffix,
  children,
}: {
  icon: typeof Sparkles;
  title: string;
  tone?: "slate" | "emerald";
  /** Optional small label after the title (e.g. "10 dalil") so the
   *  user knows what's hidden without expanding. */
  summarySuffix?: string;
  children: React.ReactNode;
}) {
  const iconCls = tone === "emerald" ? "text-emerald-600" : "text-brand-600";
  return (
    <details className="group mt-10">
      <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden print:cursor-default">
        <Icon className={`h-4 w-4 ${iconCls}`} />
        <h2 className="text-balance text-base font-semibold text-slate-900 sm:text-lg">
          {title}
        </h2>
        {summarySuffix && (
          <span className="ml-1 inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
            {summarySuffix}
          </span>
        )}
        <ChevronRight className="ml-auto h-4 w-4 text-slate-400 transition-transform group-open:rotate-90 print:hidden" />
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

const PLATFORM_LABEL: Record<string, string> = {
  x: "X (Twitter)",
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
  mainstream: "Berita arus utama",
};

function platformLabel(p: string): string {
  return PLATFORM_LABEL[p] ?? p;
}

type PlatformStatRow = {
  platform: string;
  total: number;
  positive: number;
  neutral: number;
  negative: number;
  other: number;
};

function PlatformStatsTable({
  stats,
  labels,
}: {
  stats: PlatformStatRow[];
  labels: {
    platform: string;
    total: string;
    positive: string;
    neutral: string;
    negative: string;
    other: string;
    empty: string;
  };
}) {
  const grandTotal = stats.reduce((a, s) => a + s.total, 0);
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            <th className="px-4 py-2">{labels.platform}</th>
            <th className="px-4 py-2 text-right">{labels.total}</th>
            <th className="px-4 py-2 text-right text-emerald-700">
              {labels.positive}
            </th>
            <th className="px-4 py-2 text-right text-slate-700">
              {labels.neutral}
            </th>
            <th className="px-4 py-2 text-right text-rose-700">
              {labels.negative}
            </th>
            <th className="px-4 py-2 text-right text-slate-500">
              {labels.other}
            </th>
          </tr>
        </thead>
        <tbody>
          {stats.map((s) => {
            const isEmpty = s.total === 0;
            return (
              <tr
                key={s.platform}
                className="border-b border-slate-100 last:border-b-0"
              >
                <td className="px-4 py-2 font-medium text-slate-900">
                  {platformLabel(s.platform)}
                </td>
                {isEmpty ? (
                  <td
                    colSpan={5}
                    className="px-4 py-2 text-right text-xs italic text-slate-400"
                  >
                    {labels.empty}
                  </td>
                ) : (
                  <>
                    <td className="px-4 py-2 text-right font-semibold tabular-nums text-slate-900">
                      {s.total.toLocaleString("id-ID")}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-emerald-700">
                      {s.positive.toLocaleString("id-ID")}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                      {s.neutral.toLocaleString("id-ID")}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-rose-700">
                      {s.negative.toLocaleString("id-ID")}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-500">
                      {s.other.toLocaleString("id-ID")}
                    </td>
                  </>
                )}
              </tr>
            );
          })}
          <tr className="bg-slate-50/60 font-semibold">
            <td className="px-4 py-2 text-slate-700">Σ</td>
            <td className="px-4 py-2 text-right tabular-nums text-slate-900">
              {grandTotal.toLocaleString("id-ID")}
            </td>
            <td className="px-4 py-2 text-right tabular-nums text-emerald-700">
              {stats
                .reduce((a, s) => a + s.positive, 0)
                .toLocaleString("id-ID")}
            </td>
            <td className="px-4 py-2 text-right tabular-nums text-slate-700">
              {stats.reduce((a, s) => a + s.neutral, 0).toLocaleString("id-ID")}
            </td>
            <td className="px-4 py-2 text-right tabular-nums text-rose-700">
              {stats
                .reduce((a, s) => a + s.negative, 0)
                .toLocaleString("id-ID")}
            </td>
            <td className="px-4 py-2 text-right tabular-nums text-slate-500">
              {stats.reduce((a, s) => a + s.other, 0).toLocaleString("id-ID")}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

type PlatformSampleEntry = {
  text: string;
  author: string | null;
  postedAt: string | null;
  sentimentLabel: string | null;
  url?: string | null;
};

function PlatformSampleGroup({
  group,
  platformLabel,
}: {
  group: { platform: string; samples: PlatformSampleEntry[] };
  platformLabel: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
        {platformLabel}
      </p>
      <ul className="mt-2 space-y-3 text-sm leading-relaxed">
        {group.samples.map((s, i) => {
          const meta = [
            s.author ? `@${s.author}` : null,
            s.postedAt ? new Date(s.postedAt).toLocaleDateString("id-ID") : null,
          ]
            .filter(Boolean)
            .join(" · ");
          const sentClass =
            s.sentimentLabel === "positive"
              ? "bg-emerald-50 text-emerald-700"
              : s.sentimentLabel === "negative"
                ? "bg-rose-50 text-rose-700"
                : s.sentimentLabel === "neutral"
                  ? "bg-slate-100 text-slate-700"
                  : "bg-slate-50 text-slate-500";
          return (
            <li key={i} className="border-l-2 border-slate-200 pl-3">
              <p className="text-slate-800">{s.text}</p>
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                {meta && <span>{meta}</span>}
                {s.sentimentLabel && (
                  <span
                    className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${sentClass}`}
                  >
                    {s.sentimentLabel}
                  </span>
                )}
                {s.url && (
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 text-[11px] font-medium text-brand-700 hover:text-brand-900 hover:underline"
                  >
                    Lihat sumber ↗
                  </a>
                )}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function DaleelCard({
  d,
  t,
}: {
  d: BriefDaleel;
  t: Awaited<ReturnType<typeof getTranslations<"Briefs">>>;
}) {
  const isSemantic = d.retrieval_source === "qdrant";
  const isFallback = d.retrieval_source === "keyword";
  // "Muttafaq alayh" — agreed upon by Bukhari AND Muslim — is the
  // strongest hadith authentication tier. Flag it explicitly so the
  // da'i sees the credibility signal at a glance.
  const isMuttafaq = (() => {
    if (!d.also_found_in?.length) return false;
    const corpora = new Set([d.source, ...d.also_found_in.map((a) => a.source)]
      .map((s) => s.toLowerCase()));
    const hitsBukhari = Array.from(corpora).some((s) => s.includes("bukhari"));
    const hitsMuslim = Array.from(corpora).some((s) => s.includes("muslim"));
    return hitsBukhari && hitsMuslim;
  })();
  return (
    <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-5 ring-1 ring-emerald-50">
      <p
        dir="rtl"
        lang="ar"
        className="font-arabic text-2xl leading-[2] text-slate-900 sm:text-[1.65rem]"
      >
        {d.arabic}
      </p>
      <p className="mt-3 text-pretty text-sm leading-relaxed text-slate-700">
        <span aria-hidden>“</span>
        {d.translation}
        <span aria-hidden>”</span>
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <p className="text-xs font-medium text-emerald-700">— {d.source}</p>
        {isSemantic && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 ring-1 ring-emerald-200">
            {t("daleel_source_qdrant")}
            {typeof d.retrieval_score === "number" && (
              <span className="font-mono normal-case tracking-normal text-emerald-600">
                · {t("daleel_score_label")} {(d.retrieval_score * 100).toFixed(1)}%
              </span>
            )}
          </span>
        )}
        {isFallback && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700 ring-1 ring-amber-200">
            {t("daleel_source_keyword")}
          </span>
        )}
        {isMuttafaq && (
          <span className="inline-flex items-center rounded-full bg-emerald-700 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
            {t("daleel_muttafaq_alayh")}
          </span>
        )}
      </div>

      {d.also_found_in?.length ? (
        <p className="mt-2 text-xs leading-relaxed text-emerald-800/80">
          <span className="font-semibold">
            {t("daleel_also_found_in_label")}:
          </span>{" "}
          {d.also_found_in.map((a) => a.source).join(" · ")}
        </p>
      ) : null}

      {d.linked_ayah ? (
        <div className="mt-3 rounded-xl border border-emerald-200/70 bg-white/70 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
            {t("daleel_linked_ayah_label")} · {d.linked_ayah.source}
          </p>
          <p
            dir="rtl"
            lang="ar"
            className="mt-1.5 font-arabic text-lg leading-[1.9] text-slate-900"
          >
            {d.linked_ayah.arabic}
          </p>
          <p className="mt-1.5 text-pretty text-xs leading-relaxed text-slate-600">
            <span aria-hidden>“</span>
            {d.linked_ayah.translation}
            <span aria-hidden>”</span>
          </p>
        </div>
      ) : null}

      {/* LLM-written relevance note. Why this daleel matters for THIS
          topic + audience — written during brief synthesis, NOT
          retrieved from the kitab corpus. Pre-2026-05-29 briefs don't
          have it; the conditional handles both cases. */}
      {d.explanation ? (
        <div className="mt-3 rounded-xl border border-emerald-200/70 bg-white/70 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
            {t("daleel_relevance_label")}
          </p>
          <p className="mt-1.5 text-pretty text-sm leading-relaxed text-slate-700">
            {d.explanation}
          </p>
        </div>
      ) : null}
    </div>
  );
}

