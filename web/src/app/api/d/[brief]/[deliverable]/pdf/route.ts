import "server-only";
import { NextResponse } from "next/server";

import { getBrowser } from "@/lib/flyer/render/browser";
import {
  DELIVERABLE_HEADING_PATTERNS,
  getBriefingBySlug,
} from "@/lib/insights-data";

/**
 * GET /api/d/{briefSlug}/{deliverable}/pdf
 *
 * Server-side PDF render of the share page at /d/{slug}/{deliverable}.
 * Reuses the Puppeteer browser singleton already running for the flyer
 * pipeline — no new infra. Output is A4 portrait so the printed PDF
 * maps cleanly to a campus bulletin board print job.
 *
 * Cached 1h with the `?lang=` and `?print=1` cache key — repeated
 * downloads of the same brief don't pay the Chromium launch tax
 * (singleton browser reuses the running instance anyway).
 */
export const runtime = "nodejs";
export const maxDuration = 45;

const VALID_DELIVERABLES = new Set(Object.keys(DELIVERABLE_HEADING_PATTERNS));

export async function GET(
  request: Request,
  context: {
    params: Promise<{ brief: string; deliverable: string }>;
  },
) {
  const { brief, deliverable } = await context.params;

  if (!VALID_DELIVERABLES.has(deliverable)) {
    return new NextResponse("Unknown deliverable", { status: 404 });
  }
  // 404 the brief slug here so Chromium doesn't waste a launch on a
  // page that's going to render notFound() anyway.
  const row = await getBriefingBySlug(brief);
  if (!row) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const url = new URL(request.url);
  const lang = url.searchParams.get("lang") === "en" ? "en" : "id";

  // Puppeteer fetches the page in-container — same Next.js process,
  // never the public domain. Hardcoding http://localhost:3000 (the
  // port Next.js binds in both dev and the Docker container) avoids
  // a reverse-proxy quirk where Caddy in prod forwards with
  // Host: 0.0.0.0:3000, making `new URL(request.url).origin` resolve
  // to `https://0.0.0.0:3000` — Puppeteer then SSL-errored on port
  // 3000 (which is plain HTTP). `INTERNAL_BASE_URL` lets a future
  // deployment override this if Next.js ever moves off 3000.
  const internalBase =
    process.env.INTERNAL_BASE_URL ?? "http://localhost:3000";
  const pageUrl = `${internalBase}/${lang}/d/${brief}/${deliverable}?print=1`;

  const browser = await getBrowser();
  const page = await browser.newPage();
  let pdf: Buffer;
  try {
    await page.setViewport({ width: 1280, height: 1800, deviceScaleFactor: 2 });
    // Use media type 'print' so the print: tailwind variants kick in
    // (we hide buttons / chrome under @media print).
    await page.emulateMediaType("print");
    await page.goto(pageUrl, {
      waitUntil: "networkidle0",
      timeout: 25_000,
    });
    pdf = Buffer.from(
      await page.pdf({
        format: "A4",
        printBackground: true,
        preferCSSPageSize: false,
        margin: {
          top: "12mm",
          right: "12mm",
          bottom: "14mm",
          left: "12mm",
        },
      }),
    );
  } finally {
    await page.close();
  }

  const filename = `dakwah-lens_${brief}_${deliverable}.pdf`;
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "public, max-age=3600",
    },
  });
}
