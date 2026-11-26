/**
 * Next.js instrumentation hook — runs once per worker process at boot,
 * before the server starts accepting requests.
 *
 * We use it for three things, all warm-ups that move a first-request cost
 * off the user's path:
 *
 * 1. Eager Chromium warmup. Without this, the first user to hit a flyer
 *    endpoint waits ~1-2s for Puppeteer to launch Chromium for the first
 *    time. Triggering the launch at boot means the browser is already
 *    running by the time the first request arrives.
 * 2. The landing page's figures (lib/landing-data.ts). The post count scans
 *    the whole table (~3 s), and the figures are kept for an hour, so the
 *    first visit after a deploy would otherwise be the one that pays.
 *
 * Why `void` (fire-and-forget)? We don't want a bad Chromium install to
 * block the server from starting — flyer endpoints are non-critical, so
 * if Chromium can't launch we want the rest of the app to keep serving.
 * The browser singleton retries on demand, and individual flyer
 * requests will surface the error to the user as a 500.
 */
export async function register() {
  // Skip during the production BUILD phase — `next build` evaluates
  // `register()` while doing static-page generation, and a Chromium
  // launch attempt during build either hangs the worker or pulls
  // puppeteer's binary resolver into a state that breaks unrelated
  // pages (deploy 26319575913 failed this way on 2026-05-23).
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  // Only run on Node runtime — Edge has no filesystem, no Puppeteer.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Lazy import so the Edge runtime build doesn't pull puppeteer.
  const { getBrowser } = await import("./lib/flyer/render/browser");
  void getBrowser()
    .then(() => {
      console.info("[flyer] chromium warmup complete");
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[flyer] chromium warmup failed (will retry on first request): ${msg}`,
      );
    });

  // Landing figures. Fire-and-forget like the above, and guarded harder:
  // `register()` must finish before the server takes requests, so nothing
  // here may be awaited past the import, and a failed import or a database
  // that is not up yet must never stop the server from starting. The first
  // visitor then loads the figures instead, as before this existed.
  //
  // 3. The /radar pages' figures (lib/radar-data.ts, ~5 s for /radar and up to
  //    ~16 s per platform page uncached). They start only after the landing
  //    figures are done, and radar-data loads one page at a time, so the boot
  //    never runs heavy reads side by side on the 2 GB VM.
  try {
    const { warmLanding } = await import("./lib/landing-data");
    const started = Date.now();
    void warmLanding()
      .then(() => {
        console.info(`[landing] figures warmed in ${Date.now() - started} ms`);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[landing] warm-up failed (the first visit will load the figures): ${msg}`,
        );
      })
      .then(() => {
        // Imported here, not above: a radar module that fails to load must
        // not cost the landing page its warm-up.
        const radarStarted = Date.now();
        return import("./lib/radar-data")
          .then(({ warmRadar }) => warmRadar())
          .then(() => {
            console.info(`[radar] figures warmed in ${Date.now() - radarStarted} ms`);
          });
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[radar] warm-up failed (the first visit will load the figures): ${msg}`,
        );
      });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[landing] warm-up skipped: ${msg}`);
  }
}
