import "server-only";

import { FLYER_HEIGHT, FLYER_WIDTH } from "../design";

/**
 * Wrap a rendered React tree in a complete HTML document — Tailwind via
 * Play CDN, Amiri + Inter fonts via Google Fonts, body sized exactly to
 * FLYER_WIDTH × FLYER_HEIGHT so the screenshot captures the canvas
 * without scroll bars.
 *
 * The output is a self-contained string that snapHtmlToPng can feed
 * straight into Puppeteer via `page.setContent`.
 *
 * `react-dom/server` is imported dynamically — Turbopack rejects a
 * static `import` of `react-dom/server` from files that end up in
 * App Router route traces (it can't statically verify the file is
 * never client-bundled). Async import is treated as opaque, which is
 * what we want.
 */

const HEAD = `
  <meta charset="utf-8" />
  <meta name="viewport" content="width=${FLYER_WIDTH}, height=${FLYER_HEIGHT}" />
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
      width: ${FLYER_WIDTH}px;
      height: ${FLYER_HEIGHT}px;
      overflow: hidden;
      font-family: "Inter", system-ui, -apple-system, sans-serif;
    }
    body { background: #fff; }
    .font-amiri { font-family: "Amiri", serif; }
  </style>
`;

export async function buildHtmlDocument(tree: React.ReactNode): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const body = renderToStaticMarkup(<>{tree}</>);
  return `<!doctype html>
<html lang="id">
<head>${HEAD}</head>
<body>${body}</body>
</html>`;
}
