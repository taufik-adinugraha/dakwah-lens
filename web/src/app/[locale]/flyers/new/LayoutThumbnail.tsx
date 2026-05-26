/**
 * Square SVG schematic of each user-selectable flyer layout. Drawn at a
 * 1:1 aspect to match the real 1080×1080 flyer output. Each shape
 * mirrors what its layout component does:
 *
 *   hero-ayat      — large Arabic text band, photo backdrop top
 *   hero-headline  — bold headline overlay on full-bleed photo
 *   split-image    — left column text, right column photo
 *   quote-card     — centered card with small accent photo
 *   dua-hero       — Arabic top, translation below, accent photo
 *
 * These are NOT renders of the actual flyer — they're abstract
 * structure hints, much faster to scan than reading "Hero Ayat:
 * Large Arabic verse with backing photo".
 */

type Layout =
  | "hero-ayat"
  | "hero-headline"
  | "split-image"
  | "quote-card"
  | "dua-hero";

export function LayoutThumbnail({
  layout,
  active,
}: {
  layout: Layout;
  active: boolean;
}) {
  // Color tokens — slate for neutral structure, emerald accent when
  // selected. The "photo" placeholder uses a soft fill so it reads as
  // imagery without competing with the text bars.
  const stroke = active ? "#10b981" : "#cbd5e1";
  const text = active ? "#065f46" : "#475569";
  const photo = active ? "#a7f3d0" : "#e2e8f0";

  return (
    <svg
      viewBox="0 0 80 80"
      width={64}
      height={64}
      aria-hidden
      className="shrink-0"
    >
      <rect
        x={1}
        y={1}
        width={78}
        height={78}
        rx={6}
        fill="white"
        stroke={stroke}
        strokeWidth={1.5}
      />
      {layout === "hero-ayat" && <HeroAyat photo={photo} text={text} />}
      {layout === "hero-headline" && (
        <HeroHeadline photo={photo} text={text} />
      )}
      {layout === "split-image" && <SplitImage photo={photo} text={text} />}
      {layout === "quote-card" && <QuoteCard photo={photo} text={text} />}
      {layout === "dua-hero" && <DuaHero photo={photo} text={text} />}
    </svg>
  );
}

/* ─── Layout-specific glyphs ──────────────────────────────────── */

function HeroAyat({ photo, text }: { photo: string; text: string }) {
  return (
    <>
      {/* Photo band at top */}
      <rect x={8} y={10} width={64} height={20} rx={2} fill={photo} />
      {/* Large Arabic block — represented by a wider, taller bar */}
      <rect x={14} y={36} width={52} height={6} rx={1.5} fill={text} />
      <rect x={20} y={45} width={40} height={6} rx={1.5} fill={text} />
      {/* Small translation line */}
      <rect x={22} y={56} width={36} height={2} rx={1} fill={text} opacity={0.5} />
      {/* Citation footer */}
      <rect x={28} y={64} width={24} height={2} rx={1} fill={text} opacity={0.35} />
    </>
  );
}

function HeroHeadline({ photo, text }: { photo: string; text: string }) {
  return (
    <>
      {/* Full-bleed photo */}
      <rect x={6} y={6} width={68} height={68} rx={3} fill={photo} />
      {/* Headline overlay band */}
      <rect x={14} y={32} width={52} height={5} rx={1.5} fill={text} />
      <rect x={20} y={40} width={40} height={5} rx={1.5} fill={text} />
      {/* Subtitle / body line */}
      <rect x={22} y={50} width={36} height={2} rx={1} fill={text} opacity={0.6} />
      <rect x={26} y={56} width={28} height={2} rx={1} fill={text} opacity={0.6} />
    </>
  );
}

function SplitImage({ photo, text }: { photo: string; text: string }) {
  return (
    <>
      {/* Right column photo */}
      <rect x={42} y={8} width={30} height={64} rx={2} fill={photo} />
      {/* Left column text bars */}
      <rect x={8} y={16} width={28} height={4} rx={1.5} fill={text} />
      <rect x={8} y={24} width={22} height={4} rx={1.5} fill={text} />
      <rect x={8} y={36} width={30} height={2} rx={1} fill={text} opacity={0.55} />
      <rect x={8} y={42} width={26} height={2} rx={1} fill={text} opacity={0.55} />
      <rect x={8} y={48} width={28} height={2} rx={1} fill={text} opacity={0.55} />
      <rect x={8} y={54} width={18} height={2} rx={1} fill={text} opacity={0.55} />
    </>
  );
}

function QuoteCard({ photo, text }: { photo: string; text: string }) {
  return (
    <>
      {/* Small accent photo top-right */}
      <circle cx={60} cy={18} r={6} fill={photo} />
      {/* Big centered quote glyph */}
      <text
        x={40}
        y={32}
        textAnchor="middle"
        fontFamily="serif"
        fontSize={16}
        fill={text}
        opacity={0.8}
      >
        “
      </text>
      {/* Quote text bars, centered */}
      <rect x={16} y={38} width={48} height={3} rx={1.2} fill={text} />
      <rect x={20} y={45} width={40} height={3} rx={1.2} fill={text} />
      <rect x={24} y={52} width={32} height={3} rx={1.2} fill={text} />
      {/* Attribution */}
      <rect x={30} y={62} width={20} height={2} rx={1} fill={text} opacity={0.5} />
    </>
  );
}

function DuaHero({ photo, text }: { photo: string; text: string }) {
  return (
    <>
      {/* Top: large Arabic du'a band */}
      <rect x={10} y={10} width={60} height={5} rx={1.5} fill={text} />
      <rect x={16} y={19} width={48} height={5} rx={1.5} fill={text} />
      <rect x={22} y={28} width={36} height={5} rx={1.5} fill={text} />
      {/* Translation block */}
      <rect x={14} y={42} width={52} height={2} rx={1} fill={text} opacity={0.55} />
      <rect x={14} y={48} width={48} height={2} rx={1} fill={text} opacity={0.55} />
      <rect x={14} y={54} width={44} height={2} rx={1} fill={text} opacity={0.55} />
      {/* Small accent photo at the bottom corner */}
      <rect x={56} y={62} width={14} height={10} rx={1.5} fill={photo} />
      {/* Citation */}
      <rect x={10} y={66} width={18} height={2} rx={1} fill={text} opacity={0.4} />
    </>
  );
}
