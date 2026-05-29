/**
 * Cost estimation + actual-cost computation for brief generation.
 *
 * Pre-generation: heuristic estimate based on form inputs. Doesn't
 * need to be perfectly accurate — it's a budget warning shown in a
 * "are you sure?" confirmation step before the user spends.
 *
 * Post-generation: pricing × the actual token counts the provider
 * returned. Used by the action layer to populate the new
 * `briefs.cost_usd / tokens_in / tokens_out` columns.
 */

/** USD pricing per million tokens. Update when provider rates change. */
const PRICING: Record<
  string,
  { inputPerMillion: number; outputPerMillion: number }
> = {
  // Claude Sonnet 4.5 / 4.6 — same price tier.
  "claude-sonnet-4-5": { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  "claude-sonnet-4-6": { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  // Gemini 2.5 Pro — thinking tokens billed at output rate but we
  // disable thinking for brief generation (no `thinking_config` set),
  // so we only charge raw output here.
  "gemini-2.5-pro": { inputPerMillion: 1.25, outputPerMillion: 10.0 },
};

/** Spot rate USD → IDR for display. Kept in sync with /admin/system
 *  app_settings `usd_to_idr` when that's edited. Static here is fine
 *  for a ±20% cost preview — actual cost is computed at provider rates. */
export const SPOT_USD_TO_IDR = 16_300;

export type CostBreakdown = {
  tokensIn: number;
  tokensOut: number;
  inputUsd: number;
  outputUsd: number;
  totalUsd: number;
  totalIdr: number;
  provider: string;
  model: string;
};

/**
 * Heuristic estimate of input + output tokens given the form inputs.
 *
 * Calibrated against ~30 real briefs from the usage_events log:
 *   - Input median: 3,800 tokens (system + daleel + user prompt)
 *   - Output median: 4,500 tokens for EN, 5,800 for ID (~30% more)
 *
 * `extra_context` text gets counted at ~0.3 tokens per character
 * (English/Indonesian roughly average to that with Claude's tokenizer).
 */
export function estimateBriefTokens(input: {
  topicTitle: string;
  extraContext?: string | null;
  locale: "id" | "en";
  /** Target length 1-4 pages. Default 2. Scales the output-token
   *  estimate so the cost preview tracks the actual generation budget. */
  pages?: number;
}): { tokensIn: number; tokensOut: number } {
  const baseIn = 3500; // system prompt + daleel pool + segment/tone framing
  const extraIn =
    Math.round((input.topicTitle?.length ?? 0) * 0.3) +
    Math.round((input.extraContext?.length ?? 0) * 0.3);
  const tokensIn = baseIn + extraIn;

  // Output tokens scale with the requested page count. Calibrated against
  // historic 4-page briefs: ID ≈ 5800 tokens / EN ≈ 4500 tokens at 4
  // pages. Linear scale keeps the estimate within ±20% across the 1-4
  // range. Floor at 2-page volume so 1-page briefs still reflect the
  // structured-JSON scaffolding cost.
  const pages = Math.max(1, Math.min(4, input.pages ?? 2));
  const perPage = input.locale === "id" ? 1450 : 1125;
  const tokensOut = Math.max(perPage * 2, perPage * pages);

  return { tokensIn, tokensOut };
}

/** Compute USD cost given tokens + provider/model. Returns full
 *  breakdown so the UI can show "$X in + $Y out = $Z total". */
export function computeCost(input: {
  tokensIn: number;
  tokensOut: number;
  provider: string;
  model: string;
}): CostBreakdown {
  const price =
    PRICING[input.model] ?? PRICING["gemini-2.5-pro"]; // safe default

  const inputUsd = (input.tokensIn / 1_000_000) * price.inputPerMillion;
  const outputUsd = (input.tokensOut / 1_000_000) * price.outputPerMillion;
  const totalUsd = inputUsd + outputUsd;

  return {
    tokensIn: input.tokensIn,
    tokensOut: input.tokensOut,
    inputUsd,
    outputUsd,
    totalUsd,
    totalIdr: totalUsd * SPOT_USD_TO_IDR,
    provider: input.provider,
    model: input.model,
  };
}

/** Estimate the cost a brief would incur if generated with the default
 *  provider. Uses Gemini pricing because gemini-2.5-pro is the primary
 *  in our fallback chain (llm.ts tries Gemini first; Anthropic only
 *  fires when GEMINI fails AND ANTHROPIC_API_KEY is set). Anthropic
 *  isn't even configured in prod today, so the estimate would have
 *  been ~6× actual cost if we kept showing Sonnet rates. */
export function estimateBriefCost(input: {
  topicTitle: string;
  extraContext?: string | null;
  locale: "id" | "en";
  pages?: number;
}): CostBreakdown {
  const { tokensIn, tokensOut } = estimateBriefTokens(input);
  return computeCost({
    tokensIn,
    tokensOut,
    provider: "gemini",
    model: "gemini-2.5-pro",
  });
}

/** Format USD with 4 decimal places for sub-cent precision. Briefs cost
 *  pennies — without 4 dp the "$0.0123" would round to "$0.01". */
export function formatUsd(usd: number): string {
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(4)}`;
}

/** Indonesian rupiah format with thousands grouping. */
export function formatIdr(idr: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(idr);
}
