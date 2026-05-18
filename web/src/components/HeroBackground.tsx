export function HeroBackground() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
    >
      <div className="absolute inset-0 grid-bg opacity-70" />
      <div className="absolute -top-24 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-gradient-to-br from-brand-200 via-cyan-200 to-emerald-200 opacity-60 blur-3xl animate-blob-slow" />
      <div className="absolute -top-10 right-[-120px] h-[360px] w-[360px] rounded-full bg-emerald-200 opacity-50 blur-3xl animate-blob" />
      <div className="absolute top-32 left-[-120px] h-[300px] w-[300px] rounded-full bg-brand-300 opacity-45 blur-3xl animate-blob" />
    </div>
  );
}
