import { Home } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import Image from "next/image";

import { auth } from "@/auth";
import { Link } from "@/i18n/navigation";
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
    { href: `/${locale}/briefings`, label: t("insights") },
    { href: `/${locale}/discussions`, label: t("discussions") },
    { href: `/${locale}/kitab`, label: t("kitab") },
    { href: `/${locale}/flyers/public`, label: t("flyers_library") },
    // Pustaka Kajian hidden from header nav 2026-06-06 while the
    // generation flow is being reworked. Route still accessible via
    // direct URL for operators.
  ];

  return (
    <header className="sticky top-0 z-30 w-full border-b border-hairline bg-paper/85 font-body backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex h-full w-full items-center justify-between gap-3">
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
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-muted transition hover:bg-paper-deep"
            >
              <Home className="h-5 w-5" />
            </Link>
          </div>

          <Link
            href="/"
            className="hidden items-center md:flex"
            aria-label="Dakwah-Lens"
          >
            <Image
              src="/dakwah-lens-logo-long-removebg.png"
              alt="Dakwah-Lens"
              width={752}
              height={281}
              priority
              className="h-9 w-auto rounded-lg"
            />
          </Link>

          <nav className="hidden items-center gap-7 text-sm font-medium text-ink-muted md:flex">
            {user && (
              <Link
                href="/dashboard"
                className="hover:text-ink transition"
              >
                {t("dashboard")}
              </Link>
            )}
            <Link href="/briefings" className="hover:text-ink transition">
              {t("insights")}
            </Link>
            <Link
              href="/discussions"
              className="hover:text-ink transition"
            >
              {t("discussions")}
            </Link>
            <Link href="/kitab" className="hover:text-ink transition">
              {t("kitab")}
            </Link>
            <Link
              href="/flyers/public"
              className="hover:text-ink transition"
            >
              {t("flyers_library")}
            </Link>
            {/* Pustaka Kajian hidden from header nav 2026-06-06 — the
                /pustaka-kajian route still works via direct URL for
                operators, just no link surface for visitors. */}
          </nav>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <LocaleSwitcher />
            {user?.email && (
              <UserMenu
                email={user.email}
                name={user.name}
                status={user.status ?? "pending"}
                role={user.role ?? "user"}
              />
            )}
            {/* Anonymous-visitor login button intentionally hidden 2026-06-06
                while signups are paused / product is admin-only. The /login
                route still works for direct-URL access by operators. */}
          </div>
        </div>
      </div>
    </header>
  );
}
