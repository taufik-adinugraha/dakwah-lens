"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Flame, MessageCircle } from "lucide-react";

import { Link } from "@/i18n/navigation";

/**
 * Sticky "Diskusi kamu masih hangat" chip on /insights.
 *
 * Reads `dl_watched` from localStorage — a `{slug → lastSeenMs}` map
 * set whenever the user successfully posts in a /m/{slug} room. For
 * each watched slug we ask `/api/m/rooms/activity?slugs=…` how many
 * approved comments exist and when the last one landed. If any room
 * has activity newer than the user's last-seen timestamp, we render
 * a clickable chip linking back. Dismissible per session.
 *
 * Entirely client-side — no SSR cost, no server tracking. The chip is
 * hidden cleanly when there's nothing to show.
 */

type Probe = {
  slug: string;
  approvedTotal: number;
  lastActivityAt: string | null;
};

const STORAGE_KEY = "dl_watched";
const DISMISS_KEY_PREFIX = "dl_nudge_dismissed:";

export function WatchedRoomsNudge() {
  const [hot, setHot] = useState<
    { slug: string; newSince: number; total: number } | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 1. Read watched-slugs map from localStorage.
      let watched: Record<string, number> = {};
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) watched = JSON.parse(raw) as Record<string, number>;
      } catch {
        return;
      }
      const slugs = Object.keys(watched);
      if (slugs.length === 0) return;

      // 2. Hit the activity probe.
      let probe: Probe[] = [];
      try {
        const r = await fetch(
          `/api/m/rooms/activity?slugs=${encodeURIComponent(slugs.join(","))}`,
          { cache: "no-store" },
        );
        if (!r.ok) return;
        const data = (await r.json()) as { rooms: Probe[] };
        probe = data.rooms;
      } catch {
        return;
      }
      if (cancelled) return;

      // 3. Find the freshest room with activity newer than last-seen.
      let best: { slug: string; activityMs: number; total: number } | null = null;
      for (const p of probe) {
        if (!p.lastActivityAt) continue;
        const activityMs = new Date(p.lastActivityAt).getTime();
        if (!Number.isFinite(activityMs)) continue;
        const lastSeen = watched[p.slug] ?? 0;
        // Tolerance: 60s — avoids flickering the nudge to the very
        // poster who just submitted (their own comment counts as
        // activity, but their localStorage write happens after).
        if (activityMs <= lastSeen + 60_000) continue;
        // Dismissed already this nudge-cycle?
        const dismissedRaw = window.sessionStorage.getItem(
          `${DISMISS_KEY_PREFIX}${p.slug}`,
        );
        if (dismissedRaw && Number(dismissedRaw) >= activityMs) continue;
        if (!best || activityMs > best.activityMs) {
          best = { slug: p.slug, activityMs, total: p.approvedTotal };
        }
      }
      if (best) {
        setHot({
          slug: best.slug,
          newSince: best.activityMs,
          total: best.total,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!hot) return null;

  const dismiss = () => {
    try {
      window.sessionStorage.setItem(
        `${DISMISS_KEY_PREFIX}${hot.slug}`,
        String(hot.newSince),
      );
    } catch {
      /* private mode — silent */
    }
    setHot(null);
  };

  return (
    <div className="mx-auto mb-2 max-w-6xl px-4 sm:px-6">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 px-4 py-3 shadow-sm sm:px-5">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
          <Flame className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-bold text-slate-900">
            Diskusi kamu masih hangat
          </p>
          <p className="mt-0.5 truncate text-[11.5px] text-slate-600">
            <MessageCircle className="-mt-0.5 mr-1 inline h-3 w-3" />
            {hot.total} komen di ruang yang kamu ikuti
          </p>
        </div>
        <Link
          href={`/m/${hot.slug}`}
          className="inline-flex h-8 items-center gap-1 rounded-full bg-slate-900 px-3 text-[11.5px] font-semibold text-white shadow-sm hover:bg-slate-700"
        >
          Buka
          <ArrowUpRight className="h-3 w-3" />
        </Link>
        <button
          type="button"
          onClick={dismiss}
          className="text-[11px] font-semibold text-slate-500 hover:text-slate-900"
          aria-label="Dismiss"
        >
          Tutup
        </button>
      </div>
    </div>
  );
}
