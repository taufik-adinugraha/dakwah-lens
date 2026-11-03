import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PathTest } from "@/components/kosakata/PathTest";
import { kosakataIndex, kosakataPath } from "@/lib/kosakata";
import { pathSource } from "@/lib/kosakata-path";
import { batchOrder } from "@/lib/kosakata-path-core";
import { levelOf, mapLevels, testData } from "@/lib/kosakata-path-data";

export async function generateMetadata({ params }: PageProps<"/[locale]/kosakata/bertahap/[level]/tes">): Promise<Metadata> {
  const { locale, level } = await params;
  const t = await getTranslations({ locale, namespace: "KosakataPath" });
  return { title: t("test_title_level", { level }) };
}

/**
 * A level's test: open to anyone at any time, whether or not the level is reached. Someone who knows
 * these words should not sit through its batches, and it is how a learner on a new device gets back.
 */
export default async function KosakataLevelTestPage({ params }: PageProps<"/[locale]/kosakata/bertahap/[level]/tes">) {
  const { locale, level: rawLevel } = await params;
  setRequestLocale(locale);
  const src = pathSource();
  const level = levelOf(src, rawLevel);
  if (!level) notFound();
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <PathTest
        data={testData(src, level, null)}
        level={level.n}
        batch={null}
        passPercent={kosakataPath().pass_percent}
        order={batchOrder(mapLevels(src))}
        source={kosakataIndex().translation.source_label}
      />
    </div>
  );
}
