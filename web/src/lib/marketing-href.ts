/**
 * Build absolute hrefs to landing-page anchor sections (`#features`,
 * `#how-it-works`, `#donate`).
 *
 * Two things make this non-trivial:
 *
 * 1. Approved viewers get server-redirected from `/` to `/dashboard`.
 *    The hash fragment is invisible to the server, so the redirect
 *    drops the anchor. We append `?view=marketing` — a sentinel the
 *    landing page checks — to opt out of the redirect.
 *
 * 2. Next.js App Router drops the auto-scroll-to-hash on cross-page
 *    client-side navigation. Callers using this helper should render
 *    a plain `<a>` (full page nav, native hash scroll) instead of
 *    next-intl's `<Link>` so the browser handles the anchor.
 *
 * Locale is baked into the URL so the plain `<a>` doesn't need
 * next-intl's locale-prefixing.
 */
export function marketingSectionLink(isApproved: boolean, locale: string) {
  return (hash: string) => {
    const suffix = isApproved ? `?view=marketing${hash}` : hash;
    return `/${locale}${suffix}`;
  };
}
