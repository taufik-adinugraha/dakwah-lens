/**
 * Indonesian-honorific helpers.
 *
 * Calling someone in Indonesia by their bare first name is uncomfortably
 * direct for most adult contexts — especially when the person carries an
 * earned title like Ust., KH., Hj., Prof., Dr. We collect a preferred
 * panggilan during onboarding and use this helper everywhere we'd
 * otherwise interpolate `name` directly.
 *
 * Fallback chain:
 *   1. Profile honorific (preset or custom) + name → "Ust. Taufik"
 *   2. Honorific = "none" or absent → "Bapak"/"Ibu" cannot be inferred
 *      from a name alone, so we fall back to the bare first name.
 *   3. No name → empty string.
 *
 * Used by:
 *   - Header / dashboard greetings (so we never write "Hi Taufik" abruptly)
 *   - Brief-generator prompt context (so the LLM mirrors the user's tone)
 */

import type { UserProfile } from "@/db/schema";

const HONORIFIC_ABBR: Record<string, string> = {
  ust: "Ust.",
  ustadzah: "Ustadzah",
  kh: "KH.",
  hj: "Hj.",
  habib: "Habib",
  buya: "Buya",
  prof: "Prof.",
  dr: "Dr.",
  drs: "Drs.",
  bapak: "Bapak",
  ibu: "Ibu",
};

function firstName(name: string | null | undefined): string {
  if (!name) return "";
  return name.trim().split(/\s+/)[0] ?? "";
}

/**
 * Render the panggilan + first name. Returns `""` if there's nothing to
 * address (no name, no honorific) — callers should handle that with a
 * neutral copy like "Welcome back".
 */
export function formatPanggilan(
  profile: UserProfile | null | undefined,
  fullName: string | null | undefined,
): string {
  const fn = firstName(fullName);

  // Custom honorific takes precedence — user typed it verbatim.
  if (profile?.honorific === "other" && profile.honorific_other) {
    const custom = profile.honorific_other.trim();
    return fn ? `${custom} ${fn}` : custom;
  }

  const abbr = profile?.honorific ? HONORIFIC_ABBR[profile.honorific] : null;
  if (abbr && fn) return `${abbr} ${fn}`;
  if (abbr && !fn) return abbr;
  return fn;
}
