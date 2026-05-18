import { getTranslations } from "next-intl/server";

import { auth } from "@/auth";
import { Link } from "@/i18n/navigation";
import { Logo } from "./Logo";

export async function Footer() {
  const [t, tNav, session] = await Promise.all([
    getTranslations("Footer"),
    getTranslations("Nav"),
    auth(),
  ]);

  // Approved viewers normally get redirected away from `/` — append the
  // marketing-view sentinel so anchor links to `#features` etc. still work.
  const isApproved = session?.user?.status === "approved";
  const sectionLink = (hash: string) =>
    isApproved ? `/?view=marketing${hash}` : `/${hash}`;

  return (
    <footer className="relative mt-16 bg-slate-950 text-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 md:flex-row md:items-center md:justify-between md:gap-10">
        {/* Brand block */}
        <div className="flex items-center gap-3">
          <Logo tone="light" showWordmark={false} />
          <div>
            <p className="text-sm font-semibold">Dakwah-Lens</p>
            <p className="max-w-xs text-pretty text-[11px] leading-relaxed text-slate-400">
              {t("tagline")}
            </p>
          </div>
        </div>

        {/* Nav cluster — wraps gracefully on narrow screens */}
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <FooterLink href={sectionLink("#features")}>
            {tNav("features")}
          </FooterLink>
          <FooterLink href={sectionLink("#how-it-works")}>
            {tNav("how_it_works")}
          </FooterLink>
          <FooterLink href="/kitab">{tNav("kitab")}</FooterLink>
          <Divider />
          <FooterLink href="/about">{t("organization")}</FooterLink>
          <FooterLink href="/contact">{t("contact")}</FooterLink>
          <FooterLink href="/privacy">{t("privacy")}</FooterLink>
          <FooterLink href="/terms">{t("terms")}</FooterLink>
          <Divider />
          <Link
            href={sectionLink("#donate")}
            className="font-semibold text-emerald-400 transition hover:text-emerald-300"
          >
            {tNav("donate")}
          </Link>
        </nav>
      </div>

      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-1.5 px-4 py-3 text-[11px] text-slate-400 sm:flex-row sm:px-6">
          <span>© {new Date().getFullYear()} Sukses & Berkah Group</span>
          <span>{t("made_with")}</span>
        </div>
      </div>
    </footer>
  );
}

function FooterLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="text-white/80 transition hover:text-white"
    >
      {children}
    </Link>
  );
}

function Divider() {
  return <span aria-hidden className="text-slate-600">·</span>;
}
