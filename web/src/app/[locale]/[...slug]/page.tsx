import { notFound } from "next/navigation";

/**
 * Catch-all 404 trampoline. Next.js's `not-found.tsx` only fires when
 * a matched segment calls `notFound()`. Without this route, paths like
 * `/id/nonexistent` skip the locale layout entirely and serve the
 * generic global Next 404. This catch-all matches everything inside
 * `/[locale]/` that isn't already handled by a more specific page,
 * then explicitly throws to render `[locale]/not-found.tsx` — keeping
 * the branded 404 inside the locale layout (header, footer, locale
 * switcher, language metadata).
 */
export default function CatchAll() {
  notFound();
}
