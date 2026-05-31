import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { BookOpen, Clock } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { db, schema } from "@/db";

const PAGE_LIMIT = 50;

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/pustaka-kajian">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "PustakaKajian" });
  return { title: t("page_title") };
}

export default async function PustakaKajianPage({
  params,
}: PageProps<"/[locale]/pustaka-kajian">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("PustakaKajian");
  const tKajian = await getTranslations("Kajian");
  const tBriefs = await getTranslations("Briefs");

  const rows = await db
    .select({
      id: schema.deliverables.id,
      title: schema.deliverables.title,
      format: schema.deliverables.format,
      segment: schema.deliverables.segment,
      tone: schema.deliverables.tone,
      content: schema.deliverables.content,
      publishedAt: schema.deliverables.publishedAt,
    })
    .from(schema.deliverables)
    .where(eq(schema.deliverables.status, "published"))
    .orderBy(desc(schema.deliverables.publishedAt))
    .limit(PAGE_LIMIT);

  return (
    <main className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
      <header className="space-y-3">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">
          <BookOpen className="h-3.5 w-3.5" />
          {t("page_title")}
        </span>
        <h1 className="text-balance text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          {t("page_title")}
        </h1>
        <p className="text-pretty text-sm leading-relaxed text-slate-600">
          {t("page_subtitle")}
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center">
          <p className="text-sm font-medium text-slate-700">{t("empty_title")}</p>
          <p className="mt-1 text-xs text-slate-500">{t("empty_subtitle")}</p>
        </div>
      ) : (
        <ul className="mt-10 grid gap-3">
          {rows.map((row) => {
            const summary =
              typeof row.content === "object" &&
              row.content !== null &&
              "summary" in row.content
                ? (row.content as { summary: string }).summary
                : "";
            return (
              <li key={row.id}>
                <Link
                  href={`/pustaka-kajian/${row.id}`}
                  className="block rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow-md"
                >
                  <div className="flex items-center gap-2 text-xs">
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 font-semibold text-brand-700">
                      {tKajian(
                        `format_${row.format}` as Parameters<typeof tKajian>[0],
                      )}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                      {tBriefs(
                        `segment_${row.segment}` as Parameters<typeof tBriefs>[0],
                      )}
                    </span>
                    <span className="ml-auto inline-flex items-center gap-1 text-slate-500">
                      <Clock className="h-3 w-3" />
                      <span className="tabular-nums">
                        {row.publishedAt
                          ? new Date(row.publishedAt).toLocaleDateString(
                              locale === "id" ? "id-ID" : "en-US",
                              {
                                year: "numeric",
                                month: "short",
                                day: "numeric",
                                timeZone: "Asia/Jakarta",
                              },
                            )
                          : ""}
                      </span>
                    </span>
                  </div>
                  <h2 className="mt-2 text-base font-semibold text-slate-900">
                    {row.title}
                  </h2>
                  {summary && (
                    <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-slate-600">
                      {summary}
                    </p>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
