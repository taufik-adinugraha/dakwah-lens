import { CheckCircle2, XCircle } from "lucide-react";
import { setRequestLocale } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { confirmUnsubscribeAction } from "./actions";
import { peekUnsubscribeToken } from "@/lib/notify-subscribers";

/**
 * Public unsubscribe landing page reached from email links of the
 * shape `/m/{slug}/unsubscribe?token=xxx`.
 *
 * Two-step flow (defends against email-client link prefetch):
 *   - GET  → previews the email + a "Confirm unsubscribe" button.
 *            Does NOT mutate. Gmail / Outlook link warmers that
 *            silently fetch the link won't accidentally unsubscribe.
 *   - POST → the form's server action actually unsubscribes, then
 *            redirects back here with `?confirmed=1` for the success
 *            view.
 *
 * No auth, no JS required. We never leak whether the token was
 * valid in error states — same "not recognized" copy either way.
 */
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string; locale: string }>;
  searchParams: Promise<{ token?: string; confirmed?: string; failed?: string }>;
};

export default async function UnsubscribePage({
  params,
  searchParams,
}: Props) {
  const { id, locale } = await params;
  const { token, confirmed, failed } = await searchParams;
  setRequestLocale(locale);

  // Read-only peek — does the token resolve to a real subscriber?
  // We use this to choose between three rendered states.
  const known = token ? await peekUnsubscribeToken(id, token) : null;

  // POST -> action -> redirect back with one of these flags.
  if (confirmed === "1") return <SuccessCard slug={id} />;
  if (failed === "1") return <UnknownCard slug={id} />;

  // GET landing: render the confirmation form (or "unknown link"
  // if the token doesn't resolve).
  if (!known) return <UnknownCard slug={id} />;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-10">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white px-7 py-10 text-center shadow-sm">
        <h1 className="text-balance text-xl font-bold text-slate-900">
          Berhenti berlangganan email diskusi?
        </h1>
        <p className="mt-2 text-pretty text-sm leading-relaxed text-slate-600">
          Kamu tidak akan menerima email lagi dari ruang diskusi ini.
          Konfirmasi di bawah untuk berhenti.
        </p>
        <form action={confirmUnsubscribeAction} className="mt-6 space-y-3">
          <input type="hidden" name="slug" value={id} />
          <input type="hidden" name="token" value={token ?? ""} />
          <button
            type="submit"
            className="inline-flex h-10 w-full items-center justify-center rounded-full bg-rose-700 px-4 text-xs font-bold text-white shadow-sm hover:bg-rose-800"
          >
            Ya, berhenti berlangganan
          </button>
          <Link
            href={`/m/${id}`}
            className="inline-flex h-9 w-full items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-[11.5px] font-semibold text-slate-700 hover:bg-slate-50"
          >
            Batal · buka diskusi
          </Link>
        </form>
      </div>
    </main>
  );
}

function SuccessCard({ slug }: { slug: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-10">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white px-7 py-10 text-center shadow-sm">
        <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
        <h1 className="mt-4 text-balance text-xl font-bold text-slate-900">
          Berhenti berlangganan berhasil
        </h1>
        <p className="mt-2 text-pretty text-sm leading-relaxed text-slate-600">
          Kamu tidak akan menerima email lagi dari ruang diskusi ini.
          Mau berlangganan lagi nanti? Cukup centang &ldquo;Kabari
          saya&rdquo; saat post komentar berikutnya.
        </p>
        <div className="mt-6">
          <Link
            href={`/m/${slug}`}
            className="inline-flex h-9 items-center rounded-full bg-slate-900 px-4 text-xs font-semibold text-white shadow-sm hover:bg-slate-700"
          >
            Buka ruang diskusi
          </Link>
        </div>
      </div>
    </main>
  );
}

function UnknownCard({ slug }: { slug: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-10">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white px-7 py-10 text-center shadow-sm">
        <XCircle className="mx-auto h-10 w-10 text-slate-400" />
        <h1 className="mt-4 text-balance text-xl font-bold text-slate-900">
          Link tidak dikenali
        </h1>
        <p className="mt-2 text-pretty text-sm leading-relaxed text-slate-600">
          Link unsubscribe mungkin sudah pernah dipakai atau salah
          format. Kalau kamu masih menerima email yang tak diinginkan,
          hubungi kami via{" "}
          <Link href="/contact" className="font-semibold text-emerald-700 hover:underline">
            /contact
          </Link>
          .
        </p>
        <div className="mt-6">
          <Link
            href={`/m/${slug}`}
            className="inline-flex h-9 items-center rounded-full bg-slate-900 px-4 text-xs font-semibold text-white shadow-sm hover:bg-slate-700"
          >
            Buka ruang diskusi
          </Link>
        </div>
      </div>
    </main>
  );
}
