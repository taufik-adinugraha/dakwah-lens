/**
 * Claude for the web app's model calls (2026-11-26).
 *
 * Gemini's prepaid credit ran out around 2026-07-27 (last trending_filter row in usage_events),
 * so every Gemini call since has failed into its fallback: cosine order instead of rerank, the
 * raw query instead of the expanded one, regex-only moderation, and no on-demand kajian or
 * Flyer Builder text at all. The owner chose to move these jobs to Claude on a key of the web's
 * own (`ANTHROPIC_API_KEY`), never the nightly labelling key, so web traffic cannot drain it.
 *
 * - Small jobs (rerank, query expansion, moderation): Claude Haiku 5.5, low effort, thinking off
 *   (they sit in a search or form round-trip).
 * - Writing (kajian, deliverables, Flyer Builder copy): Claude Sonnet 5.5.
 *
 * Both models reject forced `tool_choice` and a non-default `temperature`, so JSON comes from
 * structured outputs (`output_config.format`) and no temperature is sent.
 */
import Anthropic from "@anthropic-ai/sdk";

import { recordUsage } from "@/lib/usage-log";

export const CLAUDE_SMALL_MODEL = "claude-haiku-5-5";
export const CLAUDE_WRITER_MODEL = "claude-sonnet-5-5";

/** Thrown when the key is missing, so callers can say "not configured" instead of "failed". */
export class ClaudeUnavailableError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY is not configured.");
    this.name = "ClaudeUnavailableError";
  }
}

export function claudeConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new ClaudeUnavailableError();
  // One retry: these calls sit in a request a person is waiting on.
  return (_client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1 }));
}

type Schema = Record<string, unknown>;

/** Keywords structured outputs do not accept. Callers validate the result themselves (Zod or
 *  hand checks), so dropping them loses nothing. */
const UNSUPPORTED = new Set([
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "uniqueItems",
  "pattern",
]);

/** A copy of `schema` that structured outputs accept: every object gets
 *  `additionalProperties: false`, unsupported constraints are removed. */
export function strictSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(strictSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out: Schema = {};
  for (const [k, v] of Object.entries(schema as Schema)) {
    if (UNSUPPORTED.has(k)) continue;
    if (k === "properties" && v && typeof v === "object") {
      out[k] = Object.fromEntries(
        Object.entries(v as Schema).map(([name, sub]) => [name, strictSchema(sub)]),
      );
    } else {
      out[k] = strictSchema(v);
    }
  }
  if (out.type === "object") out.additionalProperties = false;
  return out;
}

export type ClaudeCall = {
  /** usage_events.operation, e.g. "daleel_rerank". */
  operation: string;
  model: string;
  system?: string;
  prompt: string;
  maxTokens: number;
  /** When given, the reply is JSON matching it (structured outputs). */
  schema?: Schema;
  /** Small jobs pass "low"; omitted means the model's default. */
  effort?: "low" | "medium" | "high";
  /** Small jobs turn thinking off (allowed on Haiku 5.5 at effort high or below). */
  noThinking?: boolean;
  /** Per-request timeout. */
  timeoutMs?: number;
};

export type ClaudeResult = { text: string; tokensIn: number | null; tokensOut: number | null };

/** One call. Throws on a missing key, an API error, a refusal or a cut-off reply; every caller
 *  keeps its own fallback for that. Usage is recorded either way the call returns. */
export async function callClaude(call: ClaudeCall): Promise<ClaudeResult> {
  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: call.model,
    max_tokens: call.maxTokens,
    ...(call.system ? { system: call.system } : {}),
    messages: [{ role: "user", content: call.prompt }],
  };
  const output: Anthropic.OutputConfig = {};
  if (call.effort) output.effort = call.effort;
  if (call.schema) output.format = { type: "json_schema", schema: strictSchema(call.schema) as Schema };
  if (Object.keys(output).length > 0) params.output_config = output;
  if (call.noThinking) params.thinking = { type: "disabled" };

  const opts = call.timeoutMs ? { timeout: call.timeoutMs } : undefined;
  // Sonnet 5.5: a declined request is re-run server-side on a model chosen by the refusal's
  // category (`fallbacks: "default"`), so a kajian is not lost to an over-cautious decline.
  // Haiku 5.5 has no server-side fallback. SDK 0.96 does not type `fallbacks` yet.
  // Above ~16k max_tokens the SDK refuses a non-streaming request (it could outlast its
  // timeout), so long writer calls stream and wait for the final message.
  const stream = call.maxTokens > 16_000;
  let response: Anthropic.Message;
  if (call.model === CLAUDE_WRITER_MODEL) {
    const body = {
      ...(params as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming),
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    } as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming;
    response = (
      stream
        ? await client().beta.messages.stream(body, opts).finalMessage()
        : await client().beta.messages.create(body, opts)
    ) as unknown as Anthropic.Message;
  } else {
    response = stream
      ? await client().messages.stream(params, opts).finalMessage()
      : await client().messages.create(params, opts);
  }

  const tokensIn = response.usage?.input_tokens ?? null;
  const tokensOut = response.usage?.output_tokens ?? null;
  void recordUsage({
    provider: "anthropic",
    operation: call.operation,
    model: call.model,
    tokensIn,
    tokensOut,
  });

  if (response.stop_reason === "refusal") throw new Error(`${call.operation}: Claude declined the request.`);
  if (response.stop_reason === "max_tokens") throw new Error(`${call.operation}: reply cut off at ${call.maxTokens} tokens.`);

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  return { text, tokensIn, tokensOut };
}

/** `callClaude` with a schema, parsed. */
export async function callClaudeJson<T = unknown>(
  call: ClaudeCall & { schema: Schema },
): Promise<{ data: T; tokensIn: number | null; tokensOut: number | null }> {
  const { text, tokensIn, tokensOut } = await callClaude(call);
  return { data: JSON.parse(text) as T, tokensIn, tokensOut };
}
