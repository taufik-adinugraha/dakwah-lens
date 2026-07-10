import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  ArrowLeft,
  BookOpen,
  BookOpenText,
  HandHeart,
  Home as HomeIcon,
  MessageSquareText,
  Mic,
  Scroll,
  Smartphone,
  Users,
  Scale,
} from "lucide-react";

import { Link } from "@/i18n/navigation";
import { localeAwareFormat } from "@/lib/date-id";
import {
  DELIVERABLE_HEADING_PATTERNS,
  extractDeliverableSection,
  getBriefingBySlug,
} from "@/lib/briefing-data";
import { Article } from "../../../m/[id]/Article";
import { extractMahasiswaContent } from "@/lib/flyer/content";
import { ShareButton } from "./ShareButton";

/**
 * Shareable per-deliverable page.
 *
 * Each Section-4 deliverable from a briefing (khutbah / kajian / home
 * scripts / kreator script / Mahasiswa pack / aksi sosial) gets its
 * own public URL at `/d/{briefSlug}/{deliverable}`. The briefing
 * detail page surfaces a Share button on each card that copies this
 * URL — so a da'i can WA / IG-story a single deliverable without
 * sending the entire 7000-word briefing.
 *
 * No site chrome. Magazine-style typography, segment-accent palette
 * in the hero band (matches the Mahasiswa article page).
 */

type Props = {
  params: Promise<{ brief: string; deliverable: string; locale: string }>;
};

type DeliverableSlug = keyof typeof DELIVERABLE_HEADING_PATTERNS;

function isDeliverableSlug(s: string): s is DeliverableSlug {
  return s in DELIVERABLE_HEADING_PATTERNS;
}

const KIND_ICON: Record<DeliverableSlug, typeof BookOpen> = {
  khutbah: BookOpen,
  kultum: MessageSquareText,
  kajian: Users,
  kisah: Scroll,
  home: HomeIcon,
  content: Smartphone,
  genz: Mic,
  action: HandHeart,
  // Fiqh Pekan Ini articles. A missing key here is NOT a cosmetic gap:
  // <Icon/> with undefined hard-crashes hydration (React #130) and the
  // error boundary eats the whole page — exactly the 2026-07-07
  // "Kunjungi halaman doesn't load" incident.
  "artikel-1": Scale,
  "artikel-2": Scale,
  "artikel-3": Scale,
  "artikel-4": Scale,
  // Tafsir Pekan Ini articles — same hydration-crash guard as above.
  "tafsir-1": BookOpenText,
  "tafsir-2": BookOpenText,
  "tafsir-3": BookOpenText,
  "tafsir-4": BookOpenText,
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { brief, deliverable, locale } = await params;
  if (!isDeliverableSlug(deliverable)) return { title: "Dakwah-Lens" };
  const row = await getBriefingBySlug(brief);
  if (!row) return { title: "Dakwah-Lens" };
  const body = locale === "en" && row.summaryMdEn ? row.summaryMdEn : row.summaryMd;
  const section = extractDeliverableSection(body, deliverable);
  const title = section
    ? `${section.heading} — Dakwah-Lens`
    : "Dakwah-Lens";
  return {
    title,
    openGraph: { title, type: "article" },
  };
}

export default async function DeliverablePage({ params }: Props) {
  const { brief, deliverable, locale } = await params;
  if (!isDeliverableSlug(deliverable)) notFound();

  // The Mahasiswa pack has its own canonical URL `/m/{slug}` with the
  // public discussion section + "other rooms" rail. The /d/{brief}/genz
  // share URL used to render only the article — confusing because the
  // same article on /m/{slug} carries discussion chrome. Redirect
  // here so there's exactly one Mahasiswa page; previously-shared
  // /d/.../genz links still land the reader in the right place.
  if (deliverable === "genz") {
    redirect(`/m/${brief}`);
  }

  setRequestLocale(locale);
  const t = await getTranslations("Briefing");

  const row = await getBriefingBySlug(brief);
  if (!row) notFound();

  const body =
    locale === "en" && row.summaryMdEn ? row.summaryMdEn : row.summaryMd;
  const section = extractDeliverableSection(body, deliverable);
  if (!section) notFound();

  // Mahasiswa (genz) redirects to /m/{slug} above, so this is always
  // null in practice — the literal-keyed DeliverableSlug union
  // (2026-07-07) even flags the comparison as dead. Kept (with a
  // widening cast) so the Mahasiswa JSX branch below stays intact if
  // the redirect is ever removed.
  const mahasiswa =
    (deliverable as string) === "genz" ? extractMahasiswaContent(body) : null;

  // Palette keys are legacy 4-segment slugs (all/spiritual/family/youth/
  // justice); briefings now use 14-group labels ("Hukum & Keadilan",
  // "Aqidah & Ibadah", etc.) that don't match — fall back to `all` so
  // the page never crashes on a missing palette. Per-group color is
  // planned but lives on the /briefings hub for now, not this share
  // surface.
  const palette = palettes[row.themeGroup ?? "all"] ?? palettes.all;
  const Icon = KIND_ICON[deliverable];
  const dateLabel = localeAwareFormat(row.generatedAt, locale, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Jakarta",
  });
  // Group labels (e.g. "Hukum & Keadilan") are already human-readable
  // Indonesian; use verbatim instead of routing through legacy
  // segment_${slug}_title i18n keys that no longer exist for the
  // 14-group scheme.
  const segmentLabel = row.themeGroup ?? t("brief_scope_all");

  const heroTitle = mahasiswa?.question || section.heading;

  return (
    <main className="min-h-screen bg-paper-deep">
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
            className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.15em] text-white/80 transition hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            dakwah-lens.id
          </Link>

          <div className="mt-7 flex flex-wrap items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em]"
              style={{ color: palette.accentDeep }}
            >
              <Icon className="h-3 w-3" />
              {DELIVERABLE_HEADING_PATTERNS[deliverable].title}
            </span>
            <span className="rounded-full border border-white/40 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white/90">
              {segmentLabel}
            </span>
            <span className="text-xs font-semibold uppercase tracking-[0.15em] text-white/70">
              {dateLabel}
            </span>
          </div>

          <h1
            className="mt-7 text-balance text-3xl font-black leading-[1.08] tracking-tight text-white drop-shadow-md sm:text-5xl"
            style={{ letterSpacing: "-0.02em" }}
          >
            {heroTitle}
          </h1>

          <div className="mt-6">
            <ShareButton
              title={heroTitle}
              pdfUrl={`/api/d/${brief}/${deliverable}/pdf?lang=${locale}`}
            />
          </div>
        </div>
      </section>

      {/* Article body. For Mahasiswa (genz slug) we reuse the dedicated
          Article component to render article + Q&A. For everything
          else we render the markdown section directly. */}
      {mahasiswa && mahasiswa.article ? (
        <Article
          article={mahasiswa.article}
          qa={mahasiswa.qa}
          palette={palette}
          qaLabel={locale === "en" ? "Honest Pushback" : "Pertanyaan"}
        />
      ) : (
        <DeliverableBody markdown={section.body} palette={palette} />
      )}

      <footer className="border-t border-hairline bg-white">
        <div className="mx-auto max-w-3xl px-5 py-10 text-center sm:px-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-faint">
            Dakwah-Lens — Briefing Mingguan untuk Dakwah Indonesia
          </p>
          <p className="mt-3 text-pretty text-xs leading-relaxed text-ink-faint">
            Konten ini AI-assisted, BUKAN fatwa otoritatif. Tanggung
            jawab keagamaan tetap pada penyusun konten dakwah.
          </p>
          <Link
            href="/briefings"
            className="mt-6 inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold transition"
            style={{ background: palette.accentDeep, color: "#ffffff" }}
          >
            Lihat Briefing Mingguan
          </Link>
        </div>
      </footer>
    </main>
  );
}

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
    accentDeep: "#134e4a",
    soft: "#5eead4",
    quoteBg: "#f0fdfa",
    quoteBorder: "#5eead4",
  },
};

// Render plain markdown body inside the same paper-card surface the
// Mahasiswa article uses, so all deliverables read consistently.
function DeliverableBody({
  markdown,
  palette,
}: {
  markdown: string;
  palette: (typeof palettes)["all"];
}) {
  // Reuse Article with zero Q&A pairs — it does what we want: the
  // article surface + lead-paragraph styling + accented blockquotes.
  return (
    <Article article={markdown} qa={[]} palette={palette} qaLabel="" />
  );
}
