import type { Metadata } from "next";
import { Lock } from "lucide-react";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";

import { Breadcrumb } from "@/components/Breadcrumb";
import { AiChip } from "@/components/waris/report/AiChip";
import { HitungApp } from "@/components/waris/questionnaire/HitungApp";
import { buildRulePack } from "@/components/waris/questionnaire/rulePack";
import { hubHref, warisHref } from "@/lib/routes";
import { loadWarisContent } from "@/lib/waris-content";
import type { ReportDalilRecord, ReportRules } from "@/lib/waris/report/content";
import { REPORT_MESSAGES, type ReportMsgKey } from "@/lib/waris/report/messages";

import "@/app/waris.css";

/** What the questionnaire's client tree reads (the layout's provider leaves the waris namespaces out). */
const CLIENT_NAMESPACES = ["Q", "Exit"] as const;

export async function generateMetadata({ params }: PageProps<"/[locale]/waris/hitung">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Q.halaman" });
  return {
    title: t("meta_judul"),
    description: t("meta_deskripsi"),
    // A calculator families act on: never indexed while the module is a beta (plan §9.1).
    robots: { index: false, follow: true },
    alternates: {
      canonical: `https://dakwah-lens.id/belajar/${locale}${warisHref.hitung()}`,
      languages: {
        id: `https://dakwah-lens.id/belajar/id${warisHref.hitung()}`,
        en: `https://dakwah-lens.id/belajar/en${warisHref.hitung()}`,
        "x-default": `https://dakwah-lens.id/belajar/id${warisHref.hitung()}`,
      },
    },
  };
}

/**
 * "Hitung waris keluarga saya" (docs/waris-plan.md §5, §9.1): a static shell and one client
 * component. No server action, no route handler, no <form action>: the answers are computed in
 * the browser and never reach our server (plan §9.4). The shell carries the mandatory labels
 * ("Dibantu AI, bukan fatwa otoritatif, bukan penetapan pengadilan") so they are in the HTML of
 * every render, and prepares the RuleNotes and dalil the questions and exit pages show, from
 * content/waris/*.json, at build time. The questionnaire is Indonesian in v1 (plan D11); the
 * /en page keeps English chrome and says so.
 */
export default async function HitungPage({ params }: PageProps<"/[locale]/waris/hitung">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Q.halaman");
  const tb = await getTranslations("Breadcrumb");
  const tAll = await getTranslations();
  const all = await getMessages();
  const clientMessages = Object.fromEntries(CLIENT_NAMESPACES.map((ns) => [ns, all[ns]]));

  // The report's dalil labels ("Terjemahan internal, …") come from the report's messages
  // ("Report.laporan.*" in messages/waris) when present, else from the report's default table.
  const lookup = (k: ReportMsgKey): string => (tAll.has(`Report.${k}`) ? String(tAll.raw(`Report.${k}`)) : REPORT_MESSAGES[k]);
  const content = loadWarisContent();
  const pack = buildRulePack(
    content.rules as unknown as ReportRules,
    [...content.dalil, ...content.gaps] as unknown as ReportDalilRecord[],
    lookup,
  );

  return (
    <div className="waris mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
      <Breadcrumb
        label={tb("label")}
        className="print:hidden"
        items={[{ label: tb("hub"), href: hubHref() }, { label: t("crumb_waris"), href: warisHref.track() }, { label: t("crumb_hitung") }]}
      />

      <header className="mt-4 max-w-2xl">
        <h1 className="text-balance font-display text-3xl font-medium tracking-[-0.015em] text-ink sm:text-4xl">{t("judul")}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <AiChip label={t("chip")} />
        </div>
        <p className="mt-3 max-w-prose text-base font-semibold text-ink">{t("label")}</p>
        <p className="mt-3 max-w-prose text-pretty text-lg text-ink-muted print:hidden">{t("pengantar")}</p>
        <p className="mt-3 flex max-w-prose gap-2 text-base text-ink">
          <Lock className="mt-1 h-5 w-5 shrink-0 text-forest" aria-hidden />
          <span>{t("privasi")}</span>
        </p>
        {locale !== "id" ? (
          <p className="mt-3 max-w-prose rounded-xl border-[1.5px] border-dashed border-notice bg-notice-bg px-4 py-2 text-base text-ink">
            {t("bahasa")}
          </p>
        ) : null}
      </header>

      <noscript>
        <p className="mt-8 max-w-prose text-base text-ink">{t("noscript")}</p>
      </noscript>
      {/* The questionnaire itself is Indonesian on every locale (plan D11). */}
      <div lang="id" className="mt-8">
        <NextIntlClientProvider messages={clientMessages}>
          <HitungApp pack={pack} locale={locale} backHref={warisHref.track()} />
        </NextIntlClientProvider>
      </div>
    </div>
  );
}
