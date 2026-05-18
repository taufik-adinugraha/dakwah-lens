import { getTranslations } from "next-intl/server";

import { auth } from "@/auth";
import { Link } from "@/i18n/navigation";
import { Logo } from "./Logo";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { UserMenu } from "./UserMenu";

export async function Header() {
  const [t, session] = await Promise.all([getTranslations("Nav"), auth()]);
  const user = session?.user;

  // For signed-in approved users the landing page server-redirects to
  // /dashboard. Appending `?view=marketing` opts out so the anchor links
  // (#features / #how-it-works / #donate) can scroll to their target.
  const isApproved = user?.status === "approved";
  const sectionLink = (hash: string) =>
    isApproved ? `/?view=marketing${hash}` : `/${hash}`;

  return (
    <header className="sticky top-0 z-30 w-full">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex h-12 w-full items-center justify-between gap-3 rounded-full border border-slate-200 bg-white px-3 pr-2 shadow-sm shadow-slate-200/60 sm:px-5">
          <Link href="/" className="flex items-center" aria-label="Dakwah-Lens">
            <Logo />
          </Link>

          <nav className="hidden items-center gap-7 text-sm font-medium text-slate-600 md:flex">
            <Link
              href={sectionLink("#features")}
              className="hover:text-slate-900 transition"
            >
              {t("features")}
            </Link>
            <Link
              href={sectionLink("#how-it-works")}
              className="hover:text-slate-900 transition"
            >
              {t("how_it_works")}
            </Link>
            <Link href="/kitab" className="hover:text-slate-900 transition">
              {t("kitab")}
            </Link>
            <Link
              href="/briefs/public"
              className="hover:text-slate-900 transition"
            >
              {t("briefs_library")}
            </Link>
            <Link
              href={sectionLink("#donate")}
              className="text-emerald-700 hover:text-emerald-900 transition"
            >
              {t("donate")}
            </Link>
          </nav>

          <div className="flex items-center gap-2">
            <LocaleSwitcher />
            {user?.email ? (
              <UserMenu
                email={user.email}
                name={user.name}
                status={user.status ?? "pending"}
                role={user.role ?? "user"}
              />
            ) : (
              <Link
                href="/login"
                className="inline-flex h-8 items-center rounded-full bg-slate-900 px-3.5 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800 sm:h-9 sm:px-4 sm:text-sm"
              >
                {t("login")}
              </Link>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
