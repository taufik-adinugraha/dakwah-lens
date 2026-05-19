import { Trash2 } from "lucide-react";
import { asc } from "drizzle-orm";

import { auth } from "@/auth";
import { Link } from "@/i18n/navigation";
import { db, schema } from "@/db";
import { deleteRssFeed, toggleFetchBody, toggleRssFeed } from "../actions";
import { Card, EmptyState, HelpCallout, PageHeader } from "../_ui";
import { ConfirmForm } from "../_ConfirmForm";
import { AddFeedForm } from "./AddFeedForm";

/**
 * Display labels for region codes. Keep aligned with the onboarding
 * `loc_*` keys so the same vocabulary is used user-side and admin-side.
 */
const REGION_LABELS: Record<string, string> = {
  jabodetabek: "Jabodetabek",
  jawa_barat: "Jawa Barat",
  jawa_tengah_diy: "Jawa Tengah / DIY",
  jawa_timur: "Jawa Timur",
  sumatera: "Sumatera",
  kalimantan: "Kalimantan",
  sulawesi: "Sulawesi",
  indonesia_timur: "Indonesia Timur",
};

const SCOPE_FILTERS = ["national", "regional", "all"] as const;
type ScopeFilter = (typeof SCOPE_FILTERS)[number];

export default async function RssPage({
  searchParams,
}: PageProps<"/[locale]/admin/system/rss">) {
  // Admin view is read-only — hide the Add form and per-row toggles/delete.
  const session = await auth();
  const isSuperadmin = session?.user?.role === "superadmin";

  const feeds = await db
    .select()
    .from(schema.rssFeeds)
    .orderBy(asc(schema.rssFeeds.name));

  const nationalCount = feeds.filter((f) => f.scope === "national").length;
  const regionalCount = feeds.length - nationalCount;

  // Active filter — default to national (the most common case). Pass
  // `?show=regional` or `?show=all` to switch via the pills below.
  const sp = await searchParams;
  const rawShow = typeof sp.show === "string" ? sp.show : undefined;
  const activeFilter: ScopeFilter =
    (SCOPE_FILTERS as readonly string[]).includes(rawShow ?? "")
      ? (rawShow as ScopeFilter)
      : "national";

  const visibleFeeds = feeds.filter((f) => {
    if (activeFilter === "all") return true;
    return f.scope === activeFilter;
  });

  return (
    <>
      <PageHeader
        title="RSS feeds"
        subtitle="Indonesian news outlets ingested as the `mainstream` platform — split into national and regional scopes."
      />

      <HelpCallout>
        <p>
          The RSS scraper (<code>services/rss.py</code>) reads enabled rows
          from <code>rss_feeds</code> at the start of every run. Disable a
          feed here to stop ingesting it without losing the URL. Delete
          only when you&apos;re sure — re-adding requires re-typing the URL.
        </p>
        <p>
          <strong>Scope</strong>: pick <code>national</code> for outlets
          that cover the whole country (Kompas, Detik, Antara…) and{" "}
          <code>regional</code> for province- or city-level outlets (Pikiran
          Rakyat, Jawa Pos, Tribun Bali…). Regional feeds also need a
          region code so insights can filter by it.
        </p>
        <p>
          Pick stable RSS endpoints: most major Indonesian outlets publish
          a <code>/rss</code> or <code>/feed</code> URL. CNN Indonesia
          sometimes blocks default user agents — if a feed silently returns
          zero items, check the Celery logs.
        </p>
      </HelpCallout>

      {isSuperadmin && (
        <Card title="Add a new feed">
          <AddFeedForm regionLabels={REGION_LABELS} />
        </Card>
      )}

      <Card title={`Configured feeds (${feeds.length})`}>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Show
          </span>
          <FilterPill
            href="/admin/system/rss"
            active={activeFilter === "national"}
            label="National"
            count={nationalCount}
          />
          <FilterPill
            href="/admin/system/rss?show=regional"
            active={activeFilter === "regional"}
            label="Regional"
            count={regionalCount}
          />
          <FilterPill
            href="/admin/system/rss?show=all"
            active={activeFilter === "all"}
            label="All"
            count={feeds.length}
          />
        </div>

        {visibleFeeds.length === 0 ? (
          <EmptyState
            title={
              activeFilter === "regional"
                ? "No regional feeds yet"
                : activeFilter === "national"
                  ? "No national feeds yet"
                  : "No feeds yet"
            }
            hint={
              activeFilter === "regional"
                ? "Add one above with scope = Regional to track province- or city-level outlets."
                : "Add one above, or run uv run python -m api.scripts.seed_rss_feeds to seed defaults."
            }
          />
        ) : (
          <ul className="divide-y divide-slate-50">
            {visibleFeeds.map((f) => (
              <li
                key={f.id}
                className={
                  isSuperadmin
                    ? "grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 py-2"
                    : "py-2"
                }
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-sm font-semibold text-slate-900">
                      {f.name}
                    </p>
                    <ScopePill scope={f.scope} region={f.region} />
                    {!isSuperadmin && (
                      <ReadOnlyStatusPill
                        enabled={f.enabled}
                        fetchBody={f.fetchBody}
                      />
                    )}
                  </div>
                  <a
                    href={f.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate font-mono text-[11px] text-slate-500 hover:text-slate-900"
                  >
                    {f.url}
                  </a>
                </div>
                {isSuperadmin && (
                  <>
                    <form action={toggleFetchBody}>
                      <input type="hidden" name="id" value={f.id} />
                      <input
                        type="hidden"
                        name="fetch_body"
                        value={String(f.fetchBody)}
                      />
                      <button
                        type="submit"
                        title={
                          f.fetchBody
                            ? "Full article body fetched per item"
                            : "Only RSS title + summary used"
                        }
                        className={`inline-flex h-7 items-center rounded-full px-3 text-[11px] font-semibold transition ${
                          f.fetchBody
                            ? "border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100"
                            : "border border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100"
                        }`}
                      >
                        {f.fetchBody ? "Full body" : "Title only"}
                      </button>
                    </form>
                    <ToggleSwitch
                      id={f.id}
                      enabled={f.enabled}
                      name={f.name}
                    />
                    <ConfirmForm
                      action={deleteRssFeed}
                      confirmMessage={`Delete the "${f.name}" feed? This removes the row from rss_feeds — re-adding requires re-typing the URL.`}
                    >
                      <input type="hidden" name="id" value={f.id} />
                      <button
                        type="submit"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-700"
                        aria-label={`Delete ${f.name}`}
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
      <span
        className={`tabular-nums ${active ? "text-white/80" : "text-slate-400"}`}
      >
        {count}
      </span>
    </Link>
  );
}

/** Read-only badge stack shown to admins in place of the interactive
 *  controls — keeps the same information density without offering write. */
function ReadOnlyStatusPill({
  enabled,
  fetchBody,
}: {
  enabled: boolean;
  fetchBody: boolean;
}) {
  return (
    <>
      <span
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${
          enabled
            ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
            : "bg-slate-100 text-slate-500 ring-slate-200"
        }`}
      >
        {enabled ? "Enabled" : "Disabled"}
      </span>
      <span
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${
          fetchBody
            ? "bg-violet-50 text-violet-700 ring-violet-100"
            : "bg-slate-50 text-slate-500 ring-slate-200"
        }`}
      >
        {fetchBody ? "Full body" : "Title only"}
      </span>
    </>
  );
}

function ScopePill({
  scope,
  region,
}: {
  scope: string;
  region: string | null;
}) {
  if (scope === "national") {
    return (
      <span className="inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand-700 ring-1 ring-brand-100">
        National
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700 ring-1 ring-amber-100">
      Regional · {region ? (REGION_LABELS[region] ?? region) : "—"}
    </span>
  );
}

/**
 * A real-looking toggle switch. Wraps the existing `toggleRssFeed` server
 * action — clicking submits the form which flips `enabled` and revalidates
 * the page. No client JS needed; the visual is pure CSS off the `enabled`
 * prop.
 */
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
    <form action={toggleRssFeed} className="flex items-center gap-2">
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
