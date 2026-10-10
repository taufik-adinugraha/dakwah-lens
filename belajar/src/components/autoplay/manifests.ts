/**
 * Narration manifests (content/narration/*.json), validated at BUILD time
 * like the lesson content: a malformed manifest, or a line whose audio is
 * not a same-origin file under /belajar/media/narration/, fails `next build`
 * instead of reaching a learner.
 *
 * Until the operator approves a voice and the render, every line carries
 * text only (voice: null) and the lesson runs caption-only; a line gains
 * `audio` only through pipeline/render_narration.py. Nothing here calls a
 * network: the files are bundled, and the audio they point at is fetched by
 * the learner's browser from this origin.
 *
 * Pure (no React, no Next, no zod): scripts can import it under tsx.
 */
import alFatihah from "../../../content/narration/al-fatihah.json";
import alIkhlas from "../../../content/narration/al-ikhlas.json";
import alFalaq from "../../../content/narration/al-falaq.json";
import anNas from "../../../content/narration/an-nas.json";
import shared from "../../../content/narration/shared.json";

import { parseNarrationManifest, type NarrationManifest } from "@/lib/autoplay";

function load(raw: unknown, name: string): NarrationManifest {
  const { manifest, problems } = parseNarrationManifest(raw);
  if (!manifest || problems.length > 0) {
    throw new Error(`content/narration/${name}.json is not a valid narration manifest:\n${problems.slice(0, 10).join("\n")}`);
  }
  return manifest;
}

/** Per-surah manifests by slug. A surah without one plays caption-only. */
const BY_SLUG: Readonly<Record<string, NarrationManifest>> = {
  "al-fatihah": load(alFatihah, "al-fatihah"),
  "al-ikhlas": load(alIkhlas, "al-ikhlas"),
  "al-falaq": load(alFalaq, "al-falaq"),
  "an-nas": load(anNas, "an-nas"),
};

/** content/narration/shared.json: start, resume, feedback, reminders, exercise prompts. */
export const SHARED_NARRATION: NarrationManifest = load(shared, "shared");

/** content/narration/${slug}.json, or null when the surah has none. */
export function narrationFor(slug: string): NarrationManifest | null {
  return Object.prototype.hasOwnProperty.call(BY_SLUG, slug) ? BY_SLUG[slug] : null;
}

/** Slugs that have a manifest (for the checks). */
export const NARRATED_SLUGS: readonly string[] = Object.keys(BY_SLUG);
