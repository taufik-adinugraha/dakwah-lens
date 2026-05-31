import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft, BookOpenCheck, Quote } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { db, schema } from "@/db";
import type {
  DeliverableContent,
  KajianFormat,
  KhutbahJumatContent,
  KultumContent,
  KajianUmumContent,
} from "@/db/schema";
import { DaleelList } from "../../kajian/DaleelList";
import { DuaBlock } from "../../kajian/DuaBlock";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/pustaka-kajian/[id]">): Promise<Metadata> {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const [row] = await db
    .select({ title: schema.deliverables.title })
    .from(schema.deliverables)
    .where(
      and(
        eq(schema.deliverables.id, id),
        eq(schema.deliverables.status, "published"),
      ),
    )
    .limit(1);
  return { title: row?.title ?? "Kajian" };
}

export default async function PustakaKajianDetailPage({
  params,
}: PageProps<"/[locale]/pustaka-kajian/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const [row] = await db
    .select()
    .from(schema.deliverables)
    .where(
      and(
        eq(schema.deliverables.id, id),
        eq(schema.deliverables.status, "published"),
      ),
    )
    .limit(1);

  if (!row) notFound();

  const t = await getTranslations("Kajian");
  const tBriefs = await getTranslations("Briefs");
  const content = row.content as DeliverableContent;
  const format = row.format as KajianFormat;
  const formatLabel = t(`format_${format}` as Parameters<typeof t>[0]);
  const segmentLabel = tBriefs(
    `segment_${row.segment}` as Parameters<typeof tBriefs>[0],
  );

  return (
    <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <Link
        href="/pustaka-kajian"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {t("back_to_pustaka")}
      </Link>

      <header className="mt-6 space-y-2">
        <p className="text-xs font-medium uppercase tracking-wider text-brand-700">
          {formatLabel}
        </p>
        <h1 className="text-balance text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          {row.title}
        </h1>
        <p className="text-pretty text-sm leading-relaxed text-slate-600">
          {content.summary}
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-2 text-xs text-slate-500">
          <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium">
            {segmentLabel}
          </span>
          {row.publishedAt && (
            <span className="tabular-nums">
              {new Date(row.publishedAt).toLocaleDateString(
                locale === "id" ? "id-ID" : "en-US",
                {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                  timeZone: "Asia/Jakarta",
                },
              )}
            </span>
          )}
        </div>
      </header>

      <div className="mt-10 space-y-10">
        <DuaBlock dua={content.dua_opening} label={t("dua_opening")} />

        {format === "khutbah_jumat" && (() => {
          const c = content as KhutbahJumatContent;
          return (
            <div className="space-y-10">
              <section>
                <h2 className="text-lg font-semibold text-slate-900">
                  {t("khutbah_pertama")}
                </h2>
                <div className="prose prose-slate mt-3 max-w-none whitespace-pre-wrap text-sm leading-relaxed">
                  {c.khutbah_pertama}
                </div>
              </section>
              <section>
                <h2 className="text-lg font-semibold text-slate-900">
                  {t("khutbah_kedua")}
                </h2>
                <div className="prose prose-slate mt-3 max-w-none whitespace-pre-wrap text-sm leading-relaxed">
                  {c.khutbah_kedua}
                </div>
              </section>
            </div>
          );
        })()}
        {format === "kultum" && (() => {
          const c = content as KultumContent;
          return (
            <section>
              <h2 className="text-lg font-semibold text-slate-900">
                {t("section_body")}
              </h2>
              <div className="prose prose-slate mt-3 max-w-none whitespace-pre-wrap text-sm leading-relaxed">
                {c.body}
              </div>
            </section>
          );
        })()}
        {format === "kajian_umum" && (() => {
          const c = content as KajianUmumContent;
          return (
            <div className="space-y-10">
              <section>
                <h2 className="text-lg font-semibold text-slate-900">
                  {t("section_talking_points")}
                </h2>
                <ol className="mt-3 space-y-6">
                  {c.talking_points.map((p, i) => (
                    <li key={i} className="border-l-2 border-brand-300 pl-4">
                      <h3 className="text-base font-semibold text-slate-900">
                        {i + 1}. {p.heading}
                      </h3>
                      <div className="prose prose-slate mt-2 max-w-none whitespace-pre-wrap text-sm leading-relaxed">
                        {p.body}
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
              <section>
                <h2 className="text-lg font-semibold text-slate-900">
                  {t("section_qna")}
                </h2>
                <ul className="mt-3 space-y-4">
                  {c.qna.map((q, i) => (
                    <li key={i} className="rounded-lg bg-slate-50 p-4">
                      <p className="font-medium text-slate-900">{q.question}</p>
                      <p className="mt-1 text-sm leading-relaxed text-slate-700">
                        {q.answer}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          );
        })()}

        <DuaBlock dua={content.dua_closing} label={t("dua_closing")} />

        <DaleelList
          daleel={content.daleel}
          locale={locale === "id" ? "id" : "en"}
          heading={t("section_daleel")}
        />

        {content.story_illustrations.length > 0 && (
          <section className="rounded-2xl border border-amber-200 bg-amber-50/40 p-6">
            <h2 className="flex items-center gap-2 text-base font-semibold text-amber-900">
              <Quote className="h-4 w-4" />
              {t("section_stories")}
            </h2>
            <ul className="mt-3 space-y-3 text-sm leading-relaxed text-amber-950">
              {content.story_illustrations.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </section>
        )}

        {content.anticipated_objections.length > 0 && (
          <section className="rounded-2xl border border-slate-200 bg-slate-50/40 p-6">
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <BookOpenCheck className="h-4 w-4" />
              {t("section_objections")}
            </h2>
            <ul className="mt-3 space-y-4 text-sm leading-relaxed">
              {content.anticipated_objections.map((o, i) => (
                <li key={i} className="border-l-2 border-slate-300 pl-3">
                  <p className="font-medium text-slate-900">{o.objection}</p>
                  <p className="mt-1 text-slate-700">{o.response}</p>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </article>
  );
}
