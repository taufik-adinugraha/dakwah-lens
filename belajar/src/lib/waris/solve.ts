/**
 * solve(input, ruleset) → Result (engine.md §1; plan §7.1). Pure and deterministic: no I/O, no
 * Date, no randomness, no network; exact rationals only.
 *
 *   scope check → eligibility → KHI substitution → hajb → special cases → furudh → 'asabah →
 *   asal masalah + 'aul → radd / dzawil arham / Baitul Mal / "sisa: konsultasikan" →
 *   wasiat + wasiat wajibah lines → whole units per person → fractions → % → Rp
 *
 * AI-assisted, not an authoritative fatwa. Every disputed point is a named switch (registry.ts).
 */
import { tanzil } from "./adjust";
import { solveCore } from "./core";
import { finalBaseOf, largestRemainder, type LRLine } from "./distribute";
import { estateStage, voluntaryWasiat } from "./estate";
import { beyondExcludedBy, deriveFamily, type Derived, type WwCandidate } from "./family";
import {
  B0,
  ONE,
  THIRD,
  ZERO,
  add,
  div,
  eq,
  frac,
  gt,
  isZero,
  min,
  mul,
  sub,
  sum,
  toStr,
  floorTimes,
  lcm,
  type Frac,
} from "./frac";
import {
  DEFAULT_PROFILE,
  KERABAT_JAUH_ROLE,
  PROFILES,
  RUJUK_REASONS,
  resolveRuleset,
  roleRank,
  withSwitch,
  type NoteId,
  type RujukReason,
  type Ruleset,
  type SwitchName,
} from "./registry";
import { memberWeight } from "./substitution";
import type {
  BlockedGroup,
  CoreOut,
  FamilyInput,
  Hasil,
  Line,
  Person,
  PersonShare,
  Result,
  Rujuk,
  Sex,
  ShareGroup,
  TraceStep,
  WarisInput,
} from "./types";
import { EngineInvariantError } from "./adjust";

export function solve(input: WarisInput, ruleset: string | Ruleset = DEFAULT_PROFILE): Result {
  const rs = resolveRuleset(ruleset);
  const r = solveOnce(input, rs);
  if (r.kind === "hasil") r.switchesUsed = computeSwitchesUsed(input, rs, r);
  return r;
}

function rujuk(rs: Ruleset, reasons: readonly RujukReason[], notes: Iterable<NoteId> = [], trace: TraceStep[] = []): Rujuk {
  const uniqueReasons = RUJUK_REASONS.filter((r) => reasons.includes(r));
  return {
    kind: "rujuk",
    ruleset: rs.id,
    reasons: uniqueReasons,
    notes: [...new Set(notes)],
    trace: [...trace, ...uniqueReasons.map((r) => ({ rule: `rujuk.${r}` as const, heirs: [] }))],
  };
}

interface PersonAlloc {
  personId: string;
  role: string;
  sex: Sex;
  share: Frac;
  rule: Hasil["shares"][number]["rule"];
}

/** Expand holder allocations to persons (a KHI slot passes its share down 2 : 1). */
function expand(core: CoreOut): PersonAlloc[] {
  const out: PersonAlloc[] = [];
  for (const a of core.allocs) {
    if (!a.holder.isSlot) {
      out.push({ personId: a.holder.id, role: a.holder.role, sex: a.holder.sex, share: a.share, rule: a.rule });
      continue;
    }
    let W = B0;
    for (const m of a.holder.members) W += memberWeight(m.sex);
    for (const m of a.holder.members) {
      out.push({ personId: m.personId, role: a.holder.role, sex: m.sex, share: mul(a.share, frac(memberWeight(m.sex), W)), rule: a.rule });
    }
  }
  return out;
}

const WW_OFF = { wasiatWajibahAdopsi: "off", wasiatWajibahNonMuslim: "off" } as const;

/** Run derive + core on a modified family (the as-if solves of §11.4). */
function asIfCore(fam: FamilyInput, rs: Ruleset): { d: Derived; core: CoreOut } | { reasons: RujukReason[] } {
  const sw = { ...rs.switches, ...WW_OFF };
  const d = deriveFamily(fam, sw);
  if (d.rujuk.length > 0) return { reasons: d.rujuk };
  const core = solveCore({ deceasedSex: fam.deceased.sex, sw, roles: d.roles, slots: d.slots });
  if (core.rujuk.length > 0) return { reasons: core.rujuk };
  return { d, core };
}

function findPerson(fam: FamilyInput, id: string): Person | undefined {
  const all: Person[] = [];
  const walk = (p: Person | undefined) => {
    if (!p) return;
    all.push(p);
    for (const c of p.children ?? []) walk(c);
  };
  for (const p of [
    ...fam.spouses,
    ...fam.children,
    fam.father,
    fam.mother,
    fam.paternalGrandfather,
    fam.paternalGrandmother,
    fam.maternalGrandmother,
    fam.maternalGrandfather,
    ...fam.siblings,
    ...fam.paternalUncles,
    ...(fam.otherRelatives ?? []).map((o) => o.person),
    ...(fam.adoptedChildren ?? []),
    ...(fam.adoptiveParents ?? []),
    ...(fam.stepChildren ?? []),
  ])
    walk(p);
  return all.find((p) => p.id === id);
}

/**
 * A deep copy of a family for the as-if solves. FamilyInput is plain data (strings, booleans,
 * arrays; amounts live in EstateInput), so a JSON round-trip is exact and needs no
 * structuredClone (older Android browsers, plan §5 senior audience).
 */
function cloneFamily(fam: FamilyInput): FamilyInput {
  return JSON.parse(JSON.stringify(fam)) as FamilyInput;
}

/** KHI 209: the share an adopted child (or adoptive parent) would get as a child (parent) of the same sex. */
function adoptionAsIf(fam: FamilyInput, c: WwCandidate, rs: Ruleset): Frac | null {
  const copy = cloneFamily(fam);
  const me: Person = { id: c.personId, sex: c.sex, alive: true, religion: "islam" };
  if (c.kind === "anak_angkat") {
    copy.adoptedChildren = (copy.adoptedChildren ?? []).filter((a) => a.id !== c.personId);
    copy.children = [...copy.children, me];
  } else {
    copy.adoptiveParents = (copy.adoptiveParents ?? []).filter((a) => a.id !== c.personId);
    if (c.role === "ayah") {
      if (copy.father?.alive) return null;
      copy.father = me;
    } else {
      if (copy.mother?.alive) return null;
      copy.mother = me;
    }
  }
  const v = asIfCore(copy, rs);
  if ("reasons" in v) return null;
  return expand(v.core).find((p) => p.personId === c.personId)?.share ?? ZERO;
}

export function solveOnce(input: WarisInput, rs: Ruleset): Result {
  const fam = input.family;
  const sw = rs.switches;
  const notes = new Set<NoteId>();
  const trace: TraceStep[] = [];

  // 0. scope (engine.md §13): refusals in both columns
  if (fam.deceased.religion !== "islam") return rujuk(rs, ["beda_agama_pewaris"]);
  if ((fam.outOfScope ?? []).length > 0) return rujuk(rs, fam.outOfScope as RujukReason[]);

  // 2–3. eligibility, KHI substitution, derived classical view
  const d = deriveFamily(fam, sw);
  for (const x of d.notes) notes.add(x);
  if (d.rujuk.length > 0) return rujuk(rs, d.rujuk, notes);
  // every mawani' exclusion is a trace step, so the report's "Dasar hukum" carries its dalil
  // (architecture.md §7.2 item 6; plan §7.1 "every step emits rule ids")
  for (const g of d.ineligible) trace.push({ rule: g.rule, heirs: [g.heir], facts: { alasan: g.reason } });
  const blockedExtra: BlockedGroup[] = [];
  for (const b of d.beyond) {
    const by = beyondExcludedBy(b, d);
    if (!by) return rujuk(rs, ["kerabat_jauh"], notes);
    const g = blockedExtra.find((x) => x.by[0] === by);
    if (g) g.personIds.push(b.personId);
    else blockedExtra.push({ heir: KERABAT_JAUH_ROLE, personIds: [b.personId], by: [by], rule: "hajb.hirman" });
  }
  if ((fam.stepChildren ?? []).some((s) => s.alive) && sw.wasiatWajibahAdopsi !== "off") notes.add("anak_tiri_wasiat_wajibah");
  if ((input.estate?.hibahToChildren ?? []).length > 0) notes.add("hibah_dapat_diperhitungkan");

  // 1. estate
  const est = estateStage(input.estate, d.spouses, sw);
  if ("rujuk" in est) return rujuk(rs, est.rujuk, notes);
  trace.push(...est.trace);
  for (const x of est.notes) notes.add(x);

  // 4–9. the fara'id core
  const core = solveCore({ deceasedSex: fam.deceased.sex, sw, roles: d.roles, slots: d.slots });
  if (core.rujuk.length > 0) return rujuk(rs, core.rujuk, notes, core.trace);
  trace.push(...core.trace);
  for (const x of core.notes) notes.add(x);
  let personAllocs = expand(core);
  let adjustments = [...core.adjustments];
  let specialCase = core.specialCase;
  const coreTraceAt = trace.length - core.trace.length;
  let baitulMal = core.baitulMal;
  let sisaDirujuk = core.sisaDirujuk;
  const blocked: BlockedGroup[] = [...core.blocked, ...blockedExtra];
  let virtualHeirs: Hasil["virtualHeirs"];
  let base = core.base;
  // §9.3: the table before tashih, and the per-person lcm it is compared with (tableFinal = the
  // fara'id finalBase, except on the as-if path, whose table includes the wasiat-wajibah share)
  let tableBase = core.tableBase;
  let tableFinal: bigint | undefined;

  // §9.4 / §10: open residue → dzawil arham (tanzil), "sisa: konsultasikan", or no heir at all
  if (gt(core.residueOpen, ZERO)) {
    if (d.dzawil.length > 0) {
      if (sw.dzawilArham !== "tanzil") return rujuk(rs, ["dzawil_arham"], notes);
      const spouseTotal = sum(core.allocs.map((a) => a.share));
      const t = tanzil(d.dzawil, sub(ONE, spouseTotal), fam.deceased.sex, sw, solveCore);
      if (t.kind === "rujuk") return rujuk(rs, t.reasons, notes);
      for (const p of d.dzawil) {
        const s = t.personShares.get(p.personId);
        if (s && !isZero(s)) personAllocs.push({ personId: p.personId, role: p.relation, sex: p.sex, share: s, rule: "dzawil_arham.tanzil" });
      }
      for (const b of t.blocked) pushBlocked(blocked, b.relation, b.personId, b.byWasith.map((w) => `wasith:${w}`), "hajb.hirman");
      virtualHeirs = t.virtualHeirs;
      trace.push(...t.trace);
      // the virtual problem's 'aul / radd adjust the dzawil shares too: trace them, marked as steps
      // of the wasith problem (their heirs are the wasith positions, not living relatives)
      for (const st of t.core.trace) {
        if (st.rule === "aul" || st.rule === "radd.tanpa_pasangan" || st.rule === "radd.semua") trace.push({ ...st, facts: { ...(st.facts ?? {}), masalah: "tanzil" } });
      }
      for (const a of t.core.adjustments) if (!adjustments.includes(a)) adjustments.push(a);
      if (core.allocs.length === 0) {
        base = t.core.base;
        tableBase = t.core.tableBase;
      } else {
        // the spouse's fardh, then each wasith's line as one group (EQ11: the spouse-present
        // tanzil table is not in an opened source; this is the plain lcm of those group shares)
        const byWasith = new Map<string, Frac>();
        for (const p of d.dzawil) {
          const s = t.personShares.get(p.personId);
          if (s && !isZero(s)) byWasith.set(p.wasithKey, add(byWasith.get(p.wasithKey) ?? ZERO, s));
        }
        tableBase = finalBaseOf([sum(core.allocs.map((a) => a.share)), ...byWasith.values()]);
      }
    } else if (core.allocs.length > 0) {
      sisaDirujuk = core.residueOpen;
      notes.add("sisa_pasangan_saja");
      trace.push({ rule: "catatan.sisa_pasangan_saja", heirs: core.allocs.map((a) => a.holder.role) });
    }
  } else if (d.dzawil.length > 0) {
    const inheritors = [...new Set(core.allocs.filter((a) => a.holder.role !== "suami" && a.holder.role !== "istri").map((a) => a.holder.role))];
    const by = gt(baitulMal, ZERO) ? ["baitul_mal"] : inheritors;
    for (const p of d.dzawil) pushBlocked(blocked, p.relation, p.personId, by, "hajb.hirman");
  }
  // exclusions decided outside the core (relatives beyond the depth limit, dzawil arham): one
  // step per group, in the core's hajb-step shape
  for (const b of blocked.slice(core.blocked.length)) trace.push(exclusionStep(b));
  // Court-discretion notes (§11.4 c) follow the KHI wasiat-wajibah layer: nieces and other
  // nephews may get a wasiat wajibah set by the court (SEMA 3/2015; 137 K/AG/2016), never computed.
  if (sw.wasiatWajibahAdopsi !== "off" && d.dzawil.some((p) => p.relation.includes("_sdr_"))) notes.add("wasiat_wajibah_keponakan");

  // §11.4 a) adopted child / adoptive parent (KHI 209): ceiling ⅓, taken off first
  const consent = input.estate?.heirsConsentToExcessWasiat === true;
  let wwAdopsi: { key: string; personId: string; frac: Frac }[] = [];
  if (sw.wasiatWajibahAdopsi === "plafon") {
    for (const c of d.ww.filter((w) => w.kind !== "non_muslim")) {
      const asIf = adoptionAsIf(fam, c, rs);
      if (asIf === null) {
        notes.add("ww_orang_tua_angkat_tidak_dihitung");
        continue;
      }
      if (!isZero(asIf)) wwAdopsi.push({ key: `wasiat_wajibah:${c.key}`, personId: c.personId, frac: min(asIf, THIRD) });
    }
    const tot = sum(wwAdopsi.map((x) => x.frac));
    if (gt(tot, THIRD)) wwAdopsi = wwAdopsi.map((x) => ({ ...x, frac: mul(x.frac, div(THIRD, tot)) }));
    if (wwAdopsi.length > 0) {
      notes.add("wasiat_wajibah_plafon");
      trace.push({ rule: "khi.ww_anak_angkat", heirs: wwAdopsi.map((x) => x.key) });
      trace.push({ rule: "estate.wasiat_wajibah", heirs: wwAdopsi.map((x) => x.key) });
    }
  }
  const aTot = sum(wwAdopsi.map((x) => x.frac));

  // voluntary wasiat (cap ⅓ minus the wasiat wajibah: EQ5 "combined cap, wasiat wajibah first")
  const vol = voluntaryWasiat(input.estate, est.afterDebts, sub(THIRD, aTot), sub(ONE, aTot));
  trace.push(...vol.trace);
  for (const x of vol.notes) notes.add(x);
  const vTot = sum(vol.lines.map((w) => w.frac));
  const rest = sub(sub(ONE, aTot), vTot);

  // §11.4 b) non-Muslim spouse / child / parent
  let nm: { key: string; personId: string; frac: Frac }[] = [];
  let lineShare = (p: PersonAlloc): Frac => mul(rest, p.share);
  let faraidShare = (p: PersonAlloc): Frac => p.share;
  let residueLine = (x: Frac): Frac => mul(rest, x);
  let residueFaraid = (x: Frac): Frac => x;
  const nmCands = d.ww.filter((w) => w.kind === "non_muslim");
  if (nmCands.length > 0 && sw.wasiatWajibahNonMuslim !== "off") {
    const copy = cloneFamily(fam);
    for (const c of nmCands) {
      const p = findPerson(copy, c.personId);
      if (p) {
        p.religion = "islam";
        p.bars = (p.bars ?? []).filter((b) => b !== "murtad");
      }
    }
    const v = asIfCore(copy, rs);
    if ("reasons" in v) return rujuk(rs, v.reasons, notes);
    const vAllocs = expand(v.core);
    const vShare = new Map(vAllocs.map((p) => [p.personId, p.share]));
    // refuse (court column only) if the as-if solve excludes an actual heir …
    for (const p of personAllocs) if (!gt(vShare.get(p.personId) ?? ZERO, ZERO)) return rujuk(rs, ["wasiat_wajibah_besar"], notes);
    const wwShares = nmCands.map((c) => ({ c, s: vShare.get(c.personId) ?? ZERO })).filter((x) => !isZero(x.s));
    const w = sum(wwShares.map((x) => x.s));
    // … or the as-if share is over ⅓, or (without consent) the bequests together exceed ⅓
    if (gt(w, THIRD)) return rujuk(rs, ["wasiat_wajibah_besar"], notes);
    if (!consent && gt(add(add(aTot, vTot), mul(w, rest)), THIRD)) return rujuk(rs, ["wasiat_wajibah_besar"], notes);
    nm = wwShares.map((x) => ({ key: `wasiat_wajibah:${x.c.key}`, personId: x.c.personId, frac: mul(rest, x.s) }));
    if (nm.length > 0) {
      trace.push({ rule: "khi.ww_non_muslim", heirs: nm.map((x) => x.key) });
      trace.push({ rule: "estate.wasiat_wajibah", heirs: nm.map((x) => x.key) });
      if (sw.wasiatWajibahNonMuslim === "ma_16K2010") {
        // as-if (16 K/AG/2010, 51 K/Ag/1999): every actual heir keeps their as-if share
        notes.add("wasiat_wajibah_ilustrasi");
        const oneMinusW = sub(ONE, w);
        // the heirs' shares, rules, special case, adjustments and trace now come from the as-if solve
        const vRule = new Map(vAllocs.map((p) => [p.personId, p.rule]));
        personAllocs = personAllocs.map((p) => ({ ...p, share: vShare.get(p.personId) ?? ZERO, rule: vRule.get(p.personId) ?? p.rule }));
        specialCase = v.core.specialCase;
        adjustments = [...v.core.adjustments];
        // the shares follow the as-if solve, but every exclusion stays the REAL one (`blocked` is the
        // real solve's): an ineligible relative neither blocks nor reduces anyone (eligibility.ts),
        // so the as-if solve's own hajb steps (which may name the non-Muslim relative) are dropped
        trace.splice(coreTraceAt, core.trace.length, ...core.blocked.map(exclusionStep), ...v.core.trace.filter((t) => !EXCLUSION_RULES.has(t.rule)));
        tableBase = v.core.tableBase;
        tableFinal = finalBaseOf([...vAllocs.map((p) => p.share), v.core.baitulMal, v.core.residueOpen, v.core.sisaDirujuk]);
        for (const x of v.core.notes) notes.add(x);
        // In the as-if solve a non-Muslim child counts as "the heir of the replaced child's
        // degree", so a KHI-185 slot may lose its 185(2) re-weighting and end above every ACTUAL
        // child. No source settles that interaction: refuse the court column (§13).
        if (capBroken(personAllocs, sw.substitutionCap)) return rujuk(rs, ["pengganti_batas_tak_jelas"], notes);
        lineShare = (p) => mul(rest, p.share);
        faraidShare = (p) => div(p.share, oneMinusW);
        baitulMal = v.core.baitulMal;
        // a spouse-only as-if family leaves its residue open, exactly like the real solve did
        // (any dzawil arham would already have refused the court column above)
        sisaDirujuk = gt(v.core.residueOpen, ZERO) ? v.core.residueOpen : v.core.sisaDirujuk;
        residueLine = (x) => mul(rest, x);
        residueFaraid = (x) => div(x, oneMinusW);
        base = v.core.base;
      } else {
        // plafon (comparison): the as-if share is taken off first, the rest divided by fara'id
        notes.add("wasiat_wajibah_plafon");
        const left = sub(rest, sum(nm.map((x) => x.frac)));
        lineShare = (p) => mul(left, p.share);
        residueLine = (x) => mul(left, x);
      }
    }
  } else if (nmCands.length > 0) {
    notes.add("kerabat_non_muslim");
  }

  if (personAllocs.length === 0 && isZero(baitulMal)) return rujuk(rs, ["tanpa_ahli_waris"], notes);

  // Compose the fara'id view (shares) and the after-debts view (lines).
  const keys = d.keys;
  const personShares: (PersonShare & { role: string; rule: PersonAlloc["rule"] })[] = personAllocs.map((p) => ({
    personId: p.personId,
    key: keys.get(p.personId) ?? p.role,
    sex: p.sex,
    share: faraidShare(p),
    line: lineShare(p),
    role: p.role,
    rule: p.rule,
  }));
  const bmF = residueFaraid(baitulMal);
  const sisaF = residueFaraid(sisaDirujuk);
  const faraidTotal = add(add(sum(personShares.map((p) => p.share)), bmF), sisaF);
  if (!eq(faraidTotal, ONE)) throw new EngineInvariantError(`fara'id shares sum to ${toStr(faraidTotal)}, not 1`);

  const lines: Line[] = [];
  for (const w of vol.lines) lines.push({ key: w.key, kind: "wasiat", frac: w.frac, personIds: [] });
  for (const x of [...wwAdopsi, ...nm]) lines.push({ key: x.key, kind: "wasiat_wajibah", frac: x.frac, personIds: [x.personId] });
  const groupsOrder: string[] = [];
  const byRole = new Map<string, typeof personShares>();
  for (const p of personShares) {
    if (!byRole.has(p.role)) groupsOrder.push(p.role);
    byRole.set(p.role, [...(byRole.get(p.role) ?? []), p]);
  }
  groupsOrder.sort((a, b) => roleRank(a) - roleRank(b));
  for (const role of groupsOrder) {
    const ps = byRole.get(role) ?? [];
    lines.push({ key: role, kind: "heir", frac: sum(ps.map((p) => p.line)), personIds: ps.map((p) => p.personId) });
  }
  if (!isZero(baitulMal)) lines.push({ key: "baitul_mal", kind: "baitul_mal", frac: residueLine(baitulMal), personIds: [] });
  if (!isZero(sisaDirujuk)) lines.push({ key: "sisa_dirujuk", kind: "sisa_dirujuk", frac: residueLine(sisaDirujuk), personIds: [] });
  const linesTotal = sum(lines.map((l) => l.frac));
  if (!eq(linesTotal, ONE)) throw new EngineInvariantError(`lines sum to ${toStr(linesTotal)}, not 1`);

  // §9.3 whole units per person: T0 = the classical table (asal masalah, after 'aul or radd); tashih
  // multiplies it until every person's portion is whole, T1 = lcm(T0, T2); ikhtisar divides T1 by
  // the common factor of all portions, down to T2 = the smallest whole table (finalBase). Per-person
  // units give the same multiplier as the per-group form of engine.md §9.3 (2 : 1 inside a group).
  const finalBase = finalBaseOf([...personShares.map((p) => p.share), bmF, sisaF]);
  const t2 = tableFinal ?? finalBase;
  const t1 = lcm(tableBase, t2);
  if (t1 > tableBase) trace.push({ rule: "tashih", heirs: [], facts: { dari: tableBase.toString(), menjadi: t1.toString() } });
  if (t2 < t1) trace.push({ rule: "ikhtisar", heirs: [], facts: { dari: t1.toString(), menjadi: t2.toString() } });

  // §14 rupiah
  let rupiah: Record<string, bigint> | undefined;
  if (est.hasAmounts && est.rupiahOk && est.afterDebts > B0) {
    rupiah = {};
    for (const [k, v] of Object.entries(est.hartaBersamaSpouse)) rupiah[`harta_bersama:${k}`] = v;
    if (est.biayaSakit > B0) rupiah.biayaSakit = est.biayaSakit;
    if (est.biayaJenazah > B0) rupiah.biayaJenazah = est.biayaJenazah;
    if (est.utang > B0) rupiah.utang = est.utang;
    const lr: LRLine[] = [];
    for (const l of lines) {
      if (l.kind === "heir") continue;
      if (!isZero(l.frac)) lr.push({ key: l.key, frac: l.frac, rank: roleRank(l.key) });
    }
    for (const role of groupsOrder) for (const p of byRole.get(role) ?? []) if (!isZero(p.line)) lr.push({ key: p.key, frac: p.line, rank: roleRank(role) });
    const T = est.afterDebts;
    const alloc = largestRemainder(T, lr);
    for (const [k, v] of alloc) rupiah[k] = v;
    for (const p of personShares) p.rupiah = alloc.get(p.key) ?? B0;
    if (lr.some((l) => floorTimes(T, l.frac).r !== B0)) trace.push({ rule: "rupiah.pembulatan", heirs: [] });
  }

  const shares: ShareGroup[] = groupsOrder.map((role) => {
    const ps = byRole.get(role) ?? [];
    const group = sum(ps.map((p) => p.share));
    const perHead = ps.every((p) => eq(p.share, ps[0].share)) ? ps[0].share : undefined;
    const units = mul(group, frac(finalBase));
    if (units.d !== BigInt(1)) throw new EngineInvariantError(`units of ${role} are not whole at base ${finalBase}`);
    return {
      heir: role,
      count: ps.length,
      group,
      line: sum(ps.map((p) => p.line)),
      ...(perHead ? { perHead } : {}),
      persons: ps.map((p) => ({ personId: p.personId, key: p.key, sex: p.sex, share: p.share, line: p.line, ...(p.rupiah !== undefined ? { rupiah: p.rupiah } : {}) })),
      rule: ps[0].rule,
      units: units.n,
    };
  });

  return {
    kind: "hasil",
    ruleset: rs.id,
    shares,
    residue: { baitulMal: bmF, sisaDirujuk: sisaF },
    lines,
    blocked,
    ineligible: d.ineligible,
    adjustments,
    ...(specialCase ? { specialCase } : {}),
    base,
    finalBase,
    ...(virtualHeirs ? { virtualHeirs } : {}),
    ...(rupiah ? { rupiah } : {}),
    ...(est.hasAmounts
      ? {
          estate: {
            hartaBersamaSpouse: est.hartaBersamaSpouse,
            grossOwn: est.grossOwn,
            biayaSakit: est.biayaSakit,
            biayaJenazah: est.biayaJenazah,
            utang: est.utang,
            afterDebts: est.afterDebts,
          },
        }
      : {}),
    notes: [...notes],
    trace,
    switchesUsed: [],
  };
}

/** KHI 185(2): a slot (sederajat) or a substitute person (per_kepala) above every living child. */
function capBroken(allocs: readonly PersonAlloc[], cap: Ruleset["switches"]["substitutionCap"]): boolean {
  if (cap === "none") return false;
  const living = allocs.filter((p) => p.role === "anak_lk" || p.role === "anak_pr");
  if (living.length === 0) return false;
  let max = living[0].share;
  for (const p of living) if (gt(p.share, max)) max = p.share;
  const slots = new Map<string, Frac>();
  for (const p of allocs) {
    if (!p.role.startsWith("pengganti_")) continue;
    if (cap === "per_kepala" && gt(p.share, max)) return true;
    slots.set(p.role, add(slots.get(p.role) ?? ZERO, p.share));
  }
  return cap === "sederajat" && [...slots.values()].some((s) => gt(s, max));
}

/** Rules of the core's exclusion steps (hajb.ts, core.ts istighraq). */
const EXCLUSION_RULES: ReadonlySet<string> = new Set(["hajb.hirman", "khi.anak_menghijab_saudara", "hajb.istighraq"]);

/** One trace step for one blocked group, in the shape core.ts gives its hajb steps. */
function exclusionStep(b: BlockedGroup): TraceStep {
  return { rule: b.rule, heirs: [b.heir], facts: { oleh: b.by.join(",") } };
}

function pushBlocked(blocked: BlockedGroup[], heir: string, personId: string, by: string[], rule: BlockedGroup["rule"]) {
  const g = blocked.find((b) => b.heir === heir && b.rule === rule);
  if (g) {
    g.personIds.push(personId);
    for (const x of by) if (!g.by.includes(x)) g.by.push(x);
  } else blocked.push({ heir, personIds: [personId], by: [...by], rule });
}

/** A canonical signature of what a family receives (for switchesUsed). */
export function resultSignature(r: Result): string {
  if (r.kind === "rujuk") return `rujuk:${r.reasons.join(",")}`;
  const parts = r.lines.map((l) => `${l.key}=${toStr(l.frac)}`);
  for (const g of r.shares) for (const p of g.persons) parts.push(`${p.personId}=${toStr(p.line)}`);
  return parts.sort().join(";");
}

/**
 * Switches whose klasik-syafii value would change a share: re-solve with each differing switch set
 * to its fikih value (engine.md §12.1; architecture §5.3). Empty for the fikih column itself.
 */
export function computeSwitchesUsed(input: WarisInput, rs: Ruleset, r: Hasil): SwitchName[] {
  const klasik = PROFILES["klasik-syafii"];
  const sig = resultSignature(r);
  const out: SwitchName[] = [];
  for (const k of Object.keys(rs.switches) as SwitchName[]) {
    if (rs.switches[k] === klasik[k]) continue;
    const alt = solveOnce(input, withSwitch(rs, k, klasik[k] as never));
    if (resultSignature(alt) !== sig) out.push(k);
  }
  return out;
}

