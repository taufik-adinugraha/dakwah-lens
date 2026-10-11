import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";

import { routing } from "@/i18n/routing";
import { cardResponse } from "@/lib/og/card";
import { hubCard } from "@/lib/og/text";

/**
 * The hub's share card, /belajar/{locale}/og (lib/share.ts ogImageUrl; the hub's og:image).
 * An explicit route rather than an opengraph-image file: a file in app/[locale]/ would be
 * inherited by every page under it (the waris track and the 404 page included). Drawn at build
 * time, one per locale; any other path answers 404.
 */
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function GET(_request: Request, ctx: RouteContext<"/[locale]/og">) {
  const { locale } = await ctx.params;
  if (!hasLocale(routing.locales, locale)) return new Response(null, { status: 404 });
  const t = await getTranslations({ locale, namespace: "Og" });
  return cardResponse(hubCard(t));
}
