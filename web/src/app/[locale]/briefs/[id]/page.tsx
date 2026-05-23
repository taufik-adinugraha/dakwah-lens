import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { eq, and } from "drizzle-orm";
import {
  ArrowLeft,
  BookOpenCheck,
  ChevronRight,
  Lightbulb,
  MessageCircleQuestion,
  Quote,
  Sparkles,
  Users,
} from "lucide-react";

import { auth } from "@/auth";
import { Link } from "@/i18n/navigation";
import { db, schema } from "@/db";
import type { BriefContent, BriefDaleel } from "@/db/schema";
import { formatIdr, formatUsd, SPOT_USD_TO_IDR } from "@/lib/brief-cost";
import { PlaceholderBanner, PlaceholderChip } from "@/components/PlaceholderBadge";
import { PrintButton } from "@/components/PrintButton";

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
  const tSeg = await getTranslations("Briefs");
  const content = brief.content as BriefContent;

  const segmentLabel = tSeg(
    `segment_${brief.segment}` as Parameters<typeof tSeg>[0],
  );
  const toneLabel = tSeg(`tone_${brief.tone}` as Parameters<typeof tSeg>[0]);

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
        <span>
          <span className="font-medium text-slate-700">{segmentLabel}</span>
        </span>
        <span className="text-slate-300">·</span>
        <span>
          {t("field_tone")}: <span className="font-medium text-slate-700">{toneLabel}</span>
        </span>
        <span className="text-slate-300">·</span>
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

      {brief.costUsd != null && (
        <BriefCostStrip
          costUsd={Number(brief.costUsd)}
          tokensIn={brief.tokensIn}
          tokensOut={brief.tokensOut}
          provider={brief.provider}
          model={brief.model}
          label={t("cost_actual_label")}
          tokensLabel={t("cost_tokens_label")}
        />
      )}

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

      <Section icon={ChevronRight} title={t("section_analysis")}>
        <p className="text-pretty leading-relaxed text-slate-700">
          {content.issue_analysis}
        </p>
      </Section>

      <Section icon={Users} title={t("section_audience")}>
        <div className="grid gap-3 sm:grid-cols-3">
          <AudiencePanel
            label={t("section_audience_primary")}
            body={content.audience_segmentation.primary}
          />
          <AudiencePanel
            label={t("section_audience_perception")}
            body={content.audience_segmentation.perception}
          />
          <AudiencePanel
            label={t("section_audience_angle")}
            body={content.audience_segmentation.angle}
          />
        </div>
      </Section>

      <Section icon={BookOpenCheck} title={t("section_daleel")} tone="emerald">
        <div className="space-y-4">
          {content.daleel.map((d: BriefDaleel, i) => (
            <DaleelCard key={`${d.surah}_${d.ayah}_${i}`} d={d} t={t} />
          ))}
        </div>
      </Section>

      <Section icon={Sparkles} title={t("section_recommendations")}>
        <ol className="space-y-2 text-sm leading-relaxed text-slate-700">
          {content.recommendations.map((r, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[11px] font-semibold text-brand-700">
                {i + 1}
              </span>
              <span className="text-pretty">{r}</span>
            </li>
          ))}
        </ol>
      </Section>

      {content.anticipated_objections?.length ? (
        <Section
          icon={MessageCircleQuestion}
          title={t("section_objections")}
        >
          <div className="space-y-4">
            {content.anticipated_objections.map((o, i) => (
              <div
                key={i}
                className="rounded-xl border border-slate-200 bg-slate-50/60 p-4"
              >
                <p className="text-sm font-medium text-slate-900">
                  <span className="mr-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    {t("objection_label")}
                  </span>
                  {o.objection}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-slate-700">
                  <span className="mr-2 text-[10px] font-semibold uppercase tracking-wider text-brand-700">
                    {t("response_label")}
                  </span>
                  {o.response}
                </p>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {content.story_illustrations?.length ? (
        <Section icon={Lightbulb} title={t("section_illustrations")}>
          <ol className="space-y-2 text-sm leading-relaxed text-slate-700">
            {content.story_illustrations.map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-50 text-[11px] font-semibold text-amber-700">
                  {i + 1}
                </span>
                <span className="text-pretty">{s}</span>
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      <Section icon={Quote} title={t("section_templates")}>
        <div className="space-y-4">
          <TemplateBlock
            label={t("template_khutbah")}
            body={content.content_templates.khutbah_outline}
          />
          <TemplateBlock
            label={t("template_social")}
            body={content.content_templates.social_caption}
          />
        </div>
      </Section>
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

function AudiencePanel({ label, body }: { label: string; body: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <p className="mt-1.5 text-pretty text-sm leading-relaxed text-slate-700">
        {body}
      </p>
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
        <p className="mt-2 text-[11px] leading-relaxed text-emerald-800/80">
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
    </div>
  );
}

function TemplateBlock({ label, body }: { label: string; body: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <pre className="mt-2 whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-700">
        {body}
      </pre>
    </div>
  );
}

/** Compact actual-cost row shown under the brief header. Print-hidden
 *  because cost isn't relevant on a printed handout. */
function BriefCostStrip({
  costUsd,
  tokensIn,
  tokensOut,
  provider,
  model,
  label,
  tokensLabel,
}: {
  costUsd: number;
  tokensIn: number | null;
  tokensOut: number | null;
  provider: string | null;
  model: string | null;
  label: string;
  tokensLabel: string;
}) {
  return (
    <div className="mt-3 inline-flex flex-wrap items-center gap-x-3 gap-y-1 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] text-slate-600 print:hidden">
      <span className="font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </span>
      <span className="font-bold tabular-nums text-slate-900">
        {formatUsd(costUsd)}
      </span>
      <span className="tabular-nums text-slate-500">
        ({formatIdr(costUsd * SPOT_USD_TO_IDR)})
      </span>
      {tokensIn != null && tokensOut != null && (
        <>
          <span className="text-slate-300">·</span>
          <span className="tabular-nums">
            {tokensIn.toLocaleString()} + {tokensOut.toLocaleString()} {tokensLabel}
          </span>
        </>
      )}
      {(provider || model) && (
        <>
          <span className="text-slate-300">·</span>
          <span className="text-slate-500">{model ?? provider}</span>
        </>
      )}
    </div>
  );
}
