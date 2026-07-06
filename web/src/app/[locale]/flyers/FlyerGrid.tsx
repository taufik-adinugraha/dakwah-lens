"use client";

/* eslint-disable @next/next/no-img-element */

import {
  ChevronDown,
  Download,
  Eye,
  Globe,
  Lock,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

type Flyer = {
  id: string;
  headline: string;
  visibility: "private" | "public";
  createdAt: string;
  /** "user" = generated via /flyers/new (has DELETE endpoint).
   *  "system" = derived from a weekly briefing; no delete.
   *  Defaults to "user" for back-compat. */
  kind?: "user" | "system";
  /** Override the PNG URL. User flyers default to /api/user-flyers/{id}/png;
   *  system flyers point at the briefing flyer endpoint. */
  pngUrl?: string;
  /** Type/topic — drive the gallery filters. Set for system flyers
   *  (type = "Doa Pekan Ini" etc, topic = segment). Undefined for user
   *  flyers (no fixed type/topic). */
  typeLabel?: string;
  topicLabel?: string;
};

type FilterLabels = {
  source: string;
  type: string;
  topic: string;
  month: string;
  all: string;
  sourceWeekly: string;
  sourceUser: string;
  empty: string;
};

type Labels = {
  visibilityBadgePublic: string;
  visibilityBadgePrivate: string;
  /** "Mingguan" / "Weekly" — badge for system flyers from briefings. */
  badgeSystem?: string;
  deleteButton: string;
  deleteConfirm: string;
  openLarge: string;
  download: string;
  /** When present, the gallery renders the source/type/topic/month
   *  filter bar. Omitted on /flyers/mine (single-source, no filters). */
  filters?: FilterLabels;
};

function monthKey(iso: string): string {
  return iso.slice(0, 7); // "YYYY-MM"
}

export function FlyerGrid({
  flyers,
  showDelete,
  labels,
  locale,
  typeOptions: typeOptionsProp,
  topicOptions: topicOptionsProp,
  filterValues,
  filterBasePath,
}: {
  flyers: Flyer[];
  /** When true, each tile shows a delete affordance. /flyers/mine sets this;
   *  /flyers/public doesn't (viewers can't delete other people's flyers). */
  showDelete?: boolean;
  labels: Labels;
  /** For localized month labels in the filter dropdown. */
  locale?: string;
  /** Optional override for the Type filter dropdown. When provided,
   *  the dropdown reflects the FULL result set (across paginated
   *  pages); when omitted, options are derived from `flyers` (the
   *  current page only). Set this from /flyers/public so cross-page
   *  filtering works. */
  typeOptions?: string[];
  /** Same as `typeOptions` but for the Topic filter. */
  topicOptions?: string[];
  /** When provided, source/type/topic filters become URL-driven
   *  (mode = "server"). The parent server component reads `?source=…
   *  &type=…&topic=…` and filters its result set BEFORE pagination, so
   *  picking a topic from page 1 re-paginates the matching subset
   *  instead of just narrowing the visible page. Omit to keep the
   *  legacy current-page-only client-side filter (used by /flyers/mine
   *  where the dataset isn't paginated). */
  filterValues?: {
    source: "all" | "system" | "user";
    type: string; // "" = all
    topic: string; // "" = all
  };
  /** Required when `filterValues` is set — locale-relative base path
   *  the filter selects navigate to (e.g. "/flyers/public"). */
  filterBasePath?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const urlDriven = !!filterValues && !!filterBasePath;
  // Deleted-id set lives client-side so the tile vanishes optimistically
  // on /mine. Deriving `items` from the `flyers` prop (not from useState)
  // lets server-driven pagination flow through — useState would freeze
  // the first page's data because React doesn't reseed initialValue when
  // props change.
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const items = flyers.filter((x) => !deletedIds.has(x.id));
  // Local-state filters — only used in legacy (non-urlDriven) mode.
  // In urlDriven mode the server already filtered the result set
  // before pagination, so re-filtering here would be a no-op.
  const [sourceLocal, setSourceLocal] = useState("all");
  const [typeLocal, setTypeLocal] = useState("all");
  const [topicLocal, setTopicLocal] = useState("all");
  const [month, setMonth] = useState("all");
  const source = urlDriven ? (filterValues!.source as string) : sourceLocal;
  const type = urlDriven ? filterValues!.type || "all" : typeLocal;
  const topic = urlDriven ? filterValues!.topic || "all" : topicLocal;

  // Build the locale-aware base path once. next-intl's `Link`/router
  // automatically prefixes the locale, but we're using next/navigation's
  // router here (since it accepts a string URL); read the locale from
  // the current pathname so the navigation stays on the same language.
  const localePrefix = (() => {
    const first = (pathname ?? "").split("/").filter(Boolean)[0];
    return first === "en" || first === "id" ? `/${first}` : "";
  })();

  function buildFilterUrl(patch: Record<string, string>): string {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    for (const [k, v] of Object.entries(patch)) {
      if (v && v !== "all") params.set(k, v);
      else params.delete(k);
    }
    // Any filter change resets the page.
    params.delete("page");
    const qs = params.toString();
    return `${localePrefix}${filterBasePath}${qs ? `?${qs}` : ""}`;
  }

  const setSource = (v: string) => {
    if (urlDriven) router.push(buildFilterUrl({ source: v }));
    else setSourceLocal(v);
  };
  const setType = (v: string) => {
    if (urlDriven) router.push(buildFilterUrl({ type: v }));
    else setTypeLocal(v);
  };
  const setTopic = (v: string) => {
    if (urlDriven) router.push(buildFilterUrl({ topic: v }));
    else setTopicLocal(v);
  };

  const f = labels.filters;

  const typeOptions =
    typeOptionsProp ??
    (Array.from(
      new Set(items.map((x) => x.typeLabel).filter(Boolean)),
    ) as string[]);
  const topicOptions =
    topicOptionsProp ??
    (Array.from(
      new Set(items.map((x) => x.topicLabel).filter(Boolean)),
    ) as string[]);
  const monthKeys = Array.from(new Set(items.map((x) => monthKey(x.createdAt))))
    .sort()
    .reverse();
  const monthLabel = (key: string) => {
    const [y, m] = key.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(locale || undefined, {
      month: "long",
      year: "numeric",
    });
  };

  // In urlDriven mode the server already applied source/type/topic
  // filtering before pagination, so only month (which the
  // MonthPickerPager handles separately) needs a client-side pass —
  // and even that is a no-op here since month is also URL-driven on
  // /flyers/public via MonthPickerPager. Keep the legacy filter loop
  // for callers (/flyers/mine) that don't pass filterValues.
  const filtered = urlDriven
    ? items
    : items.filter((x) => {
        if (source !== "all" && (x.kind ?? "user") !== source) return false;
        if (type !== "all" && x.typeLabel !== type) return false;
        if (topic !== "all" && x.topicLabel !== topic) return false;
        if (month !== "all" && monthKey(x.createdAt) !== month) return false;
        return true;
      });

  return (
    <>
      {f && (
        <div className="mb-6 flex flex-wrap gap-2">
          <FilterSelect
            label={f.source}
            value={source}
            onChange={setSource}
            allLabel={f.all}
            options={[
              { value: "system", label: f.sourceWeekly },
              { value: "user", label: f.sourceUser },
            ]}
          />
          {typeOptions.length > 0 && (
            <FilterSelect
              label={f.type}
              value={type}
              onChange={setType}
              allLabel={f.all}
              options={typeOptions.map((o) => ({ value: o, label: o }))}
            />
          )}
          {topicOptions.length > 0 && (
            <FilterSelect
              label={f.topic}
              value={topic}
              onChange={setTopic}
              allLabel={f.all}
              options={topicOptions.map((o) => ({ value: o, label: o }))}
            />
          )}
          {/* urlDriven callers (e.g. /flyers/public) render the
              MonthPickerPager separately, so the Month dropdown here
              would be a duplicate control. Keep it for legacy callers
              (/flyers/mine) that don't paginate. */}
          {!urlDriven && monthKeys.length > 1 && (
            <FilterSelect
              label={f.month}
              value={month}
              onChange={setMonth}
              allLabel={f.all}
              options={monthKeys.map((k) => ({ value: k, label: monthLabel(k) }))}
            />
          )}
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-hairline bg-white px-6 py-10 text-center text-sm text-ink-faint">
          {f?.empty ?? ""}
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((flyer) => (
            <FlyerTile
              key={flyer.id}
              flyer={flyer}
              showDelete={!!showDelete}
              labels={labels}
              onDeleted={() =>
                setDeletedIds((s) => {
                  const next = new Set(s);
                  next.add(flyer.id);
                  return next;
                })
              }
            />
          ))}
        </ul>
      )}
    </>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  allLabel,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  allLabel: string;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="relative">
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none rounded-full border border-hairline bg-white py-1.5 pl-3.5 pr-8 text-xs font-semibold text-ink-muted shadow-sm focus:border-forest/50 focus:outline-none focus:ring-2 focus:ring-hairline"
      >
        <option value="all">
          {label}: {allLabel}
        </option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {label}: {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
    </div>
  );
}

function FlyerTile({
  flyer,
  showDelete,
  labels,
  onDeleted,
}: {
  flyer: Flyer;
  showDelete: boolean;
  labels: Labels;
  onDeleted: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [zoomed, setZoomed] = useState(false);
  const kind = flyer.kind ?? "user";
  const png = flyer.pngUrl ?? `/api/user-flyers/${flyer.id}/png`;
  // System flyers (from weekly briefings) have no DELETE endpoint —
  // suppress the trash button regardless of `showDelete`.
  const canDelete = showDelete && kind === "user";

  function onDelete(): void {
    if (!confirm(labels.deleteConfirm)) return;
    startTransition(async () => {
      const res = await fetch(`/api/user-flyers/${flyer.id}`, {
        method: "DELETE",
      });
      if (res.ok) onDeleted();
    });
  }

  return (
    <li className="overflow-hidden rounded-2xl border border-hairline bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setZoomed(true)}
        aria-label={labels.openLarge}
        className="block aspect-square w-full overflow-hidden bg-paper-deep"
      >
        <img
          src={png}
          alt={flyer.headline}
          loading="lazy"
          className="h-full w-full object-cover transition hover:scale-[1.02]"
        />
      </button>
      <div className="space-y-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="line-clamp-2 text-sm font-semibold text-ink">
            {flyer.headline}
          </p>
          {kind === "system" ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-forest-tint px-1.5 py-0.5 text-[10px] font-semibold text-forest">
              <Sparkles className="h-2.5 w-2.5" />
              {labels.badgeSystem ?? "Weekly"}
            </span>
          ) : (
            <span
              className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                flyer.visibility === "public"
                  ? "bg-sky-50 text-sky-700"
                  : "bg-paper-deep text-ink-muted"
              }`}
            >
              {flyer.visibility === "public" ? (
                <Globe className="h-2.5 w-2.5" />
              ) : (
                <Lock className="h-2.5 w-2.5" />
              )}
              {flyer.visibility === "public"
                ? labels.visibilityBadgePublic
                : labels.visibilityBadgePrivate}
            </span>
          )}
        </div>
        <p className="text-[11px] text-ink-faint">
          {new Date(flyer.createdAt).toLocaleDateString(undefined, {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </p>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setZoomed(true)}
            className="inline-flex items-center gap-1 rounded-full border border-hairline bg-white px-2.5 py-1 text-[11px] font-semibold text-ink-muted hover:bg-paper-deep"
          >
            <Eye className="h-3 w-3" />
            {labels.openLarge}
          </button>
          <a
            href={png}
            download={`dakwah-lens-flyer-${flyer.id}.png`}
            className="inline-flex items-center gap-1 rounded-full border border-hairline bg-white px-2.5 py-1 text-[11px] font-semibold text-ink-muted hover:bg-paper-deep"
          >
            <Download className="h-3 w-3" />
            {labels.download}
          </a>
          {canDelete && (
            <button
              type="button"
              onClick={onDelete}
              disabled={pending}
              className="ml-auto inline-flex items-center gap-1 rounded-full border border-rose-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
            >
              <Trash2 className="h-3 w-3" />
              {labels.deleteButton}
            </button>
          )}
        </div>
      </div>

      {zoomed && (
        <ZoomOverlay
          src={png}
          alt={flyer.headline}
          downloadName={`dakwah-lens-flyer-${flyer.id}.png`}
          downloadLabel={labels.download}
          closeLabel={labels.openLarge}
          onClose={() => setZoomed(false)}
        />
      )}
    </li>
  );
}

function ZoomOverlay({
  src,
  alt,
  downloadName,
  downloadLabel,
  closeLabel,
  onClose,
}: {
  src: string;
  alt: string;
  downloadName: string;
  downloadLabel: string;
  closeLabel: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-forest/80 p-4 backdrop-blur-sm"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={closeLabel}
        className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-ink shadow-md transition hover:bg-white"
      >
        <X className="h-5 w-5" />
      </button>
      <div
        className="relative flex max-h-[92vh] max-w-[92vw] flex-col items-center gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={src}
          alt={alt}
          className="max-h-[80vh] max-w-[88vw] rounded-2xl shadow-2xl"
        />
        <a
          href={src}
          download={downloadName}
          className="inline-flex items-center gap-1.5 rounded-full bg-white/95 px-4 py-2 text-xs font-semibold text-ink shadow-md transition hover:bg-white"
        >
          <Download className="h-3.5 w-3.5" />
          {downloadLabel}
        </a>
      </div>
    </div>
  );
}
