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
      x:
        process.env.APIFY_ACTOR_X ??
        "kaitoeasyapi/twitter-x-data-tweet-scraper-pay-per-result-cheapest",
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
        subtitle="Apify actors for Facebook, Instagram, TikTok, X · YouTube Data API · RSS for mainstream media."
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
      </HelpCallout>

      <Card title="Required keys">
        <table className="w-full text-sm">
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
              src="console.apify.com → Settings → Integrations → Personal API tokens. Free tier: $5/mo credit."
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
            cost="~$0.40 per 1K tweets"
            notes={
              <>
                <p>
                  The default <code>kaitoeasyapi</code> actor works on the
                  Apify free plan. The "official" <code>apidojo</code>{" "}
                  actor returns 5-item samples on free.
                </p>
                <p>
                  Run manually:{" "}
                  <code>
                    uv run python -m api.scripts.ingest --platform x --query
                    "#dakwah" --limit 20
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
            cost="~$2 per 1K posts"
            notes={
              <p>
                Pass a hashtag (with or without <code>#</code>) as the
                query. Public posts only — IG no longer allows private
                profile scraping.
              </p>
            }
          />
          <Platform
            name="TikTok"
            via="Apify"
            actor={status.actors.tiktok}
            env="APIFY_ACTOR_TIKTOK"
            cost="free actor, $5 Apify-platform credit covers ~10K results"
            notes={
              <p>
                Default actor is <code>clockworks/free-tiktok-scraper</code>{" "}
                — free actor, no per-result charge, just compute time.
              </p>
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
            actor="search.list (100 quota units per call)"
            env="YOUTUBE_API_KEY"
            cost="free up to 10K units/day"
            notes={
              <p>
                Direct API access (not via Apify) for ~100× cost savings.
                Returns video title + channel + publishedAt; descriptions
                are clipped — fetch full text via <code>videos.list</code>{" "}
                if you need it (1 unit/call).
              </p>
            }
          />
          <Platform
            name="Mainstream media"
            via="RSS"
            actor="feedparser (Python)"
            env="(none)"
            cost="free"
            notes={
              <p>
                List of outlets is editable at{" "}
                <a
                  href="/admin/system/rss"
                  className="font-semibold text-brand-700 hover:underline"
                >
                  /admin/system/rss
                </a>
                . Six Indonesian outlets are seeded by default.
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
