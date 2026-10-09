import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { hubHref } from "@/lib/routes";

export default async function NotFound() {
  const t = await getTranslations("NotFound");
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center sm:px-6">
      <p className="text-sm font-semibold text-forest">404</p>
      <h1 className="mt-2 font-display text-3xl font-medium">{t("title")}</h1>
      <p className="mt-3 text-lg text-ink-muted">{t("body")}</p>
      <Link href={hubHref()} className="btn-primary mt-8 w-full sm:w-auto">
        {t("cta")}
      </Link>
    </div>
  );
}
