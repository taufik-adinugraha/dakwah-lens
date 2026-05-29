"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo } from "react";
import { X } from "lucide-react";

/**
 * Modal preview shown when the user clicks a layout card on /flyers/new.
 * Each layout is rendered with placeholder content — random photo from the
 * collection, lorem-ipsum text, and a literal "Arabic content" tag where
 * Arabic would go. Purely client-side, no PNG endpoint round-trip; the
 * preview just mimics the layout's visual structure at a small scale so
 * the user knows what they're picking before they commit content.
 */

type Layout =
  | "hero-ayat"
  | "hero-headline"
  | "split-image"
  | "quote-card"
  | "dua-hero";

type Photo = { id: string; src: string };

const LOREM_HEADLINE = "Lorem Ipsum Dolor Sit";
const LOREM_BODY =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation.";
const LOREM_QUOTE =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.";
const LOREM_CITATION = "Lorem Surat 1:1";

export function LayoutPreviewModal({
  layout,
  title,
  photos,
  arabicPlaceholder,
  confirmLabel,
  closeLabel,
  subtitle,
  onConfirm,
  onClose,
}: {
  layout: Layout;
  title: string;
  photos: Photo[];
  arabicPlaceholder: string;
  confirmLabel: string;
  closeLabel: string;
  subtitle: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  // Stable random pick per layout so re-opens of the same layout don't
  // shuffle the placeholder image around mid-decision.
  const photoSrc = useMemo(() => {
    if (photos.length === 0) return null;
    const idx = Math.abs(hashStr(layout)) % photos.length;
    return photos[idx].src;
  }, [layout, photos]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 p-4 backdrop-blur-sm"
    >
      <div
        className="relative w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl sm:max-w-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
        >
          <X className="h-4 w-4" />
        </button>

        <h3 className="pr-8 text-base font-semibold text-slate-900">
          {title}
        </h3>
        <p className="mt-1 text-xs text-slate-500">{subtitle}</p>

        <div className="my-4 flex justify-center">
          <div className="aspect-square w-full max-w-[360px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <PreviewSurface
              layout={layout}
              photoSrc={photoSrc}
              arabicPlaceholder={arabicPlaceholder}
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            {closeLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}

// ── Preview surfaces ─────────────────────────────────────────────────
// Each surface approximates the production layout (web/src/lib/flyer/
// layouts/*.tsx) at ~360px square. Not pixel-perfect — the goal is to
// show the user "here's where the photo goes, here's where the headline
// lands" before they commit content.

function PreviewSurface({
  layout,
  photoSrc,
  arabicPlaceholder,
}: {
  layout: Layout;
  photoSrc: string | null;
  arabicPlaceholder: string;
}) {
  if (layout === "hero-ayat") {
    return <HeroAyatPreview photoSrc={photoSrc} arabic={arabicPlaceholder} />;
  }
  if (layout === "hero-headline") {
    return <HeroHeadlinePreview photoSrc={photoSrc} />;
  }
  if (layout === "split-image") {
    return <SplitImagePreview photoSrc={photoSrc} />;
  }
  if (layout === "quote-card") {
    return <QuoteCardPreview photoSrc={photoSrc} />;
  }
  return <DuaHeroPreview photoSrc={photoSrc} arabic={arabicPlaceholder} />;
}

function PhotoOrFallback({
  src,
  className,
  alt = "",
}: {
  src: string | null;
  className?: string;
  alt?: string;
}) {
  if (!src) {
    return (
      <div
        aria-hidden
        className={`bg-gradient-to-br from-emerald-200 to-emerald-50 ${className ?? ""}`}
      />
    );
  }
  return <img src={src} alt={alt} className={`object-cover ${className ?? ""}`} />;
}

function HeroAyatPreview({
  photoSrc,
  arabic,
}: {
  photoSrc: string | null;
  arabic: string;
}) {
  return (
    <div className="relative h-full w-full">
      <PhotoOrFallback src={photoSrc} className="absolute inset-0 h-full w-full" />
      <div className="absolute inset-0 bg-gradient-to-b from-emerald-900/85 via-emerald-800/70 to-emerald-900/95" />
      <div className="relative flex h-full w-full flex-col items-center justify-center px-5 py-6 text-center text-white">
        <p className="text-[10px] font-semibold tracking-wider opacity-80">
          dakwah-lens.id
        </p>
        <p
          dir="rtl"
          lang="ar"
          className="mt-3 font-serif text-[20px] leading-relaxed opacity-95"
        >
          {arabic}
        </p>
        <p className="mt-4 max-w-[90%] text-[10px] italic leading-snug opacity-90">
          &ldquo;{LOREM_BODY.slice(0, 110)}…&rdquo;
        </p>
        <p className="mt-2 text-[9px] font-semibold uppercase tracking-wider opacity-70">
          {LOREM_CITATION}
        </p>
      </div>
    </div>
  );
}

function HeroHeadlinePreview({ photoSrc }: { photoSrc: string | null }) {
  return (
    <div className="relative h-full w-full overflow-hidden bg-gradient-to-br from-emerald-700 to-emerald-900">
      <div className="absolute right-4 top-4 h-[70px] w-[70px] overflow-hidden rounded-full ring-2 ring-emerald-300/50">
        <PhotoOrFallback src={photoSrc} className="h-full w-full" />
      </div>
      <div className="relative flex h-full w-full flex-col justify-center px-5 text-white">
        <p className="text-[10px] font-semibold tracking-wider opacity-80">
          dakwah-lens.id
        </p>
        <h4 className="mt-3 text-[22px] font-black leading-tight">
          {LOREM_HEADLINE}
        </h4>
        <p className="mt-3 max-w-[90%] text-[11px] leading-snug opacity-90">
          {LOREM_BODY.slice(0, 120)}…
        </p>
        <div className="mt-4 rounded-xl bg-white/95 px-3 py-2 text-slate-700">
          <p className="text-[10px] italic leading-snug">
            &ldquo;{LOREM_QUOTE}&rdquo;
          </p>
          <p className="mt-1 text-[9px] font-semibold uppercase tracking-wider text-emerald-700">
            {LOREM_CITATION}
          </p>
        </div>
      </div>
    </div>
  );
}

function SplitImagePreview({ photoSrc }: { photoSrc: string | null }) {
  return (
    <div className="grid h-full w-full grid-cols-2">
      <div className="flex flex-col justify-center bg-white px-4 py-5">
        <p className="text-[9px] font-semibold tracking-wider text-emerald-700">
          dakwah-lens.id
        </p>
        <h4 className="mt-2 text-[15px] font-black leading-tight text-slate-900">
          {LOREM_HEADLINE}
        </h4>
        <p className="mt-2 text-[9px] leading-snug text-slate-600">
          {LOREM_BODY.slice(0, 130)}…
        </p>
        <div className="mt-3 rounded-md bg-emerald-50 px-2 py-1.5">
          <p className="text-[8px] italic leading-snug text-slate-700">
            &ldquo;{LOREM_QUOTE.slice(0, 70)}…&rdquo;
          </p>
          <p className="mt-0.5 text-[8px] font-semibold uppercase text-emerald-700">
            {LOREM_CITATION}
          </p>
        </div>
      </div>
      <PhotoOrFallback src={photoSrc} className="h-full w-full" />
    </div>
  );
}

function QuoteCardPreview({ photoSrc }: { photoSrc: string | null }) {
  return (
    <div className="relative h-full w-full bg-gradient-to-br from-amber-100 via-orange-50 to-rose-50 p-4">
      <div className="absolute right-3 top-3 h-[50px] w-[50px] overflow-hidden rounded-lg shadow-md">
        <PhotoOrFallback src={photoSrc} className="h-full w-full" />
      </div>
      <div className="flex h-full flex-col items-center justify-center text-center">
        <p className="font-serif text-[36px] leading-none text-emerald-700/40">
          &ldquo;
        </p>
        <p className="-mt-2 max-w-[80%] text-[13px] italic leading-snug text-slate-800">
          {LOREM_QUOTE}
        </p>
        <p className="mt-3 text-[9px] font-semibold uppercase tracking-wider text-emerald-700">
          {LOREM_CITATION}
        </p>
        <p className="mt-4 text-[9px] font-semibold tracking-wider text-slate-500">
          dakwah-lens.id
        </p>
      </div>
    </div>
  );
}

function DuaHeroPreview({
  photoSrc,
  arabic,
}: {
  photoSrc: string | null;
  arabic: string;
}) {
  return (
    <div className="relative h-full w-full overflow-hidden bg-white">
      <div className="absolute inset-0 opacity-40">
        <PhotoOrFallback src={photoSrc} className="h-full w-full" />
      </div>
      <div className="absolute inset-0 bg-gradient-to-b from-white/95 via-white/85 to-white/70" />
      <div className="relative flex h-full w-full flex-col items-center px-5 py-6 text-center">
        <p className="text-[10px] font-semibold tracking-wider text-emerald-700">
          dakwah-lens.id
        </p>
        <p
          dir="rtl"
          lang="ar"
          className="mt-5 font-serif text-[22px] leading-relaxed text-slate-900"
        >
          {arabic}
        </p>
        <div className="mt-auto rounded-2xl border border-emerald-100 bg-white/95 px-4 py-3 shadow-sm">
          <p className="text-[10px] italic leading-snug text-slate-700">
            &ldquo;{LOREM_QUOTE}&rdquo;
          </p>
          <p className="mt-1 text-[9px] font-semibold uppercase tracking-wider text-emerald-700">
            {LOREM_CITATION}
          </p>
        </div>
      </div>
    </div>
  );
}
