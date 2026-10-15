"use client";

import clsx from "clsx";
import { Play, RotateCcw, Square } from "lucide-react";
import { useTranslations } from "next-intl";
import { createContext, type ReactNode, useContext, useId } from "react";

import { useClipPlayer } from "@/hooks/useClipPlayer";
import { useMediaPrefetch } from "@/hooks/useMediaPrefetch";
import { type Clip, clipView } from "@/lib/clips";
import { pageMediaPlan } from "@/lib/media-prefetch";
import { isQuranCom } from "@/lib/wordvoice-core";

type Player = ReturnType<typeof useClipPlayer>;
const ClipPlayerContext = createContext<Player | null>(null);

/**
 * The page's one clip player (src/hooks/useClipPlayer.ts: one Audio element) for the example
 * buttons under it, and the fetch ahead of their files (`prefetch`, the page's own order). One per page: the concept page's card
 * (ConceptCard) and the Harakat page's signs (HarakatChart) each put one around their examples.
 */
export function ClipPlayerProvider({ children, prefetch = [] }: { children: ReactNode; prefetch?: readonly (string | null | undefined)[] }) {
  const player = useClipPlayer();
  // The page's example files, fetched at idle in the order the page shows them (at most
  // PAGE_PREFETCH_MAX_FILES; nothing with Save-Data): a press then plays at once.
  useMediaPrefetch({ page: pageMediaPlan(prefetch) });
  return <ClipPlayerContext.Provider value={player}>{children}</ClipPlayerContext.Provider>;
}

/** The turning mark of a load (the lesson stage's and the ayah popup's): a dot with reduced motion. */
function LoadingMark({ className }: { className?: string }) {
  return (
    <span aria-hidden className={clsx("relative inline-block h-5 w-5 shrink-0", className)}>
      <span className="absolute inset-0 rounded-full border-[2.5px] border-current border-t-transparent motion-safe:animate-spin motion-reduce:hidden" />
      <span className="absolute inset-[0.3125rem] hidden rounded-full bg-current motion-reduce:block" />
    </span>
  );
}

/**
 * The voice next to an example (operator 2026-10-12: "e.g ismu (read by voice + show visual)
 * when combined with harf jar, it becomes ismi (read by voice + visual)… each explanation should
 * be followed by examples (visual + voice)"). The example itself (its Arabic, transliteration and
 * meaning) is drawn by the caller, unchanged; this adds one button: "▶ Dengarkan" plays the word's
 * recording (src/lib/wordvoice.ts: Quran.com's word-by-word recording of a word at its place in
 * the Qur'an, or the AI narrator's for a part of a word, a form or a run — operator 2026-10-15),
 * and its label and tooltip say which ("Rekaman Quran.com" / "suara AI"); while it plays the button
 * says "■ Hentikan"; after a failure "↺ Coba lagi", with a plain message beside it. "Memuat suara
 * kata…" (Quran.com) or "Memuat suara narator…" shows once a load lasts (the lesson's thresholds),
 * and what to do once it is slow. A page's example files are fetched ahead at idle
 * (src/lib/media-prefetch.ts), so in normal use nothing loads at the press.
 *
 * - A real <button>, 48px tall (btn-listen: play is forest, the module's three colours), with an
 *   aria-label naming the word and the source ("Dengarkan rekaman Quran.com: bismi"); `title`
 *   (the tooltip) names the source in full; `data-source` for the CI checks;
 *   the module's focus ring. The status line is a polite live region, always present (empty until
 *   there is something to say), so a screen reader hears the load and the failure.
 * - `loc`: the example's clip key (src/lib/clips.ts clipKey), `data-clip` for the CI checks. The
 *   player knows each button by its own id, not by the word: two buttons of one word (kasrah's
 *   and sukun's example are both بِسْمِ) are two buttons.
 * - `word`: what is HEARD, in Latin — the word, or for a tile played with the word before it the
 *   two as they sound ("tabārakasmu"). `noteId`: the id of the line that says what is heard when
 *   it is not what is written (ClipNote: the imam's stop at an ayah's end, a hamzat washal); the
 *   button is described by it, so a screen reader says it after the button's name.
 * - Without a ClipPlayerProvider above it, nothing is drawn.
 */
export function ClipButton({
  loc,
  clip,
  word,
  noteId,
  className,
}: {
  loc: string;
  clip: Clip;
  word: string;
  noteId?: string;
  className?: string;
}) {
  const player = useContext(ClipPlayerContext);
  const t = useTranslations("Clip");
  const ta = useTranslations("Ayah");
  const tg = useTranslations("Guided");
  const id = useId();
  const statusId = `${id}-status`;
  if (!player) return null;
  const view = clipView(player.state, id, player.notice);
  // Where the sound comes from, said on the button (operator 2026-10-15): Quran.com's recording of
  // a word at its place in the Qur'an, or the AI narrator's voice (a part of a word, a form, a run).
  const qc = isQuranCom(clip);
  const line =
    view.line === "failed"
      ? t("failed")
      : view.line === "slow"
        ? ta("loading_slow")
        : view.line === "loading"
          ? tg(qc ? "loading_word" : "loading_narration")
          : null;
  const [label, visible] =
    view.mode === "stop"
      ? [t(qc ? "stop_label_qc" : "stop_label", { word }), t("stop")]
      : view.mode === "retry"
        ? [t(qc ? "retry_label_qc" : "retry_label", { word }), ta("retry")]
        : [t(qc ? "play_label_qc" : "play_label", { word }), t("play")];
  const Icon = view.mode === "stop" ? Square : view.mode === "retry" ? RotateCcw : Play;
  return (
    <span className={clsx("inline-flex max-w-full flex-wrap items-center gap-y-1", className)}>
      <button
        type="button"
        data-clip={loc}
        data-source={clip.source ?? "imam"}
        title={qc ? t("source_qc") : clip.source === "elevenlabs" ? t("source_ai") : undefined}
        data-state={view.mode === "stop" ? "playing" : view.mode === "retry" ? "failed" : "idle"}
        aria-label={label}
        aria-describedby={[noteId, line ? statusId : null].filter(Boolean).join(" ") || undefined}
        onClick={() => player.press(id, clip)}
        className="btn-listen"
      >
        <Icon aria-hidden className="h-5 w-5 shrink-0" />
        {visible}
      </button>
      <span id={statusId} role="status" aria-live="polite" data-clip-status="" className="min-w-0 text-base">
        {line ? (
          <span className={clsx("ml-3 flex items-start gap-2", view.line === "failed" ? "text-ink" : "text-ink-muted")}>
            {view.line !== "failed" && <LoadingMark className="mt-0.5 text-forest" />}
            <span className="min-w-0 text-pretty">{line}</span>
          </span>
        ) : null}
      </span>
    </span>
  );
}
