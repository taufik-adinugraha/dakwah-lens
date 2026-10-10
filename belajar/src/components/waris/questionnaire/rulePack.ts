/**
 * The RuleNotes and dalil the questionnaire can show, prepared ONCE on the server (the static
 * shell of /waris/hitung) and handed to the client component as plain props. Nothing here is
 * written by hand: every title and summary is a RuleNote (content/waris/rules.json) keyed by an
 * engine rule id, and every Arabic string is the report's dalilCard() slice of a dalil.json /
 * dalil-gaps.json record (plan D10; AGENTS.md "retrieved, never generated").
 *
 *  - Question screens ("Kenapa kami tanyakan ini?") get the RuleNote title and summary of each
 *    node's `why` rule ids. No Arabic there: it keeps the page light, and the report shows the
 *    dalil of every share.
 *  - Exit pages ("Konsultasikan", plan §5.4 item 3: "the rule, with its dalil where we have one")
 *    get the RuleNotes of EXITS[id].rules and of every engine refusal reason (rujuk.<reason>),
 *    with their legal citations and their dalil cards, records listed in rules.json order and
 *    de-duplicated across rules. The report's NEVER_SHOWN records are dropped (ruleRef()).
 *  - Never read: rules.json meta.disclaimer_id (it still promises a review), ikhtilaf texts,
 *    reviewer notes, gist_id summaries, English corpus translations.
 *
 * Pure TypeScript (no React, no I/O): the page passes the content in. No network, no LLM.
 * AI-assisted, not an authoritative fatwa.
 */
import { EXITS, NODES, type ExitId } from "@/lib/waris/questionnaire";
import { RUJUK_REASONS, isRuleId, type RuleId } from "@/lib/waris/registry";
import { indexContent, ruleRef, type ReportDalilRecord, type ReportRules } from "@/lib/waris/report/content";
import { dalilCard } from "@/lib/waris/report/dalil";
import { REPORT_MESSAGES, renderMsg, type ReportMsgKey } from "@/lib/waris/report/messages";

export interface LegalView {
  /** The instrument's title ("Kompilasi Hukum Islam …"), from rules.json legal_sources. */
  title: string;
  /** "Pasal 191". */
  locator: string;
  url: string | null;
}

export interface RuleView {
  id: RuleId;
  title: string;
  summary: string;
  legal: LegalView[];
  /** Dalil record ids (keys of RulePack.dalil). Empty for a rule shown only under a question. */
  dalil: string[];
}

export interface DalilView {
  id: string;
  kind: "quran" | "hadith" | "fiqh" | "tafsir" | "gap";
  /** The record's own citation label (data, never a message string). */
  citation: string;
  /** Fiqh section id, shown after the book. */
  section: string | null;
  /** Link back to the source passage. */
  url: string | null;
  /** A byte slice of the record (report dalilCard()); null for a gap record. */
  arabic: { text: string; script: "quran" | "naskh" } | null;
  /** Fiqh section heading, also a slice of the record. */
  heading: string | null;
  /** The corpus translation with its exact source label. */
  meaning: { text: string; label: string; footnotes: string | null } | null;
  /** "Arabic and citation only" line when the corpus has no Indonesian. */
  missing: string | null;
  tags: string[];
}

export interface RulePack {
  rules: Partial<Record<RuleId, RuleView>>;
  dalil: Record<string, DalilView>;
  /** Exit id → the rule ids its page shows (EXITS[id].rules). */
  exitRules: Record<ExitId, RuleId[]>;
}

/** Rule ids shown under a question or on an exit page. */
export function questionnaireRuleIds(): { why: RuleId[]; withDalil: RuleId[] } {
  const why = new Set<RuleId>();
  for (const n of NODES) for (const r of n.why) why.add(r);
  const withDalil = new Set<RuleId>();
  for (const e of Object.values(EXITS)) for (const r of e.rules) withDalil.add(r);
  for (const reason of RUJUK_REASONS) {
    const id = `rujuk.${reason}`;
    if (isRuleId(id)) withDalil.add(id);
  }
  return { why: [...why], withDalil: [...withDalil] };
}

/**
 * Build the pack. `lookup` renders the report's label messages (QuranEnc / internal translation
 * labels, "Arabic only" lines); pass next-intl's t.raw for the "laporan" namespace when present.
 * Throws when a rule id has no RuleNote (a content bug CI catches, as the report does).
 */
export function buildRulePack(
  rules: ReportRules,
  records: readonly ReportDalilRecord[],
  lookup: (key: ReportMsgKey) => string = (k) => REPORT_MESSAGES[k],
): RulePack {
  const ix = indexContent(rules, records);
  const { why, withDalil } = questionnaireRuleIds();
  const dalilWanted = new Set<RuleId>(withDalil);
  const out: RulePack = { rules: {}, dalil: {}, exitRules: {} as Record<ExitId, RuleId[]> };

  for (const id of [...why, ...withDalil]) {
    if (out.rules[id]) continue;
    const ref = ruleRef(ix, id);
    const dalil: string[] = [];
    if (dalilWanted.has(id)) {
      for (const did of ref.dalilIds) {
        const rec = ix.dalil.get(did);
        if (!rec) continue;
        if (!out.dalil[did]) {
          const card = dalilCard(rec);
          if (!card) continue;
          out.dalil[did] = {
            id: card.id,
            kind: card.kind,
            citation: card.citation.text,
            section: card.citation.section,
            url: card.citation.url,
            arabic: card.arabic ? { text: card.arabic.text, script: card.arabic.script } : null,
            heading: card.heading ? card.heading.text : null,
            meaning: card.meaning
              ? { text: card.meaning.text, label: renderMsg(card.meaning.label, lookup), footnotes: card.meaning.footnotes ? card.meaning.footnotes.text : null }
              : null,
            missing: card.meaningMissing ? renderMsg(card.meaningMissing, lookup) : null,
            tags: card.tags.map((m) => renderMsg(m, lookup)),
          };
        }
        if (!dalil.includes(did)) dalil.push(did);
      }
    }
    out.rules[id] = {
      id,
      title: ref.title,
      summary: ref.summary,
      legal: ref.legal.map((l) => ({ title: l.title, locator: l.locator, url: l.url })),
      dalil,
    };
  }
  for (const e of Object.values(EXITS)) out.exitRules[e.id] = [...e.rules];
  return out;
}
