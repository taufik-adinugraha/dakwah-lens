import "server-only";
import { NextResponse } from "next/server";

import { getBrowser } from "@/lib/flyer/render/browser";
import { getBriefingBySlug } from "@/lib/briefing-data";

/**
 * GET /api/m/{briefSlug}/pdf
 *
 * Server-side PDF render of the Mahasiswa article page at /m/{slug}.
 * Same Puppeteer-based pipeline as /api/d/{brief}/{deliverable}/pdf.
 * A4 portrait, print-media CSS applied, 12mm margins.
 */
export const runtime = "nodejs";
export const maxDuration = 45;

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const row = await getBriefingBySlug(id);
  if (!row) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const url = new URL(request.url);
  const lang = url.searchParams.get("lang") === "en" ? "en" : "id";
  // In-container Puppeteer fetch. Public-origin URL was producing
  // https://0.0.0.0:3000 in prod (Caddy forwards with that Host)
  // which Puppeteer SSL-errored on. Plain http://localhost:3000
  // works in dev and the Docker container.
  const internalBase =
    process.env.INTERNAL_BASE_URL ?? "http://localhost:3000";
  const pageUrl = `${internalBase}/${lang}/m/${id}?print=1`;

  const browser = await getBrowser();
  const page = await browser.newPage();
  let pdf: Buffer;
  try {
    await page.setViewport({ width: 1280, height: 1800, deviceScaleFactor: 2 });
    await page.emulateMediaType("print");
    await page.goto(pageUrl, { waitUntil: "networkidle0", timeout: 25_000 });
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

  const filename = `dakwah-lens_${id}_mahasiswa-article.pdf`;
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "public, max-age=3600",
    },
  });
}
