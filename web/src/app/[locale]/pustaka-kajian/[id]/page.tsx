import { ForestWash } from "@/components/ForestWash";
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
import { MarkdownBody } from "../../kajian/MarkdownBody";

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
    <main className="relative isolate overflow-hidden bg-paper font-body text-ink">
      <ForestWash />
      <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <Link
        href="/pustaka-kajian"
        className="inline-flex items-center gap-1.5 text-sm text-ink-muted transition hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {t("back_to_pustaka")}
      </Link>

      <header className="mt-8 space-y-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-forest">
          {formatLabel}
        </p>
        <h1 className="text-balance font-display text-[clamp(1.875rem,4vw,2.75rem)] font-medium leading-[1.15] tracking-[-0.015em] text-ink">
          {row.title}
        </h1>
        <p className="text-pretty leading-[1.7] text-ink-muted">
          {content.summary}
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-xs text-ink-faint">
          <span className="text-[11px] font-medium uppercase tracking-[0.15em]">
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
                <h2 className="text-lg font-semibold text-ink">
                  {t("khutbah_pertama")}
                </h2>
                <div className="mt-3">
                  <MarkdownBody text={c.khutbah_pertama} />
                </div>
              </section>
              <section>
                <h2 className="text-lg font-semibold text-ink">
                  {t("khutbah_kedua")}
                </h2>
                <div className="mt-3">
                  <MarkdownBody text={c.khutbah_kedua} />
                </div>
              </section>
            </div>
          );
        })()}
        {format === "kultum" && (() => {
          const c = content as KultumContent;
          return (
            <section>
              <h2 className="text-lg font-semibold text-ink">
                {t("section_body")}
              </h2>
              <div className="mt-3">
                <MarkdownBody text={c.body} />
              </div>
            </section>
          );
        })()}
        {format === "kajian_umum" && (() => {
          const c = content as KajianUmumContent;
          return (
            <div className="space-y-10">
              <section>
                <h2 className="text-lg font-semibold text-ink">
                  {t("section_talking_points")}
                </h2>
                <ol className="mt-3 space-y-8">
                  {c.talking_points.map((p, i) => (
                    <li key={i} className="border-l-2 border-forest/40 pl-4">
                      <h3 className="text-base font-semibold text-ink">
                        {i + 1}. {p.heading}
                      </h3>
                      <div className="mt-2">
                        <MarkdownBody text={p.body} />
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
              <section>
                <h2 className="text-lg font-semibold text-ink">
                  {t("section_qna")}
                </h2>
                <ul className="mt-3 space-y-4">
                  {c.qna.map((q, i) => (
                    <li key={i} className="rounded-xl bg-paper-deep p-4">
                      <p className="font-medium text-ink">{q.question}</p>
                      <div className="mt-1 text-sm sm:text-base">
                        <MarkdownBody text={q.answer} />
                      </div>
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

        {/* Stories + objections only exist on Kultum + Kajian Umum
            (Khutbah Jumat is one-way mimbar delivery — no asides). */}
        {format !== "khutbah_jumat" &&
          (content as KultumContent | KajianUmumContent).story_illustrations
            ?.length > 0 && (
            <section className="rounded-2xl border border-amber-200 bg-amber-50/40 p-6">
              <h2 className="flex items-center gap-2 text-base font-semibold text-amber-900">
                <Quote className="h-4 w-4" />
                {t("section_stories")}
              </h2>
              <ul className="mt-3 space-y-3 text-sm leading-relaxed text-amber-950">
                {(
                  content as KultumContent | KajianUmumContent
                ).story_illustrations.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </section>
          )}

        {format === "kultum" &&
          (content as KultumContent).anticipated_objections?.length > 0 && (
            <section className="rounded-2xl border border-hairline bg-paper-deep/40 p-6">
              <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
                <BookOpenCheck className="h-4 w-4" />
                {t("section_objections")}
              </h2>
              <ul className="mt-3 space-y-4 text-sm leading-relaxed">
                {(content as KultumContent).anticipated_objections.map(
                  (o, i) => (
                    <li key={i} className="border-l-2 border-hairline pl-3">
                      <p className="font-medium text-ink">
                        {o.objection}
                      </p>
                      <p className="mt-1 text-ink-muted">{o.response}</p>
                    </li>
                  ),
                )}
              </ul>
            </section>
          )}
      </div>
      </article>
    </main>
  );
}
