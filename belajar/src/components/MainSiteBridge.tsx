"use client";

import clsx from "clsx";
import { ArrowUpRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { BRIDGES, type BridgeId, mainSiteHref } from "@/lib/mainSite";

/**
 * One way from Belajar to the main site at a moment it makes sense (operator, 2026-10-10: the
 * module should bring people to dakwah-lens.id): a calm line of text with ONE labelled link,
 * not a banner, not a card. Which page, which words and which utm_campaign come from
 * lib/mainSite.ts BRIDGES; the link names where it goes, so it reads on its own.
 *
 * A plain <a> with the absolute address (cross-app: next-intl's Link would prefix /belajar),
 * same tab, underlined like every text link, a 48px target. A client component only so it can
 * sit inside the stage's end card as well as in server pages; it renders in the static HTML.
 */
export function MainSiteBridge({ id, className }: { id: BridgeId; className?: string }) {
  const t = useTranslations("MainSite");
  const locale = useLocale();
  const { page, placement } = BRIDGES[id];
  const lead = t.has(`${id}_lead`) ? t(`${id}_lead`) : null;
  return (
    <p
      data-main-site={id}
      className={clsx("flex max-w-prose flex-wrap items-center gap-x-2 text-pretty text-base text-ink", className)}
    >
      {lead ? (
        <span>
          <Glued text={lead} />
        </span>
      ) : null}
      <a href={mainSiteHref(locale, page, placement)} className="link-text inline-flex min-h-12 items-center gap-1.5 font-semibold">
        <span>
          <Glued text={t(`${id}_label`)} />
        </span>
        <ArrowUpRight aria-hidden className="h-5 w-5 shrink-0" />
      </a>
    </p>
  );
}

/** "Dakwah-Lens", "Al-Qur'an": a hyphenated word never breaks at its hyphen (operator,
 *  2026-10-10: clean line breaks). Spaces still break. */
function Glued({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\S+-\S+)/).map((part, i) =>
        i % 2 ? (
          <span key={i} className="whitespace-nowrap">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}
