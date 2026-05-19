import { desc, sql } from "drizzle-orm";

import { db, schema } from "@/db";
import {
  Card,
  EmptyState,
  HelpCallout,
  PageHeader,
  StatTile,
  formatRelative,
} from "../_ui";

/**
 * The Celery beat schedule. Rendered alongside live `ingest_runs` rows so
 * you can see "this is what was *supposed* to fire" next to "this is what
 * actually ran." Source of truth is `workers/celery_app.py`.
 */
const BEAT_SCHEDULE = [
  { name: "ingest-mainstream", task: "run_ingest", platform: "mainstream", cron: "every 2 hours", query: "(all RSS)" },
  { name: "ingest-youtube", task: "rotating_ingest", platform: "youtube", cron: "00:00 WIB daily", query: "(all enabled)" },
  { name: "ingest-x-mon", task: "rotating_ingest", platform: "x", cron: "Mon 00:10 WIB", query: "(all enabled)" },
  { name: "ingest-x-wed", task: "rotating_ingest", platform: "x", cron: "Wed 00:10 WIB", query: "(all enabled)" },
  { name: "ingest-x-fri", task: "rotating_ingest", platform: "x", cron: "Fri 00:10 WIB", query: "(all enabled)" },
  { name: "ingest-tiktok", task: "rotating_ingest", platform: "tiktok", cron: "00:20 WIB daily", query: "(all enabled, free actor)" },
  { name: "ingest-tiktok-paid", task: "rotating_ingest", platform: "tiktok", cron: "1st + 3rd Mon 00:25 WIB", query: "(all enabled, paid actor)" },
  { name: "ingest-instagram", task: "rotating_ingest", platform: "instagram", cron: "Mon 00:30 WIB", query: "(all enabled)" },
  { name: "trending-ingest", task: "trending_ingest", platform: "x + tiktok", cron: "12:00 WIB daily", query: "(trending overlay)" },
  { name: "recluster-topics", task: "recluster_all", platform: "all", cron: "08:00 WIB daily", query: "—" },
  { name: "snapshot-system", task: "snapshot_system", platform: "host", cron: "every 60s", query: "—" },
] as const;

export default async function PipelinePage() {
  const [recent, perPlatform, latestPerPlatform] = await Promise.all([
    db
      .select()
      .from(schema.ingestRuns)
      .orderBy(desc(schema.ingestRuns.startedAt))
      .limit(40),
    db.execute(sql`
      SELECT
        COALESCE(platform, '—') AS platform,
        COUNT(*) FILTER (WHERE status = 'success')::int AS ok,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS fail,
        COUNT(*) FILTER (WHERE status = 'running')::int AS running,
        COALESCE(SUM(items_stored), 0)::int AS posts
      FROM ingest_runs
      WHERE started_at >= now() - interval '7 days'
      GROUP BY platform
      ORDER BY ok DESC
    `) as unknown as Promise<
      Array<{
        platform: string;
        ok: number;
        fail: number;
        running: number;
        posts: number;
      }>
    >,
    db.execute(sql`
      SELECT DISTINCT ON (platform)
        platform, status, started_at, finished_at, items_stored, error
      FROM ingest_runs
      WHERE platform IS NOT NULL
      ORDER BY platform, started_at DESC
    `) as unknown as Promise<
      Array<{
        platform: string;
        status: string;
        started_at: string;
        finished_at: string | null;
        items_stored: number | null;
        error: string | null;
      }>
    >,
  ]);

  return (
    <>
      <PageHeader
        title="Pipeline health"
        subtitle="Schedule + the actual run-by-run history of every ingest + clustering task."
      />

      <HelpCallout>
        <p>
          Two layers:
        </p>
        <ul className="ml-4 list-disc">
          <li>
            <strong>Scheduler</strong> — Celery beat, defined in{" "}
            <code>api/src/api/workers/celery_app.py</code>. Edit that
            file&apos;s <code>beat_schedule</code> dict to change cadence.
          </li>
          <li>
            <strong>Tracker</strong> — every task wraps itself in{" "}
            <code>start_run</code> / <code>finish_run</code> (
            <code>services/ingest_runs.py</code>), writing one row per
            invocation into <code>ingest_runs</code>.
          </li>
        </ul>
        <p>
          To start the workers:
        </p>
        <pre className="overflow-x-auto rounded-md bg-slate-900/95 px-3 py-2 font-mono text-[11px] text-emerald-300">
          uv run celery -A api.workers.celery_app worker -B --loglevel=info
        </pre>
      </HelpCallout>

      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile
          label="Runs · 7d"
          value={String(
            Array.isArray(perPlatform)
              ? perPlatform.reduce((s, p) => s + p.ok + p.fail, 0)
              : 0,
          )}
        />
        <StatTile
          label="Success · 7d"
          value={String(
            Array.isArray(perPlatform)
              ? perPlatform.reduce((s, p) => s + p.ok, 0)
              : 0,
          )}
          accent="emerald"
        />
        <StatTile
          label="Failures · 7d"
          value={String(
            Array.isArray(perPlatform)
              ? perPlatform.reduce((s, p) => s + p.fail, 0)
              : 0,
          )}
          accent="rose"
        />
        <StatTile
          label="Posts ingested · 7d"
          value={String(
            Array.isArray(perPlatform)
              ? perPlatform.reduce((s, p) => s + p.posts, 0)
              : 0,
          )}
          accent="brand"
        />
      </div>

      <Card title="Scheduled tasks (Celery beat)">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              <th className="py-2">Schedule name</th>
              <th className="py-2">Platform</th>
              <th className="py-2">Cron</th>
              <th className="py-2">Query</th>
              <th className="py-2">Latest run</th>
            </tr>
          </thead>
          <tbody>
            {BEAT_SCHEDULE.map((s) => {
              const latest = Array.isArray(latestPerPlatform)
                ? latestPerPlatform.find((l) => l.platform === s.platform)
                : null;
              return (
                <tr key={s.name} className="border-b border-slate-50 last:border-0">
                  <td className="py-2 font-mono text-xs text-slate-800">
                    {s.name}
                  </td>
                  <td className="py-2 text-xs capitalize">{s.platform}</td>
                  <td className="py-2 text-xs text-slate-600">{s.cron}</td>
                  <td className="py-2 text-xs text-slate-500">{s.query}</td>
                  <td className="py-2 text-xs">
                    {latest ? (
                      <span
                        className={
                          latest.status === "success"
                            ? "text-emerald-700"
                            : latest.status === "failed"
                              ? "text-rose-700"
                              : "text-slate-500"
                        }
                      >
                        {latest.status} · {formatRelative(latest.started_at)}
                      </span>
                    ) : (
                      <span className="text-slate-400">no runs yet</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Card title="Per-platform health (7d)">
        {Array.isArray(perPlatform) && perPlatform.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="py-2">Platform</th>
                <th className="py-2 text-right">OK</th>
                <th className="py-2 text-right">Failed</th>
                <th className="py-2 text-right">Running</th>
                <th className="py-2 text-right">Posts stored</th>
                <th className="py-2 text-right">Success rate</th>
              </tr>
            </thead>
            <tbody>
              {perPlatform.map((p) => {
                const total = p.ok + p.fail;
                const rate = total > 0 ? (p.ok / total) * 100 : 0;
                return (
                  <tr key={p.platform} className="border-b border-slate-50 last:border-0">
                    <td className="py-2 font-semibold capitalize">
                      {p.platform}
                    </td>
                    <td className="py-2 text-right tabular-nums text-emerald-700">
                      {p.ok}
                    </td>
                    <td className="py-2 text-right tabular-nums text-rose-700">
                      {p.fail}
                    </td>
                    <td className="py-2 text-right tabular-nums text-slate-500">
                      {p.running}
                    </td>
                    <td className="py-2 text-right tabular-nums">{p.posts}</td>
                    <td className="py-2 text-right tabular-nums">
                      {total > 0 ? `${rate.toFixed(0)}%` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <EmptyState
            title="No runs in the last 7 days"
            hint="Start the Celery worker + beat to populate this."
          />
        )}
      </Card>

      <Card title="Recent runs" hint={`${recent.length} most recent`}>
        {recent.length > 0 ? (
          <ul className="divide-y divide-slate-50 text-xs">
            {recent.map((r) => (
              <li key={r.id} className="grid grid-cols-[80px_80px_1fr_80px_120px] items-center gap-3 py-1.5">
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-center text-[10px] font-semibold uppercase ${
                    r.status === "success"
                      ? "bg-emerald-50 text-emerald-700"
                      : r.status === "failed"
                        ? "bg-rose-50 text-rose-700"
                        : "bg-amber-50 text-amber-700"
                  }`}
                >
                  {r.status}
                </span>
                <span className="font-mono text-xs capitalize text-slate-700">
                  {r.platform ?? r.taskName}
                </span>
                <span className="truncate text-slate-600">
                  {r.error ? r.error : `${r.itemsStored ?? 0} stored`}
                </span>
                <span className="text-right tabular-nums text-slate-500">
                  {r.finishedAt && r.startedAt
                    ? `${Math.round(
                        (new Date(r.finishedAt).getTime() -
                          new Date(r.startedAt).getTime()) /
                          1000,
                      )}s`
                    : "—"}
                </span>
                <span className="text-right text-[10px] text-slate-400">
                  {formatRelative(r.startedAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
    </>
  );
}
