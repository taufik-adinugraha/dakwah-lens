import { desc, sql } from "drizzle-orm";

import { auth } from "@/auth";
import { db, schema } from "@/db";
import {
  getPipelineFlagsMap,
  pipelineFlagKey,
} from "@/lib/settings";
import { togglePipelineSchedule } from "../actions";
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
// Mirror of `api/src/api/workers/celery_app.py` beat_schedule. Keep in
// sync when you add/move a task: this table is what the admin page
// renders, and the `task` + `platform` fields are how rows are joined
// to ingest_runs / usage_events for the "Latest run" cell.
//
// Three special task names bypass ingest_runs and resolve freshness
// from another table — see the matcher below for the lookups:
//   snapshot_system          → system_metrics.captured_at
//   reconcile_apify_costs    → usage_events.operation='billing_reconcile'
//   trending_ingest          → usage_events.operation='trending_filter'
//
// `beatTask` + `beatPlatform` are the schedule's actual top-level
// Celery task (NOT the per-platform `run_ingest` children fanned out
// underneath). They key the kill-switch row in `app_settings`. The
// Python side at `services/pipeline_flags.py::is_task_enabled` reads
// the same pair at the top of each beat-level task.
const BEAT_SCHEDULE = [
  { name: "ingest-mainstream", task: "run_ingest", beatTask: "run_ingest", beatPlatform: "mainstream", platform: "mainstream", cron: "every 2h (even hours WIB)", query: "(all enabled RSS feeds)" },
  { name: "retry-failed-sentiment", task: "retry_failed_sentiment", beatTask: "retry_failed_sentiment", beatPlatform: "all", platform: "—", cron: "every 2h (odd hours WIB)", query: "(re-classify failed sentiment rows)" },
  { name: "ingest-youtube-channels", task: "run_ingest", beatTask: "youtube_channels_ingest", beatPlatform: "all", platform: "youtube", cron: "Wed 21:00 WIB", query: "(channel whitelist uploads)" },
  { name: "ingest-x-weekly", task: "run_ingest", beatTask: "rotating_ingest", beatPlatform: "x", platform: "x", cron: "Wed 22:00 WIB", query: "(rotating ingest_queries, lang:id)" },
  { name: "ingest-tiktok-weekly", task: "run_ingest", beatTask: "rotating_ingest", beatPlatform: "tiktok", platform: "tiktok", cron: "Wed 22:10 WIB", query: "(rotating ingest_queries)", pausedInBeat: true },
  { name: "ingest-instagram-weekly", task: "run_ingest", beatTask: "rotating_ingest", beatPlatform: "instagram", platform: "instagram", cron: "Wed 22:20 WIB", query: "(rotating ingest_queries)", pausedInBeat: true },
  { name: "recluster-daily", task: "recluster_all", beatTask: "recluster_all", beatPlatform: "all", platform: "all", cron: "04:00 WIB daily", query: "(Gemini topic discovery)" },
  { name: "send-weekly-digest", task: "send_weekly_digest", beatTask: "send_weekly_digest", beatPlatform: "all", platform: "—", cron: "Thu 08:00 WIB", query: "(Resend → opt-in users)" },
  { name: "trending-ingest", task: "trending_ingest", beatTask: "trending_ingest", beatPlatform: "all", platform: "x+youtube", cron: "12:00 WIB daily", query: "(Trends + News RSS + YT mostPopular)" },
  { name: "reconcile-apify-costs", task: "reconcile_apify_costs", beatTask: "reconcile_apify_costs", beatPlatform: "all", platform: "—", cron: "06:00 WIB daily", query: "(Apify billing reconcile)" },
  { name: "snapshot-system", task: "snapshot_system", beatTask: "snapshot_system", beatPlatform: "host", platform: "host", cron: "every 60s", query: "—" },
] as const;

// Background tasks (Celery `recluster_all`, `snapshot_system`,
// `reconcile_apify_costs`, ingest workers) write to ingest_runs /
// system_metrics / usage_events without firing `revalidatePath`.
// Force-dynamic so this page always reflects the latest write
// instead of serving a cached render with the previous tick's
// "Latest run" timestamp.
export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const session = await auth();
  const isSuperadmin = session?.user?.role === "superadmin";
  // Resolve the per-schedule kill-switch state. One settings row per
  // (task, platform) pair; default-true when no row exists so an
  // un-touched install keeps the historical "beat fires everything"
  // behavior. Mirrors Python `services/pipeline_flags.is_task_enabled`.
  const flagKeys = BEAT_SCHEDULE.map((s) =>
    pipelineFlagKey(s.beatTask, s.beatPlatform),
  );
  const flagsMap = await getPipelineFlagsMap(flagKeys);
  // Three tasks don't write to ingest_runs at all — they predate the
  // run-tracking convention and write directly to their own tables:
  //   - snapshot_system → system_metrics (every 60s)
  //   - reconcile_apify_costs → usage_events (operation='billing_reconcile')
  // Pull their latest timestamps separately so the schedule table can
  // show "ran X minutes ago" instead of a misleading "no runs yet".
  const [
    recent,
    perPlatform,
    latestPerTask,
    latestSystemMetric,
    latestApifyReconcile,
    postsClassified7d,
  ] = await Promise.all([
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
    // Latest run per (task_name, platform) — matches the BEAT_SCHEDULE
    // key shape so the schedule table can find each row reliably.
    // `platform IS NULL` is INCLUDED (some tasks have no platform).
    db.execute(sql`
      SELECT DISTINCT ON (task_name, COALESCE(platform, ''))
        task_name, platform, status, started_at, finished_at, items_stored, error
      FROM ingest_runs
      ORDER BY task_name, COALESCE(platform, ''), started_at DESC
    `) as unknown as Promise<
      Array<{
        task_name: string;
        platform: string | null;
        status: string;
        started_at: string;
        finished_at: string | null;
        items_stored: number | null;
        error: string | null;
      }>
    >,
    db.execute(sql`
      SELECT captured_at FROM system_metrics
      ORDER BY captured_at DESC LIMIT 1
    `) as unknown as Promise<Array<{ captured_at: string }>>,
    db.execute(sql`
      SELECT occurred_at FROM usage_events
      WHERE operation = 'billing_reconcile'
      ORDER BY occurred_at DESC LIMIT 1
    `) as unknown as Promise<Array<{ occurred_at: string }>>,
    // Unique posts that completed Gemini classification in the last
    // 7 days. Matches the homepage's "postingan dianalisis" metric
    // (same `social_posts` table, same `dawah_opportunity IS NOT NULL`
    // filter, just a tighter 7d window for pipeline-health context).
    // Apples-to-apples with the homepage so operators can mentally
    // scale: this number × ~4 ≈ the 30d homepage figure.
    db.execute(sql`
      SELECT COUNT(*)::int AS n
      FROM social_posts
      WHERE created_at >= now() - interval '7 days'
        AND dawah_opportunity IS NOT NULL
    `) as unknown as Promise<Array<{ n: number }>>,
  ]);
  const classifiedCount = postsClassified7d[0]?.n ?? 0;

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
          label="Posts classified · 7d"
          value={classifiedCount.toLocaleString()}
          hint={
            // Mirrors the homepage's "postingan dianalisis" card so
            // operators see the same metric (unique social_posts with
            // dawah_relevance set) on a 7d window, vs the homepage's
            // 30d. Replaces the prior SUM(items_stored) tile, which
            // counted raw per-run ingest events and double-counted
            // refreshes — making the number look much larger than
            // what actually reached the queryable corpus.
            "Unique posts that finished Gemini classification (matches the homepage's 30d card, scoped to 7d here)."
          }
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
              <th className="py-2 text-right">State</th>
            </tr>
          </thead>
          <tbody>
            {BEAT_SCHEDULE.map((s) => {
              // Look up latest run for this schedule row. Most schedules
              // now have parent-level ingest_runs rows (added 2026-06-10
              // to fix the fan-out conflation where multiple schedules
              // logged via task_name="run_ingest"); we match by the
              // BEAT-LEVEL task name (`s.beatTask`) + platform, NOT the
              // fan-out child task name. Two schedules still bypass
              // ingest_runs and have to be resolved from their actual
              // destination tables.
              let cell: React.ReactNode;
              if (s.beatTask === "snapshot_system") {
                const ts = latestSystemMetric[0]?.captured_at;
                cell = ts ? (
                  <span className="text-emerald-700">
                    success · {formatRelative(ts)}
                  </span>
                ) : (
                  <span className="text-slate-400">no snapshots yet</span>
                );
              } else if (s.beatTask === "reconcile_apify_costs") {
                const ts = latestApifyReconcile[0]?.occurred_at;
                cell = ts ? (
                  <span className="text-emerald-700">
                    success · {formatRelative(ts)}
                  </span>
                ) : (
                  <span className="text-slate-400">no reconcile yet</span>
                );
              } else {
                // Match by parent (beatTask) + platform. Falls back to
                // the legacy run_ingest match for schedules that
                // haven't fired since the parent-row instrumentation
                // landed (transient — clears after one beat tick).
                const matches = Array.isArray(latestPerTask)
                  ? latestPerTask.filter(
                      (l) =>
                        l.task_name === s.beatTask &&
                        l.platform === s.beatPlatform,
                    )
                  : [];
                // Legacy fallback for the transient window between this
                // code shipping and the first beat tick that writes the
                // new parent-level ingest_runs row. Platform-strict so
                // we don't reintroduce the cross-schedule conflation.
                const legacyFallback = Array.isArray(latestPerTask)
                  ? latestPerTask.filter(
                      (l) =>
                        l.task_name === s.task && l.platform === s.platform,
                    )
                  : [];
                const latest = matches[0] ?? legacyFallback[0] ?? null;
                cell = latest ? (
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
                );
              }
              const fkey = pipelineFlagKey(s.beatTask, s.beatPlatform);
              const enabled = flagsMap.get(fkey) ?? true;
              // Rows whose entry is COMMENTED OUT in the Celery beat
              // schedule render as "PAUSED" instead of an active toggle
              // — toggling the kill switch would be misleading because
              // beat won't fire them regardless. The row stays visible
              // so the operator can see the historical schedule.
              const pausedInBeat =
                "pausedInBeat" in s && s.pausedInBeat === true;
              return (
                <tr
                  key={s.name}
                  className={`border-b border-slate-50 last:border-0 ${
                    pausedInBeat || !enabled ? "bg-slate-50/60" : ""
                  }`}
                >
                  <td className="py-2 font-mono text-xs text-slate-800">
                    {s.name}
                  </td>
                  <td className="py-2 text-xs capitalize">{s.platform}</td>
                  <td className="py-2 text-xs text-slate-600">{s.cron}</td>
                  <td className="py-2 text-xs text-slate-500">{s.query}</td>
                  <td className="py-2 text-xs">{cell}</td>
                  <td className="py-2 text-right">
                    {pausedInBeat ? (
                      <span
                        title="Commented out in celery_app.py — re-add the schedule entry to make it fire again."
                        className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700 ring-1 ring-amber-200"
                      >
                        Paused in beat
                      </span>
                    ) : isSuperadmin ? (
                      <PipelineToggleSwitch
                        task={s.beatTask}
                        platform={s.beatPlatform}
                        enabled={enabled}
                        label={s.name}
                      />
                    ) : (
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${
                          enabled
                            ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
                            : "bg-slate-100 text-slate-500 ring-slate-200"
                        }`}
                      >
                        {enabled ? "Enabled" : "Disabled"}
                      </span>
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

function PipelineToggleSwitch({
  task,
  platform,
  enabled,
  label,
}: {
  task: string;
  platform: string;
  enabled: boolean;
  label: string;
}) {
  return (
    <form action={togglePipelineSchedule} className="inline-flex">
      <input type="hidden" name="task" value={task} />
      <input type="hidden" name="platform" value={platform} />
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
