/**
 * Narration manifests (content/narration/*.json): parsing, the same-origin
 * audio rule, and the guard on SPOKEN text.
 *
 * The narrator never voices Qur'anic words (plan §6.1 A1; operator): no
 * Arabic script and no transliteration of any lesson word may appear in a
 * line's text — the imam's recording carries every Qur'anic word and the
 * script says "kata ini", "kata pertama", etc. Also plain Indonesian for
 * adults: no digits (numbers spelled out), no ALL CAPS, "Anda" not "kamu".
 * Pure: no file access here (scripts/autoplay-check.ts reads the files).
 */
import { manifestParts } from "./ids";
import type { NarrationAudio, NarrationManifest, NarrationSegment } from "./types";

/** Narration audio is served same-origin by Caddy (plan §7.1), never from
 *  another host: the page makes no other network call besides the
 *  recitation streams. */
export const NARRATION_MEDIA_PREFIX = "/belajar/media/narration/";

const AUDIO_PATH = /^\/belajar\/media\/narration\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.(?:mp3|m4a|aac|ogg|opus|webm)$/;

export function isNarrationUrl(url: string): boolean {
  return AUDIO_PATH.test(url) && !url.includes("..");
}

/** The audio of a manifest line, if it is usable (same-origin path, a
 *  positive duration, a sha256); anything else plays caption-only. */
export function usableAudio(a: unknown): NarrationAudio | null {
  if (!a || typeof a !== "object") return null;
  const { url, ms, sha256 } = a as Record<string, unknown>;
  if (typeof url !== "string" || !isNarrationUrl(url)) return null;
  if (typeof ms !== "number" || !Number.isInteger(ms) || ms <= 0) return null;
  if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) return null;
  return { url, ms, sha256 };
}

/**
 * The audio files of line `id` in play order (the whole line, or its split
 * parts "<id>:a", "<id>:b", …). All or nothing: a line with any part
 * missing usable audio plays caption-only.
 */
export function lineSegments(manifest: NarrationManifest | null | undefined, id: string): NarrationSegment[] {
  if (!manifest) return [];
  const ids = manifestParts(manifest, id);
  if (!ids) return [];
  const out: NarrationSegment[] = [];
  for (const k of ids) {
    const audio = usableAudio(manifest.lines[k]?.audio);
    if (!audio) return [];
    out.push({ ...audio, id: k });
  }
  return out;
}

/** The spoken text of line `id` (split parts joined), or null. */
export function lineText(manifest: NarrationManifest | null | undefined, id: string): string | null {
  if (!manifest) return null;
  const ids = manifestParts(manifest, id);
  return ids ? ids.map((k) => manifest.lines[k].text.trim()).join(" ") : null;
}

/**
 * Reads a manifest; returns the problems instead of throwing, so the check
 * can list them all. `manifest` is null when the shape is unusable.
 */
export function parseNarrationManifest(raw: unknown): { manifest: NarrationManifest | null; problems: string[] } {
  const problems: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { manifest: null, problems: ["not a JSON object"] };
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.version !== "number" && typeof r.version !== "string") problems.push("version missing");
  let voice: NarrationManifest["voice"] = null;
  if (r.voice !== null && r.voice !== undefined) {
    const v = r.voice as Record<string, unknown>;
    if (typeof v !== "object" || typeof v.id !== "string" || typeof v.name !== "string" || typeof v.model !== "string") {
      problems.push("voice must be null or { id, name, model }");
    } else {
      voice = { id: v.id, name: v.name, model: v.model };
    }
  }
  if (!r.lines || typeof r.lines !== "object" || Array.isArray(r.lines)) {
    return { manifest: null, problems: [...problems, "lines must be an object keyed by line id"] };
  }
  const lines: NarrationManifest["lines"] = {};
  for (const [id, value] of Object.entries(r.lines as Record<string, unknown>)) {
    const l = value as Record<string, unknown> | null;
    if (!l || typeof l !== "object" || typeof l.text !== "string") {
      problems.push(`${id}: text missing`);
      continue;
    }
    const entry: NarrationManifest["lines"][string] = { text: l.text };
    if (l.audio !== undefined) {
      const audio = usableAudio(l.audio);
      if (audio) entry.audio = audio;
      else problems.push(`${id}: audio must be { url under ${NARRATION_MEDIA_PREFIX}, ms > 0, sha256 }`);
    }
    lines[id] = entry;
  }
  return {
    manifest: { version: typeof r.version === "number" || typeof r.version === "string" ? r.version : 0, voice, lines },
    problems,
  };
}

// ───────────────────────────── Word places ─────────────────────────────

const ORDINALS: Readonly<Record<string, number>> = {
  pertama: 1,
  kedua: 2,
  ketiga: 3,
  keempat: 4,
  kelima: 5,
  keenam: 6,
  ketujuh: 7,
  kedelapan: 8,
  kesembilan: 9,
  kesepuluh: 10,
  kesebelas: 11,
};
const ORDINAL = "(pertama|ke(?:dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|sebelas)(?: belas)?)";
const PLACE = new RegExp(`\\b[Kk]ata ${ORDINAL}(?: (dan|sampai) ${ORDINAL})?\\b`, "g");

const ordinalValue = (w: string) => (w.endsWith(" belas") ? ORDINALS[w.slice(0, -" belas".length)] + 10 : ORDINALS[w]);

/**
 * Word places a narration line names in its own ayah, in order of first
 * mention: "kata kedua" → [2], "kata ketiga dan keempat" → [3, 4], "kata
 * kedua sampai keempat" → [2, 3, 4]. A place followed by "di/pada ayat …"
 * belongs to another ayah and is skipped (the pipeline names those words by
 * their meaning instead). Mirrors word_places() in
 * pipeline/validate_narration.py.
 */
export function wordRefs(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(PLACE)) {
    const end = (m.index ?? 0) + m[0].length;
    if (/^ (?:di|pada) ayat\b/.test(text.slice(end))) continue;
    const a = ordinalValue(m[1]);
    const b = m[3] ? ordinalValue(m[3]) : null;
    const ns = b === null ? [a] : m[2] === "dan" ? [a, b] : Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);
    for (const n of ns) if (Number.isFinite(n) && !out.includes(n)) out.push(n);
  }
  return out;
}

// ───────────────────────────── Spoken-text guard ─────────────────────────────

const ARABIC_SCRIPT = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

/** Lowercase ASCII-ish form for comparing transliterations: diacritics,
 *  ‘ayn/hamza marks, apostrophes and hyphens dropped ("al-‘ālamīna" →
 *  "alalamina"). */
export function foldLatin(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[‘’'ʼʻʿʾ`´-]/g, "");
}

const TOKEN_SPLIT = /[^\p{L}\p{M}‘’'ʼʻʿʾ`´-]+/u;

/** Words of a text, folded (punctuation splits; hyphens and apostrophes
 *  join, as in transliteration). */
export function foldedTokens(text: string): string[] {
  return text.split(TOKEN_SPLIT).map(foldLatin).filter(Boolean);
}

const DIGRAPHS: Readonly<Record<string, string>> = { sy: "s", sh: "s", ts: "s", dz: "z", dh: "d", zh: "z", th: "t", gh: "g", kh: "h" };

/**
 * One spelling for a folded token: Indonesian writes a‘ūżu "a'udzu",
 * aṣ-ṣirāṭa "ash-shirath", gairi "ghairi", aḍ-ḍāllīna "adh-dhollin"; the
 * lesson transliteration folds to "auzu", "assirata", "gairi", "addallina".
 * Digraphs map to the folded letter and o to a; doubled letters stay (the
 * grammar term 'illah must not read as ilāh). As soundKey() in
 * pipeline/validate_narration.py (`sound`).
 */
export const soundKey = (k: string) => k.replace(/sy|sh|ts|dz|dh|zh|th|gh|kh/g, (m) => DIGRAPHS[m]).replace(/o/g, "a");

const ENDINGS: readonly (readonly [string, number])[] = [
  ["un", 3],
  ["an", 3],
  ["in", 3],
  ["il", 4],
  ["ul", 4],
  ["al", 4],
  ["a", 3],
  ["i", 3],
  ["u", 3],
];

/** A token without its case ending (rabbu, rabba, rabbil → rabb; aḥadan →
 *  aḥad); null when too short. As `stem` in validate_narration.py. */
export function stemKey(k: string): string | null {
  for (const [end, need] of ENDINGS) if (k.endsWith(end) && k.length - end.length >= need) return k.slice(0, -end.length);
  return null;
}

/** The article, folded and spelling-blind (al-, ar-, ash-/asy-, …). */
const ARTICLES: ReadonlySet<string> = new Set(["al", "ar", "ad", "as", "an", "at", "az"]);

/** Keys of one raw token: the whole (hyphens dropped) and, after an
 *  article, the rest ("ash-shirath" → "assirat", "sirat"). */
function tokenKeys(raw: string): string[] {
  const whole = soundKey(foldLatin(raw));
  const i = raw.indexOf("-");
  if (i > 0) {
    const head = soundKey(foldLatin(raw.slice(0, i)));
    const rest = soundKey(foldLatin(raw.slice(i + 1)));
    if (ARTICLES.has(head) && rest.length >= 3) return [whole, rest];
  }
  return [whole];
}

/**
 * Indonesian words that coincide with a folded transliteration and are not
 * a quotation: the name "Allah" (said in Indonesian; never "Allāhu" /
 * "Allāhi" / "lillāhi").
 */
export const SPOKEN_ALLOWLIST: ReadonlySet<string> = new Set(["allah"]);

/** ALL-CAPS words a spoken line may carry (as pipeline/validate_narration.py). */
export const SPOKEN_ACRONYMS: ReadonlySet<string> = new Set(["AI"]);

/** Pieces of lesson words the prose names on their own (the ism inside
 *  bismi, the ‘alā of ‘alaihim, …): validate_narration.py ALIASES. */
const QURAN_ALIASES: readonly string[] = ["ism", "ismi", "ihdi", "rabb", "rabbi", "waswasa", "min", "‘alā"];

/** Honorifics said in full (never a recitation). */
const HONORIFICS = /subhanahu wa ta'ala|shallallahu 'alaihi wa sallam/g;

export type QuranGuard = {
  /** Every lesson word, folded and spelling-blind: whole, without its
   *  article, each space-separated part, a ta marbuta spelled -ah (≥ 3 letters). */
  forms: ReadonlySet<string>;
  /** The same without the case ending — mabni words too, as recited at a
   *  pause (rabbi → rabb, khalaqa → khalaq). */
  stems: ReadonlySet<string>;
  /** Forms of ≥ 5 letters a joined token may start with (alhamdulillah, bismillah). */
  prefixes: readonly string[];
  /** Two words run together as recited, the second's hamzat wasl dropped
   *  ("huwallahu", "bismillahi"); a token starting with one is flagged. */
  runs: readonly string[];
};

/**
 * The guard's view of the lesson words. `translits`: every word's
 * transliteration; `ayat`: each ayah's words in order (for the words run
 * together), optional.
 */
export function quranTokenSet(translits: Iterable<string>, ayat: Iterable<readonly string[]> = []): QuranGuard {
  const forms = new Set<string>();
  const stems = new Set<string>();
  const add = (k: string) => {
    if (k.length >= 3 && !SPOKEN_ALLOWLIST.has(k)) forms.add(k);
    const st = stemKey(k);
    if (st && !SPOKEN_ALLOWLIST.has(st)) stems.add(st);
  };
  for (const t of [...translits, ...QURAN_ALIASES]) {
    const parts = t.trim().split(/\s+/).filter(Boolean);
    for (const part of parts) {
      for (const k of tokenKeys(part)) add(k);
      const nfc = part.normalize("NFC");
      if (/at[aiu]n?$/.test(nfc) && foldLatin(part).length >= 5) {
        for (const k of tokenKeys(nfc.replace(/at[aiu]n?$/, "ah"))) if (k.length >= 3) forms.add(k);
      }
    }
    if (parts.length > 1) add(soundKey(foldLatin(parts.join(""))));
  }
  const runs = new Set<string>();
  for (const words of ayat) {
    const ks = words.map((w) => soundKey(foldLatin(w.replace(/\s+/g, ""))));
    for (let i = 0; i + 1 < ks.length; i++) {
      if (ks[i + 1].startsWith("a") && ks[i].length >= 2) runs.add(ks[i] + ks[i + 1].slice(1));
    }
  }
  return {
    forms,
    stems,
    prefixes: [...forms].filter((k) => k.length >= 5),
    runs: [...runs].filter((r) => r.length >= 7).map((r) => r.slice(0, 7)),
  };
}

/** Is this raw token a lesson word, in any spelling or ending? */
function quranHit(raw: string, guard: QuranGuard): boolean {
  for (const k of tokenKeys(raw)) {
    if (guard.forms.has(k) || guard.stems.has(k)) return true;
    const st = stemKey(k);
    if (st && (guard.stems.has(st) || guard.forms.has(st))) return true;
    if (guard.prefixes.some((p) => k !== p && k.startsWith(p))) return true;
    if (guard.runs.some((r) => k.startsWith(r))) return true;
  }
  return false;
}

/**
 * Problems in one line of SPOKEN text (empty when it is fine):
 *  - Arabic script;
 *  - a lesson word in transliteration, in any spelling or ending
 *    ("al-ḥamdu", "rabbi", "rabbu", "a'udzu", "ash-shirath", "huwallahu") —
 *    the imam's recording says those, the narrator says "kata ini"; allowed:
 *    "Allah" (Indonesian), a surah name after "Surah", the letter name
 *    "lam" after "huruf"/"alif", and the honorifics;
 *  - digits (numbers must be spelled out before the render);
 *  - ALL CAPS (e.g. "SWT": spell honorifics out), acronyms in
 *    SPOKEN_ACRONYMS aside;
 *  - "kamu"/"kalian" (the module addresses adults as "Anda").
 * A lighter mirror of pipeline/validate_narration.py, which CI also runs.
 */
export function spokenTextProblems(text: string, guard: QuranGuard): string[] {
  const out: string[] = [];
  if (!text.trim()) out.push("empty text");
  if (ARABIC_SCRIPT.test(text)) out.push("Arabic script");
  const honor = [...text.matchAll(HONORIFICS)].map((m) => [m.index ?? 0, (m.index ?? 0) + m[0].length] as const);
  const raws: { raw: string; at: number }[] = [];
  const re = /[\p{L}\p{M}‘’'ʼʻʿʾ`´-]+/gu;
  for (const m of text.matchAll(re)) {
    const raw = m[0].replace(/^[‘’'ʼʻʿʾ`´-]+|[‘’'ʼʻʿʾ`´-]+$/g, "");
    if (raw) raws.push({ raw, at: m.index ?? 0 });
  }
  const keys = raws.map((r) => soundKey(foldLatin(r.raw)));
  const quoted = new Set<string>();
  raws.forEach(({ raw, at }, i) => {
    if (honor.some(([a, b]) => at >= a && at < b)) return;
    if (SPOKEN_ALLOWLIST.has(keys[i])) return;
    if (i > 0 && keys[i - 1] === "surah") return; // Surah An-Nas, Surah Al-Falaq
    if (keys[i] === "lam" && keys.slice(Math.max(0, i - 4), i).some((k) => k === "huruf" || k === "alif")) return;
    if (quranHit(raw, guard)) quoted.add(raw.toLowerCase());
  });
  if (quoted.size) out.push(`transliterated Qur'anic word(s): ${[...quoted].join(", ")}`);
  if (/[0-9]/.test(text)) out.push("digits (spell numbers out)");
  const caps = text
    .split(/[^\p{L}]+/u)
    .filter((w) => w.length >= 2 && w === w.toUpperCase() && w !== w.toLowerCase() && !SPOKEN_ACRONYMS.has(w));
  if (caps.length) out.push(`ALL CAPS: ${[...new Set(caps)].join(", ")}`);
  const informal = foldedTokens(text).filter((t) => t === "kamu" || t === "kalian");
  if (informal.length) out.push(`informal address: ${[...new Set(informal)].join(", ")} (use "Anda")`);
  return out;
}

/** Does a caption carry Arabic script? (Captions may carry transliteration.) */
export const hasArabicScript = (text: string) => ARABIC_SCRIPT.test(text);
