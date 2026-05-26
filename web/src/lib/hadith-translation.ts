import "server-only";
import { and, eq } from "drizzle-orm";
import { GoogleGenAI } from "@google/genai";

import { db, schema } from "@/db";
import { recordUsage } from "@/lib/usage-log";

/**
 * Lookup the Indonesian translation of a hadith from the
 * `hadith_translations_id` cache. On a cache miss, call Flash-Lite to
 * translate, persist to the cache, then return.
 *
 * Mirrors the Python helper `services/hadith_translation.py` so the
 * cache stays consistent across both runtimes. Same model
 * (gemini-2.5-flash-lite), same prompt shape — a row written from
 * either side is readable by both.
 *
 * Returns "" on failure (LLM error, no key) so the caller falls back
 * to English without breaking.
 */

const MODEL = "gemini-2.5-flash-lite";

// Map the short KitabCorpus enum the web uses (riyad, bulugh) to the
// FULL slug Python writes into the cache (riyad_as_salihin,
// bulugh_al_maram). Misses → return null → caller skips translation.
const CORPUS_SLUG: Record<string, string> = {
  bukhari: "bukhari",
  muslim: "muslim",
  riyad: "riyad_as_salihin",
  bulugh: "bulugh_al_maram",
};

let _client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI | null {
  if (!process.env.GEMINI_API_KEY) return null;
  if (_client === null) {
    _client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return _client;
}

const PROMPT = (textEn: string) => `Terjemahkan hadits berikut ke Bahasa Indonesia yang baku dan natural. Pertahankan struktur Islami: nama-nama sahabat + greeting (RA, ﷺ) tetap apa adanya, citation di akhir kalau ada juga tetap. JANGAN tambahkan komentar atau penjelasan. Output HANYA terjemahan Indonesia-nya, tanpa pengantar atau penutup.

Teks bahasa Inggris:
"""
${textEn}
"""

Terjemahan Bahasa Indonesia:`;

async function translateViaLlm(textEn: string): Promise<string> {
  const client = getClient();
  if (!client) return "";
  try {
    const resp = await client.models.generateContent({
      model: MODEL,
      contents: PROMPT(textEn),
      config: {
        temperature: 0.2,
        maxOutputTokens: 600,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    void recordUsage({
      provider: "gemini",
      operation: "translate_hadith_to_id",
      model: MODEL,
      tokensIn: resp.usageMetadata?.promptTokenCount ?? null,
      tokensOut: resp.usageMetadata?.candidatesTokenCount ?? null,
    });
    return (resp.text ?? "").trim();
  } catch (err) {
    console.warn(
      "[hadith-translation] LLM translate failed:",
      err instanceof Error ? err.message : err,
    );
    return "";
  }
}

/**
 * Returns the Indonesian translation of a hadith, hitting the cache
 * first and falling back to a Flash-Lite translate-then-persist.
 *
 * - `corpus`: short slug as returned by `searchKitabBrowse` (`riyad`,
 *   `bulugh`, `bukhari`, `muslim`). Internally mapped to the full slug
 *   the Python pipeline writes.
 * - `hadithNumber`: numeric or string identifier inside the corpus.
 * - `textEn`: the English text we currently have. If the cached row's
 *   `text_en` doesn't match (upstream corpus refresh), we re-translate.
 */
export async function translateHadithToId({
  corpus,
  hadithNumber,
  textEn,
}: {
  corpus: string;
  hadithNumber: string | number;
  textEn: string;
}): Promise<string> {
  if (!textEn.trim()) return "";
  const slug = CORPUS_SLUG[corpus];
  if (!slug) return "";
  const hadithStr = String(hadithNumber);

  // 1. Cache lookup.
  const [cached] = await db
    .select({
      textEn: schema.hadithTranslationsId.textEn,
      textId: schema.hadithTranslationsId.textId,
    })
    .from(schema.hadithTranslationsId)
    .where(
      and(
        eq(schema.hadithTranslationsId.corpus, slug),
        eq(schema.hadithTranslationsId.hadithnumber, hadithStr),
      ),
    )
    .limit(1);
  if (cached && cached.textEn === textEn) {
    return cached.textId;
  }

  // 2. Cache miss / English changed → translate and upsert.
  const translated = await translateViaLlm(textEn);
  if (!translated) return "";

  await db
    .insert(schema.hadithTranslationsId)
    .values({
      corpus: slug,
      hadithnumber: hadithStr,
      textEn,
      textId: translated,
      model: MODEL,
    })
    .onConflictDoUpdate({
      target: [
        schema.hadithTranslationsId.corpus,
        schema.hadithTranslationsId.hadithnumber,
      ],
      set: {
        textEn,
        textId: translated,
        model: MODEL,
      },
    });

  return translated;
}
