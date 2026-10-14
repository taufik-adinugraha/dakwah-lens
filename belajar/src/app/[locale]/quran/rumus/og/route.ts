import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";

import { routing } from "@/i18n/routing";
import { cardResponse } from "@/lib/og/card";
import { rumusCard } from "@/lib/og/text";

/**
 * The cheat sheet's share card, /belajar/{locale}/quran/rumus/og (that page's og:image;
 * lib/share.ts ogImageUrl). Like the track's and the curriculum page's, its words name no surah, so
 * it never points at one that is not published, and no formula (nothing of it is Arabic: next/og
 * does not shape it). Drawn at build time, one per locale.
 */
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function GET(_request: Request, ctx: RouteContext<"/[locale]/quran/rumus/og">) {
  const { locale } = await ctx.params;
  if (!hasLocale(routing.locales, locale)) return new Response(null, { status: 404 });
  const t = await getTranslations({ locale, namespace: "Og" });
  return cardResponse(rumusCard(t));
}
