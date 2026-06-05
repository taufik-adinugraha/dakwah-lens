import { NextResponse } from "next/server";

import { getBriefingBySlug } from "@/lib/briefing-data";

/**
 * GET /api/briefings/{slug}/pdf
 *
 * Proxies the PDF render request to the Python API service which runs
 * Playwright headless-chromium to render the public /briefings/{id}
 * page in print mode (?print=1). The API caches rendered PDFs on disk by
 * slug + briefing UUID, so re-requests for the same brief are cheap.
 *
 * Until Playwright is provisioned on the API side, this endpoint
 * returns 503 — the BriefDownloadMenu's "Print" option (which uses
 * window.print()) still works as a manual alternative.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  // Sanity check — 404 the slug here instead of letting the API service
  // fail later, so we don't waste a Playwright launch on bogus URLs.
  const brief = await getBriefingBySlug(id);
  if (!brief) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const apiBase = process.env.API_BASE_URL ?? "http://localhost:8000";
  let upstream: Response;
  try {
    upstream = await fetch(`${apiBase}/v1/briefs/${id}/pdf`, {
      method: "GET",
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      {
        error: "pdf_renderer_unavailable",
        message:
          "Server-side PDF rendering is not provisioned yet. Use the Print option in the download menu to save as PDF from your browser.",
      },
      { status: 503 },
    );
  }

  if (upstream.status === 501 || upstream.status === 503) {
    return NextResponse.json(
      {
        error: "pdf_renderer_unavailable",
        message:
          "Server-side PDF rendering is not provisioned yet. Use the Print option in the download menu to save as PDF from your browser.",
      },
      { status: 503 },
    );
  }

  if (!upstream.ok) {
    return new NextResponse("PDF render failed", { status: upstream.status });
  }

  const filename = `dakwah-lens-briefing-${id}.pdf`;
  // Stream the body straight through so we don't buffer ~1MB in memory.
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "public, max-age=3600",
    },
  });
}
