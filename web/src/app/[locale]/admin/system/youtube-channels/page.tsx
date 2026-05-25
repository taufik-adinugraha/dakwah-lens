import { ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";
import { asc } from "drizzle-orm";

import { auth } from "@/auth";
import { Link } from "@/i18n/navigation";
import { db, schema } from "@/db";
import {
  getBucketEngagementDelta,
  getChannelHealth,
} from "@/lib/dashboard-metrics";
import {
  deleteYoutubeChannel,
  toggleYoutubeChannel,
} from "../actions";
import { Card, EmptyState, HelpCallout, PageHeader } from "../_ui";
import { ConfirmForm } from "../_ConfirmForm";
import { AddChannelForm } from "./AddChannelForm";
import { CategorySelect } from "./CategorySelect";
import { VerifyAllBar } from "./VerifyAllBar";
import { VerifyButton } from "./VerifyButton";

const CATEGORIES = [
  "religious",
  "family",
  "youth",
  "muamalah",
  "social_justice",
  "health",
  "education",
  "cultural",
] as const;

type Category = (typeof CATEGORIES)[number];

const CATEGORY_LABELS: Record<Category, string> = {
  religious: "Religious / Dakwah",
  family: "Family / Vlog Keluarga",
  youth: "Youth / Lifestyle",
  muamalah: "Muamalah",
  social_justice: "Social Justice",
  health: "Health",
  education: "Education",
  cultural: "Cultural / Budaya",
};

const CATEGORY_COLORS: Record<Category, { bg: string; text: string; ring: string }> = {
  religious: { bg: "bg-emerald-50", text: "text-emerald-700", ring: "ring-emerald-100" },
  family: { bg: "bg-rose-50", text: "text-rose-700", ring: "ring-rose-100" },
  youth: { bg: "bg-sky-50", text: "text-sky-700", ring: "ring-sky-100" },
  muamalah: { bg: "bg-amber-50", text: "text-amber-700", ring: "ring-amber-100" },
  social_justice: { bg: "bg-violet-50", text: "text-violet-700", ring: "ring-violet-100" },
  health: { bg: "bg-teal-50", text: "text-teal-700", ring: "ring-teal-100" },
  education: { bg: "bg-indigo-50", text: "text-indigo-700", ring: "ring-indigo-100" },
  cultural: { bg: "bg-fuchsia-50", text: "text-fuchsia-700", ring: "ring-fuchsia-100" },
};

const FILTERS = ["all", ...CATEGORIES] as const;
type Filter = (typeof FILTERS)[number];

// Raw `searchParams` type rather than `PageProps<"…">` because Next.js's
// typed-routes generator only picks up the new directory after a build,
// and the inline type is functionally identical for this route.
export default async function YoutubeChannelsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const session = await auth();
  const isSuperadmin = session?.user?.role === "superadmin";

  const [channels, healthRows, bucketDeltas] = await Promise.all([
    db
      .select()
      .from(schema.youtubeChannels)
      .orderBy(
        asc(schema.youtubeChannels.category),
        asc(schema.youtubeChannels.name),
      ),
    getChannelHealth(),
    getBucketEngagementDelta(),
  ]);

  // Keyed by channel_id for per-row lookup in the list below. Channels
  // never ingested yet won't appear here (the health query INNER-derives
  // on `youtube_channels` so all verified rows are represented with zeros).
  const healthById = new Map(healthRows.map((h) => [h.channelId, h]));

  const countByCategory: Record<string, number> = {};
  for (const c of channels) {
    countByCategory[c.category] = (countByCategory[c.category] ?? 0) + 1;
  }

  const sp = await searchParams;
  const rawFilter = typeof sp.show === "string" ? sp.show : undefined;
  const activeFilter: Filter =
    (FILTERS as readonly string[]).includes(rawFilter ?? "")
      ? (rawFilter as Filter)
      : "all";

  const visible = channels.filter((c) =>
    activeFilter === "all" ? true : c.category === activeFilter,
  );

  return (
    <>
      <PageHeader
        title="YouTube channels"
        subtitle="Whitelist of Indonesian channels scraped via playlistItems.list — replaces the rotating keyword strategy for the `youtube` platform."
      />

      <HelpCallout>
        <p>
          The YT ingest task reads enabled rows from this table at the start
          of every run and pulls each channel&apos;s recent uploads via{" "}
          <code>playlistItems.list</code> (1 quota unit per call vs. 100 for{" "}
          <code>search.list</code>). Curated channels = zero spam; no
          foreign-language pollution; quota burn is negligible.
        </p>
        <p>
          <strong>Channel IDs</strong>: 24-character strings starting with{" "}
          <code>UC</code>. Find one by opening the channel&apos;s page →
          right-click → View Source → search for{" "}
          <code>&quot;channelId&quot;</code>, or use{" "}
          <code>uv run python -m api.scripts.seed_youtube_channels</code>
          to bulk-resolve names.
        </p>
        <p>
          <strong>Categories</strong>: 8 buckets — religious, family, youth,
          muamalah, social_justice, health, education, cultural. Drives no
          behavior today; used in admin filtering and future per-segment
          insight surfaces.
        </p>
      </HelpCallout>

      <BucketDeltaStrip rows={bucketDeltas} />

      {isSuperadmin && (
        <Card title="Add a channel">
          <AddChannelForm />
        </Card>
      )}

      <Card title={`Whitelisted channels (${channels.length})`}>
        <VerifyAllBar totalChannels={channels.length} />

        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Show
          </span>
          <FilterPill
            href="/admin/system/youtube-channels"
            active={activeFilter === "all"}
            label="All"
            count={channels.length}
          />
          {CATEGORIES.map((cat) => (
            <FilterPill
              key={cat}
              href={`/admin/system/youtube-channels?show=${cat}`}
              active={activeFilter === cat}
              label={CATEGORY_LABELS[cat]}
              count={countByCategory[cat] ?? 0}
            />
          ))}
        </div>

        {visible.length === 0 ? (
          <EmptyState
            title="No channels in this category yet"
            hint={
              activeFilter === "all"
                ? "Add one above, or run uv run python -m api.scripts.seed_youtube_channels to bulk-seed the 83-channel starter list."
                : "Add a channel above and pick this category, or pick a different filter to see what else is configured."
            }
          />
        ) : (
          <ul className="divide-y divide-slate-50">
            {visible.map((c) => (
              <li
                key={c.id}
                className={
                  isSuperadmin
                    ? "grid grid-cols-[2fr_1.5fr_auto_auto_auto_auto] items-center gap-3 py-2"
                    : "grid grid-cols-[2fr_1.5fr_auto_auto] items-center gap-3 py-2"
                }
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <a
                      href={`https://www.youtube.com/channel/${c.channelId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-semibold text-slate-900 hover:text-rose-700"
                    >
                      {c.name}
                    </a>
                    {!isSuperadmin && (
                      <ReadOnlyStatusPill enabled={c.enabled} />
                    )}
                    {/* Pipeline-eligibility cue — visible to both admin
                        and superadmin. Verified rows are the only ones
                        ingest will actually scrape. */}
                    <VerifyStatusBadge verified={c.verified} />
                  </div>
                  <p className="font-mono text-[11px] text-slate-500">
                    {c.channelId}
                    {c.handle && <span className="ml-1.5">· @{c.handle}</span>}
                    {c.verifiedAt && (
                      <span className="ml-1.5 text-emerald-600">
                        · verified{" "}
                        {new Date(c.verifiedAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    )}
                  </p>
                  <ChannelHealthLine
                    health={healthById.get(c.channelId)}
                  />
                </div>
                <CategoryControl
                  id={c.id}
                  category={c.category as Category}
                  isSuperadmin={isSuperadmin}
                />
                {/* Verify button — visible to both admin and superadmin.
                    Per-row re-check; flips `verified` based on YT API
                    outcome (see verifyYoutubeChannel server action). */}
                <VerifyButton
                  id={c.id}
                  initialVerified={c.verified}
                  curatedName={c.name}
                />
                {isSuperadmin && (
                  <>
                    <span className="text-[10px] text-slate-400 tabular-nums">
                      {c.lastRunAt
                        ? new Date(c.lastRunAt).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                          })
                        : "—"}
                    </span>
                    <ToggleSwitch
                      id={c.id}
                      enabled={c.enabled}
                      name={c.name}
                    />
                    <ConfirmForm
                      action={deleteYoutubeChannel}
                      confirmMessage={`Delete the "${c.name}" channel? Re-adding requires the 24-char channel_id.`}
                    >
                      <input type="hidden" name="id" value={c.id} />
                      <button
                        type="submit"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-700"
                        aria-label={`Delete ${c.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </ConfirmForm>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function FilterPill({
  href,
  active,
  label,
  count,
}: {
  href: string;
  active: boolean;
  label: string;
  count: number;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-[11px] font-semibold transition ${
        active
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
      }`}
    >
      {label}
      <span className={`tabular-nums ${active ? "text-white/80" : "text-slate-400"}`}>
        {count}
      </span>
    </Link>
  );
}

function CategoryControl({
  id,
  category,
  isSuperadmin,
}: {
  id: string;
  category: Category;
  isSuperadmin: boolean;
}) {
  const colors = CATEGORY_COLORS[category] ?? CATEGORY_COLORS.cultural;

  if (!isSuperadmin) {
    return (
      <span
        className={`inline-flex max-w-fit items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${colors.bg} ${colors.text} ${colors.ring}`}
      >
        {CATEGORY_LABELS[category]}
      </span>
    );
  }

  return <CategorySelect id={id} category={category} />;
}

function ReadOnlyStatusPill({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${
        enabled
          ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
          : "bg-slate-100 text-slate-500 ring-slate-200"
      }`}
    >
      {enabled ? "Enabled" : "Disabled"}
    </span>
  );
}

/** Pipeline-eligibility pill shown on every row. Rendered server-side
 *  (just reads the row's `verified`) — the VerifyButton component
 *  re-renders ITS OWN local mirror to reflect post-click state
 *  immediately. Both will converge after the next page render. */
/**
 * Per-channel health line under the channel ID. Shows 7-day reach so
 * an operator can spot dead whitelist entries at a glance. Three states:
 *   - no ingest yet (videos7d === 0): amber "no uploads this week"
 *   - some uploads (videos7d > 0):    "Yv · Xviews 7d"
 *   - never ingested (no row at all): silent (the section is informative,
 *                                     not blocking; just show nothing)
 */
function ChannelHealthLine({
  health,
}: {
  health:
    | {
        videos7d: number;
        totalViews7d: number;
        avgViews7d: number;
        lastUploadAt: string | null;
      }
    | undefined;
}) {
  if (!health) {
    return null;
  }
  if (health.videos7d === 0) {
    return (
      <p className="mt-0.5 text-[11px] text-amber-700">
        no uploads in last 7d
      </p>
    );
  }
  const totalFmt =
    health.totalViews7d >= 1_000_000
      ? `${(health.totalViews7d / 1_000_000).toFixed(1)}M`
      : health.totalViews7d >= 1_000
        ? `${(health.totalViews7d / 1_000).toFixed(0)}K`
        : String(health.totalViews7d);
  const avgFmt =
    health.avgViews7d >= 1_000_000
      ? `${(health.avgViews7d / 1_000_000).toFixed(1)}M`
      : health.avgViews7d >= 1_000
        ? `${(health.avgViews7d / 1_000).toFixed(0)}K`
        : String(Math.round(health.avgViews7d));
  return (
    <p className="mt-0.5 text-[11px] text-slate-500">
      {health.videos7d} videos · {totalFmt} views (avg {avgFmt}) · 7d
    </p>
  );
}


/**
 * Per-bucket strip: 7-day total YouTube views per category with the
 * week-over-week delta. Renders 8 tiles in a wrap grid; categories with
 * no data show muted "0 views" so the operator can still see which
 * buckets are silent. Hidden entirely if NO bucket has any 7d data
 * (e.g. fresh install before any YT ingest fired).
 */
function BucketDeltaStrip({
  rows,
}: {
  rows: Array<{
    category: string;
    viewsThisWeek: number;
    viewsLastWeek: number;
    deltaPct: number | null;
  }>;
}) {
  const hasAnyData = rows.some((r) => r.viewsThisWeek > 0 || r.viewsLastWeek > 0);
  if (!hasAnyData) return null;

  const fmt = (n: number) =>
    n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1)}M`
      : n >= 1_000
        ? `${(n / 1_000).toFixed(0)}K`
        : String(n);

  return (
    <Card title="Bucket reach (7d vs prior 7d)">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {rows.map((r) => {
          const dir =
            r.deltaPct === null
              ? "—"
              : r.deltaPct > 0
                ? "up"
                : r.deltaPct < 0
                  ? "down"
                  : "flat";
          const deltaClass =
            dir === "up"
              ? "text-emerald-700"
              : dir === "down"
                ? "text-rose-700"
                : "text-slate-500";
          return (
            <div
              key={r.category}
              className="rounded-xl border border-slate-100 bg-slate-50/60 p-3"
            >
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {r.category.replace("_", " ")}
              </div>
              <div className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">
                {fmt(r.viewsThisWeek)} views
              </div>
              <div className={`text-[11px] tabular-nums ${deltaClass}`}>
                {r.deltaPct === null
                  ? "no baseline yet"
                  : `${r.deltaPct >= 0 ? "+" : ""}${r.deltaPct.toFixed(0)}% vs last week`}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}


function VerifyStatusBadge({ verified }: { verified: boolean }) {
  if (verified) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 ring-1 ring-emerald-200">
        <ShieldCheck className="h-2.5 w-2.5" />
        verified
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700 ring-1 ring-amber-200">
      <ShieldAlert className="h-2.5 w-2.5" />
      unverified
    </span>
  );
}

function ToggleSwitch({
  id,
  enabled,
  name,
}: {
  id: string;
  enabled: boolean;
  name: string;
}) {
  return (
    <form action={toggleYoutubeChannel} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="enabled" value={String(enabled)} />
      <button
        type="submit"
        aria-pressed={enabled}
        aria-label={`${enabled ? "Disable" : "Enable"} ${name}`}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
          enabled ? "bg-emerald-500" : "bg-slate-200"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
            enabled ? "translate-x-[18px]" : "translate-x-0.5"
          }`}
        />
      </button>
    </form>
  );
}
