import { getTranslations } from "next-intl/server";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Compass,
  Layers,
} from "lucide-react";

import { Link } from "@/i18n/navigation";
import { type BriefingNavigation } from "@/lib/briefing-data";

/**
 * In-page pagination block at the bottom of a briefing.
 *
 * Three navigation affordances:
 *   1. Peer groups in the same edition (one card per group that
 *      was auto-generated this week — up to 5 of 14).
 *   2. Prev / next edition of the SAME group (arrows).
 *   3. Browse all briefings (link to /briefings).
 *
 * Hidden in print mode — the printed brief is meant to stand alone.
 */
export async function BriefPagination({
  locale,
  navigation,
  currentGroup,
}: {
  locale: string;
  navigation: BriefingNavigation;
  currentGroup: string;
}) {
  const t = await getTranslations("Insights");

  const formatEditionDate = (d: Date) =>
    d.toLocaleDateString(locale, {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Asia/Jakarta",
    });

  // Sort peers by post volume desc would require an extra query; for
  // now keep insertion order from the SQL (alphabetical by group).
  // The current group always renders first so the reader's
  // "you-are-here" anchor stays visually consistent.
  const peers = Array.from(navigation.peers.entries()).filter(
    ([key]) => key !== currentGroup,
  );

  return (
    <nav
      aria-label={t("brief_nav_aria_label")}
      className="mt-16 border-t border-slate-200 pt-10 print:hidden"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
            <Compass className="h-3 w-3" />
            {t("brief_nav_eyebrow")}
          </p>
          <h2 className="mt-3 text-balance text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            {t("brief_nav_title")}
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-slate-600">
            {t("brief_nav_body")}
          </p>
        </div>
        <Link
          href="/briefings"
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-900 hover:bg-slate-900 hover:text-white"
        >
          {t("brief_nav_view_all")}
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* Peer-group cards — up to 5 per edition (top-5 auto-pipeline). */}
      <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {/* Current group always first. */}
        <li>
          <div
            aria-current="page"
            className="group relative flex h-full flex-col rounded-2xl border-2 border-slate-900 bg-gradient-to-br from-slate-50 to-white px-4 py-3.5 shadow-sm"
          >
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-700">
              <Layers className="h-3.5 w-3.5" />
            </span>
            <p className="mt-2.5 text-sm font-bold text-slate-900">
              {currentGroup}
            </p>
            <p className="mt-2 inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-emerald-700">
              <CheckCircle2 className="h-3 w-3" />
              {t("brief_nav_current")}
            </p>
          </div>
        </li>
        {peers.map(([group, peer]) => (
          <li key={group}>
            <Link
              href={`/briefings/${peer.slug}`}
              className="group relative flex h-full flex-col rounded-2xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-900 hover:shadow-md"
            >
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition group-hover:bg-slate-900 group-hover:text-white">
                <Layers className="h-3.5 w-3.5" />
              </span>
              <p className="mt-2.5 text-sm font-bold text-slate-900">
                {group}
              </p>
              <p className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-slate-500 transition group-hover:text-slate-900">
                {t("brief_nav_open")}
                <ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" />
              </p>
            </Link>
          </li>
        ))}
      </ul>

      {/* Prev/next edition arrows for the SAME group. */}
      {(navigation.previous || navigation.next) && (
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {navigation.previous ? (
            <Link
              href={`/briefings/${navigation.previous.slug}`}
              className="group flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-900 hover:shadow-md"
            >
              <span className="flex items-center gap-3">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition group-hover:bg-slate-900 group-hover:text-white">
                  <ArrowLeft className="h-4 w-4" />
                </span>
                <span>
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    {t("brief_nav_previous_edition")}
                  </span>
                  <span className="mt-0.5 block text-sm font-bold text-slate-900">
                    {formatEditionDate(navigation.previous.generatedAt)}
                  </span>
                </span>
              </span>
            </Link>
          ) : (
            <div className="hidden sm:block" />
          )}

          {navigation.next ? (
            <Link
              href={`/briefings/${navigation.next.slug}`}
              className="group flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-900 hover:shadow-md sm:flex-row-reverse sm:text-right"
            >
              <span className="flex items-center gap-3 sm:flex-row-reverse">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition group-hover:bg-slate-900 group-hover:text-white">
                  <ArrowRight className="h-4 w-4" />
                </span>
                <span>
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    {t("brief_nav_next_edition")}
                  </span>
                  <span className="mt-0.5 block text-sm font-bold text-slate-900">
                    {formatEditionDate(navigation.next.generatedAt)}
                  </span>
                </span>
              </span>
            </Link>
          ) : (
            <div className="hidden sm:block" />
          )}
        </div>
      )}
    </nav>
  );
}
