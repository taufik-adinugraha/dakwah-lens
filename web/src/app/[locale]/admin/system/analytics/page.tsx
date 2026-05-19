import { sql } from "drizzle-orm";

import { db, schema } from "@/db";
import {
  Card,
  EmptyState,
  HelpCallout,
  PageHeader,
  StatTile,
} from "../_ui";

/**
 * Shared exclusion filter for analytics queries. We strip:
 *  - `/admin/*`  — superadmin's own navigation around this dashboard
 *  - `/api/*`    — health-check endpoints, auth callbacks
 *
 * Both are internal traffic that would otherwise inflate "page views" and
 * distort the top-pages ranking. The data is still in `page_views` (we
 * filter on read, not write) so we can revisit later if needed.
 */
const EXCLUDE_PATHS = sql`
  path NOT LIKE '/admin%'
  AND path NOT LIKE '/api%'
`;

export default async function AnalyticsPage() {
  const [
    [{ sessions7d = 0 } = { sessions7d: 0 }],
    [{ signedIn7d = 0 } = { signedIn7d: 0 }],
    [{ anon7d = 0 } = { anon7d: 0 }],
    topPaths,
    perDay,
    topReferers,
    // ── Brief generation metrics ──
    [
      { briefsTotal = 0, briefsReal = 0 } = { briefsTotal: 0, briefsReal: 0 },
    ],
    [
      {
        creatorsAll = 0,
        avgPerCreatorAll = 0,
      } = { creatorsAll: 0, avgPerCreatorAll: 0 },
    ],
    [
      {
        brief_success_7d: briefSuccess7d = 0,
        brief_errors_7d: briefErrors7d = 0,
      } = { brief_success_7d: 0, brief_errors_7d: 0 },
    ],
    briefsPerDay,
    topCreators,
  ] = await Promise.all([
    db
      .select({ sessions7d: sql<number>`COUNT(DISTINCT session_id)::int` })
      .from(schema.pageViews)
      .where(sql`occurred_at >= now() - interval '7 days' AND ${EXCLUDE_PATHS}`),
    db
      .select({ signedIn7d: sql<number>`COUNT(*)::int` })
      .from(schema.pageViews)
      .where(
        sql`occurred_at >= now() - interval '7 days' AND user_id IS NOT NULL AND ${EXCLUDE_PATHS}`,
      ),
    db
      .select({ anon7d: sql<number>`COUNT(*)::int` })
      .from(schema.pageViews)
      .where(
        sql`occurred_at >= now() - interval '7 days' AND user_id IS NULL AND ${EXCLUDE_PATHS}`,
      ),
    db.execute(sql`
      SELECT path, COUNT(*)::int AS hits,
             COUNT(DISTINCT session_id)::int AS uniques
      FROM page_views
      WHERE occurred_at >= now() - interval '7 days'
        AND path NOT LIKE '/admin%'
        AND path NOT LIKE '/api%'
      GROUP BY path
      ORDER BY hits DESC
      LIMIT 12
    `) as unknown as Promise<
      Array<{ path: string; hits: number; uniques: number }>
    >,
    db.execute(sql`
      SELECT
        DATE_TRUNC('day', occurred_at)::date AS day,
        COUNT(*)::int AS hits,
        COUNT(DISTINCT session_id)::int AS uniques
      FROM page_views
      WHERE occurred_at >= now() - interval '14 days'
        AND path NOT LIKE '/admin%'
        AND path NOT LIKE '/api%'
      GROUP BY day
      ORDER BY day
    `) as unknown as Promise<
      Array<{ day: string; hits: number; uniques: number }>
    >,
    db.execute(sql`
      SELECT referer, COUNT(*)::int AS hits
      FROM page_views
      WHERE referer IS NOT NULL
        AND referer NOT LIKE '%localhost%'
        AND occurred_at >= now() - interval '30 days'
        AND path NOT LIKE '/admin%'
        AND path NOT LIKE '/api%'
      GROUP BY referer
      ORDER BY hits DESC
      LIMIT 8
    `) as unknown as Promise<Array<{ referer: string; hits: number }>>,
    db
      .select({
        briefsTotal: sql<number>`COUNT(*)::int`,
        // Only count "real" briefs (those backed by an LLM call); the
        // placeholder rows are deterministic stubs from before instrumentation.
        briefsReal: sql<number>`COUNT(*) FILTER (WHERE is_placeholder = false)::int`,
      })
      .from(schema.briefs),
    db
      .select({
        creatorsAll: sql<number>`COUNT(DISTINCT user_id) FILTER (WHERE is_placeholder = false)::int`,
        avgPerCreatorAll: sql<number>`COALESCE(
          (COUNT(*) FILTER (WHERE is_placeholder = false))::float
          / NULLIF(COUNT(DISTINCT user_id) FILTER (WHERE is_placeholder = false), 0),
          0
        )`,
      })
      .from(schema.briefs),
    // 7-day brief-generation error rate. Successes come from `briefs`
    // (real ones only, exclude placeholders); failures come from
    // `brief_errors` which is populated by `generateBriefAction` on
    // every error path. Error rate = errors / (errors + successes).
    db.execute(sql`
      SELECT
        (
          SELECT COUNT(*)::int FROM briefs
          WHERE is_placeholder = false
            AND created_at >= now() - interval '7 days'
        ) AS brief_success_7d,
        (
          SELECT COUNT(*)::int FROM brief_errors
          WHERE created_at >= now() - interval '7 days'
        ) AS brief_errors_7d
    `) as unknown as Promise<
      Array<{ brief_success_7d: number; brief_errors_7d: number }>
    >,
    db.execute(sql`
      SELECT
        DATE_TRUNC('day', created_at)::date AS day,
        COUNT(*)::int AS briefs,
        COUNT(DISTINCT user_id)::int AS creators
      FROM briefs
      WHERE is_placeholder = false
        AND created_at >= now() - interval '14 days'
      GROUP BY day
      ORDER BY day
    `) as unknown as Promise<
      Array<{ day: string; briefs: number; creators: number }>
    >,
    db.execute(sql`
      SELECT
        u.id AS user_id,
        COALESCE(u.name, u.email) AS label,
        COUNT(b.id)::int AS briefs
      FROM briefs b
      JOIN users u ON u.id = b.user_id
      WHERE b.is_placeholder = false
        AND b.created_at >= now() - interval '30 days'
      GROUP BY u.id, u.name, u.email
      ORDER BY briefs DESC
      LIMIT 8
    `) as unknown as Promise<
      Array<{ user_id: string; label: string; briefs: number }>
    >,
  ]);

  return (
    <>
      <PageHeader
        title="Web analytics"
        subtitle="Page views, sessions, and brief-generation activity — excludes /admin so internal navigation doesn't skew the numbers."
      />

      <HelpCallout>
        <p>
          The <code>PageTracker</code> client component mounts in the
          locale layout and fires a <code>trackPageView</code> server
          action on every route change. The action sets an httpOnly
          <code> dlens_session</code> cookie (random UUID) for anonymous
          visitors so we can count <em>distinct sessions</em> without
          storing IPs. If the visitor is signed in, we additionally save
          their <code>user_id</code>.
        </p>
        <p>
          No third-party SDK runs in the browser — everything stays in
          your own Postgres. That&apos;s deliberate per UU PDP §27/2022
          (Indonesia data residency).
        </p>
        <p>
          <strong>Filter:</strong> page-view stats below exclude{" "}
          <code>/admin/*</code> and <code>/api/*</code> so superadmin
          navigation here doesn&apos;t inflate the user-traffic numbers. The
          raw rows are still in the <code>page_views</code> table.
        </p>
      </HelpCallout>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Sessions · 7d" value={sessions7d.toLocaleString()} accent="emerald" />
        <StatTile label="Signed-in · 7d" value={signedIn7d.toLocaleString()} accent="emerald" />
        <StatTile label="Anonymous · 7d" value={anon7d.toLocaleString()} />
        <StatTile
          label="Auth share · 7d"
          value={
            signedIn7d + anon7d > 0
              ? `${((signedIn7d / (signedIn7d + anon7d)) * 100).toFixed(0)}%`
              : "—"
          }
          hint="signed-in / total"
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card title="Daily traffic (last 14 days)">
          {Array.isArray(perDay) && perDay.length > 0 ? (
            <DailyBars rows={perDay} />
          ) : (
            <EmptyState title="No traffic yet" hint="Visit a few pages to populate this." />
          )}
        </Card>

        <Card title="Top referrers (30d)" hint="external only">
          {Array.isArray(topReferers) && topReferers.length > 0 ? (
            <ul className="space-y-1.5 text-sm">
              {topReferers.map((r) => (
                <li
                  key={r.referer}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="truncate text-slate-700">{r.referer}</span>
                  <span className="shrink-0 tabular-nums text-slate-500">
                    {r.hits}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-500">
              No external referrers in the last 30 days. (The Referer header
              is set by the browser when someone clicks a link from another
              site to land here.)
            </p>
          )}
        </Card>
      </div>

      <Card title="Top pages (7 days)" hint={`${topPaths.length} routes · /admin excluded`}>
        {Array.isArray(topPaths) && topPaths.length > 0 ? (
          <table className="w-full text-sm max-md:block max-md:overflow-x-auto">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="py-2">Path</th>
                <th className="py-2 text-right">Views</th>
                <th className="py-2 text-right">Uniques</th>
              </tr>
            </thead>
            <tbody>
              {topPaths.map((p) => (
                <tr key={p.path} className="border-b border-slate-50 last:border-0">
                  <td className="py-2 font-mono text-xs text-slate-800">
                    {p.path}
                  </td>
                  <td className="py-2 text-right tabular-nums text-slate-700">
                    {p.hits}
                  </td>
                  <td className="py-2 text-right tabular-nums text-slate-500">
                    {p.uniques}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState title="No views yet" hint="Browse the site once to see your first row." />
        )}
      </Card>

      {/* ─────────── Brief generation ─────────── */}
      <section className="mt-10">
        <h2 className="mb-3 text-base font-semibold tracking-tight text-slate-900 sm:text-lg">
          Brief generation
        </h2>
        <p className="mb-4 text-xs text-slate-500">
          Counts <strong>real</strong> briefs only (LLM-backed). Placeholder
          briefs from before the API instrumentation are excluded.
        </p>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Briefs · all-time"
            value={briefsReal.toLocaleString()}
            hint={
              briefsTotal !== briefsReal
                ? `+${briefsTotal - briefsReal} placeholder`
                : undefined
            }
          />
          <StatTile
            label="Total creators · all-time"
            value={creatorsAll.toLocaleString()}
          />
          <StatTile
            label="Avg briefs / creator"
            value={
              creatorsAll > 0
                ? Number(avgPerCreatorAll).toFixed(1)
                : "—"
            }
            hint="all-time, real only"
            accent="brand"
          />
          <StatTile
            label="Brief gen error rate · 7d"
            value={
              briefSuccess7d + briefErrors7d > 0
                ? `${((briefErrors7d / (briefSuccess7d + briefErrors7d)) * 100).toFixed(1)}%`
                : "—"
            }
            hint={
              briefSuccess7d + briefErrors7d > 0
                ? `${briefErrors7d} fail / ${briefSuccess7d + briefErrors7d} attempts`
                : "no attempts in last 7d"
            }
            accent={
              briefSuccess7d + briefErrors7d === 0
                ? undefined
                : briefErrors7d / (briefSuccess7d + briefErrors7d) >= 0.2
                  ? "rose"
                  : briefErrors7d / (briefSuccess7d + briefErrors7d) >= 0.05
                    ? "amber"
                    : "emerald"
            }
          />
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[2fr_1fr]">
          <Card title="Briefs per day (last 14 days)">
            {Array.isArray(briefsPerDay) && briefsPerDay.length > 0 ? (
              <BriefBars rows={briefsPerDay} />
            ) : (
              <EmptyState
                title="No briefs yet"
                hint="Once an approved user generates a real brief, the bars light up here."
              />
            )}
          </Card>

          <Card title="Top creators (30d)" hint="real briefs only">
            {Array.isArray(topCreators) && topCreators.length > 0 ? (
              <ul className="space-y-1.5 text-sm">
                {topCreators.map((c) => (
                  <li
                    key={c.user_id}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="truncate text-slate-700">{c.label}</span>
                    <span className="shrink-0 tabular-nums text-slate-500">
                      {c.briefs}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-500">
                No real briefs generated in the last 30 days.
              </p>
            )}
          </Card>
        </div>
      </section>
    </>
  );
}

function DailyBars({
  rows,
}: {
  rows: Array<{ day: string; hits: number; uniques: number }>;
}) {
  const max = Math.max(...rows.map((r) => r.hits), 1);
  return (
    <div className="flex h-40 items-end gap-1.5">
      {rows.map((r) => {
        const pct = (r.hits / max) * 100;
        const upct = (r.uniques / max) * 100;
        const day = new Date(r.day).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });
        return (
          <div
            key={r.day}
            className="group flex flex-1 flex-col items-center gap-1"
            title={`${day} · ${r.hits} views · ${r.uniques} unique`}
          >
            <div className="flex h-full w-full flex-col-reverse">
              <div
                className="w-full rounded-sm bg-brand-200"
                style={{ height: `${pct}%` }}
              />
              <div
                className="-mb-px w-full rounded-sm bg-brand-600 opacity-90"
                style={{ height: `${upct}%` }}
              />
            </div>
            <p className="text-[9px] text-slate-500">{day}</p>
          </div>
        );
      })}
    </div>
  );
}

function BriefBars({
  rows,
}: {
  rows: Array<{ day: string; briefs: number; creators: number }>;
}) {
  const max = Math.max(...rows.map((r) => r.briefs), 1);
  return (
    <div className="flex h-40 items-end gap-1.5">
      {rows.map((r) => {
        const pct = (r.briefs / max) * 100;
        const cpct = (r.creators / max) * 100;
        const day = new Date(r.day).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });
        return (
          <div
            key={r.day}
            className="group flex flex-1 flex-col items-center gap-1"
            title={`${day} · ${r.briefs} briefs · ${r.creators} unique creators`}
          >
            <div className="flex h-full w-full flex-col-reverse">
              <div
                className="w-full rounded-sm bg-emerald-200"
                style={{ height: `${pct}%` }}
              />
              <div
                className="-mb-px w-full rounded-sm bg-emerald-600 opacity-90"
                style={{ height: `${cpct}%` }}
              />
            </div>
            <p className="text-[9px] text-slate-500">{day}</p>
          </div>
        );
      })}
    </div>
  );
}
