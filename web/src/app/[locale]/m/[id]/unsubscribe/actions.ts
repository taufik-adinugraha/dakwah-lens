"use server";

import { redirect } from "next/navigation";

import { unsubscribeByToken } from "@/lib/notify-subscribers";

const SLUG_RE =
  /^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])-(all|family|youth|justice|spiritual)$/;

/**
 * Confirm-unsubscribe server action. Triggered by the POST form on
 * the unsubscribe landing page. Validates inputs, mutates the
 * subscriber row, then redirects back to the page with a status
 * flag (?confirmed=1 / ?failed=1) so the page renders the right
 * confirmation state.
 *
 * GET on the page is a preview only — link prefetchers (Gmail
 * link warmer, Outlook safe-link checks) can fetch the URL without
 * touching any subscriber data.
 */
export async function confirmUnsubscribeAction(formData: FormData): Promise<void> {
  const slug = String(formData.get("slug") ?? "");
  const token = String(formData.get("token") ?? "");
  if (!SLUG_RE.test(slug)) {
    redirect(`/m/${encodeURIComponent(slug)}/unsubscribe?failed=1`);
  }
  const result = await unsubscribeByToken(slug, token);
  redirect(
    `/m/${slug}/unsubscribe?${result.ok ? "confirmed=1" : "failed=1"}`,
  );
}
