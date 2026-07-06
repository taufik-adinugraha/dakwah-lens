import { ForestWash } from "@/components/ForestWash";
import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";

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
    <main className="relative isolate overflow-hidden bg-paper font-body text-ink">
      <ForestWash />
      <div className="mx-auto max-w-4xl px-4 py-14 sm:px-6 sm:py-20">
        <header className="max-w-2xl">
          <h1 className="text-balance font-display text-[clamp(2rem,4.5vw,3rem)] font-medium leading-[1.1] tracking-[-0.015em] text-ink">
            {t("page_title")}
          </h1>
          <p className="mt-4 text-pretty leading-[1.7] text-ink-muted">
            {t("page_subtitle")}
          </p>
        </header>

        {rows.length === 0 ? (
          <div className="mt-12 border border-dashed border-hairline px-6 py-14 text-center">
            <p className="text-sm font-medium text-ink">{t("empty_title")}</p>
            <p className="mt-1 text-xs text-ink-faint">{t("empty_subtitle")}</p>
          </div>
        ) : (
          <ul className="mt-12 border-t border-hairline">
            {rows.map((row) => {
              const summary =
                typeof row.content === "object" &&
                row.content !== null &&
                "summary" in row.content
                  ? (row.content as { summary: string }).summary
                  : "";
              return (
                <li key={row.id} className="border-b border-hairline">
                  <Link
                    href={`/pustaka-kajian/${row.id}`}
                    className="group block py-6"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11px] font-medium uppercase tracking-[0.15em]">
                      <span className="text-forest">
                        {tKajian(
                          `format_${row.format}` as Parameters<typeof tKajian>[0],
                        )}
                      </span>
                      <span className="text-ink-faint">
                        {tBriefs(
                          `segment_${row.segment}` as Parameters<typeof tBriefs>[0],
                        )}
                      </span>
                      <span className="ml-auto text-xs normal-case tracking-normal text-ink-faint tabular-nums">
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
                    </div>
                    <h2 className="mt-2 font-display text-xl font-medium tracking-[-0.015em] text-ink transition group-hover:text-forest">
                      {row.title}
                    </h2>
                    {summary && (
                      <p className="mt-1.5 line-clamp-2 max-w-2xl text-sm leading-[1.7] text-ink-muted">
                        {summary}
                      </p>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
