import { getTranslations } from "next-intl/server";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Compass,
  HeartHandshake,
  Layers,
  Scale,
  Sparkles,
  Users,
} from "lucide-react";

import { Link } from "@/i18n/navigation";
import {
  BRIEFING_SEGMENTS,
  type BriefingNavigation,
} from "@/lib/insights-data";

/**
 * In-page pagination block at the bottom of a briefing.
 *
 * Three navigation affordances:
 *   1. Peer segments in the same edition (one card per segment).
 *   2. Prev / next edition of the SAME segment (arrows).
 *   3. Browse all briefings (link to /insights).
 *
 * Hidden in print mode — the printed brief is meant to stand alone.
 */
export async function BriefPagination({
  locale,
  navigation,
  currentSegment,
}: {
  locale: string;
  navigation: BriefingNavigation;
  currentSegment: string | null;
}) {
  const t = await getTranslations("Insights");

  const currentKey = currentSegment ?? "all";

  const formatEditionDate = (d: Date) =>
    d.toLocaleDateString(locale, {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Asia/Jakarta",
    });

  const segmentMeta = (segment: string | null) => {
    const key = segment ?? "all";
    return SEGMENT_META[key as keyof typeof SEGMENT_META];
  };

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
          href="/insights"
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-900 hover:bg-slate-900 hover:text-white"
        >
          {t("brief_nav_view_all")}
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* Peer-segment cards. */}
      <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {BRIEFING_SEGMENTS.map((segment) => {
          const key = segment ?? "all";
          const peer = navigation.peers.get(key);
          const isCurrent = key === currentKey;
          const meta = segmentMeta(segment);
          const titleKey =
            segment === null ? "brief_scope_all" : `segment_${segment}_title`;
          const title = t(titleKey as Parameters<typeof t>[0]);
          const Icon = meta.icon;

          // Current segment → flat highlighted card, not a link.
          if (isCurrent) {
            return (
              <li key={key}>
                <div
                  aria-current="page"
                  className={`group relative flex h-full flex-col rounded-2xl border-2 ${meta.activeBorder} ${meta.activeBg} px-4 py-3.5 shadow-sm`}
                >
                  <span
                    className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${meta.iconBg} ${meta.iconText}`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <p className="mt-2.5 text-sm font-bold text-slate-900">
                    {title}
                  </p>
                  <p className="mt-2 inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-emerald-700">
                    <CheckCircle2 className="h-3 w-3" />
                    {t("brief_nav_current")}
                  </p>
                </div>
              </li>
            );
          }

          // Peer exists in same edition → linked card.
          if (peer) {
            return (
              <li key={key}>
                <Link
                  href={`/insights/brief/${peer.slug}`}
                  className={`group relative flex h-full flex-col rounded-2xl border ${meta.idleBorder} ${meta.idleBg} px-4 py-3.5 shadow-sm transition hover:-translate-y-0.5 ${meta.hoverBorder} hover:shadow-md`}
                >
                  <span
                    className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${meta.iconBg} ${meta.iconText}`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <p className="mt-2.5 text-sm font-bold text-slate-900">
                    {title}
                  </p>
                  <p className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-slate-500 transition group-hover:text-slate-900">
                    {t("brief_nav_open")}
                    <ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" />
                  </p>
                </Link>
              </li>
            );
          }

          // Peer missing for this edition — dim, non-link.
          return (
            <li key={key}>
              <div
                className="flex h-full flex-col rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-3.5 text-slate-400"
                aria-disabled="true"
              >
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <p className="mt-2.5 text-sm font-bold text-slate-500">
                  {title}
                </p>
                <p className="mt-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {t("brief_nav_missing")}
                </p>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Prev/next edition arrows for the SAME segment. */}
      {(navigation.previous || navigation.next) && (
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {navigation.previous ? (
            <Link
              href={`/insights/brief/${navigation.previous.slug}`}
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
              href={`/insights/brief/${navigation.next.slug}`}
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

/** Visual tokens per segment — kept colocated with the only component that
 *  reads them. The five palettes mirror the section-theme colors used in
 *  BriefingNarrative so a reader's color-memory stays coherent. */
const SEGMENT_META = {
  all: {
    icon: Layers,
    iconBg: "bg-slate-100",
    iconText: "text-slate-700",
    idleBorder: "border-slate-200",
    idleBg: "bg-white",
    hoverBorder: "hover:border-slate-900",
    activeBorder: "border-slate-900",
    activeBg: "bg-gradient-to-br from-slate-50 to-white",
  },
  spiritual: {
    icon: Sparkles,
    iconBg: "bg-emerald-100",
    iconText: "text-emerald-700",
    idleBorder: "border-emerald-100",
    idleBg: "bg-gradient-to-br from-emerald-50/40 to-white",
    hoverBorder: "hover:border-emerald-500",
    activeBorder: "border-emerald-500",
    activeBg: "bg-gradient-to-br from-emerald-50 to-white",
  },
  family: {
    icon: HeartHandshake,
    iconBg: "bg-rose-100",
    iconText: "text-rose-700",
    idleBorder: "border-rose-100",
    idleBg: "bg-gradient-to-br from-rose-50/40 to-white",
    hoverBorder: "hover:border-rose-500",
    activeBorder: "border-rose-500",
    activeBg: "bg-gradient-to-br from-rose-50 to-white",
  },
  youth: {
    icon: Users,
    iconBg: "bg-sky-100",
    iconText: "text-sky-700",
    idleBorder: "border-sky-100",
    idleBg: "bg-gradient-to-br from-sky-50/40 to-white",
    hoverBorder: "hover:border-sky-500",
    activeBorder: "border-sky-500",
    activeBg: "bg-gradient-to-br from-sky-50 to-white",
  },
  justice: {
    icon: Scale,
    iconBg: "bg-amber-100",
    iconText: "text-amber-700",
    idleBorder: "border-amber-100",
    idleBg: "bg-gradient-to-br from-amber-50/40 to-white",
    hoverBorder: "hover:border-amber-500",
    activeBorder: "border-amber-500",
    activeBg: "bg-gradient-to-br from-amber-50 to-white",
  },
} as const;
