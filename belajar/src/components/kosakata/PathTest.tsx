"use client";

import clsx from "clsx";
import { ArrowLeft, Check, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { ClipButton, ClipPlayerProvider, useClipPlayerContext } from "@/components/library/ClipButton";
import { MixedText } from "@/components/library/MixedText";
import { useKosakataProgress } from "@/hooks/useKosakataProgress";
import { Link } from "@/i18n/navigation";
import { afterTest, batchTest, levelTest, nextBatch, NO_PROGRESS, parseBatchId, passMark, type Question, type TestItem } from "@/lib/kosakata-path-core";
import type { TestData } from "@/lib/kosakata-path-data";
import { kosakataBatchHref, kosakataPathHref } from "@/lib/routes";

import { AyahText, AyahTranslation } from "./AyahLineView";

type Run = { questions: Question[]; i: number; picked: number | null; score: number; missed: TestItem[]; done: boolean; passed: boolean };

const keyOf = (run: Run) => `q-${run.i}`;

/** The anonymous count: which test, and whether it passed (api/kosakata/hasil). Never waited on. */
function count(test: string, passed: boolean) {
  try {
    navigator.sendBeacon("/belajar/api/kosakata/hasil", new Blob([JSON.stringify({ test, passed })], { type: "application/json" }));
  } catch {
    // A count is not worth an error.
  }
}

function PartWord({ word }: { word: readonly [string, string, string] }) {
  return (
    <p lang="ar" dir="rtl" data-path-part-word="" className="arabic-inline ar-clear text-center text-ar-lg text-ink">
      {word[0]}
      <span data-path-mark="" className="text-forest">
        {word[1]}
      </span>
      {word[2]}
    </p>
  );
}

function Runner({ data, level, batch, passPercent, order, source }: { data: TestData; level: number; batch: number | null; passPercent: number; order: string[]; source: string }) {
  const t = useTranslations("KosakataPath");
  const locale = useLocale();
  const lang = locale === "en" ? "en" : "id";
  const player = useClipPlayerContext();
  const { progress, save } = useKosakataProgress();
  const [run, setRun] = useState<Run | null>(null);
  const title = batch === null ? t("test_title_level", { level }) : t("test_title_batch", { level, batch });
  const back = (
    <Link href={kosakataPathHref()} className="inline-flex items-center gap-1 text-sm font-semibold text-forest">
      <ArrowLeft aria-hidden className="size-4" />
      {t("back")}
    </Link>
  );

  // Built inside the click: questions are drawn at random, which a server render could not match, and
  // the click lets the first "listen" question sound.
  const start = () => {
    const p = progress ?? NO_PROGRESS;
    const questions =
      batch === null
        ? levelTest({ items: data.fresh, pool: data.pool, count: data.questions, isPart: data.isPart })
        : batchTest({ fresh: data.fresh, earlier: data.earlier, pool: data.pool, missed: p.missed, review: data.review, isPart: data.isPart });
    setRun({ questions, i: 0, picked: null, score: 0, missed: [], done: false, passed: false });
    window.scrollTo({ top: 0 });
    if (questions[0]?.kind === "hear") player?.play("q-0", questions[0].item.clip);
  };

  if (!run) {
    const total = batch === null ? Math.min(data.questions, data.fresh.length) : data.fresh.length + Math.min(data.review, data.earlier.length);
    const review = batch === null ? 0 : Math.min(data.review, data.earlier.length);
    return (
      <div data-path-test-intro="">
        {back}
        <h1 className="mt-4 font-display text-2xl font-medium">{title}</h1>
        <p className="mt-2 text-base text-ink-muted">{t("test_intro", { n: total, pct: passPercent, k: passMark(total, passPercent) })}</p>
        {review > 0 ? <p className="mt-1 text-base text-ink-muted">{t("test_intro_review", { r: review })}</p> : null}
        <button type="button" data-path-begin="" className="btn-primary mt-5" onClick={start}>
          {t("test_start")}
        </button>
      </div>
    );
  }

  const total = run.questions.length;

  if (run.done) {
    const pct = Math.round((run.score * 100) / total);
    const p = progress ?? NO_PROGRESS;
    const next = nextBatch(p, order);
    const nextName = next ? t("what_batch", { level: parseBatchId(next).level, batch: parseBatchId(next).batch }) : null;
    return (
      <div data-path-result={run.passed ? "passed" : "failed"}>
        {back}
        <section className="mt-4 rounded-2xl border border-hairline bg-white p-5">
          <p className="text-sm font-semibold text-forest">{title}</p>
          <p className={clsx("mt-1 font-display text-4xl font-medium tabular-nums", run.passed ? "text-forest" : "text-notice")}>{pct}%</p>
          <p className="mt-2 text-base text-ink">
            <strong className="font-semibold">{t(run.passed ? "pass" : "fail")}</strong> {t("score", { score: run.score, n: total })} {t("need", { pct: passPercent, k: passMark(total, passPercent), n: total })}
          </p>
          {run.passed && nextName ? <p className="mt-1 text-base text-ink">{t("opened", { what: nextName })}</p> : null}
          <div className="mt-4 flex flex-wrap gap-3">
            {run.passed ? (
              <>
                {next ? (
                  <Link href={kosakataBatchHref(parseBatchId(next).level, parseBatchId(next).batch)} data-path-go-next={next} className="btn-primary">
                    {t("go_next", { what: nextName ?? "" })}
                  </Link>
                ) : null}
                <Link href={kosakataPathHref()} className="btn-nav">
                  {t("to_map")}
                </Link>
              </>
            ) : (
              <>
                <button type="button" data-path-retry="" className="btn-primary" onClick={start}>
                  {t("retry")}
                </button>
                {batch !== null ? (
                  <Link href={kosakataBatchHref(level, batch)} className="btn-nav">
                    {t("relearn")}
                  </Link>
                ) : null}
              </>
            )}
          </div>
        </section>
        {run.missed.length > 0 ? (
          <section className="mt-5">
            <h2 className="text-lg font-semibold text-ink">{t("missed")}</h2>
            <ul className="mt-2 divide-y divide-hairline rounded-2xl border border-hairline bg-white">
              {run.missed.map((m) => (
                <li key={m.key} data-path-missed={m.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-3">
                  <p className="min-w-0 text-base text-ink">
                    <MixedText text={t("answer", { word: m.ar, translit: m.translit, meaning: m.meaning[lang] })} />
                  </p>
                  <ClipButton compact loc={m.loc} clip={m.clip} word={m.translit} />
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <p className="mt-4 text-base text-ink-muted">{t("all_right")}</p>
        )}
      </div>
    );
  }

  const q = run.questions[run.i];
  const item = q.item;
  const answered = run.picked !== null;
  const right = answered && q.options[run.picked as number].key === item.key;

  const pick = (i: number) => {
    if (run.picked !== null) return;
    const ok = q.options[i].key === item.key;
    setRun({ ...run, picked: i, score: run.score + (ok ? 1 : 0), missed: ok ? run.missed : [...run.missed, item] });
    // The voice on a right answer (narration rule 16): inside the click, so every browser lets it sound.
    if (ok) player?.play(keyOf(run), item.clip);
  };

  const advance = () => {
    player?.stop();
    if (run.i === total - 1) {
      const passed = run.score >= passMark(total, passPercent);
      const missedKeys = run.missed.map((m) => m.key);
      save(
        afterTest(progress ?? NO_PROGRESS, {
          passed,
          opens: data.opens,
          score: run.score,
          total,
          at: Date.now(),
          viaLevel: batch === null,
          missedKeys,
          rightKeys: run.questions.map((x) => x.item.key).filter((k) => !missedKeys.includes(k)),
        }),
      );
      count(data.id, passed);
      setRun({ ...run, done: true, passed });
    } else {
      const nextQ = run.questions[run.i + 1];
      setRun({ ...run, i: run.i + 1, picked: null });
      if (nextQ.kind === "hear") player?.play(`q-${run.i + 1}`, nextQ.item.clip);
    }
    window.scrollTo({ top: 0 });
  };

  return (
    <div data-path-question={item.key} data-q-kind={q.kind}>
      {back}
      <p className="mt-4 text-sm font-semibold text-forest">{title}</p>
      <p className="text-base text-ink-muted">{t("q_of", { i: run.i + 1, n: total })}</p>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={run.i + (answered ? 1 : 0)} className="mt-2 h-2 overflow-hidden rounded-full bg-paper-deep">
        <div style={{ width: `${((run.i + (answered ? 1 : 0)) * 100) / total}%` }} className="h-full bg-forest" />
      </div>
      <section className="mt-4 space-y-4 rounded-2xl border border-hairline bg-white p-5">
        <h1 className="text-lg font-semibold text-ink">{t(q.kind === "part" ? "q_part" : q.kind === "hear" ? "q_hear" : q.kind === "ayah" ? "q_ayah" : "q_word")}</h1>
        {q.kind === "part" && item.word ? <PartWord word={item.word} /> : null}
        {q.kind === "word" ? (
          <p lang="ar" dir="rtl" className="arabic-inline ar-clear text-center text-ar-xl text-ink">
            {item.ar}
          </p>
        ) : null}
        {q.kind === "ayah" && item.ayah ? <AyahText line={item.ayah} /> : null}
        {q.kind === "hear" && answered ? (
          <p lang="ar" dir="rtl" className="arabic-inline ar-clear text-center text-ar-xl text-ink">
            {item.ar}
          </p>
        ) : null}
        <div className="flex justify-center">
          <ClipButton loc={item.loc} clip={item.clip} word={item.translit} playerKey={keyOf(run)} />
        </div>
        <div className="space-y-2">
          {q.options.map((o, i) => {
            const isAnswer = o.key === item.key;
            const chosen = run.picked === i;
            return (
              <button
                key={o.key}
                type="button"
                disabled={answered}
                data-path-option={o.key}
                onClick={() => pick(i)}
                className={clsx(
                  "flex min-h-14 w-full items-center gap-3 rounded-2xl px-4 py-2 text-start text-lg",
                  !answered && "cursor-pointer border border-border-ui bg-white text-ink hover:bg-forest-tint",
                  answered && isAnswer && "border-2 border-forest bg-ok-bg font-semibold text-ink",
                  answered && !isAnswer && chosen && "border-2 border-notice bg-notice-bg text-ink",
                  answered && !isAnswer && !chosen && "border border-hairline bg-white text-ink-muted",
                )}
              >
                <span className="min-w-0 flex-1">{o.meaning[lang]}</span>
                {answered && isAnswer ? <Check aria-hidden className="size-5 shrink-0 text-forest" /> : null}
                {answered && !isAnswer && chosen ? <X aria-hidden className="size-5 shrink-0 text-notice" /> : null}
              </button>
            );
          })}
        </div>
      </section>
      {answered ? (
        <div className="mt-4">
          <div role="status" data-path-feedback={right ? "right" : "wrong"} className={clsx("rounded-2xl p-4", right ? "bg-ok-bg" : "bg-notice-bg")}>
            <p className={clsx("font-semibold", right ? "text-forest" : "text-notice")}>{t(right ? "right" : "wrong")}</p>
            <p className="mt-1 text-base text-ink">
              <MixedText text={t("answer", { word: item.ar, translit: item.translit, meaning: item.meaning[lang] })} />
            </p>
            {q.kind === "ayah" && item.ayah ? (
              <AyahTranslation line={item.ayah} reference={t("ayah_ref", { surah: item.ayah.surah, ayah: item.ayah.ayah })} source={source} />
            ) : null}
          </div>
          <button type="button" data-path-next-q="" className="btn-primary mt-4 w-full" onClick={advance}>
            {t(run.i === total - 1 ? "see_result" : "next_q")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** A batch's or a level's test. Nothing is sent but the anonymous count at the end. */
export function PathTest(props: { data: TestData; level: number; batch: number | null; passPercent: number; order: string[]; source: string }) {
  return (
    <ClipPlayerProvider prefetch={props.batch === null ? [] : props.data.fresh.map((i) => i.clip.url)}>
      <Runner {...props} />
    </ClipPlayerProvider>
  );
}
