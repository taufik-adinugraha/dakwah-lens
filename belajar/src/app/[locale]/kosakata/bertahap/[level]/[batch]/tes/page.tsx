import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PathTest } from "@/components/kosakata/PathTest";
import { kosakataIndex, kosakataPath } from "@/lib/kosakata";
import { pathSource } from "@/lib/kosakata-path";
import { batchOrder } from "@/lib/kosakata-path-core";
import { batchOf, levelOf, mapLevels, testData } from "@/lib/kosakata-path-data";

export async function generateMetadata({ params }: PageProps<"/[locale]/kosakata/bertahap/[level]/[batch]/tes">): Promise<Metadata> {
  const { locale, level, batch } = await params;
  const t = await getTranslations({ locale, namespace: "KosakataPath" });
  return { title: t("test_title_batch", { level, batch }) };
}

/** One batch's test: the new words, and some earlier ones. */
export default async function KosakataBatchTestPage({ params }: PageProps<"/[locale]/kosakata/bertahap/[level]/[batch]/tes">) {
  const { locale, level: rawLevel, batch: rawBatch } = await params;
  setRequestLocale(locale);
  const src = pathSource();
  const level = levelOf(src, rawLevel);
  const batch = level ? batchOf(level, rawBatch) : null;
  if (!level || !batch) notFound();
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <PathTest
        data={testData(src, level, batch)}
        level={level.n}
        batch={batch}
        passPercent={kosakataPath().pass_percent}
        order={batchOrder(mapLevels(src))}
        source={kosakataIndex().translation.source_label}
      />
    </div>
  );
}
