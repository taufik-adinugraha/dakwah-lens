import { PageLoading } from "@/components/Spinner";

/** Group landing aggregates topics + sentiment + recent posts; can hit
 *  ~1s on cold cache. */
export default function Loading() {
  return <PageLoading caption="Loading group…" />;
}
