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
 * Read the flash for THIS render. Returns null when no flash is
 * pending. Does NOT delete the cookie — server components have
 * read-only cookies in Next.js 16, so `cookies().delete()` would
 * silently fail and the flash would reappear on every subsequent
 * render until the 60s TTL expired (this was the Astronacci-stuck-
 * toast bug, 2026-05-29). Instead the client-side FlashToast component
 * calls `clearFlashCookie` (below) via a server action right after it
 * mounts, which deletes the cookie reliably.
 */
export async function popFlash(): Promise<Flash | null> {
  const c = await cookies();
  const raw = c.get(COOKIE);
  if (!raw?.value) return null;
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

// `clearFlashCookie` lives in `flash-actions.ts` (a "use server"
// module) so client components like FlashToast can call it without
// pulling this server-only file into the client bundle.
