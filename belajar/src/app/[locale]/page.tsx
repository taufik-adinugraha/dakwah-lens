import type { Metadata } from "next";
import { ArrowRight, BookOpenCheck, Hourglass, Library, Mic } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { TextSizeHint } from "@/components/TextSizeSwitch";
import { Link } from "@/i18n/navigation";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Home" });
  return {
    title: { absolute: `${t("heading")} · Dakwah-Lens` },
    alternates: {
      canonical: `https://dakwah-lens.id/belajar/${locale}`,
      languages: {
        id: "https://dakwah-lens.id/belajar/id",
        en: "https://dakwah-lens.id/belajar/en",
        "x-default": "https://dakwah-lens.id/belajar/id",
      },
    },
  };
}

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Home");

  const principles = [
    { Icon: Mic, title: t("p1_title"), body: t("p1_body") },
    { Icon: Library, title: t("p2_title"), body: t("p2_body") },
    { Icon: BookOpenCheck, title: t("p3_title"), body: t("p3_body") },
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <section className="max-w-2xl">
        <p className="text-sm font-semibold text-forest">{t("eyebrow")}</p>
        <h1 className="mt-2 text-balance font-display text-3xl font-medium tracking-[-0.015em] sm:text-5xl">
          {t("heading")}
        </h1>
        <p className="mt-4 max-w-prose text-pretty text-lg text-ink-muted">
          {t("intro")}
        </p>
      </section>

      {/* One-time card: hidden before paint once the learner has chosen a
          size or closed it. The header switch is always there. */}
      <TextSizeHint className="mt-8" />

      <section className="mt-10" aria-labelledby="start">
        <h2 id="start" className="text-lg font-semibold text-ink">
          {t("surah_heading")}
        </h2>
        <div className="mt-3 rounded-2xl border border-hairline bg-white p-5 shadow-sm sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="font-display text-2xl font-medium">
                {t("fatihah_name")}
              </p>
              <p className="mt-1 text-base text-ink-muted">{t("fatihah_meta")}</p>
            </div>
            <p lang="ar" dir="rtl" className="quran text-ar-lg text-ink">
              سُورَةُ الْفَاتِحَةِ
            </p>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Link href="/al-fatihah" className="btn-primary w-full sm:w-auto">
              {t("start_cta")}
              <ArrowRight className="h-5 w-5" aria-hidden />
            </Link>
            {/* Status, not a control: icon + words, readable amber on its
                own tint (5.91:1), dashed edge reads as "draft". */}
            <span className="inline-flex items-center gap-2 rounded-full border-[1.5px] border-dashed border-notice bg-notice-bg px-3 py-1 text-sm font-medium text-notice">
              <Hourglass className="h-4 w-4 shrink-0" aria-hidden />
              {t("status_preparing")}
            </span>
          </div>
        </div>
        <p className="mt-4 max-w-prose text-base text-ink-muted">
          <span className="font-semibold text-ink">{t("next_heading")}:</span>{" "}
          {t("next_body")}
        </p>
      </section>

      <section className="mt-12" aria-labelledby="principles">
        <h2 id="principles" className="text-lg font-semibold text-ink">
          {t("principles_heading")}
        </h2>
        {/* Container query, not a media query: columns collapse as the
            learner's text size grows (senior-ux.md §3.4). */}
        <div className="@container mt-3">
          <ul className="grid gap-4 @3xl:grid-cols-3">
            {principles.map(({ Icon, title, body }) => (
              <li
                key={title}
                className="rounded-2xl border border-hairline bg-white p-5"
              >
                <Icon className="h-6 w-6 text-forest" aria-hidden />
                <p className="mt-3 font-display text-xl font-medium">{title}</p>
                <p className="mt-1.5 text-base text-ink-muted">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
