import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Clock,
  Fingerprint,
  Layers,
  Mail,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { Link } from "@/i18n/navigation";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/kitab">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Kitab" });
  return { title: t("page_title") };
}

export default async function KitabPage({
  params,
}: PageProps<"/[locale]/kitab">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("Kitab");

  return (
    <>
      <Hero t={t} />
      <Methodology t={t} />
      <Library t={t} />
      <Suggest t={t} />
    </>
  );
}

type T = Awaited<ReturnType<typeof getTranslations<"Kitab">>>;

function Hero({ t }: { t: T }) {
  return (
    <section className="relative isolate overflow-hidden pt-14 pb-12 sm:pt-20 sm:pb-16">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      >
        <div className="absolute inset-0 grid-bg opacity-60" />
        <div className="absolute -top-20 left-1/2 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-emerald-200 opacity-50 blur-3xl" />
      </div>

      <div className="mx-auto max-w-4xl px-4 text-center sm:px-6">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50/80 px-3 py-1 text-xs font-medium text-emerald-700 shadow-sm backdrop-blur">
          <ShieldCheck className="h-3.5 w-3.5" />
          {t("badge")}
        </span>
        <h1 className="mt-6 text-balance text-4xl font-bold leading-[1.1] tracking-tight text-slate-900 sm:text-5xl">
          {t("title")}
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-pretty text-base leading-relaxed text-slate-600 sm:text-lg">
          {t("body")}
        </p>

        <div className="mx-auto mt-8 inline-flex max-w-2xl items-start gap-2.5 rounded-2xl border border-emerald-100 bg-emerald-50/60 px-4 py-3 text-left text-sm leading-relaxed text-emerald-900">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <span className="text-pretty">{t("trust_note")}</span>
        </div>
      </div>
    </section>
  );
}

function Methodology({ t }: { t: T }) {
  const steps = [
    {
      icon: Layers,
      title: t("method_1_title"),
      body: t("method_1_body"),
      tone: "from-brand-500 to-cyan-500",
    },
    {
      icon: Sparkles,
      title: t("method_2_title"),
      body: t("method_2_body"),
      tone: "from-cyan-500 to-emerald-500",
    },
    {
      icon: Fingerprint,
      title: t("method_3_title"),
      body: t("method_3_body"),
      tone: "from-emerald-500 to-emerald-600",
    },
    {
      icon: BookOpen,
      title: t("method_4_title"),
      body: t("method_4_body"),
      tone: "from-emerald-600 to-teal-600",
    },
  ];

  return (
    <section className="py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            {t("methodology_title")}
          </h2>
        </div>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map(({ icon: Icon, title, body, tone }) => (
            <div
              key={title}
              className="relative rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <div
                className={`mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${tone} text-white shadow-sm`}
              >
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="text-balance text-base font-semibold text-slate-900">
                {title}
              </h3>
              <p className="mt-2 text-pretty text-sm leading-relaxed text-slate-600">
                {body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Library({ t }: { t: T }) {
  const kitabs = [
    {
      title: t("kitab_quran_title"),
      meta: t("kitab_quran_meta"),
      translations: t("kitab_quran_translations"),
      status: "planned" as const,
      tone: "from-emerald-50 to-emerald-100/40",
      iconTone: "bg-emerald-600",
    },
    {
      title: t("kitab_bukhari_title"),
      meta: t("kitab_bukhari_meta"),
      translations: t("kitab_bukhari_translations"),
      status: "planned" as const,
      tone: "from-brand-50 to-brand-100/40",
      iconTone: "bg-brand-600",
    },
    {
      title: t("kitab_muslim_title"),
      meta: t("kitab_muslim_meta"),
      translations: t("kitab_muslim_translations"),
      status: "planned" as const,
      tone: "from-cyan-50 to-cyan-100/40",
      iconTone: "bg-cyan-600",
    },
    {
      title: t("kitab_riyad_title"),
      meta: t("kitab_riyad_meta"),
      translations: t("kitab_riyad_translations"),
      status: "planned" as const,
      tone: "from-amber-50 to-amber-100/40",
      iconTone: "bg-amber-600",
    },
    {
      title: t("kitab_tafsir_title"),
      meta: t("kitab_tafsir_meta"),
      translations: t("kitab_tafsir_translations"),
      status: "planned" as const,
      tone: "from-violet-50 to-violet-100/40",
      iconTone: "bg-violet-600",
    },
    {
      title: t("kitab_bulugh_title"),
      meta: t("kitab_bulugh_meta"),
      translations: t("kitab_bulugh_translations"),
      status: "planned" as const,
      tone: "from-cyan-50 to-cyan-100/40",
      iconTone: "bg-cyan-600",
    },
  ];

  const statusLabel: Record<"planned" | "in_progress" | "ready", string> = {
    planned: t("status_planned"),
    in_progress: t("status_in_progress"),
    ready: t("status_ready"),
  };

  return (
    <section className="bg-gradient-to-b from-white to-slate-50 py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            {t("library_title")}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-pretty text-base leading-relaxed text-slate-600">
            {t("library_subtitle")}
          </p>
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {kitabs.map((k) => (
            <article
              key={k.title}
              className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md sm:p-6"
            >
              <div className="flex items-start gap-4">
                <div
                  className={`relative inline-flex h-14 w-12 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${k.tone} shadow-inner ring-1 ring-white/40`}
                >
                  <BookOpen className={`h-5 w-5 text-white`} />
                  <span
                    className={`absolute inset-0 -z-10 rounded-lg ${k.iconTone} opacity-95`}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-balance text-base font-semibold text-slate-900 sm:text-lg">
                      {k.title}
                    </h3>
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700 ring-1 ring-amber-100">
                      <Clock className="h-3 w-3" />
                      {statusLabel[k.status]}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{k.meta}</p>
                  <p className="mt-3 text-pretty text-sm leading-relaxed text-slate-600">
                    {k.translations}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function Suggest({ t }: { t: T }) {
  return (
    <section className="py-20 sm:py-24">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <div className="relative isolate overflow-hidden rounded-3xl border border-slate-200 bg-white px-6 py-12 text-center shadow-sm sm:px-12">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10"
          >
            <div className="absolute -top-12 left-1/2 h-56 w-56 -translate-x-1/2 rounded-full bg-emerald-100 opacity-50 blur-3xl" />
          </div>

          <Mail className="mx-auto h-6 w-6 text-emerald-600" />
          <h2 className="mt-4 text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            {t("suggest_title")}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-pretty text-sm leading-relaxed text-slate-600 sm:text-base">
            {t("suggest_body")}
          </p>

          <Link
            href="/contact"
            className="mt-6 inline-flex h-11 items-center gap-2 rounded-full bg-slate-900 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
          >
            {t("suggest_button")}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
