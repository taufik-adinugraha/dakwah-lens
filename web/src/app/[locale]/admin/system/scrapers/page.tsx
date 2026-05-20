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
              src="console.apify.com → Settings → Integrations → Personal API tokens. We run on Starter ($29/mo, $29 platform credit included — overages bill on top). Free tier ($5 credit) is enough only for a one-off dev run."
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
            cost="~$17/mo · Tuesday weekly · 49 keys × 20 items × $0.004"
            notes={
              <>
                <p>
                  Weekly sweep only — fires Tuesday 00:20 WIB via{" "}
                  <code>clockworks/free-tiktok-scraper</code>. The actor name
                  is misleading: &quot;free&quot; means free trial, not free
                  cost. Apify still charges $0.004/result, so a daily sweep
                  at our 49-keyword pool would cost ~$118/mo and blow the
                  IDR 1M ($60) budget cap.
                </p>
                <p>
                  Crossover math: free actor breaks even with the $45/mo
                  paid subscription (<code>clockworks/tiktok-scraper</code>)
                  at ~12 runs/month. Below that, free is cheaper; above
                  daily cadence, paid wins. At Tue-only (4.3 runs/mo), free
                  is the right choice.
                </p>
                <p>
                  If you ever want to switch actors, set{" "}
                  <code>APIFY_ACTOR_TIKTOK=clockworks/tiktok-scraper</code>{" "}
                  in <code>.env</code>. The paid-actor beat entry was
                  removed on 2026-05-20 — restore it from git history if
                  you re-subscribe.
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
                <Link
                  href="/admin/system/rss"
                  className="font-semibold text-brand-700 hover:underline"
                >
                  /admin/system/rss
                </Link>
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
