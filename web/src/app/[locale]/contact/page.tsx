import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Info, Mail, MessageSquare } from "lucide-react";

import { ContactForm } from "./ContactForm";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/contact">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Contact" });
  return { title: t("page_title") };
}

export default async function ContactPage({
  params,
}: PageProps<"/[locale]/contact">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Contact");

  return (
    <>
      <section className="relative isolate overflow-hidden pt-12 pb-8 sm:pt-16 sm:pb-12">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
        >
          <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(90rem 42rem at 50% -12rem, rgba(14, 90, 60, 0.42), transparent 68%)," +
              "radial-gradient(64rem 36rem at 88% 108%, rgba(14, 90, 60, 0.26), transparent 68%)",
          }}
        />
        </div>

        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50/80 px-3 py-1 text-xs font-medium text-brand-700 shadow-sm backdrop-blur">
            <MessageSquare className="h-3.5 w-3.5" />
            {t("badge")}
          </span>
          <h1 className="mt-4 text-balance text-3xl font-bold leading-[1.1] tracking-tight text-ink sm:text-5xl">
            {t("hero_title")}
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-pretty text-base leading-relaxed text-ink-muted sm:text-lg">
            {t("hero_subtitle")}
          </p>
        </div>
      </section>

      <section className="pb-16 sm:pb-24">
        <div className="mx-auto max-w-2xl px-4 sm:px-6">
          {/* Beta-access framing — the landing page now sends visitors
              here via "Hubungi tim untuk akses beta", so call out the
              expected flow up front instead of leaving people to guess
              what to write in the message body. */}
          <div className="mb-5 flex items-start gap-3 rounded-2xl border border-hairline bg-forest-tint/70 px-4 py-3 text-sm leading-relaxed text-ink shadow-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-forest" />
            <div>
              <p className="font-semibold">{t("beta_access_title")}</p>
              <p className="mt-0.5 text-forest">
                {t("beta_access_body")}
              </p>
            </div>
          </div>
          <div className="rounded-2xl border border-hairline bg-white p-6 shadow-sm sm:p-8">
            <ContactForm />
          </div>
          <p className="mx-auto mt-6 flex max-w-xl items-start justify-center gap-2 text-pretty text-center text-xs leading-relaxed text-ink-faint">
            <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" />
            {t("footer_note")}
          </p>
        </div>
      </section>
    </>
  );
}
