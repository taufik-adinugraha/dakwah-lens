"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "@/i18n/navigation";
import {
  BookOpen,
  Check,
  Copy,
  Download,
  HandHeart,
  Home,
  Mic,
  Printer,
  Quote,
  Smartphone,
  Users,
  X,
} from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";

/**
 * Section 4 of the briefing ("Strategi & Aksi Dakwah") is no longer rendered
 * as one long markdown scroll — it's now a card grid where each ### h3
 * sub-section becomes a focus-mode modal. The brief itself stays a 5-section
 * markdown doc, so the LLM prompt + the briefing slug + download routes
 * don't change; this is purely a presentation-layer split.
 *
 * Why: Section 4 now contains a full khutbah (~1500 words), kajian outline,
 * video script, etc. — collectively 3000-4500 words. Inline rendering made
 * the brief page brutal to scroll, and someone reading the khutbah doesn't
 * want competing content on the same page. Modal-per-deliverable lets each
 * surface get its own focus mode with its own copy / download / print
 * actions.
 */

type CardKind =
  | "khutbah"
  | "kajian"
  | "home"
  | "content"
  | "genz"
  | "action";

type DeliverableCard = {
  kind: CardKind | null;
  heading: string;
  body: string;
};

type Labels = {
  /** Card CTA: "Baca selengkapnya" / "Read full content". */
  open: string;
  /** Modal toolbar: "Salin" / "Copy". */
  copy: string;
  /** Modal toolbar: confirmation after copy: "Disalin!". */
  copied: string;
  /** Modal toolbar: "Unduh" / "Download". */
  download: string;
  /** Modal toolbar: "Cetak" / "Print". */
  print: string;
  /** Modal close (aria). */
  close: string;
};

/** Cards rendered in this order regardless of the order in the markdown. */
const KIND_ORDER: CardKind[] = [
  "khutbah",
  "kajian",
  "home",
  "content",
  "genz",
  "action",
];

const KIND_ICON: Record<CardKind, typeof BookOpen> = {
  khutbah: BookOpen,
  kajian: Users,
  home: Home,
  content: Smartphone,
  genz: Mic,
  action: HandHeart,
};

/** Light accent tint per card so the grid scans quickly. */
const KIND_TONE: Record<CardKind, string> = {
  khutbah: "from-emerald-50 to-white ring-emerald-200/60",
  kajian: "from-rose-50 to-white ring-rose-200/60",
  home: "from-amber-50 to-white ring-amber-200/60",
  content: "from-sky-50 to-white ring-sky-200/60",
  genz: "from-violet-50 to-white ring-violet-200/60",
  action: "from-teal-50 to-white ring-teal-200/60",
};

const KIND_ICON_TONE: Record<CardKind, string> = {
  khutbah: "bg-emerald-100 text-emerald-700",
  kajian: "bg-rose-100 text-rose-700",
  home: "bg-amber-100 text-amber-700",
  content: "bg-sky-100 text-sky-700",
  genz: "bg-violet-100 text-violet-700",
  action: "bg-teal-100 text-teal-700",
};

/** Modal header bar tint per card kind — the colored strip across the
 *  top of the focus modal echoes the card's accent so the user keeps
 *  visual continuity between clicking and reading. */
const KIND_HEADER_BG: Record<CardKind, string> = {
  khutbah: "bg-gradient-to-r from-emerald-50 via-white to-emerald-50",
  kajian: "bg-gradient-to-r from-rose-50 via-white to-rose-50",
  home: "bg-gradient-to-r from-amber-50 via-white to-amber-50",
  content: "bg-gradient-to-r from-sky-50 via-white to-sky-50",
  genz: "bg-gradient-to-r from-violet-50 via-white to-violet-50",
  action: "bg-gradient-to-r from-teal-50 via-white to-teal-50",
};

/** Accent border-bottom for the header, drives the section h3 underline
 *  inside the modal body as well. */
const KIND_ACCENT_BORDER: Record<CardKind, string> = {
  khutbah: "border-emerald-200",
  kajian: "border-rose-200",
  home: "border-amber-200",
  content: "border-sky-200",
  genz: "border-violet-200",
  action: "border-teal-200",
};

/** Blockquote palette per card kind — matches the section accent so a
 *  hadith inside the khutbah modal reads emerald, inside a Gen Z guide
 *  reads violet, etc. */
const KIND_QUOTE: Record<CardKind, { bg: string; border: string; icon: string }> = {
  khutbah: { bg: "bg-emerald-50/70", border: "border-emerald-400", icon: "text-emerald-500" },
  kajian: { bg: "bg-rose-50/70", border: "border-rose-400", icon: "text-rose-500" },
  home: { bg: "bg-amber-50/70", border: "border-amber-400", icon: "text-amber-500" },
  content: { bg: "bg-sky-50/70", border: "border-sky-400", icon: "text-sky-500" },
  genz: { bg: "bg-violet-50/70", border: "border-violet-400", icon: "text-violet-500" },
  action: { bg: "bg-teal-50/70", border: "border-teal-400", icon: "text-teal-500" },
};

/**
 * Pattern-match a markdown ### heading to one of the 6 known card kinds.
 * Tolerant of language (id/en) and minor wording variation so the prompt
 * doesn't have to land the exact text every time. Returns null when no
 * pattern matches — in that case we still render the card, just without
 * an icon/meta override.
 */
function classifyHeading(heading: string): CardKind | null {
  const lower = heading.toLowerCase();
  if (lower.includes("khutbah") || lower.includes("friday")) return "khutbah";
  if (lower.includes("kajian") || lower.includes("majelis")) return "kajian";
  if (
    lower.includes("rumah") ||
    lower.includes("home") ||
    lower.includes("teaching at")
  )
    return "home";
  if (
    lower.includes("konten") ||
    lower.includes("content creator") ||
    lower.includes("digital content") ||
    lower.includes("kreator")
  )
    return "content";
  if (
    lower.includes("gen z") ||
    lower.includes("gen-z") ||
    lower.includes("reaching gen")
  )
    return "genz";
  if (
    lower.includes("aksi") ||
    lower.includes("khidmah") ||
    lower.includes("ummah") ||
    lower.includes("social action") ||
    lower.includes("service to")
  )
    return "action";
  return null;
}

/**
 * Strip markdown markers + collapse whitespace so we can build a clean
 * preview string for the card. Not a perfect markdown→text converter —
 * we just want a 100-150 char teaser.
 */
function previewOf(body: string, maxChars = 160): string {
  const stripped = body
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/^>\s?/gm, "")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/\n+/g, " ")
    .trim();
  if (stripped.length <= maxChars) return stripped;
  return stripped.slice(0, maxChars).trimEnd() + "…";
}

/**
 * Split the Section 4 markdown into the intro paragraph(s) above the first
 * `### h3` heading and the deliverable cards below it. Each card captures
 * everything between its h3 line and the next h3 line. The parent `##`
 * heading line itself is stripped (the section heading is rendered by the
 * outer `<BriefingNarrative>` via the markdown route — this component only
 * handles what comes AFTER it).
 */
function parseSection4(md: string): { intro: string; cards: DeliverableCard[] } {
  const lines = md.split("\n");
  // Drop the leading `## …` heading line if it leaked in.
  let start = 0;
  if (lines[0]?.startsWith("## ")) start = 1;

  // Find all h3 indices.
  const h3Indices: number[] = [];
  for (let i = start; i < lines.length; i++) {
    if (lines[i].startsWith("### ")) h3Indices.push(i);
  }

  if (h3Indices.length === 0) {
    return { intro: lines.slice(start).join("\n").trim(), cards: [] };
  }

  const intro = lines.slice(start, h3Indices[0]).join("\n").trim();
  const cards: DeliverableCard[] = [];
  for (let i = 0; i < h3Indices.length; i++) {
    const headingLine = lines[h3Indices[i]];
    const bodyStart = h3Indices[i] + 1;
    const bodyEnd = h3Indices[i + 1] ?? lines.length;
    const heading = headingLine.replace(/^###\s+/, "").trim();
    const body = lines.slice(bodyStart, bodyEnd).join("\n").trim();
    cards.push({
      kind: classifyHeading(heading),
      heading,
      body,
    });
  }
  return { intro, cards };
}

/**
 * Card grid + modal. Consumes the raw Section 4 markdown (no `##` heading);
 * caller renders the section heading via its normal markdown path so the
 * BriefTOC anchor stays in place.
 *
 * `initialDeliverable` is the URL-slug variant of `CardKind` (kebab-stable
 * across locales). When set on mount, we open that modal immediately —
 * supports deep-link URLs like `/insights/brief/[id]/khutbah`. Card click
 * pushes the matching slug into the URL; close pops back to `briefBasePath`.
 */
export function BriefDeliverableCards({
  section4Markdown,
  labels,
  briefBasePath,
  initialDeliverable,
}: {
  section4Markdown: string;
  labels: Labels;
  /** Path of the brief detail route — e.g. `/insights/brief/2026-05-22-all`.
   *  Closing the modal navigates here; opening pushes `${path}/${kind}`. */
  briefBasePath: string;
  initialDeliverable?: CardKind | null;
}) {
  const router = useRouter();
  const { intro, cards } = parseSection4(section4Markdown);

  // Order cards by KIND_ORDER so the grid is predictable even if the LLM
  // shuffles. Unknown-kind cards land at the end in their original order.
  const orderedCards: DeliverableCard[] = (() => {
    const byKind: Partial<Record<CardKind, DeliverableCard>> = {};
    const unknown: DeliverableCard[] = [];
    for (const c of cards) {
      if (c.kind && !byKind[c.kind]) byKind[c.kind] = c;
      else if (!c.kind) unknown.push(c);
    }
    const out: DeliverableCard[] = [];
    for (const k of KIND_ORDER) {
      if (byKind[k]) out.push(byKind[k]!);
    }
    out.push(...unknown);
    return out;
  })();

  // Initial open index — driven by `initialDeliverable` (deep link).
  // Computed once via the useState initializer so it doesn't trigger a
  // setState-in-effect cascade. Subsequent opens/closes flow through
  // user interactions (`onOpenCard` / `onCloseModal`).
  const [openIndex, setOpenIndex] = useState<number | null>(() => {
    if (!initialDeliverable) return null;
    const idx = orderedCards.findIndex((c) => c.kind === initialDeliverable);
    return idx >= 0 ? idx : null;
  });

  const onOpenCard = (i: number) => {
    setOpenIndex(i);
    const kind = orderedCards[i]?.kind;
    if (kind) {
      // Push (not replace) so back-button closes the modal.
      router.push(`${briefBasePath}/${kind}`, { scroll: false });
    }
  };

  const onCloseModal = () => {
    setOpenIndex(null);
    // Replace so the URL change doesn't pile a history entry on top of
    // the open-modal entry — the user-experience-correct stack is:
    //   /brief/[id]  →  /brief/[id]/khutbah  →  (close)  →  /brief/[id]
    router.replace(briefBasePath, { scroll: false });
  };

  return (
    <>
      {intro && (
        <p className="mt-2 text-pretty text-sm leading-relaxed text-slate-600">
          {intro}
        </p>
      )}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {orderedCards.map((card, i) => (
          <DeliverableCardTile
            key={`${card.heading}-${i}`}
            card={card}
            openLabel={labels.open}
            onOpen={() => onOpenCard(i)}
          />
        ))}
      </div>
      {openIndex !== null && orderedCards[openIndex] && (
        <DeliverableModal
          card={orderedCards[openIndex]}
          labels={labels}
          onClose={onCloseModal}
        />
      )}
    </>
  );
}

function DeliverableCardTile({
  card,
  openLabel,
  onOpen,
}: {
  card: DeliverableCard;
  openLabel: string;
  onOpen: () => void;
}) {
  const Icon = card.kind ? KIND_ICON[card.kind] : BookOpen;
  const tone = card.kind
    ? KIND_TONE[card.kind]
    : "from-slate-50 to-white ring-slate-200/60";
  const iconTone = card.kind
    ? KIND_ICON_TONE[card.kind]
    : "bg-slate-100 text-slate-700";

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`group relative flex flex-col gap-3 rounded-2xl bg-gradient-to-br p-4 text-left ring-1 shadow-sm transition hover:shadow-md hover:ring-emerald-300 sm:p-5 ${tone}`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${iconTone}`}
        >
          <Icon className="h-5 w-5" />
        </span>
        <h3 className="min-w-0 flex-1 text-balance text-base font-semibold leading-tight text-slate-900 sm:text-[17px]">
          {card.heading}
        </h3>
      </div>
      <p className="text-pretty text-[13px] leading-relaxed text-slate-600">
        {previewOf(card.body, 160)}
      </p>
      <span className="mt-auto inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 transition group-hover:gap-1.5">
        {openLabel}
        <span aria-hidden>→</span>
      </span>
    </button>
  );
}

/**
 * Focus-mode modal. Bottom-sheet on mobile, centered card on desktop.
 *  - Esc + click-outside close
 *  - Body scroll locked while open
 *  - Per-modal Copy (text-stripped) / Download (.md) / Print buttons
 *  - Print uses CSS to hide the rest of the page (see globals.css block
 *    on `.printing-deliverable`).
 */
function DeliverableModal({
  card,
  labels,
  onClose,
}: {
  card: DeliverableCard;
  labels: Labels;
  onClose: () => void;
}) {
  const [copyOk, setCopyOk] = useState(false);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const fullText = `# ${card.heading}\n\n${card.body}`;

  function handleCopy() {
    // navigator.clipboard isn't available in old/insecure contexts; the
    // textarea fallback covers those edge cases.
    const stripped = card.body
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/`(.+?)`/g, "$1")
      .replace(/^>\s?/gm, "");
    const text = `${card.heading}\n\n${stripped}`;
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* ignore */
      }
      document.body.removeChild(ta);
    }
    setCopyOk(true);
    window.setTimeout(() => setCopyOk(false), 1800);
  }

  function handleDownload() {
    const slug = card.heading
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
    const blob = new Blob([fullText], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug || "deliverable"}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handlePrint() {
    // Print CSS in globals.css hides everything except `.deliverable-printable`
    // when the body has `printing-deliverable` class. We set it before print
    // and clear after the print dialog closes (`onafterprint` event).
    document.body.classList.add("printing-deliverable");
    const cleanup = () => {
      document.body.classList.remove("printing-deliverable");
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
  }

  // Portal target — defensive `typeof` guard for the SSR pass (the modal
  // is gated on `openIndex !== null` which is always null on first render,
  // so this branch shouldn't actually fire server-side, but keeps the
  // component safe to import in server-rendered trees).
  if (typeof document === "undefined") return null;

  const modalNode = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={card.heading}
      className="deliverable-print-root fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 backdrop-blur-sm sm:items-center"
    >
      {/* Click-outside layer — separate button so the dialog content
          doesn't accidentally capture clicks inside it. */}
      <button
        type="button"
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <div
        className="deliverable-printable relative flex h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:h-[88dvh] sm:rounded-2xl"
      >
        {/* Top bar: title + close — tinted with the card's accent tone so
            the modal reads as a continuation of the card the user just
            clicked, not a generic dialog. */}
        <div
          className={`flex items-center justify-between gap-3 border-b-2 px-5 py-3.5 sm:px-6 ${
            card.kind ? KIND_HEADER_BG[card.kind] : "bg-white"
          } ${card.kind ? KIND_ACCENT_BORDER[card.kind] : "border-slate-200"}`}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            {card.kind && (
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${KIND_ICON_TONE[card.kind]}`}
              >
                {(() => {
                  const Icon = KIND_ICON[card.kind];
                  return <Icon className="h-4 w-4" />;
                })()}
              </span>
            )}
            <h2 className="truncate text-base font-bold text-slate-900 sm:text-lg">
              {card.heading}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={labels.close}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-white hover:text-slate-900"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-8 sm:py-7">
          <article className="text-pretty text-slate-800">
            <ReactMarkdown
              components={makeModalMarkdownComponents(card.kind)}
            >
              {card.body}
            </ReactMarkdown>
          </article>
        </div>

        {/* Action bar */}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-slate-50/60 px-5 py-3 sm:px-6">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
          >
            {copyOk ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-600" />
                {labels.copied}
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                {labels.copy}
              </>
            )}
          </button>
          <button
            type="button"
            onClick={handleDownload}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
          >
            <Download className="h-3.5 w-3.5" />
            {labels.download}
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
          >
            <Printer className="h-3.5 w-3.5" />
            {labels.print}
          </button>
        </div>
      </div>
    </div>
  );

  // Render into document.body via portal so the modal is a sibling of
  // the brief page rather than a deep descendant — required for the
  // `body.printing-deliverable > *:not(.deliverable-print-root)`
  // print-CSS rule that hides everything except the modal during a
  // per-deliverable print.
  return createPortal(modalNode, document.body);
}

/**
 * Same Arabic-transliteration heuristic used by `BriefingNarrative` —
 * detects du'a / dhikr paragraphs by density of long-vowel + diacritic
 * marks (ā ī ū ḥ ṣ ẓ etc.) and the standard opening tokens (Allāhumma,
 * Rabbanā…). Pure paragraphs are styled as "sacred-text cards" instead
 * of plain prose so the khateeb / pembaca can read the du'a comfortably
 * off a phone screen.
 */
function modalLooksLikeArabic(text: string): boolean {
  if (text.length < 40) return false;
  const strong = /(allahumma|al[\s-]?ḥamdu|inna [aA]llaha|rabbana|subḥāna|wa[\s-]?ṣalli|allāhumma)/i;
  if (strong.test(text)) return true;
  const marks = text.match(/[āīūṣḍḥṭẓʿʾ]/g);
  if (!marks) return false;
  return marks.length / text.length >= 0.02;
}

function modalChildrenToString(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(modalChildrenToString).join("");
  if (
    children &&
    typeof children === "object" &&
    "props" in (children as object)
  ) {
    return modalChildrenToString(
      (children as { props: { children?: React.ReactNode } }).props.children,
    );
  }
  return "";
}

/**
 * Modal-specific markdown styling. Larger type than the brief body since
 * the modal is a focus surface. Takes the card's `kind` so blockquotes
 * and section headings inherit the card's accent color — a hadith inside
 * the Khutbah modal reads emerald, inside Gen Z reads violet, etc.
 */
function makeModalMarkdownComponents(kind: CardKind | null): Components {
  const quote = kind ? KIND_QUOTE[kind] : KIND_QUOTE.khutbah;
  const accent = kind
    ? KIND_ICON_TONE[kind].replace("bg-", "text-").replace("-100", "-700").split(" ")[0]
    : "text-slate-700";

  return {
    h1: ({ children }) => (
      <h1
        className={`mt-6 mb-3 text-balance text-xl font-bold text-slate-900 first:mt-0 sm:text-2xl`}
      >
        {children}
      </h1>
    ),
    h2: ({ children }) => (
      <h2
        className={`mt-7 mb-2 text-balance border-b pb-1.5 text-lg font-bold text-slate-900 first:mt-0 sm:text-xl ${kind ? KIND_ACCENT_BORDER[kind] : "border-slate-200"}`}
      >
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3
        className={`mt-5 mb-1 text-balance text-[13px] font-semibold uppercase tracking-wider ${accent}`}
      >
        {children}
      </h3>
    ),
    p: ({ children }) => {
      const text = modalChildrenToString(children);
      if (modalLooksLikeArabic(text)) {
        return (
          <p
            className="my-5 rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50/90 via-white to-teal-50/70 px-6 py-5 text-center font-amiri text-base leading-[2] text-emerald-950 shadow-sm sm:px-8 sm:text-[17px]"
          >
            {children}
          </p>
        );
      }
      return (
        <p className="mt-3 text-pretty leading-[1.75] text-slate-800">
          {children}
        </p>
      );
    },
    ul: ({ children }) => (
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-slate-800">
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-slate-800">
        {children}
      </ol>
    ),
    li: ({ children }) => <li className="leading-[1.75]">{children}</li>,
    blockquote: ({ children }) => (
      <blockquote
        className={`relative my-4 rounded-xl border-l-4 ${quote.border} ${quote.bg} px-5 py-3 pl-12 text-slate-700 shadow-sm`}
      >
        <Quote
          className={`absolute left-3 top-3 h-5 w-5 opacity-50 ${quote.icon}`}
          aria-hidden
        />
        {children}
      </blockquote>
    ),
    strong: ({ children }) => (
      <strong className="font-semibold text-slate-900">{children}</strong>
    ),
    em: ({ children }) => <em className="italic text-slate-700">{children}</em>,
    hr: () => (
      <hr className="my-6 border-0 border-t border-dashed border-slate-300" />
    ),
  };
}
