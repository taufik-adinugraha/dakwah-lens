import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";

import { routing } from "@/i18n/routing";
import { getAyah, getSurah, SURAHS } from "@/lib/content";
import { cardResponse } from "@/lib/og/card";
import { lessonCard } from "@/lib/og/text";
import { lessonShareable } from "@/lib/share";

/**
 * A lesson's share card, /belajar/{locale}/quran/{slug}/{ayah}/og (the lesson page's
 * og:image): the surah and ayah, the transliteration and the Indonesian translation, from
 * content, in Latin script only (lib/og/text.ts). Under the lesson's own path, so whatever hides
 * a lesson hides its card. Every card of a shareable lesson (lib/share.ts lessonShareable, the
 * one check) is drawn at build time; any other path answers 404.
 *
 * Route handlers do not inherit a layout's generateStaticParams, so this one lists every
 * segment's params, the locale included.
 */
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return routing.locales.flatMap((locale) =>
    SURAHS.filter((s) => lessonShareable(s.slug)).flatMap((s) =>
      s.ayat.map((a) => ({ locale, surah: s.slug, ayah: String(a.ayah) })),
    ),
  );
}

export async function GET(_request: Request, ctx: RouteContext<"/[locale]/quran/[surah]/[ayah]/og">) {
  const { locale, surah: slug, ayah } = await ctx.params;
  const s = getSurah(slug);
  const a = s ? getAyah(s, Number(ayah)) : undefined;
  if (!hasLocale(routing.locales, locale) || !s || !a || !lessonShareable(s.slug)) {
    return new Response(null, { status: 404 });
  }
  const t = await getTranslations({ locale, namespace: "Og" });
  return cardResponse(lessonCard(t, s, a));
}
