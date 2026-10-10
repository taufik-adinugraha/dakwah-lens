import { ChevronLeft } from "lucide-react";

import { Link } from "@/i18n/navigation";

/**
 * One small way back ("‹ Al-Fatihah", "‹ Belajar"), in place of a long
 * breadcrumb (operator, 2026-10-10: fewer links on screen). A 48px target,
 * underlined like every standalone text link. `hint` is read before the
 * visible label ("Kembali ke daftar ayat Al-Fatihah"), so the accessible
 * name still contains what is on screen. In-module paths only.
 */
export function BackLink({ href, label, hint }: { href: string; label: string; hint?: string }) {
  return (
    <Link href={href} className="link-text inline-flex min-h-12 items-center gap-1 pr-2 text-base font-medium">
      <ChevronLeft aria-hidden className="h-5 w-5 shrink-0" />
      {hint ? <span className="sr-only">{hint} </span> : null}
      {label}
    </Link>
  );
}
