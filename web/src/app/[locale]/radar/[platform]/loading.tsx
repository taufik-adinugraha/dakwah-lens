import { PageLoading } from "@/components/Spinner";

/** Per-platform breakdown does several DB aggregates (sentiment, top
 *  stories, daily trend) — easily 1-2s on cold cache. Without this
 *  loading.tsx the user sees the previous /radar page sit idle and
 *  retry-clicks the card. */
export default function Loading() {
  return <PageLoading caption="Loading platform breakdown…" />;
}
