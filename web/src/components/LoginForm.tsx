"use client";

import { useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowRight, CheckCircle2, Mail } from "lucide-react";
import clsx from "clsx";

import { Link } from "@/i18n/navigation";
import {
  forgotPasswordAction,
  googleSignInAction,
  resendVerificationAction,
  signinAction,
  signupAction,
} from "@/app/[locale]/login/actions";
import { Spinner } from "@/components/Spinner";

type Mode = "signin" | "signup" | "forgot";

export function LoginForm({
  initialMode = "signin",
  googleEnabled = false,
}: {
  initialMode?: Mode;
  googleEnabled?: boolean;
}) {
  const t = useTranslations("Auth");
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/";
  // Banner triggered after the user clicks the verification link.
  const justVerified = searchParams.get("verified") === "1";

  const [mode, setMode] = useState<Mode>(initialMode);
  const [error, setError] = useState<string | null>(null);
  // Post-signup confirmation panel — the signup actually succeeded, but
  // login is blocked until the email is verified.
  const [checkEmailFor, setCheckEmailFor] = useState<string | null>(null);
  // Post-forgot-password confirmation panel.
  const [resetSentTo, setResetSentTo] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);

    startTransition(async () => {
      if (mode === "signup") {
        const r = await signupAction(form);
        if (!r.ok) {
          setError(r.error);
          return;
        }
        setCheckEmailFor(r.email);
        return;
      }
      if (mode === "forgot") {
        const r = await forgotPasswordAction(form);
        if (!r.ok) {
          setError(r.error);
          return;
        }
        setResetSentTo(String(form.get("email") ?? ""));
        return;
      }
      // signin
      const err = await signinAction(form);
      if (err?.ok === false) setError(err.error);
    });
  }

  if (checkEmailFor) {
    return (
      <CheckEmailState
        email={checkEmailFor}
        t={t}
        onBack={() => {
          setCheckEmailFor(null);
          setMode("signin");
          setError(null);
        }}
      />
    );
  }
  if (resetSentTo) {
    return (
      <ResetSentState
        email={resetSentTo}
        t={t}
        onBack={() => {
          setResetSentTo(null);
          setMode("signin");
          setError(null);
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Banner — visible only on the standard signin tab after a successful verify click. */}
      {justVerified && mode === "signin" && (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <p>{t("verify_success_banner")}</p>
        </div>
      )}

      {mode !== "forgot" && (
        <Tabs
          mode={mode === "signin" ? "signin" : "signup"}
          onChange={(m) => {
            setMode(m);
            setError(null);
          }}
          t={t}
        />
      )}

      <p className="text-pretty text-sm leading-relaxed text-slate-600">
        {mode === "signin"
          ? t("intro_signin")
          : mode === "signup"
            ? t("intro_signup")
            : t("intro_forgot")}
      </p>

      {googleEnabled && mode !== "forgot" && (
        <>
          <form action={googleSignInAction}>
            <input type="hidden" name="callbackUrl" value={callbackUrl} />
            <button
              type="submit"
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
            >
              <GoogleIcon />
              {t("google_button")}
            </button>
          </form>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-white px-3 uppercase tracking-wider text-slate-500">
                {t("divider")}
              </span>
            </div>
          </div>
        </>
      )}

      <form onSubmit={onSubmit} className="space-y-4">
        <input type="hidden" name="callbackUrl" value={callbackUrl} />

        {mode === "signup" && (
          <Field
            label={t("field_name")}
            name="name"
            type="text"
            placeholder={t("field_name_placeholder")}
            autoComplete="name"
            required
            maxLength={120}
          />
        )}
        <Field
          label={t("field_email")}
          name="email"
          type="email"
          placeholder={t("field_email_placeholder")}
          autoComplete="email"
          required
          maxLength={254}
        />
        {mode !== "forgot" && (
          <Field
            label={t("field_password")}
            name="password"
            type="password"
            placeholder={t("field_password_placeholder")}
            autoComplete={
              mode === "signup" ? "new-password" : "current-password"
            }
            required
            minLength={mode === "signup" ? 10 : 1}
            maxLength={256}
          />
        )}

        {/* "Forgot password?" link below the password input in signin mode. */}
        {mode === "signin" && (
          <div className="-mt-2 flex justify-end">
            <button
              type="button"
              onClick={() => {
                setMode("forgot");
                setError(null);
              }}
              className="text-xs font-medium text-brand-700 hover:text-brand-900"
            >
              {t("forgot_link")}
            </button>
          </div>
        )}

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
          disabled={isPending}
          className="group inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-slate-900 px-4 text-sm font-semibold text-white shadow transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending && <Spinner size="md" />}
          {isPending
            ? t("submit_loading")
            : mode === "signup"
              ? t("submit_signup")
              : mode === "forgot"
                ? t("submit_forgot")
                : t("submit_signin")}
          {!isPending && (
            <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
          )}
        </button>

        {mode === "signup" && (
          <p className="text-pretty text-center text-xs leading-relaxed text-slate-500">
            {t.rich("signup_terms_notice", {
              terms: (chunks) => (
                <Link
                  href="/terms"
                  target="_blank"
                  className="font-medium text-slate-700 underline-offset-2 hover:underline"
                >
                  {chunks}
                </Link>
              ),
              privacy: (chunks) => (
                <Link
                  href="/privacy"
                  target="_blank"
                  className="font-medium text-slate-700 underline-offset-2 hover:underline"
                >
                  {chunks}
                </Link>
              ),
            })}
          </p>
        )}
      </form>

      {mode === "forgot" ? (
        <p className="text-center text-sm text-slate-600">
          <button
            type="button"
            onClick={() => {
              setMode("signin");
              setError(null);
            }}
            className="font-semibold text-brand-700 hover:text-brand-900"
          >
            {t("forgot_back_to_signin")}
          </button>
        </p>
      ) : (
        <p className="text-center text-sm text-slate-600">
          {mode === "signup" ? (
            <>
              {t("footer_signup_prompt")}{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("signin");
                  setError(null);
                }}
                className="font-semibold text-brand-700 hover:text-brand-900"
              >
                {t("footer_signup_link")}
              </button>
            </>
          ) : (
            <>
              {t("footer_signin_prompt")}{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("signup");
                  setError(null);
                }}
                className="font-semibold text-brand-700 hover:text-brand-900"
              >
                {t("footer_signin_link")}
              </button>
            </>
          )}
        </p>
      )}
    </div>
  );
}

function Tabs({
  mode,
  onChange,
  t,
}: {
  mode: "signin" | "signup";
  onChange: (m: "signin" | "signup") => void;
  t: ReturnType<typeof useTranslations<"Auth">>;
}) {
  return (
    <div className="inline-flex w-full rounded-full bg-slate-100 p-1 text-sm font-medium">
      {(["signin", "signup"] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className={clsx(
            "flex-1 rounded-full px-3 py-1.5 transition",
            mode === m
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-500 hover:text-slate-800",
          )}
          aria-pressed={mode === m}
        >
          {m === "signin" ? t("tab_signin") : t("tab_signup")}
        </button>
      ))}
    </div>
  );
}

function Field({
  label,
  name,
  type,
  placeholder,
  autoComplete,
  required,
  minLength,
  maxLength,
}: {
  label: string;
  name: string;
  type: string;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
}) {
  return (
    <label className="block text-left">
      <span className="text-xs font-medium text-slate-700">{label}</span>
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
        maxLength={maxLength}
        className="mt-1.5 block h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
      />
    </label>
  );
}

/**
 * Confirmation panel rendered right after a successful signup. Tells the
 * user where to click, what address it went to, and gives a "resend"
 * escape hatch in case the email got stuck in spam.
 */
function CheckEmailState({
  email,
  t,
  onBack,
}: {
  email: string;
  t: ReturnType<typeof useTranslations<"Auth">>;
  onBack: () => void;
}) {
  const [resent, setResent] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onResend() {
    if (resent || pending) return;
    const fd = new FormData();
    fd.set("email", email);
    startTransition(async () => {
      const r = await resendVerificationAction(fd);
      if (r.ok) {
        setResent(true);
      } else {
        setResendError(r.error);
      }
    });
  }

  return (
    <div className="space-y-5 text-center">
      <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 ring-1 ring-brand-200">
        <Mail className="h-6 w-6 text-brand-700" />
      </div>
      <h2 className="text-balance text-xl font-semibold text-slate-900 sm:text-2xl">
        {t("verify_sent_title")}
      </h2>
      <p className="text-pretty text-sm leading-relaxed text-slate-600">
        {t("verify_sent_body", { email })}
      </p>
      <p className="text-pretty text-xs leading-relaxed text-slate-500">
        {t("verify_sent_hint")}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={onResend}
          disabled={resent || pending}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending && <Spinner size="sm" />}
          {pending
            ? t("verify_resending")
            : resent
              ? t("verify_resent")
              : t("verify_resend_cta")}
        </button>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-10 items-center justify-center rounded-full bg-slate-900 px-4 text-xs font-semibold text-white hover:bg-slate-800"
        >
          {t("verify_back_to_login")}
        </button>
      </div>
      {resendError && (
        <p className="text-xs text-rose-600">{t(resendError as Parameters<typeof t>[0])}</p>
      )}
    </div>
  );
}

/**
 * Shown after a forgot-password request. We don't reveal whether the email
 * exists — the wording works for both "account exists" and "no such email".
 */
function ResetSentState({
  email,
  t,
  onBack,
}: {
  email: string;
  t: ReturnType<typeof useTranslations<"Auth">>;
  onBack: () => void;
}) {
  return (
    <div className="space-y-5 text-center">
      <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 ring-1 ring-brand-200">
        <Mail className="h-6 w-6 text-brand-700" />
      </div>
      <h2 className="text-balance text-xl font-semibold text-slate-900 sm:text-2xl">
        {t("forgot_sent_title")}
      </h2>
      <p className="text-pretty text-sm leading-relaxed text-slate-600">
        {t("forgot_sent_body", { email })}
      </p>
      <p className="text-pretty text-xs leading-relaxed text-slate-500">
        {t("forgot_sent_hint")}
      </p>
      <button
        type="button"
        onClick={onBack}
        className="inline-flex h-10 items-center justify-center rounded-full bg-slate-900 px-4 text-xs font-semibold text-white hover:bg-slate-800"
      >
        {t("verify_back_to_login")}
      </button>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 18 18" className="h-4 w-4" aria-hidden>
      <path
        fill="#EA4335"
        d="M9 3.48c1.69 0 2.85.73 3.51 1.34l2.56-2.5C13.45.97 11.43 0 9 0 5.48 0 2.44 2.02 .96 4.96l2.93 2.27C4.58 5.05 6.6 3.48 9 3.48z"
      />
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.74-.06-1.28-.19-1.84H9v3.34h4.96c-.1.83-.64 2.08-1.84 2.92l2.84 2.2c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#FBBC05"
        d="M3.88 10.78A5.54 5.54 0 0 1 3.58 9c0-.62.11-1.22.29-1.78L.96 4.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.04l2.92-2.26z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.84-2.2c-.76.53-1.78.9-3.12.9-2.4 0-4.42-1.57-5.14-3.75L.96 13.04C2.45 15.98 5.48 18 9 18z"
      />
    </svg>
  );
}
