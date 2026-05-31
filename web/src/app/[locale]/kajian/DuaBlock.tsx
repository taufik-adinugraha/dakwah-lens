type Dua = {
  arabic: string;
  translation: string;
  source?: string;
};

export function DuaBlock({ dua, label }: { dua: Dua; label: string }) {
  return (
    <section className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-6">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-emerald-800">
        {label}
      </h2>
      <p
        dir="rtl"
        lang="ar"
        className="mt-3 text-2xl leading-loose text-slate-900"
        style={{ fontFamily: '"Scheherazade New", "Amiri", serif' }}
      >
        {dua.arabic}
      </p>
      <p className="mt-3 text-sm italic leading-relaxed text-slate-700">
        {dua.translation}
      </p>
      {dua.source && (
        <p className="mt-2 text-xs text-slate-500">— {dua.source}</p>
      )}
    </section>
  );
}
