import { Trash2 } from "lucide-react";
import { asc, sql } from "drizzle-orm";

import { Link } from "@/i18n/navigation";
import { db, schema } from "@/db";
import {
  addIngestQuery,
  deleteIngestQuery,
  toggleIngestQuery,
} from "../actions";
import {
  Card,
  EmptyState,
  HelpCallout,
  PageHeader,
  StatTile,
  formatRelative,
} from "../_ui";

const PLATFORMS = ["x", "instagram", "tiktok", "youtube"] as const;
const CATEGORIES = [
  "religious",
  "family",
  "youth",
  "muamalah",
  "social_justice",
  "education",
  "health",
  "cultural",
  "current_events",
] as const;
type PlatformFilter = (typeof PLATFORMS)[number] | "all";

export default async function QueriesPage({
  searchParams,
}: PageProps<"/[locale]/admin/system/queries">) {
  const sp = await searchParams;
  const rawFilter = typeof sp.platform === "string" ? sp.platform : undefined;
  const platformFilter: PlatformFilter =
    rawFilter && (PLATFORMS as readonly string[]).includes(rawFilter)
      ? (rawFilter as PlatformFilter)
      : "all";

  // Per-platform tallies for the filter pills.
  const counts = await db.execute(sql`
    SELECT
      platform,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE enabled)::int AS enabled
    FROM ingest_queries
    GROUP BY platform
    ORDER BY platform
  `);
  const perPlatform = new Map<string, { total: number; enabled: number }>();
  for (const row of Array.isArray(counts)
    ? (counts as unknown as Array<{
        platform: string;
        total: number;
        enabled: number;
      }>)
    : []) {
    perPlatform.set(row.platform, { total: row.total, enabled: row.enabled });
  }
  const overall = {
    total: Array.from(perPlatform.values()).reduce(
      (s, p) => s + p.total,
      0,
    ),
    enabled: Array.from(perPlatform.values()).reduce(
      (s, p) => s + p.enabled,
      0,
    ),
  };

  // Filtered list.
  const queries =
    platformFilter === "all"
      ? await db
          .select()
          .from(schema.ingestQueries)
          .orderBy(asc(schema.ingestQueries.platform), asc(schema.ingestQueries.query))
      : await db
          .select()
          .from(schema.ingestQueries)
          .where(sql`platform = ${platformFilter}`)
          .orderBy(asc(schema.ingestQueries.query));

  return (
    <>
      <PageHeader
        title="Ingest queries"
        subtitle="Keywords the Celery rotating-ingest task cycles through. Mix religious + societal terms so the corpus reflects what the ummah actually needs to hear about — not only what people who already self-identify as religious are saying."
      />

      <HelpCallout>
        <p>
          The rotating-ingest Celery task picks the <strong>least-recently-used
          enabled</strong> query per platform on each beat tick. So if you have
          30 queries enabled for X, each one runs roughly once a month at the
          current daily cadence.
        </p>
        <p>
          The downstream Gemini relevance classifier filters every scraped
          post into the 9 PRD da'wah categories before anything reaches the
          dashboard. Broad societal queries (<code>pinjol</code>,{" "}
          <code>burnout</code>) surface real ummah concerns, then the
          classifier picks the religiously-relevant subset.
        </p>
        <p>
          <strong>Disable rather than delete</strong> when in doubt — disabled
          queries preserve their <code>last_run_at</code> rotation state in
          case you want to re-enable later.
        </p>
      </HelpCallout>

      <div className="grid gap-3 sm:grid-cols-4">
        {PLATFORMS.map((p) => {
          const c = perPlatform.get(p) ?? { total: 0, enabled: 0 };
          return (
            <StatTile
              key={p}
              label={p.toUpperCase()}
              value={String(c.enabled)}
              hint={`${c.total} total · ${c.enabled} enabled`}
              accent={c.enabled === 0 ? "rose" : "emerald"}
            />
          );
        })}
      </div>

      <Card title="Add a new query">
        <form action={addIngestQuery} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
            <FormField
              label="Query"
              hint="The exact text to search — no hashtag prefix, scrapers add/strip per platform"
            >
              <input
                name="query"
                placeholder="e.g. pinjol"
                required
                maxLength={160}
                className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm placeholder:text-slate-400"
              />
            </FormField>
            <FormField label="Category" hint="Optional, for grouping">
              <select
                name="category"
                defaultValue=""
                className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
              >
                <option value="">(none)</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
          <fieldset>
            <legend className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
              Apply to platforms
            </legend>
            <div className="mt-2 flex flex-wrap gap-3">
              {PLATFORMS.map((p) => (
                <label
                  key={p}
                  className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-slate-700"
                >
                  <input
                    type="checkbox"
                    name="platforms"
                    value={p}
                    defaultChecked={p !== "youtube"}
                    className="h-3.5 w-3.5 rounded border-slate-300"
                  />
                  <span className="capitalize">{p}</span>
                </label>
              ))}
            </div>
            <p className="mt-1 text-[10px] text-slate-500">
              YouTube is unchecked by default — its content tends to be
              channel-driven, so it benefits from a narrower keyword set.
            </p>
          </fieldset>
          <div className="flex justify-end">
            <button
              type="submit"
              className="inline-flex h-9 items-center justify-center rounded-lg bg-slate-900 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
            >
              Add query
            </button>
          </div>
        </form>
      </Card>

      <Card title={`Queries (${overall.enabled}/${overall.total} enabled)`}>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Show
          </span>
          <FilterPill
            href="/admin/system/queries"
            active={platformFilter === "all"}
            label="All"
            count={overall.total}
          />
          {PLATFORMS.map((p) => (
            <FilterPill
              key={p}
              href={`/admin/system/queries?platform=${p}`}
              active={platformFilter === p}
              label={p}
              count={perPlatform.get(p)?.total ?? 0}
            />
          ))}
        </div>

        {queries.length === 0 ? (
          <EmptyState
            title="No queries"
            hint="Add one above, or run uv run python -m api.scripts.seed_ingest_queries to seed defaults."
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="py-2">Platform</th>
                <th className="py-2">Query</th>
                <th className="py-2">Category</th>
                <th className="py-2">Last run</th>
                <th className="py-2 text-right">State</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {queries.map((q) => (
                <tr key={q.id} className="border-b border-slate-50 last:border-0">
                  <td className="py-2 text-xs font-semibold capitalize text-slate-800">
                    {q.platform}
                  </td>
                  <td className="py-2 font-mono text-xs text-slate-700">
                    {q.query}
                  </td>
                  <td className="py-2 text-xs">
                    {q.category ? (
                      <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                        {q.category.replace(/_/g, " ")}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="py-2 text-xs text-slate-500">
                    {q.lastRunAt ? formatRelative(q.lastRunAt) : "never"}
                  </td>
                  <td className="py-2 text-right">
                    <ToggleSwitch
                      id={q.id}
                      enabled={q.enabled}
                      label={q.query}
                    />
                  </td>
                  <td className="py-2 text-right">
                    <form action={deleteIngestQuery}>
                      <input type="hidden" name="id" value={q.id} />
                      <button
                        type="submit"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-700"
                        aria-label={`Delete ${q.query}`}
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

      <p className="text-center text-xs text-slate-500">
        Cross-link to{" "}
        <Link
          href="/admin/system/pipeline"
          className="font-semibold text-brand-700 underline-offset-2 hover:underline"
        >
          pipeline health
        </Link>{" "}
        to see how each query's recent runs performed.
      </p>
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

function FilterPill({
  href,
  active,
  label,
  count,
}: {
  href: string;
  active: boolean;
  label: string;
  count: number;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-[11px] font-semibold transition ${
        active
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
      }`}
    >
      <span className="capitalize">{label}</span>
      <span
        className={`tabular-nums ${active ? "text-white/80" : "text-slate-400"}`}
      >
        {count}
      </span>
    </Link>
  );
}

function ToggleSwitch({
  id,
  enabled,
  label,
}: {
  id: string;
  enabled: boolean;
  label: string;
}) {
  return (
    <form action={toggleIngestQuery} className="inline-flex">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="enabled" value={String(enabled)} />
      <button
        type="submit"
        aria-pressed={enabled}
        aria-label={`${enabled ? "Disable" : "Enable"} ${label}`}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
          enabled ? "bg-emerald-500" : "bg-slate-200"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
            enabled ? "translate-x-[18px]" : "translate-x-0.5"
          }`}
        />
      </button>
    </form>
  );
}
