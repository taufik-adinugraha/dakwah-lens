import type { Metadata } from "next";
import Image from "next/image";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  ArrowUpRight,
  BookOpenCheck,
  ExternalLink,
  GraduationCap,
  HeartHandshake,
  Quote,
  Sparkles,
  Users,
} from "lucide-react";

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
    <>
      <Hero t={t} />
      <Story t={t} />
      <Supervisor t={t} />
      <Legacy t={t} />
      <Daleel t={t} />
      <CTA t={t} donateHref={donateHref} />
    </>
  );
}

type T = Awaited<ReturnType<typeof getTranslations<"About">>>;

function Hero({ t }: { t: T }) {
  return (
    <section className="relative isolate overflow-hidden pt-12 pb-10 sm:pt-16 sm:pb-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      >
        <div className="absolute inset-0 grid-bg opacity-40" />
        <div className="absolute -top-24 left-1/2 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-emerald-200 opacity-40 blur-3xl" />
      </div>

      <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50/80 px-3 py-1 text-xs font-medium text-emerald-700 shadow-sm backdrop-blur">
          <HeartHandshake className="h-3.5 w-3.5" />
          {t("badge")}
        </span>
        <h1 className="mt-4 text-balance text-3xl font-bold leading-[1.1] tracking-tight text-slate-900 sm:text-5xl">
          {t("hero_title")}
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-pretty text-base leading-relaxed text-slate-600 sm:text-lg">
          {t("hero_subtitle")}
        </p>
      </div>
    </section>
  );
}

function Story({ t }: { t: T }) {
  return (
    <section className="py-12 sm:py-16">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[1fr_1.4fr] lg:items-start">
        <div className="space-y-3">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm">
            <Users className="h-3.5 w-3.5" />
            {t("story_chip")}
          </span>
          <h2 className="text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            {t("story_title")}
          </h2>
        </div>

        <div className="space-y-4 text-pretty text-[15px] leading-relaxed text-slate-700">
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
  // cards share the same shell — only the portrait, name, role/body keys,
  // and profile link differ. Kept as two articles stacked under one
  // section rather than a grid so each profile gets full reading width
  // (a 2-column grid would compress the body text).
  return (
    <section className="border-y border-slate-100 bg-gradient-to-b from-white to-slate-50/40 py-12 sm:py-16">
      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50/80 px-3 py-1 text-xs font-semibold text-brand-700">
            <GraduationCap className="h-3.5 w-3.5" />
            {t("supervisor_chip")}
          </span>
          <h2 className="mt-3 text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            {t("supervisor_title")}
          </h2>
        </div>

        <div className="mt-8 grid gap-5">
          <article className="grid gap-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:grid-cols-[auto_1fr] sm:items-start sm:gap-6 sm:p-8">
            <Image
              src="/team/nasruddin.png"
              alt="Prof. Dr.-Ing. Ir. Nasruddin, M.Eng."
              width={64}
              height={64}
              className="h-16 w-16 shrink-0 rounded-2xl object-cover shadow-md ring-1 ring-slate-200"
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
                className="group inline-flex items-baseline gap-1.5 text-balance text-lg font-bold leading-snug text-slate-900 transition hover:text-brand-700 sm:text-xl"
              >
                Prof. Dr.-Ing. Ir. Nasruddin, M.Eng.
                <ExternalLink className="h-3.5 w-3.5 text-slate-400 transition group-hover:text-brand-600" />
              </a>
              <p className="mt-1 text-sm font-medium text-slate-600">
                {t("supervisor_role")}
              </p>
              <p className="mt-3 text-pretty text-sm leading-relaxed text-slate-600">
                {t("supervisor_body")}
              </p>
              <a
                href="https://eng.ui.ac.id/personnel/nasruddin/"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700 hover:text-brand-900"
              >
                {t("supervisor_profile_link")}
                <ArrowUpRight className="h-3 w-3" />
              </a>
            </div>
          </article>

          {/* Ust. Abdullah Haidir — syariah supervisor (added 2026-06-11).
              Image at web/public/team/uah.png. Profile link goes to
              manhajuna.com, the dakwah portal he personally curates. */}
          <article className="grid gap-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:grid-cols-[auto_1fr] sm:items-start sm:gap-6 sm:p-8">
            <Image
              src="/team/uah.png"
              alt="Ust. Abdullah Haidir, Lc."
              width={64}
              height={64}
              className="h-16 w-16 shrink-0 rounded-2xl object-cover shadow-md ring-1 ring-slate-200"
            />
            <div>
              <a
                href="https://manhajuna.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex items-baseline gap-1.5 text-balance text-lg font-bold leading-snug text-slate-900 transition hover:text-brand-700 sm:text-xl"
              >
                Ust. Abdullah Haidir, Lc.
                <ExternalLink className="h-3.5 w-3.5 text-slate-400 transition group-hover:text-brand-600" />
              </a>
              <p className="mt-1 text-sm font-medium text-slate-600">
                {t("supervisor_haidir_role")}
              </p>
              <p className="mt-3 text-pretty text-sm leading-relaxed text-slate-600">
                {t("supervisor_haidir_body")}
              </p>
              <a
                href="https://manhajuna.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700 hover:text-brand-900"
              >
                {t("supervisor_haidir_profile_link")}
                <ArrowUpRight className="h-3 w-3" />
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
    <section className="py-12 sm:py-16">
      <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50/80 px-3 py-1 text-xs font-semibold text-amber-800">
          <Sparkles className="h-3.5 w-3.5" />
          {t("legacy_chip")}
        </span>
        <h2 className="mt-3 text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          {t("legacy_title")}
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-pretty text-[15px] leading-relaxed text-slate-700">
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
    <section className="relative overflow-hidden border-t border-slate-100 bg-gradient-to-b from-emerald-50/40 via-white to-white py-16 sm:py-20">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-1/3 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-emerald-100 opacity-40 blur-3xl" />
      </div>

      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs font-semibold text-emerald-700 shadow-sm">
            <BookOpenCheck className="h-3.5 w-3.5" />
            {t("daleel_chip")}
          </span>
          <h2 className="mt-3 text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            {t("daleel_title")}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-pretty text-sm leading-relaxed text-slate-600 sm:text-base">
            {t("daleel_subtitle")}
          </p>
        </div>

        <div className="mt-10 grid gap-5 sm:grid-cols-3">
          {items.map((d, i) => (
            <article
              key={i}
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${
                  d.kind === "quran"
                    ? "bg-brand-50 text-brand-700 ring-brand-100"
                    : "bg-emerald-50 text-emerald-700 ring-emerald-100"
                }`}
              >
                <Quote className="h-3 w-3" />
                {d.kind === "quran" ? t("kind_quran") : t("kind_hadith")}
              </span>
              <p
                lang="ar"
                dir="rtl"
                className="mt-3 font-amiri text-xl leading-[1.9] text-slate-900"
              >
                {d.arabic}
              </p>
              <p className="mt-3 text-pretty text-sm leading-relaxed text-slate-700">
                &ldquo;{d.translation}&rdquo;
              </p>
              <p className="mt-3 text-xs font-semibold text-slate-500">
                — {d.source}
              </p>
              <p className="mt-3 border-t border-slate-100 pt-3 text-pretty text-xs leading-relaxed text-slate-500">
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
    <section className="py-16 sm:py-24">
      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        <div className="relative isolate overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-600 via-emerald-700 to-brand-700 px-6 py-12 text-center text-white shadow-2xl sm:px-12">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10"
          >
            <div className="absolute -top-24 left-1/3 h-72 w-72 rounded-full bg-amber-300 opacity-25 blur-3xl" />
            <div className="absolute -bottom-24 right-0 h-72 w-72 rounded-full bg-emerald-300 opacity-30 blur-3xl" />
          </div>
          <h2 className="text-balance text-2xl font-bold tracking-tight sm:text-3xl">
            {t("cta_title")}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-pretty text-sm leading-relaxed text-white/85 sm:text-base">
            {t("cta_body")}
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <a
              href={donateHref}
              className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 text-sm font-semibold text-emerald-800 shadow-lg transition hover:bg-emerald-50"
            >
              {t("cta_donate")}
            </a>
            <Link
              href="/"
              className="inline-flex h-12 items-center gap-2 rounded-full border border-white/30 bg-white/5 px-6 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/10"
            >
              {t("cta_explore")}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
