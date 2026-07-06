import { Link } from "@/i18n/navigation";
import { Card, HelpCallout, PageHeader } from "../_ui";

/**
 * Scrapers setup is configured via env vars (intentionally not DB-backed):
 *   APIFY_TOKEN, YOUTUBE_API_KEY, APIFY_ACTOR_{X,TIKTOK,INSTAGRAM,FACEBOOK}
 *
 * Showing what's configured + what's still missing, plus a per-platform
 * setup runbook so a new superadmin can wire everything up without
 * reading the codebase.
 */
export default async function ScrapersPage() {
  const status = {
    apifyToken: !!process.env.APIFY_TOKEN,
    youtubeKey: !!process.env.YOUTUBE_API_KEY,
    actors: {
      // Keep these fallbacks in sync with DEFAULT_ACTORS in
      // api/src/api/services/apify.py — they're what gets used when
      // the matching APIFY_ACTOR_* env var isn't set.
      x: process.env.APIFY_ACTOR_X ?? "apidojo/tweet-scraper",
      instagram:
        process.env.APIFY_ACTOR_INSTAGRAM ?? "apify/instagram-hashtag-scraper",
      tiktok:
        process.env.APIFY_ACTOR_TIKTOK ?? "clockworks/free-tiktok-scraper",
      facebook:
        process.env.APIFY_ACTOR_FACEBOOK ?? "apify/facebook-posts-scraper",
    },
  };

  return (
    <>
      <PageHeader
        title="Scrapers setup"
        subtitle="Apify actors for X · Instagram · TikTok · YouTube Data API · RSS for mainstream media. Facebook is configured but paused (not in beat)."
      />

      <HelpCallout>
        <p>
          Scrapers are configured through env vars (not the DB) because
          keys are secrets. <strong>Set them once</strong> in{" "}
          <code>.env</code> at the repo root — the same file is read by
          both Python (<code>config.py</code>) and Next.js (
          <code>process.env</code>). Restart the dev server + Celery
          worker after editing.
        </p>
        <p>
          <strong>Canonical schedule</strong> (Asia/Jakarta):
          mainstream RSS every 2 hours · YouTube channel whitelist Wed
          21:00 · X Wed 22:00 · TikTok Wed 22:10 · Instagram Wed 22:20 ·
          X + YouTube trending overlay 12:00 daily.
        </p>
      </HelpCallout>

      <Card title="Required keys">
        <table className="w-full text-sm max-md:block max-md:overflow-x-auto">
          <thead>
            <tr className="border-b border-slate-100 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              <th className="py-2">Env var</th>
              <th className="py-2">Status</th>
              <th className="py-2">Where to get it</th>
            </tr>
          </thead>
          <tbody>
            <KeyRow
              name="APIFY_TOKEN"
              configured={status.apifyToken}
              src="console.apify.com → Settings → Integrations → Personal API tokens. We run on Starter ($15/mo, $15 platform credit included — overages bill on top). Free tier ($5 credit) is enough only for a one-off dev run."
            />
            <KeyRow
              name="YOUTUBE_API_KEY"
              configured={status.youtubeKey}
              src="console.cloud.google.com → APIs & Services → Credentials. Enable YouTube Data API v3 first. Free: 10K units/day."
            />
          </tbody>
        </table>
      </Card>

      <Card title="Per-platform setup">
        <div className="space-y-5">
          <Platform
            name="X (Twitter)"
            via="Apify"
            actor={status.actors.x}
            env="APIFY_ACTOR_X"
            cost="Wed 22:00 WIB · 49 keys × cap 500 · 7d window"
            notes={
              <>
                <p>
                  The default <code>apidojo/tweet-scraper</code> actor is the
                  industry standard for X — full thread context, reliable
                  on weekend bursts. Swap via <code>APIFY_ACTOR_X</code> if you
                  want to test alternatives.
                </p>
                <p>
                  Run manually:{" "}
                  <code>
                    uv run python -m api.scripts.ingest --platform x --query
                    &quot;#dakwah&quot; --limit 20
                  </code>
                </p>
              </>
            }
          />
          <Platform
            name="Instagram"
            via="Apify"
            actor={status.actors.instagram}
            env="APIFY_ACTOR_INSTAGRAM"
            cost="Wed 22:20 WIB · 37 keys × 20 items"
            notes={
              <p>
                Pass a hashtag (with or without <code>#</code>) as the
                query. Public posts only — IG no longer allows private
                profile scraping. Re-enabled 2026-05-25 for evaluation
                after the IndoBERT retirement.
              </p>
            }
          />
          <Platform
            name="TikTok"
            via="Apify"
            actor={status.actors.tiktok}
            env="APIFY_ACTOR_TIKTOK"
            cost="Wed 22:10 WIB · 37 keys × 20 items × $0.004 ≈ $3.92/run"
            notes={
              <>
                <p>
                  Weekly sweep only — fires Wednesday 22:10 WIB via{" "}
                  <code>clockworks/free-tiktok-scraper</code>. Re-enabled
                  2026-05-28 after a seed-list audit (the original 49-key
                  pool included 13 collision-prone English/multilingual
                  tags — #anime, #crypto, #healing, #kpop, #mental,
                  #parenting, etc. — that pulled 30% foreign-language
                  noise; pruned to a 37-key Indonesian-distinctive set).
                </p>
                <p>
                  Actor name is misleading: &quot;free&quot; means free
                  trial, not free cost. Apify still charges $0.004/result.
                  A daily sweep at the current 37-key pool would cost
                  ~$87/mo and blow the IDR 1M ($60) budget cap, so we
                  stick to Wednesday weekly.
                </p>
                <p>
                  Crossover math: free actor breaks even with the $45/mo
                  paid subscription (<code>clockworks/tiktok-scraper</code>)
                  at ~12 runs/month. Below that, free is cheaper; above
                  daily cadence, paid wins. At Wed-only (4.3 runs/mo), free
                  is the right choice. If you ever want to switch, set{" "}
                  <code>APIFY_ACTOR_TIKTOK=clockworks/tiktok-scraper</code>{" "}
                  in <code>.env</code>.
                </p>
              </>
            }
          />
          <Platform
            name="Facebook"
            via="Apify"
            actor={status.actors.facebook}
            env="APIFY_ACTOR_FACEBOOK"
            cost="~$5 per 1K posts (paid plans only)"
            notes={
              <p className="text-amber-700">
                Facebook actors are flaky + expensive. We currently{" "}
                <strong>skip Facebook ingest</strong> in the beat schedule.
                Enable manually when you have a specific need:{" "}
                <code>
                  uv run python -m api.scripts.ingest --platform facebook
                </code>
              </p>
            }
          />
          <Platform
            name="YouTube"
            via="YouTube Data API v3"
            actor="playlistItems.list (1 unit/call) + search.list (100 units/call, daily overlay only)"
            env="YOUTUBE_API_KEY"
            cost="free up to 10K units/day"
            notes={
              <>
                <p>
                  Direct API access (not via Apify) for ~100× cost savings.
                  Two paths:
                </p>
                <ul className="ml-4 list-disc space-y-1">
                  <li>
                    <strong>Channel whitelist sweep · Wed 21:00 WIB</strong> —{" "}
                    <code>playlistItems.list</code> on each verified
                    channel&apos;s uploads playlist. 1 quota unit per call ·
                    near-free at our channel count. Configured at{" "}
                    <Link
                      href="/admin/system/youtube-channels"
                      className="font-semibold text-brand-700 hover:underline"
                    >
                      /admin/system/youtube-channels
                    </Link>
                    .
                  </li>
                  <li>
                    <strong>Trending overlay · 12:00 WIB daily</strong> —{" "}
                    <code>search.list</code> on da&apos;wah-relevant keywords
                    with a language gate. 100 quota units per call · still
                    well under the 10K/day budget.
                  </li>
                </ul>
                <p>
                  Descriptions are clipped in both paths — fetch full text
                  via <code>videos.list</code> if you need it (1 unit/call).
                </p>
              </>
            }
          />
          <Platform
            name="Mainstream media"
            via="RSS"
            actor="feedparser (Python)"
            env="(none)"
            cost="free · every 2 hours · 28 outlets"
            notes={
              <p>
                List of outlets is editable at{" "}
                <Link
                  href="/admin/system/rss"
                  className="font-semibold text-brand-700 hover:underline"
                >
                  /admin/system/rss
                </Link>
                . Currently 28 Indonesian outlets (Republika, Okezone,
                Tribunnews, Antara, RRI, Detik, CNN Indonesia, the
                Tribun-regional cluster, and more).
              </p>
            }
          />
        </div>
      </Card>
    </>
  );
}

function KeyRow({
  name,
  configured,
  src,
}: {
  name: string;
  configured: boolean;
  src: string;
}) {
  return (
    <tr className="border-b border-slate-50 last:border-0">
      <td className="py-2 font-mono text-xs text-slate-800">{name}</td>
      <td className="py-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${
            configured
              ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
              : "bg-rose-50 text-rose-700 ring-rose-100"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${configured ? "bg-emerald-500" : "bg-rose-500"}`}
          />
          {configured ? "configured" : "missing"}
        </span>
      </td>
      <td className="py-2 text-xs text-slate-500">{src}</td>
    </tr>
  );
}

function Platform({
  name,
  via,
  actor,
  env,
  cost,
  notes,
}: {
  name: string;
  via: string;
  actor: string;
  env: string;
  cost: string;
  notes: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-sm font-bold text-slate-900">{name}</h3>
        <span className="text-[11px] text-slate-500">via {via}</span>
        <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          {cost}
        </span>
      </div>
      <p className="mt-2 font-mono text-[11px] text-slate-600">
        {env} = <span className="text-slate-900">{actor}</span>
      </p>
      <div className="mt-2 space-y-1.5 text-xs text-slate-600">{notes}</div>
    </div>
  );
}
