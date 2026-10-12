"use client";

import clsx from "clsx";
import { Play, RotateCcw, Square } from "lucide-react";
import { useTranslations } from "next-intl";
import { createContext, type ReactNode, useContext, useId } from "react";

import { useClipPlayer } from "@/hooks/useClipPlayer";
import { type Clip, clipView } from "@/lib/clips";

type Player = ReturnType<typeof useClipPlayer>;
const ClipPlayerContext = createContext<Player | null>(null);

/**
 * The page's one clip player (src/hooks/useClipPlayer.ts: one Audio element, nothing fetched
 * before a press) for the example buttons under it. One per page: the concept page's card
 * (ConceptCard) and the Harakat page's signs (HarakatChart) each put one around their examples.
 */
export function ClipPlayerProvider({ children }: { children: ReactNode }) {
  const player = useClipPlayer();
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
 * The imam's voice next to an example (operator 2026-10-12: "e.g ismu (read by voice + show
 * visual) when combined with harf jar, it becomes ismi (read by voice + visual)… each explanation
 * should be followed by examples (visual + voice)"). The example itself (its Arabic,
 * transliteration and meaning) is drawn by the caller, unchanged; this adds one button:
 * "▶ Dengarkan" plays Mishary Alafasy's recitation of exactly that word, cut from the ayah's
 * streamed recording by its quran-align timing; while it plays the button says "■ Hentikan"; after
 * a failure "↺ Coba lagi", with a plain message beside it. "Memuat bacaan imam…" shows once a load
 * lasts (the lesson's thresholds), and what to do once it is slow.
 *
 * - A real <button>, 48px tall (btn-listen: play is forest, the module's three colours), with an
 *   aria-label naming the word ("Dengarkan bacaan imam: bismi") that starts with its visible word;
 *   the module's focus ring. The status line is a polite live region, always present (empty until
 *   there is something to say), so a screen reader hears the load and the failure.
 * - `loc`: the example's clip key (src/lib/clips.ts clipKey), `data-clip` for the CI checks. The
 *   player knows each button by its own id, not by the word: two buttons of one word (kasrah's
 *   and sukun's example are both بِسْمِ) are two buttons.
 * - Without a ClipPlayerProvider above it, nothing is drawn.
 */
export function ClipButton({ loc, clip, word, className }: { loc: string; clip: Clip; word: string; className?: string }) {
  const player = useContext(ClipPlayerContext);
  const t = useTranslations("Clip");
  const ta = useTranslations("Ayah");
  const tg = useTranslations("Guided");
  const id = useId();
  const statusId = `${id}-status`;
  if (!player) return null;
  const view = clipView(player.state, id, player.notice);
  const line =
    view.line === "failed"
      ? ta("recite_failed")
      : view.line === "slow"
        ? ta("loading_slow")
        : view.line === "loading"
          ? tg("loading_recitation")
          : null;
  const [label, visible] =
    view.mode === "stop"
      ? [t("stop_label", { word }), t("stop")]
      : view.mode === "retry"
        ? [t("retry_label", { word }), ta("retry")]
        : [t("play_label", { word }), t("play")];
  const Icon = view.mode === "stop" ? Square : view.mode === "retry" ? RotateCcw : Play;
  return (
    <span className={clsx("inline-flex max-w-full flex-wrap items-center gap-y-1", className)}>
      <button
        type="button"
        data-clip={loc}
        data-state={view.mode === "stop" ? "playing" : view.mode === "retry" ? "failed" : "idle"}
        aria-label={label}
        aria-describedby={line ? statusId : undefined}
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
