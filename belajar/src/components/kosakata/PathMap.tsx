"use client";

import clsx from "clsx";
import { Check, Lock } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { MixedText } from "@/components/library/MixedText";
import { useKosakataProgress } from "@/hooks/useKosakataProgress";
import { Link } from "@/i18n/navigation";
import { percent } from "@/lib/kosakata-core";
import { batchId, batchOrder, coveredPercent, isOpen, nextBatch, NO_PROGRESS, parseBatchId } from "@/lib/kosakata-path-core";
import type { MapLevel } from "@/lib/kosakata-path-data";
import { kosakataBatchHref, kosakataLevelTestHref } from "@/lib/routes";

/**
 * The map of the learning path (operator 2026-11-03): each level's batches, what is open, and how much
 * of the Qur'an's words the learner's passed batches cover. The band is to scale: a level's width is
 * the share of the Qur'an's words it adds, so it shows at a glance why the first levels come first.
 * Only the level the learner is in shows its batches open; a level of 100 batches would bury the rest.
 */
export function PathMap({ levels, partCount, attachedShare, totalTokens, passPercent }: { levels: MapLevel[]; partCount: number; attachedShare: number; totalTokens: number; passPercent: number }) {
  const t = useTranslations("KosakataPath");
  const locale = useLocale();
  const nf = new Intl.NumberFormat(locale);
  const pct = (x: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(x);
  const { progress, clear } = useKosakataProgress();
  const [armed, setArmed] = useState(false);
  const p = progress ?? NO_PROGRESS;
  const order = batchOrder(levels);
  const next = nextBatch(p, order);
  const nextLevel = next ? parseBatchId(next).level : null;
  const covered = coveredPercent(p, levels, totalTokens);
  const words = levels.filter((l) => l.n > 0);
  const first = words[0];
  const allPassed = (l: MapLevel) => Array.from({ length: l.batches }, (_, i) => batchId(l.n, i + 1)).every((id) => id in p.passed);

  return (
    <>
      <div className="mt-6">
        <div
          role="img"
          aria-label={t("band_label", { levels: words.map((l) => t("band_level", { n: l.n, pct: pct(percent(l.cum ?? 0)) })).join(", ") })}
          data-path-band=""
          className="flex h-9 overflow-hidden rounded-xl border border-teal-line bg-paper-deep"
        >
          {words.map((l, i) => {
            const before = i === 0 ? 0 : (words[i - 1].cum ?? 0);
            return (
              <span
                key={l.n}
                style={{ width: `${((l.cum ?? 0) - before) / 100}%` }}
                className={clsx("flex min-w-0 items-center justify-center overflow-hidden border-e border-white text-xs font-semibold", allPassed(l) ? "bg-forest text-paper" : "bg-forest-tint text-forest")}
              >
                L{l.n}
              </span>
            );
          })}
        </div>
        <p className="mt-2 text-sm text-ink-muted" data-path-covered={Math.round(covered)}>
          {covered > 0 ? t("cov", { pct: pct(covered) }) : t("cov_none", { pct: pct(percent(first.cum ?? 0)) })}
        </p>
      </div>

      <div className="mt-5">
        {next ? (
          <Link href={kosakataBatchHref(parseBatchId(next).level, parseBatchId(next).batch)} data-path-continue={next} className="btn-primary">
            {t("continue", { level: parseBatchId(next).level, batch: parseBatchId(next).batch })}
          </Link>
        ) : (
          <p className="font-semibold text-forest">{t("all_done")}</p>
        )}
      </div>

      <div className="mt-6 space-y-3">
        {levels.map((l) => (
          <details key={l.n} open={l.n === (nextLevel ?? 0)} data-path-level={l.n} className="rounded-2xl border border-hairline bg-white p-4">
            <summary className="cursor-pointer">
              <span className="text-lg font-semibold text-ink">
                {l.n === 0 ? t("level0_title") : t("level_title", { n: l.n, from: l.from ?? 0, to: l.to ?? 0 })}
              </span>
              <span className="mt-0.5 block text-sm text-ink-soft">
                {l.n === 0
                  ? t("level0_sub", { parts: partCount, batches: l.batches, pct: pct(percent(attachedShare)) })
                  : t("level_sub", { batches: l.batches, pct: pct(percent(l.cum ?? 0)) })}
              </span>
            </summary>
            <ul className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(3.5rem,1fr))] gap-2">
              {Array.from({ length: l.batches }, (_, i) => {
                const id = batchId(l.n, i + 1);
                const passed = id in p.passed;
                const open = isOpen(p, order, id);
                const state = passed ? "passed" : open ? "open" : "locked";
                const label = `${t("batch", { n: i + 1 })}, ${t(state)}`;
                return (
                  <li key={id}>
                    {open ? (
                      <Link
                        href={kosakataBatchHref(l.n, i + 1)}
                        aria-label={label}
                        data-path-tile={id}
                        data-state={state}
                        className={clsx(
                          "flex min-h-14 flex-col items-center justify-center rounded-xl font-semibold tabular-nums",
                          passed ? "border border-forest bg-forest text-paper" : "border-2 border-forest bg-white text-forest",
                        )}
                      >
                        {nf.format(i + 1)}
                        {passed ? <Check aria-hidden className="size-4" /> : null}
                      </Link>
                    ) : (
                      <span
                        role="img"
                        aria-label={label}
                        data-path-tile={id}
                        data-state={state}
                        className="flex min-h-14 flex-col items-center justify-center rounded-xl border border-hairline bg-paper-deep font-semibold text-ink-soft tabular-nums"
                      >
                        {nf.format(i + 1)}
                        <Lock aria-hidden className="size-3.5" />
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="mt-4">
              <Link href={kosakataLevelTestHref(l.n)} data-path-level-test={l.n} className="chip-link min-h-12! bg-white">
                {t("level_test")}
              </Link>
              <p className="mt-1 text-sm text-ink-soft">{t("level_test_sub", { n: l.questions, pct: passPercent })}</p>
            </div>
          </details>
        ))}
      </div>

      <div className="mt-6 max-w-prose space-y-1 text-sm text-ink-soft">
        <p>
          <MixedText text={t("progress_note")} />
        </p>
        <p>
          <MixedText text={t("counts_note")} />
        </p>
        {Object.keys(p.passed).length > 0 ? (
          <button
            type="button"
            data-path-reset=""
            className="min-h-11 cursor-pointer font-semibold text-ink underline underline-offset-2"
            onClick={() => {
              if (!armed) {
                setArmed(true);
                return;
              }
              setArmed(false);
              clear();
            }}
          >
            {t(armed ? "reset_sure" : "reset")}
          </button>
        ) : null}
      </div>
    </>
  );
}
