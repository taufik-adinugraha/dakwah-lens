import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import {
  Activity,
  AlertTriangle,
  ExternalLink,
  Filter,
  Flame,
  Hash,
  Lock,
  MessageSquare,
  Moon,
  Pin,
  Search,
  Send,
  ShieldCheck,
  Sprout,
  Unlock,
  Users,
  X,
} from "lucide-react";

import { auth } from "@/auth";
import { Link } from "@/i18n/navigation";
import { localeAwareFormatDateTime } from "@/lib/date-id";
import { ConfirmForm } from "../system/_ConfirmForm";
import {
  listRecentRoomComments,
  listRoomOverviews,
  postAdminReply,
  postOfflineInvite,
  togglePinComment,
  toggleRoomMute,
  type RoomOverview,
} from "./actions";

/** Templated body the "Invite offline" button posts as a pinned admin
 *  comment + ships to every opted-in subscriber via email. Kept in
 *  sync with the server-side template in actions.ts:postOfflineInvite. */
const OFFLINE_INVITE_BODY =
  "Diskusi ini menarik dan kami senang membacanya — yuk lanjut tatap muka. " +
  "Yang berminat, silakan reply di sini dengan usulan tanggal, waktu, dan " +
  "lokasi (atau via video call kalau beda kota). Nanti kami pilih jadwal " +
  "yang paling cocok dan konfirmasi balik. ✦ Dakwah-Lens";

const OFFLINE_INVITE_CONFIRM =
  "Akan memposting komentar admin terpin di ruang ini DAN mengirim email ke setiap subscriber yang opted-in (jika ada). Pesan yang akan terkirim:\n\n" +
  '"' +
  OFFLINE_INVITE_BODY +
  '"' +
  "\n\nLanjutkan?";

const OFFLINE_INVITE_TOOLTIP =
  'Posts a pinned admin comment in this room + emails every opted-in subscriber.\n\nTemplate: "' +
  OFFLINE_INVITE_BODY +
  '"';

// Force a fresh read every visit — admins land here right after the
// auto-email alert and expect the latest numbers.
export const dynamic = "force-dynamic";

/**
 * /admin/rooms — command center for every public /m/{slug} discussion.
 *
 * Lists each briefing's room with aggregate stats, a status label,
 * and inline admin actions:
 *   - Open the public thread in a new tab
 *   - Post a free-text admin reply
 *   - Post a templated "let's meet offline" invitation (pinned)
 *   - Pin / unpin any approved comment
 *   - Mute / unmute the room (existing comments stay; new POSTs blocked)
 *
 * Status taxonomy (computed per row):
 *   needs_attention    — blocked_24h > 0  (auto-block fired recently)
 *   very_active        — approved_24h >= 3
 *   active             — approved_7d  >= 1
 *   dormant_with_seed  — total_approved > 0 but no activity in 7d
 *   dormant            — never had a comment
 */

type RoomStatus =
  | "needs_attention"
  | "very_active"
  | "active"
  | "dormant_with_seed"
  | "dormant";

function deriveStatus(r: RoomOverview): RoomStatus {
  if (r.blocked24h > 0) return "needs_attention";
  if (r.approved24h >= 3) return "very_active";
  if (r.approved7d >= 1) return "active";
  if (r.totalApproved > 0) return "dormant_with_seed";
  return "dormant";
}

const STATUS_META: Record<
  RoomStatus,
  {
    label: string;
    description: string;
    icon: typeof Activity;
    bg: string;
    text: string;
    border: string;
  }
> = {
  needs_attention: {
    label: "Needs attention",
    description:
      "Auto-block fired in the last 24h — spam attempt, profanity, or content moderation tripped. Open the moderation log to investigate.",
    icon: AlertTriangle,
    bg: "bg-rose-50",
    text: "text-rose-700",
    border: "border-rose-200",
  },
  very_active: {
    label: "Very active",
    description:
      "≥ 3 approved comments in the last 24h. Hot thread — consider an admin reply or an offline-meet invitation.",
    icon: Flame,
    bg: "bg-orange-50",
    text: "text-orange-700",
    border: "border-orange-200",
  },
  active: {
    label: "Active",
    description:
      "≥ 1 approved comment in the last 7 days. Healthy conversation; no action needed unless you want to engage.",
    icon: Activity,
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    border: "border-emerald-200",
  },
  dormant_with_seed: {
    label: "Quiet · had traffic",
    description:
      "Had approved comments at some point, but nothing new in 7+ days. Worth a nudge — admin reply or share-push.",
    icon: Sprout,
    bg: "bg-amber-50",
    text: "text-amber-700",
    border: "border-amber-200",
  },
  dormant: {
    label: "Dormant",
    description:
      "Never received a comment. Either the article hasn't been shared enough yet, or the topic didn't resonate. Pushing the article externally is the lever.",
    icon: Moon,
    bg: "bg-slate-100",
    text: "text-slate-600",
    border: "border-slate-200",
  },
};

const SEGMENT_LABEL: Record<string, string> = {
  spiritual: "Spiritual",
  family: "Family",
  youth: "Youth",
  justice: "Justice",
  all: "All-platform",
};

const SEGMENT_KEYS: readonly string[] = [
  "all",
  "spiritual",
  "family",
  "youth",
  "justice",
];

const STATUS_KEYS: readonly RoomStatus[] = [
  "needs_attention",
  "very_active",
  "active",
  "dormant_with_seed",
  "dormant",
];

/** Parse a comma-separated filter param into a set of known values.
 *  Unknown tokens dropped silently. Empty/missing → null = no filter. */
function parseFilterSet<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
): Set<T> | null {
  if (!raw) return null;
  const allow = new Set<string>(allowed);
  const picked = new Set<T>();
  for (const t of raw.split(",")) {
    const trimmed = t.trim();
    if (allow.has(trimmed)) picked.add(trimmed as T);
  }
  return picked.size > 0 ? picked : null;
}

export default async function RoomsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/rooms">) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/admin/rooms");
  }
  const role = session.user.role;
  if (role !== "admin" && role !== "superadmin") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="text-xl font-bold">Forbidden</h1>
        <p className="mt-2 text-sm text-slate-600">
          You need admin access to view discussion rooms.
        </p>
      </div>
    );
  }

  // Parse filters from the URL query. Multiple values per param are
  // comma-separated. Unknown tokens are dropped silently so a bookmark
  // with stale values still loads (just without those filters applied).
  const statusFilter = parseFilterSet(
    typeof sp.status === "string" ? sp.status : undefined,
    STATUS_KEYS,
  );
  const segmentFilter = parseFilterSet(
    typeof sp.segment === "string" ? sp.segment : undefined,
    SEGMENT_KEYS,
  );
  const searchQ =
    typeof sp.q === "string" ? sp.q.trim().toLowerCase() : "";

  const allRooms = await listRoomOverviews();

  // Apply filters AFTER computing the unfiltered rollup so the status
  // tiles always reflect the full universe (otherwise filtering by
  // "very_active" would zero out every other bucket — confusing).
  const buckets: Record<RoomStatus, number> = {
    needs_attention: 0,
    very_active: 0,
    active: 0,
    dormant_with_seed: 0,
    dormant: 0,
  };
  for (const r of allRooms) buckets[deriveStatus(r)]++;

  const filtered = allRooms.filter((r) => {
    if (statusFilter && !statusFilter.has(deriveStatus(r))) return false;
    if (segmentFilter && !segmentFilter.has(r.segment ?? "all"))
      return false;
    if (searchQ && !r.slug.toLowerCase().includes(searchQ)) return false;
    return true;
  });

  const hasAnyFilter =
    statusFilter !== null || segmentFilter !== null || !!searchQ;

  // Pagination — server-rendered. 10 per page keeps the per-room
  // listRecentRoomComments queries bounded (each card fires its own
  // DB roundtrip). Filtering resets to page 1.
  const PER_PAGE = 10;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const rawPage = parseInt(typeof sp.page === "string" ? sp.page : "1", 10);
  const currentPage = Math.min(
    Math.max(1, Number.isFinite(rawPage) ? rawPage : 1),
    totalPages,
  );
  const pageOffset = (currentPage - 1) * PER_PAGE;
  const rooms = filtered.slice(pageOffset, pageOffset + PER_PAGE);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            <ShieldCheck className="h-3.5 w-3.5" />
            Admin
          </span>
          <h1 className="mt-2 text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Discussion rooms
          </h1>
          <p className="mt-1 max-w-2xl text-pretty text-sm text-slate-600">
            One row per <code>/m/{`{slug}`}</code> article. Engage the very
            active rooms, nudge the quiet ones, mute or pin where the thread
            needs help.
          </p>
        </div>
        <Link
          href="/admin/system/discussion"
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          Moderation log
        </Link>
      </header>

      {/* Status pill strip — click any tile to filter the list to that
          status. Tile shows count of ALL rooms in that bucket (not the
          filtered subset). Tooltip on hover explains the threshold. */}
      <div className="mb-4 grid gap-2 sm:grid-cols-5">
        {STATUS_KEYS.map((s) => {
          const m = STATUS_META[s];
          const Icon = m.icon;
          const isActive = !!statusFilter?.has(s);
          const linkUrl = isActive
            ? // Already active — click again to clear.
              buildFilterUrl(sp, { status: null, page: null })
            : buildFilterUrl(sp, { status: s, page: null });
          return (
            <Link
              key={s}
              href={linkUrl}
              title={m.description}
              className={`block rounded-2xl border px-4 py-3 transition hover:-translate-y-0.5 hover:shadow-md ${m.border} ${m.bg} ${
                isActive ? "ring-2 ring-offset-1 ring-slate-900" : ""
              }`}
            >
              <div className="flex items-center gap-2">
                <Icon className={`h-3.5 w-3.5 ${m.text}`} />
                <span
                  className={`text-[11px] font-bold uppercase tracking-wider ${m.text}`}
                >
                  {m.label}
                </span>
              </div>
              <p className="mt-1 text-2xl font-extrabold tabular-nums text-slate-900">
                {buckets[s]}
              </p>
              <p className="mt-0.5 line-clamp-2 text-[10.5px] leading-snug text-slate-600">
                {m.description}
              </p>
            </Link>
          );
        })}
      </div>

      {/* Filter toolbar — segment chips + search input. Server-rendered
          via URL searchParams so filters are bookmarkable + shareable. */}
      <div className="mb-5 rounded-2xl border border-slate-200 bg-slate-50/60 p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-slate-600">
            <Filter className="h-3 w-3" />
            Segment
          </span>
          {SEGMENT_KEYS.map((seg) => {
            const isActive = !!segmentFilter?.has(seg);
            const next = isActive
              ? buildFilterUrl(sp, { segment: null, page: null })
              : buildFilterUrl(sp, { segment: seg, page: null });
            return (
              <Link
                key={seg}
                href={next}
                className={
                  isActive
                    ? "inline-flex h-7 items-center rounded-full bg-slate-900 px-3 text-[11px] font-bold uppercase tracking-wider text-white"
                    : "inline-flex h-7 items-center rounded-full border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                }
              >
                {SEGMENT_LABEL[seg] ?? seg}
              </Link>
            );
          })}
          <span className="hidden text-slate-300 sm:inline">·</span>
          <form action="/admin/rooms" method="get" className="flex flex-1 items-center gap-2">
            {/* Preserve other active filters when submitting search. */}
            {statusFilter && (
              <input
                type="hidden"
                name="status"
                value={Array.from(statusFilter).join(",")}
              />
            )}
            {segmentFilter && (
              <input
                type="hidden"
                name="segment"
                value={Array.from(segmentFilter).join(",")}
              />
            )}
            <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                name="q"
                defaultValue={searchQ}
                placeholder="Search slug (e.g. 2026-05-24-family)"
                className="block h-8 w-full rounded-full border border-slate-200 bg-white pl-8 pr-3 text-[12px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300"
              />
            </div>
          </form>
          {hasAnyFilter && (
            <Link
              href="/admin/rooms"
              className="inline-flex h-7 items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-3 text-[11px] font-semibold text-rose-700 hover:bg-rose-100"
            >
              <X className="h-3 w-3" />
              Clear filters
            </Link>
          )}
          <span className="ml-auto text-[11px] text-slate-500">
            {filtered.length === 0
              ? `0 of ${allRooms.length}`
              : `${pageOffset + 1}–${Math.min(pageOffset + rooms.length, filtered.length)} of ${filtered.length}`}
            {hasAnyFilter && ` · filtered from ${allRooms.length}`}
          </span>
        </div>
      </div>

      {rooms.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-10 text-center">
          <p className="text-sm font-semibold text-slate-700">
            {hasAnyFilter
              ? "No rooms match these filters."
              : "No briefings in the last 90 days."}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {hasAnyFilter ? (
              <>
                Try{" "}
                <Link
                  href="/admin/rooms"
                  className="font-semibold text-emerald-700 underline"
                >
                  clearing the filters
                </Link>
                .
              </>
            ) : (
              "Once briefings start landing, each one's discussion room will appear here."
            )}
          </p>
        </div>
      ) : (
        <>
          <ul className="space-y-3">
            {await Promise.all(
              rooms.map(async (r) => {
                const status = deriveStatus(r);
                const recent = await listRecentRoomComments(r.slug, 3);
                return (
                  <RoomCard
                    key={r.slug}
                    room={r}
                    status={status}
                    recent={recent}
                    locale={locale}
                  />
                );
              }),
            )}
          </ul>

          {totalPages > 1 && (
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              currentParams={sp}
            />
          )}
        </>
      )}
    </div>
  );
}

/**
 * Pagination footer. Server-rendered links — each Prev / Next / page
 * number is a Link that preserves the current filter searchParams.
 * Small window of pages shown (current ± 2) plus first / last when
 * they're outside the window.
 */
function Pagination({
  currentPage,
  totalPages,
  currentParams,
}: {
  currentPage: number;
  totalPages: number;
  currentParams: Record<string, string | string[] | undefined>;
}) {
  // Build the visible page list with ellipsis on either side.
  const window: (number | "…")[] = [];
  const push = (n: number | "…") => {
    if (window[window.length - 1] !== n) window.push(n);
  };
  push(1);
  if (currentPage - 2 > 2) push("…");
  for (
    let p = Math.max(2, currentPage - 2);
    p <= Math.min(totalPages - 1, currentPage + 2);
    p++
  ) {
    push(p);
  }
  if (currentPage + 2 < totalPages - 1) push("…");
  if (totalPages > 1) push(totalPages);

  const linkFor = (n: number) =>
    buildFilterUrl(currentParams, { page: n === 1 ? null : String(n) });

  return (
    <nav
      aria-label="Rooms pagination"
      className="mt-6 flex flex-wrap items-center justify-center gap-1.5"
    >
      <Link
        href={
          currentPage > 1
            ? linkFor(currentPage - 1)
            : "#"
        }
        aria-disabled={currentPage <= 1}
        className={
          currentPage > 1
            ? "inline-flex h-8 items-center rounded-full border border-slate-200 bg-white px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-100"
            : "inline-flex h-8 cursor-not-allowed items-center rounded-full border border-slate-200 bg-slate-50 px-3 text-[12px] font-semibold text-slate-300"
        }
      >
        ← Prev
      </Link>
      {window.map((p, i) =>
        p === "…" ? (
          <span
            key={`gap-${i}`}
            className="px-1.5 text-[12px] text-slate-400"
          >
            …
          </span>
        ) : (
          <Link
            key={p}
            href={linkFor(p)}
            className={
              p === currentPage
                ? "inline-flex h-8 min-w-8 items-center justify-center rounded-full bg-slate-900 px-3 text-[12px] font-bold text-white"
                : "inline-flex h-8 min-w-8 items-center justify-center rounded-full border border-slate-200 bg-white px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-100"
            }
            aria-current={p === currentPage ? "page" : undefined}
          >
            {p}
          </Link>
        ),
      )}
      <Link
        href={
          currentPage < totalPages
            ? linkFor(currentPage + 1)
            : "#"
        }
        aria-disabled={currentPage >= totalPages}
        className={
          currentPage < totalPages
            ? "inline-flex h-8 items-center rounded-full border border-slate-200 bg-white px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-100"
            : "inline-flex h-8 cursor-not-allowed items-center rounded-full border border-slate-200 bg-slate-50 px-3 text-[12px] font-semibold text-slate-300"
        }
      >
        Next →
      </Link>
    </nav>
  );
}

function RoomCard({
  room,
  status,
  recent,
  locale,
}: {
  room: RoomOverview;
  status: RoomStatus;
  recent: Awaited<ReturnType<typeof listRecentRoomComments>>;
  locale: string;
}) {
  const m = STATUS_META[status];
  const StatusIcon = m.icon;
  const segLabel = SEGMENT_LABEL[room.segment ?? "all"] ?? "All-platform";
  const generatedLabel = localeAwareFormatDateTime(room.generatedAt, locale, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Jakarta",
  });

  return (
    <li className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Top row — title + meta + status chip + open link */}
      <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider ${m.bg} ${m.text} ${m.border}`}
            >
              <StatusIcon className="h-3 w-3" />
              {m.label}
            </span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-slate-700">
              {segLabel}
            </span>
            {room.muted && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-amber-700">
                <Lock className="h-3 w-3" />
                Muted
              </span>
            )}
            {room.totalPinned > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-indigo-700">
                <Pin className="h-3 w-3" />
                {room.totalPinned} pinned
              </span>
            )}
          </div>
          <h3 className="mt-2 truncate font-mono text-sm font-semibold text-slate-900">
            <Hash className="-mt-0.5 mr-0.5 inline h-3.5 w-3.5 text-slate-400" />
            {room.slug}
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">{generatedLabel}</p>
        </div>
        <a
          href={`/${locale}/m/${room.slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-8 shrink-0 items-center gap-1.5 self-start rounded-full border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Open room
        </a>
      </div>

      {/* Stats strip — each tile carries a `title=` tooltip explaining
          what the count means (hover for full text on desktop). */}
      <dl className="grid grid-cols-3 gap-3 border-b border-slate-100 px-5 py-3 sm:grid-cols-6">
        <Stat
          label="Approved (24h)"
          value={room.approved24h}
          tooltip="Approved (public-visible) comments posted in the last 24 hours. Spikes here drive the 'Very active' status badge."
        />
        <Stat
          label="Blocked (24h)"
          value={room.blocked24h}
          tone={room.blocked24h > 0 ? "rose" : undefined}
          tooltip="Comments the auto-moderation pipeline rejected in the last 24 hours (gambling/pinjol/profanity/honeypot/bad-token/duplicate). Non-zero triggers 'Needs attention'."
        />
        <Stat
          label="Approved (7d)"
          value={room.approved7d}
          tooltip="Approved comments in the last 7 days. Drives the 'Active' status."
        />
        <Stat
          label="Unique IPs (7d)"
          value={room.uniqueIps7d}
          tooltip="Count of distinct ip_hash values across approved + blocked comments in the last 7 days. Proxy for 'how many different people interacted'."
        />
        <Stat
          label="Admin replies"
          value={room.adminReplies}
          tooltip="Admin posts in this room (display name 'Dakwah-Lens · Admin'). Use the Reply / Invite offline buttons below to add more."
        />
        <Stat
          label="Last activity"
          valueText={
            room.lastActivityAt
              ? relativeShort(room.lastActivityAt)
              : "—"
          }
          tooltip="Time since the most recent approved comment (regardless of who posted). '—' means no approved comments ever."
        />
      </dl>

      {/* Recent thread preview */}
      {recent.length > 0 && (
        <div className="border-b border-slate-100 px-5 py-3">
          <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-slate-500">
            Recent comments
          </div>
          <ul className="space-y-1.5">
            {recent.map((c) => (
              <li
                key={c.id}
                className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2"
              >
                <header className="flex flex-wrap items-baseline gap-2">
                  <span className="text-[12px] font-semibold text-slate-800">
                    {c.displayName}
                  </span>
                  {c.pinned && (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-indigo-100 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-indigo-700">
                      <Pin className="h-2.5 w-2.5" />
                      Pinned
                    </span>
                  )}
                  <span className="ml-auto text-[10.5px] text-slate-400">
                    {relativeShort(c.createdAt)}
                  </span>
                </header>
                <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-[12.5px] leading-snug text-slate-700">
                  {c.body}
                </p>
                <form action={togglePinComment} className="mt-1">
                  <input type="hidden" name="id" value={c.id} />
                  <button
                    type="submit"
                    className="inline-flex h-6 items-center gap-1 rounded-full border border-slate-200 bg-white px-2 text-[10.5px] font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    <Pin className="h-2.5 w-2.5" />
                    {c.pinned ? "Unpin" : "Pin"}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Admin actions row */}
      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start">
        {/* Quick reply */}
        <form
          action={postAdminReply}
          className="min-w-0 flex-1 space-y-2"
        >
          <input type="hidden" name="slug" value={room.slug} />
          <label className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider text-slate-500">
            <MessageSquare className="h-3 w-3" />
            Reply as Dakwah-Lens · Admin
          </label>
          <textarea
            name="body"
            rows={2}
            maxLength={1000}
            required
            minLength={2}
            placeholder="Tulis tanggapan singkat, pertanyaan balik, atau apresiasi…"
            className="block w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300"
          />
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600">
              <input
                type="checkbox"
                name="pinned"
                value="1"
                defaultChecked={false}
                className="h-3.5 w-3.5 rounded border-slate-300"
              />
              Pin to top
            </label>
            <button
              type="submit"
              className="inline-flex h-8 items-center gap-1.5 rounded-full bg-slate-900 px-3 text-xs font-semibold text-white shadow-sm hover:bg-slate-700"
            >
              <Send className="h-3.5 w-3.5" />
              Post reply
            </button>
          </div>
        </form>

        {/* Side actions: offline invite + mute toggle. Both wrapped
            in ConfirmForm — one click would otherwise post a pinned
            comment + email every subscriber (offline invite) or hide
            the form (mute). Native confirm() is enough friction. */}
        <div className="flex flex-col gap-2 sm:w-56">
          <ConfirmForm
            action={postOfflineInvite}
            confirmMessage={OFFLINE_INVITE_CONFIRM}
          >
            <input type="hidden" name="slug" value={room.slug} />
            <button
              type="submit"
              title={OFFLINE_INVITE_TOOLTIP}
              className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 text-[11.5px] font-semibold text-emerald-800 hover:bg-emerald-100"
            >
              <Users className="h-3.5 w-3.5" />
              Invite offline (pinned)
            </button>
          </ConfirmForm>
          <ConfirmForm
            action={toggleRoomMute}
            confirmMessage={
              room.muted
                ? "Unmute this room? Public POSTs will be accepted again immediately."
                : "Mute this room? New public POSTs will be rejected with HTTP 423. Existing comments stay visible. You can unmute anytime."
            }
          >
            <input type="hidden" name="slug" value={room.slug} />
            <input
              type="hidden"
              name="target"
              value={room.muted ? "unmute" : "mute"}
            />
            {!room.muted && (
              <input
                type="hidden"
                name="mute_reason"
                value="Thread cooling off"
              />
            )}
            <button
              type="submit"
              title={
                room.muted
                  ? "Re-open this room to public submissions."
                  : "Reject new public submissions to this room. Existing comments stay visible. POST returns HTTP 423."
              }
              className={
                room.muted
                  ? "inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 text-[11.5px] font-semibold text-amber-800 hover:bg-amber-100"
                  : "inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-[11.5px] font-semibold text-slate-700 hover:bg-slate-50"
              }
            >
              {room.muted ? (
                <>
                  <Unlock className="h-3.5 w-3.5" />
                  Unmute room
                </>
              ) : (
                <>
                  <Lock className="h-3.5 w-3.5" />
                  Mute new submissions
                </>
              )}
            </button>
          </ConfirmForm>
        </div>
      </div>
    </li>
  );
}

function Stat({
  label,
  value,
  valueText,
  tone,
  tooltip,
}: {
  label: string;
  value?: number;
  valueText?: string;
  tone?: "rose";
  /** Native `title=` tooltip — full explanation on hover. */
  tooltip?: string;
}) {
  return (
    <div
      title={tooltip}
      className={tooltip ? "cursor-help" : undefined}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div
        className={
          tone === "rose"
            ? "text-base font-bold tabular-nums text-rose-700"
            : "text-base font-bold tabular-nums text-slate-900"
        }
      >
        {valueText ?? String(value ?? 0)}
      </div>
    </div>
  );
}

/**
 * Build a `/admin/rooms?...` URL from the current searchParams plus
 * a patch (set a key to null to clear it). Used by the filter chips
 * + status tile links so toggling stays inside the page without a
 * page-state library.
 *
 * For status / segment filters, we currently support single-value
 * toggle from the chip UI; the underlying parser still accepts
 * comma-separated multi-value if someone types a URL by hand.
 */
function buildFilterUrl(
  current: Record<string, string | string[] | undefined>,
  patch: Record<string, string | null>,
): string {
  const params = new URLSearchParams();
  // Copy current params, skipping any key being patched.
  for (const [k, v] of Object.entries(current)) {
    if (k in patch) continue;
    if (typeof v === "string") params.set(k, v);
    else if (Array.isArray(v) && v.length > 0) params.set(k, v[0]);
  }
  // Apply patch: string = set, null = clear (already skipped above).
  for (const [k, v] of Object.entries(patch)) {
    if (v !== null) params.set(k, v);
  }
  const qs = params.toString();
  return qs ? `/admin/rooms?${qs}` : "/admin/rooms";
}

function relativeShort(d: Date): string {
  const diff = Date.now() - d.getTime();
  const m = Math.round(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const days = Math.round(h / 24);
  if (days < 30) return `${days}d`;
  return d.toLocaleDateString();
}
