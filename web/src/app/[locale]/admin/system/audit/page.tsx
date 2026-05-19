import { desc, eq, and, gte, sql, type SQL } from "drizzle-orm";

import { db, schema } from "@/db";
import {
  Card,
  EmptyState,
  HelpCallout,
  PageHeader,
} from "../_ui";

export const metadata = { title: "Audit log" };

const PAGE_SIZE = 50;

/** Same set instrumented in admin/actions.ts + admin/system/actions.ts
 *  + admin/system/followups/actions.ts. Kept in sync manually — adding
 *  a new action means adding it here too. */
const ACTION_FILTER_OPTIONS = [
  "user.approve",
  "user.reject",
  "user.block",
  "user.reinstate",
  "user.remove",
  "user.role_change",
  "cost.add",
  "cost.delete",
  "donation.add",
  "donation.delete",
  "rss.add",
  "rss.delete",
  "rss.toggle_enabled",
  "rss.toggle_fetch_body",
  "ingest_query.add",
  "ingest_query.toggle",
  "ingest_query.delete",
  "contact.status_change",
  "contact.delete",
  "fx_rate.update",
  "followup.email_blast",
  "followup.banner_post",
  "followup.dismiss",
] as const;

const RANGE_OPTIONS = [
  { value: "1d", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "all", label: "All time" },
] as const;

type RangeValue = (typeof RANGE_OPTIONS)[number]["value"];

function rangeToInterval(value: string): string | null {
  switch (value) {
    case "1d":
      return "1 day";
    case "7d":
      return "7 days";
    case "30d":
      return "30 days";
    default:
      return null;
  }
}

// Inline searchParams type — the Next.js typed-routes generator
// (.next/types/routes.d.ts) only registers new routes after a dev-server
// or build pass, so PageProps<"/[locale]/admin/system/audit"> fails TS
// on fresh-add. This signature matches what the typed alias would expand
// to and lets `tsc --noEmit` succeed before the first run.
type AuditSearchParams = {
  action?: string | string[];
  range?: string | string[];
  actor?: string | string[];
  page?: string | string[];
};

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<AuditSearchParams>;
}) {
  const sp = await searchParams;

  const actionFilter =
    typeof sp.action === "string" &&
    (ACTION_FILTER_OPTIONS as readonly string[]).includes(sp.action)
      ? sp.action
      : "";

  const range: RangeValue =
    typeof sp.range === "string" &&
    (RANGE_OPTIONS.some((o) => o.value === sp.range))
      ? (sp.range as RangeValue)
      : "7d";

  const actorFilter =
    typeof sp.actor === "string" ? sp.actor.trim().slice(0, 200) : "";

  const page = Math.max(
    1,
    Number(typeof sp.page === "string" ? sp.page : 1) || 1,
  );

  const conditions: SQL[] = [];
  if (actionFilter) {
    conditions.push(eq(schema.adminLogs.action, actionFilter));
  }
  const interval = rangeToInterval(range);
  if (interval) {
    conditions.push(
      gte(
        schema.adminLogs.createdAt,
        sql`now() - interval ${interval}`,
      ),
    );
  }
  // Actor filter is a substring match against the user's email or
  // name. We resolve it by ID via a sub-select to keep the main
  // query indexed on (actor_user_id, created_at).
  if (actorFilter) {
    conditions.push(
      sql`actor_user_id IN (
        SELECT id FROM users
        WHERE email ILIKE ${"%" + actorFilter + "%"}
           OR COALESCE(name, '') ILIKE ${"%" + actorFilter + "%"}
      )`,
    );
  }

  const whereClause = conditions.length ? and(...conditions) : undefined;
  const offset = (page - 1) * PAGE_SIZE;

  const [logsRaw, [{ totalCount = 0 } = { totalCount: 0 }]] =
    await Promise.all([
      db
        .select({
          id: schema.adminLogs.id,
          actorUserId: schema.adminLogs.actorUserId,
          action: schema.adminLogs.action,
          targetType: schema.adminLogs.targetType,
          targetId: schema.adminLogs.targetId,
          payload: schema.adminLogs.payload,
          createdAt: schema.adminLogs.createdAt,
          actorEmail: schema.users.email,
          actorName: schema.users.name,
        })
        .from(schema.adminLogs)
        // LEFT JOIN so audit rows survive admin removal: actor_email
        // becomes NULL but the action history stays.
        .leftJoin(
          schema.users,
          eq(schema.users.id, schema.adminLogs.actorUserId),
        )
        .where(whereClause)
        .orderBy(desc(schema.adminLogs.createdAt))
        .limit(PAGE_SIZE)
        .offset(offset),
      db
        .select({ totalCount: sql<number>`COUNT(*)::int` })
        .from(schema.adminLogs)
        .where(whereClause),
    ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Every admin server action under /admin/* is written here. Append-only. Use the filters to narrow by action, who did it, or when."
      />

      <HelpCallout>
        <p>
          Built by the <code>logAdminAction()</code> helper in{" "}
          <code>lib/admin-log.ts</code> — called from every server action
          in <code>admin/actions.ts</code>, <code>admin/system/actions.ts</code>
          , and <code>admin/system/followups/actions.ts</code>.
        </p>
        <p>
          Rows are never updated or deleted. If an admin removes a user,
          the audit row stays but the joined actor email turns into
          <code>—</code> (left join). The payload column preserves
          identifying strings about the target so a deleted row still
          shows up readably.
        </p>
      </HelpCallout>

      <Card title="Filters">
        <form className="flex flex-wrap items-end gap-3">
          <FormField label="Action">
            <select
              name="action"
              defaultValue={actionFilter}
              className="h-9 w-56 rounded-lg border border-slate-200 bg-white px-3 text-sm"
            >
              <option value="">All actions</option>
              {ACTION_FILTER_OPTIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Range">
            <select
              name="range"
              defaultValue={range}
              className="h-9 w-44 rounded-lg border border-slate-200 bg-white px-3 text-sm"
            >
              {RANGE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Actor (email or name)">
            <input
              name="actor"
              defaultValue={actorFilter}
              maxLength={200}
              placeholder="ahmed@example.com"
              className="h-9 w-64 rounded-lg border border-slate-200 px-3 text-sm placeholder:text-slate-400"
            />
          </FormField>
          <button
            type="submit"
            className="inline-flex h-9 items-center rounded-lg bg-slate-900 px-4 text-xs font-semibold text-white hover:bg-slate-800"
          >
            Apply
          </button>
          <span className="text-[11px] tabular-nums text-slate-500">
            {totalCount.toLocaleString()} entries
          </span>
        </form>
      </Card>

      <Card title={`Activity (page ${page} of ${totalPages})`}>
        {logsRaw.length === 0 ? (
          <EmptyState
            title="No entries"
            hint={
              actionFilter || actorFilter || range !== "7d"
                ? "Try widening the filters."
                : "Admin actions will appear here as they happen."
            }
          />
        ) : (
          <ol className="space-y-2">
            {logsRaw.map((log) => (
              <li
                key={log.id}
                className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <ActionPill action={log.action} />
                  <span className="text-xs text-slate-500">
                    <span className="font-semibold text-slate-700">
                      {log.actorName || log.actorEmail || (
                        <span className="italic">— (deleted)</span>
                      )}
                    </span>
                    {log.actorEmail && log.actorName && (
                      <span className="text-slate-400"> · {log.actorEmail}</span>
                    )}
                  </span>
                  <span className="ml-auto text-[11px] tabular-nums text-slate-500">
                    {new Date(log.createdAt).toLocaleString()}
                  </span>
                </div>
                <div className="mt-1 grid gap-1 text-[11px] text-slate-600">
                  {log.targetType && (
                    <div>
                      <span className="font-semibold text-slate-500">
                        Target:
                      </span>{" "}
                      <code>{log.targetType}</code>
                      {log.targetId && (
                        <>
                          {" "}
                          <code className="text-slate-400">
                            #{log.targetId.slice(0, 36)}
                          </code>
                        </>
                      )}
                    </div>
                  )}
                  {log.payload && Object.keys(log.payload).length > 0 && (
                    <PayloadPre payload={log.payload} />
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
        {totalPages > 1 && (
          <Pagination
            page={page}
            totalPages={totalPages}
            actionFilter={actionFilter}
            range={range}
            actorFilter={actorFilter}
          />
        )}
      </Card>
    </>
  );
}

function ActionPill({ action }: { action: string }) {
  // Color-code by namespace for at-a-glance scanning.
  const [ns] = action.split(".");
  const tone =
    ns === "user"
      ? "bg-rose-50 text-rose-700 ring-rose-100"
      : ns === "cost" || ns === "donation"
        ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
        : ns === "rss" || ns === "ingest_query"
          ? "bg-brand-50 text-brand-700 ring-brand-100"
          : ns === "followup"
            ? "bg-amber-50 text-amber-700 ring-amber-100"
            : "bg-slate-100 text-slate-700 ring-slate-200";
  return (
    <code
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${tone}`}
    >
      {action}
    </code>
  );
}

function PayloadPre({ payload }: { payload: Record<string, unknown> }) {
  return (
    <details>
      <summary className="cursor-pointer text-[10px] uppercase tracking-wider text-slate-500 hover:text-slate-700">
        Payload
      </summary>
      <pre className="mt-1 overflow-x-auto rounded-lg bg-slate-50 p-2 text-[11px] leading-relaxed text-slate-700">
        {JSON.stringify(payload, null, 2)}
      </pre>
    </details>
  );
}

function Pagination({
  page,
  totalPages,
  actionFilter,
  range,
  actorFilter,
}: {
  page: number;
  totalPages: number;
  actionFilter: string;
  range: string;
  actorFilter: string;
}) {
  function hrefFor(p: number): string {
    const params = new URLSearchParams();
    if (actionFilter) params.set("action", actionFilter);
    if (range !== "7d") params.set("range", range);
    if (actorFilter) params.set("actor", actorFilter);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return `/admin/system/audit${qs ? `?${qs}` : ""}`;
  }
  return (
    <div className="mt-4 flex items-center justify-between">
      <a
        href={hrefFor(Math.max(1, page - 1))}
        aria-disabled={page <= 1}
        className={`inline-flex h-8 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium ${
          page <= 1
            ? "pointer-events-none text-slate-300"
            : "text-slate-700 hover:bg-slate-50"
        }`}
      >
        ← Previous
      </a>
      <span className="text-xs text-slate-500 tabular-nums">
        Page {page} of {totalPages}
      </span>
      <a
        href={hrefFor(Math.min(totalPages, page + 1))}
        aria-disabled={page >= totalPages}
        className={`inline-flex h-8 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium ${
          page >= totalPages
            ? "pointer-events-none text-slate-300"
            : "text-slate-700 hover:bg-slate-50"
        }`}
      >
        Next →
      </a>
    </div>
  );
}

function FormField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

