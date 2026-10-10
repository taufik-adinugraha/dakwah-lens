/**
 * Questionnaire gates (plan §10 M2.1–M2.4, M2.5 model side, M2.12 model side; architecture.md
 * §6.6). Plain TypeScript, no vitest import: the vitest wrapper and scripts/waris-q-check.ts run
 * exactly the same functions.
 *
 *  M2.1 runCompleteness  — seeded oracle families: answering ONLY the questions the tool asked
 *                          gives the same result as the full family, in both report columns
 *                          (after the v1 policies) and under every comparison ruleset; exits
 *                          (E-BUNUH, beyond depth, dzawil arham, no heir, …) must match; a
 *                          questionnaire result where the full family refuses is a failure.
 *       runUnknowns      — one «Tidak tahu» per family: the reading that holds the true answer
 *                          gives the true outcome; a «Tidak tahu» that changes the division is
 *                          never collapsed into one number (checked by re-evaluating each reading).
 *  M2.2 runTermination   — random answers with random Kembali / Ubah: no question twice on a
 *                          path, every path ends at the review screen or an exit, k6 never stored.
 *  M2.3 runPathLengths   — the five common families of §5.5 (≤ 12 screens, 13 with a wasiat) and
 *                          the rarer families, counted.
 *  M2.4 runRefusalRouting— each A3 option, engine reason and per-column refusal reaches its page;
 *                          a court-only refusal still shows the fikih column; refused columns
 *                          carry no numbers.
 *       runCodecChecks   — round trip, rupiah only when ticked, malformed tokens never throw.
 *       runTextChecks    — every key the views hand out exists; no bare QS/HR, no Arabic, no
 *                          review promise, no ALL-CAPS emphasis; every "why" is a rule id.
 */
import { isRuleId, RUJUK_REASONS, HEIRS, type RujukReason, type Sex } from "../registry";
import { solveOnce } from "../solve";
import type { FamilyInput, Person, Result, SiblingPerson, UnclePerson, WarisInput } from "../types";
import { RELEVANCE_RULESETS, applyPolicy, fullSig } from "../questionnaire/build";
import { decode, encodeEff, answerCodeOf, tokenFromHash, fragmentFor, MAX_TOKEN_LENGTH } from "../questionnaire/codec";
import { A3_UI_OPTIONS, EXITS, NODE, NODES, KILLER_OPTION, type A3UiOption } from "../questionnaire/graph";
import {
  a3Route,
  evaluate,
  exitFor,
  initialState,
  nodeView,
  parseKey,
  reduce,
  scenarioNodes,
  screenCount,
  view,
  walk,
  HAS_HELP,
} from "../questionnaire/machine";
import { Q_TEXT, isQTextKey } from "../questionnaire/text";
import { EXIT_IDS, Q_NOTES, SECTIONS, TIDAK_TAHU, type Amounts, type AnswerValue, type Answers, type Evaluation, type QKey, type QState } from "../questionnaire/types";
import { expected, oracleAnswer, randomTrueFamily, type TrueFamily } from "./questionnaire-gen";
import { Rng } from "./prng";

export const Q_DEFAULT_SEED = 20261010;

// ---------------------------------------------------------------------------------------------
// Driving the questionnaire with the oracle (through the reducer, as the UI does)
// ---------------------------------------------------------------------------------------------

export interface Driven {
  state: QState;
  /** A3 k6 was ticked: routed to E-BUNUH before any dispatch. */
  bunuh: boolean;
  /** Node keys in the order they were asked. */
  asked: QKey[];
  error?: string;
}

const STEP_LIMIT = 120;

export function drive(t: TrueFamily, unknownAt?: QKey): Driven {
  let s = initialState();
  const asked: QKey[] = [];
  for (let n = 0; n < STEP_LIMIT; n++) {
    const w = walk(s.answers);
    if (w.exit || !w.cursor) return { state: s, bunuh: false, asked };
    const c = w.cursor;
    if (c.id === "A1s") {
      s = reduce(s, { type: "lanjut_simulasi" });
      continue;
    }
    if (asked.includes(c.key)) return { state: s, bunuh: false, asked, error: `asked ${c.key} twice` };
    asked.push(c.key);
    let value: AnswerValue;
    if (unknownAt === c.key && NODE[c.id].unknown) value = TIDAK_TAHU;
    else if (c.id === "A3") {
      const sel = oracleAnswer(t, c.id, c.i, c.options, w.eff) as readonly string[];
      const ui = [...sel, ...(t.killer ? [KILLER_OPTION] : [])] as A3UiOption[];
      const routed = a3Route(ui);
      if (routed.kind === "bunuh") return { state: s, bunuh: true, asked };
      value = routed.value;
    } else value = oracleAnswer(t, c.id, c.i, c.options, w.eff);
    const next = reduce(s, { type: "jawab", key: c.key, value });
    if (next === s) return { state: s, bunuh: false, asked, error: `reducer refused the oracle's answer ${JSON.stringify(value)} at ${c.key} (options ${c.options.join("|")})` };
    s = next;
  }
  return { state: s, bunuh: false, asked, error: "no termination" };
}

/** The questionnaire's outcome in the same terms as expected(). */
type QOutcome = { kind: "exit"; exit: string } | { kind: "report"; fikih: string; court: string; input: WarisInput; perlu: boolean };

function qOutcome(d: Driven, amounts?: Amounts): { o: QOutcome; e: Evaluation | null } {
  if (d.bunuh) return { o: { kind: "exit", exit: "E-BUNUH" }, e: null };
  const e = evaluate(d.state.answers, amounts);
  if (e.kind === "keluar") return { o: { kind: "exit", exit: e.exit.id }, e };
  if (e.kind === "belum_selesai") return { o: { kind: "exit", exit: `belum_selesai:${e.next}` }, e };
  return { o: { kind: "report", fikih: fullSig(e.utama.fikih.result), court: fullSig(e.utama.pengadilan.result), input: e.utama.input, perlu: e.perluDipastikan !== null }, e };
}

/** Exits the questionnaire may take where the full family computes (documented over-refusal). */
const ALLOWED_OVER_REFUSAL: ReadonlySet<string> = new Set(["E-MAFQUD", "E-HAML", "E-BERSAMAAN"]);

function rulesetSig(input: WarisInput, rs: (typeof RELEVANCE_RULESETS)[number]): string {
  return fullSig(applyPolicy(solveOnce(input, rs), rs).result);
}

// ---------------------------------------------------------------------------------------------
// M2.1 completeness
// ---------------------------------------------------------------------------------------------

export interface CompletenessReport {
  seed: number;
  families: number;
  /** Families that reached a report, compared under each ruleset. */
  comparedByRuleset: Record<string, number>;
  /** Exits that matched the full family's refusal, by exit id. */
  exits: Record<string, number>;
  /** Documented over-refusals (k3–k5 decided by the conservative couldAffectOutcome). */
  overRefusals: Record<string, number>;
  screens: { max: number; total: number };
  failures: { index: number; kind: string; message: string; family?: TrueFamily }[];
}

export function runCompleteness(opts: { count: number; seed: number; maxFailures?: number }): CompletenessReport {
  const rng = new Rng(opts.seed);
  const rep: CompletenessReport = { seed: opts.seed, families: opts.count, comparedByRuleset: {}, exits: {}, overRefusals: {}, screens: { max: 0, total: 0 }, failures: [] };
  const fail = (index: number, kind: string, message: string, family?: TrueFamily) => rep.failures.push({ index, kind, message, family });
  // the named families first (index -1, -2, …), then the seeded random ones
  const named = COMPLETENESS_CASES.map((c, k) => ({ i: -1 - k, t: c.family }));
  for (let n = 0; n < named.length + opts.count && rep.failures.length < (opts.maxFailures ?? 30); n++) {
    const i = n < named.length ? named[n].i : n - named.length;
    const t = n < named.length ? named[n].t : randomTrueFamily(rng, i);
    let d: Driven;
    try {
      d = drive(t);
    } catch (err) {
      fail(i, "throws", (err as Error).stack ?? String(err), t);
      continue;
    }
    if (d.error) {
      fail(i, "drive", d.error, t);
      continue;
    }
    const sc = screenCount(d.state.answers);
    rep.screens.total += sc;
    if (sc > rep.screens.max) rep.screens.max = sc;
    const exp = expected(t);
    let got: ReturnType<typeof qOutcome>;
    try {
      got = qOutcome(d, t.amounts);
    } catch (err) {
      fail(i, "throws", (err as Error).stack ?? String(err), t);
      continue;
    }
    const q = got.o;
    if (exp.kind === "exit") {
      if (q.kind === "exit" && q.exit === exp.exit) rep.exits[q.exit] = (rep.exits[q.exit] ?? 0) + 1;
      // both refuse: the k3–k5 refusal is decided first (outOfScope), the full family names another reason
      else if (q.kind === "exit" && ALLOWED_OVER_REFUSAL.has(q.exit) && t.special) rep.overRefusals[`${q.exit} (also ${exp.exit})`] = (rep.overRefusals[`${q.exit} (also ${exp.exit})`] ?? 0) + 1;
      else fail(i, "exit", `full family → ${exp.exit}; questionnaire → ${q.kind === "exit" ? q.exit : "a report"}`, t);
      continue;
    }
    if (q.kind === "exit") {
      if (ALLOWED_OVER_REFUSAL.has(q.exit) && t.special) rep.overRefusals[q.exit] = (rep.overRefusals[q.exit] ?? 0) + 1;
      else fail(i, "over-refusal", `full family computes; questionnaire → ${q.exit}`, t);
      continue;
    }
    if (q.perlu) {
      fail(i, "perlu", "no «Tidak tahu» was answered, yet the report shows readings", t);
      continue;
    }
    if (q.fikih !== exp.fikih || q.court !== exp.court) {
      fail(i, "numbers", `fikih ${q.fikih === exp.fikih ? "same" : `\n  full: ${exp.fikih}\n  q:    ${q.fikih}`}\ncourt ${q.court === exp.court ? "same" : `\n  full: ${exp.court}\n  q:    ${q.court}`}`, t);
      continue;
    }
    // every ruleset, comparison variants included (plan M2.1 "per ruleset")
    const truthInput = t.input;
    for (const rs of RELEVANCE_RULESETS) {
      const a = rulesetSig(q.input, rs);
      const b = rulesetSig(truthInput, rs);
      if (a !== b) {
        fail(i, `ruleset ${rs.id}`, `\n  full: ${b}\n  q:    ${a}`, t);
        break;
      }
      rep.comparedByRuleset[rs.id] = (rep.comparedByRuleset[rs.id] ?? 0) + 1;
    }
  }
  return rep;
}

// ---------------------------------------------------------------------------------------------
// M2.1 «Tidak tahu»
// ---------------------------------------------------------------------------------------------

/** Nodes whose «Tidak tahu» has readings (A3a = all groups; B1b, G1, G3, G3w = notes only). */
const UNKNOWN_EXCLUDED: ReadonlySet<string> = new Set(["A3a", "B1b", "G1", "G3", "G3w"]);

export interface UnknownReport {
  seed: number;
  runs: number;
  /** The true answer was one of the readings, and its outcome matched. */
  exact: number;
  /** The «Tidak tahu» did not change the division (one report). */
  noEffect: number;
  /** Shown side by side ("Perlu dipastikan"). */
  sideBySide: number;
  /** Routed to E-TIDAK-TAHU (konsultasikan). */
  konsultasikan: number;
  /** The true answer is not one of the readings (e.g. three brothers; «2 or more» covers it). */
  unrepresentable: number;
  failures: { index: number; key: QKey; message: string }[];
}

function deepEq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sigOfEval(e: Evaluation): string {
  if (e.kind === "keluar") return `exit:${e.exit.id}`;
  if (e.kind === "belum_selesai") return `belum:${e.next}`;
  if (e.perluDipastikan) return `perlu:${e.perluDipastikan.key}`;
  return `${fullSig(e.utama.fikih.result)}||${fullSig(e.utama.pengadilan.result)}`;
}

/**
 * The overlay o (one concrete reading of a «Tidak tahu») stands for the true family when every
 * answer of the plain run is either set by o, answered the same in the «Tidak tahu» run, or a
 * follow-up the reading leaves at the builder's default (all Muslim; no earlier spouse).
 */
function representable(o: Answers, plainEff: Answers, ttEff: Answers): boolean {
  for (const [k, v] of Object.entries(plainEff)) {
    if (k in o) {
      if (!deepEq(o[k], v)) return false;
    } else if (k in ttEff) {
      if (!deepEq(ttEff[k], v)) return false;
    } else if (!isDefaultFollowUp(k, v, plainEff)) return false;
  }
  for (const [k, v] of Object.entries(o)) {
    if (k in plainEff) continue;
    const p = parseKey(k);
    const neutral = (p?.id === "C4b" && deepEq(v, [])) || (p?.id === "C4m" && v === "tidak");
    if (!neutral) return false;
  }
  return true;
}

function isDefaultFollowUp(k: QKey, v: AnswerValue, plain: Answers): boolean {
  const p = parseKey(k);
  if (!p) return false;
  const sameSet = (x: unknown, y: unknown) => Array.isArray(x) && Array.isArray(y) && x.length === y.length && x.every((e) => (y as unknown[]).includes(e));
  switch (p.id) {
    case "B3":
      return v === (plain.B1 === "ya_lebih" ? plain.B2 : 1);
    case "B1b":
      return v === "tidak";
    case "C1m":
    case "E1m":
    case "E2m":
    case "E3m":
      return deepEq(v, plain[p.id.slice(0, 2)]);
    case "C4gm":
      return deepEq(v, plain[`C4g.${p.i}`]);
    case "C4r":
      return v === "ya";
    case "D1m":
      return v === plain.D1;
    case "D3m":
      return sameSet(v, plain.D3);
    default:
      return false;
  }
}

export function runUnknowns(opts: { count: number; seed: number; maxFailures?: number }): UnknownReport {
  const rng = new Rng(opts.seed);
  const pick = new Rng(opts.seed ^ 0x2545f491);
  const rep: UnknownReport = { seed: opts.seed, runs: 0, exact: 0, noEffect: 0, sideBySide: 0, konsultasikan: 0, unrepresentable: 0, failures: [] };
  for (let i = 0; i < opts.count && rep.failures.length < (opts.maxFailures ?? 30); i++) {
    const t = randomTrueFamily(rng, i);
    if (t.killer || t.khuntsa || t.a1 === "wafat_nonmuslim") continue;
    const plain = drive(t);
    if (plain.error || plain.bunuh) continue;
    const candidates = walk(plain.state.answers).steps.filter((st) => NODE[st.id].unknown && !UNKNOWN_EXCLUDED.has(st.id));
    if (candidates.length === 0) continue;
    const st = pick.pick(candidates);
    const truth = plain.state.answers[st.key];
    const d = drive(t, st.key);
    rep.runs++;
    if (d.error) {
      rep.failures.push({ index: i, key: st.key, message: d.error });
      continue;
    }
    const e = evaluate(d.state.answers, t.amounts);
    const w = walk(d.state.answers);
    const node = scenarioNodes(w.eff, w.opts).find((n) => n.key === st.key);
    if (!node) {
      rep.failures.push({ index: i, key: st.key, message: "«Tidak tahu» has no readings" });
      continue;
    }
    // which reading holds the true answer (see representable())
    const plainEff = walk(plain.state.answers).eff;
    const ri = node.readings.findIndex((r) => r.overlays.some((o) => representable(o, plainEff, w.eff)));
    const exp = expected(t);
    const expSig = exp.kind === "exit" ? `exit:${exp.exit}` : `${exp.fikih}||${exp.court}`;
    if (e.kind === "belum_selesai") {
      rep.failures.push({ index: i, key: st.key, message: `incomplete after «Tidak tahu»: ${e.next}` });
      continue;
    }
    if (e.kind === "keluar" && e.exit.id === "E-TIDAK-TAHU") rep.konsultasikan++;
    else if (e.kind === "laporan" && e.perluDipastikan) rep.sideBySide++;
    else rep.noEffect++;

    // independent "never one likely number": evaluate each reading as concrete answers
    const concrete = node.readings.map((r) => r.overlays.map((o) => sigOfEval(evaluate({ ...d.state.answers, ...o }, t.amounts))));
    const all = new Set(concrete.flat().filter((x) => !x.startsWith("belum:")));
    if (all.size > 1 && e.kind === "laporan" && !e.perluDipastikan) {
      rep.failures.push({ index: i, key: st.key, message: `readings differ (${[...all].length} outcomes) but one report was shown` });
      continue;
    }
    if (ri < 0) {
      rep.unrepresentable++;
      continue;
    }
    // the reading that holds the truth must give the truth's outcome (when it gives one)
    if (e.kind === "keluar") {
      // a k3–k5 relative judged with this «Tidak tahu» left open: the conservative refusal is allowed
      const specialRefusal = t.special !== null && ALLOWED_OVER_REFUSAL.has(e.exit.id);
      if (e.exit.id !== "E-TIDAK-TAHU" && !specialRefusal && expSig !== `exit:${e.exit.id}`) rep.failures.push({ index: i, key: st.key, message: `exit ${e.exit.id}, full family ${expSig}` });
      else rep.exact++;
      continue;
    }
    const outcome = e.perluDipastikan ? e.perluDipastikan.alternatives[ri]?.outcome : e.utama;
    if (!outcome) {
      rep.failures.push({ index: i, key: st.key, message: `no outcome for reading ${ri}` });
      continue;
    }
    const got = `${fullSig(outcome.fikih.result)}||${fullSig(outcome.pengadilan.result)}`;
    if (got !== expSig) rep.failures.push({ index: i, key: st.key, message: `reading ${node.readings[ri].option}:\n  full: ${expSig}\n  q:    ${got}` });
    else rep.exact++;
  }
  return rep;
}

// ---------------------------------------------------------------------------------------------
// M2.2 termination (random answers, random Kembali / Ubah)
// ---------------------------------------------------------------------------------------------

export interface TerminationReport {
  seed: number;
  runs: number;
  maxSteps: number;
  endings: Record<string, number>;
  failures: { run: number; message: string }[];
}

function randomValue(rng: Rng, w: ReturnType<typeof walk>, key: QKey): AnswerValue | null {
  const nv = nodeView(w, key);
  if (!nv) return null;
  if (nv.allowUnknown && rng.chance(12)) return TIDAK_TAHU;
  const ids = nv.options.map((o) => o.id);
  switch (nv.kind) {
    case "pilih":
    case "peran":
      return ids.length > 0 ? rng.pick(ids) : null;
    case "pilih_banyak": {
      if (nv.id === "A3") return ids.filter(() => rng.chance(8));
      return ids.filter(() => rng.chance(35));
    }
    case "jumlah":
      return nv.min + rng.int(nv.max - nv.min + 1 > 4 ? 4 : nv.max - nv.min + 1);
    case "jumlah_lp": {
      const mx = nv.maxLP ?? { L: 3, P: 3 };
      const L = rng.int((mx.L > 3 ? 3 : mx.L) + 1);
      const P = rng.int((mx.P > 3 ? 3 : mx.P) + 1);
      return nv.id === "A3b" && L + P === 0 ? { L: 1, P: 0 } : { L, P };
    }
  }
}

function hasKiller(s: QState): boolean {
  return JSON.stringify(s.answers).includes(`"${KILLER_OPTION}"`);
}

export function runTermination(opts: { runs: number; seed: number; maxFailures?: number }): TerminationReport {
  const rng = new Rng(opts.seed);
  const rep: TerminationReport = { seed: opts.seed, runs: opts.runs, maxSteps: 0, endings: {}, failures: [] };
  for (let run = 0; run < opts.runs && rep.failures.length < (opts.maxFailures ?? 20); run++) {
    let s = initialState();
    let ended = false;
    for (let step = 0; step < 400; step++) {
      // privacy: k6 never in state, whatever the UI sends
      if (rng.chance(3)) {
        const bad = reduce(s, { type: "jawab", key: "A3", value: ["k1", KILLER_OPTION] });
        if (bad !== s && hasKiller(bad)) rep.failures.push({ run, message: "k6 stored by jawab" });
        const loaded = reduce(s, { type: "muat", answers: { ...s.answers, A3: [KILLER_OPTION] } });
        if (hasKiller(loaded)) rep.failures.push({ run, message: "k6 stored by muat" });
      }
      const w = walk(s.answers);
      const keys = w.steps.map((x) => x.key);
      if (new Set(keys).size !== keys.length) {
        rep.failures.push({ run, message: `a node twice on the path: ${keys.join(" ")}` });
        break;
      }
      const v = view(s);
      if (rng.chance(6) && keys.length > 0) {
        s = rng.chance(50) ? reduce(s, { type: "kembali" }) : reduce(s, { type: "ubah", key: rng.pick(keys) });
        continue;
      }
      if (v.kind === "ringkasan" || (v.kind === "keluar" && !v.lanjutSimulasi)) {
        const e = evaluate(s.answers);
        if (e.kind === "belum_selesai") {
          rep.failures.push({ run, message: `review screen but evaluate says incomplete at ${e.next}` });
          break;
        }
        const end = e.kind === "keluar" ? e.exit.id : e.perluDipastikan ? "laporan+perlu" : "laporan";
        rep.endings[end] = (rep.endings[end] ?? 0) + 1;
        if (step > rep.maxSteps) rep.maxSteps = step;
        ended = true;
        break;
      }
      if (v.kind === "keluar") {
        s = reduce(s, { type: "lanjut_simulasi" });
        continue;
      }
      const key = v.node.key;
      for (const tk of [v.node.text.tanya, v.node.text.mengapa, ...(v.node.text.bantuan ? [v.node.text.bantuan] : []), ...v.node.options.map((o) => o.text)]) {
        if (!isQTextKey(tk)) rep.failures.push({ run, message: `view at ${key} hands out a missing text key ${tk}` });
      }
      const val = randomValue(rng, w, key);
      if (val === null) {
        rep.failures.push({ run, message: `no answer possible at ${key}` });
        break;
      }
      const next = reduce(s, { type: "jawab", key, value: val });
      if (next === s) {
        rep.failures.push({ run, message: `reducer refused a valid-looking answer at ${key}: ${JSON.stringify(val)}` });
        break;
      }
      s = next;
    }
    if (!ended && rep.failures.length === 0) rep.failures.push({ run, message: "did not reach the review screen or an exit in 400 actions" });
  }
  return rep;
}

// ---------------------------------------------------------------------------------------------
// M2.3 path lengths (plan §5.5)
// ---------------------------------------------------------------------------------------------

const P = (id: string, sex: Sex, extra: Partial<Person> = {}): Person => ({ id, sex, alive: true, religion: "islam", ...extra });
const fam = (sex: Sex, f: Partial<FamilyInput>): FamilyInput => ({ deceased: { sex, religion: "islam" }, spouses: [], children: [], siblings: [], paternalUncles: [], ...f });
function tf(family: FamilyInput, extra: Partial<TrueFamily> = {}): TrueFamily {
  const base: TrueFamily = { index: -1, input: { family }, a1: "wafat_muslim", everMarried: family.spouses.length > 0, earlierSpouse: false, killer: false, khuntsa: false, siri: false, special: null, wasiat: { consent: false } };
  const t = { ...base, ...extra };
  if (t.wasiat.lain) t.input = { family, estate: { wasiat: [{ toHeir: false, fraction: t.wasiat.lain.frac }] } };
  return t;
}
const THIRD_W = { size: "sepertiga" as const, frac: { n: BigInt(1), d: BigInt(3) } };

export interface PathCase {
  id: string;
  title: string;
  family: TrueFamily;
  /** Target (plan §5.5): ≤ 12, or 13 with a wasiat; null = counted and reported only. */
  max: number | null;
}

/**
 * Named families the completeness run always drives (plan M2.1), beside the seeded random ones:
 * beyond-depth collateral agnates. With the estate exhausted by fixed shares they receive nothing
 * and F5 is not asked (engine: hajb.istighraq); with something left over F5 is asked and the
 * engine's refusal (kerabat_jauh) reaches the report, as for the full family.
 */
const beyondBrother = (id: string): SiblingPerson => ({ id, sex: "L", alive: false, religion: "islam", line: "kandung", children: [{ id: `${id}.c`, sex: "L", alive: false, religion: "islam", children: [P(`${id}.c.c`, "L")] }] });
const beyondUncle = (id: string): UnclePerson => ({ id, sex: "L", alive: false, religion: "islam", line: "kandung", children: [{ id: `${id}.c`, sex: "L", alive: false, religion: "islam", children: [P(`${id}.c.c`, "L")] }] });
export const COMPLETENESS_CASES: readonly { id: string; title: string; family: TrueFamily }[] = [
  {
    id: "jauh-aul",
    title: "Wife dies; husband, 2 full sisters ('aul 6 → 7) and a full brother's grandson",
    family: tf(fam("P", { spouses: [P("h", "L")], siblings: [{ ...P("z1", "P"), line: "kandung" }, { ...P("z2", "P"), line: "kandung" }, beyondBrother("b")] })),
  },
  {
    id: "jauh-pas",
    title: "Wife dies; husband and 1 full sister (exactly 1) and a paternal cousin's son",
    family: tf(fam("P", { spouses: [P("h", "L")], siblings: [{ ...P("z1", "P"), line: "kandung" }], paternalUncles: [beyondUncle("u")] })),
  },
  {
    id: "jauh-sisa",
    title: "Man dies; a daughter and the mother (something left over) and a full brother's grandson: F5 asked; the fikih column refuses (kerabat_jauh), the court column computes (the daughter excludes him)",
    family: tf(fam("L", { children: [P("d1", "P")], mother: P("m", "P"), siblings: [beyondBrother("b")] }), { everMarried: true }),
  },
];

export const PATH_CASES: readonly PathCase[] = [
  {
    id: "umum-1",
    title: "Husband dies; wife, sons and daughters; parents dead; no wasiat",
    family: tf(fam("L", { spouses: [P("w", "P")], children: [P("s1", "L"), P("s2", "L"), P("d1", "P")] })),
    max: 12,
  },
  {
    id: "umum-2",
    title: "Widowed mother dies; sons and daughters; wasiat ⅓ to a mosque",
    family: tf(fam("P", { children: [P("s1", "L"), P("d1", "P"), P("d2", "P")] }), { everMarried: true, wasiat: { lain: THIRD_W, consent: false } }),
    max: 13,
  },
  {
    id: "umum-3",
    title: "Young husband dies; wife, 2 daughters, both parents alive",
    family: tf(fam("L", { spouses: [P("w", "P")], children: [P("d1", "P"), P("d2", "P")], father: P("f", "L"), mother: P("m", "P") })),
    max: 12,
  },
  {
    id: "umum-4",
    title: "Wife dies; husband, 1 daughter, only her mother alive, 1 full brother",
    family: tf(fam("P", { spouses: [P("h", "L")], children: [P("d1", "P")], mother: P("m", "P"), siblings: [{ ...P("b1", "L"), line: "kandung" }] })),
    max: 12,
  },
  {
    id: "umum-5L",
    title: "Unmarried man, no children; only the mother; 2 full sisters + 1 paternal brother",
    family: tf(fam("L", { mother: P("m", "P"), siblings: [{ ...P("s1", "P"), line: "kandung" }, { ...P("s2", "P"), line: "kandung" }, { ...P("b1", "L"), line: "seayah" }] })),
    max: 12,
  },
  {
    id: "umum-5P",
    title: "Unmarried woman, no children; only the mother; 2 full sisters + 1 paternal brother",
    family: tf(fam("P", { mother: P("m", "P"), siblings: [{ ...P("s1", "P"), line: "kandung" }, { ...P("s2", "P"), line: "kandung" }, { ...P("b1", "L"), line: "seayah" }] })),
    max: 12,
  },
  {
    id: "umum-5P-wasiat",
    title: "As umum-5P, with a wasiat ⅓ to others",
    family: tf(fam("P", { mother: P("m", "P"), siblings: [{ ...P("s1", "P"), line: "kandung" }, { ...P("s2", "P"), line: "kandung" }, { ...P("b1", "L"), line: "seayah" }] }), { wasiat: { lain: THIRD_W, consent: false } }),
    max: 13,
  },
  {
    id: "jarang-seibu",
    title: "Never-married man, parents and grandparents dead, only 2 uterine siblings",
    family: tf(fam("L", { siblings: [{ ...P("u1", "L"), line: "seibu" }, { ...P("u2", "P"), line: "seibu" }] })),
    max: null,
  },
  { id: "jarang-tanpa-ahli-waris", title: "No heirs at all (never-married man)", family: tf(fam("L", {})), max: null },
  {
    id: "jarang-beda-agama",
    title: "Husband dies; wife, a non-Muslim son, a Muslim daughter, a Muslim full brother",
    family: tf(fam("L", { spouses: [P("w", "P")], children: [P("s1", "L", { religion: "non_islam" }), P("d1", "P")], siblings: [{ ...P("b1", "L"), line: "kandung" }] })),
    max: null,
  },
  {
    id: "jarang-anak-wafat",
    title: "Widow dies; one son; a daughter who died first, leaving 2 children",
    family: tf(fam("P", { children: [P("s1", "L"), { id: "d0", sex: "P", alive: false, religion: "islam", children: [P("g1", "L"), P("g2", "P")] }] }), { everMarried: true }),
    max: null,
  },
  {
    id: "jarang-perempuan-lajang",
    title: "Never-married woman, only the father alive",
    family: tf(fam("P", { father: P("f", "L") })),
    max: null,
  },
];

export interface PathLengthReport {
  rows: { id: string; title: string; screens: number; max: number | null; asked: string; end: string }[];
  failures: string[];
}

export function runPathLengths(): PathLengthReport {
  const rows: PathLengthReport["rows"] = [];
  const failures: string[] = [];
  for (const c of PATH_CASES) {
    const d = drive(c.family);
    if (d.error) {
      failures.push(`${c.id}: ${d.error}`);
      continue;
    }
    const n = screenCount(d.state.answers);
    const e = evaluate(d.state.answers);
    const end = e.kind === "keluar" ? e.exit.id : e.kind;
    rows.push({ id: c.id, title: c.title, screens: n, max: c.max, asked: walk(d.state.answers).steps.map((s) => s.key).join(" "), end });
    if (c.max !== null && n > c.max) failures.push(`${c.id}: ${n} screens > ${c.max}`);
    if (c.max !== null && e.kind !== "laporan") failures.push(`${c.id}: ends at ${end}, not the report`);
  }
  return { rows, failures };
}

// ---------------------------------------------------------------------------------------------
// M2.4 refusal routing
// ---------------------------------------------------------------------------------------------

interface RouteCase {
  id: string;
  /** Answers to apply in path order (only the asked ones are used; the rest must not be asked). */
  answers: Answers;
  amounts?: Amounts;
  expect:
    | { exit: string }
    | { report: true; fikihRefused?: RujukReason[]; courtRefused?: RujukReason[]; perlu?: boolean; note?: string };
}

const BASE: Answers = { A1: "wafat_muslim", A2: "L", A3: [] };

export const ROUTE_CASES: readonly RouteCase[] = [
  { id: "A1 saya_hidup → E-HIDUP", answers: { A1: "saya_hidup" }, expect: { exit: "E-HIDUP" } },
  { id: "A1 wafat_nonmuslim → E-NONMUSLIM", answers: { A1: "wafat_nonmuslim" }, expect: { exit: "E-NONMUSLIM" } },
  { id: "A3 k7 → E-KHUNTSA", answers: { ...BASE, A3: ["k7"] }, expect: { exit: "E-KHUNTSA" } },
  {
    id: "A3 k3 anak hilang → E-MAFQUD",
    answers: { ...BASE, A3: ["k3"], A3c: ["anak"], B1: "ya_satu", B1b: "tidak", C1: { L: 1, P: 0 }, C3: "tidak", D1: "tidak_ada", D3: [] },
    expect: { exit: "E-MAFQUD" },
  },
  {
    id: "A3 k3 saudara hilang with a son → note, computed",
    answers: { ...BASE, A3: ["k3"], A3c: ["saudara"], B1: "ya_satu", B1b: "tidak", C1: { L: 1, P: 0 }, C3: "tidak", D1: "tidak_ada", D3: [], G1: [] },
    expect: { report: true, note: "hilang_tanpa_pengaruh" },
  },
  {
    id: "A3 k4 anak dalam kandungan → E-HAML",
    answers: { ...BASE, A3: ["k4"], A3d: ["anak"], B1: "ya_satu", B1b: "tidak", C1: { L: 1, P: 0 }, C3: "tidak", D1: "tidak_ada", D3: [] },
    expect: { exit: "E-HAML" },
  },
  {
    id: "A3 k4 saudara dalam kandungan, father alive → note",
    answers: { ...BASE, A3: ["k4"], A3d: ["saudara"], B1: "ya_satu", B1b: "tidak", C1: { L: 1, P: 0 }, C3: "tidak", D1: "keduanya", G1: [] },
    expect: { report: true, note: "kandungan_tanpa_pengaruh" },
  },
  {
    id: "A3 k5 pasangan wafat bersamaan → E-BERSAMAAN",
    answers: { ...BASE, A3: ["k5"], A3e: ["pasangan"], B1: "pernah", B1b: "tidak", C1: { L: 1, P: 0 }, C3: "tidak", D1: "tidak_ada", D3: [] },
    expect: { exit: "E-BERSAMAAN" },
  },
  {
    id: "C4b keturunan jauh, no son → E-KERABAT-JAUH",
    answers: { ...BASE, B1: "pernah", B1b: "tidak", C1: { L: 0, P: 1 }, C3: "ya", "C4s.1": "P", "C4g.1": { L: 0, P: 0 }, "C4b.1": ["keturunan_jauh"], "C4m.1": "tidak", D1: "tidak_ada", D3: [], E1: { L: 0, P: 0 }, E2: { L: 0, P: 0 } },
    expect: { exit: "E-KERABAT-JAUH" },
  },
  {
    id: "F5 keturunan saudara → E-KERABAT-JAUH",
    answers: { ...BASE, B1: "belum", D1: "ibu", D3: [], E1: { L: 0, P: 0 }, E2: { L: 0, P: 0 }, E3: { L: 0, P: 0 }, F1: "tidak", F2: "tidak", F3: "tidak", F5: ["keturunan_saudara"] },
    expect: { exit: "E-KERABAT-JAUH" },
  },
  {
    id: "F5 kerabat ayah → E-KERABAT-JAUH (outOfScope)",
    answers: { ...BASE, B1: "belum", D1: "ibu", D3: [], E1: { L: 0, P: 0 }, E2: { L: 0, P: 0 }, E3: { L: 0, P: 0 }, F1: "tidak", F2: "tidak", F3: "tidak", F5: ["kerabat_ayah"] },
    expect: { exit: "E-KERABAT-JAUH" },
  },
  {
    id: "F4 ya, widow only → E-DZAWIL",
    answers: { ...BASE, B1: "ya_satu", B1b: "tidak", C1: { L: 0, P: 0 }, C3: "tidak", D1: "tidak_ada", D3: [], E1: { L: 0, P: 0 }, E2: { L: 0, P: 0 }, E3: { L: 0, P: 0 }, F1: "tidak", F2: "tidak", F3: "tidak", F5: [], F4: "ya" },
    expect: { exit: "E-DZAWIL" },
  },
  {
    id: "F4 tidak, widow only → report (sisa: konsultasikan, both columns)",
    answers: { ...BASE, B1: "ya_satu", B1b: "tidak", C1: { L: 0, P: 0 }, C3: "tidak", D1: "tidak_ada", D3: [], E1: { L: 0, P: 0 }, E2: { L: 0, P: 0 }, E3: { L: 0, P: 0 }, F1: "tidak", F2: "tidak", F3: "tidak", F5: [], F4: "tidak", G1: [] },
    expect: { report: true },
  },
  {
    id: "No heirs at all → E-TANPA-AHLI-WARIS (before G1)",
    answers: { ...BASE, B1: "belum", D1: "tidak_ada", D3: [], E1: { L: 0, P: 0 }, E2: { L: 0, P: 0 }, E3: { L: 0, P: 0 }, F1: "tidak", F2: "tidak", F3: "tidak", F5: [], F4: "tidak" },
    expect: { exit: "E-TANPA-AHLI-WARIS" },
  },
  {
    id: "Debts ≥ estate (rupiah panel) → E-UTANG",
    answers: { ...BASE, B1: "ya_satu", B1b: "tidak", C1: { L: 1, P: 0 }, C3: "tidak", D1: "tidak_ada", D3: [], G1: [] },
    amounts: { hartaBawaan: BigInt(100000000), utang: BigInt(150000000) },
    expect: { exit: "E-UTANG" },
  },
  {
    id: "Court-only refusal (wasiat wajibah besar): wife, non-Muslim son, Muslim brother → fikih shown",
    answers: { ...BASE, A3: ["k1"], A3a: ["anak"], B1: "ya_satu", B1b: "tidak", C1: { L: 1, P: 0 }, C1m: { L: 0, P: 0 }, C1n: { L: 0, P: 0 }, C3: "tidak", D1: "tidak_ada", D3: [], E1: { L: 1, P: 0 }, E3: { L: 0, P: 0 }, G1: [] },
    expect: { report: true, courtRefused: ["wasiat_wajibah_besar"] },
  },
  {
    id: "Fikih-only refusal (v1 dzawil arham): widow + a predeceased daughter's 2 children → court shown",
    answers: { ...BASE, A2: "P", B1: "ya_satu", B1b: "tidak", C1: { L: 0, P: 0 }, C3: "ya", "C4s.1": "P", "C4g.1": { L: 0, P: 2 }, "C4b.1": [], "C4m.1": "tidak", D1: "tidak_ada", D3: [], E1: { L: 0, P: 0 }, E2: { L: 0, P: 0 }, E3: { L: 0, P: 0 }, F5: [], F1: "tidak", F2: "tidak", F3: "tidak", G1: [] },
    expect: { report: true, fikihRefused: ["dzawil_arham"] },
  },
  {
    id: "B1 iddah → both outcomes (soft stop)",
    answers: { ...BASE, B1: "iddah", B1b: "tidak", C1: { L: 0, P: 1 }, C3: "tidak", D1: "tidak_ada", D3: [], E1: { L: 1, P: 0 }, E2: { L: 0, P: 0 }, G1: [] },
    expect: { report: true, perlu: true },
  },
  {
    id: "Two «Tidak tahu» that both change the division → E-TIDAK-TAHU",
    answers: { ...BASE, B1: "tidak_tahu", C1: { L: 0, P: 1 }, C3: "tidak", D1: "tidak_tahu", D3: [], E1: { L: 1, P: 0 }, E2: { L: 0, P: 0 }, G1: [] },
    expect: { exit: "E-TIDAK-TAHU" },
  },
  {
    id: "F4 «Tidak tahu» with only a spouse → E-TIDAK-TAHU (konsultasikan)",
    answers: { ...BASE, B1: "ya_satu", B1b: "tidak", C1: { L: 0, P: 0 }, C3: "tidak", D1: "tidak_ada", D3: [], E1: { L: 0, P: 0 }, E2: { L: 0, P: 0 }, E3: { L: 0, P: 0 }, F1: "tidak", F2: "tidak", F3: "tidak", F5: [], F4: "tidak_tahu" },
    expect: { exit: "E-TIDAK-TAHU" },
  },
  {
    id: "One «Tidak tahu» on the spouse that changes the division → side by side",
    answers: { ...BASE, B1: "tidak_tahu", C1: { L: 0, P: 1 }, C3: "tidak", D1: "tidak_ada", D3: [], E1: { L: 1, P: 0 }, G1: [] },
    expect: { report: true, perlu: true },
  },
  {
    id: "«Tidak tahu» on siblings whose count changes the shares → E-TIDAK-TAHU",
    answers: { ...BASE, B1: "ya_satu", B1b: "tidak", C1: { L: 0, P: 1 }, C3: "tidak", D1: "tidak_ada", D3: [], E1: "tidak_tahu", E2: { L: 0, P: 0 }, E3: { L: 0, P: 0 }, F5: [], F1: "tidak", F2: "tidak", F3: "tidak", G1: [] },
    expect: { exit: "E-TIDAK-TAHU" },
  },
];

/** Apply only the answers the walk asks for, in path order. */
function applyAsked(answers: Answers): { state: QState; unused: string[]; refused: string | null } {
  let s = initialState();
  const used = new Set<string>();
  for (let n = 0; n < STEP_LIMIT; n++) {
    const w = walk(s.answers);
    if (w.exit || !w.cursor) break;
    const c = w.cursor;
    if (c.id === "A1s") break;
    if (!(c.key in answers)) break;
    const next = reduce(s, { type: "jawab", key: c.key, value: answers[c.key] });
    if (next === s) return { state: s, unused: [], refused: c.key };
    used.add(c.key);
    s = next;
  }
  return { state: s, unused: Object.keys(answers).filter((k) => !used.has(k)), refused: null };
}

export interface RoutingReport {
  checked: number;
  failures: string[];
}

export function runRefusalRouting(): RoutingReport {
  const failures: string[] = [];
  let checked = 0;
  for (const c of ROUTE_CASES) {
    checked++;
    const r = applyAsked(c.answers);
    if (r.refused) {
      failures.push(`${c.id}: the reducer refused the answer at ${r.refused}`);
      continue;
    }
    const e = evaluate(r.state.answers, c.amounts);
    if ("exit" in c.expect) {
      if (e.kind !== "keluar" || e.exit.id !== c.expect.exit) failures.push(`${c.id}: got ${e.kind === "keluar" ? e.exit.id : e.kind}${e.kind === "belum_selesai" ? ` (next ${e.next})` : ""}`);
      continue;
    }
    if (e.kind !== "laporan") {
      failures.push(`${c.id}: expected a report, got ${e.kind === "keluar" ? e.exit.id : `${e.kind} ${e.next}`}`);
      continue;
    }
    const want = c.expect;
    if (r.unused.length > 0 && !want.perlu) {
      // every answer in the case should have been asked (keeps the cases honest)
      failures.push(`${c.id}: answers never asked: ${r.unused.join(" ")}`);
    }
    const fr = e.utama.fikih.result;
    const cr = e.utama.pengadilan.result;
    const refusedReasons = (x: Result) => (x.kind === "rujuk" ? [...x.reasons] : []);
    if (want.fikihRefused && JSON.stringify(refusedReasons(fr)) !== JSON.stringify(want.fikihRefused)) failures.push(`${c.id}: fikih ${JSON.stringify(refusedReasons(fr))}`);
    if (want.courtRefused && JSON.stringify(refusedReasons(cr)) !== JSON.stringify(want.courtRefused)) failures.push(`${c.id}: court ${JSON.stringify(refusedReasons(cr))}`);
    if (want.fikihRefused && cr.kind !== "hasil") failures.push(`${c.id}: the court column should still be shown`);
    if (want.courtRefused && fr.kind !== "hasil") failures.push(`${c.id}: the fikih column should still be shown`);
    if (want.perlu !== undefined && (e.perluDipastikan !== null) !== want.perlu) failures.push(`${c.id}: perluDipastikan ${e.perluDipastikan !== null}`);
    if (want.note && !e.notes.includes(want.note as never)) failures.push(`${c.id}: missing note ${want.note} (got ${e.notes.join(",")})`);
    // M2.8: a refused column carries no numbers
    for (const col of [e.utama.fikih, e.utama.pengadilan]) if (col.refused && col.result.kind !== "rujuk") failures.push(`${c.id}: refused column carries shares`);
  }
  // every engine refusal reason maps to an exit page; whole-report refusal reasons to their own page
  for (const reason of RUJUK_REASONS) {
    checked++;
    const ex = exitFor([reason], [reason]);
    if (!(EXIT_IDS as readonly string[]).includes(ex)) failures.push(`reason ${reason}: no exit`);
  }
  // k6: routed before dispatch; the reducer refuses it; it has no codec code
  checked++;
  if (a3Route(["k1", "k6"]).kind !== "bunuh") failures.push("a3Route does not send k6 to E-BUNUH");
  const s0 = reduce(initialState(), { type: "jawab", key: "A1", value: "wafat_muslim" });
  const s1 = reduce(reduce(s0, { type: "jawab", key: "A2", value: "L" }), { type: "jawab", key: "A3", value: ["k6"] });
  if (JSON.stringify(s1).includes("k6")) failures.push("k6 reached QState");
  if (NODE.A3.options.includes("k6")) failures.push("k6 is in the A3 codec catalog");
  if (EXITS["E-BUNUH"].print) failures.push("E-BUNUH offers a printout");
  // A3 UI options are exactly the plan's list
  if (A3_UI_OPTIONS.join() !== "k0,k1,k2,k3,k4,k5,k6,k7,k8,k9") failures.push("A3 UI options changed");
  // E-HIDUP → simulasi continues at A2
  checked++;
  const h = reduce(reduce(initialState(), { type: "jawab", key: "A1", value: "saya_hidup" }), { type: "lanjut_simulasi" });
  const hv = view(h);
  if (hv.kind !== "tanya" || hv.node.id !== "A2") failures.push("E-HIDUP «lanjutkan sebagai simulasi» does not continue at A2");
  return { checked, failures };
}

// ---------------------------------------------------------------------------------------------
// Codec
// ---------------------------------------------------------------------------------------------

export interface CodecReport {
  checked: number;
  maxLength: number;
  failures: string[];
}

export function runCodecChecks(opts: { count: number; seed: number }): CodecReport {
  const rng = new Rng(opts.seed);
  const failures: string[] = [];
  let checked = 0;
  let maxLength = 0;
  for (let i = 0; i < opts.count && failures.length < 20; i++) {
    const t = randomTrueFamily(rng, i);
    const d = drive(t);
    if (d.error || d.bunuh) continue;
    const w = walk(d.state.answers);
    const amounts: Amounts = { hartaBawaan: BigInt(1 + rng.int(999999)) * BigInt(1000), utang: BigInt(rng.int(1000)), ...(rng.chance(30) ? { semuaMilikAlmarhum: true } : {}) };
    const plain = encodeEff(w.eff, amounts, { sertakanRupiah: false });
    const withRp = encodeEff(w.eff, amounts, { sertakanRupiah: true });
    checked++;
    if (plain.length > maxLength) maxLength = plain.length;
    if (withRp.length > MAX_TOKEN_LENGTH) failures.push(`#${i}: token too long (${withRp.length})`);
    const a = decode(plain);
    const b = decode(withRp);
    if (!a || !b) {
      failures.push(`#${i}: decode failed`);
      continue;
    }
    if (a.amounts) failures.push(`#${i}: amounts in a link without "Sertakan nilai rupiah"`);
    if (!b.amounts || b.amounts.hartaBawaan !== amounts.hartaBawaan || b.amounts.utang !== amounts.utang || (b.amounts.semuaMilikAlmarhum ?? false) !== (amounts.semuaMilikAlmarhum ?? false)) failures.push(`#${i}: amounts did not round-trip`);
    const wa = walk(a.answers);
    if (JSON.stringify(wa.eff) !== JSON.stringify(w.eff)) failures.push(`#${i}: answers did not round-trip`);
    if (answerCodeOf(wa.eff) !== answerCodeOf(w.eff) || !/^W1-[0-9A-HJKMNP-TV-Z]{4}$/.test(answerCodeOf(w.eff))) failures.push(`#${i}: answer code`);
    if (sigOfEval(evaluate(a.answers)) !== sigOfEval(evaluate(d.state.answers))) failures.push(`#${i}: outcome changed through the link`);
    if (tokenFromHash(`#${fragmentFor(plain)}`) !== plain) failures.push(`#${i}: fragment`);
    // stale answers are dropped: an answer to a node that is not on the path is never encoded
    if (d.state.answers.B1 !== "ya_lebih" && encodeEff(walk({ ...d.state.answers, B2: 3, zz: "x" }).eff) !== plain) failures.push(`#${i}: stale answers encoded`);
    // corruption never throws
    for (let k = 0; k < 6; k++) {
      checked++;
      const cut = plain.slice(0, rng.int(plain.length + 1));
      const flip = plain.slice(0, 3) + plain.slice(3).split("").map((ch) => (rng.chance(10) ? "ABCxyz09-_!".charAt(rng.int(11)) : ch)).join("");
      for (const bad of [cut, flip, `v2${plain.slice(2)}`, `${plain}${plain}`, "", "v1.", "v1.////", "x".repeat(MAX_TOKEN_LENGTH + 1)]) {
        try {
          const r = decode(bad);
          if (r && Object.values(r.answers).some((v) => JSON.stringify(v).includes("k6"))) failures.push("decode produced k6");
        } catch {
          failures.push(`decode threw on ${JSON.stringify(bad.slice(0, 40))}`);
        }
      }
    }
  }
  return { checked, maxLength, failures };
}

// ---------------------------------------------------------------------------------------------
// Text rules (plan D10, §2 "no human review", senior-UX copy)
// ---------------------------------------------------------------------------------------------

const FORBIDDEN = [/tinjauan ustadz/i, /ditinjau ustadz/i, /awaiting ustadz/i, /reviewed by an ustadz/i];
const BARE_CITATION = /(^|[^A-Za-z])(QS|HR)([^A-Za-z]|$)/;
const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
const PLACEHOLDERS = new Set(["pewaris", "Pewaris", "saat", "Saat", "pasangan", "Pasangan", "kelompok", "penghalang"]);

export function runTextChecks(ruleNoteIds?: ReadonlySet<string>): { checked: number; failures: string[] } {
  const failures: string[] = [];
  let checked = 0;
  for (const [k, v] of Object.entries(Q_TEXT)) {
    checked++;
    for (const re of FORBIDDEN) if (re.test(v)) failures.push(`${k}: promises a review ("${v}")`);
    if (BARE_CITATION.test(v)) failures.push(`${k}: bare QS/HR citation`);
    if (ARABIC.test(v)) failures.push(`${k}: Arabic script (must come from dalil.json)`);
    for (const w of v.split(/[^A-Za-z]+/)) if (w.length >= 3 && w === w.toUpperCase() && /[A-Z]/.test(w)) failures.push(`${k}: ALL-CAPS word "${w}"`);
    for (const m of v.match(/\{([A-Za-z]+)\}/g) ?? []) if (!PLACEHOLDERS.has(m.slice(1, -1))) failures.push(`${k}: unknown placeholder ${m}`);
    if (v.length > 0 && v.charAt(0) !== v.charAt(0).toUpperCase() && !v.startsWith("{")) failures.push(`${k}: not sentence case`);
  }
  // every key a view can hand out exists
  const need = (key: string) => {
    checked++;
    if (!isQTextKey(key)) failures.push(`missing text key ${key}`);
  };
  for (const d of NODES) {
    need(`${d.id}.mengapa`);
    if (HAS_HELP.has(d.id)) need(`${d.id}.bantuan`);
    if (d.kind === "peran") for (const h of HEIRS) need(`peran.${h}`);
    else for (const o of d.options) if (!(d.id === "B1" && o === "ya_satu") && d.id !== "C4b") need(`${d.id}.opsi.${o}`);
    need(`${d.id}.tanya`);
    for (const r of d.why) {
      checked++;
      if (!isRuleId(r)) failures.push(`${d.id}: why ${r} is not a rule id`);
      else if (ruleNoteIds && !ruleNoteIds.has(r)) failures.push(`${d.id}: why ${r} has no RuleNote`);
    }
  }
  for (const k of ["B1.opsi.ya_satu", "B1.opsi.ya_satu_P", "D1m.opsi.ya_satu", "D1m.opsi.tidak_satu", "C4b.opsi.keturunan_jauh_L", "C4b.opsi.keturunan_jauh_P", "C4b.opsi.anak_cucu_perempuan", "C4b.opsi.cicit_dari_cucu_hidup", "B3.tanya_satu", "D1m.tanya_satu", "G4.tanya_satu", "C4b.muslim.tanya", "F1.muslim.tanya", "F2.muslim.tanya", "F3.muslim.tanya", "F4.muslim.tanya", "F5.muslim.tanya", "A3.opsi.k0", "A3.opsi.k6", "exit.E-HIDUP.lanjut"]) need(k);
  for (const x of A3_UI_OPTIONS) need(`A3.opsi.${x}`);
  for (const ex of EXIT_IDS) for (const part of ["judul", "situasi", "alasan", "langkah"]) need(`exit.${ex}.${part}`);
  for (const ex of EXIT_IDS) for (const r of EXITS[ex].rules) if (!isRuleId(r)) failures.push(`${ex}: ${r} is not a rule id`);
  for (const n of Q_NOTES) need(`catatan.${n}`);
  for (const sct of SECTIONS) need(`bagian.${sct}`);
  for (const o of ["ada", "tidak_ada", "satu", "dua_atau_lebih", "muslim", "bukan_muslim", "setuju", "belum_setuju"]) need(`bacaan.${o}`);
  for (const g of ["saudara", "saudara_kandung", "saudara_seayah", "saudara_seibu", "keponakan", "paman", "sepupu", "kakek", "nenek", "cucu", "kerabat_lain"]) need(`kelompok.${g}`);
  return { checked, failures };
}

/** Every QKey the graph can produce parses back (codec / storage keys). */
export function keysRoundTrip(): string[] {
  const bad: string[] = [];
  for (const d of NODES) {
    const keys = d.loop ? [1, 2, 6].map((i) => `${d.id}.${i}`) : [d.id];
    for (const k of keys) if (!parseKey(k)) bad.push(k);
  }
  if (parseKey("C4s.7") || parseKey("A1.1") || parseKey("C4s") || parseKey("ZZ")) bad.push("parseKey accepts a bad key");
  return bad;
}

