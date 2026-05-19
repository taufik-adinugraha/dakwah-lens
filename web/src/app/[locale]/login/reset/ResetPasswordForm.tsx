"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, CheckCircle2, KeyRound } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { resetPasswordAction } from "@/app/[locale]/login/actions";
import { Spinner } from "@/components/Spinner";

export function ResetPasswordForm({
  email,
  token,
}: {
  email: string;
  token: string;
}) {
  const t = useTranslations("Auth");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  // Token guard — if either piece is missing we render a static error
  // instead of the form so the user can't burn the friendly "reset" link
  // by accident.
  if (!email || !token) {
    return (
      <div className="space-y-4 text-center">
        <h2 className="text-xl font-semibold text-slate-900">
          {t("reset_invalid_link_title")}
        </h2>
        <p className="text-sm text-slate-600">{t("reset_invalid_link_body")}</p>
        <Link
          href="/login?mode=signin"
          className="inline-flex h-10 items-center justify-center rounded-full bg-slate-900 px-4 text-xs font-semibold text-white"
        >
          {t("verify_back_to_login")}
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="space-y-5 text-center">
        <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 ring-1 ring-emerald-200">
          <CheckCircle2 className="h-6 w-6 text-emerald-600" />
        </div>
        <h2 className="text-balance text-xl font-semibold text-slate-900 sm:text-2xl">
          {t("reset_done_title")}
        </h2>
        <p className="text-pretty text-sm leading-relaxed text-slate-600">
          {t("reset_done_body")}
        </p>
        <Link
          href="/login"
          className="inline-flex h-10 items-center justify-center rounded-full bg-slate-900 px-4 text-xs font-semibold text-white"
        >
          {t("verify_back_to_login")}
        </Link>
      </div>
    );
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await resetPasswordAction(form);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setDone(true);
    });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3 text-center">
        <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 ring-1 ring-brand-200">
          <KeyRound className="h-6 w-6 text-brand-700" />
        </div>
        <h2 className="text-balance text-xl font-semibold text-slate-900 sm:text-2xl">
          {t("reset_title")}
        </h2>
        <p className="text-pretty text-sm leading-relaxed text-slate-600">
          {t("reset_body", { email })}
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="token" value={token} />

        <label className="block text-left">
          <span className="text-xs font-medium text-slate-700">
            {t("reset_field_password")}
          </span>
          <input
            name="password"
            type="password"
            required
            minLength={10}
            maxLength={256}
            autoComplete="new-password"
            placeholder={t("reset_field_password_placeholder")}
            className="mt-1.5 block h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
        </label>

        {error && (
          <p
            role="alert"
            className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
          >
            {t(error as Parameters<typeof t>[0])}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="group inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-slate-900 px-4 text-sm font-semibold text-white shadow transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending && <Spinner size="md" />}
          {pending ? t("submit_loading") : t("reset_submit")}
          {!pending && (
            <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
          )}
        </button>
      </form>
    </div>
  );
}
