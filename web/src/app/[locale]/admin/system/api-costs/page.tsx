import { desc, sql } from "drizzle-orm";

import { db, schema } from "@/db";
import { Link } from "@/i18n/navigation";
import { getUsdToIdr } from "@/lib/settings";
import {
  Card,
  EmptyState,
  HelpCallout,
  PageHeader,
  StatTile,
  formatIdr,
  formatRelative,
  formatUsd,
  formatUsdCompact,
} from "../_ui";

const BUDGET_CAP_IDR = 1_000_000;

/**
 * Provider display names. DB stores lowercase keys (matches code call
 * sites + PRICES table); humans want the canonical brand casing.
 * Anything not in this map falls through to `capitalize` (CSS), which
 * is fine for `gemini`, `anthropic`, `apify`, `resend`.
 */
const PROVIDER_DISPLAY: Record<string, string> = {
  openai: "OpenAI",
  rss: "RSS",
};

function formatProvider(provider: string): string {
  return PROVIDER_DISPLAY[provider] ?? provider;
}

type ReconcileRow = {
  covers_provider: string;
  amount_idr: number;
  period_start: string;
  period_end: string;
  vendor: string;
  note: string | null;
  updated_at: string;
};

// `usage_events` rows land via background workers (every Celery
// task that records usage), and `manual_costs` is mutated via
// operator-driven server actions that DO revalidate — but the
// background path doesn't. Force-dynamic keeps the totals tile +
// per-provider table fresh on every load.
export const dynamic = "force-dynamic";

export default async function ApiCostsPage() {
  const usdToIdr = await getUsdToIdr();
  const capUsd = BUDGET_CAP_IDR / usdToIdr;
  const [
    perProvider,
    perOperation,
    recent,
    [{ total30 = 0 } = { total30: 0 }],
    [{ total7 = 0 } = { total7: 0 }],
    reconciles,
  ] = await Promise.all([
    db.execute(sql`
      SELECT
        provider,
        COUNT(*)::int AS calls,
        COALESCE(SUM(cost_usd), 0)::float AS cost_usd,
        COALESCE(SUM(tokens_in), 0)::int AS tokens_in,
        COALESCE(SUM(tokens_out), 0)::int AS tokens_out,
        COALESCE(SUM(units), 0)::int AS units
      FROM usage_events
      WHERE occurred_at >= now() - interval '30 days'
      GROUP BY provider
      ORDER BY cost_usd DESC
    `) as unknown as Promise<
      Array<{
        provider: string;
        calls: number;
        cost_usd: number;
        tokens_in: number;
        tokens_out: number;
        units: number;
      }>
    >,
    db.execute(sql`
      SELECT
        provider, operation, model,
        COUNT(*)::int AS calls,
        COALESCE(SUM(cost_usd), 0)::float AS cost_usd
      FROM usage_events
      WHERE occurred_at >= now() - interval '30 days'
      GROUP BY provider, operation, model
      ORDER BY cost_usd DESC
      LIMIT 20
    `) as unknown as Promise<
      Array<{
        provider: string;
        operation: string;
        model: string | null;
        calls: number;
        cost_usd: number;
      }>
    >,
    db
      .select()
      .from(schema.usageEvents)
      .orderBy(desc(schema.usageEvents.occurredAt))
      .limit(30),
    db
      .select({ total30: sql<number>`COALESCE(SUM(cost_usd), 0)::float` })
      .from(schema.usageEvents)
      .where(sql`occurred_at >= now() - interval '30 days'`),
    db
      .select({ total7: sql<number>`COALESCE(SUM(cost_usd), 0)::float` })
      .from(schema.usageEvents)
      .where(sql`occurred_at >= now() - interval '7 days'`),
    // Latest manual reconcile per provider. Operators paste authoritative
    // dashboard totals (AI Studio for Gemini, Apify billing, etc.) into
    // `manual_costs` to close the gap between what our token-counting
    // estimated and what the provider actually billed. The per-provider
    // table below uses these to show side-by-side "tracked vs reconciled".
    db.execute(sql`
      SELECT DISTINCT ON (covers_provider)
        covers_provider, amount_idr, period_start, period_end, vendor, note, updated_at
      FROM manual_costs
      WHERE covers_provider IS NOT NULL
      ORDER BY covers_provider, updated_at DESC
    `) as unknown as Promise<ReconcileRow[]>,
  ]);

  const reconcileByProvider = new Map<string, ReconcileRow>(
    (Array.isArray(reconciles) ? reconciles : []).map((r) => [
      r.covers_provider,
      r,
    ]),
  );

  const monthlyProjection = total7 * (30 / 7);

  return (
    <>
      <PageHeader
        title="API costs"
        subtitle="Every paid call is logged. Pricing is from public list rates — actual provider bills are authoritative."
      />

      <HelpCallout>
        <p>
          <strong>What this page shows:</strong> only the spend the
          system itself <em>recorded</em> at request time —{" "}
          <code>record_usage(...)</code> writes a row into{" "}
          <code>usage_events</code> for each paid call from the Python
          (<code>services/usage.py</code>) and TS (
          <code>lib/usage-log.ts</code>) sides. Some real spend never
          shows up here: dev-env experiments, ad-hoc shell calls, manual
          probes, and a few legacy code paths that predate{" "}
          <code>record_usage</code>. The authoritative monthly total
          lives on the <Link
            href="/admin/system/costs"
            className="font-medium text-brand-700 underline-offset-2 hover:underline"
          >
            Total cost
          </Link>{" "}
          page, where operators paste provider-dashboard totals (AI
          Studio, Apify billing, etc.) as reconciliation rows. The
          Reconciled column below shows the gap.
        </p>
        <p>
          On the Python side, <code>services/usage.py</code> exposes{" "}
          <code>record_usage(...)</code>. Every call site
          (<code>relevance.py</code>, <code>apify.py</code>,{" "}
          <code>youtube.py</code>, <code>rss.py</code>) calls it after a
          successful request. On the TS side, <code>lib/usage-log.ts</code>{" "}
          mirrors the same logic — both write into{" "}
          <code>usage_events</code>. Costs are computed from the prices
          baked into those two files. <strong>Update them</strong> when
          providers change pricing, and back-fill recent rows with a
          one-shot SQL update.
        </p>
        <p>
          <strong>Providers tracked:</strong> OpenAI (Qur&apos;an embeddings),
          Gemini (relevance classifier + brief synthesis), Anthropic (brief
          synthesis fallback), Apify (X / Instagram / TikTok), YouTube Data
          API (quota units), RSS (free — volume tracking only), and{" "}
          Resend (transactional email — verification + password reset).
          Resend&apos;s free tier covers 3,000 emails/month, so cost rows show
          $0 even as the unit counter ticks up.
        </p>
        <p>
          <strong>Tracked vs Reconciled:</strong> the IDR column is what our
          token-counting estimated; the Reconciled column is the authoritative
          provider-dashboard total operators paste into{" "}
          <code>/admin/system/costs</code>. Gemini typically under-counts
          because thinking tokens, Pro pricing nuances, and missed{" "}
          <code>record_usage(...)</code> call sites all leak into the bill but
          not the row. The delta tells you how big that gap is.
        </p>
      </HelpCallout>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="7d"
          value={formatUsdCompact(total7)}
          hint={formatIdr(total7, usdToIdr)}
          accent="brand"
        />
        <StatTile
          label="30d"
          value={formatUsdCompact(total30)}
          hint={formatIdr(total30, usdToIdr)}
        />
        <StatTile
          label="Projected · monthly"
          value={formatUsdCompact(monthlyProjection)}
          hint={`${formatIdr(monthlyProjection, usdToIdr)} · from last 7d`}
          accent={monthlyProjection > capUsd * 0.8 ? "amber" : "emerald"}
        />
      </div>

      <Card
        title="By provider (30d)"
        hint="Reconciled = authoritative dashboard total from /admin/system/costs"
      >
        {Array.isArray(perProvider) && perProvider.length > 0 ? (
          <table className="w-full text-sm max-md:block max-md:overflow-x-auto">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="py-2">Provider</th>
                <th className="py-2 text-right">Calls</th>
                <th className="py-2 text-right">Tokens in</th>
                <th className="py-2 text-right">Tokens out</th>
                <th className="py-2 text-right">Tracked (USD)</th>
                <th className="py-2 text-right">Tracked (IDR)</th>
                <th className="py-2 text-right">Reconciled (IDR)</th>
              </tr>
            </thead>
            <tbody>
              {perProvider.map((p) => {
                const rec = reconcileByProvider.get(p.provider);
                const trackedIdr = p.cost_usd * usdToIdr;
                const delta = rec ? rec.amount_idr - trackedIdr : 0;
                return (
                  <tr
                    key={p.provider}
                    className="border-b border-slate-50 last:border-0"
                  >
                    <td className="py-2 font-semibold capitalize text-slate-900">
                      {formatProvider(p.provider)}
                    </td>
                    <td className="py-2 text-right tabular-nums">{p.calls}</td>
                    <td className="py-2 text-right tabular-nums text-slate-600">
                      {p.tokens_in.toLocaleString()}
                    </td>
                    <td className="py-2 text-right tabular-nums text-slate-600">
                      {p.tokens_out.toLocaleString()}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {formatUsd(p.cost_usd)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-slate-500">
                      {formatIdr(p.cost_usd, usdToIdr)}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {rec ? (
                        <div className="flex flex-col items-end">
                          <span
                            className="font-medium text-slate-900"
                            title={rec.note ?? undefined}
                          >
                            Rp{" "}
                            {Math.round(rec.amount_idr).toLocaleString("id-ID")}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {delta > 0
                              ? `+Rp ${Math.round(delta).toLocaleString("id-ID")} vs tracked`
                              : "in sync"}{" "}
                            · synced {formatRelative(rec.updated_at)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <EmptyState
            title="No usage logged yet"
            hint="Generate a brief or run an ingest task to see your first event."
          />
        )}
      </Card>

      <Card title="Top operations (30d)">
        {Array.isArray(perOperation) && perOperation.length > 0 ? (
          <table className="w-full text-sm max-md:block max-md:overflow-x-auto">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="py-2">Provider · model · op</th>
                <th className="py-2 text-right">Calls</th>
                <th className="py-2 text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {perOperation.map((r, i) => (
                <tr key={i} className="border-b border-slate-50 last:border-0">
                  <td className="py-2 text-slate-800">
                    <span className="font-semibold capitalize">
                      {formatProvider(r.provider)}
                    </span>{" "}
                    · <span className="font-mono text-xs">{r.model ?? "—"}</span> ·{" "}
                    <span className="text-xs text-slate-500">{r.operation}</span>
                  </td>
                  <td className="py-2 text-right tabular-nums">{r.calls}</td>
                  <td className="py-2 text-right tabular-nums">
                    {formatUsd(r.cost_usd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Card>

      <Card title="Recent calls" hint={`${recent.length} of latest`}>
        {recent.length > 0 ? (
          <ul className="divide-y divide-slate-50 text-xs">
            {recent.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-3 py-1.5 font-mono"
              >
                <span className="w-20 text-[10px] text-slate-400">
                  {formatRelative(r.occurredAt)}
                </span>
                <span className="w-16 capitalize text-slate-700">
                  {formatProvider(r.provider)}
                </span>
                <span className="flex-1 truncate text-slate-600">
                  {r.model ?? r.operation}
                </span>
                <span className="w-20 text-right tabular-nums text-slate-700">
                  {formatUsd(r.costUsd)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
    </>
  );
}
