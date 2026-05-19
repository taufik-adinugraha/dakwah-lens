import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { and, eq, gt, sql } from "drizzle-orm";
import {
  AlertTriangle,
  ArrowLeft,
  BookOpenCheck,
  Quote,
  Users,
} from "lucide-react";

import { Link } from "@/i18n/navigation";
import { db, schema } from "@/db";
import type { BriefContent, BriefDaleel } from "@/db/schema";
import { briefToMarkdown, type MarkdownHeadings } from "@/lib/brief-markdown";
import { PrintButton } from "@/components/PrintButton";
import { PublicBriefDownload } from "./PublicBriefDownload";

const RECENCY_DAYS = 7;

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/briefs/public/[id]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale,
    namespace: "PublicBriefs",
  });
  return { title: t("detail_page_title") };
}

export default async function PublicBriefDetailPage({
  params,
}: PageProps<"/[locale]/briefs/public/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  // Gate: only non-placeholder briefs created in the last 7 days are
  // publicly addressable. After that they fall back to 404 — they still
  // exist for the owner at /briefs/[id], just not on the public surface.
  const [brief] = await db
    .select()
    .from(schema.briefs)
    .where(
      and(
        eq(schema.briefs.id, id),
        eq(schema.briefs.isPlaceholder, false),
        gt(
          schema.briefs.createdAt,
          sql`now() - interval '${sql.raw(String(RECENCY_DAYS))} days'`,
        ),
      ),
    )
    .limit(1);

  if (!brief) notFound();

  const t = await getTranslations("PublicBriefs");
  const tBriefs = await getTranslations("Briefs");
  const content = brief.content as BriefContent;

  const segLabel = tBriefs(
    `segment_${brief.segment}` as Parameters<typeof tBriefs>[0],
  );
  const toneLabel = tBriefs(
    `tone_${brief.tone}` as Parameters<typeof tBriefs>[0],
  );

  const headings: MarkdownHeadings = {
    topic: t("md_topic"),
    segment: tBriefs("field_segment"),
    tone: tBriefs("field_tone"),
    locale: tBriefs("field_locale"),
    situation: tBriefs("section_summary"),
    issue: tBriefs("section_analysis"),
    audience: tBriefs("section_audience"),
    audiencePrimary: tBriefs("section_audience_primary"),
    audiencePerception: tBriefs("section_audience_perception"),
    audienceAngle: t("md_audience_angle"),
    daleel: tBriefs("section_daleel"),
    linkedAyah: t("md_linked_ayah"),
    alsoFoundIn: t("md_also_found_in"),
    recommendations: t("md_recommendations"),
    objections: t("md_objections"),
    objectionLabel: t("md_objection_label"),
    responseLabel: t("md_response_label"),
    illustrations: t("md_illustrations"),
    khutbah: t("md_khutbah"),
    social: t("md_social"),
    disclaimer: t("disclaimer_md"),
    generatedAt: t("md_generated_at"),
  };

  const markdown = briefToMarkdown(
    {
      topicTitle: brief.topicTitle,
      segment: brief.segment,
      tone: brief.tone,
      locale: brief.locale,
      content,
      createdAt: brief.createdAt,
    },
    segLabel,
    toneLabel,
    headings,
  );

  return (
    <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16 print:py-0">
      <Link
        href="/briefs/public"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 print:hidden"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {t("back_to_list")}
      </Link>

      {/* Title + suitability metadata */}
      <h1 className="mt-6 text-balance text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
        {brief.topicTitle}
      </h1>

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <Chip tone="brand">{segLabel}</Chip>
        <Chip tone="emerald">{toneLabel}</Chip>
        <Chip tone="slate">{brief.locale.toUpperCase()}</Chip>
        <span className="ml-1 text-xs text-slate-500">
          {new Date(brief.createdAt).toLocaleDateString(
            locale === "id" ? "id-ID" : "en-US",
            { year: "numeric", month: "short", day: "numeric" },
          )}
        </span>
      </div>

      {/* Suitable-for callout */}
      <div className="mt-6 rounded-2xl border border-brand-100 bg-brand-50/60 p-5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-700">
          {t("suitable_label")}
        </p>
        <p className="mt-2 text-pretty text-sm leading-relaxed text-slate-700">
          {t("suitable_body", { segment: segLabel, tone: toneLabel })}
        </p>
        {content.audience_segmentation?.primary && (
          <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-slate-600">
            <Users className="h-3.5 w-3.5 text-brand-600" />
            <span>
              <span className="font-semibold text-slate-800">
                {tBriefs("section_audience_primary")}:
              </span>{" "}
              {content.audience_segmentation.primary}
            </span>
          </p>
        )}
      </div>

      {/* Disclaimer */}
      <div className="mt-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm text-amber-900">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
        <p className="text-pretty leading-relaxed">{t("disclaimer_inline")}</p>
      </div>

      {/* Section: situation summary */}
      <Section title={tBriefs("section_summary")}>
        <p className="whitespace-pre-wrap text-pretty">
          {content.situation_summary}
        </p>
      </Section>

      <Section title={tBriefs("section_analysis")}>
        <p className="whitespace-pre-wrap text-pretty">
          {content.issue_analysis}
        </p>
      </Section>

      {content.audience_segmentation && (
        <Section title={tBriefs("section_audience")}>
          <SubField label={tBriefs("section_audience_perception")}>
            {content.audience_segmentation.perception}
          </SubField>
          <SubField label={t("md_audience_angle")}>
            {content.audience_segmentation.angle}
          </SubField>
        </Section>
      )}

      {content.daleel?.length > 0 && (
        <Section
          title={tBriefs("section_daleel")}
          icon={<BookOpenCheck className="h-5 w-5 text-emerald-700" />}
        >
          <ol className="space-y-5">
            {content.daleel.map((d: BriefDaleel, i: number) => {
              const muttafaq =
                d.also_found_in?.length &&
                [d.source, ...d.also_found_in.map((a) => a.source)]
                  .map((s) => s.toLowerCase())
                  .some((s) => s.includes("bukhari")) &&
                [d.source, ...d.also_found_in.map((a) => a.source)]
                  .map((s) => s.toLowerCase())
                  .some((s) => s.includes("muslim"));
              return (
                <li
                  key={i}
                  className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-5"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                      {d.source}
                    </p>
                    {muttafaq && (
                      <span className="inline-flex items-center rounded-full bg-emerald-700 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white">
                        {tBriefs("daleel_muttafaq_alayh")}
                      </span>
                    )}
                  </div>
                  <p
                    lang="ar"
                    dir="rtl"
                    className="mt-2 font-amiri text-xl leading-[1.9] text-slate-900"
                  >
                    <Quote className="mr-1 inline h-3 w-3 text-emerald-500" />
                    {d.arabic}
                  </p>
                  <p className="mt-3 text-pretty text-sm leading-relaxed text-slate-700">
                    &ldquo;{d.translation}&rdquo;
                  </p>

                  {d.also_found_in?.length ? (
                    <p className="mt-2 text-[11px] leading-relaxed text-emerald-800/80">
                      <span className="font-semibold">
                        {tBriefs("daleel_also_found_in_label")}:
                      </span>{" "}
                      {d.also_found_in.map((a) => a.source).join(" · ")}
                    </p>
                  ) : null}

                  {d.linked_ayah ? (
                    <div className="mt-3 rounded-xl border border-emerald-200/70 bg-white/70 p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                        {tBriefs("daleel_linked_ayah_label")} ·{" "}
                        {d.linked_ayah.source}
                      </p>
                      <p
                        lang="ar"
                        dir="rtl"
                        className="mt-1.5 font-amiri text-base leading-[1.9] text-slate-900"
                      >
                        {d.linked_ayah.arabic}
                      </p>
                      <p className="mt-1.5 text-pretty text-xs leading-relaxed text-slate-600">
                        &ldquo;{d.linked_ayah.translation}&rdquo;
                      </p>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </Section>
      )}

      {content.recommendations?.length > 0 && (
        <Section title={t("md_recommendations")}>
          <ol className="space-y-2">
            {content.recommendations.map((r: string, i: number) => (
              <li key={i} className="flex gap-3">
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-bold text-white">
                  {i + 1}
                </span>
                <span className="text-pretty">{r}</span>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {content.anticipated_objections?.length ? (
        <Section title={t("md_objections")}>
          <div className="space-y-3">
            {content.anticipated_objections.map((o, i) => (
              <div
                key={i}
                className="rounded-2xl border border-slate-200 bg-white p-4"
              >
                <p className="text-sm font-medium text-slate-900">
                  <span className="mr-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    {t("md_objection_label")}
                  </span>
                  {o.objection}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-slate-700">
                  <span className="mr-2 text-[10px] font-semibold uppercase tracking-wider text-brand-700">
                    {t("md_response_label")}
                  </span>
                  {o.response}
                </p>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {content.story_illustrations?.length ? (
        <Section title={t("md_illustrations")}>
          <ol className="space-y-2">
            {content.story_illustrations.map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[10px] font-bold text-amber-800">
                  {i + 1}
                </span>
                <span className="text-pretty">{s}</span>
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      {content.content_templates && (
        <>
          <Section title={t("md_khutbah")}>
            <p className="whitespace-pre-wrap text-pretty rounded-2xl border border-slate-200 bg-white p-5 font-mono text-[13px] leading-relaxed text-slate-800">
              {content.content_templates.khutbah_outline}
            </p>
          </Section>
          <Section title={t("md_social")}>
            <p className="whitespace-pre-wrap text-pretty rounded-2xl border border-slate-200 bg-white p-5 text-[13px] leading-relaxed text-slate-800">
              {content.content_templates.social_caption}
            </p>
          </Section>
        </>
      )}

      <div className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-6 print:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <PublicBriefDownload
            markdown={markdown}
            topicTitle={brief.topicTitle}
          />
          <PrintButton namespace="PublicBriefs" />
        </div>
        <Link
          href="/briefs/public"
          className="text-xs font-medium text-slate-500 hover:text-slate-900"
        >
          {t("back_to_list")} →
        </Link>
      </div>
    </article>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="flex items-center gap-2 text-balance text-lg font-bold tracking-tight text-slate-900 sm:text-xl">
        {icon}
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-slate-700">
        {children}
      </div>
    </section>
  );
}

function SubField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-pretty">{children}</p>
    </div>
  );
}

function Chip({
  tone,
  children,
}: {
  tone: "brand" | "emerald" | "slate";
  children: React.ReactNode;
}) {
  const cls =
    tone === "brand"
      ? "bg-brand-50 text-brand-700 ring-brand-100"
      : tone === "emerald"
        ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
        : "bg-slate-50 text-slate-700 ring-slate-200";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${cls}`}
    >
      {children}
    </span>
  );
}
