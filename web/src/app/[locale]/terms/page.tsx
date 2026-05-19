import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  AlertTriangle,
  BookOpenCheck,
  CheckCircle2,
  HandHeart,
  HeartHandshake,
  Mail,
  Scale,
  ShieldAlert,
  Sprout,
  XCircle,
} from "lucide-react";

import { Link } from "@/i18n/navigation";
import { TERMS_UPDATED_AT } from "@/lib/terms-version";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/terms">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Terms" });
  return { title: t("page_title") };
}

export default async function TermsPage({
  params,
}: PageProps<"/[locale]/terms">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Terms");
  const lastUpdated = new Intl.DateTimeFormat(
    locale === "id" ? "id-ID" : "en-GB",
    { year: "numeric", month: "long", day: "numeric" },
  ).format(TERMS_UPDATED_AT);

  return (
    <>
      <Hero t={t} lastUpdated={lastUpdated} />
      <Preamble t={t} />
      <SectionList t={t} />
      <Closing t={t} />
    </>
  );
}

type T = Awaited<ReturnType<typeof getTranslations<"Terms">>>;

function Hero({ t, lastUpdated }: { t: T; lastUpdated: string }) {
  return (
    <section className="relative isolate overflow-hidden pt-12 pb-8 sm:pt-16 sm:pb-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      >
        <div className="absolute inset-0 grid-bg opacity-40" />
        <div className="absolute -top-24 left-1/2 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-emerald-200 opacity-40 blur-3xl" />
      </div>

      <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50/80 px-3 py-1 text-xs font-medium text-emerald-700 shadow-sm backdrop-blur">
          <Scale className="h-3.5 w-3.5" />
          {t("badge")}
        </span>
        <h1 className="mt-4 text-balance text-3xl font-bold leading-[1.1] tracking-tight text-slate-900 sm:text-5xl">
          {t("hero_title")}
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-pretty text-base leading-relaxed text-slate-600 sm:text-lg">
          {t("hero_subtitle")}
        </p>
        <p className="mt-4 text-[11px] uppercase tracking-wider text-slate-400">
          {t("hero_last_updated", { date: lastUpdated })}
        </p>
      </div>
    </section>
  );
}

function Preamble({ t }: { t: T }) {
  return (
    <section className="py-10 sm:py-14">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-6 sm:p-8">
          <div className="flex items-start gap-3">
            <HeartHandshake className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
            <div className="space-y-3 text-pretty text-[15px] leading-relaxed text-slate-700">
              <p className="font-semibold text-slate-900">
                {t("preamble_lede")}
              </p>
              <p>{t("preamble_p1")}</p>
              <p>{t("preamble_p2")}</p>
              <p>
                {t.rich("preamble_p3", {
                  about: (chunks) => (
                    <Link
                      href="/about"
                      className="font-semibold text-brand-700 underline-offset-2 hover:underline"
                    >
                      {chunks}
                    </Link>
                  ),
                })}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function SectionList({ t }: { t: T }) {
  const sections = [
    {
      icon: Sprout,
      tone: "emerald" as const,
      title: t("s1_title"),
      body: <p>{t("s1_body")}</p>,
    },
    {
      icon: CheckCircle2,
      tone: "emerald" as const,
      title: t("s2_title"),
      body: (
        <ul className="ml-4 list-disc space-y-1.5 marker:text-emerald-500">
          <li>{t("s2_item_1")}</li>
          <li>{t("s2_item_2")}</li>
          <li>{t("s2_item_3")}</li>
          <li>{t("s2_item_4")}</li>
        </ul>
      ),
    },
    {
      icon: XCircle,
      tone: "rose" as const,
      title: t("s3_title"),
      body: (
        <ul className="ml-4 list-disc space-y-1.5 marker:text-rose-500">
          <li>{t("s3_item_1")}</li>
          <li>{t("s3_item_2")}</li>
          <li>{t("s3_item_3")}</li>
          <li>{t("s3_item_4")}</li>
          <li>{t("s3_item_5")}</li>
        </ul>
      ),
    },
    {
      icon: BookOpenCheck,
      tone: "brand" as const,
      title: t("s4_title"),
      body: (
        <div className="space-y-3">
          <p>{t("s4_p1")}</p>
          <p>{t("s4_p2")}</p>
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 ring-1 ring-amber-100">
            {t("s4_callout")}
          </p>
        </div>
      ),
    },
    {
      icon: AlertTriangle,
      tone: "amber" as const,
      title: t("s5_title"),
      body: (
        <div className="space-y-3">
          <p>{t("s5_p1")}</p>
          <p>{t("s5_p2")}</p>
        </div>
      ),
    },
    {
      icon: ShieldAlert,
      tone: "slate" as const,
      title: t("s6_title"),
      body: (
        <div className="space-y-3">
          <p>{t("s6_p1")}</p>
          <p>
            {t.rich("s6_p2", {
              privacy: (chunks) => (
                <Link
                  href="/privacy"
                  className="font-semibold text-brand-700 underline-offset-2 hover:underline"
                >
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </div>
      ),
    },
    {
      icon: HandHeart,
      tone: "brand" as const,
      title: t("s7_title"),
      body: <p>{t("s7_body")}</p>,
    },
    {
      icon: Mail,
      tone: "emerald" as const,
      title: t("s8_title"),
      body: (
        <p>
          {t.rich("s8_body", {
            contact: (chunks) => (
              <Link
                href="/contact"
                className="font-semibold text-brand-700 underline-offset-2 hover:underline"
              >
                {chunks}
              </Link>
            ),
          })}
        </p>
      ),
    },
  ];

  return (
    <section className="py-6 sm:py-10">
      <div className="mx-auto max-w-3xl space-y-5 px-4 sm:px-6">
        {sections.map((s, i) => (
          <SectionCard key={i} index={i + 1} {...s} />
        ))}
      </div>
    </section>
  );
}

function SectionCard({
  index,
  icon: Icon,
  tone,
  title,
  body,
}: {
  index: number;
  icon: typeof Sprout;
  tone: "emerald" | "rose" | "brand" | "amber" | "slate";
  title: string;
  body: React.ReactNode;
}) {
  const palette = TONE_STYLES[tone];
  return (
    <article className="grid gap-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:grid-cols-[auto_1fr] sm:gap-7 sm:p-8">
      <div className="flex sm:flex-col sm:items-center sm:gap-2">
        <span
          className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${palette.bg}`}
        >
          <Icon className={`h-5 w-5 ${palette.icon}`} />
        </span>
        <span className="ml-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400 sm:ml-0">
          §{index}
        </span>
      </div>
      <div className="min-w-0">
        <h2 className="text-balance text-lg font-bold tracking-tight text-slate-900 sm:text-xl">
          {title}
        </h2>
        <div className="mt-3 space-y-3 text-pretty text-[15px] leading-relaxed text-slate-700">
          {body}
        </div>
      </div>
    </article>
  );
}

const TONE_STYLES = {
  emerald: { bg: "bg-emerald-50", icon: "text-emerald-700" },
  rose: { bg: "bg-rose-50", icon: "text-rose-700" },
  brand: { bg: "bg-brand-50", icon: "text-brand-700" },
  amber: { bg: "bg-amber-50", icon: "text-amber-700" },
  slate: { bg: "bg-slate-100", icon: "text-slate-700" },
} as const;

function Closing({ t }: { t: T }) {
  return (
    <section className="py-12 sm:py-16">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-emerald-50/30 p-8 text-center shadow-sm">
          <p className="font-amiri text-2xl text-slate-900">
            {t("closing_arabic")}
          </p>
          <p className="mt-2 text-sm italic text-slate-600">
            {t("closing_translation")}
          </p>
          <p className="mx-auto mt-6 max-w-xl text-pretty text-sm leading-relaxed text-slate-600">
            {t("closing_body")}
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <Link
              href="/about"
              className="inline-flex h-10 items-center gap-2 rounded-full bg-slate-900 px-5 text-xs font-semibold text-white hover:bg-slate-800"
            >
              {t("closing_cta_about")}
            </Link>
            <Link
              href="/"
              className="inline-flex h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              {t("closing_cta_home")}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
