import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { hubHref } from "@/lib/routes";

/**
 * The module's own 404, inside the locale layout. `data-not-found` marks it for the CI checks
 * (scripts/ci/surahs-smoke.mjs, screenshots.mjs): Next sends this boundary's page in the RSC
 * payload rather than the server HTML, so a smoke check on the HTML cannot read its title as
 * visible text (and the title is in the next-intl messages payload of every page anyway), but
 * it can find this attribute, which no message carries (CI 2026-10-11).
 */
export default async function NotFound() {
  const t = await getTranslations("NotFound");
  return (
    <div data-not-found="" className="mx-auto max-w-xl px-4 py-24 text-center sm:px-6">
      <p className="text-sm font-semibold text-forest">404</p>
      <h1 className="mt-2 font-display text-3xl font-medium">{t("title")}</h1>
      <p className="mt-3 text-lg text-ink-muted">{t("body")}</p>
      <Link href={hubHref()} className="btn-primary mt-8 w-full sm:w-auto">
        {t("cta")}
      </Link>
    </div>
  );
}
