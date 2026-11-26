/**
 * BELAJAR_PUBLIC — whether the module may be indexed by search engines. The shipped image is public
 * (operator, 2026-11-26: "publish belajar so google can see"; docs/belajar-plan.md L42): the
 * Dockerfile's default is `true`, in BOTH stages, so the one image CI builds, smoke-tests and ships
 * is the same image everywhere. Anything other than the exact value "true" (unset, "false") is
 * private, which is also what a laptop, `next dev` and the unit tests get.
 *
 * Public means indexable, and no more than that: what is hidden stays hidden (Ilmu Waris, a surah
 * that is not published, the learning path's card flow, the share cards, the English pages ...), which
 * lib/indexing.ts decides in one place, from the runtime switches of lib/features.ts, for the pages'
 * robots tags, the X-Robots-Tag header (src/proxy.ts) and the sitemap (src/app/sitemap.ts) alike.
 * Never block the module in robots.txt: Google cannot see a `noindex` on a page it may not fetch.
 *
 * Read per call, never captured in a constant: the prerendered lesson pages read it once, at BUILD
 * time (Dockerfile ENV), and the proxy, the sitemap and every page rendered per request read it at
 * RUN time (the same ENV, carried into the runner stage; `env_file` or `-e` can override it). That
 * makes it a kill switch as well: `BELAJAR_PUBLIC=false` in /srv/dakwah-lens/belajar.env and
 * `up -d --force-recreate` (no rebuild) puts `X-Robots-Tag: noindex` on every response and empties
 * the sitemap, whatever the prerendered pages' own tags say.
 *
 * What this flag replaced. It used to refuse a public BUILD while any record was marked "draft"
 * (lib/content.ts, lib/library.ts, lib/kosakata.ts, "revisit before any indexed build", plan L11).
 * But `status` is pipeline state, not a review: there is no human (ustadz) review step since
 * 2026-10-09 (L11), the pipeline refuses to write anything but "draft" (build_surah.py,
 * build_library.py, kosakata.py), and nothing in the UI renders it, so that gate could never open.
 * Its purpose was to keep unreviewed material from being passed off as reviewed. What guards that
 * now: (1) nothing may claim a review, in the content, the messages or any page (lib/publishable.ts,
 * its tests, and the CI sweep over every indexable page); (2) every page carries the AI-assisted
 * label and the "bukan fatwa" line (the layout's footer; the same tests and sweep); (3) what is not
 * finished stays out of the index because it is not published: a surah the operator has not listed
 * (BELAJAR_SURAHS) is a 404 or `noindex`, and out of the sitemap, whatever its content looks like.
 */
export function isPublic(): boolean {
  return process.env.BELAJAR_PUBLIC === "true";
}
