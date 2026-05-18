import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Info,
} from "lucide-react";
import { count, desc, sql } from "drizzle-orm";

import { db, schema } from "@/db";
import { getUsdToIdrRow } from "@/lib/settings";
import { updateFxRate } from "./actions";
import {
  Card,
  HelpCallout,
  PageHeader,
  StatTile,
  formatIdr,
  formatRelative,
} from "./_ui";

// ── Thresholds ───────────────────────────────────────────────────────
const BUDGET_CAP_IDR = 1_000_000; // PRD §13 monthly cap
const MIN_POSTS_FOR_CLUSTERING = 20;

type Severity = "critical" | "medium" | "low";

type Issue = {
  severity: Severity;
  title: string;
  hint: string;
};

export default async function SystemOverviewPage() {
  // ── Headline tallies ─────────────────────────────────────────────
  const [
    fxRow,
    [{ totalUsers = 0 } = { totalUsers: 0 }],
    [{ totalPosts = 0 } = { totalPosts: 0 }],
    [{ totalBriefs = 0 } = { totalBriefs: 0 }],
    [{ pviews24h = 0 } = { pviews24h: 0 }],
    [{ uniqSessions30d = 0 } = { uniqSessions30d: 0 }],
    [{ apiUsd30 = 0 } = { apiUsd30: 0 }],
    latestMetric,
    latestIngest,
    // ── Inputs for the Needs Attention engine ──
    [{ pendingUsers = 0 } = { pendingUsers: 0 }],
    [{ recentFailures = 0 } = { recentFailures: 0 }],
    [{ unreadInbox = 0 } = { unreadInbox: 0 }],
    [{ zeroResultRuns24h = 0 } = { zeroResultRuns24h: 0 }],
    manualThisMonth,
  ] = await Promise.all([
    getUsdToIdrRow(),
    db.select({ totalUsers: count() }).from(schema.users),
    db.select({ totalPosts: count() }).from(schema.socialPosts),
    db.select({ totalBriefs: count() }).from(schema.briefs),
    db
      .select({ pviews24h: count() })
      .from(schema.pageViews)
      .where(
        sql`occurred_at >= now() - interval '24 hours' AND path NOT LIKE '/admin%' AND path NOT LIKE '/api%'`,
      ),
    db
      .select({ uniqSessions30d: sql<number>`COUNT(DISTINCT session_id)::int` })
      .from(schema.pageViews)
      .where(
        sql`occurred_at >= now() - interval '30 days' AND path NOT LIKE '/admin%' AND path NOT LIKE '/api%'`,
      ),
    db
      .select({ apiUsd30: sql<number>`COALESCE(SUM(cost_usd), 0)::float` })
      .from(schema.usageEvents)
      .where(sql`occurred_at >= now() - interval '30 days'`),
    db
      .select()
      .from(schema.systemMetrics)
      .orderBy(desc(schema.systemMetrics.capturedAt))
      .limit(1),
    db
      .select()
      .from(schema.ingestRuns)
      .orderBy(desc(schema.ingestRuns.startedAt))
      .limit(1),
    db
      .select({ pendingUsers: count() })
      .from(schema.users)
      .where(sql`status = 'pending'`),
    db
      .select({ recentFailures: count() })
      .from(schema.ingestRuns)
      .where(sql`status = 'failed' AND started_at >= now() - interval '24 hours'`),
    db
      .select({ unreadInbox: count() })
      .from(schema.contactMessages)
      .where(sql`status = 'new'`),
    // Silent-zero-result ingest runs: scraper "succeeded" in the sense that
    // it didn't throw, but came back with nothing. Most often a sign that
    // an Apify actor's selectors broke after a target-platform change.
    db
      .select({ zeroResultRuns24h: count() })
      .from(schema.ingestRuns)
      .where(
        sql`status = 'success'
            AND items_stored = 0
            AND task_name = 'run_ingest'
            AND started_at >= now() - interval '24 hours'`,
      ),
    db
      .select()
      .from(schema.manualCosts)
      .where(sql`period_end >= date_trunc('month', now())`),
  ]);

  const metric = latestMetric[0];
  const run = latestIngest[0];
  const usdToIdr = fxRow.value;

  // ── Total cost this month (allocated manual + 30d API spend) ─────
  // Manual entries that span more than one month are allocated 1/N to
  // each month; entries shorter than 31 days are treated as single-month
  // charges. Mirrors the math on /admin/system/costs.
  const monthStartMs = (() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  })();
  const manualThisMonthIdr = manualThisMonth.reduce((total, row) => {
    const start = new Date(row.periodStart).getTime();
    const end = new Date(row.periodEnd).getTime();
    if (end < monthStartMs) return total;
    const days = Math.max(1, (end - start) / 86_400_000);
    if (days <= 31) return total + row.amountIdr;
    return total + row.amountIdr / Math.ceil(days / 30);
  }, 0);
  const apiThisMonthIdr = apiUsd30 * usdToIdr;
  const totalThisMonthIdr = manualThisMonthIdr + apiThisMonthIdr;
  const capUsagePct = (totalThisMonthIdr / BUDGET_CAP_IDR) * 100;

  // ── Operational signal: is the worker fresh? ─────────────────────
  const metricAgeMin = metric
    ? (Date.now() - new Date(metric.capturedAt).getTime()) / 60_000
    : Infinity;
  const ingestAgeHr = run
    ? (Date.now() - new Date(run.startedAt).getTime()) / 3_600_000
    : Infinity;

  // ── Needs Attention engine ───────────────────────────────────────
  const issues: Issue[] = [];

  // Critical — operational
  if (!metric || metricAgeMin > 10) {
    issues.push({
      severity: "critical",
      title: "Celery worker / beat looks stopped",
      hint:
        metric
          ? `Last metric snapshot ${formatRelative(metric.capturedAt)} — expected one per minute.`
          : "No system_metrics rows yet. Run: uv run celery -A api.workers.celery_app worker -B",
    });
  }
  // Critical — config
  if (!process.env.ANTHROPIC_API_KEY && !process.env.GEMINI_API_KEY) {
    issues.push({
      severity: "critical",
      title: "No brief-generator LLM configured",
      hint:
        "Set GEMINI_API_KEY (primary) or ANTHROPIC_API_KEY (fallback) in .env. Without either, /briefs/new errors out.",
    });
  }
  if (!process.env.OPENAI_API_KEY) {
    issues.push({
      severity: "critical",
      title: "OPENAI_API_KEY missing",
      hint:
        "Qur'an retrieval needs OpenAI embeddings. Without it, briefs fall back to the curated 12-verse keyword library.",
    });
  }
  // Critical — budget
  if (capUsagePct >= 100) {
    issues.push({
      severity: "critical",
      title: "Monthly budget cap exceeded",
      hint: `Already at ${capUsagePct.toFixed(0)}% of the IDR ${BUDGET_CAP_IDR.toLocaleString("id-ID")} cap. Throttle Apify / heavier LLMs.`,
    });
  }

  // Medium
  if (capUsagePct >= 80 && capUsagePct < 100) {
    issues.push({
      severity: "medium",
      title: `Spend at ${capUsagePct.toFixed(0)}% of monthly cap`,
      hint: `Headroom is tight (≤ ${(100 - capUsagePct).toFixed(0)}%). Watch /admin/system/api-costs for a few days.`,
    });
  }
  if (Number(recentFailures) > 0) {
    issues.push({
      severity: "medium",
      title: `${recentFailures} ingest run${Number(recentFailures) === 1 ? "" : "s"} failed in last 24h`,
      hint: "Open /admin/system/pipeline → Recent runs to see the error text.",
    });
  }
  // Threshold of 3 — a single zero-result run isn't unusual (narrow query,
  // off-hours, brief outage). Three in a day means an actor is likely
  // structurally broken (selectors changed, IP banned, paid-tier gating).
  if (Number(zeroResultRuns24h) >= 3) {
    issues.push({
      severity: "medium",
      title: `${zeroResultRuns24h} ingest runs returned 0 items in last 24h`,
      hint:
        "Successful runs returning empty results usually mean a scraper " +
        "silently broke. Check /admin/system/pipeline → per-platform health to spot which one.",
    });
  }
  if (Number(pendingUsers) > 0) {
    issues.push({
      severity: "medium",
      title: `${pendingUsers} user${Number(pendingUsers) === 1 ? "" : "s"} pending approval`,
      hint: "Review at /admin/users — each pending account is blocked from generating briefs.",
    });
  }
  if (Number(unreadInbox) > 0) {
    issues.push({
      severity: "medium",
      title: `${unreadInbox} unread contact message${Number(unreadInbox) === 1 ? "" : "s"}`,
      hint: "Open /admin/system/inbox to read and reply. Each was also emailed to the admin address.",
    });
  }
  if (!process.env.APIFY_TOKEN) {
    issues.push({
      severity: "medium",
      title: "APIFY_TOKEN missing",
      hint:
        "X / Instagram / TikTok ingestion will fail. YouTube + RSS still work without it.",
    });
  }
  if (!process.env.YOUTUBE_API_KEY) {
    issues.push({
      severity: "medium",
      title: "YOUTUBE_API_KEY missing",
      hint: "YouTube ingest will fail. Other platforms unaffected.",
    });
  }

  // Low
  if (manualThisMonthIdr === 0) {
    issues.push({
      severity: "low",
      title: "No manual cost entry for the current month",
      hint:
        "Add your IDCloudHost invoice + domain renewal at /admin/system/costs so the total stays accurate.",
    });
  }
  if (totalPosts < MIN_POSTS_FOR_CLUSTERING) {
    issues.push({
      severity: "low",
      title: `Only ${totalPosts} social posts — BERTopic needs ≥ ${MIN_POSTS_FOR_CLUSTERING}`,
      hint:
        "Topic clusters won't be produced until the corpus grows. Run more ingests or wait for the beat schedule.",
    });
  }
  if (ingestAgeHr > 6 && Number.isFinite(ingestAgeHr)) {
    issues.push({
      severity: "low",
      title: "No ingest run in the last 6 hours",
      hint:
        run
          ? `Last run ${formatRelative(run.startedAt)} (${run.platform ?? "—"}). Beat should fire mainstream every 2h.`
          : "No ingest_runs rows yet — beat schedule may not be active.",
    });
  }

  const counts = {
    critical: issues.filter((i) => i.severity === "critical").length,
    medium: issues.filter((i) => i.severity === "medium").length,
    low: issues.filter((i) => i.severity === "low").length,
  };

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Health and headline numbers across the stack. Each tile links to a deeper view."
      />

      <HelpCallout title="How this page works">
        <p>
          Every number on this dashboard is queried live from the same
          Postgres database that powers the user-facing app — no caching,
          no warehouse. The system metrics tile shows the most recent
          snapshot captured by the Celery <code>snapshot_system</code> task
          (every 60 seconds). Total cost combines automated API spend
          (from <code>usage_events</code>) with manual VPS + domain entries
          you record at <code>/admin/system/costs</code>.
        </p>
      </HelpCallout>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Users" value={String(totalUsers)} />
        <StatTile
          label="Sessions · 30d"
          value={uniqSessions30d.toLocaleString()}
          hint="unique visitor sessions"
          accent="emerald"
        />
        <StatTile label="Social posts" value={String(totalPosts)} accent="brand" />
        <StatTile label="Briefs generated" value={String(totalBriefs)} />
        <StatTile
          label="Page views · 24h"
          value={pviews24h.toLocaleString()}
        />
        <StatTile
          label="Total cost · this month"
          value={formatIdr(totalThisMonthIdr / usdToIdr, usdToIdr)}
          hint={`${capUsagePct.toFixed(0)}% of IDR ${(BUDGET_CAP_IDR / 1_000_000).toFixed(1)}M cap`}
          accent={
            capUsagePct >= 100 ? "rose" : capUsagePct >= 80 ? "amber" : "emerald"
          }
        />
        <StatTile
          label="CPU now"
          value={metric ? `${metric.cpuPct.toFixed(0)}%` : "—"}
          hint={
            metric
              ? `mem ${((metric.memUsedMb / metric.memTotalMb) * 100).toFixed(0)}% · ${formatRelative(metric.capturedAt)}`
              : "no snapshots yet — start Celery beat"
          }
          accent={metric && metric.cpuPct > 80 ? "rose" : "emerald"}
        />
        <StatTile
          label="Last ingest"
          value={run ? run.status : "—"}
          hint={
            run
              ? `${run.platform ?? "—"} · ${formatRelative(run.startedAt)}`
              : "no runs yet — start Celery worker"
          }
          accent={
            run?.status === "success"
              ? "emerald"
              : run?.status === "failed"
                ? "rose"
                : undefined
          }
        />
      </div>

      <NeedsAttention issues={issues} counts={counts} />

      <FxRateEditor
        rate={usdToIdr}
        updatedAt={fxRow.updatedAt}
      />
    </>
  );
}

/**
 * USD → IDR rate editor. The number lands in `app_settings` and is read by
 * every page that displays IDR-denominated figures.
 *
 * Kept narrow and unobtrusive — the rate is meant to be set once and
 * tweaked occasionally, not the main thing on this dashboard.
 */
function FxRateEditor({
  rate,
  updatedAt,
}: {
  rate: number;
  updatedAt: Date | null;
}) {
  return (
    <div className="mt-6">
      <Card
        title="USD → IDR display rate"
        hint={
          updatedAt
            ? `updated ${formatRelative(updatedAt)}`
            : "factory default"
        }
      >
        <form
          action={updateFxRate}
          className="grid items-end gap-3 sm:grid-cols-[1fr_auto]"
        >
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
              Rate
              <span className="ml-2 text-[10px] font-normal normal-case tracking-normal text-slate-400">
                Used wherever USD is shown in IDR — does not affect any
                bill, just display. Manual cost entries already in IDR are
                untouched.
              </span>
            </span>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-sm text-slate-500">1 USD =</span>
              <input
                name="usd_to_idr"
                type="number"
                min="1"
                max="100000"
                step="1"
                required
                defaultValue={rate}
                className="h-9 w-32 rounded-lg border border-slate-200 px-3 text-sm tabular-nums"
              />
              <span className="text-sm text-slate-500">IDR</span>
            </div>
          </label>
          <button
            type="submit"
            className="inline-flex h-9 items-center justify-center rounded-lg bg-slate-900 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
          >
            Update rate
          </button>
        </form>
      </Card>
    </div>
  );
}

function NeedsAttention({
  issues,
  counts,
}: {
  issues: Issue[];
  counts: Record<Severity, number>;
}) {
  if (issues.length === 0) {
    return (
      <div className="mt-6">
        <Card title="Needs attention" hint="0 issues">
          <div className="flex items-center gap-3 rounded-xl bg-emerald-50/80 px-4 py-3 text-sm text-emerald-800 ring-1 ring-emerald-100">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            <span>
              All green. Worker is fresh, keys are set, budget is comfortable,
              and the queue is clean.
            </span>
          </div>
        </Card>
      </div>
    );
  }

  const order: Severity[] = ["critical", "medium", "low"];

  return (
    <div className="mt-6">
      <Card
        title="Needs attention"
        hint={`${counts.critical} critical · ${counts.medium} medium · ${counts.low} low`}
      >
        <ul className="space-y-2">
          {order
            .flatMap((sev) => issues.filter((i) => i.severity === sev))
            .map((issue, i) => (
              <IssueRow key={i} issue={issue} />
            ))}
        </ul>
      </Card>
    </div>
  );
}

function IssueRow({ issue }: { issue: Issue }) {
  const styles = SEVERITY_STYLES[issue.severity];
  const Icon = styles.icon;
  return (
    <li
      className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${styles.bg} ${styles.border}`}
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${styles.iconColor}`} />
      <div className="min-w-0 flex-1">
        <p className="flex items-start justify-between gap-3 text-sm font-semibold text-slate-900">
          {issue.title}
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${styles.pillBg} ${styles.pillText} ${styles.pillRing}`}
          >
            {issue.severity}
          </span>
        </p>
        <p className="mt-1 text-pretty text-xs leading-relaxed text-slate-600">
          {issue.hint}
        </p>
      </div>
    </li>
  );
}

const SEVERITY_STYLES = {
  critical: {
    icon: AlertOctagon,
    iconColor: "text-rose-600",
    bg: "bg-rose-50/70",
    border: "border-rose-200",
    pillBg: "bg-rose-100",
    pillText: "text-rose-800",
    pillRing: "ring-rose-200",
  },
  medium: {
    icon: AlertTriangle,
    iconColor: "text-amber-600",
    bg: "bg-amber-50/70",
    border: "border-amber-200",
    pillBg: "bg-amber-100",
    pillText: "text-amber-800",
    pillRing: "ring-amber-200",
  },
  low: {
    icon: Info,
    iconColor: "text-slate-500",
    bg: "bg-slate-50",
    border: "border-slate-200",
    pillBg: "bg-slate-100",
    pillText: "text-slate-700",
    pillRing: "ring-slate-200",
  },
} as const;
