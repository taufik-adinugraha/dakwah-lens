"use client";

import clsx from "clsx";
import { Pause, Play, RotateCcw, X } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  createContext,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useContext,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

import { MixedText } from "@/components/library/MixedText";
import { useAyahRecitation } from "@/hooks/useAyahRecitation";
import { type AyahPayload, ayahApiUrl, ayahRefValues, parseAyahPayload, recitationUrl } from "@/lib/ayah";

/** Opens the page's one ayah dialog on `loc`; `chip` gets the focus back when it closes. */
type OpenAyah = (loc: string, chip: HTMLElement) => void;
const OpenAyahContext = createContext<OpenAyah | null>(null);

/** Ayat fetched during this visit: an answer only changes with a deploy. */
const fetched = new Map<string, AyahPayload>();

type Text =
  | { loc: string; status: "loading" }
  | { loc: string; status: "ready"; ayah: AyahPayload }
  | { loc: string; status: "failed" }
  | { loc: string; status: "missing" };

const noopSubscribe = () => () => {};

/** The turning mark of a load (the lesson stage's LoadingMark): a dot with reduced motion. */
function LoadingMark({ className }: { className?: string }) {
  return (
    <span aria-hidden className={clsx("relative inline-block h-5 w-5 shrink-0", className)}>
      <span className="absolute inset-0 rounded-full border-[2.5px] border-current border-t-transparent motion-safe:animate-spin motion-reduce:hidden" />
      <span className="absolute inset-[0.3125rem] hidden rounded-full bg-current motion-reduce:block" />
    </span>
  );
}

/**
 * A location chip of a "Tahukah Anda?" card ("QS 2:255"): a button that opens the page's ayah
 * dialog on that ayah (operator 2026-10-12: it opened quran.com in a new tab or app). No link, no
 * navigation. 48px tall.
 */
export function AyahChip({ loc, label }: { loc: string; label: string }) {
  const open = useContext(OpenAyahContext);
  return (
    <button
      type="button"
      data-ayah-chip={loc}
      aria-haspopup="dialog"
      onClick={(e) => open?.(loc, e.currentTarget)}
      className="chip-link min-h-12! cursor-pointer bg-white"
    >
      {label}
    </button>
  );
}

/**
 * The ayah popup of the fact cards (operator 2026-10-12: "better to just show popup and show the
 * verse (arabic + translation + play qari voice)"): ONE native modal <dialog> for the cards under
 * it, opened by their AyahChip.
 *
 * - It shows the reference ("QS Al-Baqarah [2]: 255", at once, from `names`), the ayah in Arabic
 *   (Tanzil, the `quran` face, right to left), its translation exactly as a lesson shows it
 *   (QuranEnc text in quotes, its footnotes, its credit), and one play / pause button for the
 *   imam's recitation (Mishary Alafasy, streamed from EveryAyah; useAyahRecitation).
 * - The ayah is fetched on the click, one at a time, from /belajar/api/ayah (the data file stays on
 *   the server); "Memuat ayat…" meanwhile, and a plain message with "Coba lagi" if it fails.
 * - The recording: nothing is fetched until play is pressed; "Memuat bacaan imam…" once a load
 *   lasts, what failed and "Coba lagi" on failure; it stops when the dialog closes, and never plays
 *   over the lesson's players (the module's audio-start event, both ways).
 * - showModal(): the page behind is inert and does not scroll (globals.css), Escape, the visible
 *   "Tutup" button or a click beside the dialog closes it; the focus goes to "Tutup" and back to
 *   the chip. The dialog is drawn into <body> (a portal), so no card, disclosure or container
 *   query around the chips lays it out; it fits the screen at every text size and scrolls inside.
 */
export function AyahDialogProvider({ names, children }: { names: Readonly<Record<string, string>>; children: ReactNode }) {
  const t = useTranslations("Ayah");
  const tg = useTranslations("Guided");
  const ts = useTranslations("Surah");
  const titleId = useId();
  const audioStatusId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const chipRef = useRef<HTMLElement | null>(null);
  /** The press now ending in a click began on the backdrop (onBackdropDown). */
  const pressedBackdrop = useRef(false);
  /** The fetch whose answer may still be shown; a later open or a close drops an older one. */
  const requestRef = useRef(0);
  const [text, setText] = useState<Text | null>(null);
  const { status, notice, play, pause, stop } = useAyahRecitation();
  // A portal needs <body>: only once hydrated (the dialog is closed until a click anyway).
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);

  const load = useCallback((loc: string) => {
    const id = ++requestRef.current;
    const cached = fetched.get(loc);
    if (cached) {
      setText({ loc, status: "ready", ayah: cached });
      return;
    }
    const url = ayahApiUrl(loc);
    if (!url) {
      setText({ loc, status: "missing" });
      return;
    }
    setText({ loc, status: "loading" });
    fetch(url)
      .then(async (r) => (r.status === 404 ? ("missing" as const) : r.ok ? parseAyahPayload(await r.json(), loc) : null))
      .then((res) => {
        if (requestRef.current !== id) return;
        if (res === "missing") setText({ loc, status: "missing" });
        else if (res) {
          fetched.set(loc, res);
          setText({ loc, status: "ready", ayah: res });
        } else setText({ loc, status: "failed" });
      })
      .catch(() => {
        if (requestRef.current === id) setText({ loc, status: "failed" });
      });
  }, []);

  const open = useCallback<OpenAyah>(
    (loc, chip) => {
      const d = dialogRef.current;
      if (!d) return;
      chipRef.current = chip;
      stop();
      load(loc);
      if (!d.open) d.showModal();
      closeRef.current?.focus();
    },
    [load, stop],
  );

  // Escape, "Tutup" and a click beside it all end here (the dialog's close event).
  const onClose = () => {
    stop();
    requestRef.current++;
    const chip = chipRef.current;
    chipRef.current = null;
    // Back on the chip that opened it (Chromium does so itself; Safari does not focus a clicked button).
    chip?.focus();
  };
  // A click on the dialog box itself, not on its content (which fills it): the backdrop. Only when
  // the press began there too: a learner who selects the ayah by dragging and lets go outside the
  // box gets a click on the dialog as well (the nearest common ancestor), and must not lose it
  // (review 2026-10-12).
  const onBackdropDown = (e: PointerEvent<HTMLDialogElement>) => {
    pressedBackdrop.current = e.target === e.currentTarget;
  };
  const onBackdrop = (e: MouseEvent<HTMLDialogElement>) => {
    if (e.target === e.currentTarget && pressedBackdrop.current) e.currentTarget.close();
    pressedBackdrop.current = false;
  };

  const loc = text?.loc ?? null;
  const ref = loc ? ayahRefValues(loc, names) : null;
  const title = ref ? t("ref", ref) : loc ? ts("loc_label", { loc }) : "";
  const audioUrl = loc ? recitationUrl(loc) : null;
  const ayah = text?.status === "ready" ? text.ayah : null;

  const audioLine =
    status === "failed"
      ? t("recite_failed")
      : status === "playing" && notice
        ? notice === "slow"
          ? t("loading_slow")
          : tg("loading_recitation")
        : null;

  const dialog = (
    <dialog
      ref={dialogRef}
      data-ayah-dialog=""
      data-loc={loc ?? undefined}
      aria-labelledby={titleId}
      onClose={onClose}
      onPointerDown={onBackdropDown}
      onClick={onBackdrop}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(44rem,calc(100vw-2rem))] max-w-none overflow-hidden rounded-2xl border-[1.5px] border-forest-teal bg-white p-0 text-base text-ink shadow-2xl backdrop:bg-ink/55"
    >
      <div className="flex max-h-[calc(100dvh-2rem)] min-w-0 flex-col">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-hairline px-4 py-3 sm:px-6">
          <h2 id={titleId} className="min-w-0 font-display text-xl font-medium text-ink">
            {title ? <MixedText text={title} /> : null}
          </h2>
          <button ref={closeRef} type="button" data-ayah-close="" onClick={() => dialogRef.current?.close()} className="btn-secondary ml-auto">
            <X aria-hidden className="h-5 w-5" />
            {t("close")}
          </button>
        </div>

        <div data-ayah-body="" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">
          {ayah ? (
            <>
              <p lang="ar" dir="rtl" data-ayah-ar="" className="quran text-ar-lg text-ink sm:text-ar-xl">
                {ayah.ar}
              </p>
              {/* As the lesson page shows a translation (MixedText: quotes and footnote marks stay
                  on their word, "orang-orang" is never cut). */}
              <figure data-ayah-translation="" className="mt-4">
                <blockquote className="text-pretty text-base text-ink">
                  <MixedText text={`“${ayah.translation.text}”`} />
                </blockquote>
                {ayah.translation.footnotes.length > 0 && (
                  <ul className="mt-3 space-y-1 text-sm text-ink-muted">
                    {ayah.translation.footnotes.map((f) => (
                      <li key={f}>
                        <MixedText text={f} />
                      </li>
                    ))}
                  </ul>
                )}
                <figcaption className="mt-2 text-xs text-ink-soft">
                  <MixedText text={`${ayah.translation.source_label} · ${ayah.translation.version}`} />
                </figcaption>
              </figure>
            </>
          ) : (
            <div role="status" aria-live="polite" data-ayah-text-status={text?.status ?? "idle"}>
              {text?.status === "loading" && (
                <p className="flex items-start gap-2.5 text-base text-ink-muted">
                  <LoadingMark className="mt-0.5 text-forest" />
                  <span className="min-w-0">{t("loading_text")}</span>
                </p>
              )}
              {text?.status === "failed" && (
                <div className="space-y-3">
                  <p className="text-base text-ink">{t("text_failed")}</p>
                  <button type="button" data-ayah-retry="" onClick={() => loc && load(loc)} className="btn-secondary">
                    <RotateCcw aria-hidden className="h-5 w-5" />
                    {t("retry")}
                  </button>
                </div>
              )}
              {text?.status === "missing" && <p className="text-base text-ink">{t("text_missing")}</p>}
            </div>
          )}
        </div>

        {audioUrl && (
          <div className="border-t border-hairline px-4 py-3 sm:px-6">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <button
                type="button"
                data-ayah-play=""
                data-state={status}
                aria-describedby={audioLine ? audioStatusId : undefined}
                onClick={() => (status === "playing" ? pause() : play(audioUrl))}
                className="btn-primary"
              >
                {status === "playing" ? (
                  <Pause aria-hidden className="h-5 w-5" />
                ) : status === "failed" ? (
                  <RotateCcw aria-hidden className="h-5 w-5" />
                ) : (
                  <Play aria-hidden className="h-5 w-5" />
                )}
                {status === "playing" ? t("pause") : status === "failed" ? t("retry") : t("play")}
              </button>
              <p id={audioStatusId} role="status" aria-live="polite" data-ayah-audio-status="" className="min-w-0 flex-1 basis-48 text-base">
                {audioLine && (
                  <span className={clsx("flex items-start gap-2.5", status === "failed" ? "text-ink" : "text-ink-muted")}>
                    {status === "playing" && <LoadingMark className="mt-0.5 text-forest" />}
                    <span className="min-w-0 text-pretty">{audioLine}</span>
                  </span>
                )}
              </p>
            </div>
            <p className="mt-2 text-xs text-ink-soft">{t("recitation_credit")}</p>
          </div>
        )}
      </div>
    </dialog>
  );

  return (
    <OpenAyahContext.Provider value={open}>
      {children}
      {hydrated ? createPortal(dialog, document.body) : null}
    </OpenAyahContext.Provider>
  );
}
