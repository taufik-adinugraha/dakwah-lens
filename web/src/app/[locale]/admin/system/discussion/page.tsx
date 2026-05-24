import {
  AlertTriangle,
  ExternalLink,
  Hash,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { and, desc, eq, sql } from "drizzle-orm";

import { db, schema } from "@/db";
import { Link } from "@/i18n/navigation";
import {
  Card,
  EmptyState,
  HelpCallout,
  PageHeader,
  StatTile,
  formatRelative,
} from "../_ui";
import { deleteComment, setCommentStatus } from "../actions";
import { ConfirmForm } from "../_ConfirmForm";

/**
 * Moderation dashboard for the public discussion section under
 * /m/{slug}. Every comment hits the pipeline in
 * `/api/m/[id]/comments/route.ts`; this page is the single source
 * of truth for what got through and what got blocked.
 *
 *  - "All blocked" tab is the default — that's what an admin opens
 *    in response to the auto-email alert.
 *  - "Approved" tab lets you spot-check what readers are saying.
 *  - Each row supports two writes:
 *      · "Approve" (blocked → approved) for false positives
 *      · "Block"   (approved → blocked) for whatever the regex+LLM
 *                  pipeline missed.
 */

type StatusFilter = "blocked" | "approved" | "all";
const STATUS_FILTERS: readonly StatusFilter[] = [
  "blocked",
  "approved",
  "all",
] as const;

export default async function DiscussionModerationPage({
  searchParams,
}: PageProps<"/[locale]/admin/system/discussion">) {
  const sp = await searchParams;
  const rawShow = typeof sp.show === "string" ? sp.show : undefined;
  const activeFilter: StatusFilter = (STATUS_FILTERS as readonly string[]).includes(
    rawShow ?? "",
  )
    ? (rawShow as StatusFilter)
    : "blocked";

  const last24h = sql`created_at >= now() - interval '24 hours'`;
  const last7d = sql`created_at >= now() - interval '7 days'`;

  const [
    [{ blocked24h = 0 } = { blocked24h: 0 }],
    [{ approved24h = 0 } = { approved24h: 0 }],
    [{ blocked7d = 0 } = { blocked7d: 0 }],
    [{ uniqueSlugs7d = 0 } = { uniqueSlugs7d: 0 }],
    reasonBreakdown,
    topSlugs,
    items,
  ] = await Promise.all([
    db
      .select({ blocked24h: sql<number>`COUNT(*)::int` })
      .from(schema.mahasiswaComments)
      .where(and(eq(schema.mahasiswaComments.status, "blocked"), last24h)),
    db
      .select({ approved24h: sql<number>`COUNT(*)::int` })
      .from(schema.mahasiswaComments)
      .where(and(eq(schema.mahasiswaComments.status, "approved"), last24h)),
    db
      .select({ blocked7d: sql<number>`COUNT(*)::int` })
      .from(schema.mahasiswaComments)
      .where(and(eq(schema.mahasiswaComments.status, "blocked"), last7d)),
    db
      .select({
        uniqueSlugs7d: sql<number>`COUNT(DISTINCT briefing_slug)::int`,
      })
      .from(schema.mahasiswaComments)
      .where(last7d),
    db
      .select({
        reason: schema.mahasiswaComments.blockReason,
        n: sql<number>`COUNT(*)::int`,
      })
      .from(schema.mahasiswaComments)
      .where(and(eq(schema.mahasiswaComments.status, "blocked"), last7d))
      .groupBy(schema.mahasiswaComments.blockReason)
      .orderBy(desc(sql`COUNT(*)`)),
    db
      .select({
        slug: schema.mahasiswaComments.briefingSlug,
        blocked: sql<number>`SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END)::int`,
        approved: sql<number>`SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END)::int`,
      })
      .from(schema.mahasiswaComments)
      .where(last7d)
      .groupBy(schema.mahasiswaComments.briefingSlug)
      .orderBy(desc(sql`SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END)`))
      .limit(6),
    activeFilter === "all"
      ? db
          .select()
          .from(schema.mahasiswaComments)
          .orderBy(desc(schema.mahasiswaComments.createdAt))
          .limit(50)
      : db
          .select()
          .from(schema.mahasiswaComments)
          .where(eq(schema.mahasiswaComments.status, activeFilter))
          .orderBy(desc(schema.mahasiswaComments.createdAt))
          .limit(50),
  ]);

  return (
    <>
      <PageHeader
        title="Discussion moderation"
        subtitle="Public comments on /m/{slug}. Blocked rows include bot-shaped traffic (honeypot, bad token, duplicate) AND content-moderation blocks (gambling, pinjol, profanity). Pipe-flow is the same regardless — every row here was scored by the same /api/m/[id]/comments endpoint."
      />

      <HelpCallout title="How the auto-block layers work">
        <p className="mb-2">
          A submission hits the API and goes through layers in this order
          (cheap first):
        </p>
        <ol className="mt-1 list-decimal space-y-1 pl-5">
          <li>
            <strong>Same-origin gate</strong> — rejects POSTs from a different
            host (cross-site automation).
          </li>
          <li>
            <strong>UA non-empty</strong> + known-bot-UA blocklist (curl,
            python-requests, scrapy, &hellip;).
          </li>
          <li>
            <strong>Rate limit</strong> — 5/hour/IP plus a 3-per-minute burst
            cap; 5/hour/IP DB-backed throttle.
          </li>
          <li>
            <strong>Honeypot</strong> field. Real users never type into the
            hidden <code>website</code> input.
          </li>
          <li>
            <strong>HMAC submit-token</strong> — slug-bound, must be 3s &le;
            age &le; 90 min. Catches GET-then-POST scripts that submit too
            fast, and tokens replayed on a different article.
          </li>
          <li>
            <strong>Duplicate-body</strong> — same body + IP within 24h.
          </li>
          <li>
            <strong>Content moderation</strong> — regex blocklists for
            gambling (judol/gacor/maxwin/RTP), pinjol, sensational money
            testimonials, URL shorteners, profanity, contact lures; Gemini
            Flash-Lite as a fallback for borderline cases.
          </li>
        </ol>
        <p className="mt-3">
          The writer sees the same{" "}
          <code>{`{ ok: true, status: "pending" }`}</code> for every
          non-approved branch — they don&apos;t learn which tripwire fired.
          The admin email is throttled to 1 per 30 minutes; this page is
          always live.
        </p>
      </HelpCallout>

      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile
          label="Blocked (24h)"
          value={String(blocked24h)}
          hint={`${approved24h} approved`}
          accent={blocked24h > 0 ? "rose" : "emerald"}
        />
        <StatTile
          label="Blocked (7d)"
          value={String(blocked7d)}
          accent={blocked7d > 0 ? "amber" : "emerald"}
        />
        <StatTile
          label="Articles touched (7d)"
          value={String(uniqueSlugs7d)}
        />
        <StatTile
          label="Top reason"
          value={
            reasonBreakdown[0]?.reason
              ? `${reasonBreakdown[0].reason}`
              : "—"
          }
          hint={
            reasonBreakdown[0]?.reason
              ? `× ${reasonBreakdown[0].n}`
              : undefined
          }
        />
      </div>

      {/* Reason breakdown — quick read on what kind of spam is hitting us. */}
      {reasonBreakdown.length > 0 && (
        <Card title="Block reasons (last 7d)" hint={`${blocked7d} total`}>
          <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {reasonBreakdown
              .filter((r) => r.reason)
              .map((r) => (
                <li
                  key={r.reason}
                  className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5"
                >
                  <span className="font-mono text-[11.5px] text-slate-700">
                    {r.reason}
                  </span>
                  <span className="text-[11.5px] font-semibold tabular-nums text-slate-900">
                    {r.n}
                  </span>
                </li>
              ))}
          </ul>
        </Card>
      )}

      {/* Top slugs — which articles are getting hit. */}
      {topSlugs.length > 0 && (
        <Card title="Most-targeted articles (7d)">
          <ul className="space-y-1.5">
            {topSlugs.map((s) => (
              <li
                key={s.slug}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2"
              >
                <Link
                  href={`/m/${s.slug}`}
                  target="_blank"
                  className="inline-flex min-w-0 items-center gap-1 truncate font-mono text-[12px] text-slate-700 transition hover:text-slate-900 hover:underline"
                >
                  <Hash className="h-3 w-3 shrink-0 text-slate-400" />
                  <span className="truncate">{s.slug}</span>
                  <ExternalLink className="h-3 w-3 shrink-0 text-slate-400" />
                </Link>
                <span className="shrink-0 text-[11.5px] tabular-nums">
                  <span className="font-semibold text-rose-700">
                    {s.blocked} blocked
                  </span>
                  <span className="ml-2 text-slate-500">
                    / {s.approved} approved
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Filter tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((f) => (
          <a
            key={f}
            href={`?show=${f}`}
            className={
              f === activeFilter
                ? "inline-flex h-8 items-center gap-1.5 rounded-full bg-slate-900 px-3 text-xs font-semibold text-white"
                : "inline-flex h-8 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
            }
          >
            {f === "blocked" ? (
              <ShieldAlert className="h-3.5 w-3.5" />
            ) : f === "approved" ? (
              <ShieldCheck className="h-3.5 w-3.5" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5" />
            )}
            {f === "blocked"
              ? `Blocked (${blocked24h} new)`
              : f === "approved"
                ? "Approved"
                : "All"}
          </a>
        ))}
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="Nothing to show"
          hint={
            activeFilter === "blocked"
              ? "No suspicious activity recorded yet. The admin email alert fires when this fills up."
              : activeFilter === "approved"
                ? "No approved comments yet."
                : "No comments yet."
          }
        />
      ) : (
        <Card title={`Recent comments (${activeFilter})`}>
          <ul className="divide-y divide-slate-100">
            {items.map((c) => (
              <li key={c.id} className="py-3.5">
                <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <Link
                    href={`/m/${c.briefingSlug}`}
                    target="_blank"
                    className="inline-flex items-center gap-1 font-mono text-[11px] text-slate-500 transition hover:text-slate-900 hover:underline"
                  >
                    <Hash className="h-3 w-3 text-slate-400" />
                    {c.briefingSlug}
                    <ExternalLink className="h-3 w-3 text-slate-400" />
                  </Link>
                  <span className="text-slate-300">·</span>
                  <span className="text-[12.5px] font-semibold text-slate-900">
                    {c.displayName}
                  </span>
                  <span className="text-slate-300">·</span>
                  <span className="text-[11px] text-slate-500">
                    {formatRelative(c.createdAt)}
                  </span>
                  {c.status === "blocked" && c.blockReason && (
                    <span className="ml-auto inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 font-mono text-[10.5px] font-semibold text-rose-700">
                      {c.blockReason}
                    </span>
                  )}
                  {c.status === "approved" && (
                    <span className="ml-auto inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-700">
                      approved
                    </span>
                  )}
                </header>
                <p className="mt-1.5 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-slate-700">
                  {c.body}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                  <span>
                    ip hash:{" "}
                    <code className="text-[10.5px]">
                      {c.ipHash ? c.ipHash.slice(0, 10) + "…" : "—"}
                    </code>
                  </span>
                  <span>·</span>
                  <span>
                    ua hash:{" "}
                    <code className="text-[10.5px]">
                      {c.uaHash ? c.uaHash.slice(0, 10) + "…" : "—"}
                    </code>
                  </span>
                  <span className="ml-auto inline-flex items-center gap-1.5">
                    {c.status === "blocked" ? (
                      <ConfirmForm
                        action={setCommentStatus}
                        confirmMessage="Approve this comment? It will appear publicly."
                        className="inline"
                      >
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="status" value="approved" />
                        <button
                          type="submit"
                          className="inline-flex h-7 items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100"
                        >
                          <ShieldCheck className="h-3 w-3" />
                          Approve
                        </button>
                      </ConfirmForm>
                    ) : (
                      <ConfirmForm
                        action={setCommentStatus}
                        confirmMessage="Block this comment? It will be hidden from the public discussion."
                        className="inline"
                      >
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="status" value="blocked" />
                        <button
                          type="submit"
                          className="inline-flex h-7 items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 text-[11px] font-semibold text-rose-700 hover:bg-rose-100"
                        >
                          <ShieldAlert className="h-3 w-3" />
                          Block
                        </button>
                      </ConfirmForm>
                    )}
                    {/* Hard-delete — for obvious spam / gibberish we
                        don't need to keep around. Goes through a
                        second confirm because it's irreversible. */}
                    <ConfirmForm
                      action={deleteComment}
                      confirmMessage="Permanently delete this comment? This cannot be undone."
                      className="inline"
                    >
                      <input type="hidden" name="id" value={c.id} />
                      <button
                        type="submit"
                        className="inline-flex h-7 items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
                      >
                        <Trash2 className="h-3 w-3" />
                        Delete
                      </button>
                    </ConfirmForm>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
