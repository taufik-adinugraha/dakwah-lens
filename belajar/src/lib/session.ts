import "server-only";

import { cookies } from "next/headers";

import { hasSessionCookie } from "./session-cookie";

export type SessionUser = {
  id: string;
  name: string | null;
};

/**
 * Who is signed in to dakwah-lens.id, by asking the MAIN app — never by
 * decoding the cookie here. The module is served on the same host, so the
 * main app's host-only session cookie reaches us; we forward it over the
 * internal Docker network to web's /api/auth/session (plan §7.3, option A).
 * NEXTAUTH_SECRET therefore lives in one service only, and a compromised
 * module cannot mint sessions.
 *
 * The main app runs with trustHost + an https NEXTAUTH_URL, so it reads the
 * `__Secure-` cookie name; the forwarded-proto/host headers make the
 * internal http hop look like the public request it stands for.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const base = process.env.MAIN_APP_INTERNAL_URL;
  if (!base) return null;

  const jar = await cookies();
  const cookieHeader = jar
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  if (!hasSessionCookie(cookieHeader)) return null;

  try {
    const res = await fetch(`${base}/api/auth/session`, {
      headers: {
        cookie: cookieHeader,
        "x-forwarded-proto": "https",
        "x-forwarded-host": "dakwah-lens.id",
        accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      user?: { id?: string; name?: string | null };
    } | null;
    const id = data?.user?.id;
    return id ? { id, name: data?.user?.name ?? null } : null;
  } catch {
    return null; // main app down or slow: the module keeps working anonymously
  }
}
