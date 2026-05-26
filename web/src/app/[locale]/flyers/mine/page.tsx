import type { Metadata } from "next";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { Sparkles } from "lucide-react";

import { auth } from "@/auth";
import { MonthPickerPager } from "@/components/MonthPickerPager";
import { db, schema } from "@/db";
import { Link } from "@/i18n/navigation";
import {
  monthRangeUtc,
  parseMonthParam,
  parsePageParam,
} from "@/lib/month-filter";
import { getQuotaSnapshot } from "@/lib/user-flyer/quota";

import { FlyerGrid } from "../FlyerGrid";

const PAGE_SIZE = 18;

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/flyers/mine">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "UserFlyers" });
  return { title: t("page_title_mine") };
}

export default async function MyFlyersPage({
  params,
  searchParams,
}: PageProps<"/[locale]/flyers/mine">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/flyers/mine");
  }

  const t = await getTranslations("UserFlyers");
  const tBriefs = await getTranslations("Briefs");
  const sp = await searchParams;
  const selectedMonth = parseMonthParam(sp.month);
  const page = parsePageParam(sp.page);

  const userId = session.user.id;

  // Months with at least one flyer (drives the dropdown).
  const monthRows = (await db.execute(sql`
    SELECT DISTINCT
      EXTRACT(YEAR FROM (created_at AT TIME ZONE 'Asia/Jakarta'))::int AS year,
      EXTRACT(MONTH FROM (created_at AT TIME ZONE 'Asia/Jakarta'))::int AS month
    FROM user_flyers
    WHERE user_id = ${userId}
    ORDER BY year DESC, month DESC
  `)) as unknown as Array<{ year: number; month: number }>;
  const monthsAvailable = monthRows.map((r) => ({
    year: Number(r.year),
    month: Number(r.month),
  }));

  const baseWhere = eq(schema.userFlyers.userId, userId);
  const filterWhere = selectedMonth
    ? (() => {
        const { startUtc, endUtc } = monthRangeUtc(
          selectedMonth.year,
          selectedMonth.month,
        );
        return and(
          baseWhere,
          gte(schema.userFlyers.createdAt, startUtc),
          lt(schema.userFlyers.createdAt, endUtc),
        )!;
      })()
    : baseWhere;

  const [{ total }] = (await db.execute(sql`
    SELECT count(*)::int AS total
    FROM user_flyers
    WHERE user_id = ${userId}
    ${
      selectedMonth
        ? sql`AND created_at >= ${monthRangeUtc(selectedMonth.year, selectedMonth.month).startUtc.toISOString()}
              AND created_at <  ${monthRangeUtc(selectedMonth.year, selectedMonth.month).endUtc.toISOString()}`
        : sql``
    }
  `)) as unknown as Array<{ total: number }>;
  const totalPages = Math.max(1, Math.ceil(Number(total) / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);

  const [rows, quota] = await Promise.all([
    db
      .select({
        id: schema.userFlyers.id,
        headline: schema.userFlyers.headline,
        visibility: schema.userFlyers.visibility,
        createdAt: schema.userFlyers.createdAt,
      })
      .from(schema.userFlyers)
      .where(filterWhere)
      .orderBy(desc(schema.userFlyers.createdAt))
      .limit(PAGE_SIZE)
      .offset((safePage - 1) * PAGE_SIZE),
    getQuotaSnapshot(userId),
  ]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-12">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-balance text-2xl font-bold text-slate-900 sm:text-3xl">
            {t("page_title_mine")}
          </h1>
          <p className="mt-2 text-pretty text-sm leading-relaxed text-slate-600">
            {t("subtitle_mine")}
          </p>
        </div>
        <Link
          href="/flyers/new"
          className="inline-flex items-center gap-1.5 rounded-full bg-emerald-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-800"
        >
          <Sparkles className="h-4 w-4" />
          {t("cta_new_flyer")}
        </Link>
      </header>

      <p className="mb-6 inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
        <Sparkles className="h-3 w-3" />
        {t("quota_chip", {
          remaining: quota.remaining,
          limit: quota.limit,
        })}
      </p>

      {monthsAvailable.length > 0 && (
        <MonthPickerPager
          baseHref="/flyers/mine"
          monthsAvailable={monthsAvailable}
          selectedMonth={selectedMonth}
          page={safePage}
          totalPages={totalPages}
          locale={locale}
          labels={{
            monthLabel: tBriefs("filter_month_label"),
            allTime: tBriefs("filter_all_time"),
            pageOf: tBriefs("filter_page_of"),
            prev: tBriefs("filter_prev"),
            next: tBriefs("filter_next"),
          }}
        />
      )}

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
          <p className="text-sm font-semibold text-slate-700">
            {t("empty_mine_title")}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            {t("empty_mine_body")}
          </p>
        </div>
      ) : (
        <FlyerGrid
          flyers={rows.map((r) => ({
            id: r.id,
            headline: r.headline,
            visibility: r.visibility as "private" | "public",
            createdAt: r.createdAt.toISOString(),
          }))}
          showDelete
          labels={{
            visibilityBadgePublic: t("visibility_badge_public"),
            visibilityBadgePrivate: t("visibility_badge_private"),
            deleteButton: t("delete_button"),
            deleteConfirm: t("delete_confirm"),
            openLarge: t("result_open_large"),
            download: t("result_download"),
          }}
        />
      )}
    </div>
  );
}
