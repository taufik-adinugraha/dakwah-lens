import type { Metadata } from "next";
import { ArrowRight, Calculator, ChevronDown, ShieldCheck } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Breadcrumb } from "@/components/Breadcrumb";
import { AiChip } from "@/components/waris/report/AiChip";
import { Link } from "@/i18n/navigation";
import { hubHref, warisHref } from "@/lib/routes";

import "@/app/waris.css";

export async function generateMetadata({ params }: PageProps<"/[locale]/waris">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Track" });
  return {
    title: t("meta_title"),
    description: t("meta_description"),
    // noindex beta, like the rest of the module (plan §9.1); promoting waris is a separate decision
    robots: { index: false, follow: true },
  };
}

/**
 * Track home of "Ilmu Waris (Faraidh)" (docs/waris-plan.md §9.1, D1). What exists today is the
 * calculator, so there is exactly one door: "Hitung waris keluarga saya". Lessons and case studies
 * get doors when they exist (no placeholders). The method label "Faraidh — selaras fatwa MUI,
 * dengan catatan KHI" describes the fikih column only (D1); its long form sits behind a disclosure.
 */
export default async function WarisTrackPage({ params }: PageProps<"/[locale]/waris">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Track");
  const tb = await getTranslations("Breadcrumb");

  return (
    <div className="waris mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
      <Breadcrumb label={tb("label")} items={[{ label: tb("hub"), href: hubHref() }, { label: t("breadcrumb") }]} />

      <section className="mt-4 max-w-2xl">
        <AiChip label={t("chip")} />
        <h1 className="mt-3 text-balance font-display text-3xl font-medium tracking-[-0.015em] sm:text-5xl">{t("title")}</h1>
        <p className="mt-4 max-w-prose text-pretty text-lg text-ink-muted">{t("intro")}</p>
      </section>

      {/* Mandatory label (AGENTS.md): visible, never collapsed. */}
      <p className="mt-6 flex max-w-2xl items-start gap-2 rounded-xl border-[1.5px] border-notice bg-notice-bg px-4 py-3 text-base font-medium text-ink">
        <ShieldCheck className="mt-1 h-5 w-5 shrink-0 text-notice" aria-hidden />
        <span>{t("disclaimer")}</span>
      </p>

      <section className="mt-8 max-w-2xl" aria-labelledby="metode">
        <h2 id="metode" className="text-lg font-semibold text-ink">
          {t("method_heading")}
        </h2>
        <p className="mt-2 font-display text-xl font-medium text-ink">{t("label")}</p>
        <details className="mt-3 rounded-xl border border-hairline bg-white px-4">
          <summary className="disclosure-row text-ink">
            {t("label_more")}
            <ChevronDown className="chev h-5 w-5 shrink-0" aria-hidden />
          </summary>
          <div className="space-y-3 pb-4 text-base text-ink">
            <p className="text-pretty">{t("label_long")}</p>
            <p className="text-pretty text-ink-muted">{t("label_scope")}</p>
          </div>
        </details>
      </section>

      <section className="mt-10" aria-labelledby="hitung">
        <h2 id="hitung" className="sr-only">
          {t("door_title")}
        </h2>
        <div className="max-w-2xl rounded-2xl border border-hairline bg-white p-5 shadow-sm sm:p-8">
          <Calculator className="h-7 w-7 text-forest" aria-hidden />
          <p className="mt-3 font-display text-2xl font-medium text-ink">{t("door_title")}</p>
          <p className="mt-2 text-pretty text-base text-ink-muted">{t("door_body")}</p>
          <p className="mt-2 text-pretty text-base text-ink-muted">{t("door_privacy")}</p>
          <Link href={warisHref.hitung()} className="btn-primary mt-6 w-full sm:w-auto">
            {t("door_cta")}
            <ArrowRight className="h-5 w-5" aria-hidden />
          </Link>
        </div>
      </section>
    </div>
  );
}
