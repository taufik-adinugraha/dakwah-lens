"use client";

import clsx from "clsx";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { ClipButton, ClipPlayerProvider } from "@/components/library/ClipButton";
import { ClipNote } from "@/components/library/ClipNote";
import { MixedText } from "@/components/library/MixedText";
import { useKosakataProgress } from "@/hooks/useKosakataProgress";
import { Link } from "@/i18n/navigation";
import { isOpen } from "@/lib/kosakata-path-core";
import type { Card, PartCard, WordCard } from "@/lib/kosakata-path-data";
import { conceptHref, kosakataLevelTestHref, kosakataPathHref } from "@/lib/routes";

import { AyahText, AyahTranslation } from "./AyahLineView";
import { NextBarPage } from "./NextBarPage";

/** What is heard and where: a lemma has no recording of its own (pipeline/kosakata_voice.py). */
function Heard({ card, noteId }: { card: Card; noteId: string }) {
  const t = useTranslations("Kosakata");
  const v = card.voice;
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
      <ClipButton loc={v.loc} clip={v.clip} word={card.translit} noteId={v.final ? noteId : undefined} />
      <p className="min-w-0 text-sm text-ink-muted">
        {t("heard")}{" "}
        <bdi lang="ar" dir="rtl" className="arabic-inline text-ar-sm text-ink">
          {v.form}
        </bdi>
        <br />
        {t("heard_place", { surah: v.surah, ayah: v.ayah, word: v.word })}
      </p>
      {v.final ? <ClipNote id={noteId} kind="waqf" text={t("heard_final")} className="w-full" /> : null}
    </div>
  );
}

function WordCardView({ card, source }: { card: WordCard; source: string }) {
  const t = useTranslations("KosakataPath");
  const locale = useLocale();
  const mine = locale === "en" ? "en" : "id";
  return (
    <article data-path-card={card.key} className="space-y-5 rounded-2xl border border-hairline bg-white p-5">
      <div className="text-center">
        <p lang="ar" dir="rtl" className="arabic-inline ar-clear text-ar-xl text-ink">
          {card.ar}
        </p>
        <p className="mt-1 text-lg text-ink-muted">{card.translit}</p>
      </div>
      <Heard card={card} noteId={`voice-note-${card.key}`} />
      <section>
        <h2 className="text-lg font-semibold text-ink">{t("meanings")}</h2>
        <ol className="mt-2 space-y-2">
          {card.senses.map((s, i) => (
            <li key={`${s.id}-${s.en}`} className="flex flex-wrap items-baseline gap-x-2">
              <span className={clsx(i === 0 ? "text-xl font-semibold text-forest" : "text-base font-semibold text-forest")}>{s[mine]}</span>
              {i === 0 && card.tested ? <span className="rounded-full bg-forest-tint px-2 text-xs font-semibold text-forest">{t("tested")}</span> : null}
            </li>
          ))}
        </ol>
        <p className="mt-2 text-sm text-ink-soft">{t("count", { count: card.count })}</p>
      </section>
      {card.example ? (
        <section>
          <h2 className="text-lg font-semibold text-ink">{t("example")}</h2>
          <div className="mt-2">
            <AyahText line={card.example} />
          </div>
          <AyahTranslation line={card.example} reference={t("ayah_ref", { surah: card.example.surah, ayah: card.example.ayah })} source={source} />
        </section>
      ) : null}
    </article>
  );
}

function PartCardView({ card }: { card: PartCard }) {
  const t = useTranslations("KosakataPath");
  const locale = useLocale();
  const mine = locale === "en" ? "en" : "id";
  return (
    <article data-path-card={card.key} className="space-y-5 rounded-2xl border border-hairline bg-white p-5">
      <div className="text-center">
        <p lang="ar" dir="rtl" className="arabic-inline ar-clear text-ar-xl text-ink">
          {card.ar}
        </p>
        <p className="mt-1 text-lg text-ink-muted">{card.translit}</p>
      </div>
      <section>
        <h2 className="text-lg font-semibold text-ink">{t("meanings")}</h2>
        <p className="mt-2 flex flex-wrap items-baseline gap-x-2">
          <span className="text-xl font-semibold text-forest">{card.meaning[mine]}</span>
          <span className="rounded-full bg-forest-tint px-2 text-xs font-semibold text-forest">{t("tested")}</span>
        </p>
        <p className="mt-2 text-sm text-ink-soft">{t("count", { count: card.count })}</p>
      </section>
      <section>
        <h2 className="text-lg font-semibold text-ink">{t("part_example")}</h2>
        <p lang="ar" dir="rtl" data-path-part-word="" className="arabic-inline ar-clear mt-1 text-center text-ar-lg text-ink">
          {card.word[0]}
          <span className="text-forest">{card.word[1]}</span>
          {card.word[2]}
        </p>
        <div className="mt-2">
          <Heard card={card} noteId={`voice-note-${card.key}`} />
        </div>
        <p className="mt-3 text-base text-ink">
          <MixedText text={t("part_note", { translit: card.translit, meaning: card.meaning[mine] })} />
        </p>
        <p className="mt-1 text-sm text-ink-soft">{card.pieces[mine]}</p>
        {card.concept ? (
          <p className="mt-2">
            <Link href={conceptHref(card.concept)} className="font-semibold text-forest underline underline-offset-2">
              {t("concept_link")}
            </Link>
          </p>
        ) : null}
      </section>
    </article>
  );
}

/**
 * One batch, a card at a time. Its ten recordings are fetched at idle, so a press plays at once (nothing
 * with Save-Data). A locked batch's address says so and offers the way in: nothing here is secret, the
 * list shows every word.
 */
export function BatchLearn({ level, batch, cards, order, testHref, source }: { level: number; batch: number; cards: Card[]; order: string[]; testHref: string; source: string }) {
  const t = useTranslations("KosakataPath");
  const { progress } = useKosakataProgress();
  const [i, setI] = useState(0);
  const id = `${level}-${batch}`;
  const back = (
    <Link href={kosakataPathHref()} className="inline-flex items-center gap-1 text-sm font-semibold text-forest">
      <ArrowLeft aria-hidden className="size-4" />
      {t("back")}
    </Link>
  );
  if (progress && !isOpen(progress, order, id)) {
    return (
      <div data-path-locked="">
        {back}
        <h1 className="mt-4 font-display text-2xl font-medium">{t("locked_title")}</h1>
        <p className="mt-2 text-base text-ink-muted">{t("locked_body")}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href={kosakataPathHref()} className="btn-nav">
            {t("to_map")}
          </Link>
          <Link href={kosakataLevelTestHref(level)} className="btn-primary">
            {t("level_test")}
          </Link>
        </div>
      </div>
    );
  }
  const card = cards[i];
  const last = i === cards.length - 1;
  const go = (k: number) => {
    setI(k);
    window.scrollTo({ top: 0 });
  };
  return (
    <ClipPlayerProvider prefetch={cards.map((c) => c.voice.clip.url)}>
      <NextBarPage
        bar={
          // Side by side while each gets 9.5rem, which "‹ Sebelumnya" needs at any text size, else stacked,
          // as in the lesson's bar. On a phone the right-hand button is where the thumb already is, card after card.
          <div className="grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-2 sm:flex sm:items-center sm:justify-between">
            {i > 0 ? (
              <button type="button" className="btn-nav w-full sm:w-auto" onClick={() => go(i - 1)}>
                <ChevronLeft aria-hidden className="size-4 shrink-0" />
                {t("prev")}
              </button>
            ) : null}
            {last ? (
              <Link href={testHref} data-path-start-test="" className="btn-primary w-full px-3! sm:ms-auto sm:w-auto sm:px-6!">
                {t("start_test")}
              </Link>
            ) : (
              <button type="button" data-path-next="" className="btn-primary w-full px-3! sm:ms-auto sm:w-auto sm:px-6!" onClick={() => go(i + 1)}>
                {t("next")}
                <ChevronRight aria-hidden className="size-4 shrink-0" />
              </button>
            )}
          </div>
        }
      >
        {back}
        <p className="mt-4 text-sm font-semibold text-forest">{t("batch_eyebrow", { level, batch })}</p>
        <p className="text-base text-ink-muted">{t(level === 0 ? "part_of" : "word_of", { i: i + 1, n: cards.length })}</p>
        <ol aria-label={t("steps_label")} className="mt-2 flex flex-wrap gap-1.5">
          {cards.map((c, k) => (
            <li key={c.key}>
              <button
                type="button"
                aria-current={k === i ? "step" : undefined}
                aria-label={t(level === 0 ? "part_of" : "word_of", { i: k + 1, n: cards.length })}
                onClick={() => go(k)}
                className={clsx(
                  "size-10 cursor-pointer rounded-full border text-sm tabular-nums",
                  k === i ? "border-forest bg-forest font-semibold text-paper" : "border-border-ui bg-white text-ink-muted",
                )}
              >
                {k + 1}
              </button>
            </li>
          ))}
        </ol>
        <div className="mt-4">{card.type === "word" ? <WordCardView key={card.key} card={card} source={source} /> : <PartCardView key={card.key} card={card} />}</div>
      </NextBarPage>
      {last ? null : (
        <p className="mt-3 text-sm">
          <Link href={testHref} className="text-ink-muted underline underline-offset-2">
            {t("skip_to_test")}
          </Link>
        </p>
      )}
    </ClipPlayerProvider>
  );
}
