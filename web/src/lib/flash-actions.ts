"use server";

import { cookies } from "next/headers";

/**
 * Server action: clear the flash cookie. Lives in its own file
 * (separate from `flash.ts`) because client components can't import
 * from a module that statically references `next/headers` — but they
 * CAN import a `"use server"` module, even if its implementation uses
 * server-only APIs internally. The boundary makes the import side
 * server-action-callable without dragging server APIs into the client
 * bundle.
 *
 * Called from `FlashToast` immediately after a toast displays, so the
 * cookie clears even though `popFlash()` (called during a layout
 * server-component render) can't delete it itself — Next.js 16's
 * `cookies()` is read-only outside actions/route handlers.
 *
 * `dl_flash` is the cookie set by `setFlash()` in `flash.ts`. Kept
 * inline here as a string literal rather than importing the constant
 * to avoid pulling the server-only module into this action's closure
 * graph.
 */
export async function clearFlashCookie(): Promise<void> {
  const c = await cookies();
  c.delete("dl_flash");
}
