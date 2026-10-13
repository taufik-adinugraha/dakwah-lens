/**
 * Which social platforms the pipeline fetches TODAY — the one place the
 * site reads it from.
 *
 * Operator, 2026-10-13: "we will also disable X for now, and we need to
 * show the info in the web, so now X, IG, FB etc are not fetched, only
 * youtube and mainstream media."
 *
 * So the corpus is mainstream RSS + YouTube. X was paused that day (the
 * weekly sweep is commented out in api/src/api/workers/celery_app.py and
 * the daily trending overlay fans out to YouTube only, workers/ingest.py
 * TRENDING_PLATFORMS). TikTok and Instagram have been paused since
 * 2026-06-08; Facebook has a scraper but no schedule.
 *
 * Readers: the landing page's platform figure, the notice on /radar and on
 * each paused platform's own Radar page. The wording lives in the messages
 * (Briefing.pipeline_pause_*, Landing.how_*, HowItWorks.ingest_status_note).
 *
 * To resume a platform: move it to ACTIVE_SOCIAL_PLATFORMS here, restore its
 * schedule in celery_app.py, and update those messages.
 */
export const ACTIVE_SOCIAL_PLATFORMS = ["youtube"] as const;

export const PAUSED_PLATFORMS = ["x", "instagram", "tiktok", "facebook"] as const;

export type PausedPlatform = (typeof PAUSED_PLATFORMS)[number];

export function isPausedPlatform(platform: string): platform is PausedPlatform {
  return (PAUSED_PLATFORMS as readonly string[]).includes(platform);
}
