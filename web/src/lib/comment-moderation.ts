/**
 * Comment auto-moderation for the public /m/{slug} discussion section.
 *
 * Hybrid pipeline (cheapest wins first):
 *
 *   1. Length + structural guards     — reject empty, all-caps, > 500 chars
 *   2. Leetspeak-normalize the body   — so "jd0l" and "judol" hit the same rule
 *   3. Regex blocklist                — gambling, pinjol, profanity, shorteners,
 *                                       phone+contact lure, fake-testimonial money pattern
 *   4. Gibberish heuristics           — repeated chars, consonant runs,
 *                                       low-letter-ratio (emoji walls, gibberish)
 *   5. (Optional) LLM escalator       — Flash-Lite, fired only for borderline cases
 *                                       (long + clean-looking but has digits/links).
 *                                       Returns ok|blocked + 1-word reason.
 *
 * Returns a structured decision: `{ ok: true }` lets the comment through
 * with `status = 'approved'`; `{ ok: false, reason }` records `status =
 * 'blocked'` plus the short reason tag.
 *
 * The user-facing surface never shows the reason — blocked submissions
 * get a soft "sedang ditinjau" message so spammers don't learn the
 * exact tripwires.
 */

import { GoogleGenAI } from "@google/genai";

import { recordUsage } from "@/lib/usage-log";

export type ModerationReason =
  | "empty"
  | "too_long"
  | "all_caps"
  | "gambling"
  | "pinjol"
  | "shortener"
  | "contact_lure"
  | "profanity"
  | "gibberish"
  | "fake_testimonial"
  | "llm_unsafe";

export type ModerationDecision =
  | { ok: true }
  | { ok: false; reason: ModerationReason };

/* ────────────────────────────────────────────────────────────
 * 0. Public entry point
 * ──────────────────────────────────────────────────────────── */

const MIN_LEN = 2;
const MAX_LEN = 500;

export async function moderateComment(
  body: string,
  opts: { useLlm?: boolean } = {},
): Promise<ModerationDecision> {
  const trimmed = body.trim();
  if (trimmed.length < MIN_LEN) return { ok: false, reason: "empty" };
  if (trimmed.length > MAX_LEN) return { ok: false, reason: "too_long" };

  // "ALL CAPS YELLING WITH NO LOWERCASE" — only flag when body is
  // long enough that screaming reads as spam rather than abbreviation.
  if (trimmed.length > 20 && /^[^a-z]+$/.test(trimmed)) {
    const letters = trimmed.replace(/[^A-Za-z]/g, "");
    if (letters.length > 12 && letters === letters.toUpperCase()) {
      return { ok: false, reason: "all_caps" };
    }
  }

  const normalized = normalize(trimmed);

  // Cheap pattern passes — order matters: more-specific scams first,
  // then profanity, then heuristic gibberish.
  if (matchesAny(normalized, GAMBLING_PATTERNS))
    return { ok: false, reason: "gambling" };
  if (matchesAny(normalized, PINJOL_PATTERNS))
    return { ok: false, reason: "pinjol" };
  if (matchesAny(normalized, FAKE_TESTIMONIAL_PATTERNS))
    return { ok: false, reason: "fake_testimonial" };
  if (matchesAny(normalized, CONTACT_LURE_PATTERNS))
    return { ok: false, reason: "contact_lure" };
  if (matchesAny(normalized, SHORTENER_PATTERNS))
    return { ok: false, reason: "shortener" };
  if (matchesAny(normalized, PROFANITY_PATTERNS))
    return { ok: false, reason: "profanity" };
  if (isGibberish(trimmed))
    return { ok: false, reason: "gibberish" };

  // Borderline-but-clean: long body with digits or URLs that survived
  // the regexes — escalate to Flash-Lite. Cheap (~Rp 0.5/call) and
  // catches the disguised-spam tail the patterns miss.
  if (opts.useLlm && shouldEscalate(trimmed)) {
    const verdict = await llmScreen(trimmed);
    if (!verdict.ok) return verdict;
  }

  return { ok: true };
}

export const MODERATION_LIMITS = {
  minLen: MIN_LEN,
  maxLen: MAX_LEN,
  nameMaxLen: 40,
} as const;

/* ────────────────────────────────────────────────────────────
 * 1. Leetspeak / typo-bypass normalizer
 * ──────────────────────────────────────────────────────────── */

/**
 * Fold common bypass tricks into a single canonical form so the
 * blocklist below only needs the natural-spelling pattern.
 *
 * Examples normalize to: jd0l → judol, gac0r → gacor, l1nk → link,
 * w.a → wa, w.h.a.t.s.a.p.p → whatsapp.
 */
function normalize(s: string): string {
  let out = s.toLowerCase();

  // Strip Indonesian/zero-width punctuation interleaving (j.u.d.o.l → judol).
  out = out.replace(/[​-‍﻿]/g, "");
  // Single-char-then-dot/space repeated: "j.u.d.o.l" or "j u d o l" → "judol".
  out = out.replace(/\b([a-z])[.\s]([a-z])[.\s]([a-z])[.\s]([a-z])(?:[.\s]([a-z]))?\b/g, (_m, a, b, c, d, e) => `${a}${b}${c}${d}${e ?? ""}`);
  // Common leet swaps. We don't touch capital letters first — already lowercased.
  out = out
    .replace(/0/g, "o")
    .replace(/1/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/7/g, "t")
    .replace(/\$/g, "s")
    .replace(/@/g, "a");
  // Repeated chars: "ggaaccoorr" → "gacor"; "joooodddooll" → "judol".
  // Keep doubled letters since Indonesian uses them (e.g., "menggoda").
  out = out.replace(/([a-z])\1{2,}/g, "$1$1");
  return out;
}

/* ────────────────────────────────────────────────────────────
 * 2. Pattern blocklists
 * ──────────────────────────────────────────────────────────── */

// Gambling — slot/judi vocab. Includes Indonesian (judol/judi/togel)
// and the operator branding tells (gacor, maxwin, slot88, etc.).
const GAMBLING_PATTERNS: RegExp[] = [
  /\bjudol\b/,
  /\bjudi\s*(online|onlen|onlein|olshop)?\b/,
  /\btogel\b/,
  /\bgacor\b/,
  /\bmaxwin\b/,
  /\bjackpot|jek?pot|jp\s*(besar|maxi?win)\b/,
  /\bslot\s*(88|gacor|maxwin|online|deposit|dana)\b/,
  /\bslot(88|777|4d|deposit|gacor)\b/,
  /\b(rtp|return\s*to\s*player)\s*(live|tinggi|gacor|hari\s*ini)?\b/,
  /\bzeus\s*slot\b|\bgates\s*of\s*olympus\b|\bsweet\s*bonanza\b|\bmahjong\s*ways\b/,
  /\b(deposit|depo|topup)\s*(pulsa|dana|ovo|gopay|shopeepay)\b/,
  /\bbo(ku)?\s*slot\b|\bbandar\s*(slot|togel|judi)\b/,
  /\bwd\s*(cepat|gampang|jutaan|maxwin|kilat)\b/,
];

// Pinjol — illegal-lending lure language.
const PINJOL_PATTERNS: RegExp[] = [
  /\bpinjol\b/,
  /\bpinjaman\s*(online|onlen|cepat|tanpa\s*jaminan|tanpa\s*bi\s*checking)\b/,
  /\b(dana|modal|cuan|profit)\s*(cepat|kilat|harian|tanpa\s*ribet)\b/,
  /\bcair\s*(cepat|kilat|hari\s*ini|tanpa\s*jaminan)\b/,
  /\btanpa\s*jaminan\s*(ktp|cair)?\b/,
  /\bbunga\s*(rendah|0%|nol)\b.*\b(cepat|kilat|hari\s*ini)\b/,
];

// "Modal 10rb bisa WD jutaan" — sensational-money pattern that even
// disguised scams can't avoid because the number IS the hook.
const FAKE_TESTIMONIAL_PATTERNS: RegExp[] = [
  /\b\d{1,4}\s*(rb|ribu|k|jt|juta|m|miliar|milyar)\b.{0,40}\b(jadi|bisa|cair|wd|profit|menang|untung|tarik|withdraw)\b/,
  /\bmodal\s*(kecil|receh|\d+)\b.{0,30}\b(untung|jadi|profit|jutaan|jt|m)\b/,
  /\bwd\s*(jutaan|jt|juta|cepat|kilat|tiap\s*hari)\b/,
  /\bprofit\s*\d+\s*(%|persen|jt|juta)\b/,
  /\b(menang|menarik|tarik|withdraw)\s*\d+\s*(rb|ribu|jt|juta)/,
];

// "Info link di bio", "cek bio", "klik link di profil" — classic
// affiliate-spam call-to-action.
const CONTACT_LURE_PATTERNS: RegExp[] = [
  /\b(info|link|daftar|cek)\s*(di\s*)?bio\b/,
  /\bklik\s*(link|tautan)\s*(di\s*)?(bio|profil|atas|bawah)\b/,
  /\blink\s*(di\s*)?(bio|profil|deskripsi)\b/,
  /\b(dm|hubungi|kontak)\s*(saya|admin|wa|whatsapp)\b/,
  /\bwa\s*me\b|\bwa\.me\b/,
  /\b(whatsapp|wa|telegram|tele|line)\s*[:=\-\s]*\+?\d{9,}\b/,
  // Bare 9+ digit number — most commenters don't paste phone numbers.
  /\b\+?62\d{8,}\b|\b08\d{8,}\b/,
];

// URL shorteners — universal spam tell.
const SHORTENER_PATTERNS: RegExp[] = [
  /\bbit\.?ly\b/,
  /\bs\.?id\b/,
  /\bcutt\.?ly\b/,
  /\btinyurl\b/,
  /\bt\.co\b/,
  /\bow\.ly\b/,
  /\brebrand\.?ly\b/,
  /\bshorturl\b/,
  /\blink\.tree\b|\blinktr\.?ee\b/,
];

// Indonesian + English profanity. Conservative — only the unambiguous
// ones. Mild insults intentionally not blocked (the page asks for
// honest pushback, not sanitized agreement).
const PROFANITY_PATTERNS: RegExp[] = [
  /\bkontol\b/,
  /\bmemek\b/,
  /\b(ngentot|ngentod|entot)\b/,
  /\b(anjing|anjir|anjg|anjr|asu|asw)\s*(lu|kau|kamu|loe|elu)\b/,
  /\bbangsat\b/,
  /\bjancok|jancuk|cuk\b/,
  /\bbajingan\b/,
  /\b(tai|taik)\s*(lu|kau|kamu|loe|elu|anjing)\b/,
  /\b(fuck|fucked|fucking|fck)\b/,
  /\bshit\b/,
  /\b(bitch|bastard|asshole|cunt)\b/,
];

function matchesAny(s: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(s));
}

/* ────────────────────────────────────────────────────────────
 * 3. Gibberish heuristics
 * ──────────────────────────────────────────────────────────── */

function isGibberish(s: string): boolean {
  // Strip whitespace + punctuation for the ratio checks.
  const letters = s.replace(/[^a-zA-Z]/g, "");
  const total = s.replace(/\s/g, "").length;

  // Mostly emoji / symbols / digits — < 40% letters in a body
  // > 24 chars is almost always spam or noise.
  if (total > 24 && letters.length / total < 0.4) return true;

  // 5+ consonants in a row (no a/e/i/o/u/y) — keyboard mash like
  // "asdfgjklqwerty". Capped at 5 so Arabic-transliteration like
  // "Bismillāh" or names like "Krzysztof" don't trip it.
  if (/[bcdfghjklmnpqrstvwxz]{6,}/i.test(s)) return true;

  // Repeated single char ≥ 6 times: "aaaaaa".
  if (/(.)\1{5,}/.test(s)) return true;

  return false;
}

/* ────────────────────────────────────────────────────────────
 * 4. LLM escalator (Gemini Flash-Lite)
 * ──────────────────────────────────────────────────────────── */

/** Only call the LLM when the comment has spam-shaped attributes but
 *  survived all the cheap rules. Keeps cost near zero on normal use. */
function shouldEscalate(s: string): boolean {
  const hasDigits = /\d/.test(s);
  const hasUrlish = /(https?:\/\/|www\.|\w+\.(com|net|org|id|xyz|info|biz|site|live|club|fun))/i.test(s);
  return s.length >= 40 && (hasDigits || hasUrlish);
}

// Direct Flash-Lite call (not via @/lib/llm — that path is locked to
// Pro/Sonnet for synthesis-grade work). Moderation is a one-word
// classifier; Flash-Lite at ~Rp 0.5/call is the right tier.

let _genai: GoogleGenAI | null = null;
function getGenai(): GoogleGenAI | null {
  if (!process.env.GEMINI_API_KEY) return null;
  if (_genai === null) {
    _genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return _genai;
}

const MOD_PROMPT = `You moderate a public Indonesian Islamic discussion on a college campus.

Reply with EXACTLY one word, no punctuation, no explanation:
- ok               → safe to publish
- gambling         → judol / slot / gacor / maxwin / RTP / WD scam
- pinjol           → illegal online lending pitch
- profanity        → sexual or hateful slurs
- shortener        → bit.ly / s.id / cutt.ly link to suspicious destination
- contact_lure     → "cek bio", "DM saya", affiliate lure with phone/link
- fake_testimonial → "modal 10rb jadi jutaan" earnings claim
- gibberish        → keyboard mash / not real words
- unsafe           → other clearly harmful content

Pass through (reply "ok"):
- Honest disagreement or criticism of the article
- Polite doubts and questions
- Religious vocabulary in heated but non-abusive use
- Indonesian colloquialisms ("anjir", "deh", "sih", "kok") used non-aggressively

Comment:
"""
{BODY}
"""

One-word decision:`;

async function llmScreen(body: string): Promise<ModerationDecision> {
  const genai = getGenai();
  if (!genai) return { ok: true };

  try {
    const resp = await genai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: MOD_PROMPT.replace("{BODY}", body),
      config: {
        temperature: 0,
        maxOutputTokens: 8,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    void recordUsage({
      provider: "gemini",
      operation: "comment_moderation",
      model: "gemini-2.5-flash-lite",
      tokensIn: resp.usageMetadata?.promptTokenCount ?? null,
      tokensOut: resp.usageMetadata?.candidatesTokenCount ?? null,
    });

    const d = (resp.text ?? "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z_]/g, "");
    if (!d || d === "ok") return { ok: true };
    const map: Record<string, ModerationReason> = {
      gambling: "gambling",
      pinjol: "pinjol",
      profanity: "profanity",
      shortener: "shortener",
      contact_lure: "contact_lure",
      fake_testimonial: "fake_testimonial",
      gibberish: "gibberish",
      unsafe: "llm_unsafe",
    };
    return { ok: false, reason: map[d] ?? "llm_unsafe" };
  } catch (err) {
    // Fail OPEN — regex already caught the bulk. We'd rather pass an
    // edge-case comment than 503 the whole discussion form.
    console.warn(
      "[comment-moderation] Flash-Lite screen failed:",
      err instanceof Error ? err.message : err,
    );
    return { ok: true };
  }
}
