"use client";

import clsx from "clsx";
import { Check, Copy, MessageCircle, Share2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";

import { shareUrl, whatsappHref } from "@/lib/share";

/**
 * "Bagikan" (operator, 2026-10-10: the module should bring people to dakwah-lens.id): ONE
 * labelled button, 48px, outside the lesson stage (the lesson page puts it under the ayah
 * navigation, the track page in its head).
 *   - Where the browser has a share sheet (navigator.share: phones, most desktop browsers), the
 *     sheet opens with the page address tagged utm_source=share&utm_medium=share.
 *   - Elsewhere, or when the sheet fails, a small panel opens under the button: "Kirim lewat
 *     WhatsApp" (wa.me with the message and the address, utm_medium=whatsapp, in a new tab: it
 *     leaves for WhatsApp) and "Salin tautan", which says "Tautan disalin." right there
 *     (role=status). If the clipboard refuses, the address is shown in a read-only field,
 *     selected, to copy by hand.
 * The panel is always in the static HTML, hidden while closed, so aria-controls points at a real
 * element. Callers render this only for a page that may be shared (lib/share.ts lessonShareable).
 */
export function ShareButton({ url, text, className }: { url: string; text: string; className?: string }) {
  const t = useTranslations("Share");
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<"done" | "manual" | null>(null);
  const panelId = useId();
  const manual = useRef<HTMLInputElement>(null);
  const link = shareUrl(url, "share");

  const onShare = async () => {
    const data: ShareData = { title: text, url: link };
    if (typeof navigator.share === "function" && (!navigator.canShare || navigator.canShare(data))) {
      try {
        await navigator.share(data);
        return;
      } catch (err) {
        // Closing the sheet is a choice, not a failure.
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
      setCopied(null);
      setOpen(true);
      return;
    }
    setCopied(null);
    setOpen((v) => !v);
  };

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied("done");
    } catch {
      setCopied("manual");
      // Focus selects the address (onFocus below), ready for the learner's own copy.
      requestAnimationFrame(() => manual.current?.focus());
    }
  };

  return (
    <div data-share="" className={className}>
      <button
        type="button"
        data-share-toggle=""
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onShare}
        className={clsx("btn-secondary", open && "border-forest! bg-forest-tint!")}
      >
        <Share2 aria-hidden className="h-5 w-5 shrink-0" />
        {t("button")}
      </button>
      <div
        id={panelId}
        role="group"
        aria-label={t("panel")}
        hidden={!open}
        data-share-panel=""
        className="mt-3 max-w-prose rounded-2xl border border-hairline bg-white p-4"
      >
        <div className="flex flex-wrap gap-3">
          <a
            href={whatsappHref(text, url)}
            target="_blank"
            rel="noopener noreferrer"
            data-share-whatsapp=""
            className="btn-secondary"
          >
            <MessageCircle aria-hidden className="h-5 w-5 shrink-0" />
            {t("whatsapp")}
          </a>
          <button type="button" data-share-copy="" onClick={onCopy} className="btn-secondary">
            <Copy aria-hidden className="h-5 w-5 shrink-0" />
            {t("copy")}
          </button>
        </div>
        <p role="status" data-share-status="" className="flex items-center gap-2 text-base text-ink empty:hidden not-empty:mt-3">
          {copied === "done" ? (
            <>
              <Check aria-hidden className="h-5 w-5 shrink-0 text-forest" />
              {t("copied")}
            </>
          ) : null}
        </p>
        {copied === "manual" ? (
          <label className="mt-3 block">
            <span className="block text-base text-ink">{t("copy_manual")}</span>
            <input
              ref={manual}
              readOnly
              value={link}
              onFocus={(e) => e.currentTarget.select()}
              className="mt-2 block min-h-12 w-full rounded-lg border-[1.5px] border-border-ui bg-white px-3 text-base text-ink"
            />
          </label>
        ) : null}
      </div>
    </div>
  );
}
