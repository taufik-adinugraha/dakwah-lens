/**
 * Public surface of the waris engine. Pure TypeScript, zero dependencies, no imports from
 * content/, no I/O. AI-assisted, not an authoritative fatwa.
 */
export { solve, solveOnce, resultSignature, computeSwitchesUsed } from "./solve";
export { UNBLOCKERS, blockers, blockerHits, couldAffectOutcome, couldInherit, type KnownCounts, type HajbCtx } from "./hajb";
export * from "./registry";
export type {
  Adjustment,
  AdoptedPerson,
  Bar,
  BlockedGroup,
  EstateBreakdown,
  EstateInput,
  FamilyInput,
  HartaBersamaPool,
  Hasil,
  IneligibleGroup,
  IneligibleReason,
  Line,
  LineKind,
  OtherRelative,
  Person,
  PersonShare,
  Religion,
  Result,
  Rujuk,
  ShareGroup,
  SiblingLine,
  SiblingPerson,
  SpecialCase,
  TraceStep,
  UnclePerson,
  WarisInput,
  WasiatInput,
} from "./types";
export { frac, parse as parseFrac, toStr as fracToString, type Frac } from "./frac";
export { percent, rupiah, fraction } from "./format";
