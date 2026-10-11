"use client";

import { useEffect, useState } from "react";

/** A surah as the end of a lesson names it. */
export type SurahRef = { slug: string; name: string };

/** What the end of a surah offers after it: a surah to go on to, or the one coming soon. */
export type UpNext = { next: SurahRef | null; soon: SurahRef | null };

/** Lists the published surahs (src/app/api/surahs/route.ts; BELAJAR_SURAHS, lib/features.ts). */
export const SURAHS_API = "/belajar/api/surahs";

/**
 * The end of a surah's lesson, given the surahs after it (mushaf order) and the published ones:
 * the first published one is offered as "Surah berikutnya"; when none is, the very next surah is
 * named as coming soon, with nothing to click (operator, 2026-10-10: Al-Fatihah first, the
 * Mu'awwidzat "segera hadir"). Unpublished surahs in between are skipped. Nothing either way after
 * the last surah, or while the published list is not known (not fetched yet, or the fetch
 * failed): a link into a hidden surah would only reach its 404.
 */
export function upNext(following: readonly SurahRef[], published: ReadonlySet<string> | null): UpNext {
  if (!published || following.length === 0) return { next: null, soon: null };
  const next = following.find((s) => published.has(s.slug)) ?? null;
  return { next, soon: next ? null : following[0] };
}

/** The `published` field of the API's answer, or null when the answer is not one. */
export function parsePublished(body: unknown): ReadonlySet<string> | null {
  const list = body && typeof body === "object" ? (body as { published?: unknown }).published : undefined;
  return Array.isArray(list) ? new Set(list.filter((x): x is string => typeof x === "string")) : null;
}

/**
 * upNext() for the lesson stage. The lesson pages are prerendered and BELAJAR_SURAHS is read per
 * request, so the published list is fetched in the browser, once, and only on a surah's last ayah
 * (the only page that passes `following`); by the time the learner reaches the end card it has
 * long arrived.
 */
export function useUpNext(following: readonly SurahRef[]): UpNext {
  const [published, setPublished] = useState<ReadonlySet<string> | null>(null);
  const wanted = following.length > 0;
  useEffect(() => {
    if (!wanted) return;
    let alive = true;
    fetch(SURAHS_API, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<unknown>) : null))
      .then((body) => {
        if (alive) setPublished(parsePublished(body));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [wanted]);
  return upNext(following, published);
}
