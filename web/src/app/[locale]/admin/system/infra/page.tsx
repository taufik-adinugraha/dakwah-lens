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
 * Host CPU / mem / disk dashboard.
 *
 * Reads from `system_metrics`. If empty, the user hasn't started the
 * Celery beat yet — we surface that explicitly with a setup hint rather
 * than a broken chart.
 */
export default async function InfraPage() {
  // Latest snapshot + last 60 minutes for the sparkline. 60 rows = the
  // 60-second beat cadence gives us a 1-hour rolling chart.
  const [latest, recent] = await Promise.all([
    db
      .select()
      .from(schema.systemMetrics)
      .orderBy(desc(schema.systemMetrics.capturedAt))
      .limit(1),
    db
      .select()
      .from(schema.systemMetrics)
      .where(sql`captured_at >= now() - interval '60 minutes'`)
      .orderBy(schema.systemMetrics.capturedAt),
  ]);

  const m = latest[0];

  return (
    <>
      <PageHeader
        title="Host infrastructure"
        subtitle="Live CPU, memory, and disk for the machine running this app. One-minute resolution."
      />

      <HelpCallout>
        <p>
          A Celery beat task (<code>snapshot_system</code>) runs{" "}
          <code>psutil.cpu_percent / virtual_memory / disk_usage(&quot;/&quot;)</code>{" "}
          every 60 seconds and writes the result to <code>system_metrics</code>.
          If you see <em>no data</em>, start the Celery worker with the{" "}
          <code>-B</code> flag:
        </p>
        <pre className="mt-1 overflow-x-auto rounded-md bg-slate-900/95 px-3 py-2 font-mono text-[11px] text-emerald-300">
          uv run celery -A api.workers.celery_app worker -B --loglevel=info
        </pre>
        <p className="mt-2">
          For production VPS monitoring, this snapshot reflects the box
          Celery is running on — point it at your IDCloudHost VPS and the
          metrics here are what you&apos;d see in <code>htop</code>.
        </p>
      </HelpCallout>

      {!m ? (
        <EmptyState
          title="No metrics captured yet"
          hint="Start the Celery beat process — snapshots arrive every 60 seconds."
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile
              label="CPU"
              value={`${m.cpuPct.toFixed(0)}%`}
              hint={
                m.load1m != null ? `load avg ${m.load1m.toFixed(2)}` : undefined
              }
              accent={m.cpuPct > 80 ? "rose" : m.cpuPct > 50 ? "amber" : "emerald"}
            />
            <StatTile
              label="Memory"
              value={`${((m.memUsedMb / m.memTotalMb) * 100).toFixed(0)}%`}
              hint={`${(m.memUsedMb / 1024).toFixed(1)} / ${(m.memTotalMb / 1024).toFixed(0)} GB`}
              accent={
                m.memUsedMb / m.memTotalMb > 0.85
                  ? "rose"
                  : m.memUsedMb / m.memTotalMb > 0.7
                    ? "amber"
                    : "emerald"
              }
            />
            <StatTile
              label="Disk"
              value={`${((m.diskUsedGb / m.diskTotalGb) * 100).toFixed(0)}%`}
              hint={`${m.diskUsedGb.toFixed(1)} / ${m.diskTotalGb.toFixed(0)} GB`}
              accent={
                m.diskUsedGb / m.diskTotalGb > 0.9
                  ? "rose"
                  : m.diskUsedGb / m.diskTotalGb > 0.75
                    ? "amber"
                    : "emerald"
              }
            />
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            <Sparkline title="CPU %" points={recent.map((r) => r.cpuPct)} suffix="%" accent="brand" />
            <Sparkline
              title="Memory %"
              points={recent.map((r) => (r.memUsedMb / r.memTotalMb) * 100)}
              suffix="%"
              accent="emerald"
            />
            <Sparkline
              title="Disk used (GB)"
              points={recent.map((r) => r.diskUsedGb)}
              suffix="GB"
              accent="amber"
            />
          </div>

          <p className="mt-4 text-[11px] text-slate-500">
            Showing the last {recent.length} snapshots ·{" "}
            {recent.length > 0
              ? `oldest ${formatRelative(recent[0]!.capturedAt)}`
              : ""}
          </p>
        </>
      )}
    </>
  );
}

function Sparkline({
  title,
  points,
  suffix,
  accent,
}: {
  title: string;
  points: number[];
  suffix: string;
  accent: "brand" | "emerald" | "amber";
}) {
  const stroke =
    accent === "brand"
      ? "stroke-brand-500"
      : accent === "emerald"
        ? "stroke-emerald-500"
        : "stroke-amber-500";
  const min = points.length ? Math.min(...points) : 0;
  const max = points.length ? Math.max(...points, min + 1) : 1;
  const w = 280;
  const h = 80;
  const stepX = points.length > 1 ? w / (points.length - 1) : 0;
  const path = points
    .map((v, i) => {
      const x = i * stepX;
      const y = h - ((v - min) / (max - min || 1)) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const last = points[points.length - 1] ?? 0;

  return (
    <Card title={title} hint={`${last.toFixed(1)}${suffix}`}>
      {points.length < 2 ? (
        <p className="py-6 text-center text-xs text-slate-500">
          Need ≥2 points to draw — wait a minute.
        </p>
      ) : (
        <svg
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="none"
          className="block h-20 w-full"
        >
          <path d={path} fill="none" strokeWidth={1.5} className={stroke} />
        </svg>
      )}
      <p className="mt-2 flex justify-between text-[10px] tabular-nums text-slate-400">
        <span>min {min.toFixed(1)}</span>
        <span>max {max.toFixed(1)}</span>
      </p>
    </Card>
  );
}
