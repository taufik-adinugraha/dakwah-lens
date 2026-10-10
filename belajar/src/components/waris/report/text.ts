/**
 * Rendering the report's message references (report/messages.ts Msg) with next-intl.
 *
 * The report model carries keys, never sentences. Their copy lives in
 * messages/waris/{id,en}.json under "Report.laporan" (written from REPORT_MESSAGES, Indonesian in
 * both files: the report is Indonesian only in v1, plan D11). Templates use plain {name}
 * placeholders, so they are read raw (t.raw) and filled by renderMsg, exactly as the report checks
 * render them. A key missing from the messages falls back to the built-in default, never to a
 * made-up sentence.
 */
import { useTranslations } from "next-intl";

import { REPORT_MESSAGES, renderMsg, renderValue, type Msg, type MsgValue, type ReportMsgKey } from "@/lib/waris/report";

export interface ReportText {
  /** Render a message reference. */
  R: (m: Msg) => string;
  /** Render a placeholder value (text, count, message or list). */
  RV: (v: MsgValue) => string;
  /** Raw template lookup, for buildTextSummary(). */
  lookup: (key: ReportMsgKey) => string;
}

export function useReportText(): ReportText {
  const t = useTranslations("Report");
  const lookup = (key: ReportMsgKey): string => {
    if (t.has(key)) {
      const raw: unknown = t.raw(key);
      if (typeof raw === "string") return raw;
    }
    return REPORT_MESSAGES[key];
  };
  return { R: (m) => renderMsg(m, lookup), RV: (v) => renderValue(v, lookup), lookup };
}
