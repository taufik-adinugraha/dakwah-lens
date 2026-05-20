/**
 * One-click unsubscribe from the weekly digest. Token-based so the
 * recipient doesn't have to be logged in (or even have access to
 * the original email account anymore — they could forward the
 * email to a complaint inbox).
 *
 * Implements both:
 *   - GET (clickable link in email body) → renders a confirmation page
 *   - POST (RFC-8058 List-Unsubscribe-Post: List-Unsubscribe=One-Click)
 *
 * Both unsubscribe atomically — we set email_digest_opt_in = false
 * where the token matches. If no row matches (already unsubscribed,
 * tampered token), we still return 200 to avoid leaking valid-token
 * info to scanners.
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db, schema } from "@/db";

async function unsubscribe(token: string | null): Promise<boolean> {
  if (!token || token.length < 8 || token.length > 64) return false;
  const result = await db
    .update(schema.users)
    .set({ emailDigestOptIn: false })
    .where(eq(schema.users.digestUnsubscribeToken, token))
    .returning({ id: schema.users.id });
  return result.length > 0;
}

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  const ok = await unsubscribe(token);
  // Tiny inline HTML page — no need to render a full app route just
  // to confirm the unsubscribe.
  const html = `<!DOCTYPE html>
<html lang="id"><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Dakwah-Lens · Berhenti berlangganan</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc;color:#0f172a;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px}
    .card{max-width:480px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.05);text-align:center}
    h1{font-size:20px;margin:0 0 12px}
    p{color:#475569;line-height:1.6;margin:0 0 16px}
    a{color:#059669;text-decoration:none;font-weight:600}
  </style>
</head><body><div class="card">
  ${
    ok
      ? `<h1>Anda berhasil berhenti berlangganan</h1>
         <p>Ringkasan mingguan tidak akan lagi dikirim ke email Anda. Terima kasih atas waktu Anda bersama Dakwah-Lens.</p>`
      : `<h1>Tidak dapat diproses</h1>
         <p>Link berhenti berlangganan ini sudah kedaluwarsa atau tidak valid. Anda mungkin sudah berhenti berlangganan sebelumnya.</p>`
  }
  <p><a href="/">Kembali ke beranda →</a></p>
</div></body></html>`;
  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  // RFC 8058 one-click unsubscribe (Gmail / Apple Mail). The mail
  // client POSTs with no body but the same token query param.
  const { searchParams } = new URL(request.url);
  await unsubscribe(searchParams.get("token"));
  return new NextResponse(null, { status: 200 });
}
