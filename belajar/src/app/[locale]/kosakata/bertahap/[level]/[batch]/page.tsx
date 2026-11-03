import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { BatchLearn } from "@/components/kosakata/BatchLearn";
import { kosakataIndex } from "@/lib/kosakata";
import { pathSource } from "@/lib/kosakata-path";
import { batchOrder } from "@/lib/kosakata-path-core";
import { batchCards, batchOf, levelOf, mapLevels } from "@/lib/kosakata-path-data";
import { kosakataBatchTestHref } from "@/lib/routes";

export async function generateMetadata({ params }: PageProps<"/[locale]/kosakata/bertahap/[level]/[batch]">): Promise<Metadata> {
  const { locale, level: rawLevel, batch: rawBatch } = await params;
  const t = await getTranslations({ locale, namespace: "KosakataPath" });
  return { title: t("batch_eyebrow", { level: rawLevel, batch: rawBatch }) };
}

/** One batch of the learning path: its cards, one at a time, then its test. */
export default async function KosakataBatchPage({ params }: PageProps<"/[locale]/kosakata/bertahap/[level]/[batch]">) {
  const { locale, level: rawLevel, batch: rawBatch } = await params;
  setRequestLocale(locale);
  const src = pathSource();
  const level = levelOf(src, rawLevel);
  const batch = level ? batchOf(level, rawBatch) : null;
  if (!level || !batch) notFound();
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <BatchLearn
        level={level.n}
        batch={batch}
        cards={batchCards(src, level, batch)}
        order={batchOrder(mapLevels(src))}
        testHref={kosakataBatchTestHref(level.n, batch)}
        source={kosakataIndex().translation.source_label}
      />
    </div>
  );
}
