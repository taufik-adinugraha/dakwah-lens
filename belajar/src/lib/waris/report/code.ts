/**
 * The short answer code printed in the Kepala ("W1-7K3Q", plan §6 row 0) so two printouts can be
 * matched at the family meeting, and the Indonesian date line.
 *
 * The code is a 20-bit FNV-1a hash of the family and the non-amount estate facts (wasiat shares,
 * consent, harta-bersama periods): rupiah amounts never enter it, so the code does not reveal them
 * (plan D9). Integer bit operations only (the waris lint block bans Math, `/` and `%`).
 */
import type { WarisInput } from "../types";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * JSON with sorted object keys; bigints (amounts) dropped, and `bars` dropped too: a reported
 * killing or KHI 173 ground never shapes anything a family can see or print (plan §9.4).
 */
function canonical(x: unknown): string {
  if (x === null || typeof x !== "object") return typeof x === "bigint" ? "null" : JSON.stringify(x) ?? "null";
  if (Array.isArray(x)) return `[${x.map(canonical).join(",")}]`;
  const o = x as Record<string, unknown>;
  const keys = Object.keys(o)
    .filter((k) => k !== "bars" && o[k] !== undefined && typeof o[k] !== "bigint")
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}

/** FNV-1a 32-bit over UTF-16 code units; the multiply by 16777619 is done as shifts so it stays exact. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
  }
  return h >>> 0;
}

/** "W1-" + four Crockford base-32 characters. */
export function answerCode(input: WarisInput, mode: "wafat" | "simulasi" = "wafat"): string {
  const e = input.estate;
  const facts = {
    m: mode,
    f: input.family,
    w: (e?.wasiat ?? []).map((w) => ({ h: w.toHeir, to: w.toId ?? null, f: w.fraction ? `${w.fraction.n.toString()}/${w.fraction.d.toString()}` : null })),
    c: e?.heirsConsentToExcessWasiat === true,
    r: e?.hartaBersamaRumit === true,
    p: (e?.hartaBersama ?? []).map((p) => p.period),
  };
  const h = fnv1a(canonical(facts));
  let out = "";
  for (const shift of [15, 10, 5, 0]) out += CROCKFORD.charAt((h >>> shift) & 31);
  return `W1-${out}`;
}

const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const MM = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];

/** "2026-10-09" → "9 Oktober 2026"; null for anything else. */
export function dateText(iso: string): string | null {
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(iso);
  if (!m) return null;
  const month = MM.indexOf(m[2]);
  if (month < 0 || m[3] === "00") return null;
  const day = m[3].startsWith("0") ? m[3].slice(1) : m[3];
  return `${day} ${MONTHS[month]} ${m[1]}`;
}
