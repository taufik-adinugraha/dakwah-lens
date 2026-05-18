import { PageLoading } from "@/components/Spinner";

/**
 * Default loading state — shown by Next.js App Router whenever a route
 * segment under `[locale]` is being server-rendered and hasn't finished
 * within a few hundred milliseconds. Scoped subdirectories can override
 * with their own `loading.tsx`.
 */
export default function Loading() {
  return <PageLoading />;
}
