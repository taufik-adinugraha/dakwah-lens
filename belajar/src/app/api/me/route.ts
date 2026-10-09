import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Minimal identity for the client: never exposes the user id or email. */
export async function GET() {
  const user = await getSessionUser();
  return NextResponse.json(
    { user: user ? { name: user.name } : null },
    { headers: { "cache-control": "no-store" } },
  );
}
