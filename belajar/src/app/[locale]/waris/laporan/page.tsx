import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";

import { Breadcrumb } from "@/components/Breadcrumb";
import { projectReportContent } from "@/components/waris/report/content";
import { WarisReport } from "@/components/waris/report/WarisReport";
import type { ReportDalilRecord, ReportRules } from "@/lib/waris/report";
import { loadWarisContent } from "@/lib/waris-content";
import { hubHref, warisHref } from "@/lib/routes";

import "@/app/waris.css";

/** What the report's client tree reads (the layout's provider leaves the waris namespaces out). */
const CLIENT_NAMESPACES = ["Report"] as const;

/**
 * /waris/laporan: "Rekomendasi Pembagian Waris" (docs/waris-plan.md §6, §9.1). A static shell: the
 * RuleNotes and dalil records are validated at build time (loadWarisContent throws on a malformed
 * file) and handed to the client report, which reads the answers in the browser and computes there.
 * No server code path touches the answers (plan §9.4). Always noindex: a report is personal.
 */
export async function generateMetadata({ params }: PageProps<"/[locale]/waris/laporan">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Report.ui" });
  return {
    title: t("meta_title"),
    robots: { index: false, follow: false },
  };
}

export default async function WarisLaporanPage({ params }: PageProps<"/[locale]/waris/laporan">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const tb = await getTranslations("Breadcrumb");
  const tt = await getTranslations("Track");
  const t = await getTranslations("Report.ui");
  const all = await getMessages();
  const clientMessages = Object.fromEntries(CLIENT_NAMESPACES.map((ns) => [ns, all[ns]]));

  const content = loadWarisContent();
  const { rules, dalil } = projectReportContent(
    content.rules as unknown as ReportRules,
    [...content.dalil, ...content.gaps] as unknown as ReportDalilRecord[],
  );

  return (
    <div className="waris mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
      <div data-print="hide">
        <Breadcrumb
          label={tb("label")}
          items={[{ label: tb("hub"), href: hubHref() }, { label: tt("breadcrumb"), href: warisHref.track() }, { label: t("breadcrumb") }]}
        />
      </div>
      {/* The report is Indonesian only in v1 (plan D11): English chrome around Indonesian content. */}
      {locale !== "id" ? (
        <p className="mt-4 rounded-xl border border-hairline bg-paper-deep px-4 py-3 text-base text-ink" data-print="hide">
          {t("bahasa_indonesia")}
        </p>
      ) : null}
      <div className="mt-4">
        <NextIntlClientProvider messages={clientMessages}>
          <WarisReport rules={rules} dalil={dalil} />
        </NextIntlClientProvider>
      </div>
    </div>
  );
}
