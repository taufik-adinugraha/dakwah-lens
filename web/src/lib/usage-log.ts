/**
 * Record a paid-API call to `usage_events` so the superadmin cost dashboard
 * can aggregate spend per provider.
 *
 * Mirror of `api/src/api/services/usage.py`. Both write to the same table —
 * the Python side handles ingestion/classification, the TS side handles
 * brief synthesis (Anthropic/Gemini) and Qur'an retrieval embeddings (OpenAI).
 *
 * **Best-effort:** never throw. Telemetry must not break the user's request.
 */

import { db, schema } from "@/db";

/**
 * Public list prices, USD per 1M tokens. Update when providers change pricing
 * — actual bills are the source of truth, this just gets us ~5% accurate
 * for routine ops. Keep in sync with `PRICES` in usage.py.
 */
const PRICES: Record<string, Record<string, number>> = {
  openai: {
    "text-embedding-3-small": 0.02,
    "text-embedding-3-large": 0.13,
  },
  gemini: {
    "gemini-2.5-flash-lite_in": 0.1,
    "gemini-2.5-flash-lite_out": 0.4,
    "gemini-2.5-flash_in": 0.3,
    "gemini-2.5-flash_out": 2.5,
    "gemini-2.5-pro_in": 1.25,
    "gemini-2.5-pro_out": 10.0,
  },
  anthropic: {
    "claude-sonnet-4-5_in": 3.0,
    "claude-sonnet-4-5_out": 15.0,
    "claude-sonnet-4-6_in": 3.0,
    "claude-sonnet-4-6_out": 15.0,
  },
  // Resend transactional email. Free tier: 3,000 emails/month + 100/day.
  // Pro tier: $20/month → 50,000 emails → $0.0004/email amortized.
  // We're well under the free tier so `email.ts` hardcodes cost_usd=0; this
  // rate is documented here for the day someone crosses the cap and wants
  // to flip `email.ts` to use `estimateCost`. Indexed per *email* (units),
  // not per token — handled by the special-case below.
  resend: {
    send_email: 0.0004,
  },
};

export function estimateCost(opts: {
  provider: string;
  model?: string | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  units?: number | null;
}): number {
  if (!opts.model) return 0;
  const table = PRICES[opts.provider];
  if (!table) return 0;
  if (opts.provider === "openai") {
    const rate = table[opts.model];
    if (rate == null || opts.tokensIn == null) return 0;
    return (opts.tokensIn / 1_000_000) * rate;
  }
  // Per-unit providers (Resend = per email). Look up by operation/model key.
  if (opts.provider === "resend") {
    const rate = table[opts.model];
    if (rate == null || opts.units == null) return 0;
    return opts.units * rate;
  }
  const inRate = table[`${opts.model}_in`] ?? 0;
  const outRate = table[`${opts.model}_out`] ?? 0;
  let c = 0;
  if (opts.tokensIn != null) c += (opts.tokensIn / 1_000_000) * inRate;
  if (opts.tokensOut != null) c += (opts.tokensOut / 1_000_000) * outRate;
  return c;
}

export async function recordUsage(opts: {
  provider: string;
  operation: string;
  model?: string | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  units?: number | null;
  costUsd?: number | null;
  meta?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    const cost =
      opts.costUsd != null
        ? opts.costUsd
        : estimateCost({
            provider: opts.provider,
            model: opts.model,
            tokensIn: opts.tokensIn,
            tokensOut: opts.tokensOut,
          });
    await db.insert(schema.usageEvents).values({
      provider: opts.provider,
      model: opts.model ?? null,
      operation: opts.operation,
      tokensIn: opts.tokensIn ?? null,
      tokensOut: opts.tokensOut ?? null,
      units: opts.units ?? null,
      costUsd: cost,
      meta: opts.meta ?? null,
    });
  } catch (err) {
    console.warn("[usage] failed to record event:", err);
  }
}
