import { notFound } from "next/navigation";

/**
 * Any unknown path under a locale (/belajar/id/…) gets the module's own
 * localized 404 (app/[locale]/not-found.tsx, inside the layout) instead of
 * Next's bare default page. Before the hub move, single-segment unknowns
 * were caught by the old top-level [surah] route; this keeps that behaviour
 * for every depth. Known routes always win over a catch-all.
 */
export default function CatchAllNotFound() {
  notFound();
}
