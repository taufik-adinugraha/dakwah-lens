import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { auth } from "@/auth";
import { OnboardingWizard } from "./OnboardingWizard";

// Auth-dependent — must not be prerendered, or anonymous traffic gets a
// cached copy of the wizard and the in-page session check below is dead
// code. Proxy middleware also gates this route, but `force-dynamic` is
// the local belt-and-suspenders.
export const dynamic = "force-dynamic";

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

  // Translator functions can't cross the server→client boundary — RSC
  // requires serializable props. The wizard pulls its own translations
  // via `useTranslations()` inside the client component instead.
  return <OnboardingWizard />;
}
