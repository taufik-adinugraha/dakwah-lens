"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ChevronDown,
  ChevronUp,
  Download,
  Image as ImageIcon,
  Maximize2,
  Sparkles,
} from "lucide-react";

/* eslint-disable @next/next/no-img-element */

/**
 * "Flyer Dakwah" section — 6 shareable 1080×1080 PNGs per briefing.
 *
 * Each flyer is a different angle on the same week:
 *   - Variant A (umum)    → Khutbah tagline + actionable steps
 *   - Variant B (umum)    → Aksi Sosial campaign + small-action framing
 *   - Variant A (modern)  → Kreator HOOK slogan + body
 *   - Variant B (modern)  → Gen Z framing punchline + reflection
 *   - Variant A (sunnah)  → Ajakan ibadah sunnah pekan ini + short du'a
 *   - Variant B (sunnah)  → Doa pekan ini (Arabic hero + ID translation)
 *
 * Each uses a different daleel from the retrieval pool so the six
 * don't repeat. No segment / "for Gen Z" labels — the design itself
 * carries the tone.
 */
type Variant =
  | "general-a"
  | "general-b"
  | "genz-a"
  | "genz-b"
  | "sunnah-a"
  | "sunnah-b";

const VARIANTS: Variant[] = [
  "general-a",
  "general-b",
  "genz-a",
  "genz-b",
  "sunnah-a",
  "sunnah-b",
];

export function BriefFlyerSection({ briefId }: { briefId: string }) {
  const locale = useLocale();
  const t = useTranslations("Briefing");
  const lang = locale === "en" ? "en" : "id";

  // Previews are heavy (6 × 1080² PNGs) and visually dominate the
  // page. Default-collapsed lets users keep their place in the brief
  // until they explicitly want to look at the flyers.
  const [expanded, setExpanded] = useState(false);
  const [zoomed, setZoomed] = useState<Variant | null>(null);

  const flyerUrl = (v: Variant) =>
    `/api/briefings/${briefId}/flyer?variant=${v}&lang=${lang}`;

  return (
    <section className="mt-10 mb-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-fuchsia-200 bg-fuchsia-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-fuchsia-700">
            <Sparkles className="h-3 w-3" />
            {t("brief_flyer_section_eyebrow")}
          </span>
          <h2 className="mt-2 text-balance text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            {t("brief_flyer_section_title")}
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-slate-600">
            {t("brief_flyer_section_body")}
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-fuchsia-200 bg-white px-3 py-1.5 text-xs font-semibold text-fuchsia-700 transition hover:border-fuchsia-300 hover:bg-fuchsia-50"
      >
        {expanded ? (
          <ChevronUp className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )}
        {expanded
          ? t("brief_flyer_section_hide")
          : t("brief_flyer_section_show")}
      </button>

      {expanded && (
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {VARIANTS.map((v) => (
            <FlyerCard
              key={v}
              variant={v}
              previewUrl={flyerUrl(v)}
              downloadName={`dakwah-lens_${briefId}_flyer-${v}.png`}
              title={t(`brief_flyer_${cardKey(v)}_title`)}
              body={t(`brief_flyer_${cardKey(v)}_body`)}
              openLabel={t("brief_flyer_open_large")}
              downloadLabel={t("brief_flyer_download_short")}
              loadingLabel={t("brief_flyer_loading")}
              onZoom={() => setZoomed(v)}
            />
          ))}
        </div>
      )}

      {zoomed && (
        <ZoomOverlay
          src={flyerUrl(zoomed)}
          alt={t(`brief_flyer_${cardKey(zoomed)}_title`)}
          closeLabel={t("brief_flyer_close")}
          onClose={() => setZoomed(null)}
        />
      )}
    </section>
  );
}

function cardKey(
  v: Variant,
):
  | "general_a"
  | "general_b"
  | "modern_a"
  | "modern_b"
  | "sunnah_a"
  | "sunnah_b" {
  if (v === "general-a") return "general_a";
  if (v === "general-b") return "general_b";
  if (v === "genz-a") return "modern_a";
  if (v === "genz-b") return "modern_b";
  if (v === "sunnah-a") return "sunnah_a";
  return "sunnah_b";
}

function FlyerCard({
  variant,
  previewUrl,
  downloadName,
  title,
  body,
  openLabel,
  downloadLabel,
  loadingLabel,
  onZoom,
}: {
  variant: Variant;
  previewUrl: string;
  downloadName: string;
  title: string;
  body: string;
  openLabel: string;
  downloadLabel: string;
  loadingLabel: string;
  onZoom: () => void;
}) {
  const [loaded, setLoaded] = useState(false);

  const isModern = variant.startsWith("genz");
  const isSunnah = variant.startsWith("sunnah");
  const palette = isSunnah
    ? variant === "sunnah-a"
      ? {
          ring: "ring-amber-200/70",
          accentBtn: "bg-amber-600 hover:bg-amber-700",
          previewBg:
            "bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-50",
        }
      : {
          ring: "ring-emerald-300/70",
          accentBtn: "bg-emerald-700 hover:bg-emerald-800",
          previewBg:
            "bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50",
        }
    : isModern
      ? {
          ring: "ring-fuchsia-200/70",
          accentBtn: "bg-fuchsia-600 hover:bg-fuchsia-700",
          previewBg:
            "bg-gradient-to-br from-fuchsia-50 via-violet-50 to-amber-50",
        }
      : {
          ring: "ring-emerald-200/70",
          accentBtn: "bg-emerald-600 hover:bg-emerald-700",
          previewBg: "bg-gradient-to-br from-emerald-50 to-white",
        };

  return (
    <article
      className={`group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ring-1 ${palette.ring} transition hover:-translate-y-0.5 hover:shadow-md`}
    >
      <button
        type="button"
        onClick={onZoom}
        aria-label={openLabel}
        className={`relative aspect-square w-full overflow-hidden ${palette.previewBg}`}
      >
        {!loaded && (
          <div className="absolute inset-0 flex items-center justify-center text-xs font-medium text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <ImageIcon className="h-3.5 w-3.5 animate-pulse" />
              {loadingLabel}
            </span>
          </div>
        )}
        <img
          src={previewUrl}
          alt={title}
          width={1080}
          height={1080}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          className={`h-full w-full object-cover transition duration-300 ${loaded ? "opacity-100" : "opacity-0"} group-hover:scale-[1.02]`}
        />
        <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-1 text-[10px] font-semibold text-slate-700 shadow-sm backdrop-blur transition group-hover:bg-white">
          <Maximize2 className="h-3 w-3" />
          {openLabel}
        </span>
      </button>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <h3 className="text-base font-bold text-slate-900">{title}</h3>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">{body}</p>
        </div>

        <div className="mt-auto flex items-center gap-2">
          <a
            href={previewUrl}
            download={downloadName}
            className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold text-white transition ${palette.accentBtn}`}
          >
            <Download className="h-3.5 w-3.5" />
            {downloadLabel}
          </a>
          <button
            type="button"
            onClick={onZoom}
            className="inline-flex items-center justify-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-900 hover:bg-slate-900 hover:text-white"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </article>
  );
}

function ZoomOverlay({
  src,
  alt,
  closeLabel,
  onClose,
}: {
  src: string;
  alt: string;
  closeLabel: string;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 p-4 backdrop-blur-sm"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={closeLabel}
        className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-slate-900 shadow-md transition hover:bg-white"
      >
        ✕
      </button>
      <img
        src={src}
        alt={alt}
        className="max-h-[88vh] max-w-[88vw] rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
