import "server-only";

import { cookies } from "next/headers";

/**
 * One-shot "flash" notification, cookie-backed.
 *
 * Why a cookie + not a DB row: flash messages are ephemeral
 * (post-action UX feedback like "Saved" / "Deleted"). Persisting them
 * to a DB would be overkill; a tiny short-lived cookie set by the
 * server action survives the redirect/revalidate cycle and is read
 * exactly once by the next render, then cleared.
 *
 * Usage in a server action:
 *
 *   import { setFlash } from "@/lib/flash";
 *
 *   export async function saveThing(formData: FormData) {
 *     // ...do work...
 *     await setFlash("success", "Saved");
 *     revalidatePath("/some-path");
 *   }
 *
 * The layout reads + clears via `popFlash()`, then passes the value
 * to a client `<FlashToast />` component for display.
 */

export type FlashKind = "success" | "error" | "info";
export type Flash = { kind: FlashKind; message: string };

const COOKIE = "dl_flash";

/**
 * Write a flash for the NEXT render. Safe to call after `cookies()`
 * is mutable (i.e. inside a server action or a route handler — NOT
 * during a pure server-component render where cookies are read-only).
 */
export async function setFlash(kind: FlashKind, message: string): Promise<void> {
  const c = await cookies();
  c.set(COOKIE, JSON.stringify({ kind, message } satisfies Flash), {
    // Short TTL — flash should appear at most on the very next render.
    // 60s is comfortably longer than typical revalidate + nav latency
    // without lingering if the user navigates away in between.
    maxAge: 60,
    httpOnly: false,
    sameSite: "lax",
    path: "/",
  });
}

/**
 * Read + clear the flash for THIS render. Returns null when no flash
 * is pending. Safe to call from a server component layout; the cookie
 * delete is part of the same response so the client never sees the
 * value twice.
 *
 * IMPORTANT: must be called inside a server-component render that has
 * mutable cookies access (e.g. a layout or page that hasn't been
 * statically optimized). Calling this from a static route is a no-op.
 */
export async function popFlash(): Promise<Flash | null> {
  const c = await cookies();
  const raw = c.get(COOKIE);
  if (!raw?.value) return null;
  try {
    c.delete(COOKIE);
  } catch {
    // cookies() is read-only in this context — silent no-op. The
    // cookie will linger for at most maxAge seconds.
  }
  try {
    const parsed = JSON.parse(raw.value) as Flash;
    if (
      parsed &&
      (parsed.kind === "success" ||
        parsed.kind === "error" ||
        parsed.kind === "info") &&
      typeof parsed.message === "string"
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
