"use client";

import { useState } from "react";
import {
  ArrowRight,
  BookOpenCheck,
  Compass,
  Flame,
  Layers,
  Mic2,
  Sparkles,
  Users,
} from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";

import type {
  KitDeliverable,
  KitSegmentData,
  FlyerMessage,
  SegmentKey,
} from "@/lib/dashboard-metrics";

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
  kit_card_cta: string;
  kit_card_words: string;
  poster_flyer_title: string;
  poster_flyer_subtitle_tpl: string;
  poster_pill: string;
  poster_cta: string;
  flyer_label_tpl: string;
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
}: {
  segments: KitSegmentData[];
  labels: Labels;
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
          <StrategiPane data={seg.strategi} labels={labels} />
        ) : (
          <ProseSection markdown={seg.sections[activeSection]} />
        )}
      </div>
    </section>
  );
}

/**
 * Strategi rendering: kit-card grid (one card per ready-to-use
 * deliverable) + collapsed Poster & Flyer details. Mirrors what the
 * old standalone OverallViewKitsCard rendered, now scoped to the
 * currently-active segment.
 */
function StrategiPane({
  data,
  labels,
}: {
  data: {
    kits: KitDeliverable[];
    posterQuestion: string | null;
    posterHref: string | null;
    flyers: FlyerMessage[];
  };
  labels: Labels;
}) {
  if (data.kits.length === 0 && data.flyers.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-8 text-center text-sm text-slate-500">
        {labels.empty}
      </div>
    );
  }

  const KIT_ICON: Record<string, typeof Mic2> = {
    khutbah: Mic2,
    kajian: Users,
    home: Sparkles,
    content: Flame,
    genz: BookOpenCheck,
    action: Compass,
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {data.kits.map((kit) => {
          const Icon = KIT_ICON[kit.slug] ?? Sparkles;
          return (
            <a
              key={kit.slug}
              href={kit.href}
              className="group flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-emerald-300 hover:shadow-md sm:p-5"
            >
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
                <Icon className="h-3.5 w-3.5" />
                {kit.title}
              </div>
              <p className="text-pretty text-sm leading-relaxed text-slate-700">
                {kit.excerpt}
              </p>
              <p className="mt-auto inline-flex items-center gap-1 pt-1 text-xs font-semibold text-emerald-700 transition group-hover:gap-2">
                {labels.kit_card_cta} · {kit.wordCount.toLocaleString()}{" "}
                {labels.kit_card_words}
                <ArrowRight className="h-3.5 w-3.5" />
              </p>
            </a>
          );
        })}
      </div>

      {(data.posterQuestion || data.flyers.length > 0) && (
        <details className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <summary className="flex cursor-pointer items-center justify-between gap-3 list-none">
            <div>
              <p className="text-sm font-semibold text-slate-900">
                {labels.poster_flyer_title}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                {labels.poster_flyer_subtitle_tpl.replace(
                  "{flyers}",
                  String(data.flyers.length),
                )}
              </p>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" />
          </summary>

          <div className="mt-4 space-y-4">
            {data.posterQuestion && data.posterHref && (
              <a
                href={data.posterHref}
                className="group block rounded-xl border border-amber-200 bg-amber-50/40 p-4 transition hover:border-amber-300"
              >
                <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-700">
                  {labels.poster_pill}
                </p>
                <p className="mt-1 text-pretty text-sm font-medium leading-snug text-slate-900">
                  &ldquo;{data.posterQuestion}&rdquo;
                </p>
                <p className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-amber-700 transition group-hover:gap-2">
                  {labels.poster_cta} <ArrowRight className="h-3 w-3" />
                </p>
              </a>
            )}

            {data.flyers.length > 0 && (
              <ul className="grid gap-2 sm:grid-cols-2">
                {data.flyers.map((flyer) => (
                  <li
                    key={flyer.n}
                    className="rounded-xl border border-slate-100 bg-slate-50/60 p-3"
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      {labels.flyer_label_tpl.replace("{n}", String(flyer.n))}
                    </p>
                    <p className="mt-1 text-pretty text-sm font-semibold leading-snug text-slate-900">
                      &ldquo;{flyer.headline}&rdquo;
                    </p>
                    {flyer.daleel && (
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {flyer.daleel}
                      </p>
                    )}
                    <p className="mt-2 text-[12px] leading-relaxed text-slate-600 line-clamp-3">
                      {flyer.body}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>
      )}
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
      <p className="my-3 text-sm leading-relaxed text-slate-700">{children}</p>
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

