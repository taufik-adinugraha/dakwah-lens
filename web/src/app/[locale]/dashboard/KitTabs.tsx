"use client";

import { useState } from "react";
import {
  BookOpenCheck,
  Compass,
  Layers,
  Sparkles,
  Users,
} from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";

import { BriefDeliverableCards } from "@/components/BriefDeliverableCards";
import { BriefFlyerSection } from "@/components/BriefFlyerSection";
import { MahasiswaPosterCard } from "@/components/MahasiswaPosterCard";

import type { KitSegmentData, SegmentKey } from "@/lib/dashboard-metrics";

/**
 * Two-level tab switcher for the Dakwah Kit tab.
 *
 * Top row — segment tabs (5): Overall View / Spiritual / Family /
 * Youth / Justice. Default = "all" (Overall View). Switches drive the
 * inner content; URL is not touched (no router.push) so a user can
 * compare segments without losing their place.
 *
 * Below — section tabs (5): Ringkasan / Numerik / Tema / Strategi /
 * Dalil. Default = "strategi" since that's where the ready-to-use
 * kits live (most users open the dashboard to grab content, not to
 * read narrative summaries).
 *
 * The Strategi section gets a custom render: the parsed kit-card grid
 * + collapsed Poster & Flyer details. The other 4 sections render the
 * raw H2 slice through ReactMarkdown.
 */

type SectionKey = "ringkasan" | "numerik" | "tema" | "strategi" | "dalil";

type Labels = {
  segments: Record<SegmentKey, string>;
  sections: Record<SectionKey, string>;
  empty: string;
  /** Labels for the briefings-style deliverable cards we reuse here.
   *  Shape matches what `<BriefDeliverableCards>` needs — passed straight
   *  through from the Insights i18n namespace on the server. */
  deliverable: {
    open: string;
    copy: string;
    copied: string;
    download: string;
    print: string;
    flyer: string;
    visit: string;
    close: string;
  };
  /** Labels for `<MahasiswaPosterCard>`. */
  poster: {
    eyebrow: string;
    title: string;
    body: string;
    openLarge: string;
    download: string;
    downloadPdf: string;
    print: string;
    loading: string;
    close: string;
    show: string;
    hide: string;
  };
};

const SEGMENT_ORDER: SegmentKey[] = [
  "all",
  "spiritual",
  "family",
  "youth",
  "justice",
];

const SEGMENT_ICON: Record<SegmentKey, typeof Layers> = {
  all: Layers,
  spiritual: BookOpenCheck,
  family: Users,
  youth: Sparkles,
  justice: Compass,
};

const SECTION_ORDER: SectionKey[] = [
  "ringkasan",
  "numerik",
  "tema",
  "strategi",
  "dalil",
];

export function KitTabs({
  segments,
  labels,
  locale,
}: {
  segments: KitSegmentData[];
  labels: Labels;
  /** Locale string (`"id"` | `"en"`) — used to build the `briefBasePath`
   *  the modal-routing code inside <BriefDeliverableCards> needs, and
   *  passed to <MahasiswaPosterCard> for its lang-aware PDF endpoint. */
  locale: string;
}) {
  const [activeSegment, setActiveSegment] = useState<SegmentKey>("all");
  const [activeSection, setActiveSection] = useState<SectionKey>("strategi");

  // If the requested segment doesn't have data yet (e.g. only mainstream
  // briefings landed), gracefully fall back to the first available one
  // for rendering. The tab button itself stays clickable so users can
  // see which segments exist.
  const seg =
    segments.find((s) => s.segment === activeSegment) ?? segments[0] ?? null;

  if (!seg) {
    return (
      <section className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-8 text-center text-sm text-slate-500">
        {labels.empty}
      </section>
    );
  }

  const availableSegments = new Set(segments.map((s) => s.segment));

  return (
    <section>
      {/* Segment tabs — horizontal scroll on narrow screens so all 5
          stay reachable without wrapping awkwardly. */}
      <div
        role="tablist"
        aria-label="Segment"
        className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1"
      >
        {SEGMENT_ORDER.map((segKey) => {
          const Icon = SEGMENT_ICON[segKey];
          const available = availableSegments.has(segKey);
          const active = segKey === activeSegment;
          return (
            <button
              key={segKey}
              role="tab"
              aria-selected={active}
              onClick={() => setActiveSegment(segKey)}
              disabled={!available}
              className={
                "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition " +
                (active
                  ? "border-emerald-700 bg-emerald-700 text-white shadow-sm"
                  : available
                    ? "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                    : "border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed")
              }
            >
              <Icon className="h-3.5 w-3.5" />
              {labels.segments[segKey]}
            </button>
          );
        })}
      </div>

      {/* Section tabs — H2 slices of the chosen briefing. Bottom-border
          active-state matches the visual vocab of typical app tabs;
          fits inside the segment-pill row visually so the hierarchy
          is clear (segment outer, section inner). */}
      <div
        role="tablist"
        aria-label="Section"
        className="mt-4 flex gap-1 overflow-x-auto border-b border-slate-200"
      >
        {SECTION_ORDER.map((secKey) => {
          const active = secKey === activeSection;
          return (
            <button
              key={secKey}
              role="tab"
              aria-selected={active}
              onClick={() => setActiveSection(secKey)}
              className={
                "shrink-0 -mb-px border-b-2 px-3 py-2 text-xs font-medium transition " +
                (active
                  ? "border-emerald-700 text-emerald-700"
                  : "border-transparent text-slate-500 hover:text-slate-900")
              }
            >
              {labels.sections[secKey]}
            </button>
          );
        })}
      </div>

      {/* Content area */}
      <div className="mt-5">
        {activeSection === "strategi" ? (
          <StrategiPane
            briefSlug={seg.briefSlug}
            strategiMarkdown={seg.sections.strategi}
            labels={labels}
            locale={locale}
          />
        ) : (
          <ProseSection markdown={seg.sections[activeSection]} />
        )}
      </div>
    </section>
  );
}

/**
 * Strategi rendering — REUSES the exact same components the
 * `/insights/brief/[id]` page renders:
 *   - `<BriefDeliverableCards>` for the 6 kit cards (Khutbah / Kajian /
 *     Home / Content / Genz / Action) with the "Baca selengkapnya"
 *     modal flow, PDF download, and Bagikan share buttons.
 *   - `<MahasiswaPosterCard>` for the Mahasiswa campus poster image
 *     (1080×1080 PNG with download + zoom).
 *   - `<BriefFlyerSection>` for the 6 share-ready flyer PNGs.
 *
 * Why we duplicate-render (vs link out to /insights/brief/{slug}):
 * the dashboard is the "operator console" — users come here to
 * BROWSE all 5 segments quickly and grab content. Forcing a full
 * page nav per segment would slow that workflow. Reusing the
 * components keeps the visual + interaction language identical to
 * the briefing detail page.
 *
 * Note on modal-close behavior: the BriefDeliverableCards modal
 * pushes `/insights/brief/{slug}/{kind}` on open and replaces with
 * `/insights/brief/{slug}` on close. After closing, the user lands
 * on the brief detail page (not the dashboard). That's intentional:
 * they've engaged with one specific kit; the detail page is where
 * they can now read the full briefing context for that deliverable.
 */
function StrategiPane({
  briefSlug,
  strategiMarkdown,
  labels,
  locale,
}: {
  briefSlug: string;
  /** Raw markdown of the briefing's `## Strategi & Aksi Dakwah` section
   *  — passed straight through to BriefDeliverableCards which parses
   *  the H3 sub-sections into individual cards. */
  strategiMarkdown: string;
  labels: Labels;
  locale: string;
}) {
  if (!strategiMarkdown.trim()) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-8 text-center text-sm text-slate-500">
        {labels.empty}
      </div>
    );
  }

  // `briefBasePath` is the URL prefix the modal-routing code uses to
  // push `/{path}/{kind}` on open and replace `/{path}` on close.
  // Locale-prefixed so the i18n proxy doesn't re-resolve it through
  // the `[locale]` segment.
  const briefBasePath = `/${locale}/insights/brief/${briefSlug}`;

  return (
    // Re-key on briefSlug so when the user switches segments, the
    // inner client state (openIndex modal state) resets cleanly
    // instead of leaking across briefings.
    <div key={briefSlug} className="space-y-4">
      <BriefDeliverableCards
        section4Markdown={strategiMarkdown}
        labels={labels.deliverable}
        briefBasePath={briefBasePath}
        routeOnOpen={false}
      />
      <MahasiswaPosterCard
        briefId={briefSlug}
        locale={locale === "en" ? "en" : "id"}
        labels={labels.poster}
      />
      <BriefFlyerSection briefId={briefSlug} />
    </div>
  );
}

/**
 * Render a raw H2-section markdown slice as readable prose. Used for
 * Ringkasan / Numerik / Tema / Dalil — the analytical narrative parts
 * of the briefing. Strategi has its own bespoke render above.
 *
 * Component overrides keep paragraph spacing tight + emerald accent on
 * inline bold (`**citation**` markers in Dalil section) so the
 * generated daleel pop visually.
 */
function ProseSection({ markdown }: { markdown: string }) {
  if (!markdown.trim()) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-8 text-center text-sm text-slate-500">
        —
      </div>
    );
  }
  const components: Components = {
    p: ({ children }) => (
      <p className="my-3 break-words text-sm leading-relaxed text-slate-700">
        {children}
      </p>
    ),
    // The Numerik section often emits a multi-column stats table. A bare
    // <table> sizes to its content and blows out the page width on
    // mobile — wrap it in a horizontal-scroll container so it scrolls
    // inside the card instead of stretching the whole layout.
    table: ({ children }) => (
      <div className="my-3 -mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[28rem] border-collapse text-left text-xs">
          {children}
        </table>
      </div>
    ),
    th: ({ children }) => (
      <th className="border-b border-slate-200 px-2 py-1.5 font-semibold text-slate-700">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="border-b border-slate-100 px-2 py-1.5 text-slate-600">
        {children}
      </td>
    ),
    h3: ({ children }) => (
      <h3 className="mt-6 mb-2 text-base font-semibold text-slate-900">
        {children}
      </h3>
    ),
    h4: ({ children }) => (
      <h4 className="mt-4 mb-1.5 text-sm font-semibold text-slate-900">
        {children}
      </h4>
    ),
    ul: ({ children }) => (
      <ul className="my-3 list-disc space-y-1 pl-5 text-sm leading-relaxed text-slate-700 marker:text-slate-400">
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="my-3 list-decimal space-y-1 pl-5 text-sm leading-relaxed text-slate-700">
        {children}
      </ol>
    ),
    blockquote: ({ children }) => (
      <blockquote className="my-3 border-l-3 border-emerald-300 bg-emerald-50/40 px-4 py-2 text-sm italic text-slate-700">
        {children}
      </blockquote>
    ),
    strong: ({ children }) => (
      <strong className="font-semibold text-slate-900">{children}</strong>
    ),
    a: ({ href, children }) => (
      <a
        href={href}
        className="font-medium text-emerald-700 underline-offset-2 hover:underline"
      >
        {children}
      </a>
    ),
  };
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <ReactMarkdown components={components}>{markdown}</ReactMarkdown>
    </div>
  );
}

