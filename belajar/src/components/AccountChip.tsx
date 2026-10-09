"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type Me = { user: { name: string | null } | null };

/**
 * Who is signed in, fetched client-side from /belajar/api/me so that lesson
 * pages stay statically prerendered (reading cookies server-side would make
 * every page dynamic). Anonymous learning is first-class: this chip only
 * offers a sign-in link, it never gates content.
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

  if (!me) return <span className="inline-block h-11 w-20" aria-hidden />;

  if (me.user) {
    return (
      <span className="inline-flex min-h-11 max-w-64 items-center rounded-full border border-hairline bg-white px-4 text-sm text-ink-muted">
        <span className="min-w-0 truncate">
          {t("signed_in_as", { name: me.user.name ?? "—" })}
        </span>
      </span>
    );
  }

  const here =
    typeof window === "undefined"
      ? `/belajar/${locale}`
      : window.location.pathname + window.location.search;
  // An outlined chip, not a filled button: the page's own main action (e.g.
  // "Mulai pelajaran") stays the only filled, primary-looking control.
  return (
    <a
      href={`/${locale}/login?callbackUrl=${encodeURIComponent(here)}`}
      className="chip-link"
    >
      {t("sign_in")}
    </a>
  );
}
