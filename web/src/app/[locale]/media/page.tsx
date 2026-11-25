import type { Metadata } from "next";
import { ArrowRight, Images, PlaySquare } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ForestWash } from "@/components/ForestWash";
import { Link } from "@/i18n/navigation";
import { localeAlternates } from "@/lib/seo";

/**
 * Galeri Media (owner 2026-11-25: "replace galeri flyer with galeri media,
 * then show 2 options on the page: videos, flyers"). A two-way choice:
 * the weekly videos (/media/video) and the existing flyer gallery
 * (/flyers/public, unchanged).
 */

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/media">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Media" });
  const title = t("meta_title");
  const description = t("meta_description");
  return {
    title,
    description,
    alternates: localeAlternates({ locale, canonicalPath: "/media" }),
    openGraph: { title, description, type: "website" },
  };
}

export default async function MediaPage({
  params,
}: PageProps<"/[locale]/media">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Media");

  const options = [
    {
      href: "/media/video",
      title: t("video_title"),
      body: t("video_body"),
      Icon: PlaySquare,
    },
    {
      href: "/flyers/public",
      title: t("flyer_title"),
      body: t("flyer_body"),
      Icon: Images,
    },
  ] as const;

  return (
    <div className="relative isolate overflow-hidden bg-paper font-body">
      <ForestWash />
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
        <header className="max-w-2xl">
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

        <ul className="mt-10 grid gap-4 sm:grid-cols-2">
          {options.map(({ href, title, body, Icon }) => (
            <li key={href}>
              <Link
                href={href}
                className="group flex h-full flex-col rounded-2xl border border-hairline bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-forest/40 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest sm:p-8"
              >
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-forest/10 text-forest">
                  <Icon className="h-6 w-6" aria-hidden />
                </span>
                <h2 className="mt-5 font-display text-2xl font-medium text-ink">
                  {title}
                </h2>
                <p className="mt-2 flex-1 text-pretty text-sm leading-[1.7] text-ink-muted">
                  {body}
                </p>
                <span className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-forest">
                  {t("open")}
                  <ArrowRight
                    className="h-4 w-4 transition group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
