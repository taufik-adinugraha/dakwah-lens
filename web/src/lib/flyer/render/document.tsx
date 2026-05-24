import "server-only";

import { FLYER_HEIGHT, FLYER_WIDTH } from "../design";

/**
 * Wrap a rendered React tree in a complete HTML document — Tailwind via
 * Play CDN, Amiri + Inter fonts via Google Fonts, body sized to the
 * caller-specified canvas so the screenshot captures the layout
 * without scroll bars.
 *
 * Previously the wrapper hardcoded `body { width: 1080px; height:
 * 1080px; overflow: hidden }`, which is correct for the square PNG
 * flyers but actively wrong for the A4 PDF poster — the poster's own
 * `<style>` block trying to set `body { 210mm × 297mm }` was getting
 * partially clobbered (the head-level `overflow: hidden` survived),
 * producing a rendered poster div that filled only ~62% of the A4
 * page with a white band at the bottom. Now the dimensions are a
 * parameter, so the PDF caller can ask for an A4-shaped body and the
 * PNG callers keep their square canvas.
 *
 * `react-dom/server` is imported dynamically — Turbopack rejects a
 * static `import` of `react-dom/server` from files that end up in
 * App Router route traces (it can't statically verify the file is
 * never client-bundled). Async import is treated as opaque, which is
 * what we want.
 */

export type CanvasSize = {
  /** CSS value (`"1080px"`, `"210mm"`, etc.). Goes straight into
   *  `body { width: ... }`. */
  width: string;
  height: string;
};

/** Default canvas for the square social flyers — kept as the default
 *  so existing PNG callers don't need to change. */
const DEFAULT_CANVAS: CanvasSize = {
  width: `${FLYER_WIDTH}px`,
  height: `${FLYER_HEIGHT}px`,
};

function headFor({ width, height }: CanvasSize): string {
  // The viewport meta uses the raw px count when we know it; for
  // mm-based canvases (PDF poster) we omit the meta entirely so
  // Puppeteer's `setViewport()` setting wins.
  const viewportMeta =
    width.endsWith("px") && height.endsWith("px")
      ? `<meta name="viewport" content="width=${parseInt(width, 10)}, height=${parseInt(height, 10)}" />`
      : "";
  return `
  <meta charset="utf-8" />
  ${viewportMeta}
  <!-- Tailwind Play CDN: JIT-compiles classes used in the body at
       load time. Adds ~250ms to first render, cached across renders
       on the same Chromium instance. -->
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link
    href="https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=Inter:wght@400;500;600;700;800;900&display=swap"
    rel="stylesheet"
  />
  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: ${width};
      height: ${height};
      overflow: hidden;
      font-family: "Inter", system-ui, -apple-system, sans-serif;
    }
    body { background: #fff; }
    .font-amiri { font-family: "Amiri", serif; }
  </style>
`;
}

export async function buildHtmlDocument(
  tree: React.ReactNode,
  canvas: CanvasSize = DEFAULT_CANVAS,
): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const body = renderToStaticMarkup(<>{tree}</>);
  return `<!doctype html>
<html lang="id">
<head>${headFor(canvas)}</head>
<body>${body}</body>
</html>`;
}
