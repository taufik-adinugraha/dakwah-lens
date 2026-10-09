"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { ArrowRight, Link2, Pencil } from "lucide-react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { messageVars, type Amounts, type Answers, type QTextKey } from "@/lib/waris/questionnaire";
import { msg, type DalilCard, type ReportDalilRecord, type ReportModel, type ReportMsgKey, type ReportRules } from "@/lib/waris/report";
import { warisHref } from "@/lib/routes";

import { hitungHref, ReportActions, ShareActions } from "./Actions";
import { AiChip } from "./AiChip";
import { Catatan } from "./Catatan";
import { Cetak } from "./Cetak";
import { computeReport, exitRefs, rupiahFields } from "./compute";
import { CardsContext } from "./context";
import { DalilCardsOnly, DalilSection } from "./Dalil";
import { Diagram } from "./Diagram";
import { Kepala } from "./Kepala";
import { Langkah, Penutup } from "./Langkah";
import { Ringkasan } from "./Ringkasan";
import { ExitNotice, Rujuk } from "./Rujuk";
import { RupiahPanel } from "./RupiahPanel";
import { useAnswerSource, useReportDate, type AnswerSource } from "./source";
import { useReportText } from "./text";
import { TidakMendapat } from "./TidakMendapat";

/**
 * "Rekomendasi Pembagian Waris" (plan §6; architecture.md §7). The page is a static shell; this
 * component reads the answers in the browser (link fragment, memory, sessionStorage or the saved
 * copy), runs the engine and buildReport() here, and renders sections 0–7 in order. After the page
 * has loaded it makes no request: no fetch, no beacon, nothing (plan §9.4). No LLM runs.
 */

export interface WarisReportProps {
  /** rules.json, projected to the fields the report reads (content.ts). */
  rules: ReportRules;
  /** dalil.json then dalil-gaps.json, projected (content.ts). */
  dalil: ReportDalilRecord[];
}

/** Title, chip and the mandatory label, for the states that have no report model. */
function ShellHeader() {
  const { R } = useReportText();
  return (
    <header>
      <AiChip label={R(msg("laporan.kepala.chip"))} />
      <h1 className="mt-3 text-balance font-display text-3xl font-medium tracking-[-0.015em] text-ink sm:text-5xl">
        {R(msg("laporan.kepala.judul"))}
      </h1>
      <p className="mt-4 rounded-xl border-[1.5px] border-notice bg-notice-bg px-4 py-3 text-base font-medium text-ink">
        {R(msg("laporan.kepala.label"))}
      </p>
    </header>
  );
}

function Notice({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <section className="mt-8 rounded-2xl border border-hairline bg-white p-5 sm:p-8">
      <h2 className="font-display text-2xl font-medium text-ink">{title}</h2>
      <p className="mt-2 max-w-prose text-pretty text-lg text-ink-muted">{body}</p>
      {children ? <div className="mt-6 flex flex-wrap gap-3">{children}</div> : null}
    </section>
  );
}

export function WarisReport({ rules, dalil }: WarisReportProps) {
  const src = useAnswerSource();
  const t = useTranslations("Report.ui");

  if (src.status === "ada") return <ReportForAnswers key={src.key} src={src} rules={rules} dalil={dalil} />;
  return (
    <div className="waris-report">
      <ShellHeader />
      {src.status === "memuat" ? (
        <>
          <p className="mt-8 text-lg text-ink-muted" role="status">
            {t("memuat")}
          </p>
          <noscript>
            <p className="mt-4 text-lg text-ink">{t("perlu_js")}</p>
          </noscript>
        </>
      ) : (
        <Notice title={t(src.status === "rusak" ? "rusak_judul" : "kosong_judul")} body={t(src.status === "rusak" ? "rusak_teks" : "kosong_teks")}>
          <Link prefetch={false} href={warisHref.hitung()} className="btn-primary w-full sm:w-auto">
            {t("mulai")}
            <ArrowRight className="h-5 w-5" aria-hidden />
          </Link>
        </Notice>
      )}
    </div>
  );
}

type Ada = Extract<AnswerSource, { status: "ada" }>;

function ReportForAnswers({ src, rules, dalil }: { src: Ada; rules: ReportRules; dalil: ReportDalilRecord[] }) {
  const t = useTranslations("Report.ui");
  const { lookup } = useReportText();
  const date = useReportDate();
  const [amounts, setAmounts] = useState<Amounts | undefined>(src.amounts);
  const [panelOpen, setPanelOpen] = useState<boolean>(!!src.amounts);
  const rootRef = useRef<HTMLDivElement>(null);

  const computed = useMemo(() => computeReport(src.answers, amounts, rules, dalil, date ?? undefined), [src.answers, amounts, rules, dalil, date]);
  const fields = useMemo(() => rupiahFields(src.answers), [src.answers]);
  const vars = useMemo(() => messageVars(src.answers), [src.answers]);
  const notes = useMemo(() => {
    const out: Record<string, string> = {};
    for (const n of rules.rules) out[n.rule_id] = n.title_id;
    return out;
  }, [rules]);
  const exitInfo = useMemo(() => (computed.kind === "exit" ? exitRefs(computed.exit, rules, dalil) : null), [computed, rules, dalil]);
  const cards = useMemo(() => {
    const list: readonly DalilCard[] = computed.kind === "model" ? computed.model.dalilCards : (exitInfo?.cards ?? []);
    return new Map(list.map((c) => [c.id, c] as const));
  }, [computed, exitInfo]);

  // Print: every disclosure opens for the printout and closes again afterwards (plan §6: collapsed
  // on screen, expanded in print). The rupiah panel is not printed, so it is left alone; nor is the
  // screen report of a computed family, which prints as the compact Cetak.tsx instead.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let reopened: HTMLDetailsElement[] = [];
    const before = () => {
      reopened = Array.from(root.querySelectorAll("details")).filter((d) => !d.open && !d.closest('[data-print="hide"]'));
      for (const d of reopened) d.open = true;
    };
    const after = () => {
      for (const d of reopened) d.open = false;
      reopened = [];
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);

  const openRupiah = () => {
    flushSync(() => setPanelOpen(true));
    const el = document.getElementById("rupiah");
    if (el) {
      el.scrollIntoView({ block: "start" });
      const s = el.querySelector("summary");
      if (s instanceof HTMLElement) s.focus({ preventScroll: true });
    }
  };

  const fromLink =
    src.from === "tautan" ? (
      <p className="mt-6 flex items-start gap-2 rounded-xl border border-hairline bg-white px-4 py-3 text-base text-ink" data-print="hide">
        <Link2 className="mt-1 h-5 w-5 shrink-0 text-forest" aria-hidden />
        <span>{t("dari_tautan")}</span>
      </p>
    ) : null;

  return (
    <div ref={rootRef} className="waris-report">
      {computed.kind === "model" ? (
        <ModelView
          model={computed.model}
          qNotes={computed.notes}
          answers={src.answers}
          amounts={amounts}
          token={src.token}
          lookup={lookup}
          cards={cards}
          fromLink={fromLink}
          rupiah={
            <RupiahPanel
              initial={amounts}
              fields={fields}
              vars={vars}
              notes={notes}
              open={panelOpen}
              onOpenChange={setPanelOpen}
              onApply={setAmounts}
              applied={!!computed.model.ringkasan?.rupiahShown}
            />
          }
          onRupiah={openRupiah}
        />
      ) : (
        <>
          <ShellHeader />
          {fromLink}
          {computed.kind === "exit" ? (
            <CardsContext.Provider value={cards}>
              <ExitNotice exit={computed.exit} answers={src.answers} rules={exitInfo?.rules ?? []} />
              <div className="mt-8 flex flex-wrap gap-3" data-print="hide">
                <Link prefetch={false} href={hitungHref(src.token)} className="btn-primary w-full sm:w-auto">
                  <Pencil className="h-5 w-5" aria-hidden />
                  {t("ubah_jawaban")}
                </Link>
              </div>
              {amounts ? (
                <RupiahPanel
                  initial={amounts}
                  fields={fields}
                  vars={vars}
                  notes={notes}
                  open={panelOpen}
                  onOpenChange={setPanelOpen}
                  onApply={setAmounts}
                  applied={false}
                />
              ) : null}
              <DalilCardsOnly cards={exitInfo?.cards ?? []} />
            </CardsContext.Provider>
          ) : (
            <Notice
              title={t(computed.kind === "belum" ? "belum_judul" : "galat_judul")}
              body={t(computed.kind === "belum" ? "belum_teks" : "galat_teks")}
            >
              <Link prefetch={false} href={hitungHref(src.token)} className="btn-primary w-full sm:w-auto">
                {t(computed.kind === "belum" ? "lanjutkan" : "ubah_jawaban")}
                <ArrowRight className="h-5 w-5" aria-hidden />
              </Link>
            </Notice>
          )}
        </>
      )}
    </div>
  );
}

function ModelView({
  model,
  qNotes,
  answers,
  amounts,
  token,
  lookup,
  cards,
  fromLink,
  rupiah,
  onRupiah,
}: {
  model: ReportModel;
  qNotes: readonly QTextKey[];
  answers: Answers;
  amounts: Amounts | undefined;
  token: string | undefined;
  lookup: (key: ReportMsgKey) => string;
  cards: ReadonlyMap<string, DalilCard>;
  fromLink: ReactNode;
  rupiah: ReactNode;
  onRupiah: () => void;
}) {
  const dasarAnchors = useMemo(() => new Set((model.dalil?.rows ?? []).map((r) => r.anchor)), [model]);
  const g = model.ringkasan;
  // A computed report prints the compact printout (Cetak.tsx, plan §6 / M2.9) instead of the
  // screen sections; a refusal prints as it is shown.
  const compact = model.kind === "laporan" && !!g;
  const screen = (
    <>
      <Kepala k={model.kepala} />
      {fromLink}
      <ReportActions printAllowed={model.printAllowed} token={token} />
      {model.kind === "rujuk" || !g ? (
        <>
          {model.rujuk ? <Rujuk v={model.rujuk} /> : null}
          {amounts ? rupiah : null}
          <DalilCardsOnly cards={model.dalilCards} />
        </>
      ) : (
        <>
          <Ringkasan
            g={g}
            diff={model.catatan?.diff?.rows ?? []}
            dasarAnchors={dasarAnchors}
            onRupiah={g.rupiahNote ? null : onRupiah}
          />
          {g.rupiahNote ? null : rupiah}
          {model.diagram ? <Diagram d={model.diagram} g={g} /> : null}
          {model.tidakMendapat ? <TidakMendapat v={model.tidakMendapat} g={g} /> : null}
          {model.dalil ? <DalilSection v={model.dalil} allCards={model.dalilCards} /> : null}
          {model.catatan ? <Catatan c={model.catatan} g={g} qNotes={qNotes} /> : null}
          {model.langkah ? <Langkah v={model.langkah} /> : null}
        </>
      )}
      <Penutup v={model.penutup} />
      <ShareActions model={model} answers={answers} amounts={amounts} lookup={lookup} />
    </>
  );
  return (
    <CardsContext.Provider value={cards}>
      {compact ? (
        <>
          <div data-print="hide">{screen}</div>
          <Cetak model={model} qNotes={qNotes} />
        </>
      ) : (
        screen
      )}
    </CardsContext.Provider>
  );
}
