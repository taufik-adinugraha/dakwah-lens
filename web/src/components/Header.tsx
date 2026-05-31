import { Home } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";

import { auth } from "@/auth";
import { Link } from "@/i18n/navigation";
import { Logo } from "./Logo";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { MobileNav } from "./MobileNav";
import { UserMenu } from "./UserMenu";

export async function Header() {
  const [t, session, locale] = await Promise.all([
    getTranslations("Nav"),
    auth(),
    getLocale(),
  ]);
  const user = session?.user;

  // Mobile-menu items mirror the desktop nav. Plain `<a>` with
  // locale-prefixed paths matches the routed-page shape consistently.
  // Insights is the primary product surface (5 weekly briefings) — call
  // it out with the "insights" tone so MobileNav renders it as an
  // emerald-tinted CTA, and the desktop nav matches with a pill-style
  // link below.
  const mobileItems = [
    { href: `/${locale}`, label: t("home") },
    ...(user
      ? [{ href: `/${locale}/dashboard`, label: t("dashboard") }]
      : []),
    { href: `/${locale}/insights`, label: t("insights") },
    { href: `/${locale}/discussions`, label: t("discussions") },
    { href: `/${locale}/kitab`, label: t("kitab") },
    { href: `/${locale}/flyers/public`, label: t("flyers_library") },
    { href: `/${locale}/pustaka-kajian`, label: t("pustaka_kajian") },
  ];

  return (
    <header className="sticky top-0 z-30 w-full">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex h-12 w-full items-center justify-between gap-3 rounded-full border border-slate-200 bg-white px-3 pr-2 shadow-sm shadow-slate-200/60 sm:px-5">
          {/* Mobile-only: hamburger + home icon on the left. The
              MobileNav component auto-hides on md+, and the desktop
              logo below auto-hides on mobile — so the two never
              collide visually. */}
          <div className="flex items-center gap-1 md:hidden">
            <MobileNav
              items={mobileItems}
              openLabel={t("open_menu")}
              closeLabel={t("close_menu")}
            />
            <Link
              href="/"
              aria-label={t("home")}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100"
            >
              <Home className="h-5 w-5" />
            </Link>
          </div>

          <Link
            href="/"
            className="hidden items-center md:flex"
            aria-label="Dakwah-Lens"
          >
            <Logo />
          </Link>

          <nav className="hidden items-center gap-7 text-sm font-medium text-slate-600 md:flex">
            {user && (
              <Link
                href="/dashboard"
                className="hover:text-slate-900 transition"
              >
                {t("dashboard")}
              </Link>
            )}
            <Link href="/insights" className="hover:text-slate-900 transition">
              {t("insights")}
            </Link>
            <Link
              href="/discussions"
              className="hover:text-slate-900 transition"
            >
              {t("discussions")}
            </Link>
            <Link href="/kitab" className="hover:text-slate-900 transition">
              {t("kitab")}
            </Link>
            <Link
              href="/flyers/public"
              className="hover:text-slate-900 transition"
            >
              {t("flyers_library")}
            </Link>
            <Link
              href="/pustaka-kajian"
              className="hover:text-slate-900 transition"
            >
              {t("pustaka_kajian")}
            </Link>
          </nav>

          <div className="flex items-center gap-1.5 sm:gap-2">
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
