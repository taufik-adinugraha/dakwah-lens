import type { FlyerLayoutComponent } from "./types";

/**
 * A4 portrait poster — the printable / clickable counterpart to the
 * square PosterQuestion PNG.
 *
 * Design philosophy:
 *   - Full A4 portrait (210 × 297 mm). Lays flat on a noticeboard.
 *   - One commanding headline (the poster question). Large enough to
 *     read from 2-3 m away.
 *   - QR + URL block at the bottom, both wrapped in `<a href>`. When
 *     rendered to PDF via Puppeteer, those anchors become real
 *     clickable link annotations — a phone user can tap either the
 *     URL text or the QR image to open the article.
 *   - Single layout (no rotating variants) — the A4 file is meant to
 *     be the canonical printable, not a feed-fresh share asset.
 *
 * CSS uses mm where it interacts with paper size and px elsewhere
 * (typography stays measured in px so the design reads the same in
 * preview viewports).
 */
export const PosterQuestionA4: FlyerLayoutComponent = ({
  content,
  image,
  palette,
  assets,
}) => {
  const { headline, dateLabel, brand, articleUrl, articleQrDataUrl } = content;

  // Photo sits as a subtle backdrop in the upper third — keeps the
  // poster grounded visually without competing with the headline.
  const showPhoto = !!assets.primary && image.kind === "photo";

  return (
    <>
      <style
        // @page sets the actual paper size; html/body fill it.
        dangerouslySetInnerHTML={{
          __html: `
            @page { size: A4 portrait; margin: 0; }
            html, body { margin: 0; padding: 0; background: #ffffff; }
            body { width: 210mm; height: 297mm; }
          `,
        }}
      />
      <div
        className="relative flex h-[297mm] w-[210mm] flex-col overflow-hidden text-slate-900"
        style={{
          background: `linear-gradient(160deg, ${palette.bgGradient[0]} 0%, ${palette.bgGradient[1]} 100%)`,
        }}
      >
        {/* Background photo wash — soft, low-opacity. */}
        {showPhoto && (
          <div
            className="absolute inset-x-0 top-0 h-[44%]"
            style={{
              backgroundImage: `url(${assets.primary})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              opacity: 0.18,
            }}
          />
        )}
        {/* Gradient overlay so headline reads cleanly on top of the photo. */}
        <div
          className="absolute inset-x-0 top-0 h-[55%]"
          style={{
            background: `linear-gradient(180deg, rgba(255,255,255,0) 0%, ${palette.bgGradient[1]}EE 100%)`,
          }}
        />

        {/* CONTENT — split into 3 vertical bands */}
        <div className="relative z-10 flex h-full flex-col px-[18mm] py-[16mm]">
          {/* Band 1: meta strip — brand + date + segment chip */}
          <header className="flex items-center justify-between">
            <span
              className="text-[14px] font-bold uppercase tracking-[0.18em]"
              style={{ color: palette.accentDeep }}
            >
              {brand}
            </span>
            <span
              className="rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.15em] text-white"
              style={{ background: palette.accentDeep }}
            >
              {dateLabel}
            </span>
          </header>

          {/* Band 2: the headline question — owns the visual stage */}
          <section className="mt-[14mm] flex flex-1 items-start">
            <div>
              <span
                className="inline-block rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em]"
                style={{
                  background: palette.accent,
                  color: palette.chipText,
                }}
              >
                Diskusi Mahasiswa
              </span>
              <h1
                className="mt-5 text-balance text-[44px] font-black leading-[1.06] tracking-tight sm:text-[52px]"
                style={{
                  letterSpacing: "-0.02em",
                  color: palette.accentDeep,
                  textWrap: "balance",
                }}
              >
                <span className="mr-1 opacity-40">&ldquo;</span>
                {headline}
                <span className="ml-1 opacity-40">&rdquo;</span>
              </h1>

              <p
                className="mt-6 max-w-[140mm] text-pretty text-[15px] leading-[1.55]"
                style={{ color: palette.accentDeep, opacity: 0.78 }}
              >
                Diskusi terbuka. Logika dulu, lalu daleel. Tulis pikiranmu —
                setuju, ragu, atau bantah. Kalau diskusinya hangat, kami
                undang lanjut tatap muka.
              </p>
            </div>
          </section>

          {/* Band 3: action footer — QR + clickable URL + brand */}
          <footer
            className="mt-[10mm] rounded-2xl bg-white px-[10mm] py-[8mm] shadow-md"
            style={{
              boxShadow: "0 8px 28px rgba(15,23,42,0.18)",
              border: `1.5px solid ${palette.accent}`,
            }}
          >
            <div className="flex items-center gap-[8mm]">
              {articleQrDataUrl && articleUrl && (
                <a
                  href={articleUrl.startsWith("http") ? articleUrl : `https://${articleUrl}`}
                  className="block shrink-0"
                  style={{
                    width: "38mm",
                    height: "38mm",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={articleQrDataUrl}
                    alt="QR ke artikel"
                    style={{ width: "100%", height: "100%" }}
                  />
                </a>
              )}
              <div className="min-w-0 flex-1">
                <p
                  className="text-[11px] font-bold uppercase tracking-[0.18em]"
                  style={{ color: palette.accentDeep, opacity: 0.65 }}
                >
                  Scan QR atau buka langsung
                </p>
                {articleUrl && (
                  <a
                    href={
                      articleUrl.startsWith("http")
                        ? articleUrl
                        : `https://${articleUrl}`
                    }
                    className="mt-2 block break-all text-[20px] font-extrabold tracking-tight no-underline"
                    style={{ color: palette.accentDeep }}
                  >
                    {articleUrl}
                  </a>
                )}
                <p
                  className="mt-2 text-[12.5px] italic"
                  style={{ color: palette.accentDeep, opacity: 0.7 }}
                >
                  Yuk lanjut diskusi — tulis pikiranmu di artikel.
                </p>
              </div>
            </div>
          </footer>

          <p
            className="mt-[6mm] text-center text-[10.5px] uppercase tracking-[0.2em]"
            style={{ color: palette.accentDeep, opacity: 0.55 }}
          >
            dakwah-lens.id · briefing mingguan untuk dakwah Indonesia
          </p>
        </div>
      </div>
    </>
  );
};
