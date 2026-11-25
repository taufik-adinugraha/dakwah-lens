import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";

import type { BriefingNumbers, Sentiment } from "@/lib/briefing-numbers";

/**
 * The "Numerik & Tren Pekan Ini" section as an infographic (owner
 * 2026-11-25): headline tiles, sentiment as 100% bars (overall + per
 * platform), and the biggest topics as bars. Drawn from headline_stats
 * (lib/briefing-numbers), so it matches the prose it replaces.
 *
 * Colours: sentiment is diverging (negative orange · neutral grey ·
 * positive blue), checked with the dataviz palette validator against
 * white (CVD ΔE 24.7, contrast ≥ 3:1). Red/green failed (ΔE 5.1).
 * Labels and values stay in ink; every segment carries its own label or
 * a hover title, so identity is never colour alone. Topic bars are one
 * series in the brand green.
 */

export type NumbersLabels = {
  posts: string;
  postsUnit: string;
  fromPrev: string; // "dari {n} pekan lalu"
  negativeShare: string;
  vsBaseline: string; // "{pp} poin dari garis dasar {base}"
  biggestTopic: string;
  sentimentTitle: string;
  all: string;
  negative: string;
  neutral: string;
  positive: string;
  topicsTitle: string;
  platformNames: Record<string, string>;
};

const SENT = {
  negative: "#e0612f",
  neutral: "#dcd9cf",
  positive: "#2a78d6",
} as const;

function fmt(n: number, locale: string, digits = 0) {
  return new Intl.NumberFormat(locale === "en" ? "en-US" : "id-ID", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
    .format(n)
    .replace(/^-/, "\u2212"); // a true minus sign, not a hyphen
}

function Delta({ value, children }: { value: number | null; children: React.ReactNode }) {
  const Icon =
    value === null || Math.abs(value) < 0.05
      ? ArrowRight
      : value < 0
        ? ArrowDownRight
        : ArrowUpRight;
  return (
    <p className="mt-1 flex items-center gap-1 text-xs leading-snug text-slate-500">
      <Icon className="h-3.5 w-3.5 shrink-0 text-slate-700" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

function SentimentBar({
  s,
  label,
  sub,
  labels,
  locale,
}: {
  s: Sentiment;
  label: string;
  sub?: string;
  labels: NumbersLabels;
  locale: string;
}) {
  const parts = [
    { key: "negative" as const, v: s.negative, name: labels.negative },
    { key: "neutral" as const, v: s.neutral, name: labels.neutral },
    { key: "positive" as const, v: s.positive, name: labels.positive },
  ];
  const total = s.negative + s.neutral + s.positive;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium text-slate-800">{label}</span>
        {sub && <span className="text-xs tabular-nums text-slate-500">{sub}</span>}
      </div>
      <div className="mt-1.5 flex h-7 w-full gap-[2px] overflow-hidden rounded-md">
        {parts.map((p) =>
          p.v > 0 ? (
            <div
              key={p.key}
              title={`${p.name}: ${fmt(p.v, locale, 1)}%`}
              className="flex h-full items-center justify-center first:rounded-l-md last:rounded-r-md"
              style={{ width: `${(p.v / total) * 100}%`, background: SENT[p.key] }}
            >
              {p.v >= 9 && (
                <span
                  className={`text-[11px] font-semibold tabular-nums ${
                    p.key === "neutral" ? "text-slate-800" : "text-white"
                  }`}
                >
                  {fmt(p.v, locale, 1)}%
                </span>
              )}
            </div>
          ) : null,
        )}
      </div>
    </div>
  );
}

export function BriefNumbersInfographic({
  data,
  labels,
  locale,
}: {
  data: BriefingNumbers;
  labels: NumbersLabels;
  locale: string;
}) {
  const top = data.topics[0];
  const maxTopic = top?.posts ?? 1;
  const platformName = (k: string) => labels.platformNames[k] ?? k;

  return (
    <div className="mt-4 space-y-6">
      {/* Headline tiles */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            {labels.posts}
          </p>
          <p className="mt-1 text-3xl font-bold tabular-nums tracking-tight text-slate-900">
            {fmt(data.posts, locale)}
            <span className="ml-1.5 text-sm font-medium text-slate-500">{labels.postsUnit}</span>
          </p>
          {data.deltaPct !== null && data.prevPosts !== null && (
            <Delta value={data.deltaPct}>
              <strong className="font-semibold tabular-nums text-slate-800">
                {data.deltaPct > 0 ? "+" : ""}
                {fmt(data.deltaPct, locale, 1)}%
              </strong>{" "}
              {labels.fromPrev.replace("{n}", fmt(data.prevPosts, locale))}
            </Delta>
          )}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            {labels.negativeShare}
          </p>
          <p className="mt-1 text-3xl font-bold tabular-nums tracking-tight text-slate-900">
            {fmt(data.sentiment.negative, locale, 1)}%
          </p>
          {data.deltaPpNegative !== null && data.baselineNegative !== null && (
            <Delta value={data.deltaPpNegative}>
              <strong className="font-semibold tabular-nums text-slate-800">
                {data.deltaPpNegative > 0 ? "+" : ""}
                {fmt(data.deltaPpNegative, locale, 1)}
              </strong>{" "}
              {labels.vsBaseline.replace("{base}", `${fmt(data.baselineNegative, locale, 1)}%`)}
            </Delta>
          )}
        </div>
        {top && (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              {labels.biggestTopic}
            </p>
            <p className="mt-1 text-balance text-lg font-bold leading-snug text-slate-900">
              {top.label}
            </p>
            <p className="mt-1 text-xs tabular-nums text-slate-500">
              <strong className="font-semibold text-slate-800">{fmt(top.posts, locale)}</strong>{" "}
              {labels.postsUnit}
            </p>
          </div>
        )}
      </div>

      {/* Sentiment, overall and per platform */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h3 className="text-sm font-semibold text-slate-900">{labels.sentimentTitle}</h3>
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
            {(["negative", "neutral", "positive"] as const).map((k) => (
              <li key={k} className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SENT[k] }} aria-hidden />
                {labels[k]}
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-4 space-y-4">
          <SentimentBar
            s={data.sentiment}
            label={labels.all}
            sub={`${fmt(data.posts, locale)} ${labels.postsUnit}`}
            labels={labels}
            locale={locale}
          />
          {data.platforms.map((p) =>
            p.sentiment ? (
              <SentimentBar
                key={p.key}
                s={p.sentiment}
                label={platformName(p.key)}
                sub={`${fmt(p.posts, locale)} ${labels.postsUnit}`}
                labels={labels}
                locale={locale}
              />
            ) : null,
          )}
        </div>
      </div>

      {/* Biggest topics */}
      {data.topics.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
          <h3 className="text-sm font-semibold text-slate-900">{labels.topicsTitle}</h3>
          <ol className="mt-4 space-y-4">
            {data.topics.map((t) => (
              <li key={t.label}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-medium text-slate-800">{t.label}</span>
                  <span className="shrink-0 font-semibold tabular-nums text-slate-900">
                    {fmt(t.posts, locale)}
                  </span>
                </div>
                <div className="mt-1.5 h-2.5 w-full rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-forest"
                    style={{ width: `${Math.max(2, (t.posts / maxTopic) * 100)}%` }}
                    title={`${t.label}: ${fmt(t.posts, locale)} ${labels.postsUnit}`}
                  />
                </div>
                {t.headlines[0] && (
                  <p className="mt-1.5 line-clamp-2 text-xs leading-snug text-slate-500">
                    “{t.headlines[0]}”
                  </p>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
