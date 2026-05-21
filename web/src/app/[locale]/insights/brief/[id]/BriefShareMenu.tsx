"use client";

import { useState } from "react";
import {
  Check,
  Copy,
  Link as LinkIcon,
  Mail,
  Share2,
} from "lucide-react";

/**
 * Share popover for a /insights/brief/[id] page.
 *
 * Channels:
 *   - Copy link            — universal fallback
 *   - Copy as markdown     — content creators scripting content
 *   - WhatsApp             — primary Indonesian channel
 *   - Telegram             — common da'wah groups
 *   - X / Twitter
 *   - Facebook
 *   - Line                 — popular among older Indonesian audiences
 *   - Email                — researchers + cross-team forwarding
 *
 * We construct URLs directly (no SDKs) to avoid adding third-party
 * trackers / blocking scripts. Each channel opens in a new tab.
 */
export function BriefShareMenu({
  briefId,
  title,
  labels,
}: {
  briefId: string;
  title: string;
  labels: {
    trigger: string;
    copyLink: string;
    copyMarkdown: string;
    whatsapp: string;
    telegram: string;
    x: string;
    facebook: string;
    line: string;
    email: string;
    emailSubject: string;
    copied: string;
  };
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<"link" | "markdown" | null>(null);

  // Compute share URL only in the client — typeof window guard for SSR.
  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}${window.location.pathname}`
      : "";

  const flash = (which: "link" | "markdown") => {
    setCopied(which);
    setTimeout(() => setCopied(null), 1800);
  };

  const handleCopyLink = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    flash("link");
  };

  const handleCopyMarkdown = async () => {
    try {
      const resp = await fetch(`/api/insights-brief/${briefId}/markdown`);
      if (!resp.ok) return;
      const md = await resp.text();
      await navigator.clipboard.writeText(md);
      flash("markdown");
    } catch {
      // Silently fail — keep menu open so user can retry.
    }
  };

  const tx = encodeURIComponent(`${title}\n${shareUrl}`);
  const u = encodeURIComponent(shareUrl);
  const t = encodeURIComponent(title);

  const channels = [
    {
      key: "whatsapp",
      label: labels.whatsapp,
      href: `https://wa.me/?text=${tx}`,
      Icon: WhatsappIcon,
    },
    {
      key: "telegram",
      label: labels.telegram,
      href: `https://t.me/share/url?url=${u}&text=${t}`,
      Icon: TelegramIcon,
    },
    {
      key: "x",
      label: labels.x,
      href: `https://twitter.com/intent/tweet?url=${u}&text=${t}`,
      Icon: XIcon,
    },
    {
      key: "facebook",
      label: labels.facebook,
      href: `https://www.facebook.com/sharer/sharer.php?u=${u}`,
      Icon: FacebookIcon,
    },
    {
      key: "line",
      label: labels.line,
      href: `https://line.me/R/msg/text/?${tx}`,
      Icon: LineIcon,
    },
    {
      key: "email",
      label: labels.email,
      href: `mailto:?subject=${encodeURIComponent(labels.emailSubject)}&body=${tx}`,
      Icon: Mail,
    },
  ];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
      >
        <Share2 className="h-3.5 w-3.5" />
        {labels.trigger}
      </button>
      {open && (
        <>
          {/* Click-outside catcher. */}
          <button
            type="button"
            aria-hidden
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div
            role="menu"
            className="absolute left-0 z-20 mt-2 w-56 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
          >
            <MenuItem
              icon={
                copied === "link" ? (
                  <Check className="h-4 w-4 text-emerald-600" />
                ) : (
                  <LinkIcon className="h-4 w-4" />
                )
              }
              label={copied === "link" ? labels.copied : labels.copyLink}
              onClick={handleCopyLink}
            />
            <MenuItem
              icon={
                copied === "markdown" ? (
                  <Check className="h-4 w-4 text-emerald-600" />
                ) : (
                  <Copy className="h-4 w-4" />
                )
              }
              label={
                copied === "markdown" ? labels.copied : labels.copyMarkdown
              }
              onClick={handleCopyMarkdown}
            />
            <div className="my-1 border-t border-slate-100" />
            {channels.map(({ key, label, href, Icon }) => (
              <a
                key={key}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
                className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-xs text-slate-700 transition hover:bg-slate-50"
              >
                <Icon className="h-4 w-4 text-slate-500" />
                <span>{label}</span>
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-xs text-slate-700 transition hover:bg-slate-50"
    >
      <span className="text-slate-500">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

/* ───────── Brand icons (small inline SVGs — no lucide equivalents) ───────── */

function WhatsappIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
      aria-hidden
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.198-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347zM12.04 21.785h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884zm8.412-18.297A11.815 11.815 0 0012.04 0C5.463 0 .104 5.358.101 11.94c0 2.096.547 4.142 1.588 5.945L0 24l6.305-1.654a11.882 11.882 0 005.733 1.46h.005c6.554 0 11.892-5.336 11.892-11.892 0-3.18-1.236-6.169-3.482-8.426z" />
    </svg>
  );
}

function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
      aria-hidden
    >
      <path d="M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0a12 12 0 00-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

function LineIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
      aria-hidden
    >
      <path d="M19.365 9.863c.349 0 .631.286.631.638 0 .351-.282.638-.631.638H17.61v1.125h1.755c.349 0 .631.287.631.638 0 .351-.282.638-.631.638h-2.386c-.345 0-.627-.287-.627-.638v-4.501c0-.351.282-.638.627-.638h2.386c.349 0 .631.287.631.638 0 .351-.282.638-.631.638H17.61v1.124h1.755zm-3.855 3.523c0 .274-.176.518-.435.609a.671.671 0 01-.205.029.643.643 0 01-.516-.255l-2.443-3.317v2.939c0 .351-.281.638-.629.638-.346 0-.626-.287-.626-.638V8.89c0-.272.174-.514.432-.607a.658.658 0 01.726.221l2.452 3.323V8.89c0-.351.282-.638.631-.638.347 0 .629.287.629.638v4.496zm-6.41 0c0 .351-.282.638-.631.638-.348 0-.63-.287-.63-.638V8.89c0-.351.282-.638.63-.638.349 0 .631.287.631.638v4.496zm-2.39.638H4.322c-.345 0-.627-.287-.627-.638V8.89c0-.351.282-.638.627-.638.346 0 .628.287.628.638v3.868h1.756c.348 0 .629.287.629.638 0 .351-.281.637-.629.637M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.07 9.436-6.971C23.176 14.393 24 12.458 24 10.314" />
    </svg>
  );
}
