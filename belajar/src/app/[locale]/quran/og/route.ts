import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";

import { routing } from "@/i18n/routing";
import { cardResponse } from "@/lib/og/card";
import { trackCard } from "@/lib/og/text";

/**
 * The Qur'an track's share card, /belajar/{locale}/quran/og (the track page's og:image). Its
 * words name no surah, so it never points at one that is not published. Drawn at build time.
 * ("og" is a static segment: it wins over [surah], and no surah slug is "og".)
 */
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function GET(_request: Request, ctx: RouteContext<"/[locale]/quran/og">) {
  const { locale } = await ctx.params;
  if (!hasLocale(routing.locales, locale)) return new Response(null, { status: 404 });
  const t = await getTranslations({ locale, namespace: "Og" });
  return cardResponse(trackCard(t));
}
