import { Loader2 } from "lucide-react";
import clsx from "clsx";

/**
 * Loading indicator used across the app — in form buttons, in page-level
 * loading.tsx files, anywhere a transient wait needs to be acknowledged.
 *
 * Why Loader2 (spinning circle) rather than a custom SVG: it ships with
 * lucide-react which we already use everywhere, matches the visual
 * weight of every other icon in the app, and gets free `animate-spin`
 * support from Tailwind.
 */
export function Spinner({
  size = "md",
  tone = "current",
  className,
  label,
}: {
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  /** Color. `current` inherits from parent text color (the right default for
   *  spinners-inside-buttons). Override for standalone spinners. */
  tone?: "current" | "slate" | "brand" | "white" | "emerald";
  className?: string;
  /** When set, screen readers announce this; sighted users see a tooltip. */
  label?: string;
}) {
  return (
    <Loader2
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "status" : undefined}
      className={clsx(
        "animate-spin",
        SIZE[size],
        TONE[tone],
        className,
      )}
    />
  );
}

const SIZE = {
  xs: "h-3 w-3",
  sm: "h-3.5 w-3.5",
  md: "h-4 w-4",
  lg: "h-5 w-5",
  xl: "h-8 w-8",
} as const;

const TONE = {
  current: "",
  slate: "text-ink-faint",
  brand: "text-brand-600",
  white: "text-white",
  emerald: "text-forest",
} as const;

/**
 * Full-page loading splash used by `loading.tsx` files. Centered spinner +
 * optional caption. Sits at the same vertical center the eventual content
 * will, so the visual jump on swap is minimal.
 */
export function PageLoading({ caption }: { caption?: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <Spinner size="xl" tone="brand" label="Loading" />
      {caption && (
        <p className="text-sm text-ink-faint" aria-live="polite">
          {caption}
        </p>
      )}
    </div>
  );
}
