import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { connection } from "next/server";

import { ForestGlow } from "@/components/ForestGlow";
import { KosakataTabs } from "@/components/kosakata/KosakataTabs";
import { PathMap } from "@/components/kosakata/PathMap";
import { MixedText } from "@/components/library/MixedText";
import { kosakataPathListed } from "@/lib/features";
import { kosakataIndex, kosakataPath } from "@/lib/kosakata";
import { pathSource } from "@/lib/kosakata-path";
import { mapLevels } from "@/lib/kosakata-path-data";
import { kosakataPathHref } from "@/lib/routes";
import { NOINDEX } from "@/lib/seo";
import { alternatesFor } from "@/lib/share";

export async function generateMetadata({ params }: PageProps<"/[locale]/kosakata/bertahap">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "KosakataPath" });
  return {
    title: t("title"),
    description: t("intro"),
    alternates: alternatesFor(locale, kosakataPathHref()),
    // While the path is not listed (BELAJAR_KOSAKATA_BERTAHAP) it answers at its address but is linked
    // from nowhere, so it stays out of the index like any other page the operator has not shown yet
    // (lib/indexing.ts; the proxy says the same in a header). The key is left out, not set to undefined:
    // Next would read an undefined `robots` as "none" and drop the locale layout's noindex for English.
    ...(kosakataPathListed() ? {} : { robots: NOINDEX }),
  };
}

/**
 * The learning path over the Kosakata list (operator 2026-11-03: "split into levels and batches, so
 * people can learn in batches, next level/batch can be unlocked once test is passed"; plan L38).
 */
export default async function KosakataPathPage({ params }: PageProps<"/[locale]/kosakata/bertahap">) {
  const { locale } = await params;
  setRequestLocale(locale);
  await connection();
  const t = await getTranslations("KosakataPath");
  const tk = await getTranslations("Kosakata");
  const path = kosakataPath();
  return (
    <div className="relative isolate">
      <ForestGlow />
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        {/* The section's name, as on the list: this is where the section opens, and the tab below names this page. */}
        <h1 className="text-balance font-display text-3xl font-medium tracking-[-0.015em] sm:text-4xl">
          <MixedText text={tk("title")} />
        </h1>
        <KosakataTabs current="path" />
        <p className="mt-3 max-w-prose text-pretty text-lg text-ink-muted">
          <MixedText text={t("intro")} />
        </p>
        <PathMap
          levels={mapLevels(pathSource())}
          partCount={Object.keys(path.parts).length}
          attachedShare={path.attached_share}
          totalTokens={kosakataIndex().total_tokens}
          passPercent={path.pass_percent}
        />
      </div>
    </div>
  );
}
