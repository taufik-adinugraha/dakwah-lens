import { desc, sql } from "drizzle-orm";

import { Link } from "@/i18n/navigation";
import { db, schema } from "@/db";
import { InfraChart } from "@/components/InfraChart";
import {
  EmptyState,
  HelpCallout,
  PageHeader,
  StatTile,
} from "../_ui";

const RANGE_OPTIONS = [
  { value: "24h", label: "Last 24 hours", interval: "24 hours", bucketSec: 300 }, // 5-min buckets → ~288 points
  { value: "7d", label: "Last 7 days", interval: "7 days", bucketSec: 3600 }, // hourly → 168 points
  { value: "30d", label: "Last 30 days", interval: "30 days", bucketSec: 21600 }, // 6-hour → 120 points
] as const;
type RangeValue = (typeof RANGE_OPTIONS)[number]["value"];
const DEFAULT_RANGE: RangeValue = "24h";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function InfraPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  const sp = await searchParams;

  const rangeValue: RangeValue =
    typeof sp.range === "string" &&
    RANGE_OPTIONS.some((r) => r.value === sp.range)
      ? (sp.range as RangeValue)
      : DEFAULT_RANGE;
  const range = RANGE_OPTIONS.find((r) => r.value === rangeValue)!;

  // Always pull the latest snapshot for the top stat tiles, regardless
  // of selected range — those should reflect "right now", not an
  // average over a window.
  const [latest, bucketedRaw] = await Promise.all([
    db
      .select()
      .from(schema.systemMetrics)
      .orderBy(desc(schema.systemMetrics.capturedAt))
      .limit(1),
    db.execute(sql`
      SELECT
        to_timestamp(
          floor(extract(epoch from captured_at) / ${range.bucketSec}) * ${range.bucketSec}
        ) AT TIME ZONE 'UTC' AS bucket,
        avg(cpu_pct)::float AS cpu_pct,
        avg(mem_used_mb)::float AS mem_used_mb,
        avg(mem_total_mb)::float AS mem_total_mb,
        avg(disk_used_gb)::float AS disk_used_gb,
        avg(disk_total_gb)::float AS disk_total_gb
      FROM system_metrics
      WHERE captured_at >= now() - interval ${sql.raw(`'${range.interval}'`)}
      GROUP BY bucket
      ORDER BY bucket
    `) as unknown as Promise<
      Array<{
        bucket: Date;
        cpu_pct: number;
        mem_used_mb: number;
        mem_total_mb: number;
        disk_used_gb: number;
        disk_total_gb: number;
      }>
    >,
  ]);

  const m = latest[0];
  const bucketed = bucketedRaw.map((r) => ({
    ...r,
    bucket: typeof r.bucket === "string" ? new Date(r.bucket) : r.bucket,
  }));

  return (
    <>
      <PageHeader
        title="Host infrastructure"
        subtitle="Live CPU, memory, and disk for the machine running this app."
      />

      <HelpCallout>
        <p>
          A Celery beat task (<code>snapshot_system</code>) runs{" "}
          <code>psutil.cpu_percent / virtual_memory / disk_usage(&quot;/&quot;)</code>{" "}
          every 60 seconds and writes the result to <code>system_metrics</code>.
          Charts below downsample to the resolution that fits the selected
          range: 5-min buckets for 24h, hourly for 7d, 6-hour for 30d.
        </p>
      </HelpCallout>

      {/* Range filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-slate-500">Range:</span>
        {RANGE_OPTIONS.map((opt) => {
          const active = opt.value === rangeValue;
          return (
            <Link
              key={opt.value}
              href={`/admin/system/infra?range=${opt.value}`}
              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ring-1 transition ${
                active
                  ? "bg-slate-900 text-white ring-slate-900 shadow-sm"
                  : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"
              }`}
            >
              {opt.label}
            </Link>
          );
        })}
        <span className="ml-auto text-[11px] text-slate-400">
          {bucketed.length} points
        </span>
      </div>

      {!m ? (
        <EmptyState
          title="No metrics captured yet"
          hint="Start the Celery beat process — snapshots arrive every 60 seconds."
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile
              label="CPU (now)"
              value={`${m.cpuPct.toFixed(0)}%`}
              hint={
                m.load1m != null ? `load avg ${m.load1m.toFixed(2)}` : undefined
              }
              accent={m.cpuPct > 80 ? "rose" : m.cpuPct > 50 ? "amber" : "emerald"}
            />
            <StatTile
              label="Memory (now)"
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
              label="Disk (now)"
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
            <InfraChart
              title="CPU %"
              suffix="%"
              accent="brand"
              locale={locale}
              points={bucketed.map((r) => ({
                t: r.bucket.toISOString(),
                v: r.cpu_pct ?? 0,
              }))}
            />
            <InfraChart
              title="Memory %"
              suffix="%"
              accent="emerald"
              locale={locale}
              points={bucketed.map((r) => ({
                t: r.bucket.toISOString(),
                v:
                  r.mem_total_mb > 0
                    ? (r.mem_used_mb / r.mem_total_mb) * 100
                    : 0,
              }))}
            />
            <InfraChart
              title="Disk used"
              suffix="GB"
              accent="amber"
              locale={locale}
              points={bucketed.map((r) => ({
                t: r.bucket.toISOString(),
                v: r.disk_used_gb ?? 0,
              }))}
            />
          </div>
        </>
      )}
    </>
  );
}
