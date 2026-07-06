"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, CheckCircle2, Send } from "lucide-react";

import { sendContactMessage } from "./actions";
import { Spinner } from "@/components/Spinner";

export function ContactForm() {
  const t = useTranslations("Contact");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await sendContactMessage(form);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setSent(true);
    });
  }

  if (sent) {
    return (
      <div className="space-y-5 text-center">
        <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-forest-tint ring-1 ring-forest/20">
          <CheckCircle2 className="h-6 w-6 text-forest" />
        </div>
        <h2 className="text-balance text-xl font-semibold text-ink sm:text-2xl">
          {t("sent_title")}
        </h2>
        <p className="text-pretty text-sm leading-relaxed text-ink-muted">
          {t("sent_body")}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {/* Honeypot — invisible to humans, irresistible to bots. */}
      <input
        type="text"
        name="_hp"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute h-0 w-0 opacity-0"
        style={{ position: "absolute", left: "-9999px" }}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t("field_name")}
          name="name"
          type="text"
          required
          maxLength={120}
          autoComplete="name"
        />
        <Field
          label={t("field_email")}
          name="email"
          type="email"
          required
          autoComplete="email"
        />
      </div>

      <Field
        label={t("field_subject")}
        name="subject"
        type="text"
        maxLength={200}
        optional
      />

      <label className="block text-left">
        <span className="text-xs font-semibold text-ink-muted">
          {t("field_message")}
          <span className="ml-2 text-[10px] font-normal text-ink-faint">
            {t("field_message_hint")}
          </span>
        </span>
        <textarea
          name="message"
          required
          minLength={10}
          maxLength={5000}
          rows={6}
          placeholder={t("field_message_placeholder")}
          className="mt-1.5 block w-full resize-y rounded-lg border border-hairline bg-white px-3 py-2 text-sm text-ink shadow-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
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
        className="group inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-forest px-4 text-sm font-semibold text-white shadow transition hover:bg-forest-hover disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? (
          <>
            <Spinner size="md" />
            {t("submit_loading")}
          </>
        ) : (
          <>
            <Send className="h-4 w-4" />
            {t("submit")}
            <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
          </>
        )}
      </button>
    </form>
  );
}

function Field({
  label,
  name,
  type,
  required,
  maxLength,
  autoComplete,
  optional,
}: {
  label: string;
  name: string;
  type: string;
  required?: boolean;
  maxLength?: number;
  autoComplete?: string;
  optional?: boolean;
}) {
  return (
    <label className="block text-left">
      <span className="text-xs font-semibold text-ink-muted">
        {label}
        {optional && (
          <span className="ml-1 text-[10px] font-normal text-ink-faint">
            (optional)
          </span>
        )}
      </span>
      <input
        name={name}
        type={type}
        required={required}
        maxLength={maxLength}
        autoComplete={autoComplete}
        className="mt-1.5 block h-11 w-full rounded-lg border border-hairline bg-white px-3 text-sm text-ink shadow-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
      />
    </label>
  );
}
