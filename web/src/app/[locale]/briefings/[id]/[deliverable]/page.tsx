import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { getBriefingBySlug } from "@/lib/briefing-data";
import { localeAwareFormat } from "@/lib/date-id";
import {
  BriefDetailContent,
  type DeliverableSlug,
} from "../BriefDetailContent";

/**
 * Deep-link sub-route for a single Section-4 deliverable inside a brief.
 *
 *   /briefings/{slug}/khutbah   → opens the Khutbah Jumat modal
 *   /briefings/{slug}/kultum    → opens Kultum modal
 *   /briefings/{slug}/kajian    → opens Kajian Ibu-ibu modal
 *   /briefings/{slug}/kisah     → opens Kisah dari Hadits modal
 *   /briefings/{slug}/home      → opens Pengajaran di Rumah modal
 *   /briefings/{slug}/content   → opens Kreator Konten Digital modal
 *   /briefings/{slug}/genz      → opens Pendekatan Gen Z modal
 *   /briefings/{slug}/action    → opens Aksi Sosial & Khidmah Umat
 *
 * Renders the full brief page (so refresh + back-button work correctly)
 * and passes `initialDeliverable` down so `BriefDeliverableCards` opens
 * the matching modal on mount. Closing the modal client-side replaces
 * the URL with `/briefings/{slug}` — no page reload.
 *
 * An unknown deliverable slug 404s; that's enforced by the literal-union
 * narrowing on `DeliverableSlug` below.
 */

const VALID_SLUGS: ReadonlySet<DeliverableSlug> = new Set([
  "khutbah",
  "kultum",
  "kajian",
  "kisah",
  "home",
  "content",
  "genz",
  "action",
  "artikel-1",
  "artikel-2",
  "artikel-3",
  "artikel-4",
  "tafsir-1",
  "tafsir-2",
  "tafsir-3",
  "tafsir-4",
]);

function asDeliverable(raw: string): DeliverableSlug | null {
  return (VALID_SLUGS as ReadonlySet<string>).has(raw)
    ? (raw as DeliverableSlug)
    : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string; deliverable: string }>;
}): Promise<Metadata> {
  const { locale, id, deliverable } = await params;
  const slug = asDeliverable(deliverable);
  if (!slug) return { title: "Not found" };

  const t = await getTranslations({ locale, namespace: "Briefing" });
  const brief = await getBriefingBySlug(id);
  if (!brief) return { title: t("brief_not_found_title") };

  // 14-group labels (e.g. "Teknologi & AI") are human-readable Indonesian —
  // use verbatim instead of routing through legacy segment_${slug}_title
  // i18n keys that no longer exist (they only covered the old 5 segments).
  const scopeLabel = brief.themeGroup ?? t("brief_scope_all");
  const dateStr = localeAwareFormat(brief.generatedAt, locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });
  // Same title shape as the parent route — the deep link is a focused view
  // of the same brief, not a new document, so search engines and social
  // unfurls should treat them as one.
  return {
    title: t("brief_page_title", { scope: scopeLabel, date: dateStr }),
  };
}

export default async function BriefDeliverablePage({
  params,
}: {
  params: Promise<{ locale: string; id: string; deliverable: string }>;
}) {
  const { locale, id, deliverable } = await params;
  const slug = asDeliverable(deliverable);
  if (!slug) notFound();

  return (
    <BriefDetailContent locale={locale} id={id} initialDeliverable={slug} />
  );
}
