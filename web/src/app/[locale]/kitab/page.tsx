import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { BookOpen, ShieldCheck, Sparkles } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { auth } from "@/auth";
import { BookmarkButton } from "@/components/BookmarkButton";
import { CitationShare } from "@/components/CitationShare";
import { getSavedFlags } from "@/app/[locale]/saved/actions";
import {
  getKitabCounts,
  searchKitabBrowse,
  type KitabCorpus,
  type KitabHit,
} from "@/lib/kitab-retrieval";
import { KitabPill } from "./KitabPill";
import { KitabSearchInput } from "@/components/KitabSearchInput";

type SearchParams = Record<string, string | string[] | undefined>;

const ALL_CORPORA: KitabCorpus[] = [
  "quran",
  "bukhari",
  "muslim",
  "riyad",
  "bulugh",
  "tafsir",
];

const RESULTS_LIMIT = 20;

// Display metadata for each kitab. The label key joins the existing
// Kitab namespace strings (kitab_quran_title etc.).
const KITAB_META: Record<
  KitabCorpus,
  { labelKey: string; metaKey: string; tone: string; iconTone: string }
> = {
  quran: {
    labelKey: "kitab_quran_title",
    metaKey: "kitab_quran_meta",
    tone: "from-emerald-50 to-emerald-100/40",
    iconTone: "bg-emerald-600",
  },
  bukhari: {
    labelKey: "kitab_bukhari_title",
    metaKey: "kitab_bukhari_meta",
    tone: "from-brand-50 to-brand-100/40",
    iconTone: "bg-brand-600",
  },
  muslim: {
    labelKey: "kitab_muslim_title",
    metaKey: "kitab_muslim_meta",
    tone: "from-cyan-50 to-cyan-100/40",
    iconTone: "bg-cyan-600",
  },
  riyad: {
    labelKey: "kitab_riyad_title",
    metaKey: "kitab_riyad_meta",
    tone: "from-amber-50 to-amber-100/40",
    iconTone: "bg-amber-600",
  },
  bulugh: {
    labelKey: "kitab_bulugh_title",
    metaKey: "kitab_bulugh_meta",
    tone: "from-cyan-50 to-cyan-100/40",
    iconTone: "bg-cyan-600",
  },
  tafsir: {
    labelKey: "kitab_tafsir_title",
    metaKey: "kitab_tafsir_meta",
    tone: "from-violet-50 to-violet-100/40",
    iconTone: "bg-violet-600",
  },
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Kitab" });
  return { title: t("page_title") };
}

function parseCorpusSelection(
  raw: string | string[] | undefined,
): KitabCorpus[] {
  if (!raw) return ALL_CORPORA;
  // Multi-checkbox forms submit as `?kitab=a&kitab=b&kitab=c`, which
  // Next.js surfaces as `string[]`. Single-value or comma-delimited
  // links still work for shareable URLs. Previously we only handled
  // `typeof string`, which meant any multi-select fell through to
  // ALL_CORPORA — making the filter look broken on the public page.
  const tokens = Array.isArray(raw)
    ? raw.flatMap((s) => s.split(","))
    : raw.split(",");
  const requested = tokens
    .map((s) => s.trim())
    .filter((s) => (ALL_CORPORA as string[]).includes(s)) as KitabCorpus[];
  return requested.length === 0 ? ALL_CORPORA : requested;
}

export default async function KitabPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  const search = await searchParams;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "Kitab" });

  const query =
    typeof search.q === "string" ? search.q.trim().slice(0, 200) : "";
  // `search.kitab` can be a string OR string[] (multi-checkbox forms
  // produce arrays). `parseCorpusSelection` handles both shapes.
  const corporaSelection = parseCorpusSelection(search.kitab);

  // Always show kitab counts so visitors see what's actually embedded.
  const counts = await getKitabCounts();

  // Run search only if the user submitted a query. Empty query = browse-only.
  const hits: KitabHit[] = query
    ? await searchKitabBrowse(query, {
        corpora: corporaSelection,
        limit: RESULTS_LIMIT,
        locale: locale === "id" ? "id" : "en",
      })
    : [];

  // Check session + saved state for any visible hits in one round-trip.
  const session = await auth();
  const signedIn = !!session?.user?.id;
  const savedFlags = signedIn
    ? await getSavedFlags(
        "kitab",
        hits.map((h) => citationRefId(h.corpus, h.citation)),
      )
    : {};

  return (
    <>
      <Hero t={t} />
      <SearchForm
        t={t}
        query={query}
        corporaSelection={corporaSelection}
        counts={counts}
      />
      {query ? (
        <Results t={t} hits={hits} query={query} savedFlags={savedFlags} signedIn={signedIn} />
      ) : (
        <KitabGrid t={t} counts={counts} />
      )}
    </>
  );
}

type T = Awaited<ReturnType<typeof getTranslations<"Kitab">>>;

function Hero({ t }: { t: T }) {
  return (
    <section className="relative isolate overflow-hidden pt-14 pb-10 sm:pt-20 sm:pb-12">
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
        <h1 className="mt-6 text-balance text-3xl font-bold leading-[1.1] tracking-tight text-slate-900 sm:text-5xl">
          {t("title")}
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-pretty text-base leading-relaxed text-slate-600 sm:text-lg">
          {t("body")}
        </p>
      </div>
    </section>
  );
}

/* Server-rendered form: submits as GET, so the result page is shareable
 * and back-button friendly. Multi-select kitab via checkbox group. */
function SearchForm({
  t,
  query,
  corporaSelection,
  counts,
}: {
  t: T;
  query: string;
  corporaSelection: KitabCorpus[];
  counts: Record<KitabCorpus, number>;
}) {
  const selected = new Set<KitabCorpus>(corporaSelection);
  const allSelected = selected.size === ALL_CORPORA.length;

  return (
    <section className="pb-8">
      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        <form
          method="get"
          className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
        >
          <KitabSearchInput
            defaultValue={query}
            placeholder={t("search_placeholder")}
            submitLabel={t("search_button")}
            clearLabel={t("search_clear")}
          />

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold text-slate-500">
              {t("search_kitab_label")}
            </span>
            {ALL_CORPORA.map((c) => {
              const isOn =
                allSelected /* "all" defaults to all-on for unsubmitted forms */ ||
                selected.has(c);
              const count = counts[c] ?? 0;
              return (
                <KitabPill
                  key={c}
                  corpusKey={c}
                  label={t(KITAB_META[c].labelKey as Parameters<typeof t>[0])}
                  count={count}
                  initialChecked={isOn}
                />
              );
            })}
            <span className="ml-auto text-[11px] text-slate-400">
              {t("search_hint")}
            </span>
          </div>
        </form>
      </div>
    </section>
  );
}

// Stable reference id for a kitab hit: scopes to corpus + citation.
// Same citation could (in theory) appear in multiple corpora — Bukhari
// + Muslim share many hadith — so we want each save attributable to
// its source corpus.
function citationRefId(corpus: string, citation: string): string {
  return `${corpus}:${citation}`;
}

function Results({
  t,
  hits,
  query,
  savedFlags,
  signedIn,
}: {
  t: T;
  hits: KitabHit[];
  query: string;
  savedFlags: Record<string, boolean>;
  signedIn: boolean;
}) {
  return (
    <section className="pb-16 sm:pb-20">
      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        <p className="mb-4 text-sm text-slate-600">
          {t("results_count", { count: hits.length, query })}
        </p>

        {hits.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-10 text-center text-sm text-slate-500">
            {t("results_empty")}
          </div>
        ) : (
          <ul className="space-y-3">
            {hits.map((h, i) => (
              <li
                key={i}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 font-semibold uppercase tracking-wider text-slate-700">
                    {t(KITAB_META[h.corpus].labelKey as Parameters<typeof t>[0])}
                  </span>
                  <div className="flex items-center gap-3 text-slate-500">
                    <span className="font-mono">{h.citation}</span>
                    {h.score !== undefined && (
                      <span className="tabular-nums text-slate-400">
                        {(h.score * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>
                </div>

                {h.arabic && (
                  <p
                    className="mt-3 text-right font-amiri text-xl leading-relaxed text-slate-900"
                    dir="rtl"
                  >
                    {h.arabic}
                  </p>
                )}
                {h.translation && (
                  <p className="mt-2 text-sm leading-relaxed text-slate-700">
                    {h.translation}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <BookmarkButton
                    kind="kitab"
                    refId={citationRefId(h.corpus, h.citation)}
                    payload={{
                      corpus: h.corpus,
                      citation: h.citation,
                      arabic: h.arabic,
                      translation: h.translation,
                    }}
                    initialSaved={!!savedFlags[citationRefId(h.corpus, h.citation)]}
                    signedIn={signedIn}
                  />
                  <CitationShare
                    arabic={h.arabic}
                    translation={h.translation}
                    citation={h.citation}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function KitabGrid({
  t,
  counts,
}: {
  t: T;
  counts: Record<KitabCorpus, number>;
}) {
  return (
    <section className="bg-gradient-to-b from-white to-slate-50 py-12 sm:py-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            {t("library_title")}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-pretty text-sm leading-relaxed text-slate-600 sm:text-base">
            {t("library_subtitle")}
          </p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ALL_CORPORA.map((c) => {
            const m = KITAB_META[c];
            const count = counts[c] ?? 0;
            const isEmbedded = count > 0;
            return (
              <article
                key={c}
                className={`relative overflow-hidden rounded-2xl border bg-gradient-to-br ${m.tone} ${
                  isEmbedded ? "border-slate-200" : "border-slate-200/50 opacity-70"
                } p-5 shadow-sm`}
              >
                <div className="flex items-start gap-4">
                  <div
                    className={`relative inline-flex h-14 w-12 shrink-0 items-center justify-center rounded-lg shadow-inner ring-1 ring-white/40`}
                  >
                    <BookOpen className="relative z-10 h-5 w-5 text-white" />
                    <span
                      className={`absolute inset-0 -z-0 rounded-lg ${m.iconTone} opacity-95`}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-balance text-base font-semibold text-slate-900 sm:text-lg">
                      {t(m.labelKey as Parameters<typeof t>[0])}
                    </h3>
                    <p className="mt-1 text-xs text-slate-500">
                      {t(m.metaKey as Parameters<typeof t>[0])}
                    </p>
                    <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-700 ring-1 ring-slate-200">
                      <Sparkles className="h-3 w-3" />
                      {isEmbedded
                        ? t("kitab_count_embedded", { count })
                        : t("kitab_count_not_yet")}
                    </p>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        <p className="mx-auto mt-8 max-w-2xl text-center text-xs leading-relaxed text-slate-500">
          {t("library_search_hint")}{" "}
          <Link href="/kitab?q=" className="font-semibold text-emerald-700 underline">
            {t("library_search_cta")}
          </Link>
        </p>
      </div>
    </section>
  );
}
