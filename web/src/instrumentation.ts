/**
 * Next.js instrumentation hook — runs once per worker process at boot,
 * before the server starts accepting requests.
 *
 * We use it for ONE thing: eager Chromium warmup. Without this, the
 * first user to hit a flyer endpoint waits ~1-2s for Puppeteer to launch
 * Chromium for the first time. Triggering the launch at boot moves that
 * cost off the user request path entirely — the browser is already
 * running by the time the first request arrives.
 *
 * Why `void` (fire-and-forget)? We don't want a bad Chromium install to
 * block the server from starting — flyer endpoints are non-critical, so
 * if Chromium can't launch we want the rest of the app to keep serving.
 * The browser singleton retries on demand, and individual flyer
 * requests will surface the error to the user as a 500.
 */
export async function register() {
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
}
