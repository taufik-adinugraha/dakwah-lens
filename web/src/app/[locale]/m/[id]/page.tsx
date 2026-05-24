import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft, MessageSquareQuote, Sparkles } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { getBriefingBySlug } from "@/lib/insights-data";
import { localeAwareFormat } from "@/lib/date-id";
import { extractMahasiswaContent } from "@/lib/flyer/content";
import { ShareButton } from "../../d/[brief]/[deliverable]/ShareButton";
import { Article } from "./Article";
import { DiscussionSection } from "./DiscussionSection";
import { OtherRoomsSection } from "./OtherRoomsSection";

/**
 * Mahasiswa article page — the destination behind the poster's QR
 * code. The poster grabs attention on the bulletin board with the
 * Poster Question; this page carries the article + Q&A that the
 * poster intentionally can't fit (too long for print).
 *
 * Public + standalone. No site chrome — purpose-built so a fresh
 * scanner lands directly on the content. Magazine-style typography,
 * segment-accent palette in the hero band.
 *
 * URL shape `/m/{slug}` — short by design so the printed bare
 * `dakwah-lens.id/m/{slug}` URL stays easy to type by hand.
 */

type Props = {
  params: Promise<{ id: string; locale: string }>;
};

// Opt out of route-level caching. The page mints a per-visit HMAC
// submission token in the discussion section + lists the latest
// approved comments — both need a fresh server render every time.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id, locale } = await params;
  const brief = await getBriefingBySlug(id);
  if (!brief) return { title: "Dakwah-Lens" };
  const body = locale === "en" && brief.summaryMdEn ? brief.summaryMdEn : brief.summaryMd;
  const m = extractMahasiswaContent(body);
  const title = m.question
    ? `${m.question} — Dakwah-Lens`
    : "Dakwah-Lens";
  return {
    title,
    description: m.question || undefined,
    openGraph: {
      title,
      description: m.question || undefined,
      type: "article",
    },
  };
}

export default async function MahasiswaArticlePage({ params }: Props) {
  const { id, locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Insights");

  const brief = await getBriefingBySlug(id);
  if (!brief) notFound();

  const body =
    locale === "en" && brief.summaryMdEn ? brief.summaryMdEn : brief.summaryMd;
  const m = extractMahasiswaContent(body);
  if (!m.question && !m.article) notFound();

  // Segment-driven palette — each briefing's article inherits the
  // visual identity its poster already carried, so a scanner sees
  // continuity between the printed sheet and the screen.
  const palette = palettes[brief.segment ?? "all"];
  const dateLabel = localeAwareFormat(brief.generatedAt, locale, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Jakarta",
  });
  const segmentLabel = brief.segment
    ? t(`segment_${brief.segment}_title` as Parameters<typeof t>[0])
    : t("brief_scope_all");

  return (
    <main className="min-h-screen bg-slate-50">
      {/* HERO BAND — Poster Question is the visual focal point. The
          colored gradient identifies the briefing's segment without
          needing the rest of the site chrome. */}
      <section
        className="relative overflow-hidden"
        style={{
          background: `linear-gradient(160deg, ${palette.bgLight} 0%, ${palette.bgMid} 60%, ${palette.bgDeep} 100%)`,
        }}
      >
        <div
          aria-hidden
          className="absolute -left-32 -top-32 h-[600px] w-[600px] rounded-full opacity-40"
          style={{ background: palette.soft }}
        />
        <div
          aria-hidden
          className="absolute -right-24 -bottom-32 h-[460px] w-[460px] rounded-full opacity-30"
          style={{ background: palette.accent }}
        />

        <div className="relative z-10 mx-auto max-w-3xl px-5 pt-10 pb-16 sm:px-8 sm:pt-12 sm:pb-20">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.15em] text-white/80 transition hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            dakwah-lens.id
          </Link>

          <div className="mt-7 flex flex-wrap items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em]"
              style={{ color: palette.accentDeep }}
            >
              <Sparkles className="h-3 w-3" />
              Mahasiswa Pack
            </span>
            <span
              className="rounded-full border border-white/40 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white/90"
            >
              {segmentLabel}
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-white/70">
              {dateLabel}
            </span>
          </div>

          <h1
            className="mt-7 text-balance text-3xl font-black leading-[1.08] tracking-tight text-white drop-shadow-md sm:text-5xl"
            style={{ letterSpacing: "-0.02em" }}
          >
            <span className="mr-2 opacity-60">“</span>
            {m.question}
          </h1>

          <p className="mt-6 max-w-xl text-pretty text-[13px] leading-relaxed text-white/85 sm:text-sm">
            Diskusi terbuka. Boleh kamu setujui, boleh kamu bantah — yang
            penting kamu pikir.
          </p>

          <div className="mt-6">
            <ShareButton
              title={m.question || "Dakwah-Lens"}
              pdfUrl={`/api/m/${id}/pdf?lang=${locale}`}
            />
          </div>
        </div>
      </section>

      {/* ARTICLE BODY — clean reading surface */}
      <Article
        article={m.article}
        qa={m.qa}
        palette={palette}
        qaLabel={
          locale === "en" ? "Honest Pushback" : "Pertanyaan Sulit"
        }
      />

      {/* DISCUSSION — public, moderated. Hidden in print. */}
      <DiscussionSection
        briefingSlug={id}
        locale={locale}
        palette={palette}
      />

      {/* OTHER ROOMS — cross-link to peer Mahasiswa packs. Hidden in print. */}
      <OtherRoomsSection currentSlug={id} locale={locale} />

      {/* FOOTER */}
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-3xl px-5 py-10 text-center sm:px-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Dakwah-Lens — Briefing Mingguan untuk Dakwah Indonesia
          </p>
          <p className="mt-3 text-pretty text-xs leading-relaxed text-slate-500">
            Konten ini AI-assisted, BUKAN fatwa otoritatif. Tanggung
            jawab keagamaan tetap pada penyusun konten dakwah.
          </p>
          <Link
            href="/insights"
            className="mt-6 inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold transition"
            style={{
              background: palette.accentDeep,
              color: "#ffffff",
            }}
          >
            <MessageSquareQuote className="h-3.5 w-3.5" />
            Lihat Briefing Mingguan
          </Link>
        </div>
      </footer>
    </main>
  );
}

// Segment → palette mapping. Keys mirror the briefing.segment column
// (null → "all"). Values mirror the poster palette families so a
// scanner sees visual continuity.
const palettes: Record<
  string,
  {
    bgLight: string;
    bgMid: string;
    bgDeep: string;
    accent: string;
    accentDeep: string;
    soft: string;
    quoteBg: string;
    quoteBorder: string;
  }
> = {
  all: {
    bgLight: "#c7d2fe",
    bgMid: "#6366f1",
    bgDeep: "#312e81",
    accent: "#4338ca",
    accentDeep: "#1e1b4b",
    soft: "#a5b4fc",
    quoteBg: "#eef2ff",
    quoteBorder: "#a5b4fc",
  },
  spiritual: {
    bgLight: "#a7f3d0",
    bgMid: "#10b981",
    bgDeep: "#064e3b",
    accent: "#047857",
    accentDeep: "#022c22",
    soft: "#6ee7b7",
    quoteBg: "#ecfdf5",
    quoteBorder: "#6ee7b7",
  },
  family: {
    bgLight: "#fecaca",
    bgMid: "#f87171",
    bgDeep: "#7f1d1d",
    accent: "#dc2626",
    accentDeep: "#450a0a",
    soft: "#fca5a5",
    quoteBg: "#fef2f2",
    quoteBorder: "#fca5a5",
  },
  youth: {
    bgLight: "#fde68a",
    bgMid: "#f59e0b",
    bgDeep: "#78350f",
    accent: "#b45309",
    accentDeep: "#451a03",
    soft: "#fcd34d",
    quoteBg: "#fffbeb",
    quoteBorder: "#fcd34d",
  },
  justice: {
    bgLight: "#99f6e4",
    bgMid: "#14b8a6",
    bgDeep: "#134e4a",
    accent: "#0f766e",
    accentDeep: "#042f2e",
    soft: "#5eead4",
    quoteBg: "#f0fdfa",
    quoteBorder: "#5eead4",
  },
};
