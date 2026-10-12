// CI-only: the narration audio for the karaoke caption, answered in the browser (Playwright
// route) for the CI scripts that drive the narrated lesson — screenshots.mjs (the karaoke shots)
// and linebreaks.mjs (the karaoke caption measured at every text size). One copy, so the two
// cannot drift apart. Production keeps serving the files from the VM media dir through Caddy;
// nothing here changes routing.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// belajar/: the narration manifests (content/narration/*.json) and, on a
// machine that rendered them, the git-ignored DELIVERED MP3s the manifests name
// (pipeline/out/delivery/, 64 kbps mono, pipeline/encode_narration.py; since 2026-10-11 the
// manifests no longer name the 128 kbps masters in pipeline/out/narration/).
// The workflow copies the CI scripts to /tmp/shots-run and passes BELAJAR_DIR;
// run in place (belajar/scripts/ci/), it is two levels up.
export const BELAJAR_DIR = process.env.BELAJAR_DIR ?? fileURLToPath(new URL("../..", import.meta.url));
export const NARRATION_PREFIX = "/belajar/media/narration/";
export const isNarration = (url) => url.pathname.startsWith(NARRATION_PREFIX);

/** Every narration file the manifests point at → its duration (ms). */
export async function narrationIndex() {
  const dir = path.join(BELAJAR_DIR, "content", "narration");
  const index = new Map();
  for (const name of (await readdir(dir)).filter((n) => n.endsWith(".json")).sort()) {
    const m = JSON.parse(await readFile(path.join(dir, name), "utf8"));
    for (const line of Object.values(m.lines ?? {})) {
      const a = line?.audio;
      if (a && typeof a.url === "string" && Number.isInteger(a.ms) && a.ms > 0) index.set(a.url, a.ms);
    }
  }
  return index;
}

/** A silent WAV (8 kHz, mono, 8-bit PCM: 0x80 is silence) of `ms` milliseconds. */
function silentWav(ms) {
  const rate = 8000;
  const n = Math.max(1, Math.round((rate * ms) / 1000));
  const b = Buffer.alloc(44 + n, 0x80);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(36 + n, 4);
  b.write("WAVE", 8, "ascii");
  b.write("fmt ", 12, "ascii");
  b.writeUInt32LE(16, 16); // fmt chunk size
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(1, 22); // mono
  b.writeUInt32LE(rate, 24); // sample rate
  b.writeUInt32LE(rate, 28); // byte rate
  b.writeUInt16LE(1, 32); // block align
  b.writeUInt16LE(8, 34); // bits per sample
  b.write("data", 36, "ascii");
  b.writeUInt32LE(n, 40);
  return b;
}

/** Answers a media request with `body`, honouring a single byte Range (the media element asks for
 *  "bytes=0-" and may seek). */
function fulfillBytes(route, body, contentType) {
  const total = body.length;
  const m = /^bytes=(\d*)-(\d*)$/.exec(route.request().headers()["range"] ?? "");
  if (!m || (m[1] === "" && m[2] === "")) {
    return route.fulfill({ status: 200, contentType, headers: { "accept-ranges": "bytes" }, body });
  }
  const start = m[1] === "" ? Math.max(0, total - Number(m[2])) : Number(m[1]);
  const end = m[1] === "" || m[2] === "" ? total - 1 : Math.min(Number(m[2]), total - 1);
  if (start >= total || start > end) {
    return route.fulfill({ status: 416, headers: { "content-range": `bytes */${total}` }, body: "" });
  }
  return route.fulfill({
    status: 206,
    contentType,
    headers: { "accept-ranges": "bytes", "content-range": `bytes ${start}-${end}/${total}` },
    body: body.subarray(start, end + 1),
  });
}

/**
 * The narration URLs, answered in the browser for these CI runs only: the delivered MP3 from
 * pipeline/out/delivery/ when this machine has it (git-ignored: never on the CI runner), else a
 * SILENT stand-in exactly as long as the manifest says — the karaoke caption follows the audio
 * clock, so its word timings still play out as they would with the voice. A URL no manifest
 * names answers 404 (the lesson then shows that line caption-only). `served` records each answer.
 *
 * `delays` (optional, a Map of pathname → ms, read at each request): a request for one of those
 * URLs is answered only after that long — a slow connection for one line, for the loading-status
 * check (screenshots.mjs loadingChecks; operator 2026-10-11, narration rule 19). The caller adds
 * an entry just before the click that plays the line and removes it once the line plays, so the
 * page's own preload of the same file, made earlier, is not what waits.
 *
 * For the look-ahead check (screenshots.mjs aheadChecks; operator 2026-10-12, plan L18), all
 * optional:
 * - `timeline` (an array): one entry per request as it reaches this route — { path, type, range,
 *   start, end }: `type` is Playwright's resourceType ("media" for an audio element, "fetch" for
 *   the page's fetch()), `start` / `end` Date.now() when it arrived / was answered (end null until
 *   then) — so the check can tell the page's fetches ahead from the players' loads, whether two of
 *   them overlapped, and HOW MANY requests each file got (a file the page fetched and then plays
 *   from its own copy gets no second one: an object URL never reaches the network).
 * - `holdFetchMs`: every fetch() request is answered only after that long (the players' loads
 *   are not held), so that fetches made two at a time would visibly overlap.
 * - `failFetch` (a Set of pathnames, read at each request): a fetch() request for one of them is
 *   answered 503 — the page cannot make its copy of that file, so the line must play from the
 *   network URL as before the look-ahead (the audio element's own request is answered as usual).
 * (Playwright turns the browser's HTTP cache off while a route is set, so every request the
 * browser makes reaches this route.)
 */
export function narrationRoute(index, served, { delays, timeline, holdFetchMs = 0, failFetch } = {}) {
  return async (route) => {
    const req = route.request();
    const { pathname } = new URL(req.url());
    const entry = { path: pathname, type: req.resourceType(), range: req.headers()["range"] ?? null, start: Date.now(), end: null };
    timeline?.push(entry);
    const byFetch = entry.type === "fetch";
    try {
      await answerNarration(route, pathname, index, served, delays, byFetch ? holdFetchMs : 0, byFetch && failFetch?.has(pathname) === true);
    } finally {
      entry.end = Date.now();
    }
  };
}

/** One narration request answered (narrationRoute): 404 for a file no manifest names, else the
 *  delivered MP3 or its silent stand-in — after `delays`' entry for it, or `holdMs`; `fail`: 503
 *  instead (after the same wait). */
async function answerNarration(route, pathname, index, served, delays, holdMs, fail) {
  const rel = pathname.slice(NARRATION_PREFIX.length);
  const ms = index.get(pathname);
  if (ms === undefined || rel.split("/").some((p) => p === ".." || p === "")) {
    served.push(`${pathname} → 404 (not in a manifest)`);
    return route.fulfill({ status: 404, body: "" });
  }
  const answer = async () => {
    if (fail) {
      served.push(`${pathname} → 503 (this fetch() made to fail)`);
      return route.fulfill({ status: 503, body: "" });
    }
    let body = null;
    try {
      body = await readFile(path.join(BELAJAR_DIR, "pipeline", "out", "delivery", ...rel.split("/")));
    } catch {
      body = null;
    }
    if (body) {
      served.push(`${pathname} → pipeline/out/delivery MP3`);
      return fulfillBytes(route, body, "audio/mpeg");
    }
    // The byte range is logged: a media element re-fetches part of a file it is still playing,
    // which is not a new line being said.
    served.push(`${pathname} → silent stand-in, ${ms} ms, range ${route.request().headers()["range"] ?? "none"}`);
    return fulfillBytes(route, silentWav(ms), "audio/wav");
  };
  const delay = delays?.get(pathname) ?? 0;
  const wait = Math.max(delay, holdMs);
  if (wait > 0) {
    served.push(`${pathname} → held back ${wait} ms (${delay >= holdMs ? "a slow connection" : "a prefetch, held"})`);
    await new Promise((done) => setTimeout(done, wait));
    // The page may have moved on meanwhile (a failed check navigates away): nothing to answer.
    return answer().catch(() => {});
  }
  return answer();
}
