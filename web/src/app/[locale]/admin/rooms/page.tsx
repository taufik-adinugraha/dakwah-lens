import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import {
  Activity,
  AlertTriangle,
  ExternalLink,
  Flame,
  Hash,
  Lock,
  MessageSquare,
  Moon,
  Pin,
  Send,
  ShieldCheck,
  Sprout,
  Unlock,
  Users,
} from "lucide-react";

import { auth } from "@/auth";
import { Link } from "@/i18n/navigation";
import { localeAwareFormatDateTime } from "@/lib/date-id";
import {
  listRecentRoomComments,
  listRoomOverviews,
  postAdminReply,
  postOfflineInvite,
  togglePinComment,
  toggleRoomMute,
  type RoomOverview,
} from "./actions";

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
    icon: typeof Activity;
    bg: string;
    text: string;
    border: string;
  }
> = {
  needs_attention: {
    label: "Needs attention",
    icon: AlertTriangle,
    bg: "bg-rose-50",
    text: "text-rose-700",
    border: "border-rose-200",
  },
  very_active: {
    label: "Very active",
    icon: Flame,
    bg: "bg-orange-50",
    text: "text-orange-700",
    border: "border-orange-200",
  },
  active: {
    label: "Active",
    icon: Activity,
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    border: "border-emerald-200",
  },
  dormant_with_seed: {
    label: "Quiet · had traffic",
    icon: Sprout,
    bg: "bg-amber-50",
    text: "text-amber-700",
    border: "border-amber-200",
  },
  dormant: {
    label: "Dormant",
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

export default async function RoomsPage({
  params,
}: PageProps<"/[locale]/admin/rooms">) {
  const { locale } = await params;
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

  const rooms = await listRoomOverviews();

  // Lightweight rollup for the header strip.
  const buckets: Record<RoomStatus, number> = {
    needs_attention: 0,
    very_active: 0,
    active: 0,
    dormant_with_seed: 0,
    dormant: 0,
  };
  for (const r of rooms) buckets[deriveStatus(r)]++;

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

      {/* Status pill strip */}
      <div className="mb-6 grid gap-2 sm:grid-cols-5">
        {(Object.keys(buckets) as RoomStatus[]).map((s) => {
          const m = STATUS_META[s];
          const Icon = m.icon;
          return (
            <div
              key={s}
              className={`rounded-2xl border ${m.border} ${m.bg} px-4 py-3`}
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
            </div>
          );
        })}
      </div>

      {rooms.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-10 text-center">
          <p className="text-sm font-semibold text-slate-700">
            No briefings in the last 90 days.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Once briefings start landing, each one&apos;s discussion room will
            appear here.
          </p>
        </div>
      ) : (
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
      )}
    </div>
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

      {/* Stats strip */}
      <dl className="grid grid-cols-3 gap-3 border-b border-slate-100 px-5 py-3 sm:grid-cols-6">
        <Stat label="Approved (24h)" value={room.approved24h} />
        <Stat
          label="Blocked (24h)"
          value={room.blocked24h}
          tone={room.blocked24h > 0 ? "rose" : undefined}
        />
        <Stat label="Approved (7d)" value={room.approved7d} />
        <Stat label="Unique IPs (7d)" value={room.uniqueIps7d} />
        <Stat label="Admin replies" value={room.adminReplies} />
        <Stat
          label="Last activity"
          valueText={
            room.lastActivityAt
              ? relativeShort(room.lastActivityAt)
              : "—"
          }
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

        {/* Side actions: offline invite + mute toggle */}
        <div className="flex flex-col gap-2 sm:w-56">
          <form action={postOfflineInvite}>
            <input type="hidden" name="slug" value={room.slug} />
            <button
              type="submit"
              className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 text-[11.5px] font-semibold text-emerald-800 hover:bg-emerald-100"
            >
              <Users className="h-3.5 w-3.5" />
              Invite offline (pinned)
            </button>
          </form>
          <form action={toggleRoomMute}>
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
          </form>
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
}: {
  label: string;
  value?: number;
  valueText?: string;
  tone?: "rose";
}) {
  return (
    <div>
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
