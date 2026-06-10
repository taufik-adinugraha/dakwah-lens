import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { desc, sql } from "drizzle-orm";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Heart,
  Info,
  Scale,
} from "lucide-react";

import { auth } from "@/auth";
import { Link } from "@/i18n/navigation";
import { db, schema } from "@/db";
import { marketingSectionLink } from "@/lib/marketing-href";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/transparency">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Transparency" });
  return { title: t("page_title") };
}

const RECENT_LIMIT = 12;

export default async function TransparencyPage({
  params,
}: PageProps<"/[locale]/transparency">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [t, session] = await Promise.all([
    getTranslations("Transparency"),
    auth(),
  ]);
  const idLocale = locale === "id" ? "id-ID" : "en-US";
  const donateHref = marketingSectionLink(
    session?.user?.status === "approved",
    locale,
  )("#donate");

  // 2026-06-10: API usage is no longer counted in the public-facing
  // "total spend" + monthly breakdown — same scoping the admin Costs
  // page adopted. Only manual invoice entries (VPS, domain,
  // subscriptions) feed the totals here. The auto-logged usage_events
  // table is still the source of truth for ops on /admin/system/api-costs,
  // but the /transparency narrative is "donations vs invoiced
  // expenses" only — no USD↔IDR conversion needed at all on this page.
  const [
    [{ donationsTotal = 0 } = { donationsTotal: 0 }],
    [{ donationsCount = 0 } = { donationsCount: 0 }],
    recentDonations,
    manualAll,
    monthlyDonations,
    monthlyManual,
  ] = await Promise.all([
    db
      .select({
        donationsTotal: sql<number>`COALESCE(SUM(amount_idr), 0)::float`,
      })
      .from(schema.donations),
    db
      .select({ donationsCount: sql<number>`COUNT(*)::int` })
      .from(schema.donations),
    db
      .select()
      .from(schema.donations)
      .orderBy(desc(schema.donations.receivedAt))
      .limit(RECENT_LIMIT),
    db.select().from(schema.manualCosts),
    db.execute(sql`
      SELECT
        DATE_TRUNC('month', received_at)::date AS month,
        COALESCE(SUM(amount_idr), 0)::float AS idr,
        COUNT(*)::int AS n
      FROM donations
      GROUP BY month
      ORDER BY month DESC
      LIMIT 12
    `) as unknown as Promise<
      Array<{ month: string; idr: number; n: number }>
    >,
    db.execute(sql`
      SELECT
        DATE_TRUNC('month', period_start)::date AS month,
        COALESCE(SUM(amount_idr), 0)::float AS idr
      FROM manual_costs
      GROUP BY month
      ORDER BY month DESC
      LIMIT 12
    `) as unknown as Promise<Array<{ month: string; idr: number }>>,
  ]);

  const manualAllIdr = manualAll.reduce((s, r) => s + r.amountIdr, 0);
  const totalSpendIdr = manualAllIdr;
  const net = donationsTotal - totalSpendIdr;

  // Combine monthly streams into a single sorted list, newest first.
  // Outflow is manual invoices only (per the same scoping decision on
  // the totals above) — `monthlyApi` is no longer fetched.
  type DonationsRow = { month: string; idr: number; n: number };
  type ManualRow = { month: string; idr: number };
  const monthMap = new Map<
    string,
    { incomeIdr: number; outIdr: number; n: number }
  >();
  for (const r of asArray<DonationsRow>(monthlyDonations)) {
    const key = String(r.month);
    const existing = monthMap.get(key) ?? { incomeIdr: 0, outIdr: 0, n: 0 };
    existing.incomeIdr += Number(r.idr ?? 0);
    existing.n += Number(r.n ?? 0);
    monthMap.set(key, existing);
  }
  for (const r of asArray<ManualRow>(monthlyManual)) {
    const key = String(r.month);
    const existing = monthMap.get(key) ?? { incomeIdr: 0, outIdr: 0, n: 0 };
    existing.outIdr += Number(r.idr ?? 0);
    monthMap.set(key, existing);
  }
  const monthly = [...monthMap.entries()]
    .map(([month, v]) => ({ month, ...v }))
    .sort((a, b) => (a.month < b.month ? 1 : -1));

  return (
    <>
      <Hero t={t} />

      <section className="py-10 sm:py-14">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile
              label={t("stat_donations_label")}
              valueIdr={donationsTotal}
              hint={t("stat_donations_hint", { count: donationsCount })}
              tone="emerald"
              icon={ArrowDownCircle}
            />
            <StatTile
              label={t("stat_spend_label")}
              valueIdr={totalSpendIdr}
              hint={t("stat_spend_hint")}
              tone="slate"
              icon={ArrowUpCircle}
            />
            <StatTile
              label={t("stat_net_label")}
              valueIdr={net}
              hint={t("stat_net_hint")}
              tone={net >= 0 ? "emerald" : "rose"}
              icon={Scale}
            />
          </div>

          <PrepaidDisclaimer t={t} />
        </div>
      </section>

      <MonthlyTable rows={monthly} t={t} idLocale={idLocale} />

      <DonationsList donations={recentDonations} t={t} idLocale={idLocale} />

      <ClosingCTA t={t} donateHref={donateHref} />
    </>
  );
}

type T = Awaited<ReturnType<typeof getTranslations<"Transparency">>>;

function asArray<R>(v: unknown): R[] {
  return Array.isArray(v) ? (v as R[]) : [];
}

function Hero({ t }: { t: T }) {
  return (
    <section className="relative isolate overflow-hidden pt-12 pb-8 sm:pt-16 sm:pb-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      >
        <div className="absolute inset-0 grid-bg opacity-40" />
        <div className="absolute -top-24 left-1/2 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-emerald-200 opacity-40 blur-3xl" />
      </div>

      <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50/80 px-3 py-1 text-xs font-medium text-emerald-700 shadow-sm backdrop-blur">
          <Heart className="h-3.5 w-3.5" />
          {t("badge")}
        </span>
        <h1 className="mt-4 text-balance text-3xl font-bold leading-[1.1] tracking-tight text-slate-900 sm:text-5xl">
          {t("hero_title")}
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-pretty text-base leading-relaxed text-slate-600 sm:text-lg">
          {t("hero_subtitle")}
        </p>
      </div>
    </section>
  );
}

function StatTile({
  label,
  valueIdr,
  valueUsd,
  valueIdrFromUsd,
  hint,
  tone,
  icon: Icon,
}: {
  label: string;
  valueIdr?: number;
  valueUsd?: number;
  valueIdrFromUsd?: number;
  hint: string;
  tone: "emerald" | "rose" | "brand" | "slate";
  icon: typeof Heart;
}) {
  const styles = TILE_STYLES[tone];
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          {label}
        </p>
        <span
          className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ${styles.bg}`}
        >
          <Icon className={`h-3.5 w-3.5 ${styles.icon}`} />
        </span>
      </div>
      <p
        className={`mt-2 text-xl font-bold tabular-nums sm:text-2xl ${styles.value}`}
      >
        {valueIdr != null
          ? `Rp ${Math.round(valueIdr).toLocaleString("id-ID")}`
          : valueUsd != null
            ? `$${valueUsd.toFixed(2)}`
            : "—"}
      </p>
      {valueIdrFromUsd != null && (
        <p className="text-xs tabular-nums text-slate-500">
          ≈ Rp {Math.round(valueIdrFromUsd).toLocaleString("id-ID")}
        </p>
      )}
      <p className="mt-1 text-xs leading-relaxed text-slate-500">{hint}</p>
    </div>
  );
}

const TILE_STYLES = {
  emerald: {
    bg: "bg-emerald-50",
    icon: "text-emerald-700",
    value: "text-emerald-800",
  },
  rose: { bg: "bg-rose-50", icon: "text-rose-700", value: "text-rose-800" },
  brand: { bg: "bg-brand-50", icon: "text-brand-700", value: "text-slate-900" },
  slate: { bg: "bg-slate-100", icon: "text-slate-700", value: "text-slate-900" },
} as const;

function PrepaidDisclaimer({ t }: { t: T }) {
  return (
    <aside className="mt-3 flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 text-sm text-slate-700">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
      <div className="space-y-1 leading-relaxed">
        <p className="font-semibold text-slate-900">{t("prepaid_title")}</p>
        <p>{t("prepaid_body")}</p>
      </div>
    </aside>
  );
}

function MonthlyTable({
  rows,
  t,
  idLocale,
}: {
  rows: Array<{ month: string; incomeIdr: number; outIdr: number; n: number }>;
  t: T;
  idLocale: string;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="py-10 sm:py-14">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <h2 className="text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          {t("monthly_title")}
        </h2>
        <p className="mt-2 text-pretty text-sm leading-relaxed text-slate-600">
          {t("monthly_subtitle")}
        </p>

        <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3">{t("th_month")}</th>
                <th className="px-4 py-3 text-right">{t("th_donations")}</th>
                <th className="px-4 py-3 text-right">{t("th_spend")}</th>
                <th className="px-4 py-3 text-right">{t("th_net")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const net = r.incomeIdr - r.outIdr;
                return (
                  <tr
                    key={r.month}
                    className="border-b border-slate-50 last:border-0"
                  >
                    <td className="px-4 py-3 text-slate-800">
                      {new Date(r.month).toLocaleDateString(idLocale, {
                        year: "numeric",
                        month: "long",
                        timeZone: "Asia/Jakarta",
                      })}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-emerald-700">
                      Rp {Math.round(r.incomeIdr).toLocaleString("id-ID")}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                      Rp {Math.round(r.outIdr).toLocaleString("id-ID")}
                    </td>
                    <td
                      className={`px-4 py-3 text-right tabular-nums font-semibold ${
                        net >= 0 ? "text-emerald-800" : "text-rose-700"
                      }`}
                    >
                      Rp {Math.round(net).toLocaleString("id-ID")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function DonationsList({
  donations,
  t,
  idLocale,
}: {
  donations: Array<{
    id: string;
    receivedAt: Date;
    amountIdr: number;
    donor: string | null;
    isAnonymous: boolean;
    channel: string | null;
    note: string | null;
  }>;
  t: T;
  idLocale: string;
}) {
  return (
    <section className="border-t border-slate-100 bg-emerald-50/30 py-10 sm:py-14">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <h2 className="text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          {t("recent_donations_title")}
        </h2>
        <p className="mt-2 text-pretty text-sm leading-relaxed text-slate-600">
          {t("recent_donations_subtitle")}
        </p>

        <div className="mt-6 space-y-2">
          {donations.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-10 text-center">
              <p className="text-sm text-slate-600">{t("no_donations_yet")}</p>
            </div>
          ) : (
            donations.map((d) => (
              <article
                key={d.id}
                className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {d.isAnonymous || !d.donor
                      ? t("anonymous_donor")
                      : d.donor}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {new Date(d.receivedAt).toLocaleDateString(idLocale, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                      timeZone: "Asia/Jakarta",
                    })}
                    {d.channel ? (
                      <>
                        <span className="text-slate-300"> · </span>
                        <span className="capitalize">
                          {d.channel.replace(/_/g, " ")}
                        </span>
                      </>
                    ) : null}
                  </p>
                </div>
                <p className="shrink-0 text-sm font-semibold tabular-nums text-emerald-800">
                  Rp {d.amountIdr.toLocaleString("id-ID")}
                </p>
              </article>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function ClosingCTA({ t, donateHref }: { t: T; donateHref: string }) {
  return (
    <section className="py-12 sm:py-16">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <div className="relative isolate overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-600 via-emerald-700 to-brand-700 px-6 py-12 text-center text-white shadow-2xl sm:px-12">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10"
          >
            <div className="absolute -top-24 left-1/3 h-72 w-72 rounded-full bg-amber-300 opacity-25 blur-3xl" />
            <div className="absolute -bottom-24 right-0 h-72 w-72 rounded-full bg-emerald-300 opacity-30 blur-3xl" />
          </div>
          <h2 className="text-balance text-2xl font-bold tracking-tight sm:text-3xl">
            {t("closing_title")}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-pretty text-sm leading-relaxed text-white/85 sm:text-base">
            {t("closing_body")}
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <a
              href={donateHref}
              className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 text-sm font-semibold text-emerald-800 shadow-lg transition hover:bg-emerald-50"
            >
              {t("closing_cta_donate")}
            </a>
            <Link
              href="/about"
              className="inline-flex h-12 items-center gap-2 rounded-full border border-white/30 bg-white/5 px-6 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/10"
            >
              {t("closing_cta_about")}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
