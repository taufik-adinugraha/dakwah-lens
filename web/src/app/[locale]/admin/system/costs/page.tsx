import { Pencil, Trash2, X } from "lucide-react";
import { desc, sql } from "drizzle-orm";

import { auth } from "@/auth";
import { db, schema } from "@/db";
import { Link } from "@/i18n/navigation";
import { getUsdToIdr } from "@/lib/settings";
import { deleteManualCost } from "../actions";
import { ManualCostForm } from "./ManualCostForm";
import {
  Card,
  EmptyState,
  HelpCallout,
  PageHeader,
  StatTile,
  formatIdr,
  formatRupiah,
  formatUsd,
  formatUsdCompact,
} from "../_ui";
import { ConfirmForm } from "../_ConfirmForm";
import { KNOWN_PROVIDERS, providerLabel } from "@/lib/cost-providers";

// The Apify-reconcile Celery task writes to `usage_events` and
// `manual_costs` without firing revalidatePath, so this page can
// drift if cached. Force-dynamic keeps the donations vs spend
// ledger fresh on every load.
export const dynamic = "force-dynamic";

export default async function CostsPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  // Layout gates access; we read the role to decide whether write
  // controls (add + delete) render. Admins still see the listings.
  const session = await auth();
  const isSuperadmin = session?.user?.role === "superadmin";
  const sp = await searchParams;
  const editId = typeof sp.edit === "string" ? sp.edit : null;

  const [
    usdToIdr,
    manual,
    [
      {
        donationsTotal = 0,
        donationsCount = 0,
      } = { donationsTotal: 0, donationsCount: 0 },
    ],
    [{ apiUsd30 = 0 } = { apiUsd30: 0 }],
    [{ usd: apiThisMonthUsd = 0 } = { usd: 0 }],
    [{ apiUsdAll = 0 } = { apiUsdAll: 0 }],
    monthlyApi,
    perProviderUsage,
  ] = await Promise.all([
    getUsdToIdr(),
    db
      .select()
      .from(schema.manualCosts)
      .orderBy(desc(schema.manualCosts.periodStart)),
    db
      .select({
        donationsTotal: sql<number>`COALESCE(SUM(amount_idr), 0)::float`,
        donationsCount: sql<number>`COUNT(*)::int`,
      })
      .from(schema.donations),
    db
      .select({ apiUsd30: sql<number>`COALESCE(SUM(cost_usd), 0)::float` })
      .from(schema.usageEvents)
      .where(sql`occurred_at >= now() - interval '30 days'`),
    // "This month" calendar window — used by the Total tile so the
    // window matches the calendar-month manual-cost allocation.
    // Excludes providers covered by an active subscription manual
    // cost so we don't double-count (subscription = cash outflow;
    // usage_events for that provider = informational only).
    db.execute(sql`
      SELECT COALESCE(SUM(cost_usd), 0)::float AS usd
      FROM usage_events
      WHERE occurred_at >= date_trunc('month', now())
        AND provider NOT IN (
          SELECT DISTINCT covers_provider
          FROM manual_costs
          WHERE covers_provider IS NOT NULL
            AND period_start <= now()
            AND period_end >= date_trunc('month', now())
        )
    `) as unknown as Promise<Array<{ usd: number }>>,
    db
      .select({ apiUsdAll: sql<number>`COALESCE(SUM(cost_usd), 0)::float` })
      .from(schema.usageEvents),
    db.execute(sql`
      SELECT
        DATE_TRUNC('month', occurred_at)::date AS month,
        COALESCE(SUM(cost_usd), 0)::float AS usd
      FROM usage_events
      GROUP BY month
      ORDER BY month DESC
      LIMIT 12
    `) as unknown as Promise<Array<{ month: string; usd: number }>>,
    // Per-provider usage this calendar month. Feeds the per-provider
    // rollup section so the admin can see usage vs subscription side
    // by side — even for providers whose usage is excluded from the
    // top-level "API spend" total.
    db.execute(sql`
      SELECT provider, COALESCE(SUM(cost_usd), 0)::float AS usd
      FROM usage_events
      WHERE occurred_at >= date_trunc('month', now())
      GROUP BY provider
    `) as unknown as Promise<Array<{ provider: string; usd: number }>>,
  ]);

  // Month covering "now"
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // Manual costs proportionally allocated to "this month" — for domain
  // rows where period spans 12 months we count 1/12 of the amount toward
  // the current month so the monthly total isn't lumpy.
  //
  // Use 30.44 (mean days/month) instead of 30 so a 365-day period
  // correctly resolves to ~12 buckets (365/30.44 ≈ 12) rather than 13.
  // `round` rather than `ceil` so a 200-day period (~6.6 months)
  // allocates across 7 buckets, not 7 (no change in that case) but a
  // 365-day period across 12, not 13. `max(1, …)` covers the 32-31 day
  // edge where a misconfigured row might otherwise yield 0.
  function allocatedToThisMonth(row: {
    periodStart: Date;
    periodEnd: Date;
    amountIdr: number;
  }): number {
    const start = new Date(row.periodStart).getTime();
    const end = new Date(row.periodEnd).getTime();
    if (end < monthStart.getTime()) return 0;
    const days = Math.max(1, (end - start) / 86_400_000);
    if (days <= 31) return row.amountIdr;
    const months = Math.max(1, Math.round(days / 30.44));
    return row.amountIdr / months;
  }
  const manualThisMonthIdr = manual.reduce(
    (total, row) => total + allocatedToThisMonth(row),
    0,
  );

  // If `?edit=<id>` points to an existing row, swap the top form into
  // edit mode for that row. Stale IDs (row deleted since the link was
  // copied) fall back to add mode silently.
  const editRow = editId ? manual.find((r) => r.id === editId) ?? null : null;

  // Per-provider subscription allocated to this month — feeds the
  // rollup table at the bottom of the page. Group by covers_provider,
  // sum allocated amounts. Providers with no subscription rows aren't
  // in this map; the rollup falls back to $0 subscription for them.
  const subscriptionUsdByProvider = new Map<string, number>();
  for (const row of manual) {
    if (!row.coversProvider) continue;
    const allocated = allocatedToThisMonth(row);
    if (allocated <= 0) continue;
    const usd = allocated / usdToIdr;
    subscriptionUsdByProvider.set(
      row.coversProvider,
      (subscriptionUsdByProvider.get(row.coversProvider) ?? 0) + usd,
    );
  }
  const usageUsdByProvider = new Map<string, number>();
  for (const row of Array.isArray(perProviderUsage)
    ? (perProviderUsage as unknown as Array<{
        provider: string;
        usd: number;
      }>)
    : []) {
    usageUsdByProvider.set(row.provider, row.usd);
  }

  // 2026-06-10 change: "Total cost" tracks ONLY the manually-recorded
  // invoice entries (VPS, domain, subscriptions). API usage is shown
  // separately on this page + on /admin/system/api-costs, but is not
  // rolled into the total — the auto-logged usage_events are advisory
  // signal, while the invoice rows are the authoritative "money out
  // the door" record the operator has to fund. apiThisMonthIdr /
  // apiAllTimeIdr are kept here only because the api-spend tiles
  // below still surface them as a separate signal.
  const apiThisMonthIdr = apiThisMonthUsd * usdToIdr;
  const totalThisMonthIdr = manualThisMonthIdr;
  const apiAllTimeIdr = apiUsdAll * usdToIdr;
  const manualAllTimeIdr = manual.reduce((s, r) => s + r.amountIdr, 0);
  const totalSpendAllTimeIdr = manualAllTimeIdr;
  const netBalanceIdr = donationsTotal - totalSpendAllTimeIdr;
  const capIdr = 1_000_000;

  return (
    <>
      <PageHeader
        title="Total cost"
        subtitle="Manual invoice entries (infrastructure, domain, subscriptions) in IDR. API usage is tracked separately under /admin/system/api-costs."
      />

      <HelpCallout>
        <ul className="ml-4 list-disc space-y-1">
          <li>
            <strong>API costs</strong> come from <code>usage_events</code>{" "}
            (auto-logged by every call site). USD → IDR uses a fixed{" "}
            <code>{usdToIdr.toLocaleString("id-ID")}</code> rate (editable
            at <code>/admin/system</code>).
          </li>
          <li>
            <strong>Infrastructure</strong> (IDCloudHost VPS) — enter your
            monthly invoice below. Use the bill&apos;s amount in IDR, not USD.
          </li>
          <li>
            <strong>Domain</strong> — add each renewal as one row with
            period_start / period_end set to its 1-year window. We
            allocate 1/12 to each month for monthly-total math.
          </li>
        </ul>
        <p>
          The budget cap from PRD §13 is <code>IDR 1,000,000 / month</code>
          . The headroom tile shows how much of that you&apos;re using.
        </p>
      </HelpCallout>

      <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile
          label="This month · total"
          value={formatRupiah(totalThisMonthIdr)}
          hint="infra + domain + subscriptions (manual only)"
          accent={totalThisMonthIdr > capIdr ? "rose" : "emerald"}
        />
        <StatTile
          label="API spend · 30d"
          value={formatUsdCompact(apiUsd30)}
          hint={formatIdr(apiUsd30, usdToIdr)}
        />
        <StatTile
          label="Manual · this month"
          value={formatRupiah(manualThisMonthIdr)}
          hint="infra + domain allocated"
          accent="brand"
        />
        <StatTile
          label="Cap usage"
          value={`${Math.round((totalThisMonthIdr / capIdr) * 100)}%`}
          hint={`of IDR ${(capIdr / 1_000_000).toFixed(1)}M cap`}
          accent={totalThisMonthIdr > capIdr * 0.8 ? "rose" : "emerald"}
        />
      </div>

      {/* All-time treasury — income vs spend net balance */}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Donations · all-time"
          value={formatRupiah(donationsTotal)}
          hint={`${donationsCount} entries · manage in Donations`}
          accent="emerald"
        />
        <StatTile
          label="Spend · all-time"
          value={formatRupiah(totalSpendAllTimeIdr)}
          hint="manual invoice entries only"
        />
        <StatTile
          label="Net balance"
          value={formatRupiah(netBalanceIdr)}
          hint="donations − total spend"
          accent={netBalanceIdr >= 0 ? "emerald" : "rose"}
        />
      </div>

      {isSuperadmin && (
      <Card
        title={editRow ? `Edit cost entry — ${editRow.vendor}` : "Add a manual cost entry"}
        hint={
          editRow
            ? "Editing an existing row. Upload a new invoice file to replace the current one; leave it empty to keep the existing file."
            : undefined
        }
      >
        {/* `key` remounts the client form when switching between add
            mode and editing different rows, so `useActionState` resets
            and every `defaultValue` re-applies (uncontrolled inputs
            only honor defaultValue on first mount). */}
        <ManualCostForm
          key={editRow?.id ?? "add"}
          editRow={
            editRow
              ? {
                  id: editRow.id,
                  kind: editRow.kind,
                  vendor: editRow.vendor,
                  amountIdr: editRow.amountIdr,
                  periodStart: toDateInput(editRow.periodStart),
                  periodEnd: toDateInput(editRow.periodEnd),
                  note: editRow.note,
                  coversProvider: editRow.coversProvider,
                  attachmentPath: editRow.attachmentPath,
                  attachmentFilename: editRow.attachmentFilename,
                }
              : null
          }
        />
      </Card>
      )}

      <Card title={`Manual cost log (${manual.length})`}>
        {manual.length === 0 ? (
          <EmptyState
            title="No manual entries"
            hint="Enter your first VPS invoice above to start tracking total monthly spend."
          />
        ) : (
          <table className="w-full text-sm max-md:block max-md:overflow-x-auto">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2 first:pl-0">Kind</th>
                <th className="px-3 py-2">Vendor</th>
                <th className="px-3 py-2">Period</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2">Note</th>
                <th className="px-3 py-2">Invoice</th>
                {isSuperadmin && <th className="px-3 py-2 last:pr-0" />}
              </tr>
            </thead>
            <tbody>
              {manual.map((m) => (
                <tr key={m.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-3 py-2 text-xs font-semibold first:pl-0">
                    {kindLabel(m.kind)}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-700">{m.vendor}</td>
                  <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">
                    {new Date(m.periodStart).toLocaleDateString()} →{" "}
                    {new Date(m.periodEnd).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                    {formatRupiah(m.amountIdr)}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {m.note ?? "—"}
                    {m.coversProvider && (
                      <span className="ml-2 inline-flex items-center rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-emerald-700 ring-1 ring-emerald-100">
                        covers {providerLabel(m.coversProvider)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {m.attachmentPath ? (
                      <a
                        href={`/api/admin/attachments/manual-cost/${m.id}`}
                        className="font-medium text-brand-700 underline-offset-2 hover:underline"
                      >
                        {m.attachmentFilename ?? "download"}
                      </a>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  {isSuperadmin && (
                    <td className="px-3 py-2 text-right last:pr-0 whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        {/* Edit — sets ?edit=<id> on the page so the
                            top form swaps into edit mode for this row.
                            The fragment scrolls the form into view if
                            the table is long. */}
                        {editId === m.id ? (
                          <Link
                            href="/admin/system/costs"
                            className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-amber-50 text-amber-700"
                            aria-label="Cancel edit"
                            title="Currently editing"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Link>
                        ) : (
                          <Link
                            href={{
                              pathname: "/admin/system/costs",
                              query: { edit: m.id },
                              hash: "manual-cost-form",
                            }}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-amber-50 hover:text-amber-700"
                            aria-label="Edit"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Link>
                        )}
                        <ConfirmForm
                          action={deleteManualCost}
                          confirmMessage={`Delete the ${m.vendor} entry (${formatRupiah(m.amountIdr)})? This also unlinks any attached invoice.`}
                        >
                          <input type="hidden" name="id" value={m.id} />
                          <button
                            type="submit"
                            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-700"
                            aria-label="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </ConfirmForm>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card
        title="Per-provider rollup · this month"
        hint="cash = subscription + overage (or pay-as-you-go if no subscription)"
      >
        <ProviderRollup
          providers={KNOWN_PROVIDERS}
          subscriptionUsdByProvider={subscriptionUsdByProvider}
          usageUsdByProvider={usageUsdByProvider}
          usdToIdr={usdToIdr}
        />
      </Card>

      <Card title="API spend by month" hint={`all-time ${formatUsd(apiUsdAll)}`}>
        {Array.isArray(monthlyApi) && monthlyApi.length > 0 ? (
          <ul className="space-y-1.5 text-sm">
            {monthlyApi.map((m) => (
              <li key={m.month} className="flex items-center justify-between">
                <span className="text-slate-700">
                  {new Date(m.month).toLocaleDateString("en-US", {
                    month: "long",
                    year: "numeric",
                  })}
                </span>
                <span className="flex gap-3 tabular-nums">
                  <span className="text-slate-900">{formatUsd(m.usd)}</span>
                  <span className="text-slate-500">{formatIdr(m.usd, usdToIdr)}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-500">No API events recorded yet.</p>
        )}
      </Card>
      </div>
    </>
  );
}

function ProviderRollup({
  providers,
  subscriptionUsdByProvider,
  usageUsdByProvider,
  usdToIdr,
}: {
  providers: readonly string[];
  subscriptionUsdByProvider: Map<string, number>;
  usageUsdByProvider: Map<string, number>;
  usdToIdr: number;
}) {
  // Build a row per provider, plus surface any extra providers we
  // see in usage_events that aren't in the canonical list (defensive
  // — keeps the rollup honest if a new provider is logged before
  // we update KNOWN_PROVIDERS).
  const allProviders = new Set<string>([
    ...providers,
    ...subscriptionUsdByProvider.keys(),
    ...usageUsdByProvider.keys(),
  ]);
  const rows = Array.from(allProviders)
    .map((p) => {
      const subscription = subscriptionUsdByProvider.get(p) ?? 0;
      const usage = usageUsdByProvider.get(p) ?? 0;
      const overage = Math.max(0, usage - subscription);
      // Cash this month: when a subscription covers it, you pay
      // the subscription (sunk) + any overage. When no subscription
      // is recorded, pay-as-you-go = usage itself.
      const cash = subscription > 0 ? subscription + overage : usage;
      return { provider: p, subscription, usage, overage, cash };
    })
    // Hide rows that have neither subscription nor usage — keeps the
    // table tight.
    .filter((r) => r.subscription > 0 || r.usage > 0)
    .sort((a, b) => b.cash - a.cash);

  if (rows.length === 0) {
    return (
      <p className="text-xs text-slate-500">
        No usage logged yet for any API provider this month.
      </p>
    );
  }

  const totalCash = rows.reduce((s, r) => s + r.cash, 0);

  return (
    <table className="w-full text-sm max-md:block max-md:overflow-x-auto">
      <thead>
        <tr className="border-b border-slate-100 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          <th className="py-2">Provider</th>
          <th className="py-2 text-right">Subscription</th>
          <th className="py-2 text-right">Usage</th>
          <th className="py-2 text-right">Overage</th>
          <th className="py-2 text-right">Cash</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.provider} className="border-b border-slate-50 last:border-0">
            <td className="py-2 text-xs font-semibold capitalize text-slate-800">
              {providerLabel(r.provider)}
            </td>
            <td className="py-2 text-right text-xs tabular-nums">
              {r.subscription > 0 ? (
                <>
                  <span className="text-slate-900">{formatUsd(r.subscription)}</span>{" "}
                  <span className="text-slate-400">
                    · {formatIdr(r.subscription, usdToIdr)}
                  </span>
                </>
              ) : (
                <span className="text-slate-400">—</span>
              )}
            </td>
            <td className="py-2 text-right text-xs tabular-nums text-slate-700">
              {formatUsd(r.usage)}
            </td>
            <td className="py-2 text-right text-xs tabular-nums">
              {r.overage > 0 ? (
                <span className="font-semibold text-rose-700">
                  {formatUsd(r.overage)}
                </span>
              ) : (
                <span className="text-slate-400">—</span>
              )}
            </td>
            <td className="py-2 text-right text-xs tabular-nums font-semibold text-slate-900">
              {formatUsd(r.cash)}
            </td>
          </tr>
        ))}
        <tr>
          <td className="pt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Total
          </td>
          <td colSpan={3} />
          <td className="pt-3 text-right text-sm tabular-nums font-bold text-slate-900">
            {formatUsd(totalCash)}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

// Human-readable label for the manual_costs.kind text column. Mirrors
// the order of the dropdown so the log table reads consistent with how
// rows get added. Unknown kinds fall back to a capitalize-first render
// so older data (or future kinds added before this map updates) still
// looks reasonable.
const KIND_LABELS: Record<string, string> = {
  infra: "Infra (monthly)",
  infra_topup: "Infra (Top Up)",
  domain: "Domain (yearly)",
  api_topup: "API (Top Up)",
  api_usage: "API Usage",
  other: "Other",
};

/**
 * Format a Date (or ISO string from drizzle) into the `YYYY-MM-DD`
 * shape that `<input type="date">` requires. Manual-cost dates are
 * day-precision; using toISOString().slice(0, 10) is fine — no TZ
 * sensitivity because the value gets `new Date(start)` back at parse
 * time which interprets day-only strings as UTC midnight, identical
 * to how addManualCost originally wrote it.
 */
function toDateInput(d: Date | string): string {
  const date = d instanceof Date ? d : new Date(d);
  return date.toISOString().slice(0, 10);
}


function kindLabel(kind: string): string {
  return (
    KIND_LABELS[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1).replace(/_/g, " ")
  );
}
