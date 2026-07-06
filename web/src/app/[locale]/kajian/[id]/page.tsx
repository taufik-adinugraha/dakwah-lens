import { ForestWash } from "@/components/ForestWash";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { eq, and } from "drizzle-orm";
import { ArrowLeft, BookOpenCheck, Quote } from "lucide-react";

import { auth } from "@/auth";
import { Link } from "@/i18n/navigation";
import { db, schema } from "@/db";
import type {
  DeliverableContent,
  KajianFormat,
  KhutbahJumatContent,
  KultumContent,
  KajianUmumContent,
} from "@/db/schema";
import { MarkdownBody } from "../MarkdownBody";
import { PublishToggle } from "../PublishToggle";
import { KajianDeleteButton } from "../KajianDeleteButton";
import { DaleelList } from "../DaleelList";
import { DuaBlock } from "../DuaBlock";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/kajian/[id]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Kajian" });
  return { title: t("page_title_detail") };
}

export default async function KajianDetailPage({
  params,
}: PageProps<"/[locale]/kajian/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=/kajian/${id}`);
  }

  const [row] = await db
    .select()
    .from(schema.deliverables)
    .where(
      and(
        eq(schema.deliverables.id, id),
        eq(schema.deliverables.userId, session.user.id),
      ),
    )
    .limit(1);

  if (!row) notFound();

  const t = await getTranslations("Kajian");
  const tBriefs = await getTranslations("Briefs");
  const content = row.content as DeliverableContent;
  const format = row.format as KajianFormat;
  const isPublished = row.status === "published";

  const segmentLabel = tBriefs(
    `segment_${row.segment}` as Parameters<typeof tBriefs>[0],
  );
  const toneLabel = tBriefs(`tone_${row.tone}` as Parameters<typeof tBriefs>[0]);
  const formatLabel = t(`format_${format}` as Parameters<typeof t>[0]);

  return (
    <article className="relative isolate mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16 print:py-0">
      <div className="print:hidden"><ForestWash /></div>
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link
          href={`/briefs/${row.briefId}`}
          className="inline-flex items-center gap-1.5 text-sm text-ink-faint hover:text-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t("back_to_brief")}
        </Link>
        <div className="flex items-center gap-2">
          <PublishToggle
            kajianId={row.id}
            initialPublished={isPublished}
            labels={{
              publish: t("action_publish"),
              unpublish: t("action_unpublish"),
              publishedBadge: t("status_published"),
              draftBadge: t("status_draft"),
            }}
          />
          <KajianDeleteButton
            kajianId={row.id}
            labels={{
              aria: t("action_delete"),
              confirm: t("delete_confirm"),
            }}
          />
        </div>
      </div>

      <header className="mt-6 space-y-2">
        <p className="text-xs font-medium uppercase tracking-wider text-brand-700">
          {formatLabel}
        </p>
        <h1 className="text-balance text-3xl font-bold tracking-tight text-ink sm:text-4xl">
          {row.title}
        </h1>
        <p className="text-pretty text-sm leading-relaxed text-ink-muted">
          {content.summary}
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-2 text-xs text-ink-faint">
          <span className="inline-flex items-center gap-1 rounded-full bg-paper-deep px-2 py-0.5 font-medium">
            {segmentLabel}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-paper-deep px-2 py-0.5 font-medium">
            {toneLabel}
          </span>
          <span className="tabular-nums">
            {new Date(row.createdAt).toLocaleDateString(
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
      </header>

      <div className="mt-10 space-y-10">
        <DuaBlock dua={content.dua_opening} label={t("dua_opening")} />

        {format === "khutbah_jumat" && (
          <KhutbahJumatBody
            content={content as KhutbahJumatContent}
            labels={{
              pertama: t("khutbah_pertama"),
              kedua: t("khutbah_kedua"),
            }}
          />
        )}
        {format === "kultum" && (
          <KultumBody
            content={content as KultumContent}
            label={t("section_body")}
          />
        )}
        {format === "kajian_umum" && (
          <KajianUmumBody
            content={content as KajianUmumContent}
            labels={{
              talkingPoints: t("section_talking_points"),
              qna: t("section_qna"),
            }}
          />
        )}

        <DuaBlock dua={content.dua_closing} label={t("dua_closing")} />

        <DaleelList
          daleel={content.daleel}
          locale={locale === "id" ? "id" : "en"}
          heading={t("section_daleel")}
        />

        {/* Stories exist on Kultum + Kajian Umum (Khutbah Jumat is
            one-way mimbar delivery). Anticipated objections exist
            only on Kultum — Kajian Umum has a formal Q&A section
            (qna above) that already covers audience-pushback prep. */}
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
  );
}

function KhutbahJumatBody({
  content,
  labels,
}: {
  content: KhutbahJumatContent;
  labels: { pertama: string; kedua: string };
}) {
  return (
    <div className="space-y-10">
      <section>
        <h2 className="text-lg font-semibold text-ink">{labels.pertama}</h2>
        <div className="mt-3">
          <MarkdownBody text={content.khutbah_pertama} />
        </div>
      </section>
      <section>
        <h2 className="text-lg font-semibold text-ink">{labels.kedua}</h2>
        <div className="mt-3">
          <MarkdownBody text={content.khutbah_kedua} />
        </div>
      </section>
    </div>
  );
}

function KultumBody({
  content,
  label,
}: {
  content: KultumContent;
  label: string;
}) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-ink">{label}</h2>
      <div className="mt-3">
        <MarkdownBody text={content.body} />
      </div>
    </section>
  );
}

function KajianUmumBody({
  content,
  labels,
}: {
  content: KajianUmumContent;
  labels: { talkingPoints: string; qna: string };
}) {
  return (
    <div className="space-y-10">
      <section>
        <h2 className="text-lg font-semibold text-ink">
          {labels.talkingPoints}
        </h2>
        <ol className="mt-3 space-y-8">
          {content.talking_points.map((p, i) => (
            <li key={i} className="border-l-2 border-brand-300 pl-4">
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
        <h2 className="text-lg font-semibold text-ink">{labels.qna}</h2>
        <ul className="mt-3 space-y-4">
          {content.qna.map((q, i) => (
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
}
