import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CheckCircle2, MailX } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { verifyEmailAction } from "@/app/[locale]/login/actions";

/**
 * Click-through from the verification email.
 *
 * Reads `?email=&token=` and consumes the token. On success → redirects
 * to `/login?verified=1`. On failure → renders a small error page with a
 * link to resend.
 *
 * Why a real page instead of an API route: this is the most-visible link
 * we send to users, and a stray click should land somewhere reassuring,
 * not on a 500 or a raw JSON blob.
 */
export default async function VerifyEmailPage({
  params,
  searchParams,
}: PageProps<"/[locale]/auth/verify">) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Auth" });

  const email = typeof sp.email === "string" ? sp.email : "";
  const token = typeof sp.token === "string" ? sp.token : "";

  if (!email || !token) {
    return <FailureCard message={t("verify_invalid_link")} t={t} />;
  }

  const result = await verifyEmailAction(email, token);
  if (result.ok) {
    redirect(`/login?verified=1&email=${encodeURIComponent(email)}`);
  }

  return <FailureCard message={t("verify_expired_or_used")} t={t} />;
}

function FailureCard({
  message,
  t,
}: {
  message: string;
  t: Awaited<ReturnType<typeof getTranslations<"Auth">>>;
}) {
  return (
    <section className="mx-auto flex max-w-md flex-col items-center justify-center px-4 py-24 text-center">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 text-rose-600 ring-1 ring-rose-100">
        <MailX className="h-6 w-6" />
      </span>
      <h1 className="mt-4 text-balance text-xl font-bold text-slate-900">
        {t("verify_failed_title")}
      </h1>
      <p className="mt-2 text-pretty text-sm text-slate-600">{message}</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <Link
          href="/login?resend=1"
          className="inline-flex h-9 items-center rounded-full bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800"
        >
          {t("verify_resend_cta")}
        </Link>
        <Link
          href="/login"
          className="inline-flex h-9 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          {t("verify_back_to_login")}
        </Link>
      </div>
      <CheckCircle2 className="hidden" />
    </section>
  );
}
