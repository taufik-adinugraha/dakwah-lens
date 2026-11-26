/**
 * LLM provider abstraction with a deterministic fallback chain, for
 * synthesis-grade work (on-demand kajian, deliverables).
 *
 *   1. Claude Sonnet 5.5 (since 2026-11-26; lib/claude.ts) — structured outputs.
 *   2. Gemini 2.5 Pro — fallback; its prepaid credit ran out ~2026-07-27.
 *   3. If both fail, throw `LlmUnavailableError` — never silently return a stub.
 *
 * Cost per kajian (~3.7K in + ~2.8K out, measured on Gemini's 18 runs):
 *   - Claude Sonnet 5.5: $2/MT in · $10/MT out → ~$0.035 plus thinking
 *   - Gemini 2.5 Pro   : $1.25/MT in · $10/MT out → ~$0.03
 *
 * Callers should `try/catch` `LlmUnavailableError` and surface a user-facing
 * error (the brief generator does this and returns `error_llm_unavailable`).
 */

import { GoogleGenAI, Type } from "@google/genai";

import { CLAUDE_WRITER_MODEL, callClaudeJson, claudeConfigured } from "@/lib/claude";
import { recordUsage } from "@/lib/usage-log";

export class LlmUnavailableError extends Error {
  constructor(message = "No LLM provider is configured or all providers failed.") {
    super(message);
    this.name = "LlmUnavailableError";
  }
}

export type LlmProvider = "anthropic" | "gemini";

export type LlmResult<T> = {
  /** Parsed JSON output from the LLM. */
  data: T;
  /** Which provider actually produced the response. */
  provider: LlmProvider;
  /** Model name reported by the provider. */
  model: string;
  /** Token counts reported by the provider — null when the SDK didn't
   *  surface them (rare; usually a quirk of streaming responses). */
  tokensIn: number | null;
  tokensOut: number | null;
};

/**
 * JSON Schema describing the expected response shape, in a format that both
 * Anthropic (structured outputs, made strict by `strictSchema` in lib/claude.ts) and
 * Gemini (via responseSchema) accept.
 *
 * Keep this in sync with the consumer's Zod/TS type. Loose `string` everywhere
 * because Gemini's structured-output is strict and we want to validate via
 * Zod after the fact.
 */
export type JsonSchema = Record<string, unknown>;

export type LlmRequest = {
  systemPrompt: string;
  userPrompt: string;
  /** Top-level JSON Schema describing the expected response object. */
  responseSchema: JsonSchema;
  /** Generation cap — keep modest; brief content is bounded. */
  maxTokens?: number;
  /** Sampling temperature. */
  temperature?: number;
};

// Claude Sonnet 5.5 is the primary since 2026-11-26 (lib/claude.ts): Gemini's prepaid credit
// ran out around 2026-07-27, and no Anthropic key was set, so no kajian could be generated.
// Gemini 2.5 Pro stays as the fallback for the day its credit is topped up.
const ANTHROPIC_MODEL = CLAUDE_WRITER_MODEL;
const GEMINI_MODEL = "gemini-2.5-pro";

/** Room for Sonnet 5.5's adaptive thinking on top of the caller's output cap. */
const THINKING_ROOM = 8_000;

/**
 * Try Anthropic first, fall back to Gemini, throw `LlmUnavailableError` if both
 * are unavailable. Returns parsed JSON object plus provenance.
 */
export async function generateJson<T = unknown>(
  req: LlmRequest,
): Promise<LlmResult<T>> {
  const errors: string[] = [];

  // 1. Claude Sonnet 5.5 — structured outputs (forced tool_choice and a custom temperature
  //    both return 400 on this model, so `req.temperature` is not sent).
  if (claudeConfigured()) {
    try {
      const { data, tokensIn, tokensOut } = await callClaudeJson<T>({
        operation: "synth_brief",
        model: ANTHROPIC_MODEL,
        system: req.systemPrompt,
        prompt: req.userPrompt,
        schema: req.responseSchema,
        maxTokens: (req.maxTokens ?? 2000) + THINKING_ROOM,
        effort: "medium",
        timeoutMs: 10 * 60_000,
      });
      return { data, provider: "anthropic", model: ANTHROPIC_MODEL, tokensIn, tokensOut };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[llm] Anthropic failed: ${msg}`);
      errors.push(`anthropic: ${msg}`);
    }
  }

  // 2. Gemini 2.5 Pro — fallback; only useful once its credit is topped up.
  if (process.env.GEMINI_API_KEY) {
    try {
      const { data, tokensIn, tokensOut } = await callGemini<T>(req);
      return { data, provider: "gemini", model: GEMINI_MODEL, tokensIn, tokensOut };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[llm] Gemini failed: ${msg}`);
      errors.push(`gemini: ${msg}`);
    }
  }

  throw new LlmUnavailableError(
    errors.length === 0
      ? "Neither ANTHROPIC_API_KEY nor GEMINI_API_KEY is set."
      : `All providers failed. ${errors.join(" | ")}`,
  );
}

/* ────────────────────────────────────────────────────────────
 * Gemini — responseMimeType=json + responseSchema
 * ────────────────────────────────────────────────────────────
 * `@google/genai` (the new unified SDK) supports both inline-JSON-schema
 * strings and a `Type.*` schema builder. We pass the same JSON Schema we
 * gave Anthropic (the new SDK accepts standard JSON Schema directly).
 */

let _gemini: GoogleGenAI | null = null;
function getGemini(): GoogleGenAI {
  if (!_gemini) {
    _gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return _gemini;
}

async function callGemini<T>(
  req: LlmRequest,
): Promise<{ data: T; tokensIn: number | null; tokensOut: number | null }> {
  const client = getGemini();
  const response = await client.models.generateContent({
    model: GEMINI_MODEL,
    config: {
      systemInstruction: req.systemPrompt,
      responseMimeType: "application/json",
      responseSchema: req.responseSchema,
      temperature: req.temperature ?? 0.6,
      maxOutputTokens: req.maxTokens ?? 2000,
    },
    contents: req.userPrompt,
  });

  const text = response.text;
  if (!text) throw new Error("Gemini returned empty response.");

  const tokensIn = response.usageMetadata?.promptTokenCount ?? null;
  const tokensOut = response.usageMetadata?.candidatesTokenCount ?? null;
  // gemini-2.5-pro is a reasoning model — thinking spend lands in
  // `thoughtsTokenCount`. Surface it in logs alongside finish_reason
  // so the next time output truncates mid-string we can tell at a
  // glance whether the cap was too low or the model ran into safety
  // / length limits.
  const finishReason =
    response.candidates?.[0]?.finishReason ?? "unknown";
  const thoughtsTokens =
    (response.usageMetadata as { thoughtsTokenCount?: number } | undefined)
      ?.thoughtsTokenCount ?? null;
  console.info(
    `[llm] gemini done · finish=${finishReason} · tokens in/out/thinking=${tokensIn}/${tokensOut}/${thoughtsTokens} · cap=${req.maxTokens ?? 2000}`,
  );

  void recordUsage({
    provider: "gemini",
    operation: "synth_brief",
    model: GEMINI_MODEL,
    tokensIn,
    tokensOut,
  });

  try {
    return { data: JSON.parse(text) as T, tokensIn, tokensOut };
  } catch (err) {
    throw new Error(
      `Gemini returned invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// Re-export Gemini's Type enum so callers can build schemas symmetrically if
// they prefer the typed-builder pattern over raw JSON Schema.
export { Type };
