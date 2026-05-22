import { desc, sql } from "drizzle-orm";

import { db, schema } from "@/db";
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

export default async function ApiCostsPage() {
  const usdToIdr = await getUsdToIdr();
  const capUsd = BUDGET_CAP_IDR / usdToIdr;
  const [
    perProvider,
    perOperation,
    recent,
    [{ total30 = 0 } = { total30: 0 }],
    [{ total7 = 0 } = { total7: 0 }],
    [{ total24 = 0 } = { total24: 0 }],
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
    db
      .select({ total24: sql<number>`COALESCE(SUM(cost_usd), 0)::float` })
      .from(schema.usageEvents)
      .where(sql`occurred_at >= now() - interval '24 hours'`),
  ]);

  const monthlyProjection = total7 * (30 / 7);

  return (
    <>
      <PageHeader
        title="API costs"
        subtitle="Every paid call is logged. Pricing is from public list rates — actual provider bills are authoritative."
      />

      <HelpCallout>
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
      </HelpCallout>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="24h"
          value={formatUsdCompact(total24)}
          hint={formatIdr(total24, usdToIdr)}
        />
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
        <StatTile
          label="Budget cap"
          value={formatIdr(capUsd, usdToIdr)}
          hint="IDR 1M/month (PRD §13)"
        />
        <StatTile
          label="Headroom"
          value={`${Math.max(0, 100 - (monthlyProjection / capUsd) * 100).toFixed(0)}%`}
          hint="under cap"
          accent={monthlyProjection > capUsd * 0.8 ? "rose" : "emerald"}
        />
      </div>

      <Card title="By provider (30d)">
        {Array.isArray(perProvider) && perProvider.length > 0 ? (
          <table className="w-full text-sm max-md:block max-md:overflow-x-auto">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="py-2">Provider</th>
                <th className="py-2 text-right">Calls</th>
                <th className="py-2 text-right">Tokens in</th>
                <th className="py-2 text-right">Tokens out</th>
                <th className="py-2 text-right">Cost USD</th>
                <th className="py-2 text-right">Cost IDR</th>
              </tr>
            </thead>
            <tbody>
              {perProvider.map((p) => (
                <tr key={p.provider} className="border-b border-slate-50 last:border-0">
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
                </tr>
              ))}
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
