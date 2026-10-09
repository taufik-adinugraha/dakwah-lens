/**
 * Eligibility (mawani', engine.md §4). Checked BEFORE hajb. An ineligible relative (different
 * religion, killer, adopted child, stepchild) neither blocks nor reduces anyone's share: the
 * classical rule for a mamnu' (hijab washfi), as opposed to a mahjub (Khairuddin p. 25).
 */
import type { Switches } from "./registry";
import type { Bar, IneligibleReason, Person } from "./types";

export type Eligibility =
  | { ok: true }
  | { ok: false; reason: IneligibleReason }
  /** Court column: a reported killing without a final judgment is not self-service (KHI 173). */
  | { ok: false; rujuk: "dugaan_pembunuhan" };

/** Bars that need a final judgment under KHI 173 (court column). */
const KHI173: readonly Bar[] = ["membunuh", "mencoba_membunuh", "aniaya_berat", "fitnah_pidana5th"];

export function eligibility(p: Person, sw: Pick<Switches, "killerBarred">): Eligibility {
  const bars = p.bars ?? [];
  if (p.religion !== "islam" || bars.includes("murtad")) return { ok: false, reason: "beda_agama" };
  if (sw.killerBarred === "any_killing") {
    // Fath al-Qarib § 116: any killing bars, intentional or not, even a lawful one. Attempt,
    // assault and false accusation are KHI 173 grounds, not classical mawani'.
    if (bars.includes("membunuh") || bars.includes("membunuh_tanpa_putusan")) return { ok: false, reason: "pembunuh" };
    return { ok: true };
  }
  if (bars.includes("membunuh_tanpa_putusan")) return { ok: false, rujuk: "dugaan_pembunuhan" };
  if (bars.some((b) => KHI173.includes(b))) return { ok: false, reason: "pembunuh" };
  return { ok: true };
}

/** KHI 185(1) "kecuali mereka yang tersebut dalam Pasal 173": a barred person opens no slot. */
export function barredUnder173(p: Person): boolean {
  return (p.bars ?? []).some((b) => KHI173.includes(b) || b === "membunuh_tanpa_putusan");
}

export const INELIGIBLE_RULE = {
  beda_agama: "mani.beda_agama",
  pembunuh: "mani.pembunuh",
  anak_angkat: "mani.anak_angkat",
  anak_tiri: "mani.anak_tiri",
} as const;
