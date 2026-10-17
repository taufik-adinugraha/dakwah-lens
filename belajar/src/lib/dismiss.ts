/**
 * How an open header panel is closed without its "Tutup" button (src/components/HeaderControls.tsx):
 *
 * - Escape, anywhere in the document: closes the panel and puts focus back on its toggle button.
 * - With `outside` (the Menu; operator, 2026-10-17: the menu should close when the cursor or a
 *   finger clicks outside it): a press that starts outside BOTH the panel and its toggle button
 *   closes the panel. Focus is left where the press put it. A press on the toggle button is not
 *   "outside", so its own click still toggles (closes) the panel instead of the press closing it
 *   and the click opening it again; a press inside the panel (a link, the "Tutup" button, empty
 *   space) leaves it to the panel.
 *
 * Why a document listener and not the platform's light dismiss: the panels are plain elements
 * hidden by React state (`hidden`), not a <dialog>, <details> or [popover]. A popover would get
 * light dismiss for free, but it lives in the top layer (it would no longer hang under the header
 * without anchor positioning), and a browser without the Popover API ignores the attribute and
 * would show the menu always open: Next 16's default browser floor (Safari 16.4, Chrome 111,
 * Firefox 111) is below the API's (Safari 17, Chrome 114, Firefox 125).
 *
 * The press is `pointerdown` (mouse, pen and touch alike; iOS Safari dispatches it on any element,
 * where a `click` on a non-interactive element may never reach the document), listened to on the
 * document in the CAPTURE phase, so no handler further down that stops propagation can hide it.
 * It never calls preventDefault or stopPropagation: the press goes on to whatever it landed on
 * (the lesson's "Mulai" tap unlocks audio in its own click, which still happens). The panel hangs
 * over the page (absolutely positioned), so closing it moves nothing under the pointer.
 *
 * Pure DOM wiring on purpose (no React): the component calls it from an effect while a panel is
 * open and React calls the returned cleanup when the panel closes or the header unmounts; the
 * unit test drives it with a stand-in document (vitest runs in node, with no DOM).
 */

/** What is listened on: the document (a stand-in in tests). */
export type DismissDoc = Pick<EventTarget, "addEventListener" | "removeEventListener">;

/** What is asked of the panel and its button: whether a press landed inside them. */
type Container = { contains(other: Node | null): boolean };

export interface DismissOptions {
  /** The open panel (null before it is mounted). */
  panel: () => Container | null;
  /** The panel's toggle button: Escape puts focus back on it; a press on it is not "outside". */
  button: () => (Container & { focus(): void }) | null;
  /** Closes the panel. */
  close: () => void;
  /** Close on a press outside the panel and its button too (light dismiss). */
  outside: boolean;
}

/** The capture flag, the same object for add and remove (a mismatch would leave the listener on). */
const CAPTURE = { capture: true } as const;

/** Listens while the panel is open; returns the cleanup that removes every listener it added. */
export function listenForDismiss(doc: DismissDoc, { panel, button, close, outside }: DismissOptions): () => void {
  const onKey = (e: Event) => {
    if ((e as KeyboardEvent).key !== "Escape") return;
    close();
    button()?.focus();
  };
  const onPress = (e: Event) => {
    const target = e.target as Node | null;
    if (target && [panel(), button()].some((el) => el?.contains(target))) return;
    close();
  };
  doc.addEventListener("keydown", onKey);
  if (outside) doc.addEventListener("pointerdown", onPress, CAPTURE);
  return () => {
    doc.removeEventListener("keydown", onKey);
    if (outside) doc.removeEventListener("pointerdown", onPress, CAPTURE);
  };
}
