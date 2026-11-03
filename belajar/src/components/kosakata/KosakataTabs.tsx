import { GraduationCap, List } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { kosakataHref, kosakataPathHref } from "@/lib/routes";

/**
 * The learning path and the list, as two ways into the same words. The path comes first because it is
 * where the section opens (operator 2026-11-03: "set belajar bertahap as first/default tab";
 * src/proxy.ts sends /kosakata there). The list's tab names its first page, since /kosakata itself is
 * the path. Each is a large control, not an underlined word (operator 2026-11-03: "people easily
 * overlook them"): btn-tab in globals.css, its look set by aria-current.
 */
export async function KosakataTabs({ current }: { current: "all" | "path" }) {
  const t = await getTranslations("KosakataPath");
  return (
    <nav aria-label={t("tabs_label")} data-kosakata-tabs="" className="mt-5 mb-5 grid grid-cols-2 gap-2">
      <Link href={kosakataPathHref()} aria-current={current === "path" ? "page" : undefined} className="btn-tab">
        <GraduationCap aria-hidden className="size-6 shrink-0" />
        {t("tab_path")}
      </Link>
      <Link href={`${kosakataHref()}?hal=1`} aria-current={current === "all" ? "page" : undefined} className="btn-tab">
        <List aria-hidden className="size-6 shrink-0" />
        {t("tab_all")}
      </Link>
    </nav>
  );
}
