/**
 * Canonical list of metered API providers that a `manual_costs` row can
 * declare it "covers". Kept in sync with `usage_events.provider` values
 * — when usage shows up in `usage_events`, its `provider` string must
 * be one of these for the subscription-deduplication logic to fire.
 *
 * Order chosen for the admin dropdown: most-likely subscription first.
 */
export const KNOWN_PROVIDERS = [
  "apify",
  "openai",
  "anthropic",
  "gemini",
  "youtube",
  "resend",
] as const;

export type KnownProvider = (typeof KNOWN_PROVIDERS)[number];

export function isKnownProvider(value: string): value is KnownProvider {
  return (KNOWN_PROVIDERS as readonly string[]).includes(value);
}

/** Pretty label for UI use. Falls back to the raw value (e.g. "rss")
 *  if it isn't in the known list. Labels include the typical
 *  subscription tier where the admin is most likely to select this
 *  provider for a manual-cost entry — so the dropdown is unambiguous
 *  about what monthly fee they're recording. */
const PROVIDER_LABELS: Record<KnownProvider, string> = {
  apify: "Apify Starter ($29/mo)",
  openai: "OpenAI (pay-as-you-go)",
  anthropic: "Anthropic / Claude (pay-as-you-go)",
  gemini: "Gemini (pay-as-you-go)",
  youtube: "YouTube Data API (free tier)",
  resend: "Resend (free tier / $20 Pro)",
};

export function providerLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return isKnownProvider(value) ? PROVIDER_LABELS[value] : value;
}
