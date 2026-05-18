import { Trash2 } from "lucide-react";
import { desc, sql } from "drizzle-orm";

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
  formatUsd,
} from "../_ui";

export default async function CostsPage() {
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
    [{ apiUsdAll = 0 } = { apiUsdAll: 0 }],
    monthlyApi,
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
  ]);

  // Month covering "now"
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // Manual costs proportionally allocated to "this month" — for domain
  // rows where period spans 12 months we count 1/12 of the amount toward
  // the current month so the monthly total isn't lumpy.
  const manualThisMonthIdr = manual.reduce((total, row) => {
    const start = new Date(row.periodStart).getTime();
    const end = new Date(row.periodEnd).getTime();
    if (end < monthStart.getTime()) return total;
    const days = Math.max(1, (end - start) / 86_400_000);
    if (days <= 31) {
      // Treat short windows as a single-month charge.
      return total + row.amountIdr;
    }
    return total + row.amountIdr / Math.ceil(days / 30);
  }, 0);

  const apiThisMonthIdr = apiUsd30 * usdToIdr;
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
            monthly invoice below. Use the bill's amount in IDR, not USD.
          </li>
          <li>
            <strong>Domain</strong> — add each renewal as one row with
            period_start / period_end set to its 1-year window. We
            allocate 1/12 to each month for monthly-total math.
          </li>
        </ul>
        <p>
          The budget cap from PRD §13 is <code>IDR 1,000,000 / month</code>
          . The headroom tile shows how much of that you're using.
        </p>
      </HelpCallout>

      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile
          label="This month · total"
          value={formatIdr(totalThisMonthIdr / usdToIdr, usdToIdr)}
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
          value={`Rp ${manualThisMonthIdr.toLocaleString("id-ID")}`}
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
          value={`Rp ${donationsTotal.toLocaleString("id-ID")}`}
          hint={`${donationsCount} entries · manage in Donations`}
          accent="emerald"
        />
        <StatTile
          label="Spend · all-time"
          value={`Rp ${Math.round(totalSpendAllTimeIdr).toLocaleString("id-ID")}`}
          hint="API + manual (raw)"
        />
        <StatTile
          label="Net balance"
          value={`Rp ${Math.round(netBalanceIdr).toLocaleString("id-ID")}`}
          hint="donations − total spend"
          accent={netBalanceIdr >= 0 ? "emerald" : "rose"}
        />
      </div>

      <Card title="Add a manual cost entry">
        <form action={addManualCost} className="space-y-4">
          {/* Row 1 — what */}
          <div className="grid gap-3 sm:grid-cols-[200px_1fr_1fr]">
            <FormField label="Kind">
              <select
                name="kind"
                required
                className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
              >
                <option value="infra">Infra (monthly VPS)</option>
                <option value="domain">Domain (yearly)</option>
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

      <Card title={`Manual cost log (${manual.length})`}>
        {manual.length === 0 ? (
          <EmptyState
            title="No manual entries"
            hint="Enter your first VPS invoice above to start tracking total monthly spend."
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="py-2">Kind</th>
                <th className="py-2">Vendor</th>
                <th className="py-2">Period</th>
                <th className="py-2 text-right">Amount</th>
                <th className="py-2">Note</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {manual.map((m) => (
                <tr key={m.id} className="border-b border-slate-50 last:border-0">
                  <td className="py-2 text-xs font-semibold capitalize">
                    {m.kind}
                  </td>
                  <td className="py-2 text-xs text-slate-700">{m.vendor}</td>
                  <td className="py-2 text-xs text-slate-500">
                    {new Date(m.periodStart).toLocaleDateString()} →{" "}
                    {new Date(m.periodEnd).toLocaleDateString()}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    Rp {m.amountIdr.toLocaleString("id-ID")}
                  </td>
                  <td className="py-2 text-xs text-slate-500">
                    {m.note ?? "—"}
                  </td>
                  <td className="py-2 text-right">
                    <form action={deleteManualCost}>
                      <input type="hidden" name="id" value={m.id} />
                      <button
                        type="submit"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-700"
                        aria-label="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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
    </>
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
