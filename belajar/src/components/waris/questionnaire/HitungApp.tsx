"use client";

import { ArrowLeft, ArrowRight, ChevronDown, Link2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { flushSync } from "react-dom";

import { handOffToReport } from "@/components/waris/report/source";
import { useRouter } from "@/i18n/navigation";
import { warisHref } from "@/lib/routes";
import {
  EXITS,
  a3Route,
  answerCodeOf,
  answerSummary,
  evaluate,
  familyPreview,
  initialState,
  messageVars,
  modeOf,
  nodeView,
  progress,
  reduce,
  shareToken,
  view,
  walk,
  type A3UiOption,
  type AnswerValue,
  type Answers,
  type ExitHit,
  type QKey,
  type QState,
  type SectionId,
} from "@/lib/waris/questionnaire";

import { ReviewList, type AnswerRow } from "./AnswerList";
import { ExitPage } from "./ExitPage";
import { FamilyTree } from "./FamilyTree";
import { answerParts, answersBefore, joinList, lowerFirst, peopleCount, stepNumber, treeRows, type TextRef } from "./format";
import { scrollBehavior } from "./motion";
import { ProgressLine } from "./ProgressLine";
import { QuestionCard } from "./QuestionCard";
import type { RulePack } from "./rulePack";
import { SavePanel } from "./SavePanel";
import { clearDraft, dropFragment, readBoot, serverBoot, subscribeBoot, writeDraft, type Boot } from "./storage";

/**
 * "Hitung waris keluarga saya" (plan §5; architecture.md §6): the one client component of
 * /waris/hitung. useReducer over the questionnaire machine (lib/waris/questionnaire): the answers
 * are the only state, and the path, the screen, the family tree and the outcome are derived.
 *
 * Privacy (plan §9.4): no server call of any kind. The working answers live in memory and in
 * sessionStorage (autosaved from an effect, never the cursor); localStorage only after "Simpan di
 * perangkat ini". The killer option (A3 k6) never enters the reducer: a3Route() sends it to the
 * E-BUNUH page, held in this component's memory only, with no printout and nothing stored.
 *
 * Hand-off to /waris/laporan: in memory (report/source.ts handOffToReport, for the client-side
 * navigation) and in sessionStorage under belajar:v1:waris:draft as { v: 1, answers, at: null };
 * only when this tab cannot store does the link also carry them in the URL fragment (#j=v1.…,
 * never a query string, never with rupiah), so a reload of the report still works. Exits the
 * full evaluation finds (e.g. two «Tidak tahu» that both matter) are shown here, before any
 * navigation. "#baru" (warisHref.hitung({ baru: true }), "Hitung untuk beliau") starts fresh.
 */
export function HitungApp({ pack, locale, backHref }: { pack: RulePack; locale: string; backHref: string }) {
  // Server and hydration render "loading"; the client then starts from the link, the tab's
  // draft or a saved copy (useSyncExternalStore: no hydration mismatch, no setState in effects).
  const boot = useSyncExternalStore(subscribeBoot, readBoot, serverBoot);
  if (boot.kind === "memuat") return <Loading />;
  return <Session boot={boot} pack={pack} locale={locale} backHref={backHref} />;
}

function Loading() {
  const t = useTranslations("Q");
  return (
    <p role="status" className="text-base text-ink-muted">
      {t("ui.memuat")}
    </p>
  );
}

function initState(b: Boot): QState {
  return b.kind === "tautan" || b.kind === "sesi" ? reduce(initialState(), { type: "muat", answers: b.answers }) : initialState();
}

/** Sections whose questions are about who was alive at the death (ux.md §4.1 item 2). */
const HINT_SECTIONS: ReadonlySet<SectionId> = new Set<SectionId>(["pasangan", "anak", "orang_tua", "saudara", "kerabat"]);

function Session({ boot, pack, locale, backHref }: { boot: Boot; pack: RulePack; locale: string; backHref: string }) {
  const t = useTranslations("Q");
  const router = useRouter();
  const [state, dispatch] = useReducer(reduce, boot, initState);
  // The boot decision is taken once: later boot snapshots are this page's own writes.
  const [fromLink] = useState(boot.kind === "tautan");
  const [fresh] = useState(boot.kind === "baru");
  const [resume, setResume] = useState<Answers | null>(boot.kind === "tersimpan" ? boot.answers : null);
  const [bunuh, setBunuh] = useState(false);
  const [finalExit, setFinalExit] = useState<{ exit: ExitHit; answers: Answers } | null>(null);
  const [last, setLast] = useState<{ key: QKey; prev: AnswerValue | undefined } | null>(null);
  const [edited, setEdited] = useState(false);
  const [rev, setRev] = useState(0);
  const [printedOn, setPrintedOn] = useState<string | null>(null);

  // Autosave the working copy (never the cursor, never k6: QState cannot hold it), and keep the
  // report's in-memory copy equal to it (the report prefers memory over sessionStorage, so a
  // stale hand-off must never outlive an edit). A fresh start ("#baru") leaves the earlier
  // family's draft alone until the first answer replaces it.
  useEffect(() => {
    if (fresh && rev === 0) return;
    writeDraft(state.answers);
    handOffToReport(state.answers);
  }, [state.answers, fresh, rev]);
  // A #j= link carries family data, and #baru has done its job: take them out of the address bar.
  useEffect(() => {
    if (fromLink || fresh) dropFragment();
  }, [fromLink, fresh]);

  const w = walk(state.answers);
  const v = view(state);
  const vars = messageVars(state.answers);
  const text = (r: TextRef) => t(r.key, { ...vars, ...(r.values ?? {}) });

  // ── handlers (events only: nothing here runs during render) ────────────────────────────────
  const answer = (key: QKey, value: AnswerValue, wasEdit: boolean) => {
    setLast({ key, prev: state.answers[key] });
    setEdited(wasEdit);
    setFinalExit(null);
    setRev((r) => r + 1);
    dispatch({ type: "jawab", key, value });
  };
  const onA3 = (selection: A3UiOption[], wasEdit: boolean) => {
    const r = a3Route(selection);
    if (r.kind === "bunuh") {
      setBunuh(true); // nothing is dispatched, stored or printed (plan §5.6, §9.4)
      return;
    }
    answer("A3", r.value, wasEdit);
  };
  const back = () => {
    setEdited(false);
    dispatch({ type: "kembali" });
  };
  const ubah = (key: QKey) => {
    setEdited(false);
    setFinalExit(null);
    dispatch({ type: "ubah", key });
  };
  const ulang = () => {
    clearDraft();
    setFinalExit(null);
    setLast(null);
    setEdited(false);
    setBunuh(false);
    setRev((r) => r + 1);
    dispatch({ type: "ulang" });
  };
  const lihatLaporan = () => {
    const ev = evaluate(state.answers);
    if (ev.kind === "keluar") {
      setFinalExit({ exit: ev.exit, answers: state.answers });
      return;
    }
    if (ev.kind !== "laporan") return;
    handOffToReport(state.answers);
    const stored = writeDraft(state.answers);
    router.push(stored ? warisHref.laporan() : warisHref.laporan(shareToken(state)));
  };
  const cetak = () => {
    const on = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "id-ID", { dateStyle: "long" }).format(new Date());
    flushSync(() => setPrintedOn(on));
    window.print();
  };

  // ── focus the new screen's heading (keyboard and screen-reader users land on the question) ──
  // The full evaluation's exit, while the answers it was computed for are still the answers.
  const shownFinal = finalExit !== null && finalExit.answers === state.answers && v.kind === "ringkasan" ? finalExit : null;
  const screenKey = bunuh
    ? "bunuh"
    : resume
      ? "lanjutkan"
      : v.kind === "tanya"
        ? `t:${v.node.key}:${v.edit ? 1 : 0}`
        : v.kind === "keluar"
          ? `k:${v.exit.id}`
          : shownFinal
            ? `f:${shownFinal.exit.id}`
            : "ringkasan";
  const mainRef = useRef<HTMLDivElement>(null);
  const firstScreen = useRef(true);
  useEffect(() => {
    if (firstScreen.current) {
      firstScreen.current = false;
      return;
    }
    const h = mainRef.current?.querySelector<HTMLElement>("[data-screen-heading]");
    if (!h) return;
    h.focus({ preventScroll: true });
    h.scrollIntoView({ block: "start", behavior: scrollBehavior() });
  }, [screenKey]);

  // ── the live family tree ───────────────────────────────────────────────────────────────────
  const preview = familyPreview(state);
  const lastKey = last?.key ?? null;
  const lastPrev = last?.prev;
  const beforeAnswers = useMemo(() => answersBefore(state.answers, lastKey, lastPrev), [state.answers, lastKey, lastPrev]);
  const previewBefore = useMemo(() => (beforeAnswers ? familyPreview({ v: 1, answers: beforeAnswers, at: null }) : null), [beforeAnswers]);
  const hasPewaris = typeof w.eff.A2 === "string";
  const rows = treeRows(preview, previewBefore, hasPewaris, (key) => w.steps.some((s) => s.key === key));
  const label = (role: string) => (role === "pewaris" ? t("ui.keluarga_pewaris", vars) : t(`peran.${role}`));
  const dan = t("ui.dan");
  const summary = joinList(
    [
      ...(hasPewaris ? [vars.Pewaris] : []),
      ...preview.map((p) => t("ui.keluarga_ringkas", { n: p.count, label: lowerFirst(label(p.role)) })),
    ],
    dan,
  );
  const skipped = w.notAsked.map((na) => {
    const kelompok = t(`kelompok.${na.group}`);
    return na.because.length > 0
      ? t("lewati.karena", { kelompok, penghalang: joinList(na.because.map((r) => lowerFirst(t(`peran.${r}`))), dan) })
      : t("lewati.tanpa_alasan", { kelompok });
  });
  const tree = (
    <FamilyTree rows={rows} skipped={skipped} summary={summary} label={label} onEdit={(k) => ubah(k)} growKey={String(rev)} />
  );
  const phoneTree = (
    <details className="mt-8 rounded-2xl border border-hairline bg-white lg:hidden print:hidden">
      <summary className="disclosure-row min-h-14 px-4">
        <span>{t("ui.keluarga_bar", { n: peopleCount(preview) })}</span>
        <ChevronDown className="chev h-5 w-5 shrink-0" aria-hidden />
      </summary>
      <div className="px-4 pb-4">{tree}</div>
    </details>
  );

  // ── answers as worded rows (review screen, printouts) ──────────────────────────────────────
  const questionText = (key: QKey): string | null => {
    const nv = nodeView(w, key);
    if (!nv) return null;
    const q = t(nv.text.tanya, vars);
    return nv.instance > 0 ? `${t("ui.anak_ke", { n: nv.instance })}: ${q}` : q;
  };
  const answerRows = (): AnswerRow[] =>
    answerSummary(state).flatMap((s) => {
      const nv = nodeView(w, s.key, s.value);
      const question = questionText(s.key);
      if (!nv || question === null) return [];
      return [{ key: s.key, section: s.section, question, answer: answerParts(nv, s.value).map(text).join(", ") }];
    });

  // ── the screen ─────────────────────────────────────────────────────────────────────────────
  let content: ReactNode;
  let showTree = false;
  if (resume) {
    content = (
      <section aria-labelledby="waris-resume-heading" className="max-w-2xl">
        <h2 id="waris-resume-heading" data-screen-heading tabIndex={-1} className="text-balance font-display text-2xl font-medium text-ink sm:text-3xl">
          {t("ui.lanjutkan_judul")}
        </h2>
        <p className="mt-3 max-w-prose text-base text-ink">{t("ui.lanjutkan_isi")}</p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            className="btn-primary w-full sm:w-auto"
            onClick={() => {
              setResume(null);
              setRev((r) => r + 1);
              dispatch({ type: "muat", answers: resume });
            }}
          >
            {t("ui.lanjutkan")}
          </button>
          <button type="button" className="btn-secondary w-full sm:w-auto" onClick={() => setResume(null)}>
            {t("ui.mulai_baru")}
          </button>
        </div>
      </section>
    );
  } else if (bunuh) {
    content = (
      <ExitPage
        exit={{ id: "E-BUNUH", at: "A3" }}
        print={false}
        lanjutSimulasi={false}
        vars={vars}
        pack={pack}
        questionText={questionText}
        answers={null}
        code={null}
        printedOn={null}
        backHref={backHref}
        onUbah={() => setBunuh(false)}
        onUbahKey={null}
        onSimulasi={() => undefined}
        onPrint={() => undefined}
      />
    );
  } else if (v.kind === "tanya") {
    showTree = true;
    const keys = w.steps.map((s) => s.key);
    const canBack = v.edit ? keys.indexOf(v.node.key) > 0 : keys.length > 0;
    const wasEdit = v.edit;
    content = (
      <>
        <ProgressLine sections={progress(state)} step={stepNumber(w, v.node.key)} />
        <div className="mt-6">
          <QuestionCard
            key={`${v.node.key}:${v.edit ? "ubah" : "baru"}`}
            node={v.node}
            edit={v.edit}
            vars={vars}
            pack={pack}
            canBack={canBack}
            newQuestion={edited && !v.edit}
            showHint={HINT_SECTIONS.has(v.node.section) && modeOf(w.eff) === "wafat"}
            onAnswer={(value) => answer(v.node.key, value, wasEdit)}
            onA3={(sel) => onA3(sel, wasEdit)}
            onBack={back}
          />
        </div>
        {phoneTree}
        <div className="mt-8">
          <SavePanel answers={state.answers} onUlang={ulang} />
        </div>
      </>
    );
  } else if (v.kind === "keluar") {
    content = (
      <ExitPage
        exit={v.exit}
        print={v.print}
        lanjutSimulasi={v.lanjutSimulasi}
        vars={vars}
        pack={pack}
        questionText={questionText}
        answers={v.print ? answerRows() : null}
        code={answerCodeOf(w.eff)}
        printedOn={printedOn}
        backHref={backHref}
        onUbah={back}
        onUbahKey={ubah}
        onSimulasi={() => {
          setRev((r) => r + 1);
          dispatch({ type: "lanjut_simulasi" });
        }}
        onPrint={cetak}
      />
    );
  } else if (shownFinal) {
    const print = EXITS[shownFinal.exit.id].print;
    content = (
      <ExitPage
        exit={shownFinal.exit}
        print={print}
        lanjutSimulasi={false}
        vars={vars}
        pack={pack}
        questionText={questionText}
        answers={print ? answerRows() : null}
        code={answerCodeOf(w.eff)}
        printedOn={printedOn}
        backHref={backHref}
        onUbah={() => setFinalExit(null)}
        onUbahKey={ubah}
        onSimulasi={() => undefined}
        onPrint={cetak}
      />
    );
  } else {
    showTree = true;
    content = (
      <>
        <ProgressLine sections={progress(state)} step={null} />
        <section aria-labelledby="waris-review-heading" className="mt-6 max-w-2xl">
          <h2 id="waris-review-heading" data-screen-heading tabIndex={-1} className="text-balance font-display text-2xl font-medium text-ink sm:text-3xl">
            {t("umum.ringkasan_judul")}
          </h2>
          <p className="mt-2 max-w-prose text-base text-ink-muted">{t("ui.ringkasan_intro")}</p>
          <div className="mt-6">
            <ReviewList rows={answerRows()} onUbah={ubah} />
          </div>
          <p className="mt-6 max-w-prose text-base text-ink-muted">{t("ui.laporan_info")}</p>
          <div className="mt-4 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button type="button" className="btn-secondary w-full sm:w-auto" onClick={back}>
              <ArrowLeft className="h-5 w-5" aria-hidden />
              {t("umum.kembali")}
            </button>
            <button type="button" className="btn-primary w-full sm:w-auto" onClick={lihatLaporan}>
              {t("umum.lihat_laporan")}
              <ArrowRight className="h-5 w-5" aria-hidden />
            </button>
          </div>
        </section>
        {phoneTree}
        <div className="mt-8">
          <SavePanel answers={state.answers} onUlang={ulang} />
        </div>
      </>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div ref={mainRef} className="min-w-0">
        {fromLink && rev === 0 && !resume ? (
          <p role="status" className="mb-4 flex max-w-prose gap-2 rounded-xl bg-forest-tint px-4 py-3 text-base text-ink">
            <Link2 className="mt-1 h-5 w-5 shrink-0 text-forest" aria-hidden />
            <span>{t("ui.dari_tautan")}</span>
          </p>
        ) : null}
        {content}
      </div>
      {showTree ? (
        <aside aria-labelledby="waris-tree-heading" className="hidden lg:block print:hidden">
          <div className="sticky rounded-2xl border border-hairline bg-white p-4" style={{ top: "calc(env(safe-area-inset-top, 0px) + 5.5rem)" }}>
            <h2 id="waris-tree-heading" className="text-lg font-semibold text-ink">
              {t("ui.keluarga_judul")}
            </h2>
            <div className="mt-3">{tree}</div>
          </div>
        </aside>
      ) : null}
    </div>
  );
}
