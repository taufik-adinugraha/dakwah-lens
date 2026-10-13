import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";

import { routing } from "@/i18n/routing";
import { cardResponse } from "@/lib/og/card";
import { curriculumCard } from "@/lib/og/text";

/**
 * The curriculum page's share card, /belajar/{locale}/quran/kurikulum/og (that page's og:image;
 * lib/share.ts ogImageUrl). Like the track's card, its words name no surah, so it never points at
 * one that is not published. Drawn at build time, one per locale.
 */
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function GET(_request: Request, ctx: RouteContext<"/[locale]/quran/kurikulum/og">) {
  const { locale } = await ctx.params;
  if (!hasLocale(routing.locales, locale)) return new Response(null, { status: 404 });
  const t = await getTranslations({ locale, namespace: "Og" });
  return cardResponse(curriculumCard(t));
}
