import type { Metadata } from "next";
import { BookOpenCheck, Library, Mic } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

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
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
      <section className="max-w-2xl">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-forest">
          {t("eyebrow")}
        </p>
        <h1 className="mt-2 text-balance font-display text-3xl font-medium tracking-[-0.015em] sm:text-5xl">
          {t("heading")}
        </h1>
        <p className="mt-4 text-pretty text-base leading-[1.75] text-ink-muted">
          {t("intro")}
        </p>
      </section>

      <section className="mt-10" aria-labelledby="start">
        <h2
          id="start"
          className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted"
        >
          {t("surah_heading")}
        </h2>
        <div className="mt-4 rounded-2xl border border-hairline bg-white p-6 shadow-sm sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="font-display text-2xl font-medium">
                {t("fatihah_name")}
              </p>
              <p className="mt-1 text-sm text-ink-muted">{t("fatihah_meta")}</p>
            </div>
            <p lang="ar" dir="rtl" className="quran text-3xl text-ink">
              سُورَةُ الْفَاتِحَةِ
            </p>
          </div>
          <p className="mt-5 inline-flex rounded-full border border-dashed border-hairline px-3 py-1 text-xs font-medium text-ink-muted">
            {t("status_preparing")}
          </p>
        </div>
        <p className="mt-4 text-sm text-ink-muted">
          <span className="font-semibold text-ink">{t("next_heading")}:</span>{" "}
          {t("next_body")}
        </p>
      </section>

      <section className="mt-12" aria-labelledby="principles">
        <h2
          id="principles"
          className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted"
        >
          {t("principles_heading")}
        </h2>
        <ul className="mt-4 grid gap-4 sm:grid-cols-3">
          {principles.map(({ Icon, title, body }) => (
            <li
              key={title}
              className="rounded-2xl border border-hairline bg-white p-5"
            >
              <Icon className="h-5 w-5 text-forest" aria-hidden />
              <p className="mt-3 font-display text-lg font-medium">{title}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
                {body}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
