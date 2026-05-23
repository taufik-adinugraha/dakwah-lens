"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Download, Image as ImageIcon, Maximize2, Sparkles } from "lucide-react";

/* eslint-disable @next/next/no-img-element */

/**
 * Two-card "Flyer Dakwah" section that sits between Section 4 (Strategi
 * & Aksi Dakwah) and Section 5 (Daleel & Sumber) on every brief page.
 *
 * The two cards surface the existing flyer endpoints:
 *   - Flyer Umum   → /api/insights-brief/{id}/flyer       (segment palette,
 *                                                          classical layout)
 *   - Flyer Gen Z  → /api/insights-brief/{id}/flyer-genz  (bold layout,
 *                                                          headline-led)
 *
 * Each card shows a real preview of the PNG (browser caches via the
 * route's Cache-Control header), Download + Open-large buttons, and a
 * short pitch for who the flyer is for.
 */
export function BriefFlyerSection({ briefId }: { briefId: string }) {
  const locale = useLocale();
  const t = useTranslations("Insights");
  const lang = locale === "en" ? "en" : "id";

  const generalUrl = `/api/insights-brief/${briefId}/flyer?lang=${lang}`;
  const genzUrl = `/api/insights-brief/${briefId}/flyer-genz?lang=${lang}`;

  const [zoomed, setZoomed] = useState<null | "general" | "genz">(null);

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

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <FlyerCard
          variant="general"
          previewUrl={generalUrl}
          downloadName={`dakwah-lens_${briefId}_flyer.png`}
          title={t("brief_flyer_general_title")}
          body={t("brief_flyer_general_body")}
          audienceLabel={t("brief_flyer_general_audience")}
          openLabel={t("brief_flyer_open_large")}
          downloadLabel={t("brief_flyer_download_short")}
          loadingLabel={t("brief_flyer_loading")}
          onZoom={() => setZoomed("general")}
        />
        <FlyerCard
          variant="genz"
          previewUrl={genzUrl}
          downloadName={`dakwah-lens_${briefId}_flyer-genz.png`}
          title={t("brief_flyer_genz_title")}
          body={t("brief_flyer_genz_body")}
          audienceLabel={t("brief_flyer_genz_audience")}
          openLabel={t("brief_flyer_open_large")}
          downloadLabel={t("brief_flyer_download_short")}
          loadingLabel={t("brief_flyer_loading")}
          onZoom={() => setZoomed("genz")}
        />
      </div>

      {zoomed && (
        <ZoomOverlay
          src={zoomed === "general" ? generalUrl : genzUrl}
          alt={
            zoomed === "general"
              ? t("brief_flyer_general_title")
              : t("brief_flyer_genz_title")
          }
          closeLabel={t("brief_flyer_close")}
          onClose={() => setZoomed(null)}
        />
      )}
    </section>
  );
}

function FlyerCard({
  variant,
  previewUrl,
  downloadName,
  title,
  body,
  audienceLabel,
  openLabel,
  downloadLabel,
  loadingLabel,
  onZoom,
}: {
  variant: "general" | "genz";
  previewUrl: string;
  downloadName: string;
  title: string;
  body: string;
  audienceLabel: string;
  openLabel: string;
  downloadLabel: string;
  loadingLabel: string;
  onZoom: () => void;
}) {
  const [loaded, setLoaded] = useState(false);

  const palette =
    variant === "general"
      ? {
          ring: "ring-emerald-200/70",
          chipBg: "bg-emerald-100",
          chipText: "text-emerald-700",
          accentBtn: "bg-emerald-600 hover:bg-emerald-700",
          previewBg: "bg-gradient-to-br from-emerald-50 to-white",
        }
      : {
          ring: "ring-fuchsia-200/70",
          chipBg: "bg-fuchsia-100",
          chipText: "text-fuchsia-700",
          accentBtn: "bg-fuchsia-600 hover:bg-fuchsia-700",
          previewBg: "bg-gradient-to-br from-fuchsia-50 via-violet-50 to-amber-50",
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
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${palette.chipBg} ${palette.chipText}`}
          >
            {audienceLabel}
          </span>
          <h3 className="mt-2 text-base font-bold text-slate-900">{title}</h3>
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
