"use client";

import clsx from "clsx";
import { ArrowLeft, FileText, Library, Menu as MenuIcon, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";

import { AccountChip } from "@/components/AccountChip";
import { MixedText } from "@/components/library/MixedText";
import { TextSizeOptions } from "@/components/TextSizeSwitch";
import { Link, usePathname } from "@/i18n/navigation";
import { conceptIndexHref, creditsHref } from "@/lib/routes";

type Panel = "size" | "menu" | null;

/** The header's two toggle buttons: 48px, outlined, labelled; pressed state
 *  shown by fill AND border, never colour alone. */
const toggleClass = (on: boolean) =>
  clsx(
    "inline-flex min-h-12 items-center gap-2 rounded-full border-[1.5px] px-4 text-base font-medium text-ink transition-colors hover:border-forest",
    on ? "border-forest bg-forest-tint" : "border-border-ui bg-white",
  );

/**
 * The right side of the header on every /belajar page (operator, 2026-10-10:
 * "too many links and buttons on screen"): the "Aa" text-size button and ONE
 * "Menu" button. Each opens an inline panel under the header (the header is
 * the positioned ancestor; no hover, no modal); opening one closes the
 * other, Escape or "Tutup" closes it and puts focus back on its button.
 * The Menu panel holds everything the header row used to carry: Konsep tata
 * bahasa, Kembali ke Dakwah-Lens (a plain <a>: cross-app), Masuk / the
 * signed-in name, Sumber & lisensi.
 *
 * Both panels are always rendered (hidden when closed), so aria-controls
 * points at a real id and the static HTML carries every link.
 *
 * A panel belongs to the page it was opened on: the header lives in the
 * persistent layout, so a client-side navigation that does not go through
 * the panel (a card under it, browser back) would otherwise leave it open
 * over the next page. It is DERIVED from the path it was opened on (no
 * effect resets it).
 */
export function HeaderControls({ locale }: { locale: string }) {
  const t = useTranslations("App");
  const ts = useTranslations("Settings");
  const tf = useTranslations("Footer");
  const pathname = usePathname();
  const [openOn, setOpenOn] = useState<{ panel: "size" | "menu"; path: string } | null>(null);
  /** The panel shown: only on the page it was opened on. */
  const open: Panel = openOn && openOn.path === pathname ? openOn.panel : null;
  const sizeButton = useRef<HTMLButtonElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const sizePanel = useRef<HTMLDivElement>(null);
  const sizeId = useId();
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    // Text size: put keyboard and screen-reader users on the current choice.
    if (open === "size") sizePanel.current?.querySelector<HTMLInputElement>("input:checked")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpenOn(null);
      (open === "size" ? sizeButton : menuButton).current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const close = (which: "size" | "menu") => {
    setOpenOn(null);
    (which === "size" ? sizeButton : menuButton).current?.focus();
  };
  const toggle = (which: "size" | "menu") => setOpenOn(open === which ? null : { panel: which, path: pathname });
  // A menu link navigates inside the app (the layout stays): close first.
  const leave = () => setOpenOn(null);
  const current = (href: string) => (pathname === href ? ("page" as const) : undefined);

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          ref={sizeButton}
          type="button"
          data-text-size-toggle=""
          aria-expanded={open === "size"}
          aria-controls={sizeId}
          onClick={() => toggle("size")}
          className={toggleClass(open === "size")}
        >
          <span aria-hidden className="font-display text-lg font-semibold">
            Aa
          </span>
          <span className="hidden sm:inline">{ts("button")}</span>
          <span className="sm:hidden">{ts("button_short")}</span>
        </button>
        <button
          ref={menuButton}
          type="button"
          data-header-menu-toggle=""
          aria-expanded={open === "menu"}
          aria-controls={menuId}
          onClick={() => toggle("menu")}
          className={toggleClass(open === "menu")}
        >
          {open === "menu" ? <X aria-hidden className="h-5 w-5" /> : <MenuIcon aria-hidden className="h-5 w-5" />}
          {t("menu")}
        </button>
      </div>

      <div
        id={sizeId}
        ref={sizePanel}
        role="region"
        aria-label={ts("panel_title")}
        hidden={open !== "size"}
        className="absolute inset-x-0 top-full z-40 border-b border-hairline bg-paper shadow-lg"
      >
        <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-lg font-semibold text-ink">{ts("panel_title")}</p>
              <p className="mt-1 max-w-prose text-base text-ink-muted">{ts("panel_body")}</p>
            </div>
            <button type="button" onClick={() => close("size")} className="btn-secondary">
              <X className="h-5 w-5" aria-hidden />
              {ts("close")}
            </button>
          </div>
          <div className="mt-4">
            <TextSizeOptions />
          </div>
        </div>
      </div>

      <nav
        id={menuId}
        aria-label={t("menu")}
        hidden={open !== "menu"}
        data-header-menu=""
        className="absolute inset-x-0 top-full z-40 border-b border-hairline bg-paper shadow-lg"
      >
        <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6">
          {/* Container query: two columns only while the rows fit at the
              learner's text size. */}
          <div className="@container">
            <ul className="grid gap-3 @xl:grid-cols-2">
              <li>
                <Link
                  href={conceptIndexHref()}
                  onClick={leave}
                  aria-current={current(conceptIndexHref())}
                  className="menu-row"
                >
                  <Library aria-hidden className="h-5 w-5 shrink-0 text-forest" />
                  {t("nav_concepts")}
                </Link>
              </li>
              <li>
                {/* Cross-app: a plain <a>, never next-intl Link (it would
                    prefix /belajar and soft-navigate across apps). */}
                <a href={`/${locale}`} className="menu-row">
                  <ArrowLeft aria-hidden className="h-5 w-5 shrink-0 text-forest" />
                  {/* "Dakwah-Lens" is never cut at its hyphen (line breaks, 2026-10-10). */}
                  <span>
                    <MixedText text={t("back_to_main")} />
                  </span>
                </a>
              </li>
              <li>
                <AccountChip locale={locale} />
              </li>
              <li>
                <Link href={creditsHref()} onClick={leave} aria-current={current(creditsHref())} className="menu-row">
                  <FileText aria-hidden className="h-5 w-5 shrink-0 text-forest" />
                  {tf("credits")}
                </Link>
              </li>
            </ul>
          </div>
          <button type="button" onClick={() => close("menu")} className="btn-secondary mt-4">
            <X className="h-5 w-5" aria-hidden />
            {ts("close")}
          </button>
        </div>
      </nav>
    </>
  );
}
