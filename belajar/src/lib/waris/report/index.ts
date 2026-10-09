/**
 * Public surface of the report view-model (plan §6). Pure TypeScript: no React, no next, no
 * content/ imports, no network. The server page passes rules.json and the dalil records in; the
 * client component renders the model with next-intl (messages/waris/*.json written from
 * REPORT_MESSAGES under the "laporan" namespace). AI-assisted, not an authoritative fatwa.
 */
export { buildReport } from "./build";
export { buildTextSummary, compactRowLine, outcomeColumnLines, type OutcomeLine, type TextSummaryOptions } from "./summary";
export { answerCode, dateText } from "./code";
export { REPORT_MESSAGES, renderMsg, renderValue, msg, isMsg, type Msg, type MsgList, type MsgValue, type ReportMsgKey, type LabelId } from "./messages";
export { fractionWords, numberWords, parseFractionWords, parseNumberWords } from "./words";
export { NEVER_SHOWN, REPORT_LEGAL_SOURCES, type ReportRules, type ReportDalilRecord, type RuleNoteIn, type LegalSourceIn } from "./content";
export { dalilCard, rebuildArabic, recordString } from "./dalil";
export { SWITCH_RULES, SOFT_STOP_NOTES } from "./analysis";
export {
  ENGINE_VERSION_DEFAULT,
  REPORT_SCHEMA,
  type NotAskedGroup,
  type NotAskedInput,
  type ReportFlags,
  type ReportOptions,
  type UnknownInput,
  type UnknownOption,
  type UnknownAnswer,
  type PewarisKind,
  type UnknownSubject,
} from "./options";
export type {
  ColumnId,
  FracView,
  RupiahView,
  TableView,
  LegalRefView,
  RuleRefView,
  Segment,
  ArabicView,
  MeaningView,
  CitationView,
  DalilCard,
  KepalaView,
  RefusalView,
  ColumnHead,
  NoneView,
  CellView,
  HeirRow,
  PreLineCell,
  PreLineView,
  ResidueView,
  CompactRow,
  OutcomeColumn,
  OutcomeView,
  RingkasanView,
  ShrinkStep,
  BarSegment,
  BarView,
  TreeNodeColumn,
  TreeNode,
  TreeView,
  DiagramView,
  ReasonView,
  JalanView,
  TidakEntry,
  TidakGroup,
  TidakMendapatView,
  DalilRowRef,
  DalilRow,
  DalilSectionView,
  DiffRow,
  PerluItem,
  CatatanView,
  LangkahItem,
  LangkahView,
  PenutupView,
  RujukView,
  ReportModel,
} from "./types";
