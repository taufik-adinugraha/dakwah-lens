import type { Metadata } from "next";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ForestWash } from "@/components/ForestWash";
import { Link } from "@/i18n/navigation";
import { mediaVideos, type MediaVideo } from "@/lib/media-videos";
import { localeAlternates } from "@/lib/seo";

/**
 * The weekly videos (owner 2026-11-25), embedded from YouTube with the
 * privacy-enhanced player. The list is src/lib/media-videos.ts.
 */

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/media/video">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "MediaVideo" });
  const title = t("meta_title");
  const description = t("meta_description");
  return {
    title,
    description,
    alternates: localeAlternates({ locale, canonicalPath: "/media/video" }),
    openGraph: { title, description, type: "website" },
  };
}

function weekLabel(week: string, locale: string): string {
  // Noon UTC so the date never slips a day in any timezone.
  const d = new Date(`${week}T12:00:00Z`);
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

function VideoCard({
  video,
  locale,
  weekOf,
  watch,
}: {
  video: MediaVideo;
  locale: string;
  weekOf: (date: string) => string;
  watch: string;
}) {
  const vertical = video.shape === "vertical";
  const watchUrl = vertical
    ? `https://www.youtube.com/shorts/${video.youtubeId}`
    : `https://www.youtube.com/watch?v=${video.youtubeId}`;
  return (
    <li className="flex flex-col overflow-hidden rounded-2xl border border-hairline bg-white shadow-sm">
      <div
        className={`relative w-full bg-ink ${vertical ? "aspect-[9/16]" : "aspect-video"}`}
      >
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${video.youtubeId}?rel=0`}
          title={video.title}
          loading="lazy"
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          className="absolute inset-0 h-full w-full border-0"
        />
      </div>
      <div className="flex flex-1 flex-col p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-forest">
          {weekOf(weekLabel(video.week, locale))}
        </p>
        <h2 className="mt-1.5 text-balance font-display text-xl font-medium leading-snug text-ink">
          {video.title}
        </h2>
        <p className="mt-2 flex-1 text-pretty text-sm leading-[1.7] text-ink-muted">
          {video.blurb}
        </p>
        <a
          href={watchUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-1.5 self-start text-sm font-semibold text-forest hover:underline"
        >
          {watch}
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </a>
      </div>
    </li>
  );
}

export default async function MediaVideoPage({
  params,
}: PageProps<"/[locale]/media/video">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("MediaVideo");
  const videos = mediaVideos();

  return (
    <div className="relative isolate overflow-hidden bg-paper font-body">
      <ForestWash />
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
        <Link
          href="/media"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted transition hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {t("back")}
        </Link>
        <header className="mt-4 max-w-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-forest">
            {t("eyebrow")}
          </p>
          <h1 className="mt-2 text-balance font-display text-3xl font-medium tracking-[-0.015em] text-ink sm:text-4xl">
            {t("heading")}
          </h1>
          <p className="mt-3 text-pretty text-sm leading-[1.7] text-ink-muted sm:text-base">
            {t("intro")}
          </p>
        </header>

        {videos.length === 0 ? (
          <p className="mt-10 rounded-2xl border border-dashed border-hairline bg-white/70 p-8 text-center text-sm text-ink-muted">
            {t("empty")}
          </p>
        ) : (
          <ul className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {videos.map((v) => (
              <VideoCard
                key={v.youtubeId}
                video={v}
                locale={locale}
                weekOf={(date) => t("week_of", { date })}
                watch={t("watch_on_youtube")}
              />
            ))}
          </ul>
        )}

        <p className="mt-10 text-xs leading-relaxed text-ink-muted">
          {t("ai_note")}
        </p>
      </div>
    </div>
  );
}
