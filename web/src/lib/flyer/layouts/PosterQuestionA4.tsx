import type { FlyerLayoutComponent } from "./types";

/**
 * A4 portrait poster — single-tone, edge-to-edge, vertically centered.
 *
 * Design philosophy:
 *   - Full A4 portrait, edge-to-edge: the deep-accent background fills
 *     the entire paper. No white "footer card" splitting the visual,
 *     no abrupt color-band transitions — one continuous tone family
 *     from top to bottom.
 *   - Question headline is the focal point, centered both axes.
 *   - QR + URL sit just below the question as part of the same visual
 *     composition (QR stays on a white tile because scanners need
 *     high contrast — not a separate card, just a small embedded
 *     module).
 *   - Whole composition wrapped in a single tappable <a href> so
 *     Puppeteer page.pdf() emits real clickable link annotations
 *     across the QR + URL block.
 *
 * Layout uses mm where it meets paper geometry, px for typography.
 * Internal safe-zone is ~12mm — slightly outside the standard printer
 * unprintable margin (~5mm), tight enough that visible white padding
 * is negligible.
 */
export const PosterQuestionA4: FlyerLayoutComponent = ({
  content,
  image,
  palette,
  assets,
}) => {
  const { headline, dateLabel, brand, articleUrl, articleQrDataUrl } = content;
  const showPhoto = !!assets.primary && image.kind === "photo";

  // Headline char-count → font size. Long questions step down so they
  // don't overflow the vertical center band.
  const headlineLen = (headline ?? "").length;
  const headlineSize =
    headlineLen > 120 ? 38 : headlineLen > 80 ? 46 : headlineLen > 50 ? 54 : 62;

  const href = articleUrl
    ? articleUrl.startsWith("http")
      ? articleUrl
      : `https://${articleUrl}`
    : undefined;

  return (
    <>
      <style
        // @page sets the actual paper size; html/body fill it; the
        // outer poster div is the only painted surface.
        dangerouslySetInnerHTML={{
          __html: `
            @page { size: A4 portrait; margin: 0; }
            html, body { margin: 0; padding: 0; }
            body { width: 210mm; height: 297mm; }
          `,
        }}
      />
      <div
        className="relative flex h-[297mm] w-[210mm] flex-col items-center justify-between overflow-hidden text-white"
        style={{
          // Both stops sit in the dark half of the brand family so
          // the white text + chip stay legible everywhere on the
          // canvas. Earlier version went `bgGradient[1]` (near-white)
          // → `accentDeep` (dark) — produced bad white-on-near-white
          // contrast at the top-left corner where the brand + date
          // chips sit. Now `accent` (mid-dark) → `accentDeep` (dark)
          // keeps the subtle diagonal depth while making the top
          // region readable.
          background: `linear-gradient(155deg, ${palette.accent} 0%, ${palette.accentDeep} 100%)`,
          padding: "12mm",
        }}
      >
        {/* Subtle photo wash — full-bleed, low opacity, blended into
            the deep tone. Optional. */}
        {showPhoto && (
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              backgroundImage: `url(${assets.primary})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              opacity: 0.08,
              mixBlendMode: "soft-light",
            }}
          />
        )}
        {/* Soft ornamental glow — one big radial behind the headline
            so the eye lands center without needing a hard border. */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background: `radial-gradient(ellipse 55% 45% at 50% 45%, ${palette.accent}55 0%, transparent 70%)`,
          }}
        />

        {/* Top meta strip — brand + date, edge-aligned. */}
        <header className="relative z-10 flex w-full items-center justify-between">
          <span
            className="text-[12px] font-bold uppercase tracking-[0.22em]"
            style={{ color: "rgba(255,255,255,0.85)" }}
          >
            {brand}
          </span>
          <span
            className="rounded-full bg-white/15 px-3 py-1 text-[10.5px] font-bold uppercase tracking-[0.18em] text-white backdrop-blur-sm"
            style={{ border: "1px solid rgba(255,255,255,0.25)" }}
          >
            {dateLabel}
          </span>
        </header>

        {/* CENTER COMPOSITION — vertically centered focal area:
            chip → huge headline → tiny invitation. */}
        <section className="relative z-10 flex flex-col items-center text-center">
          <span
            className="inline-block rounded-full px-3.5 py-1 text-xs font-bold uppercase tracking-[0.18em]"
            style={{
              background: "rgba(255,255,255,0.95)",
              color: palette.accentDeep,
            }}
          >
            Diskusi Mahasiswa
          </span>
          {/* PDF text-layer hardening: keep the headline as a single
              continuous string so PDF readers can copy/select it
              with intact word boundaries. Chromium's page.pdf()
              slips into per-glyph positioning (no literal space
              chars in the text stream) when ANY of these are
              present:
                - non-zero letter-spacing
                - text-wrap: balance (words individually positioned
                  to balance line widths)
                - text-shadow (draws the text twice — once as the
                  shadow offset, once as the main layer, so every
                  PDF reader sees the headline doubled)
                - sibling <span>s on the same line (each slice
                  becomes its own positioned fragment)
              All of those are gone here. The quote glyphs are
              inlined directly in the string so the headline emits
              as a single text run per line. font-kerning: none
              disables pair-kerning adjustments. */}
          <h1
            className="mt-7 font-black text-pretty"
            style={{
              fontSize: `${headlineSize}px`,
              lineHeight: 1.05,
              color: "#ffffff",
              maxWidth: "180mm",
              fontKerning: "none",
              letterSpacing: "normal",
            }}
          >
            {`“${headline}”`}
          </h1>
          <p
            className="mt-7 max-w-[140mm] text-pretty text-[14px] leading-[1.55]"
            style={{ color: "rgba(255,255,255,0.78)" }}
          >
            Diskusi terbuka — boleh kamu setujui, boleh kamu bantah. Kalau
            diskusinya hangat, kami undang lanjut tatap muka.
          </p>
        </section>

        {/* QR + URL block — small, integrated. Wrapped in <a href> so
            page.pdf() makes the whole block a tappable annotation. */}
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="relative z-10 flex flex-col items-center no-underline"
          style={{ color: "inherit" }}
        >
          {articleQrDataUrl && href && (
            <div
              className="rounded-xl bg-white p-2"
              style={{
                width: "32mm",
                height: "32mm",
                boxShadow: "0 6px 24px rgba(0,0,0,0.28)",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={articleQrDataUrl}
                alt="QR ke artikel"
                style={{ width: "100%", height: "100%" }}
              />
            </div>
          )}
          {articleUrl && (
            <div
              className="mt-3 break-all text-center text-[15px] font-bold tracking-tight"
              style={{ color: "#ffffff" }}
            >
              {articleUrl}
            </div>
          )}
          <div
            className="mt-1 text-center text-[11.5px] italic"
            style={{ color: "rgba(255,255,255,0.75)" }}
          >
            Scan QR atau ketik URL · yuk lanjut diskusi
          </div>
        </a>

        {/* Footer line — minimal, just brand reinforcement. */}
        <footer
          className="relative z-10 text-center text-[10px] uppercase tracking-[0.25em]"
          style={{ color: "rgba(255,255,255,0.55)" }}
        >
          dakwah-lens.id · briefing dakwah indonesia
        </footer>
      </div>
    </>
  );
};
