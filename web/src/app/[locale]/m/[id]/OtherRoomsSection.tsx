import {
  ArrowUpRight,
  Compass,
  MessageCircle,
  Sparkles,
  Clock,
} from "lucide-react";
import { getTranslations } from "next-intl/server";

import { localeAwareFormat } from "@/lib/date-id";
import { getOtherMahasiswaRooms, type OtherRoom } from "@/lib/briefing-data";
import { paletteFor } from "@/lib/theme-group-palette";

/**
 * "Lihat diskusi lain" rail at the bottom of /m/{slug}.
 *
 * A QR-arriving reader has just engaged with one room — surface the
 * neighbors so they don't dead-end. Each card shows:
 *   - Segment tag (color-coded)
 *   - Status pill (`baru` / `aktif` / `ramai` / `tenang`) — at-a-glance
 *     signal of what they're walking into
 *   - Poster question (line-clamp-3, the actual hook)
 *   - Comment count + last activity, then publish date
 *
 * Mobile-first: cards stack to a horizontal snap-scroller with peek so
 * the row visibly "has more" past the viewport. Desktop opens into a
 * 2-col (sm) → 3-col (lg) grid.
 */
export async function OtherRoomsSection({
  currentSlug,
  locale,
}: {
  currentSlug: string;
  locale: string;
}) {
  const t = await getTranslations("OtherRooms");
  // 13 = the 14 weekly theme groups minus the current room. (Was 8 — a
  // legacy cap from before the 4-segment → 14-group migration, which left
  // the rail showing only ~half the week's other rooms.) The query orders
  // by generated_at DESC over a 90-day window, so the 13 newest are this
  // week's siblings; older editions don't bleed in.
  const rooms = await getOtherMahasiswaRooms(currentSlug, 13);
  if (rooms.length === 0) return null;

  return (
    <section className="border-t border-slate-200 bg-gradient-to-b from-slate-50 to-white print:hidden">
      <div className="mx-auto max-w-5xl px-5 py-12 sm:px-8 sm:py-16">
        <header className="mb-7 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.15em] text-slate-600">
              <Compass className="h-3 w-3" />
              {t("eyebrow")}
            </span>
            <h2 className="mt-3 text-balance text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
              {t("heading")}
            </h2>
            <p className="mt-2 max-w-xl text-pretty text-sm leading-relaxed text-slate-600">
              {t("body")}
            </p>
          </div>
        </header>

        {/* Mobile: snap-scroll row. Desktop: grid. */}
        <ul
          className="
            -mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-3
            sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0
            lg:grid-cols-3
          "
          style={{ scrollbarWidth: "thin" }}
        >
          {rooms.map((r) => (
            <RoomCard key={r.slug} room={r} locale={locale} labels={makeLabels(t)} />
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────── */

type Labels = {
  status_new: string;
  status_active: string;
  status_buzzing: string;
  status_quiet: string;
  comments: string;
  last_activity: string;
  no_activity: string;
  just_now: string;
  open: string;
};

function makeLabels(t: Awaited<ReturnType<typeof getTranslations>>): Labels {
  return {
    status_new: t("status_new"),
    status_active: t("status_active"),
    status_buzzing: t("status_buzzing"),
    status_quiet: t("status_quiet"),
    comments: t("comments"),
    last_activity: t("last_activity"),
    no_activity: t("no_activity"),
    just_now: t("just_now"),
    open: t("open"),
  };
}

function RoomCard({
  room,
  locale,
  labels,
}: {
  room: OtherRoom;
  locale: string;
  labels: Labels;
}) {
  // 14-group palette lookup — shared with /discussions board. room.themeGroup
  // is the raw THEME_GROUPS label ("Hukum & Keadilan", "Teknologi & AI", …);
  // null/unknown groups fall back to the neutral palette. Migrated from the
  // local 5-key legacy SEGMENT_PALETTE on 2026-06-08 (the legacy keys
  // — all/spiritual/family/youth/justice — silently dropped every 14-group
  // briefing into the gray fallback).
  const palette = paletteFor(room.themeGroup);
  const status = deriveStatus(room);
  const statusMeta = STATUS_META[status];
  const segmentLabel = palette.label;

  const dateLabel = localeAwareFormat(room.generatedAt, locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });
  const activity = room.lastActivityAt
    ? labels.last_activity.replace(
        "{when}",
        relativeShort(room.lastActivityAt, labels.just_now),
      )
    : labels.no_activity;

  return (
    <li
      className="
        min-w-[280px] max-w-[320px] shrink-0 snap-start
        sm:min-w-0 sm:max-w-none sm:shrink
      "
    >
      <a
        href={`/${locale}/m/${room.slug}`}
        className={`group flex h-full flex-col rounded-2xl border ${palette.cardBorder} ${palette.cardBg} px-4 py-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md sm:px-5 sm:py-5`}
      >
        {/* Top row: segment chip + status pill */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${palette.chipBg} ${palette.chipText}`}
          >
            {segmentLabel}
          </span>
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${statusMeta.bg} ${statusMeta.text} ${statusMeta.border}`}
          >
            <statusMeta.Icon className="h-2.5 w-2.5" />
            {labels[statusMeta.labelKey]}
          </span>
        </div>

        {/* Poster question — the hook. */}
        <p
          className="mt-3 line-clamp-3 text-pretty text-[15px] font-semibold leading-snug text-slate-900 sm:text-[15.5px]"
          style={{ minHeight: "3.4rem" }}
        >
          <span className="mr-1 opacity-40">&ldquo;</span>
          {room.question}
        </p>

        {/* Spacer — push the bottom row down. */}
        <div className="mt-auto pt-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11.5px] text-slate-600">
            <span className="inline-flex items-baseline gap-1 font-semibold">
              <MessageCircle className="h-3 w-3 self-center" />
              {room.approvedTotal} {labels.comments}
            </span>
            <span className="text-slate-300">·</span>
            <span className="inline-flex items-baseline gap-1">
              <Clock className="h-3 w-3 self-center" />
              {activity}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-xs text-slate-500">{dateLabel}</span>
            <span
              className={`inline-flex items-center gap-1 text-xs font-semibold transition group-hover:gap-1.5 ${palette.openText}`}
            >
              {labels.open}
              <ArrowUpRight className="h-3 w-3" />
            </span>
          </div>
        </div>
      </a>
    </li>
  );
}

/* ─────────────────────────────────────────────────────────── */

type RoomStatus = "new" | "active" | "buzzing" | "quiet";

function deriveStatus(r: OtherRoom): RoomStatus {
  const ageDays = (Date.now() - r.generatedAt.getTime()) / 86_400_000;
  if (r.approved7d >= 5) return "buzzing";
  if (r.approved7d >= 1) return "active";
  if (ageDays <= 7) return "new";
  return "quiet";
}

const STATUS_META: Record<
  RoomStatus,
  {
    labelKey: keyof Labels;
    Icon: typeof Sparkles;
    bg: string;
    text: string;
    border: string;
  }
> = {
  buzzing: {
    labelKey: "status_buzzing",
    Icon: Sparkles,
    bg: "bg-orange-50",
    text: "text-orange-700",
    border: "border-orange-200",
  },
  active: {
    labelKey: "status_active",
    Icon: MessageCircle,
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    border: "border-emerald-200",
  },
  new: {
    labelKey: "status_new",
    Icon: Sparkles,
    bg: "bg-indigo-50",
    text: "text-indigo-700",
    border: "border-indigo-200",
  },
  quiet: {
    labelKey: "status_quiet",
    Icon: Clock,
    bg: "bg-slate-50",
    text: "text-slate-600",
    border: "border-slate-200",
  },
};

// Per-segment palette lives in `@/lib/theme-group-palette` since
// 2026-06-08 — was a local 5-key (all/spiritual/family/youth/justice)
// that silently dropped all 14-group briefings into a gray fallback.

function relativeShort(d: Date, justNow: string): string {
  const diff = Date.now() - d.getTime();
  const m = Math.round(diff / 60_000);
  if (m < 1) return justNow;
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const days = Math.round(h / 24);
  if (days < 30) return `${days}d`;
  return d.toLocaleDateString();
}
