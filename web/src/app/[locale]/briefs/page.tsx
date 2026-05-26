import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { ArrowRight, Plus, ScrollText, Sparkles } from "lucide-react";

import { auth } from "@/auth";
import { MonthPickerPager } from "@/components/MonthPickerPager";
import { Link } from "@/i18n/navigation";
import { db, schema } from "@/db";
import {
  monthRangeUtc,
  parseMonthParam,
  parsePageParam,
} from "@/lib/month-filter";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/briefs">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Briefs" });
  return { title: t("page_title_list") };
}

const PAGE_SIZE = 20;

export default async function MyBriefsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/briefs">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/briefs");
  }

  const t = await getTranslations("Briefs");
  const sp = await searchParams;
  const selectedMonth = parseMonthParam(sp.month);
  const page = parsePageParam(sp.page);

  // Months available for THIS user — drives the dropdown. WIB-anchored
  // so a row created near midnight stays in the user-visible day.
  const monthRows = (await db.execute(sql`
    SELECT DISTINCT
      EXTRACT(YEAR FROM (created_at AT TIME ZONE 'Asia/Jakarta'))::int AS year,
      EXTRACT(MONTH FROM (created_at AT TIME ZONE 'Asia/Jakarta'))::int AS month
    FROM briefs
    WHERE user_id = ${session.user.id}
    ORDER BY year DESC, month DESC
  `)) as unknown as Array<{ year: number; month: number }>;
  const monthsAvailable = monthRows.map((r) => ({
    year: Number(r.year),
    month: Number(r.month),
  }));

  const baseWhere = eq(schema.briefs.userId, session.user.id);
  const filterWhere = selectedMonth
    ? (() => {
        const { startUtc, endUtc } = monthRangeUtc(
          selectedMonth.year,
          selectedMonth.month,
        );
        return and(
          baseWhere,
          gte(schema.briefs.createdAt, startUtc),
          lt(schema.briefs.createdAt, endUtc),
        )!;
      })()
    : baseWhere;

  const [{ total }] = (await db.execute(sql`
    SELECT count(*)::int AS total
    FROM briefs
    WHERE user_id = ${session.user.id}
    ${
      selectedMonth
        ? sql`AND created_at >= ${monthRangeUtc(selectedMonth.year, selectedMonth.month).startUtc.toISOString()}
              AND created_at <  ${monthRangeUtc(selectedMonth.year, selectedMonth.month).endUtc.toISOString()}`
        : sql``
    }
  `)) as unknown as Array<{ total: number }>;
  const totalPages = Math.max(1, Math.ceil(Number(total) / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);

  const userBriefs = await db
    .select({
      id: schema.briefs.id,
      topicTitle: schema.briefs.topicTitle,
      segment: schema.briefs.segment,
      tone: schema.briefs.tone,
      locale: schema.briefs.locale,
      isPlaceholder: schema.briefs.isPlaceholder,
      status: schema.briefs.status,
      createdAt: schema.briefs.createdAt,
    })
    .from(schema.briefs)
    .where(filterWhere)
    .orderBy(desc(schema.briefs.createdAt))
    .limit(PAGE_SIZE)
    .offset((safePage - 1) * PAGE_SIZE);

  return (
    <section className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
      {/* Brief generation is admin-only while the feature is still
          experimental. The proxy already gates non-admin access; this
          notice reminds the admins viewing the page that the surface
          isn't yet production-ready. */}
      <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-amber-700">
        <Sparkles className="h-3 w-3" />
        Experimental · Admin only
      </div>

      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">
            <ScrollText className="h-3.5 w-3.5" />
            {t("page_title_list")}
          </span>
          <h1 className="mt-3 text-balance text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            {t("page_title_list")}
          </h1>
          <p className="mt-2 text-pretty text-sm leading-relaxed text-slate-600">
            {t("list_subtitle")}
          </p>
        </div>
        <div className="hidden shrink-0 items-center gap-2 sm:inline-flex">
          <Link
            href="/briefs/public"
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            <Sparkles className="h-4 w-4 text-brand-600" />
            {t("list_public_link")}
          </Link>
          <Link
            href="/briefs/new"
            className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
          >
            <Plus className="h-4 w-4" />
            {t("list_create")}
          </Link>
        </div>
      </div>

      {monthsAvailable.length > 0 && (
        <MonthPickerPager
          baseHref="/briefs"
          monthsAvailable={monthsAvailable}
          selectedMonth={selectedMonth}
          page={safePage}
          totalPages={totalPages}
          locale={locale}
          labels={{
            monthLabel: t("filter_month_label"),
            allTime: t("filter_all_time"),
            pageOf: t("filter_page_of"),
            prev: t("filter_prev"),
            next: t("filter_next"),
          }}
        />
      )}

      {userBriefs.length === 0 ? (
        <EmptyState t={t} />
      ) : (
        <div className="mt-4 grid gap-3">
          {userBriefs.map((b) => (
            <BriefRow key={b.id} brief={b} t={t} locale={locale} />
          ))}
        </div>
      )}

      <Link
        href="/briefs/new"
        className="mt-6 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 sm:hidden"
      >
        <Plus className="h-4 w-4" />
        {t("list_create")}
      </Link>
    </section>
  );
}

function EmptyState({ t }: { t: Awaited<ReturnType<typeof getTranslations<"Briefs">>> }) {
  return (
    <div className="mt-10 flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600 ring-1 ring-brand-100">
        <Sparkles className="h-5 w-5" />
      </span>
      <h2 className="mt-4 text-balance text-lg font-semibold text-slate-900">
        {t("list_empty_title")}
      </h2>
      <p className="mt-1 max-w-sm text-pretty text-sm leading-relaxed text-slate-600">
        {t("list_empty_body")}
      </p>
      <Link
        href="/briefs/new"
        className="mt-5 inline-flex h-10 items-center gap-1.5 rounded-full bg-slate-900 px-5 text-sm font-semibold text-white shadow transition hover:bg-slate-800"
      >
        {t("list_create")}
        <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}

function BriefRow({
  brief,
  t,
  locale,
}: {
  brief: {
    id: string;
    topicTitle: string;
    segment: string;
    tone: string;
    locale: string;
    isPlaceholder: boolean;
    status: string;
    createdAt: Date;
  };
  t: Awaited<ReturnType<typeof getTranslations<"Briefs">>>;
  locale: string;
}) {
  const segmentLabel = t(`segment_${brief.segment}` as Parameters<typeof t>[0]);
  const toneLabel = t(`tone_${brief.tone}` as Parameters<typeof t>[0]);
  const localeLabel = t(`locale_${brief.locale}` as Parameters<typeof t>[0]);

  return (
    <Link
      href={`/briefs/${brief.id}`}
      className="group flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md"
    >
      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-emerald-500 text-white shadow-sm">
        <ScrollText className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold text-slate-900 sm:text-base">
            {brief.topicTitle}
          </p>
          {brief.isPlaceholder && process.env.NODE_ENV !== "production" && (
            <span className="inline-flex items-center rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700">
              placeholder
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-slate-500">
          <span className="font-medium text-slate-700">{segmentLabel}</span>
          <span className="text-slate-300"> · </span>
          {toneLabel}
          <span className="text-slate-300"> · </span>
          {localeLabel}
          <span className="text-slate-300"> · </span>
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
        </p>
      </div>
      <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-700" />
    </Link>
  );
}
