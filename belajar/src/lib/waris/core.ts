/**
 * The fara'id core (engine.md §1 stages 4–9) on a classical role set: hajb → special cases →
 * furudh → 'asabah → asal masalah + 'aul → radd / Baitul Mal / open residue. Used for the real
 * solve, the as-if wasiat-wajibah solves (§11.4) and the virtual tanzil solve (§10).
 */
import { assertAul, raddNonSpouse, scaleAll } from "./adjust";
import { asabah, type AsabahHolder } from "./asabah";
import { B0, ONE, ZERO, add, divInt, eq, frac, gt, lcmAll, mul, sub, sum, isZero, type Frac } from "./frac";
import { furudh, holdersOf, type Env, type FardhGroup } from "./furudh";
import { applyHajb } from "./hajb";
import type { HeirId, NoteId, RuleId, RujukReason } from "./registry";
import { akdariyyah, isAkdariyyah, isMusytarakahPattern, isUmariyyatain, jadd } from "./special";
import { memberWeight, perKepalaBinds } from "./substitution";
import type { Adjustment, BlockedGroup, CoreAlloc, CoreInput, CoreOut, Holder, SpecialCase, TraceStep } from "./types";

interface Contribution {
  holder: Holder;
  share: Frac;
  rules: { rule: RuleId; share: Frac }[];
}

export function solveCore(ci: CoreInput): CoreOut {
  const h = applyHajb(ci);
  const trace: TraceStep[] = [];
  const blocked: BlockedGroup[] = [...h.blocked];
  for (const b of h.blocked) trace.push({ rule: b.rule, heirs: [b.heir], facts: { oleh: b.by.join(",") } });
  for (const s of ci.slots) trace.push({ rule: "khi.pengganti", heirs: [s.key], facts: { menggantikan: s.parentId } });

  const live = h.live;
  const sonSlots = ci.slots.filter((s) => s.sex === "L");
  const daughterSlots = ci.slots.filter((s) => s.sex === "P");
  const cnt = (r: HeirId) => live[r]?.length ?? 0;
  const e: Env = {
    sex: ci.deceasedSex,
    sw: ci.sw,
    live,
    slots: ci.slots,
    sonSlots,
    daughterSlots,
    S: h.S,
    F: cnt("anak_lk") + cnt("anak_pr") + cnt("cucu_lk") + cnt("cucu_pr") + ci.slots.length > 0,
    Fm: cnt("anak_lk") + cnt("cucu_lk") + sonSlots.length > 0,
    maalGhair: h.ctx.maalGhair,
    jaddRegime: h.ctx.jaddRegime,
  };
  const notes: NoteId[] = [];
  const adjustments: Adjustment[] = [];
  const rujuk: RujukReason[] = [];
  let specialCase: SpecialCase | undefined;
  const contrib = new Map<string, Contribution>();
  const give = (holder: Holder, share: Frac, rule: RuleId) => {
    const c: Contribution = contrib.get(holder.id) ?? { holder, share: ZERO, rules: [] };
    c.share = add(c.share, share);
    c.rules.push({ rule, share });
    contrib.set(holder.id, c);
  };
  const out = (base: bigint, extra: Partial<CoreOut> = {}): CoreOut => {
    const allocs: CoreAlloc[] = [];
    for (const c of contrib.values()) {
      if (isZero(c.share)) continue;
      // the group rule: the residuary rule when the residue reached the heir, else the fardh rule
      const nonZero = c.rules.filter((r) => !isZero(r.share));
      allocs.push({ holder: c.holder, share: c.share, rule: (nonZero[nonZero.length - 1] ?? c.rules[0]).rule });
    }
    perKepalaCheck(ci, allocs, rujuk);
    return {
      allocs,
      blocked,
      adjustments,
      ...(specialCase ? { specialCase } : {}),
      baitulMal: ZERO,
      sisaDirujuk: ZERO,
      residueOpen: ZERO,
      base,
      tableBase: base,
      notes,
      trace,
      rujuk,
      ...extra,
    };
  };

  // §8.3 Akdariyyah (checked first: it is a jadd case with its own table).
  if (isAkdariyyah(e)) {
    const a = akdariyyah(e);
    for (const x of a.allocs) give(x.holder, x.share, x.rule);
    trace.push(...a.trace);
    adjustments.push("aul");
    specialCase = "akdariyyah";
    notes.push("jadd_perlu_konfirmasi");
    return out(BigInt(6), { tableBase: BigInt(9) }); // 6 → 9 by 'aul; tashih 9 → 27 (solve.ts)
  }

  // §5.2 fixed shares (the mother in 'Umariyyatain is computed after the spouse).
  const umar = isUmariyyatain(e);
  const fu = furudh(e, umar ? new Set<HeirId>(["ibu"]) : new Set<HeirId>());
  let fardh: FardhGroup[] = fu.fardh;
  trace.push(...fu.trace);
  if (umar) {
    const spouse = sum(fardh.filter((g) => g.spouse).map((g) => g.share));
    fardh.push({ holders: holdersOf(e, "ibu"), share: divInt(sub(ONE, spouse), 3), rule: "umariyyatain" });
    trace.push({ rule: "umariyyatain", heirs: ["ibu", "ayah"] });
    specialCase = "umariyyatain";
  }

  // §8.2 Musytarakah: the furudh exhaust the estate; full siblings join the uterine ⅓ per head.
  let fullSiblingsConsumed = false;
  if (isMusytarakahPattern(e) && eq(sum(fardh.map((g) => g.share)), ONE)) {
    const idx = fardh.findIndex((g) => g.rule === "fardh.seibu_1_3");
    if (idx >= 0) {
      const holders = [...fardh[idx].holders, ...holdersOf(e, "sdr_lk_kandung"), ...holdersOf(e, "sdr_pr_kandung")];
      fardh = fardh.map((g, i) => (i === idx ? { holders, share: g.share, rule: "musytarakah" as RuleId } : g));
      trace.push({ rule: "musytarakah", heirs: [...new Set(holders.map((x) => x.role))] });
      specialCase = "musytarakah";
      fullSiblingsConsumed = true;
    }
  }

  // §8.4 Grandfather with full/consanguine siblings (Zaid).
  let jaddAllocs: { holder: Holder; share: Frac; rule: RuleId }[] = [];
  let jaddKakekShare: Frac | undefined;
  if (e.jaddRegime) {
    const j = jadd(e, fardh);
    trace.push(...j.trace);
    blocked.push(...j.blocked);
    if (j.kakekFardh) fardh.push(j.kakekFardh);
    else {
      jaddAllocs = j.allocs;
      jaddKakekShare = j.allocs[0].share;
    }
    specialCase = "jadd";
    notes.push("jadd_perlu_konfirmasi");
  }

  // §7 'asabah.
  const as = fullSiblingsConsumed || e.jaddRegime ? null : asabah(e);
  if (as) trace.push(...as.trace);

  // §9.1 asal masalah.
  const dens = fardh.map((g) => g.share.d);
  if (jaddKakekShare) dens.push(jaddKakekShare.d);
  let base: bigint;
  if (dens.length > 0) base = lcmAll(dens);
  else if (as) {
    // only 'asabah: the number of heads, a male counting as two females when both sexes are present
    // (Fath al-Mu'in § 35, dalil F-FMUIN-35-usul: "three sons" → 3), i.e. the lcm of the holders'
    // shares: 3 sons → 3 (not 6), 1 son + 10 daughters → 12 (Fath al-Qarib § 117).
    const W = as.group.reduce((acc, x) => acc + x.weight, B0);
    base = lcmAll(as.group.map((x) => frac(x.weight, W).d));
  } else base = BigInt(1);

  const sumF = sum(fardh.map((g) => g.share));
  if (gt(sumF, ONE)) {
    // §9.2 'aul: every fardh shrinks in proportion; 'asabah get nothing.
    const siham = mul(sumF, frac(base)).n;
    assertAul(base, siham);
    fardh = scaleAll(fardh, sumF);
    adjustments.push("aul");
    trace.push({ rule: "aul", heirs: fardh.flatMap((g) => g.holders.map((x) => x.role)).filter(uniq), facts: { dari: base.toString(), menjadi: siham.toString() } });
    if (as) istighraq(as.group, fardh, blocked, trace);
    for (const g of fardh) for (const x of g.holders) give(x, divInt(g.share, g.holders.length), g.rule);
    return out(base, { tableBase: siham });
  }

  for (const g of fardh) for (const x of g.holders) give(x, divInt(g.share, g.holders.length), g.rule);
  const R = sub(ONE, sumF);
  if (jaddAllocs.length > 0) {
    for (const a of jaddAllocs) give(a.holder, a.share, a.rule);
    return out(base);
  }
  if (as) {
    if (isZero(R)) istighraq(as.group, fardh, blocked, trace);
    else {
      const W = as.group.reduce((acc, x) => acc + x.weight, B0);
      for (const x of as.group) give(x.holder, mul(R, frac(x.weight, W)), x.rule);
    }
    return out(base);
  }
  if (isZero(R)) return out(base);

  // §9.4 the furudh fall short and there is no 'asabah.
  const mode = ci.sw.residue;
  if (mode === "baitul_mal") {
    adjustments.push("baitul_mal");
    trace.push({ rule: "baitul_mal", heirs: [], facts: { sisa: `${R.n}/${R.d}` } });
    return out(base, { baitulMal: R });
  }
  if (fardh.length === 0) return out(base, { residueOpen: R });
  const nonSpouse = fardh.filter((g) => !g.spouse);
  if (mode === "radd_all" || nonSpouse.length > 0) {
    const radded = mode === "radd_all" ? scaleAll(fardh, sumF) : raddNonSpouse(fardh);
    contrib.clear();
    for (const g of radded) for (const x of g.holders) give(x, divInt(g.share, g.holders.length), g.rule);
    adjustments.push("radd");
    // the radd masalah (Fiqh as-Sunnah § 855): the heirs' heads when they are one class, else the
    // sum of their siham (a daughter and the mother: 6 → 4); a spouse who takes no radd keeps their
    // own table and the rest is fitted into it (with a wife as well: 8 × 4 = 32). A split inside a
    // class of several classes is tashih (solve.ts).
    const takesRadd = (g: FardhGroup) => mode === "radd_all" || !g.spouse;
    const receivers = radded.filter(takesRadd);
    const raddBase = lcmAll([
      ...radded.filter((g) => !takesRadd(g)).map((g) => g.share.d),
      ...(receivers.length === 1 ? receivers[0].holders.map(() => divInt(receivers[0].share, receivers[0].holders.length).d) : receivers.map((g) => g.share.d)),
    ]);
    trace.push({
      rule: mode === "radd_all" ? "radd.semua" : "radd.tanpa_pasangan",
      heirs: (mode === "radd_all" ? fardh : nonSpouse).flatMap((g) => g.holders.map((x) => x.role)).filter(uniq),
      facts: { dari: base.toString(), menjadi: raddBase.toString() },
    });
    return out(base, { tableBase: raddBase });
  }
  // only a spouse holds a fardh: the residue stays open (dzawil arham, or "sisa: konsultasikan")
  return out(base, { residueOpen: R });
}

function uniq<T>(x: T, i: number, a: T[]): boolean {
  return a.indexOf(x) === i;
}

/** §6.1 istighraq: an 'asabah gets nothing when the furudh exhaust the estate. */
function istighraq(group: AsabahHolder[], fardh: FardhGroup[], blocked: BlockedGroup[], trace: TraceStep[]) {
  const fardhIds = new Set(fardh.flatMap((g) => g.holders.map((x) => x.id)));
  const byRole = new Map<string, string[]>();
  for (const x of group) {
    if (fardhIds.has(x.holder.id)) continue; // the father keeps his ⅙
    const ids = x.holder.isSlot ? x.holder.members.map((m) => m.personId) : [x.holder.id];
    byRole.set(x.holder.role, [...(byRole.get(x.holder.role) ?? []), ...ids]);
  }
  for (const [heir, personIds] of byRole) {
    blocked.push({ heir, personIds, by: ["furudh"], rule: "hajb.istighraq" });
    trace.push({ rule: "hajb.istighraq", heirs: [heir] });
  }
}

/** KHI 185(2) `per_kepala`: refuse when a substitute person would exceed the reference heir. */
function perKepalaCheck(ci: CoreInput, allocs: CoreAlloc[], rujuk: RujukReason[]) {
  if (ci.sw.substitutionCap !== "per_kepala" || ci.slots.length === 0) return;
  const living = allocs
    .filter((a) => !a.holder.isSlot && (a.holder.role === "anak_lk" || a.holder.role === "anak_pr"))
    .map((a) => ({ sex: a.holder.sex, share: a.share }));
  for (const a of allocs) {
    if (!a.holder.isSlot) continue;
    const W = a.holder.members.reduce((acc, m) => acc + memberWeight(m.sex), B0);
    const memberShares = a.holder.members.map((m) => mul(a.share, frac(memberWeight(m.sex), W)));
    if (perKepalaBinds(memberShares, a.holder.sex, living) && !rujuk.includes("pengganti_batas_tak_jelas")) {
      rujuk.push("pengganti_batas_tak_jelas");
    }
  }
}

