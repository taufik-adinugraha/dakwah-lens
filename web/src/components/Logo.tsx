import clsx from "clsx";

type LogoProps = {
  className?: string;
  showWordmark?: boolean;
  /** Use `"light"` on dark backgrounds (footer). Default `"dark"` for white surfaces. */
  tone?: "light" | "dark";
};

export function Logo({
  className,
  showWordmark = true,
  tone = "dark",
}: LogoProps) {
  return (
    <span className={clsx("inline-flex items-center gap-2", className)}>
      <span
        aria-hidden
        className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-600 via-cyan-500 to-emerald-500 text-white shadow-md shadow-brand-600/20"
      >
        <span className="absolute inset-[3px] rounded-md bg-white/95" />
        <span className="relative h-2.5 w-2.5 rounded-full bg-gradient-to-br from-brand-600 to-emerald-500" />
      </span>
      {showWordmark && (
        <span
          className={clsx(
            "text-base font-semibold tracking-tight",
            tone === "light" ? "text-white" : "text-slate-900",
          )}
        >
          Dakwah
          <span
            className={tone === "light" ? "text-brand-400" : "text-brand-600"}
          >
            -
          </span>
          Lens
        </span>
      )}
    </span>
  );
}
