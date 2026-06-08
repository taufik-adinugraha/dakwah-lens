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
import { TafsirResult } from "./TafsirResult";
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
  "bidayat",
  "umm",
  "bn",
  "nashaih",
  "fs",
  "fmuin",
  "fqarib",
  "adab",
  "aqidah",
];

// Default selection when the user hasn't picked anything yet. Tafsir is
// excluded so first-time visitors get verse + hadith hits surfaced first
// — tafsir matches embed against long commentary text and tend to push
// the canonical Quran/hadith hits down the list. Users who want tafsir
// can tick the chip explicitly. Briefing-time retrieval (Python
// kitab_retrieval) is unaffected and still iterates every corpus.
const DEFAULT_CORPORA: KitabCorpus[] = ALL_CORPORA.filter(
  (c) => c !== "tafsir",
);

const RESULTS_LIMIT = 20;

// Display metadata for each kitab. The label key joins the existing
// Kitab namespace strings (kitab_quran_title etc.).
//
// `languages` reflects what's actually embedded in Qdrant per the embed
// scripts (api/src/api/scripts/embed_*.py). Quran has all three from the
// AGENTS.md corpus pick (AR + Kemenag ID + Sahih International EN);
// Sahih Muslim was manually translated to Bahasa 2026-05 (AR + ID + EN);
// the remaining hadith corpora (Bukhari, Riyad, Bulugh) still ship AR +
// EN only — their Indonesian translations aren't curated yet. Tafsir
// Ibn Kathir is AR + EN (Mubarakpuri abridged).
const KITAB_META: Record<
  KitabCorpus,
  {
    labelKey: string;
    metaKey: string;
    tone: string;
    iconTone: string;
    languages: ("AR" | "ID" | "EN")[];
  }
> = {
  quran: {
    labelKey: "kitab_quran_title",
    metaKey: "kitab_quran_meta",
    tone: "from-emerald-50 to-emerald-100/40",
    iconTone: "bg-emerald-600",
    languages: ["AR", "ID", "EN"],
  },
  bukhari: {
    labelKey: "kitab_bukhari_title",
    metaKey: "kitab_bukhari_meta",
    tone: "from-brand-50 to-brand-100/40",
    iconTone: "bg-brand-600",
    languages: ["AR", "EN"],
  },
  muslim: {
    labelKey: "kitab_muslim_title",
    metaKey: "kitab_muslim_meta",
    tone: "from-cyan-50 to-cyan-100/40",
    iconTone: "bg-cyan-600",
    languages: ["AR", "ID", "EN"],
  },
  riyad: {
    labelKey: "kitab_riyad_title",
    metaKey: "kitab_riyad_meta",
    tone: "from-amber-50 to-amber-100/40",
    iconTone: "bg-amber-600",
    languages: ["AR", "EN"],
  },
  bulugh: {
    labelKey: "kitab_bulugh_title",
    metaKey: "kitab_bulugh_meta",
    tone: "from-cyan-50 to-cyan-100/40",
    iconTone: "bg-cyan-600",
    languages: ["AR", "EN"],
  },
  tafsir: {
    labelKey: "kitab_tafsir_title",
    metaKey: "kitab_tafsir_meta",
    tone: "from-violet-50 to-violet-100/40",
    iconTone: "bg-violet-600",
    languages: ["AR", "EN"],
  },
  // Bidayatul Hidayah added 2026-06-08. AR-only for now; translation
  // pass is planned but deferred. Languages chip shows only AR until
  // that lands so the UI doesn't claim a translation that isn't there.
  bidayat: {
    labelKey: "kitab_bidayat_title",
    metaKey: "kitab_bidayat_meta",
    tone: "from-fuchsia-50 to-fuchsia-100/40",
    iconTone: "bg-fuchsia-600",
    languages: ["AR"],
  },
  // Al-Umm (Imam Shafi'i) added 2026-06-08, same AR-only posture.
  umm: {
    labelKey: "kitab_umm_title",
    metaKey: "kitab_umm_meta",
    tone: "from-indigo-50 to-indigo-100/40",
    iconTone: "bg-indigo-600",
    languages: ["AR"],
  },
  // Al-Bidayah wan-Nihayah (Ibn Kathir) — historical narrative,
  // prophets → Sirah → caliphates. AR-only, same posture.
  bn: {
    labelKey: "kitab_bn_title",
    metaKey: "kitab_bn_meta",
    tone: "from-rose-50 to-rose-100/40",
    iconTone: "bg-rose-600",
    languages: ["AR"],
  },
  // Nashaihul Ibad (Sheikh Nawawi al-Bantani's sharh of Ibn Hajar's
  // Munabbihat) — akhlak + tasawuf advice, canonical in Indonesian
  // pesantren tradition. AR-only, same posture.
  nashaih: {
    labelKey: "kitab_nashaih_title",
    metaKey: "kitab_nashaih_meta",
    tone: "from-teal-50 to-teal-100/40",
    iconTone: "bg-teal-600",
    languages: ["AR"],
  },
  // Fiqh as-Sunnah (Sayyid Sabiq) — modern topical fiqh organised by
  // ruling rather than madhhab, widely studied in Indonesia.
  fs: {
    labelKey: "kitab_fs_title",
    metaKey: "kitab_fs_meta",
    tone: "from-orange-50 to-orange-100/40",
    iconTone: "bg-orange-600",
    languages: ["AR"],
  },
  // Fath al-Mu'in (Zainuddin al-Malibari) — Shafi'i fiqh matn, the
  // standard NU/traditional pesantren curriculum across Indonesia.
  fmuin: {
    labelKey: "kitab_fmuin_title",
    metaKey: "kitab_fmuin_meta",
    tone: "from-lime-50 to-lime-100/40",
    iconTone: "bg-lime-600",
    languages: ["AR"],
  },
  // Fath al-Qarib al-Mujib (Ibn Qasim al-Ghazzi) — sharh of Abu Shuja's
  // Ghayat al-Ikhtisar. Entry-level Shafi'i fiqh in pesantren curriculum,
  // 212 fasal across 17 fiqh kitabs.
  fqarib: {
    labelKey: "kitab_fqarib_title",
    metaKey: "kitab_fqarib_meta",
    tone: "from-yellow-50 to-yellow-100/40",
    iconTone: "bg-yellow-600",
    languages: ["AR"],
  },
  // Tadhkirat al-Sami' wa al-Mutakallim fi Adab al-'Alim wa al-Muta'allim
  // (Ibn Jama'ah) — the foundational source for KH Hasyim Asy'ari's 1923
  // pesantren adab curriculum.
  adab: {
    labelKey: "kitab_adab_title",
    metaKey: "kitab_adab_meta",
    tone: "from-pink-50 to-pink-100/40",
    iconTone: "bg-pink-600",
    languages: ["AR"],
  },
  // 'Aqidat al-'Awam (Ahmad al-Marzuqi) — entry-level Ash'ari aqidah
  // poem taught from kindergarten through ibtidaiyyah in Indonesian
  // pesantren. Foundation for Nawawi al-Bantani's Nur al-Zalam sharh.
  aqidah: {
    labelKey: "kitab_aqidah_title",
    metaKey: "kitab_aqidah_meta",
    tone: "from-sky-50 to-sky-100/40",
    iconTone: "bg-sky-600",
    languages: ["AR"],
  },
};

// Tailwind classes per language code — emerald/amber/violet for AR/ID/EN
// so the same chip reads consistently across corpora.
const LANGUAGE_PILL_TONE: Record<"AR" | "ID" | "EN", string> = {
  AR: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  ID: "bg-rose-50 text-rose-800 ring-rose-200",
  EN: "bg-sky-50 text-sky-800 ring-sky-200",
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
  if (!raw) return DEFAULT_CORPORA;
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
  return requested.length === 0 ? DEFAULT_CORPORA : requested;
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
      {/* Indonesian-only notice: most corpora ship AR + EN, and ad-hoc
          search results aren't auto-translated to Bahasa to save the
          per-result LLM cost. English readers don't need this caveat,
          so it's gated to the `id` locale. */}
      {locale === "id" && (
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <p className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-xs leading-relaxed text-amber-900">
            {t("id_translation_notice")}
          </p>
        </div>
      )}
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
            <span className="ml-auto text-xs text-slate-400">
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
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
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

                {h.arabic && h.corpus !== "tafsir" && (
                  <p
                    className="mt-3 text-right font-amiri text-lg leading-relaxed text-slate-900 sm:text-xl md:text-2xl"
                    dir="rtl"
                    lang="ar"
                  >
                    {h.arabic}
                  </p>
                )}
                {h.corpus === "tafsir" ? (
                  <TafsirResult
                    chunk={h.translation}
                    fullCommentaryEn={h.fullCommentaryEn}
                    fullCommentaryAr={h.fullCommentaryAr}
                    chunkIndex={h.chunkIndex}
                    totalChunks={h.totalChunks}
                  />
                ) : (
                  h.translation && (
                    <p className="mt-2 text-sm leading-relaxed text-slate-700">
                      {h.translation}
                    </p>
                  )
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
                    {/* Language pills — which translations are actually
                        embedded for this corpus. Quran and Sahih Muslim
                        have all three (AR + ID + EN); the other hadith
                        corpora and tafsir are AR + EN only. */}
                    <div className="mt-2 flex flex-wrap gap-1">
                      {m.languages.map((lang) => (
                        <span
                          key={lang}
                          className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ring-1 ${LANGUAGE_PILL_TONE[lang]}`}
                        >
                          {lang}
                        </span>
                      ))}
                    </div>
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
