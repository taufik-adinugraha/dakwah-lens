import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";

export default async function NotFound() {
  const t = await getTranslations("NotFound");
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center sm:px-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-forest">
        404
      </p>
      <h1 className="mt-2 font-display text-3xl font-medium">{t("title")}</h1>
      <p className="mt-3 text-ink-muted">{t("body")}</p>
      <Link
        href="/"
        className="mt-6 inline-flex rounded-full bg-forest px-4 py-2 text-sm font-semibold text-paper transition hover:bg-forest-hover"
      >
        {t("cta")}
      </Link>
    </div>
  );
}
