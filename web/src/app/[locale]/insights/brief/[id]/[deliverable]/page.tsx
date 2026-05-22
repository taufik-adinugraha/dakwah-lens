import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { getBriefingBySlug } from "@/lib/insights-data";
import {
  BriefDetailContent,
  type DeliverableSlug,
} from "../BriefDetailContent";

/**
 * Deep-link sub-route for a single Section-4 deliverable inside a brief.
 *
 *   /insights/brief/{slug}/khutbah   → opens the Khutbah Jumat modal
 *   /insights/brief/{slug}/kajian    → opens Kajian Ibu-ibu modal
 *   /insights/brief/{slug}/home      → opens Pengajaran di Rumah modal
 *   /insights/brief/{slug}/content   → opens Kreator Konten Digital modal
 *   /insights/brief/{slug}/genz      → opens Pendekatan Gen Z modal
 *   /insights/brief/{slug}/action    → opens Aksi Sosial & Khidmah Umat
 *
 * Renders the full brief page (so refresh + back-button work correctly)
 * and passes `initialDeliverable` down so `BriefDeliverableCards` opens
 * the matching modal on mount. Closing the modal client-side replaces
 * the URL with `/insights/brief/{slug}` — no page reload.
 *
 * An unknown deliverable slug 404s; that's enforced by the literal-union
 * narrowing on `DeliverableSlug` below.
 */

const VALID_SLUGS: ReadonlySet<DeliverableSlug> = new Set([
  "khutbah",
  "kajian",
  "home",
  "content",
  "genz",
  "action",
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

  const t = await getTranslations({ locale, namespace: "Insights" });
  const brief = await getBriefingBySlug(id);
  if (!brief) return { title: t("brief_not_found_title") };

  const scopeLabel = brief.segment
    ? t(`segment_${brief.segment}_title` as Parameters<typeof t>[0])
    : t("brief_scope_all");
  const dateStr = brief.generatedAt.toLocaleDateString(locale, {
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
