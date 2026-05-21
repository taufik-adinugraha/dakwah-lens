import { Trash2 } from "lucide-react";
import { desc, sql } from "drizzle-orm";

import { auth } from "@/auth";
import { db, schema } from "@/db";
import { getUsdToIdr } from "@/lib/settings";
import { addManualCost, deleteManualCost } from "../actions";
import {
  Card,
  EmptyState,
  HelpCallout,
  PageHeader,
  StatTile,
  formatIdr,
  formatRupiah,
  formatUsd,
} from "../_ui";
import { ConfirmForm } from "../_ConfirmForm";
import { KNOWN_PROVIDERS, providerLabel } from "@/lib/cost-providers";

export default async function CostsPage() {
  // Layout gates access; we read the role to decide whether write
  // controls (add + delete) render. Admins still see the listings.
  const session = await auth();
  const isSuperadmin = session?.user?.role === "superadmin";

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

  // Use the calendar-month API spend (not the rolling 30-day figure)
  // so this number lines up with the manual allocation above.
  const apiThisMonthIdr = apiThisMonthUsd * usdToIdr;
  const totalThisMonthIdr = manualThisMonthIdr + apiThisMonthIdr;
  const apiAllTimeIdr = apiUsdAll * usdToIdr;
  const manualAllTimeIdr = manual.reduce((s, r) => s + r.amountIdr, 0);
  const totalSpendAllTimeIdr = apiAllTimeIdr + manualAllTimeIdr;
  const netBalanceIdr = donationsTotal - totalSpendAllTimeIdr;
  const capIdr = 1_000_000;

  return (
    <>
      <PageHeader
        title="Total cost"
        subtitle="API spend (auto) + infrastructure & domain (manual) → unified monthly view in IDR."
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
          hint="API + infra + domain (allocated)"
          accent={totalThisMonthIdr > capIdr ? "rose" : "emerald"}
        />
        <StatTile
          label="API spend · 30d"
          value={formatUsd(apiUsd30)}
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
          hint="API + manual (raw)"
        />
        <StatTile
          label="Net balance"
          value={formatRupiah(netBalanceIdr)}
          hint="donations − total spend"
          accent={netBalanceIdr >= 0 ? "emerald" : "rose"}
        />
      </div>

      {isSuperadmin && (
      <Card title="Add a manual cost entry">
        <form
          action={addManualCost}
          className="space-y-4"
          encType="multipart/form-data"
        >
          {/* Row 1 — what */}
          <div className="grid gap-3 sm:grid-cols-[200px_1fr_1fr]">
            <FormField label="Kind">
              <select
                name="kind"
                required
                className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
              >
                <option value="infra">Infra (monthly VPS)</option>
                <option value="infra_topup">Infra (Top Up)</option>
                <option value="domain">Domain (yearly)</option>
                <option value="api_topup">API (Top Up)</option>
                <option value="api_usage">API Usage</option>
                <option value="other">Other</option>
              </select>
            </FormField>
            <FormField label="Vendor">
              <input
                name="vendor"
                placeholder="IDCloudHost, Niagahoster…"
                required
                maxLength={64}
                className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm placeholder:text-slate-400"
              />
            </FormField>
            <FormField label="Amount (IDR)">
              <input
                name="amount_idr"
                type="number"
                min="0"
                step="1"
                placeholder="e.g. 150000"
                required
                className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm placeholder:text-slate-400"
              />
            </FormField>
          </div>

          {/* Row 2 — when */}
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Period start">
              <input
                name="period_start"
                type="date"
                required
                className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm"
              />
            </FormField>
            <FormField label="Period end">
              <input
                name="period_end"
                type="date"
                required
                className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm"
              />
            </FormField>
          </div>

          {/* Note — full width */}
          <FormField label="Note" hint="Optional · invoice number, plan tier, etc.">
            <input
              name="note"
              placeholder="Invoice #INV-2026-0042"
              maxLength={200}
              className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm placeholder:text-slate-400"
            />
          </FormField>

          {/* Subscription mapping — when this entry covers an API
              provider on a flat-rate plan, pick it here so the cost
              totals don't double-count the per-call usage. */}
          <FormField
            label="Covers API provider"
            hint="Optional · only when this is a flat-rate subscription (e.g. Apify Starter $29/mo). Per-call usage for the selected provider will be excluded from the monthly API-cost sum to avoid double-counting."
          >
            <select
              name="covers_provider"
              defaultValue=""
              className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
            >
              <option value="">— (none, pure infra / domain)</option>
              {KNOWN_PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {providerLabel(p)}
                </option>
              ))}
            </select>
          </FormField>

          {/* Optional invoice attachment */}
          <FormField
            label="Invoice file"
            hint="Optional · PDF / JPG / PNG / WebP · max 5 MB"
          >
            <input
              name="attachment"
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-700 hover:file:bg-slate-200"
            />
          </FormField>

          {/* Submit — right-aligned, prominent */}
          <div className="flex justify-end pt-1">
            <button
              type="submit"
              className="inline-flex h-9 items-center justify-center rounded-lg bg-slate-900 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
            >
              Save entry
            </button>
          </div>
        </form>
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
                    <td className="px-3 py-2 text-right last:pr-0">
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

function kindLabel(kind: string): string {
  return (
    KIND_LABELS[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1).replace(/_/g, " ")
  );
}

function FormField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
        {label}
        {hint && (
          <span className="ml-2 text-[10px] font-normal normal-case tracking-normal text-slate-400">
            {hint}
          </span>
        )}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
