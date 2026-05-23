import "server-only";
import puppeteer, { type Browser } from "puppeteer";

/**
 * Module-scoped singleton Chromium browser. Launching Chromium is
 * expensive (~500ms even on a warm machine) — we pay it once per
 * Node worker process and reuse the instance across requests.
 *
 * A `Promise<Browser>` is stored (not the Browser itself) so concurrent
 * first-callers all await the same launch instead of racing into
 * multiple browser spawns. If the launch rejects we clear the cached
 * promise so the next request can retry.
 *
 * In dev, Next.js HMR can disconnect the underlying Chromium. We
 * detect a closed browser on each call and re-launch as needed.
 */

let browserPromise: Promise<Browser> | null = null;

async function launch(): Promise<Browser> {
  return await puppeteer.launch({
    headless: true,
    // In prod (Docker) we use the system Chromium installed via apt.
    // In local dev we fall through to puppeteer's bundled binary.
    // PUPPETEER_EXECUTABLE_PATH is set in web/Dockerfile.
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    // Args required for Chromium to start in containers + slim-Linux
    // hosts (the dakwah-lens prod VPS runs Docker on Debian). These
    // are harmless in dev too.
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--disable-gpu",
      "--font-render-hinting=none",
    ],
  });
}

export async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = launch().catch((err) => {
      browserPromise = null;
      throw err;
    });
  }
  const browser = await browserPromise;
  // If the browser has been disconnected (e.g. crashed, or HMR), relaunch.
  if (!browser.connected) {
    browserPromise = null;
    return getBrowser();
  }
  return browser;
}
