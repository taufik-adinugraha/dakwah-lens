import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { kosakataHref, kosakataPathHref } from "@/lib/routes";

/** The list and the learning path, as two ways into the same words. */
export async function KosakataTabs({ current }: { current: "all" | "path" }) {
  const t = await getTranslations("KosakataPath");
  const tab = (active: boolean) =>
    `-mb-px inline-flex min-h-12 items-center border-b-[3px] px-3 text-base ${active ? "border-forest font-semibold text-forest" : "border-transparent font-medium text-ink-muted hover:text-ink"}`;
  return (
    <nav aria-label={t("tabs_label")} data-kosakata-tabs="" className="mb-6 flex flex-wrap gap-1 border-b border-hairline">
      <Link href={kosakataHref()} aria-current={current === "all" ? "page" : undefined} className={tab(current === "all")}>
        {t("tab_all")}
      </Link>
      <Link href={kosakataPathHref()} aria-current={current === "path" ? "page" : undefined} className={tab(current === "path")}>
        {t("tab_path")}
      </Link>
    </nav>
  );
}
