"use client";

import { LogIn, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type Me = { user: { name: string | null } | null };

/**
 * Who is signed in, fetched client-side from /belajar/api/me so that lesson
 * pages stay statically prerendered (reading cookies server-side would make
 * every page dynamic). Anonymous learning is first-class: this row only
 * offers a sign-in link, it never gates content. It is one row of the
 * header's Menu panel (HeaderControls), styled like its neighbours.
 *
 * Sign-in goes through the main app (relative callbackUrl — the main login
 * only accepts relative callbacks, so /belajar/… round-trips safely).
 */
export function AccountChip({ locale }: { locale: string }) {
  const t = useTranslations("App");
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/belajar/api/me", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Me>) : { user: null }))
      .then((d) => alive && setMe(d))
      .catch(() => alive && setMe({ user: null }));
    return () => {
      alive = false;
    };
  }, []);

  if (!me) return <span className="block min-h-12" aria-hidden />;

  if (me.user) {
    // A status, not a control: no edge that would make it look clickable.
    return (
      <span className="menu-row border-transparent! bg-paper-deep! text-ink-muted">
        <UserRound aria-hidden className="h-5 w-5 shrink-0 text-forest" />
        <span className="min-w-0 truncate">{t("signed_in_as", { name: me.user.name ?? "—" })}</span>
      </span>
    );
  }

  const here =
    typeof window === "undefined"
      ? `/belajar/${locale}`
      : window.location.pathname + window.location.search;
  // An outlined row, not a filled button: the page's own main action (e.g.
  // "Mulai pelajaran") stays the only filled, primary-looking control.
  return (
    <a href={`/${locale}/login?callbackUrl=${encodeURIComponent(here)}`} className="menu-row">
      <LogIn aria-hidden className="h-5 w-5 shrink-0 text-forest" />
      {t("sign_in")}
    </a>
  );
}
