"use client";

import { Printer } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * Opens the browser's print dialog for the current page. From there the
 * user can pick a real printer or "Save as PDF". We don't bundle a PDF
 * library — the browser already renders Arabic + RTL correctly and the
 * print stylesheet in globals.css hides nav/footer/buttons.
 *
 * Hidden when printing (`print:hidden`) so it doesn't appear on the
 * generated PDF itself.
 */
export function PrintButton({ namespace }: { namespace: "Briefs" | "PublicBriefs" }) {
  const t = useTranslations(namespace);
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 print:hidden"
    >
      <Printer className="h-3.5 w-3.5" />
      {t("print_button")}
    </button>
  );
}
