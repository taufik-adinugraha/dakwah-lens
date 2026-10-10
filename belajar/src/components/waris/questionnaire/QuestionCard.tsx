"use client";

import { ArrowLeft, ArrowRight, Check, ChevronDown, Info } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";

import { A3_UI_OPTIONS, TIDAK_TAHU, type A3UiOption, type AnswerValue, type LP, type NodeView } from "@/lib/waris/questionnaire";

import { RuleList } from "./RuleList";
import type { RulePack } from "./rulePack";
import { Stepper } from "./Stepper";

type Vars = Record<string, string>;

/**
 * One question per screen (ux.md §4.1): the question in plain Indonesian, "Kenapa kami tanyakan
 * ini?" in the open, the answers as full-width 56px rows or 56px steppers, "Kembali" (48px) and
 * "Lanjut" (56px, the one primary action). "Tidak tahu" appears only where the node allows it
 * (plan §5.7). The parent keys this component by the node, so a new screen starts fresh.
 *
 * A3 is collected with the UI options k0–k9, the killer option k6 included; the parent passes the
 * raw selection to a3Route(), so k6 never reaches the reducer or storage (plan §5.6).
 */
export function QuestionCard({
  node,
  edit,
  vars,
  pack,
  canBack,
  newQuestion,
  showHint,
  onAnswer,
  onA3,
  onBack,
}: {
  node: NodeView;
  edit: boolean;
  vars: Vars;
  pack: RulePack;
  canBack: boolean;
  /** "Ada pertanyaan baru karena perubahan Anda." (ux.md §4.7 "Editing"). */
  newQuestion: boolean;
  /** The standing "wafat setelah pewaris" hint (ux.md §4.1 item 2). */
  showHint: boolean;
  onAnswer: (value: AnswerValue) => void;
  onA3: (selection: A3UiOption[]) => void;
  onBack: () => void;
}) {
  const t = useTranslations("Q");
  const question = t(node.text.tanya, vars);
  const whyCount = node.why.filter((id) => pack.rules[id] !== undefined).length;
  const nav = { canBack, onBack };

  let answer: ReactNode;
  if (node.id === "A3") answer = <A3Answer node={node} vars={vars} legend={question} onA3={onA3} nav={nav} />;
  else if (node.kind === "pilih" || node.kind === "peran") answer = <ChoiceAnswer node={node} vars={vars} legend={question} onAnswer={onAnswer} nav={nav} />;
  else if (node.kind === "pilih_banyak") answer = <MultiAnswer node={node} vars={vars} legend={question} onAnswer={onAnswer} nav={nav} />;
  else if (node.kind === "jumlah" && node.min === 0 && node.max === 1)
    answer = <YesNoCount node={node} legend={question} onAnswer={onAnswer} nav={nav} />;
  else if (node.kind === "jumlah") answer = <CountAnswer node={node} onAnswer={onAnswer} nav={nav} />;
  else answer = <PairAnswer node={node} onAnswer={onAnswer} nav={nav} />;

  return (
    <section aria-labelledby="waris-q-heading" className="max-w-2xl">
      {node.instance > 0 ? <p className="text-base font-semibold text-ink-muted">{t("ui.anak_ke", { n: node.instance })}</p> : null}
      <h2
        id="waris-q-heading"
        data-screen-heading
        tabIndex={-1}
        className="text-balance font-display text-2xl font-medium leading-snug text-ink sm:text-3xl"
      >
        {question}
      </h2>

      {edit ? (
        <p role="status" className="mt-3 rounded-xl border-[1.5px] border-dashed border-notice bg-notice-bg px-4 py-2 text-base text-ink">
          {t("ui.mengubah")}
        </p>
      ) : null}
      {newQuestion ? (
        <p role="status" className="mt-3 rounded-xl border-[1.5px] border-forest bg-forest-tint px-4 py-2 text-base font-semibold text-ink">
          {t("umum.pertanyaan_baru")}
        </p>
      ) : null}

      <div className="mt-4 max-w-prose border-l-4 border-forest-tint pl-4">
        <p className="text-base font-semibold text-ink">{t("umum.mengapa")}</p>
        <p className="text-base text-ink-muted">{t(node.text.mengapa, vars)}</p>
      </div>

      {node.text.bantuan ? (
        <p className="mt-3 flex max-w-prose gap-2 text-base text-ink">
          <Info className="mt-1 h-5 w-5 shrink-0 text-forest" aria-hidden />
          <span>
            <span className="sr-only">{t("ui.petunjuk")}: </span>
            {t(node.text.bantuan, vars)}
          </span>
        </p>
      ) : null}
      {showHint ? <p className="mt-2 max-w-prose text-base text-ink-soft">{t("umum.hint_wafat_setelah", vars)}</p> : null}

      {answer}

      {whyCount > 0 ? (
        <details className="mt-8 border-t border-hairline pt-2">
          <summary className="disclosure-row text-forest">
            {t("ui.dasar_aturan", { n: whyCount })}
            <ChevronDown className="chev h-5 w-5 shrink-0" aria-hidden />
          </summary>
          <p className="mb-3 max-w-prose text-base text-ink-muted">{t("ui.dasar_aturan_info")}</p>
          <RuleList ids={node.why} pack={pack} withDalil={false} />
        </details>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------------------------

type Nav = { canBack: boolean; onBack: () => void };

function NavRow({ nav, onNext, nextDisabled }: { nav: Nav; onNext: () => void; nextDisabled: boolean }) {
  const t = useTranslations("Q");
  return (
    <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
      {nav.canBack ? (
        <button type="button" className="btn-secondary w-full sm:w-auto" onClick={nav.onBack}>
          <ArrowLeft className="h-5 w-5" aria-hidden />
          {t("umum.kembali")}
        </button>
      ) : (
        <span aria-hidden />
      )}
      <button type="button" className="btn-primary w-full sm:w-auto" onClick={onNext} disabled={nextDisabled}>
        {t("umum.lanjut")}
        <ArrowRight className="h-5 w-5" aria-hidden />
      </button>
    </div>
  );
}

/** A full-width 56px answer row: a visible circle (radio) or square (checkbox) with a check mark
 *  when chosen, plus border and fill, so the state never rests on colour alone. */
function OptionRow({
  type,
  name,
  checked,
  onChange,
  text,
  dashed,
}: {
  type: "radio" | "checkbox";
  name: string;
  checked: boolean;
  onChange: () => void;
  text: string;
  dashed?: boolean;
}) {
  // The native radio/checkbox (visually hidden, focus ring on the label) announces the state.
  return (
    <label
      className={`flex min-h-14 cursor-pointer items-center gap-4 rounded-2xl border-[1.5px] px-4 py-3 text-lg leading-snug ${
        checked ? "border-forest bg-forest-tint font-semibold text-ink" : "border-border-ui bg-white text-ink"
      } ${dashed ? "border-dashed" : ""}`}
    >
      <input type={type} name={name} checked={checked} onChange={onChange} className="sr-only" />
      <span
        aria-hidden
        className={`flex h-7 w-7 shrink-0 items-center justify-center border-2 ${type === "radio" ? "rounded-full" : "rounded-md"} ${
          checked ? "border-forest bg-forest text-paper" : "border-border-ui bg-white"
        }`}
      >
        {checked ? <Check className="h-5 w-5" strokeWidth={3} /> : null}
      </span>
      <span className="min-w-0 flex-1 text-pretty">{text}</span>
    </label>
  );
}

const isLP = (v: AnswerValue | undefined): v is LP => typeof v === "object" && v !== null && !Array.isArray(v);
const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);

// ---------------------------------------------------------------------------------------------
// pilih / peran: one choice
// ---------------------------------------------------------------------------------------------

function ChoiceAnswer({
  node,
  vars,
  legend,
  onAnswer,
  nav,
}: {
  node: NodeView;
  vars: Vars;
  legend: string;
  onAnswer: (v: AnswerValue) => void;
  nav: Nav;
}) {
  const t = useTranslations("Q");
  // A stored answer the node no longer offers (an earlier answer changed) starts unselected.
  const v = node.value;
  const offered = typeof v === "string" && (node.options.some((o) => o.id === v) || (v === TIDAK_TAHU && node.allowUnknown));
  const [sel, setSel] = useState<string | null>(offered ? v : null);
  return (
    <>
      <fieldset className="mt-6">
        <legend className="sr-only">{legend}</legend>
        <p className="text-base text-ink-muted">{t("ui.pilih_satu")}</p>
        <div className="mt-3 space-y-3">
          {node.options.map((o) => (
            <OptionRow key={o.id} type="radio" name={node.key} checked={sel === o.id} onChange={() => setSel(o.id)} text={t(o.text, vars)} />
          ))}
          {node.allowUnknown ? (
            <div className="pt-2">
              <OptionRow type="radio" name={node.key} checked={sel === TIDAK_TAHU} onChange={() => setSel(TIDAK_TAHU)} text={t("umum.tidak_tahu")} dashed />
              <p className="mt-2 max-w-prose text-base text-ink-soft">{t("ui.tidak_tahu_info")}</p>
            </div>
          ) : null}
        </div>
      </fieldset>
      <NavRow nav={nav} onNext={() => (sel !== null ? onAnswer(sel) : undefined)} nextDisabled={sel === null} />
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// pilih_banyak: several; "Tidak ada" is the empty selection
// ---------------------------------------------------------------------------------------------

type Multi = { sel: string[]; none: boolean; unknown: boolean };

function initialMulti(v: AnswerValue | undefined): Multi {
  if (v === TIDAK_TAHU) return { sel: [], none: false, unknown: true };
  if (Array.isArray(v)) {
    const xs = v as readonly string[];
    return xs.length === 0 ? { sel: [], none: true, unknown: false } : { sel: [...xs], none: false, unknown: false };
  }
  return { sel: [], none: false, unknown: false };
}

function toggle(m: Multi, id: string): Multi {
  const has = m.sel.includes(id);
  return { sel: has ? m.sel.filter((x) => x !== id) : [...m.sel, id], none: false, unknown: false };
}

function MultiAnswer({
  node,
  vars,
  legend,
  onAnswer,
  nav,
}: {
  node: NodeView;
  vars: Vars;
  legend: string;
  onAnswer: (v: AnswerValue) => void;
  nav: Nav;
}) {
  const t = useTranslations("Q");
  const [m, setM] = useState<Multi>(() => {
    const init = initialMulti(node.value);
    // keep only options the node still offers
    return { ...init, sel: init.sel.filter((x) => node.options.some((o) => o.id === x)), unknown: init.unknown && node.allowUnknown };
  });
  const chosen = m.sel.length > 0 || m.none || m.unknown;
  const submit = () => {
    if (m.unknown) onAnswer(TIDAK_TAHU);
    else if (m.none) onAnswer([]);
    else onAnswer(node.options.map((o) => o.id).filter((id) => m.sel.includes(id)));
  };
  return (
    <>
      <fieldset className="mt-6">
        <legend className="sr-only">{legend}</legend>
        <p className="text-base text-ink-muted">{t("ui.pilih_banyak")}</p>
        <div className="mt-3 space-y-3">
          {node.options.map((o) => (
            <OptionRow
              key={o.id}
              type="checkbox"
              name={`${node.key}-${o.id}`}
              checked={m.sel.includes(o.id)}
              onChange={() => setM((x) => toggle(x, o.id))}
              text={t(o.text, vars)}
            />
          ))}
          <OptionRow
            type="checkbox"
            name={`${node.key}-tidak-ada`}
            checked={m.none}
            onChange={() => setM((x) => ({ sel: [], none: !x.none, unknown: false }))}
            text={t("umum.tidak_ada")}
          />
          {node.allowUnknown ? (
            <div className="pt-2">
              <OptionRow
                type="checkbox"
                name={`${node.key}-tidak-tahu`}
                checked={m.unknown}
                onChange={() => setM((x) => ({ sel: [], none: false, unknown: !x.unknown }))}
                text={t("umum.tidak_tahu")}
                dashed
              />
              <p className="mt-2 max-w-prose text-base text-ink-soft">{t("ui.tidak_tahu_info")}</p>
            </div>
          ) : null}
        </div>
      </fieldset>
      <NavRow nav={nav} onNext={submit} nextDisabled={!chosen} />
    </>
  );
}

/** A3 with the UI options k0–k9 (k0 "Tidak ada satu pun" first, 56px; k6 handled by the parent). */
function A3Answer({
  node,
  vars,
  legend,
  onA3,
  nav,
}: {
  node: NodeView;
  vars: Vars;
  legend: string;
  onA3: (selection: A3UiOption[]) => void;
  nav: Nav;
}) {
  const t = useTranslations("Q");
  // Re-editing A3 starts from the stored answer, which can never contain k6.
  const [sel, setSel] = useState<A3UiOption[]>(() => {
    const v = node.value;
    if (!Array.isArray(v)) return [];
    const xs = v as readonly string[];
    return xs.length === 0 ? ["k0"] : A3_UI_OPTIONS.filter((o) => xs.includes(o));
  });
  const pick = (o: A3UiOption) =>
    setSel((xs) => {
      if (o === "k0") return xs.includes("k0") ? [] : ["k0"];
      const rest = xs.filter((x) => x !== "k0");
      return rest.includes(o) ? rest.filter((x) => x !== o) : [...rest, o];
    });
  return (
    <>
      <fieldset className="mt-6">
        <legend className="sr-only">{legend}</legend>
        <p className="text-base text-ink-muted">{t("ui.pilih_banyak_a3")}</p>
        <div className="mt-3 space-y-3">
          {A3_UI_OPTIONS.map((o) => (
            <OptionRow
              key={o}
              type="checkbox"
              name={`${node.key}-${o}`}
              checked={sel.includes(o)}
              onChange={() => pick(o)}
              text={t(`A3.opsi.${o}`, vars)}
            />
          ))}
        </div>
      </fieldset>
      <NavRow nav={nav} onNext={() => onA3(sel)} nextDisabled={sel.length === 0} />
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// jumlah / jumlah_lp: steppers
// ---------------------------------------------------------------------------------------------

function UnknownButton({ onAnswer }: { onAnswer: (v: AnswerValue) => void }) {
  const t = useTranslations("Q");
  return (
    <div className="mt-4">
      <button type="button" className="btn-secondary w-full border-dashed! sm:w-auto" onClick={() => onAnswer(TIDAK_TAHU)}>
        {t("umum.tidak_tahu")}
      </button>
      <p className="mt-2 max-w-prose text-base text-ink-soft">{t("ui.tidak_tahu_info")}</p>
    </div>
  );
}

/** A count bounded to 0–1 asked as a yes/no question (B3 with one spouse: "Apakah … beragama
 *  Islam?"): Ya = 1, Tidak = 0; the stored answer stays the count the model expects. */
function YesNoCount({ node, legend, onAnswer, nav }: { node: NodeView; legend: string; onAnswer: (v: AnswerValue) => void; nav: Nav }) {
  const t = useTranslations("Q");
  const [sel, setSel] = useState<number | "tt" | null>(() =>
    node.value === TIDAK_TAHU && node.allowUnknown ? "tt" : node.value === 0 || node.value === 1 ? node.value : null,
  );
  return (
    <>
      <fieldset className="mt-6">
        <legend className="sr-only">{legend}</legend>
        <p className="text-base text-ink-muted">{t("ui.pilih_satu")}</p>
        <div className="mt-3 space-y-3">
          <OptionRow type="radio" name={node.key} checked={sel === 1} onChange={() => setSel(1)} text={t("umum.ya")} />
          <OptionRow type="radio" name={node.key} checked={sel === 0} onChange={() => setSel(0)} text={t("umum.tidak")} />
          {node.allowUnknown ? (
            <div className="pt-2">
              <OptionRow type="radio" name={node.key} checked={sel === "tt"} onChange={() => setSel("tt")} text={t("umum.tidak_tahu")} dashed />
              <p className="mt-2 max-w-prose text-base text-ink-soft">{t("ui.tidak_tahu_info")}</p>
            </div>
          ) : null}
        </div>
      </fieldset>
      <NavRow nav={nav} onNext={() => (sel === null ? undefined : onAnswer(sel === "tt" ? TIDAK_TAHU : sel))} nextDisabled={sel === null} />
    </>
  );
}

function CountAnswer({ node, onAnswer, nav }: { node: NodeView; onAnswer: (v: AnswerValue) => void; nav: Nav }) {
  const t = useTranslations("Q");
  const [n, setN] = useState<number>(() => clamp(typeof node.value === "number" ? node.value : node.min, node.min, node.max));
  return (
    <>
      <div className="mt-6">
        <p className="text-base text-ink-muted">{t("ui.jumlah_petunjuk")}</p>
        <div className="mt-3 max-w-sm">
          <Stepper id={`${node.key}-n`} label={t("ui.jumlah")} value={n} min={node.min} max={node.max} onChange={(x) => setN(clamp(x, node.min, node.max))} />
        </div>
        {node.allowUnknown ? <UnknownButton onAnswer={onAnswer} /> : null}
      </div>
      <NavRow nav={nav} onNext={() => onAnswer(n)} nextDisabled={false} />
    </>
  );
}

function PairAnswer({ node, onAnswer, nav }: { node: NodeView; onAnswer: (v: AnswerValue) => void; nav: Nav }) {
  const t = useTranslations("Q");
  const maxL = node.maxLP ? node.maxLP.L : node.max;
  const maxP = node.maxLP ? node.maxLP.P : node.max;
  const [v, setV] = useState<LP>(() => {
    const x = isLP(node.value) ? node.value : { L: 0, P: 0 };
    return { L: clamp(x.L, 0, maxL), P: clamp(x.P, 0, maxP) };
  });
  // A3b (how many adopted children) needs at least one; every other count may be zero.
  const needOne = node.id === "A3b";
  const valid = !needOne || v.L + v.P > 0;
  return (
    <>
      <div className="mt-6">
        <p className="text-base text-ink-muted">{t("ui.jumlah_petunjuk")}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Stepper
            id={`${node.key}-L`}
            label={t("umum.laki")}
            value={v.L}
            min={0}
            max={maxL}
            onChange={(x) => setV((cur) => ({ ...cur, L: clamp(x, 0, maxL) }))}
          />
          <Stepper
            id={`${node.key}-P`}
            label={t("umum.perempuan")}
            value={v.P}
            min={0}
            max={maxP}
            onChange={(x) => setV((cur) => ({ ...cur, P: clamp(x, 0, maxP) }))}
          />
        </div>
        {needOne && !valid ? <p className="mt-2 text-base text-ink-muted">{t("ui.harus_ada")}</p> : null}
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          {!needOne ? (
            <button type="button" className="btn-secondary w-full sm:w-auto" onClick={() => onAnswer({ L: 0, P: 0 })}>
              {t("umum.tidak_ada")}
            </button>
          ) : null}
        </div>
        {node.allowUnknown ? <UnknownButton onAnswer={onAnswer} /> : null}
      </div>
      <NavRow nav={nav} onNext={() => onAnswer(v)} nextDisabled={!valid} />
    </>
  );
}
