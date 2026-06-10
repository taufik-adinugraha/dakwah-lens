import { Pencil, Trash2 } from "lucide-react";
import { and, asc, eq, sql, type SQL } from "drizzle-orm";

import { auth } from "@/auth";
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
  formatRelative,
} from "../_ui";
import { ConfirmForm } from "../_ConfirmForm";
import { EditQueryRowForm } from "./EditQueryRowForm";
import { QuerySearchForm } from "./QuerySearchForm";

// YouTube migrated to a curated channel whitelist on 2026-05-20 — see
// /admin/system/youtube-channels. The legacy `youtube` rows are still
// in `ingest_queries` (no beat fires them) so disabling shows them as
// "not currently used" rather than deleting history.
const PLATFORMS = ["x", "instagram", "tiktok"] as const;
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
type CategoryFilter = (typeof CATEGORIES)[number] | "all";

/** Build /admin/system/queries URL while preserving the cross-filters
 *  (toggling one filter shouldn't drop the others). `editId` opens the
 *  inline edit form for one row — also a URL param so it survives a
 *  full page reload after redirect-on-save. */
function buildHref(
  platform: PlatformFilter,
  category: CategoryFilter,
  search: string,
  editId?: string,
): string {
  const params = new URLSearchParams();
  if (platform !== "all") params.set("platform", platform);
  if (category !== "all") params.set("category", category);
  if (search) params.set("q", search);
  if (editId) params.set("edit", editId);
  const qs = params.toString();
  return `/admin/system/queries${qs ? `?${qs}` : ""}`;
}

export default async function QueriesPage({
  searchParams,
}: PageProps<"/[locale]/admin/system/queries">) {
  // Admin view is read-only — hide Add form, row delete, and toggle.
  const session = await auth();
  const isSuperadmin = session?.user?.role === "superadmin";

  const sp = await searchParams;
  const rawPlatform =
    typeof sp.platform === "string" ? sp.platform : undefined;
  const platformFilter: PlatformFilter =
    rawPlatform && (PLATFORMS as readonly string[]).includes(rawPlatform)
      ? (rawPlatform as PlatformFilter)
      : "all";
  const rawCategory =
    typeof sp.category === "string" ? sp.category : undefined;
  const categoryFilter: CategoryFilter =
    rawCategory && (CATEGORIES as readonly string[]).includes(rawCategory)
      ? (rawCategory as CategoryFilter)
      : "all";
  const search =
    typeof sp.q === "string" ? sp.q.trim().slice(0, 100) : "";
  // Inline-edit row pointer. Validated against the queries list below
  // before being honored, so a stale link or hand-typed UUID just falls
  // back to the read-only view.
  const editId = typeof sp.edit === "string" ? sp.edit.trim() : "";
  const returnTo = buildHref(platformFilter, categoryFilter, search);
  // Postgres ILIKE escapes — keep the user's % and _ as literals so
  // searching for "_" doesn't match every row.
  const escapedSearch = search.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");

  // Per-filter tallies — each pill's count tells the user "if I click
  // this pill, how many rows will I see?". So each filter's counts
  // apply the OTHER filter + the search:
  //   - Platform pill counts apply (search + active category)
  //   - Category pill counts apply (search + active platform)
  // The pill-row "All" sums tell the user how many rows there'd be if
  // they clicked All (relaxing that filter while keeping the other).
  const platformCounts = await db.execute(sql`
    SELECT
      platform,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE enabled)::int AS enabled
    FROM ingest_queries
    WHERE TRUE
      ${search ? sql`AND query ILIKE ${"%" + escapedSearch + "%"}` : sql``}
      ${categoryFilter !== "all" ? sql`AND category = ${categoryFilter}` : sql``}
    GROUP BY platform
  `);
  const perPlatform = new Map<string, { total: number; enabled: number }>();
  for (const p of PLATFORMS) perPlatform.set(p, { total: 0, enabled: 0 });
  for (const row of Array.isArray(platformCounts)
    ? (platformCounts as unknown as Array<{
        platform: string;
        total: number;
        enabled: number;
      }>)
    : []) {
    perPlatform.set(row.platform, { total: row.total, enabled: row.enabled });
  }

  const categoryCounts = await db.execute(sql`
    SELECT
      COALESCE(category, '__null__') AS category,
      COUNT(*)::int AS total
    FROM ingest_queries
    WHERE TRUE
      ${search ? sql`AND query ILIKE ${"%" + escapedSearch + "%"}` : sql``}
      ${platformFilter !== "all" ? sql`AND platform = ${platformFilter}` : sql``}
    GROUP BY category
  `);
  const perCategory = new Map<string, number>();
  for (const c of CATEGORIES) perCategory.set(c, 0);
  for (const row of Array.isArray(categoryCounts)
    ? (categoryCounts as unknown as Array<{ category: string; total: number }>)
    : []) {
    if (row.category === "__null__") continue;
    perCategory.set(row.category, row.total);
  }

  // The two "All" sums must come from their OWN axis (not the other's),
  // since each axis is filtered by the other already:
  //   - Platform "All" = sum of platform counts = matches given
  //     (search + active category)
  //   - Category "All" = sum of category counts = matches given
  //     (search + active platform)
  const platformAllCount = Array.from(perPlatform.values()).reduce(
    (s, p) => s + p.total,
    0,
  );
  const categoryAllCount = Array.from(perCategory.values()).reduce(
    (s, n) => s + n,
    0,
  );

  // Filtered list — combine platform + category + search. Sort by
  // category first (per request), then platform + query alphabetically
  // within each category. NULL categories fall to the end via
  // PostgreSQL's default ASC NULLS LAST.
  //
  // Note: legacy `youtube` rows are hidden here — YT switched to a
  // curated channel whitelist on 2026-05-20, so keyword queries for
  // that platform no longer drive any beat task. Rows stay in DB for
  // history but don't show up in the admin grid.
  const conditions: SQL[] = [sql`platform != 'youtube'`];
  if (platformFilter !== "all") {
    conditions.push(eq(schema.ingestQueries.platform, platformFilter));
  }
  if (categoryFilter !== "all") {
    conditions.push(eq(schema.ingestQueries.category, categoryFilter));
  }
  if (search) {
    conditions.push(sql`query ILIKE ${"%" + escapedSearch + "%"}`);
  }
  const queries = await db
    .select()
    .from(schema.ingestQueries)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(
      asc(schema.ingestQueries.category),
      asc(schema.ingestQueries.platform),
      asc(schema.ingestQueries.query),
    );

  return (
    <>
      <PageHeader
        title="Ingest queries"
        subtitle="Keywords the Celery rotating-ingest task cycles through. Mix religious + societal terms so the corpus reflects what the ummah actually needs to hear about — not only what people who already self-identify as religious are saying."
      />

      <HelpCallout>
        <p>
          The rotating-ingest Celery task scrapes <strong>every enabled
          query</strong> for the platforms it runs. Cadence per platform:
          YouTube + TikTok every day (00:00 / 00:20 WIB, both free actors), X
          three times a week (Mon/Wed/Fri 00:10), Instagram once a week (Mon
          00:30). TikTok also gets a biweekly Monday re-sweep (1st + 3rd
          Mondays of each month, 00:25) with the paid{" "}
          <code>clockworks/tiktok-scraper</code> actor for richer metadata —
          overwrites that day&apos;s free-actor payload. At the current pool
          size that is roughly{" "}
          <strong>~58 keywords × 18.5 runs/week ≈ 1,073 scrapes/week.</strong>
        </p>
        <p>
          The downstream Gemini relevance classifier filters every scraped
          post into the 9 PRD da&apos;wah categories before anything reaches the
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

      {isSuperadmin && (
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
                    defaultChecked
                    className="h-3.5 w-3.5 rounded border-slate-300"
                  />
                  <span className="capitalize">{p}</span>
                </label>
              ))}
            </div>
            <p className="mt-1 text-[10px] text-slate-500">
              YouTube migrated to the curated channel whitelist on
              2026-05-20 and isn&apos;t scraped via keywords anymore — see{" "}
              <code>/admin/system/youtube-channels</code>.
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
      )}

      <Card
        title={`Queries (${queries.filter((q) => q.enabled).length}/${queries.length} enabled)`}
      >
        {/* Platform + category filter pills, co-located with the search
            field below so the user sees all three filter axes together
            without scrolling. All three compose: each pill's href
            preserves the others, the search form preserves the active
            pills via hidden inputs. */}
        <div className="mb-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Platform
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <PlatformFilterPill
              label="All"
              count={platformAllCount}
              href={buildHref("all", categoryFilter, search)}
              active={platformFilter === "all"}
            />
            {PLATFORMS.map((p) => {
              const c = perPlatform.get(p) ?? { total: 0, enabled: 0 };
              return (
                <PlatformFilterPill
                  key={p}
                  label={p}
                  count={c.total}
                  href={buildHref(p, categoryFilter, search)}
                  active={platformFilter === p}
                />
              );
            })}
          </div>
        </div>
        <div className="mb-3">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Category
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <PlatformFilterPill
              label="All"
              count={categoryAllCount}
              href={buildHref(platformFilter, "all", search)}
              active={categoryFilter === "all"}
            />
            {CATEGORIES.map((c) => (
              <PlatformFilterPill
                key={c}
                label={c.replace(/_/g, " ")}
                count={perCategory.get(c) ?? 0}
                href={buildHref(platformFilter, c, search)}
                active={categoryFilter === c}
              />
            ))}
          </div>
        </div>
        <QuerySearchForm
          initialSearch={search}
          platformFilter={platformFilter}
          categoryFilter={categoryFilter}
          matchCount={queries.length}
        />

        {queries.length === 0 ? (
          <EmptyState
            title={search ? "No matches" : "No queries"}
            hint={
              search
                ? `No queries matching "${search}"${platformFilter !== "all" ? ` on ${platformFilter}` : ""}. Try a shorter term or clear the filter.`
                : "Add one above, or run uv run python -m api.scripts.seed_ingest_queries to seed defaults."
            }
          />
        ) : (
          <table className="w-full text-sm max-md:block max-md:overflow-x-auto">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="py-2">Platform</th>
                <th className="py-2">Query</th>
                <th className="py-2">Category</th>
                <th className="py-2">Last run</th>
                <th className="py-2 text-right">State</th>
                {isSuperadmin && <th className="py-2" />}
              </tr>
            </thead>
            <tbody>
              {queries.map((q) => {
                const isEditing = isSuperadmin && editId === q.id;
                if (isEditing) {
                  return (
                    <tr
                      key={q.id}
                      className="border-b border-slate-50 bg-amber-50/40 last:border-0"
                    >
                      <td
                        colSpan={isSuperadmin ? 6 : 5}
                        className="py-2"
                      >
                        <EditQueryRowForm
                          id={q.id}
                          platform={q.platform}
                          initialQuery={q.query}
                          initialCategory={q.category}
                          returnTo={returnTo}
                          categories={CATEGORIES}
                        />
                      </td>
                    </tr>
                  );
                }
                return (
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
                      {isSuperadmin ? (
                        <ToggleSwitch
                          id={q.id}
                          enabled={q.enabled}
                          label={q.query}
                        />
                      ) : (
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${
                            q.enabled
                              ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
                              : "bg-slate-100 text-slate-500 ring-slate-200"
                          }`}
                        >
                          {q.enabled ? "Enabled" : "Disabled"}
                        </span>
                      )}
                    </td>
                    {isSuperadmin && (
                      <td className="py-2 text-right">
                        <div className="inline-flex items-center gap-0.5">
                          <Link
                            href={buildHref(
                              platformFilter,
                              categoryFilter,
                              search,
                              q.id,
                            )}
                            scroll={false}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                            aria-label={`Edit ${q.query}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Link>
                          <ConfirmForm
                            action={deleteIngestQuery}
                            confirmMessage={`Delete the "${q.query}" query on ${q.platform}? This drops the rotation state — consider disabling instead if you might want it back.`}
                          >
                            <input type="hidden" name="id" value={q.id} />
                            <button
                              type="submit"
                              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-700"
                              aria-label={`Delete ${q.query}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </ConfirmForm>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
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
        to see how each query&apos;s recent runs performed.
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

function PlatformFilterPill({
  label,
  count,
  href,
  active,
}: {
  label: string;
  count: number;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "true" : undefined}
      className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-[11px] font-semibold uppercase tracking-wider transition ${
        active
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      <span>{label}</span>
      <span
        className={`tabular-nums ${
          active ? "text-white/70" : "text-slate-400"
        }`}
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
