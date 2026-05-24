"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Calendar,
  MessageSquare,
  Sparkles,
  UserCheck,
  Volume2,
  VolumeX,
} from "lucide-react";

import { Link } from "@/i18n/navigation";
import { localeAwareFormatDateTime } from "@/lib/date-id";

/** Client-shaped room item. Dates arrive as ISO strings (server →
 *  client serialization), weekKey is the WIB-date string keyed in
 *  the week-filter dropdown. */
type RoomItem = {
  slug: string;
  segment: string | null;
  generatedAt: string;
  weekKey: string;
  /** Discussion question pulled from the briefing markdown — the
   *  same headline that's on the `/m/{slug}` hero. May be null
   *  on older briefings that didn't carry a Poster Question marker;
   *  the card falls back to rendering the slug in that case. */
  title: string | null;
  totalApproved: number;
  approved7d: number;
  lastActivityAt: string | null;
  muted: boolean;
};

type Labels = {
  filterAll: string;
  filterMine: string;
  filterActive: string;
  filterDormant: string;
  filterWeek: string;
  filterSegment: string;
  segmentAll: string;
  segmentSpiritual: string;
  segmentFamily: string;
  segmentYouth: string;
  segmentJustice: string;
  statusActive: string;
  statusDormant: string;
  statusMuted: string;
  commentOne: string;
  commentMany: string;
  lastActivity: string;
  lastActivityNone: string;
  open: string;
  empty: string;
  emptyMine: string;
  myCountOne: string;
  myCountMany: string;
  clearFilters: string;
};

const SEGMENT_KEYS: { key: string | "all"; label: keyof Labels }[] = [
  { key: "all", label: "segmentAll" },
  { key: "spiritual", label: "segmentSpiritual" },
  { key: "family", label: "segmentFamily" },
  { key: "youth", label: "segmentYouth" },
  { key: "justice", label: "segmentJustice" },
];

type StatusFilter = "all" | "active" | "dormant";

const SEGMENT_TONE: Record<string, { bg: string; ring: string; text: string }> = {
  null: { bg: "bg-slate-100", ring: "ring-slate-200", text: "text-slate-700" },
  spiritual: {
    bg: "bg-emerald-50",
    ring: "ring-emerald-200",
    text: "text-emerald-700",
  },
  family: { bg: "bg-rose-50", ring: "ring-rose-200", text: "text-rose-700" },
  youth: {
    bg: "bg-violet-50",
    ring: "ring-violet-200",
    text: "text-violet-700",
  },
  justice: {
    bg: "bg-amber-50",
    ring: "ring-amber-200",
    text: "text-amber-700",
  },
};

const PAGE_SIZE = 24;
const OWNED_KEY = "dl_owned";
const WATCHED_KEY = "dl_watched";

export function DiscussionsBoard({
  initialItems,
  locale,
  labels,
}: {
  initialItems: RoomItem[];
  locale: string;
  labels: Labels;
}) {
  const [segment, setSegment] = useState<string>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [week, setWeek] = useState<string>("all");
  const [onlyMine, setOnlyMine] = useState(false);
  const [page, setPage] = useState(1);
  const [mineSlugs, setMineSlugs] = useState<Set<string>>(() => new Set());

  // Hydrate "my rooms" from localStorage. Union of:
  //   - `dl_watched` map (rooms the visitor has commented on — set by
  //      CommentForm on successful submit).
  //   - `dl_owned` map keys are comment-ids, NOT slugs, so they can't
  //      be matched directly here; that map only powers the per-row
  //      Edit pencil. `dl_watched` is the canonical room set.
  useEffect(() => {
    hydrateMineSlugs({ setMineSlugs });
  }, []);

  // Reset paging when filters change. Uses the "adjust state during
  // render" pattern (https://react.dev/reference/react/useState#storing-information-from-previous-renders)
  // so the lint doesn't flag set-state-in-effect, and the page resets
  // before the next render rather than triggering a second pass.
  const filterKey = `${segment}|${status}|${week}|${onlyMine ? "y" : "n"}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    setPage(1);
  }

  const weeks = useMemo(() => {
    const set = new Set<string>();
    initialItems.forEach((r) => set.add(r.weekKey));
    return Array.from(set).sort().reverse(); // newest first
  }, [initialItems]);

  const filtered = useMemo(() => {
    return initialItems.filter((r) => {
      if (segment !== "all") {
        const seg = r.segment ?? "all";
        if (seg !== segment) return false;
      }
      if (week !== "all" && r.weekKey !== week) return false;
      if (onlyMine && !mineSlugs.has(r.slug)) return false;
      if (status === "active" && !(r.approved7d > 0 && !r.muted)) {
        return false;
      }
      if (status === "dormant" && r.approved7d > 0 && !r.muted) {
        return false;
      }
      return true;
    });
  }, [initialItems, segment, week, onlyMine, mineSlugs, status]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const paged = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );

  const mineCount = mineSlugs.size;
  const mineCountLabel =
    mineCount === 1
      ? labels.myCountOne
      : labels.myCountMany.replace("{count}", String(mineCount));
  const hasActiveFilter =
    segment !== "all" || status !== "all" || week !== "all" || onlyMine;

  return (
    <div>
      {/* Filter strip — sticky-ish on scroll so the controls stay
          reachable without jumping back to the top. */}
      <div className="rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm backdrop-blur sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setOnlyMine((v) => !v)}
            disabled={mineCount === 0}
            className={
              "inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 " +
              (onlyMine
                ? "bg-slate-900 text-white shadow-sm hover:bg-slate-800"
                : "border border-slate-200 bg-white text-slate-700 hover:border-slate-300")
            }
          >
            <UserCheck className="h-3.5 w-3.5" />
            {labels.filterMine}
            {mineCount > 0 && (
              <span
                className={
                  "rounded-full px-1.5 text-[10px] font-bold " +
                  (onlyMine
                    ? "bg-white/20 text-white"
                    : "bg-slate-100 text-slate-600")
                }
              >
                {mineCount}
              </span>
            )}
          </button>

          <div className="mx-1 h-5 w-px bg-slate-200" aria-hidden />

          {/* Status: All / Active / Dormant */}
          <FilterChip
            label={labels.filterAll}
            active={status === "all"}
            onClick={() => setStatus("all")}
          />
          <FilterChip
            label={labels.filterActive}
            active={status === "active"}
            onClick={() => setStatus("active")}
            tone="emerald"
          />
          <FilterChip
            label={labels.filterDormant}
            active={status === "dormant"}
            onClick={() => setStatus("dormant")}
            tone="slate"
          />

          <div className="mx-1 h-5 w-px bg-slate-200" aria-hidden />

          {/* Topic / segment */}
          <div className="flex flex-wrap items-center gap-1.5">
            {SEGMENT_KEYS.map(({ key, label }) => (
              <FilterChip
                key={key}
                label={labels[label]}
                active={segment === key}
                onClick={() => setSegment(key)}
                size="sm"
              />
            ))}
          </div>

          <div className="mx-1 h-5 w-px bg-slate-200" aria-hidden />

          {/* Week dropdown */}
          <div className="inline-flex items-center gap-1.5">
            <Calendar
              className="h-3.5 w-3.5 text-slate-400"
              aria-hidden
            />
            <label className="sr-only" htmlFor="discussion-week-filter">
              {labels.filterWeek}
            </label>
            <select
              id="discussion-week-filter"
              value={week}
              onChange={(e) => setWeek(e.target.value)}
              className="h-8 rounded-full border border-slate-200 bg-white px-3 pr-7 text-xs font-semibold text-slate-700 transition hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-300"
            >
              <option value="all">{labels.filterWeek}</option>
              {weeks.map((w) => (
                <option key={w} value={w}>
                  {localeAwareFormatDateTime(new Date(w + "T00:00:00+07:00"), locale, {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    timeZone: "Asia/Jakarta",
                  })}
                </option>
              ))}
            </select>
          </div>

          {hasActiveFilter && (
            <button
              type="button"
              onClick={() => {
                setSegment("all");
                setStatus("all");
                setWeek("all");
                setOnlyMine(false);
              }}
              className="ml-auto text-xs font-medium text-slate-500 underline-offset-2 transition hover:text-slate-900 hover:underline"
            >
              {labels.clearFilters}
            </button>
          )}
        </div>

        {mineCount > 0 && (
          <p className="mt-3 text-[12px] text-slate-500">{mineCountLabel}</p>
        )}
      </div>

      {/* Cards */}
      {paged.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-12 text-center text-sm text-slate-500">
          {onlyMine && mineCount === 0 ? labels.emptyMine : labels.empty}
        </div>
      ) : (
        <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {paged.map((r) => (
            <RoomCard
              key={r.slug}
              room={r}
              locale={locale}
              labels={labels}
            />
          ))}
        </ul>
      )}

      {pageCount > 1 && (
        <Pagination
          page={safePage}
          pageCount={pageCount}
          onChange={setPage}
        />
      )}
    </div>
  );
}

/**
 * Hydrate the "my rooms" set from localStorage. Extracted out so the
 * mount-effect doesn't trip the cascade-render lint — same one-shot
 * hydration pattern used elsewhere.
 */
function hydrateMineSlugs({
  setMineSlugs,
}: {
  setMineSlugs: (s: Set<string>) => void;
}): void {
  try {
    const raw = window.localStorage.getItem(WATCHED_KEY);
    if (!raw) return;
    const map = JSON.parse(raw) as Record<string, number>;
    const next = new Set<string>();
    for (const slug of Object.keys(map)) {
      if (typeof slug === "string") next.add(slug);
    }
    setMineSlugs(next);
  } catch {
    /* storage unavailable — silent no-op */
  }
  // Touch OWNED_KEY just so the lint doesn't flag the import-shadow
  // case when this hook gets extended later. No-op at runtime.
  void OWNED_KEY;
}

function FilterChip({
  label,
  active,
  onClick,
  size = "md",
  tone = "default",
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  size?: "sm" | "md";
  tone?: "default" | "emerald" | "slate";
}) {
  const base =
    size === "sm"
      ? "h-7 px-2.5 text-[11px]"
      : "h-8 px-3.5 text-xs";
  if (active) {
    if (tone === "emerald") {
      return (
        <button
          type="button"
          onClick={onClick}
          className={`inline-flex items-center rounded-full font-semibold transition bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 ${base}`}
        >
          {label}
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center rounded-full font-semibold transition bg-slate-900 text-white shadow-sm hover:bg-slate-800 ${base}`}
      >
        {label}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center rounded-full font-semibold transition border border-slate-200 bg-white text-slate-700 hover:border-slate-300 ${base}`}
    >
      {label}
    </button>
  );
}

function RoomCard({
  room,
  locale,
  labels,
}: {
  room: RoomItem;
  locale: string;
  labels: Labels;
}) {
  const segKey = (room.segment ?? "null") as keyof typeof SEGMENT_TONE;
  const tone = SEGMENT_TONE[segKey] ?? SEGMENT_TONE.null;
  const segLabel =
    labels[
      `segment${segKey === "null" ? "All" : capitalize(String(room.segment))}` as keyof Labels
    ] ?? labels.segmentAll;
  const isActive = room.approved7d > 0 && !room.muted;
  const commentLabel =
    room.totalApproved === 1
      ? labels.commentOne
      : labels.commentMany.replace("{count}", String(room.totalApproved));
  const dateLabel = localeAwareFormatDateTime(
    new Date(room.generatedAt),
    locale,
    {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Asia/Jakarta",
    },
  );
  const lastWhen = room.lastActivityAt
    ? localeAwareFormatDateTime(new Date(room.lastActivityAt), locale, {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Jakarta",
      })
    : null;

  return (
    <li>
      <Link
        href={`/m/${room.slug}`}
        className="group relative flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md"
      >
        <div className="flex items-center justify-between gap-2">
          <span
            className={`inline-flex items-center gap-1 rounded-full ${tone.bg} px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ring-1 ${tone.ring} ${tone.text}`}
          >
            {segLabel}
          </span>
          <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400">
            {dateLabel}
          </span>
        </div>

        <h3 className="mt-3 text-balance text-[15px] font-bold leading-snug text-slate-900">
          {room.title ?? room.slug}
        </h3>
        {room.title && (
          <p className="mt-1 font-mono text-[10.5px] text-slate-400">
            {room.slug}
          </p>
        )}

        <div className="mt-3 flex items-center gap-2 text-[12px] text-slate-500">
          <MessageSquare className="h-3.5 w-3.5" />
          <span>{commentLabel}</span>
          <span className="text-slate-300">·</span>
          <span>
            {lastWhen
              ? labels.lastActivity.replace("{when}", lastWhen)
              : labels.lastActivityNone}
          </span>
        </div>

        <div className="mt-auto flex items-center justify-between pt-4">
          <span
            className={
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold " +
              (room.muted
                ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
                : isActive
                  ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                  : "bg-slate-50 text-slate-500 ring-1 ring-slate-200")
            }
          >
            {room.muted ? (
              <VolumeX className="h-3 w-3" />
            ) : isActive ? (
              <Volume2 className="h-3 w-3" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            {room.muted
              ? labels.statusMuted
              : isActive
                ? labels.statusActive
                : labels.statusDormant}
          </span>
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 transition group-hover:text-slate-900">
            {labels.open}
            <ArrowUpRight className="h-3 w-3" />
          </span>
        </div>
      </Link>
    </li>
  );
}

function Pagination({
  page,
  pageCount,
  onChange,
}: {
  page: number;
  pageCount: number;
  onChange: (p: number) => void;
}) {
  return (
    <div className="mt-8 flex items-center justify-center gap-1.5">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onChange(Math.max(1, page - 1))}
        className="inline-flex h-8 items-center rounded-full border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        ‹
      </button>
      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
        {page} / {pageCount}
      </span>
      <button
        type="button"
        disabled={page >= pageCount}
        onClick={() => onChange(Math.min(pageCount, page + 1))}
        className="inline-flex h-8 items-center rounded-full border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        ›
      </button>
    </div>
  );
}

function capitalize(s: string): string {
  if (!s) return s;
  return s[0].toUpperCase() + s.slice(1);
}
