/**
 * LLM provider abstraction with a deterministic fallback chain.
 *
 * Per the agreed policy (config B — cost-optimized):
 *   1. Try Gemini 2.5 Pro — top-tier reasoning at ~35% lower cost than Sonnet.
 *   2. If Gemini is unavailable (missing key or API error), try Anthropic.
 *   3. If both fail, throw `LlmUnavailableError` — never silently return a stub.
 *
 * Both models are in the same quality bracket; Gemini just happens to be
 * cheaper. Sonnet stays as the diversification fallback so a Google outage
 * doesn't take the product down.
 *
 * Pricing (per brief: ~1K in + ~1.5K out):
 *   - Gemini 2.5 Pro             : $1.25/MT in · $10/MT out → ~$0.016/brief
 *   - Anthropic Claude Sonnet 4.5: $3/MT in · $15/MT out  → ~$0.025/brief
 *
 * Callers should `try/catch` `LlmUnavailableError` and surface a user-facing
 * error (the brief generator does this and returns `error_llm_unavailable`).
 */

import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI, Type } from "@google/genai";

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
 * Anthropic (via tool-use) and Gemini (via responseSchema) accept.
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

const ANTHROPIC_MODEL = "claude-sonnet-4-5";
// Gemini fallback uses the Pro tier to match Anthropic Sonnet's reasoning
// quality. ~$0.016 per brief vs ~$0.025 for Sonnet — comparable bracket.
// Don't drop to Flash here: brief synthesis is exactly the kind of nuanced
// task where the smaller model's quality gap is visible to the da'i reader.
const GEMINI_MODEL = "gemini-2.5-pro";

/**
 * Try Anthropic first, fall back to Gemini, throw `LlmUnavailableError` if both
 * are unavailable. Returns parsed JSON object plus provenance.
 */
export async function generateJson<T = unknown>(
  req: LlmRequest,
): Promise<LlmResult<T>> {
  const errors: string[] = [];

  // 1. Gemini Pro — cost-optimized primary (~35% cheaper than Sonnet).
  if (process.env.GEMINI_API_KEY) {
    try {
      const { data, tokensIn, tokensOut } = await callGemini<T>(req);
      return {
        data,
        provider: "gemini",
        model: GEMINI_MODEL,
        tokensIn,
        tokensOut,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[llm] Gemini failed: ${msg}`);
      errors.push(`gemini: ${msg}`);
    }
  }

  // 2. Anthropic Sonnet — diversification fallback. Different cloud, similar
  //    quality bracket. Activates when Gemini is missing or errors out.
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const { data, tokensIn, tokensOut } = await callAnthropic<T>(req);
      return {
        data,
        provider: "anthropic",
        model: ANTHROPIC_MODEL,
        tokensIn,
        tokensOut,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[llm] Anthropic failed: ${msg}`);
      errors.push(`anthropic: ${msg}`);
    }
  }

  throw new LlmUnavailableError(
    errors.length === 0
      ? "Neither GEMINI_API_KEY nor ANTHROPIC_API_KEY is set."
      : `All providers failed. ${errors.join(" | ")}`,
  );
}

/* ────────────────────────────────────────────────────────────
 * Anthropic — tool-use trick for guaranteed JSON
 * ────────────────────────────────────────────────────────────
 * The cleanest way to get strict JSON out of Claude is to define a tool
 * whose `input_schema` matches what we want, then force the model to call
 * that tool. Claude returns the tool's `input` as the structured output.
 */

let _anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!_anthropic) {
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _anthropic;
}

async function callAnthropic<T>(
  req: LlmRequest,
): Promise<{ data: T; tokensIn: number | null; tokensOut: number | null }> {
  const client = getAnthropic();
  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: req.maxTokens ?? 2000,
    temperature: req.temperature ?? 0.6,
    system: req.systemPrompt,
    tools: [
      {
        name: "emit_brief",
        description:
          "Emit the structured da'wah brief. You MUST call this tool exactly once.",
        input_schema: req.responseSchema as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: "tool", name: "emit_brief" },
    messages: [{ role: "user", content: req.userPrompt }],
  });

  const tokensIn = response.usage?.input_tokens ?? null;
  const tokensOut = response.usage?.output_tokens ?? null;

  void recordUsage({
    provider: "anthropic",
    operation: "synth_brief",
    model: ANTHROPIC_MODEL,
    tokensIn,
    tokensOut,
  });

  // First tool_use block IS the structured output.
  for (const block of response.content) {
    if (block.type === "tool_use" && block.name === "emit_brief") {
      return { data: block.input as T, tokensIn, tokensOut };
    }
  }
  throw new Error("Anthropic response did not contain a tool_use block.");
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
