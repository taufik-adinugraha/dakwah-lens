import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { auth } from "@/auth";
import { OnboardingWizard } from "./OnboardingWizard";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/onboarding">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Onboarding" });
  return { title: t("page_title") };
}

export default async function OnboardingPage({
  params,
}: PageProps<"/[locale]/onboarding">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/onboarding");
  }

  const t = await getTranslations({ locale, namespace: "Onboarding" });
  const tInsights = await getTranslations({ locale, namespace: "Insights" });

  return (
    <OnboardingWizard
      t={(k, v) => t(k as Parameters<typeof t>[0], v)}
      tInsights={(k) => tInsights(k as Parameters<typeof tInsights>[0])}
    />
  );
}
