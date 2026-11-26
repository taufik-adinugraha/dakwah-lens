import type { MetadataRoute } from "next";

import { routing } from "@/i18n/routing";
import { SURAHS } from "@/lib/content";
import { indexingRuntime } from "@/lib/indexing";
import { kosakataIndex } from "@/lib/kosakata";
import { LEXEMES } from "@/lib/lexemes";
import { LIBRARY } from "@/lib/library";
import { sitemapEntries } from "@/lib/sitemap-paths";

/**
 * The module's sitemap, https://dakwah-lens.id/belajar/sitemap.xml (Next's basePath puts the file under
 * /belajar, where Caddy already sends everything; the main site's robots.txt names it,
 * web/src/app/robots.ts). The addresses and the reasons are lib/sitemap-paths.ts and lib/indexing.ts;
 * docs/belajar-plan.md L42.
 *
 * Rendered per request: which surahs are published, whether the learning path is listed, whether the word
 * pages are taken, and whether the module is public at all, are runtime switches (lib/features.ts,
 * lib/flags.ts), so a build-time sitemap would be wrong the moment the operator changes one. It is cheap
 * (a few hundred strings), and a crawler asks for it rarely. While the module is not public the sitemap is
 * empty. The proxy does not run on it (a file with an extension is outside its matcher).
 */
export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  return sitemapEntries({
    rt: indexingRuntime(),
    allLocales: routing.locales,
    defaultLocale: routing.defaultLocale,
    surahs: SURAHS.map((s) => ({ slug: s.slug, ayat: s.ayat.map((a) => a.ayah) })),
    concepts: [...LIBRARY.basics.map((b) => b.id), ...LIBRARY.concepts.map((c) => c.id)],
    lexemes: LEXEMES,
    kosakataWords: kosakataIndex().rows.length,
  }).map(({ url, languages }) => (languages ? { url, alternates: { languages } } : { url }));
}
