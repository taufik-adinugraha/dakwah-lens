/**
 * Hajb hirman (total exclusion): ONE blockers() table (engine.md §6.1, KHI deltas §6.3), the hajb
 * stage of the solver, and couldAffectOutcome() for the questionnaire (plan §5.1; engine.md §6.1
 * "revised in review"). The questionnaire and L6's ladder must derive their states from here so
 * that the questions and the calculation cannot drift apart (project memory: manual/auto parity).
 */
import {
  PROFILES,
  SIBLING_HEIRS,
  type HeirId,
  type Switches,
} from "./registry";
import type { BlockedGroup, CoreInput, Member } from "./types";

/** Evaluation order: a blocker is always decided before the heirs it can block. */
export const HAJB_ORDER: readonly HeirId[] = [
  "anak_lk",
  "anak_pr",
  "cucu_lk",
  "cucu_pr",
  "ayah",
  "ibu",
  "suami",
  "istri",
  "kakek",
  "nenek_ibu",
  "nenek_ayah",
  "sdr_lk_kandung",
  "sdr_pr_kandung",
  "sdr_lk_seayah",
  "sdr_pr_seayah",
  "sdr_lk_seibu",
  "sdr_pr_seibu",
  "keponakan_lk_kandung",
  "keponakan_lk_seayah",
  "paman_kandung",
  "paman_seayah",
  "sepupu_lk_kandung",
  "sepupu_lk_seayah",
];

export interface HajbCtx {
  /** Number of PRESENT, ELIGIBLE and NOT-EXCLUDED persons of a role (decided earlier in order). */
  count: (h: HeirId) => number;
  /**
   * Whether a role MAY be present, read only where its presence lifts an exclusion (the UNBLOCKERS
   * below). The solver knows every role (= count > 0); the questionnaire treats a role it has not
   * asked yet as "maybe present", so an un-asked un-blocker never makes x look irrelevant.
   */
  maybe: (h: HeirId) => boolean;
  /** KHI-185 slot keys standing in for a son / a daughter (standar-indonesia only). */
  sonSlots: readonly string[];
  daughterSlots: readonly string[];
  sw: Pick<Switches, "daughtersExcludeSiblings" | "uterineExcludedBy">;
  /** Grandfather shares with full/consanguine siblings (Zaid): sibling-vs-sibling hajb is left to §8.4. */
  jaddRegime: boolean;
  /** A full / consanguine sister who is 'asabah ma'al ghair ranks as a brother of her line (§7.3). */
  maalGhair: { kandung: boolean; seayah: boolean };
}

/**
 * Roles whose presence LIFTS an exclusion of x (the "unless …" conditions of blockerHits): a son's
 * son makes his sister 'asabah despite two daughters; a consanguine brother does the same for his
 * sister despite two full sisters. Read through HajbCtx.maybe, never through count.
 */
export const UNBLOCKERS: Readonly<Partial<Record<HeirId, readonly HeirId[]>>> = {
  cucu_pr: ["cucu_lk"],
  sdr_pr_seayah: ["sdr_lk_seayah"],
};

/** A blocker and whether it is a KHI-only (86 K/AG/1994 line) exclusion. */
export interface BlockerHit {
  by: string;
  khi: boolean;
}

/**
 * The matrix row for heir x: every present, unexcluded relative (or KHI slot) that excludes x.
 * Empty list = x is not excluded. Rows: Fath al-Qarib § 117; Fath al-Mu'in § 34; Khairuddin
 * pp. 26–29; KHI deltas per switch (engine.md §6.3).
 */
export function blockerHits(x: HeirId, c: HajbCtx): BlockerHit[] {
  const out: BlockerHit[] = [];
  const has = (h: HeirId) => c.count(h) > 0;
  const add = (cond: boolean, by: string, khi = false) => {
    if (cond) out.push({ by, khi });
  };
  const sons = () => {
    add(has("anak_lk"), "anak_lk");
    for (const s of c.sonSlots) add(true, s);
  };
  const maleDesc = () => {
    sons();
    add(has("cucu_lk"), "cucu_lk");
  };
  /** 86 K/AG/1994: a child of either sex (or a KHI substitute) excludes siblings and their line. */
  const anyChildKhi = () => {
    if (!c.sw.daughtersExcludeSiblings) return;
    add(has("anak_pr"), "anak_pr", true);
    add(has("cucu_pr"), "cucu_pr", true);
    for (const s of c.daughterSlots) add(true, s, true);
  };
  const agnateChainBase = () => {
    maleDesc();
    add(has("ayah"), "ayah");
    add(has("kakek"), "kakek");
    add(has("sdr_lk_kandung"), "sdr_lk_kandung");
    add(has("sdr_lk_seayah"), "sdr_lk_seayah");
    add(c.maalGhair.kandung, "sdr_pr_kandung");
    add(c.maalGhair.seayah, "sdr_pr_seayah");
    anyChildKhi();
  };

  switch (x) {
    case "anak_lk":
    case "anak_pr":
    case "ayah":
    case "ibu":
    case "suami":
    case "istri":
      break; // never excluded (Fath al-Qarib § 116)
    case "cucu_lk":
      sons();
      break;
    case "cucu_pr":
      sons();
      // two or more daughters take ⅔; a son's daughter is then excluded unless a son's son makes
      // her 'asabah (Fath al-Mu'in § 34; Khairuddin p. 26 "habis bagian").
      add(c.count("anak_pr") + c.daughterSlots.length >= 2 && !c.maybe("cucu_lk"), "anak_pr");
      break;
    case "kakek":
      add(has("ayah"), "ayah");
      break;
    case "nenek_ibu":
      add(has("ibu"), "ibu");
      break;
    case "nenek_ayah":
      add(has("ibu"), "ibu");
      add(has("ayah"), "ayah");
      break;
    case "sdr_lk_kandung":
    case "sdr_pr_kandung":
      maleDesc();
      add(has("ayah"), "ayah");
      anyChildKhi();
      break;
    case "sdr_lk_seayah":
    case "sdr_pr_seayah":
      maleDesc();
      add(has("ayah"), "ayah");
      anyChildKhi();
      if (!c.jaddRegime) {
        add(has("sdr_lk_kandung"), "sdr_lk_kandung");
        add(c.maalGhair.kandung, "sdr_pr_kandung");
        if (x === "sdr_pr_seayah") {
          // two full sisters take ⅔ unless a consanguine brother makes her 'asabah
          add(!c.maalGhair.kandung && c.count("sdr_pr_kandung") >= 2 && !c.maybe("sdr_lk_seayah"), "sdr_pr_kandung");
        }
      }
      break;
    case "sdr_lk_seibu":
    case "sdr_pr_seibu":
      // any descendant, the father, and (classically) the grandfather — Fath al-Qarib § 117
      add(has("anak_lk"), "anak_lk");
      add(has("anak_pr"), "anak_pr");
      add(has("cucu_lk"), "cucu_lk");
      add(has("cucu_pr"), "cucu_pr");
      for (const s of c.sonSlots) add(true, s);
      for (const s of c.daughterSlots) add(true, s);
      add(has("ayah"), "ayah");
      if (c.sw.uterineExcludedBy === "classical") add(has("kakek"), "kakek");
      break;
    case "keponakan_lk_kandung":
      agnateChainBase();
      break;
    case "keponakan_lk_seayah":
      agnateChainBase();
      add(has("keponakan_lk_kandung"), "keponakan_lk_kandung");
      break;
    case "paman_kandung":
      agnateChainBase();
      add(has("keponakan_lk_kandung"), "keponakan_lk_kandung");
      add(has("keponakan_lk_seayah"), "keponakan_lk_seayah");
      break;
    case "paman_seayah":
      agnateChainBase();
      add(has("keponakan_lk_kandung"), "keponakan_lk_kandung");
      add(has("keponakan_lk_seayah"), "keponakan_lk_seayah");
      add(has("paman_kandung"), "paman_kandung");
      break;
    case "sepupu_lk_kandung":
      agnateChainBase();
      add(has("keponakan_lk_kandung"), "keponakan_lk_kandung");
      add(has("keponakan_lk_seayah"), "keponakan_lk_seayah");
      add(has("paman_kandung"), "paman_kandung");
      add(has("paman_seayah"), "paman_seayah");
      break;
    case "sepupu_lk_seayah":
      agnateChainBase();
      add(has("keponakan_lk_kandung"), "keponakan_lk_kandung");
      add(has("keponakan_lk_seayah"), "keponakan_lk_seayah");
      add(has("paman_kandung"), "paman_kandung");
      add(has("paman_seayah"), "paman_seayah");
      add(has("sepupu_lk_kandung"), "sepupu_lk_kandung");
      break;
    case "mutiq":
    case "mutiqah":
      break; // wala' is out of scope (rujuk), never reached
  }
  return out;
}

/** The blockers of x (role ids / slot keys), without the KHI flag. */
export function blockers(x: HeirId, c: HajbCtx): string[] {
  return blockerHits(x, c).map((h) => h.by);
}

export interface HajbOut {
  live: Partial<Record<HeirId, Member[]>>;
  blocked: BlockedGroup[];
  ctx: HajbCtx;
  /** Number of siblings of any line alive and eligible, even if excluded (engine.md §5.2 `S`). */
  S: number;
}

const has = (m: Partial<Record<HeirId, Member[]>>, h: HeirId) => (m[h]?.length ?? 0) > 0;

/** The hajb stage: evaluates the matrix top-down; a blocker must itself be unexcluded to block. */
export function applyHajb(ci: CoreInput): HajbOut {
  const live: Partial<Record<HeirId, Member[]>> = {};
  const blocked: BlockedGroup[] = [];
  const sonSlots = ci.slots.filter((s) => s.sex === "L").map((s) => s.key);
  const daughterSlots = ci.slots.filter((s) => s.sex === "P").map((s) => s.key);
  const ctx: HajbCtx = {
    count: (h) => live[h]?.length ?? 0,
    maybe: (h) => (live[h]?.length ?? 0) > 0,
    sonSlots,
    daughterSlots,
    sw: ci.sw,
    jaddRegime: false,
    maalGhair: { kandung: false, seayah: false },
  };
  let S = 0;
  for (const s of SIBLING_HEIRS) S += ci.roles[s]?.length ?? 0;

  for (const h of HAJB_ORDER) {
    const members = ci.roles[h];
    if (h === "sdr_lk_kandung") ctx.jaddRegime = isJaddRegime(ci, live, sonSlots, daughterSlots);
    if (members && members.length > 0) {
      const hits = blockerHits(h, ctx);
      if (hits.length === 0) live[h] = members;
      else
        blocked.push({
          heir: h,
          personIds: members.map((m) => m.personId),
          by: dedupe(hits.map((x) => x.by)),
          rule: hits.every((x) => x.khi) ? "khi.anak_menghijab_saudara" : "hajb.hirman",
        });
    }
    if (h === "sdr_pr_kandung") ctx.maalGhair.kandung = maalGhair(live, "kandung", sonSlots, daughterSlots);
    if (h === "sdr_pr_seayah") ctx.maalGhair.seayah = maalGhair(live, "seayah", sonSlots, daughterSlots);
  }
  return { live, blocked, ctx, S };
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs)];
}

function isJaddRegime(
  ci: CoreInput,
  live: Partial<Record<HeirId, Member[]>>,
  sonSlots: readonly string[],
  daughterSlots: readonly string[],
): boolean {
  if (!has(live, "kakek")) return false;
  const maleDesc = has(live, "anak_lk") || has(live, "cucu_lk") || sonSlots.length > 0;
  if (maleDesc || has(live, "ayah")) return false;
  const femaleDesc = has(live, "anak_pr") || has(live, "cucu_pr") || daughterSlots.length > 0;
  if (ci.sw.daughtersExcludeSiblings && femaleDesc) return false;
  return (["sdr_lk_kandung", "sdr_pr_kandung", "sdr_lk_seayah", "sdr_pr_seayah"] as const).some(
    (s) => (ci.roles[s]?.length ?? 0) > 0,
  );
}

function maalGhair(
  live: Partial<Record<HeirId, Member[]>>,
  line: "kandung" | "seayah",
  sonSlots: readonly string[],
  daughterSlots: readonly string[],
): boolean {
  const femaleDesc = has(live, "anak_pr") || has(live, "cucu_pr") || daughterSlots.length > 0;
  const maleDesc = has(live, "anak_lk") || has(live, "cucu_lk") || sonSlots.length > 0;
  if (!femaleDesc || maleDesc || has(live, "ayah") || has(live, "kakek")) return false;
  if (line === "kandung") return has(live, "sdr_pr_kandung") && !has(live, "sdr_lk_kandung");
  return (
    has(live, "sdr_pr_seayah") &&
    !has(live, "sdr_lk_seayah") &&
    !has(live, "sdr_pr_kandung") &&
    !has(live, "sdr_lk_kandung")
  );
}

// ---------------------------------------------------------------------------------------------
// couldAffectOutcome (questionnaire relevance; plan §5.1)
// ---------------------------------------------------------------------------------------------

/**
 * What the questionnaire knows so far: the number of ELIGIBLE relatives per role — Muslim at the
 * death; any reported killing has already routed to E-BUNUH at A3 (plan D4), so eligibility is
 * the same in both columns. A role that has not been asked yet is ABSENT from the object ("maybe present").
 * `predeceasedSons` / `predeceasedDaughters`: predeceased children who left living children
 * (KHI-185 slots in the court column; classical cucu / dzawil arham in the fikih column).
 */
export type KnownCounts = Partial<Record<HeirId, number>> & {
  predeceasedSons?: number;
  predeceasedDaughters?: number;
};

const COLUMNS = [PROFILES["klasik-syafii"], PROFILES["standar-indonesia"]] as const;

function knownCtx(known: KnownCounts, sw: Switches): HajbCtx {
  const n = (h: HeirId) => known[h] ?? 0; // unknown never blocks: it may be absent
  const maybe = (h: HeirId) => known[h] === undefined || known[h] > 0; // … and never fails to un-block
  const cucuSlots = sw.substitution === "cucu";
  const sonSlots = cucuSlots ? Array.from({ length: known.predeceasedSons ?? 0 }, (_, i) => `pengganti_lk${i}`) : [];
  const daughterSlots = cucuSlots
    ? Array.from({ length: known.predeceasedDaughters ?? 0 }, (_, i) => `pengganti_pr${i}`)
    : [];
  const femaleDesc = n("anak_pr") + n("cucu_pr") + daughterSlots.length > 0;
  const maleDesc = n("anak_lk") + n("cucu_lk") + sonSlots.length > 0;
  const kakekMaybe = known.kakek === undefined || known.kakek > 0;
  const noAyah = n("ayah") === 0;
  const siblingsMayExcludeKakekPattern = !(sw.daughtersExcludeSiblings && femaleDesc);
  const ctx: HajbCtx = {
    count: n,
    maybe,
    sonSlots,
    daughterSlots,
    sw,
    // mu'addah: while a grandfather may be present, consanguine siblings are not pre-excluded
    jaddRegime: kakekMaybe && noAyah && !maleDesc && siblingsMayExcludeKakekPattern,
    maalGhair: { kandung: false, seayah: false },
  };
  const blockedSimple = (h: HeirId) => blockerHits(h, ctx).length > 0;
  ctx.maalGhair.kandung =
    femaleDesc && !maleDesc && noAyah && n("kakek") === 0 && n("sdr_pr_kandung") > 0 && n("sdr_lk_kandung") === 0 && !blockedSimple("sdr_pr_kandung");
  ctx.maalGhair.seayah =
    femaleDesc &&
    !maleDesc &&
    noAyah &&
    n("kakek") === 0 &&
    n("sdr_pr_seayah") > 0 &&
    n("sdr_lk_seayah") === 0 &&
    n("sdr_pr_kandung") === 0 &&
    n("sdr_lk_kandung") === 0;
  return ctx;
}

/** x could inherit under ruleset switches sw, given what is known (no known blocker present). */
export function couldInherit(x: HeirId, known: KnownCounts, sw: Switches): boolean {
  if (x === "mutiq" || x === "mutiqah") return false;
  return blockerHits(x, knownCtx(known, sw)).length === 0;
}

/**
 * True if relative type x could change ANY number in EITHER column (plan §5.1): the OR, over the
 * fikih and court rulesets, of
 *   1. x could inherit;
 *   2. x counts toward the mother's "two or more siblings" (S, §5.2) even if x is excluded;
 *   3. x counts against the grandfather (mu'addah, §8.4);
 *   4. x decides a named pattern (Akdariyyah / 'Umariyyatain both need S < 2; covered by 2).
 * Unknown roles are "maybe present". Conservative by design: a false positive asks one question
 * too many; a false negative would print a wrong money split.
 */
export function couldAffectOutcome(x: HeirId, known: KnownCounts): boolean {
  for (const sw of COLUMNS) if (couldInherit(x, known, sw)) return true;
  const isSibling = (SIBLING_HEIRS as readonly HeirId[]).includes(x);
  if (!isSibling) return false;
  const motherMaybe = known.ibu === undefined || known.ibu > 0;
  let siblingsKnown = 0;
  for (const s of SIBLING_HEIRS) siblingsKnown += known[s] ?? 0;
  const classicalDesc = (known.anak_lk ?? 0) + (known.anak_pr ?? 0) + (known.cucu_lk ?? 0) + (known.cucu_pr ?? 0) > 0;
  for (const sw of COLUMNS) {
    // rule 2 per column: a predeceased daughter's child is a descendant only as a KHI substitute
    const slots = sw.substitution === "cucu" ? (known.predeceasedSons ?? 0) + (known.predeceasedDaughters ?? 0) : 0;
    if (motherMaybe && !classicalDesc && slots === 0 && siblingsKnown < 2) return true; // rules 2 and 4
  }
  const kakekMaybe = known.kakek === undefined || known.kakek > 0;
  const fullKnown = (known.sdr_lk_kandung ?? 0) + (known.sdr_pr_kandung ?? 0) > 0;
  if ((x === "sdr_lk_seayah" || x === "sdr_pr_seayah") && kakekMaybe && (known.ayah ?? 0) === 0 && fullKnown) {
    return true; // rule 3: mu'addah
  }
  return false;
}
