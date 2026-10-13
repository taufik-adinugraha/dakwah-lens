import { ArrowRight } from "lucide-react";

import { MixedText } from "@/components/library/MixedText";
import { Link } from "@/i18n/navigation";
import { introHref } from "@/lib/routes";

/**
 * The card of LESSON ZERO — "Pengantar: harakat dan tiga jenis kata", the curriculum's lesson
 * with no ayah that opens the course (kurikulum-dasar.md decision 1, operator-approved
 * 2026-10-13) — listed FIRST on the track page and on the page of the surah that hosts it
 * (Al-Fatihah), before ayah 1: a learner who has never read a harakah starts here, and ayah 1
 * no longer opens with the primer. The whole card is the link, as an ayah's card is; no Arabic
 * on it (the lesson has no ayah). Text through MixedText: nothing is cut inside a word.
 */
export function IntroCard({ eyebrow, title, hint, cta }: { eyebrow: string; title: string; hint: string; cta: string }) {
  return (
    <Link href={introHref()} data-intro-card className="glow-card block p-5">
      <span className="block text-base font-semibold text-forest">{eyebrow}</span>
      <span className="mt-1 block font-display text-2xl font-medium text-ink">
        <MixedText text={title} />
      </span>
      <span className="mt-1 block text-pretty text-base text-ink-muted">
        <MixedText text={hint} />
      </span>
      <span className="mt-3 flex justify-end">
        <span className="inline-flex items-center gap-1.5 text-base font-semibold text-forest">
          {cta}
          <ArrowRight aria-hidden="true" className="h-5 w-5 shrink-0" />
        </span>
      </span>
    </Link>
  );
}
