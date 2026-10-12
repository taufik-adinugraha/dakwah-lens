/**
 * The fact cards' ayah popup (operator 2026-10-12: a location chip opened quran.com in a new tab
 * or app; "better to just show popup and show the verse (arabic + translation + play qari
 * voice)"): its pure parts, shared by the server (the lookup behind /belajar/api/ayah) and the
 * browser (src/components/surah/AyahDialog.tsx). Nothing here imports the data file: it stays on
 * the server (src/lib/ayat.ts) and reaches the browser one ayah at a time.
 */
import type { AyatFile } from "@/content/ayat-schema";

/** The imam the popup plays: the module's default reciter (plan L7), the lessons' own files. */
export const POPUP_RECITER = "Alafasy_128kbps";
const EVERYAYAH = "https://everyayah.com/data";

/** Where the browser asks for one ayah (src/app/api/ayah/route.ts): same origin, CSP connect-src 'self'. */
export const AYAH_API = "/belajar/api/ayah";

export type AyahRef = { surah: number; ayah: number };

/** "2:255" → { surah: 2, ayah: 255 }; null for anything else (surah 1–114, ayah ≥ 1, written as
 *  the content writes locations: no leading zero, no space). */
export function parseAyahLoc(loc: unknown): AyahRef | null {
  const m = typeof loc === "string" ? /^([1-9]\d{0,2}):([1-9]\d{0,2})$/.exec(loc) : null;
  if (!m) return null;
  const surah = Number(m[1]);
  return surah <= 114 ? { surah, ayah: Number(m[2]) } : null;
}

const pad3 = (n: number) => String(n).padStart(3, "0");

/**
 * The recording of an ayah on EveryAyah, named SSSAAA.mp3 (the scheme of every recitation URL in
 * the lesson content): "2:255" → https://everyayah.com/data/Alafasy_128kbps/002255.mp3. Streamed
 * from the provider, never stored on our server (media-src lists the host, next.config.ts).
 */
export function recitationUrl(loc: string, reciter: string = POPUP_RECITER): string | null {
  const r = parseAyahLoc(loc);
  return r ? `${EVERYAYAH}/${reciter}/${pad3(r.surah)}${pad3(r.ayah)}.mp3` : null;
}

/** The API address of one ayah, or null for a malformed location. */
export function ayahApiUrl(loc: string): string | null {
  return parseAyahLoc(loc) ? `${AYAH_API}?loc=${loc}` : null;
}

/** The values of the popup's reference (messages Ayah.ref: "QS {name} [{surah}]: {ayah}" →
 *  "QS Al-Baqarah [2]: 255"); null when the location is malformed or its surah has no name. */
export function ayahRefValues(
  loc: string,
  names: Readonly<Record<string, string>>,
): { name: string; surah: number; ayah: number } | null {
  const r = parseAyahLoc(loc);
  const name = r ? names[String(r.surah)] : undefined;
  return r && typeof name === "string" && name ? { name, surah: r.surah, ayah: r.ayah } : null;
}

/** What /belajar/api/ayah answers for one ayah: the entry, its surah's name and the credit. */
export type AyahPayload = {
  loc: string;
  surah: number;
  ayah: number;
  name: string;
  /** Tanzil Uthmani, verbatim (as the lessons show it). */
  ar: string;
  translation: { text: string; footnotes: string[]; source_label: string; version: string };
};

/** loc → its payload, for the parsed content file; null when the file has no entry for it. */
export function ayahLookup(file: AyatFile): (loc: unknown) => AyahPayload | null {
  const byLoc = new Map(file.ayat.map((e) => [e.loc, e] as const));
  return (loc) => {
    const r = parseAyahLoc(loc);
    const e = r ? byLoc.get(loc as string) : undefined;
    const name = r ? file.names[String(r.surah)] : undefined;
    if (!r || !e || !name) return null;
    return {
      loc: e.loc,
      surah: r.surah,
      ayah: r.ayah,
      name,
      ar: e.ar,
      translation: {
        text: e.translation.text,
        footnotes: [...e.translation.footnotes],
        source_label: file.translation.source_label,
        version: file.translation.version,
      },
    };
  };
}

const isStr = (x: unknown): x is string => typeof x === "string" && x.length > 0;

/** The API's answer as the browser receives it: the payload of `loc`, or null when it is not one. */
export function parseAyahPayload(body: unknown, loc: string): AyahPayload | null {
  const r = parseAyahLoc(loc);
  if (!r || !body || typeof body !== "object") return null;
  const b = body as Partial<AyahPayload>;
  const t = b.translation as Partial<AyahPayload["translation"]> | undefined;
  if (b.loc !== loc || b.surah !== r.surah || b.ayah !== r.ayah || !isStr(b.name) || !isStr(b.ar)) return null;
  if (!t || !isStr(t.text) || !isStr(t.source_label) || !isStr(t.version)) return null;
  if (!Array.isArray(t.footnotes) || !t.footnotes.every(isStr)) return null;
  return {
    loc,
    surah: r.surah,
    ayah: r.ayah,
    name: b.name,
    ar: b.ar,
    translation: { text: t.text, footnotes: [...t.footnotes], source_label: t.source_label, version: t.version },
  };
}

/** The surah names a page's dialog needs before an ayah arrives (its reference is shown at once):
 *  the names of the surahs `locs` belong to, from the file's table. */
export function namesFor(locs: Iterable<string>, names: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const loc of locs) {
    const r = parseAyahLoc(loc);
    const key = r ? String(r.surah) : null;
    if (key && names[key]) out[key] = names[key];
  }
  return out;
}
