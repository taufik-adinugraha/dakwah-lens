import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft } from "lucide-react";

import { Link } from "@/i18n/navigation";
import Image from "next/image";
import { ResetPasswordForm } from "./ResetPasswordForm";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/login/reset">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Auth" });
  return { title: t("reset_page_title") };
}

export default async function ResetPasswordPage({
  params,
  searchParams,
}: PageProps<"/[locale]/login/reset">) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);

  const t = await getTranslations("Auth");
  const email = typeof sp.email === "string" ? sp.email : "";
  const token = typeof sp.token === "string" ? sp.token : "";

  return (
    <section className="relative isolate flex flex-1 items-center justify-center overflow-hidden py-12 sm:py-16">
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

      <div className="mx-auto w-full max-w-md px-4 sm:px-6">
        <div className="flex items-center justify-between">
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 text-sm text-ink-faint hover:text-ink"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t("verify_back_to_login")}
          </Link>
          <Image
            src="/dakwah-lens-logo-short-removebg.png"
            alt="Dakwah-Lens"
            width={36}
            height={36}
            className="h-9 w-auto"
          />
        </div>

        <div className="mt-8 rounded-2xl border border-hairline bg-white p-6 shadow-sm sm:p-8">
          <ResetPasswordForm email={email} token={token} />
        </div>
      </div>
    </section>
  );
}
