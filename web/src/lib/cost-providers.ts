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
 *  if it isn't in the known list. */
const PROVIDER_LABELS: Record<KnownProvider, string> = {
  apify: "Apify",
  openai: "OpenAI",
  anthropic: "Anthropic (Claude)",
  gemini: "Gemini",
  youtube: "YouTube Data API",
  resend: "Resend",
};

export function providerLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return isKnownProvider(value) ? PROVIDER_LABELS[value] : value;
}
