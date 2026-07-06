import { ForestWash } from "@/components/ForestWash";
import type { Metadata } from "next";
import Image from "next/image";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowUpRight } from "lucide-react";

import { auth } from "@/auth";
import { Link } from "@/i18n/navigation";
import { marketingSectionLink } from "@/lib/marketing-href";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/about">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "About" });
  return { title: t("page_title") };
}

export default async function AboutPage({
  params,
}: PageProps<"/[locale]/about">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, session] = await Promise.all([getTranslations("About"), auth()]);
  const donateHref = marketingSectionLink(
    session?.user?.status === "approved",
    locale,
  )("#donate");

  return (
    <div className="relative isolate overflow-hidden bg-paper font-body">
      <ForestWash />
      <Hero t={t} />
      <Story t={t} />
      <Supervisor t={t} />
      <Legacy t={t} />
      <Daleel t={t} />
      <CTA t={t} donateHref={donateHref} />
    </div>
  );
}

type T = Awaited<ReturnType<typeof getTranslations<"About">>>;

function Hero({ t }: { t: T }) {
  return (
    <section className="pt-20 pb-16 sm:pt-28 sm:pb-20">
      <div className="mx-auto max-w-3xl px-6 text-center">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-ink-faint">
          {t("badge")}
        </p>
        <h1 className="mt-5 text-balance font-display text-[clamp(2.25rem,5vw,3.5rem)] font-medium leading-[1.1] tracking-[-0.02em] text-ink">
          {t("hero_title")}
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg leading-[1.7] text-ink-muted">
          {t("hero_subtitle")}
        </p>
      </div>
    </section>
  );
}

function Story({ t }: { t: T }) {
  return (
    <section className="border-t border-hairline py-16 sm:py-20">
      <div className="mx-auto grid max-w-5xl gap-10 px-6 lg:grid-cols-[1fr_1.4fr] lg:items-start">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-ink-faint">
            {t("story_chip")}
          </p>
          <h2 className="mt-4 text-balance font-display text-2xl font-medium leading-[1.2] tracking-[-0.015em] text-ink sm:text-3xl">
            {t("story_title")}
          </h2>
        </div>

        <div className="space-y-4 text-pretty text-[15px] leading-[1.7] text-ink-muted">
          <p>{t("story_p1")}</p>
          <p>{t("story_p2")}</p>
          <p>{t("story_p3")}</p>
        </div>
      </div>
    </section>
  );
}

function Supervisor({ t }: { t: T }) {
  // Two supervisors as of 2026-06-11: Nasruddin (academic / institutional
  // discipline) + Abdullah Haidir (syariah / content authority). Both
  // profiles share the same editorial-row shell — only the portrait,
  // name, role/body keys, and profile link differ. Kept stacked (not a
  // grid) so each profile gets full reading width.
  return (
    <section className="border-t border-hairline py-16 sm:py-20">
      <div className="mx-auto max-w-5xl px-6">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-ink-faint">
          {t("supervisor_chip")}
        </p>
        <h2 className="mt-4 text-balance font-display text-2xl font-medium leading-[1.2] tracking-[-0.015em] text-ink sm:text-3xl">
          {t("supervisor_title")}
        </h2>

        <div className="mt-10">
          <article className="grid gap-5 border-t border-hairline py-8 sm:grid-cols-[auto_1fr] sm:gap-8">
            <Image
              src="/team/nasruddin.png"
              alt="Prof. Dr.-Ing. Ir. Nasruddin, M.Eng."
              width={64}
              height={64}
              className="h-16 w-16 shrink-0 rounded-full object-cover ring-1 ring-hairline"
              priority
            />
            {/* Was a gradient avatar with the letter "N" — swapped to the
                actual portrait on 2026-05-22. File lives in
                `web/public/team/nasruddin.png`. */}
            <div>
              <a
                href="https://eng.ui.ac.id/personnel/nasruddin/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-balance font-display text-lg font-medium leading-snug text-ink transition hover:text-forest sm:text-xl"
              >
                Prof. Dr.-Ing. Ir. Nasruddin, M.Eng.
              </a>
              <p className="mt-1 text-sm font-medium text-ink-muted">
                {t("supervisor_role")}
              </p>
              <p className="mt-3 max-w-xl text-pretty text-sm leading-[1.7] text-ink-muted">
                {t("supervisor_body")}
              </p>
              <a
                href="https://eng.ui.ac.id/personnel/nasruddin/"
                target="_blank"
                rel="noopener noreferrer"
                className="group mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-forest transition hover:text-forest-hover"
              >
                {t("supervisor_profile_link")}
                <ArrowUpRight className="h-3 w-3 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </a>
            </div>
          </article>

          {/* Ust. Abdullah Haidir — syariah supervisor (added 2026-06-11).
              Image at web/public/team/uah.png. Profile link goes to
              manhajuna.com, the dakwah portal he personally curates. */}
          <article className="grid gap-5 border-t border-hairline py-8 sm:grid-cols-[auto_1fr] sm:gap-8">
            <Image
              src="/team/uah.png"
              alt="Ust. Abdullah Haidir, Lc."
              width={64}
              height={64}
              className="h-16 w-16 shrink-0 rounded-full object-cover ring-1 ring-hairline"
            />
            <div>
              <a
                href="https://manhajuna.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-balance font-display text-lg font-medium leading-snug text-ink transition hover:text-forest sm:text-xl"
              >
                Ust. Abdullah Haidir, Lc.
              </a>
              <p className="mt-1 text-sm font-medium text-ink-muted">
                {t("supervisor_haidir_role")}
              </p>
              <p className="mt-3 max-w-xl text-pretty text-sm leading-[1.7] text-ink-muted">
                {t("supervisor_haidir_body")}
              </p>
              <a
                href="https://manhajuna.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="group mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-forest transition hover:text-forest-hover"
              >
                {t("supervisor_haidir_profile_link")}
                <ArrowUpRight className="h-3 w-3 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </a>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}

function Legacy({ t }: { t: T }) {
  return (
    <section className="border-t border-hairline py-16 sm:py-20">
      <div className="mx-auto max-w-3xl px-6 text-center">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-ink-faint">
          {t("legacy_chip")}
        </p>
        <h2 className="mt-4 text-balance font-display text-2xl font-medium leading-[1.2] tracking-[-0.015em] text-ink sm:text-3xl">
          {t("legacy_title")}
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-pretty text-[15px] leading-[1.7] text-ink-muted">
          {t("legacy_body")}
        </p>
      </div>
    </section>
  );
}

function Daleel({ t }: { t: T }) {
  // Three foundational references for the amal-jariyah framing. Sourced
  // directly from established kitab — keep verbatim and double-checked.
  const items = [
    {
      kind: "hadith" as const,
      arabic: t("daleel_1_arabic"),
      translation: t("daleel_1_translation"),
      source: t("daleel_1_source"),
      note: t("daleel_1_note"),
    },
    {
      kind: "quran" as const,
      arabic: t("daleel_2_arabic"),
      translation: t("daleel_2_translation"),
      source: t("daleel_2_source"),
      note: t("daleel_2_note"),
    },
    {
      kind: "hadith" as const,
      arabic: t("daleel_3_arabic"),
      translation: t("daleel_3_translation"),
      source: t("daleel_3_source"),
      note: t("daleel_3_note"),
    },
  ];

  return (
    <section className="border-t border-hairline py-16 sm:py-20">
      <div className="mx-auto max-w-3xl px-6">
        <div className="text-center">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-ink-faint">
            {t("daleel_chip")}
          </p>
          <h2 className="mt-4 text-balance font-display text-2xl font-medium leading-[1.2] tracking-[-0.015em] text-ink sm:text-3xl">
            {t("daleel_title")}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-pretty text-sm leading-[1.7] text-ink-muted sm:text-base">
            {t("daleel_subtitle")}
          </p>
        </div>

        <div className="mt-12">
          {items.map((d, i) => (
            <article key={i} className="border-t border-hairline py-8">
              <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-forest">
                {d.kind === "quran" ? t("kind_quran") : t("kind_hadith")}
              </p>
              <p
                lang="ar"
                dir="rtl"
                className="mt-4 font-amiri text-xl leading-[1.9] text-ink"
              >
                {d.arabic}
              </p>
              <p className="mt-4 text-pretty text-sm leading-[1.7] text-ink-muted">
                &ldquo;{d.translation}&rdquo;
              </p>
              <p className="mt-3 text-xs font-semibold text-ink">
                — {d.source}
              </p>
              <p className="mt-3 text-pretty text-xs leading-relaxed text-ink-faint">
                {d.note}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function CTA({ t, donateHref }: { t: T; donateHref: string }) {
  return (
    <section className="border-t border-hairline py-20 sm:py-28">
      <div className="mx-auto max-w-2xl px-6 text-center">
        <h2 className="text-balance font-display text-[clamp(1.75rem,3.5vw,2.5rem)] font-medium leading-[1.15] tracking-[-0.015em] text-ink">
          {t("cta_title")}
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-pretty text-[15px] leading-[1.7] text-ink-muted">
          {t("cta_body")}
        </p>
        <div className="mt-9 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <a
            href={donateHref}
            className="inline-flex h-12 items-center justify-center rounded-full bg-forest px-7 text-sm font-semibold text-paper shadow-sm transition hover:bg-forest-hover"
          >
            {t("cta_donate")}
          </a>
          <Link
            href="/"
            className="inline-flex h-12 items-center text-sm font-semibold text-ink-muted transition hover:text-ink"
          >
            {t("cta_explore")}
          </Link>
        </div>
      </div>
    </section>
  );
}
