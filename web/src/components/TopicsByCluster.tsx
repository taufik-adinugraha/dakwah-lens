"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookmarkPlus,
  ChevronRight,
  Lock,
  ScrollText,
  Sparkles,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import clsx from "clsx";

import { Link } from "@/i18n/navigation";
import {
  CLUSTER_TONES,
  type DrilldownConfig,
  type Topic,
} from "@/data/drilldowns";

export function TopicsByCluster({ config }: { config: DrilldownConfig }) {
  // next-intl needs the namespace as a literal-typed argument. We pass it via
  // cast because the config carries one of 6 valid namespace strings.
  const t = useTranslations(
    config.namespace as Parameters<typeof useTranslations>[0],
  );
  const [activeId, setActiveId] = useState<string | null>(null);

  const active = activeId ? config.topics.find((x) => x.id === activeId) ?? null : null;

  return (
    <section className="bg-slate-50/60 py-12 sm:py-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            {t("section_topics_title")}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-pretty text-sm leading-relaxed text-slate-600 sm:text-base">
            {t("section_topics_subtitle")}
          </p>
        </div>

        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          {config.clusters.map((cluster) => {
            const tone = CLUSTER_TONES[cluster.tone];
            const clusterTopics = config.topics.filter((x) => x.cluster === cluster.key);
            return (
              <div
                key={cluster.key}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
              >
                <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
                  <div className="flex items-center gap-2">
                    <span className={`inline-block h-2 w-2 rounded-full ${tone.dot}`} />
                    <span className="text-sm font-semibold text-slate-900">
                      {t(`cluster_${cluster.key}_name` as Parameters<typeof t>[0])}
                    </span>
                  </div>
                  <span className="text-xs font-medium text-slate-500">
                    {clusterTopics.length}
                  </span>
                </div>
                <ul>
                  {clusterTopics.map((topic, i) => (
                    <li key={topic.id}>
                      <button
                        type="button"
                        onClick={() => setActiveId(topic.id)}
                        className={clsx(
                          "group grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 px-5 py-3 text-left transition hover:bg-slate-50",
                          i > 0 && "border-t border-slate-100",
                        )}
                      >
                        <span className="text-xs font-semibold tabular-nums text-slate-400">
                          #{i + 1}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-800">
                            {t(`topic_${topic.id}_title` as Parameters<typeof t>[0])}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {t(`topic_${topic.id}_tag` as Parameters<typeof t>[0])}
                            <span className="text-slate-300"> · </span>
                            <span className="tabular-nums text-slate-600">
                              {topic.articles.toLocaleString()} {t("topic_articles")}
                            </span>
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <DeltaPill delta={topic.delta} />
                          <Sparkline points={topic.spark} />
                          <ChevronRight className="h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-700" />
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      {active && (
        <TopicModal topic={active} onClose={() => setActiveId(null)} t={t} />
      )}
    </section>
  );
}

function DeltaPill({ delta }: { delta: number }) {
  const up = delta >= 0;
  return (
    <span
      className={clsx(
        "hidden items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums sm:inline-flex",
        up ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700",
      )}
    >
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {up ? "+" : ""}
      {delta}%
    </span>
  );
}

function Sparkline({
  points,
  width = 56,
  height = 18,
}: {
  points: number[];
  width?: number;
  height?: number;
}) {
  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = Math.max(1, max - min);
  const step = width / (points.length - 1);
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${i * step},${height - ((p - min) / range) * height}`)
    .join(" ");
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="hidden text-emerald-500 sm:block"
    >
      <path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}

function TopicModal({
  topic,
  onClose,
  t,
}: {
  topic: Topic;
  onClose: () => void;
  // Use a permissive type — the t function comes from useTranslations()
  // with a runtime namespace (one of the 6 platform namespaces).
  t: (key: string) => string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const up = topic.delta >= 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="topic-modal-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-6 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
              {t(`topic_${topic.id}_tag`)}
            </p>
            <h3
              id="topic-modal-title"
              className="mt-1 text-balance text-lg font-bold text-slate-900 sm:text-xl"
            >
              {t(`topic_${topic.id}_title`)}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("topic_close")}
            className="rounded-full p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 px-6 py-5 sm:grid-cols-4">
          <Stat
            label={t("topic_volume_label")}
            value={topic.articles.toLocaleString()}
            hint={t("topic_articles")}
          />
          <Stat
            label={t("topic_sentiment_label")}
            value={`${topic.sentiment}%`}
            hint={
              topic.sentiment >= 60 ? "positive" : topic.sentiment >= 45 ? "neutral" : "concerned"
            }
          />
          <Stat
            label={t("topic_delta_label")}
            value={`${up ? "+" : ""}${topic.delta}%`}
            hint={up ? "↑" : "↓"}
            tone={up ? "emerald" : "amber"}
          />
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5">
            <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
              {t("topic_trend_label")}
            </p>
            <div className="mt-1">
              <Sparkline points={topic.spark} width={96} height={26} />
            </div>
          </div>
        </div>

        <div className="px-6 pb-5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            {t("topic_top_outlets")}
          </p>
          <div className="mt-2.5 space-y-2">
            {topic.outlets.map((o) => {
              const max = Math.max(...topic.outlets.map((x) => x.count));
              const pct = (o.count / max) * 100;
              return (
                <div
                  key={o.name}
                  className="grid grid-cols-[120px_1fr_auto] items-center gap-3 sm:grid-cols-[180px_1fr_auto]"
                >
                  <span className="truncate text-sm font-medium text-slate-800">
                    {o.name}
                  </span>
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-brand-500 to-emerald-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs tabular-nums text-slate-500">
                    {o.count.toLocaleString()}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="border-t border-slate-100 bg-gradient-to-br from-slate-50 to-emerald-50/40 px-6 py-5">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-emerald-700" />
            <p className="text-sm font-semibold text-slate-900">
              {t("topic_signin_title")}
            </p>
          </div>
          <p className="mt-1.5 text-pretty text-xs leading-relaxed text-slate-600">
            {t("topic_signin_body")}
          </p>

          <ul className="mt-3 grid grid-cols-1 gap-1.5 text-xs sm:grid-cols-2">
            <Perk icon={ScrollText} label={t("topic_signin_perk_daleel")} />
            <Perk icon={Sparkles} label={t("topic_signin_perk_brief")} />
            <Perk icon={BookmarkPlus} label={t("topic_signin_perk_watchlist")} />
            <Perk icon={Bell} label={t("topic_signin_perk_alerts")} />
          </ul>

          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={onClose}
              className="text-xs font-medium text-slate-500 hover:text-slate-900"
            >
              {t("topic_close")}
            </button>
            <Link
              href="/login"
              className="group inline-flex h-10 items-center justify-center gap-1.5 rounded-full bg-slate-900 px-4 text-sm font-semibold text-white shadow transition hover:bg-slate-800"
            >
              {t("topic_signin_button")}
              <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "emerald" | "amber";
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5">
      <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <p
        className={clsx(
          "mt-1 text-lg font-bold tabular-nums sm:text-xl",
          tone === "emerald"
            ? "text-emerald-700"
            : tone === "amber"
              ? "text-amber-700"
              : "text-slate-900",
        )}
      >
        {value}
      </p>
      <p className="text-[10px] text-slate-500">{hint}</p>
    </div>
  );
}

function Perk({
  icon: Icon,
  label,
}: {
  icon: typeof ArrowUpRight;
  label: string;
}) {
  return (
    <li className="inline-flex items-center gap-1.5 text-slate-700">
      <Icon className="h-3.5 w-3.5 text-emerald-600" />
      {label}
    </li>
  );
}
