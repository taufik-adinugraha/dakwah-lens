/**
 * Public surface of the questionnaire model ("Hitung waris keluarga saya", plan §5). Pure
 * TypeScript: no React, no I/O, no network, no LLM. The UI imports from here.
 */
import { encodeEff, type EncodeOptions } from "./codec";
import { walk } from "./machine";
import type { Amounts, QState } from "./types";

export {
  A3_UI_OPTIONS,
  KILLER_OPTION,
  a3Route,
  answerSummary,
  evaluate,
  exitFor,
  familyPreview,
  initialState,
  messageVars,
  modeOf,
  nodeView,
  parseKey,
  pewarisKind,
  progress,
  reduce,
  screenCount,
  validAnswer,
  view,
  walk,
  type CursorNode,
  type NodeView,
  type Step,
  type View,
  type Walk,
} from "./machine";
export { EXITS, MAX_ANAK_WAFAT, NODE, NODES, type A3UiOption, type ExitDef, type NodeDef } from "./graph";
export { Q_TEXT, fill, isQTextKey, type QTextKey } from "./text";
export { CODEC_VERSION, MAX_TOKEN_LENGTH, answerCodeOf, decode, encodeEff, fragmentFor, tokenFromHash, type Decoded, type EncodeOptions } from "./codec";
export { toInput } from "./build";
export * from "./types";

/** The share-link token for a state: effective answers only, rupiah only when ticked (plan D9). */
export function shareToken(s: QState, amounts?: Amounts, opts: EncodeOptions = { sertakanRupiah: false }): string {
  return encodeEff(walk(s.answers).eff, amounts, opts);
}

/**
 * What may be autosaved to sessionStorage (plan §9.4): the answers only — never the cursor, and
 * never k6, which no QState can hold. Stale answers are kept so that flipping an answer back
 * restores them (architecture.md §6.2); the share link drops them (shareToken).
 */
export function storable(s: QState): QState["answers"] {
  return s.answers;
}
