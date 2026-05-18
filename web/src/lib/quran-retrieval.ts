/**
 * Semantic retrieval of Qur'anic daleel from Qdrant.
 *
 * The full Qur'an (6,236 ayat × AR + ID + EN) is embedded into the `quran`
 * Qdrant collection by `api/src/api/scripts/embed_quran.py`. This module
 * wraps the query side: takes a free-text topic, embeds it with the same
 * model, runs a similarity search, and returns the top-K verses with
 * citations ready to drop into a Da'wah Brief.
 *
 * Falls back to the curated 12-verse keyword library when:
 *  - `OPENAI_API_KEY` isn't set in `.env`
 *  - Qdrant is unreachable
 *  - OpenAI rate-limits us
 *
 * That fallback keeps the brief generator working in any environment, even
 * before the Qur'an is embedded.
 */

import { QdrantClient } from "@qdrant/js-client-rest";
import OpenAI from "openai";

import {
  retrieveDaleel as retrieveDaleelKeyword,
  type DaleelEntry,
} from "@/data/daleel";
import { recordUsage } from "@/lib/usage-log";

const COLLECTION = "quran";
// MUST match the model used in `api/src/api/scripts/embed_quran.py` so
// query vectors land in the same space as the indexed corpus. We read from
// env so a single `EMBEDDING_MODEL` value in `.env` drives both sides.
const EMBEDDING_MODEL =
  process.env.EMBEDDING_MODEL ?? "text-embedding-3-large";

export type RetrievedDaleel = {
  surah: number;
  ayah: number;
  arabic: string;
  translation_id: string;
  translation_en: string;
  source_id: string;
  source_en: string;
  /** Cosine similarity score from Qdrant (0–1); undefined for fallback hits. */
  score?: number;
  /** Whether this came from semantic search vs the curated fallback. */
  source: "qdrant" | "keyword";
};

let _openai: OpenAI | null = null;
function getOpenai(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

let _qdrant: QdrantClient | null = null;
function getQdrant(): QdrantClient {
  if (!_qdrant) {
    _qdrant = new QdrantClient({
      url: process.env.QDRANT_URL ?? "http://localhost:6333",
      apiKey: process.env.QDRANT_API_KEY || undefined,
    });
  }
  return _qdrant;
}

/**
 * Top-K Qur'anic verses for `query`, ranked by semantic similarity.
 *
 * `query` should be the brief's topic/issue title — e.g.
 * "burnout in young professionals" or "halal investing for Gen Z".
 */
export async function retrieveDaleelSemantic(
  query: string,
  k = 3,
): Promise<RetrievedDaleel[]> {
  const openai = getOpenai();
  if (!openai) {
    return retrieveDaleelKeyword(query, k).map(toFallback);
  }

  try {
    const emb = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: query,
    });
    const vector = emb.data[0]?.embedding;
    if (!vector) {
      return retrieveDaleelKeyword(query, k).map(toFallback);
    }

    void recordUsage({
      provider: "openai",
      operation: "embedding",
      model: EMBEDDING_MODEL,
      tokensIn: emb.usage?.total_tokens ?? null,
    });

    const qdrant = getQdrant();
    const results = await qdrant.search(COLLECTION, {
      vector,
      limit: k,
      with_payload: true,
    });

    return results.map((r) => {
      const p = (r.payload ?? {}) as {
        surah: number;
        ayah: number;
        arabic: string;
        id: string;
        en: string;
        citation_id: string;
        citation_en: string;
      };
      return {
        surah: p.surah,
        ayah: p.ayah,
        arabic: p.arabic,
        translation_id: p.id,
        translation_en: p.en,
        source_id: p.citation_id,
        source_en: p.citation_en,
        score: r.score,
        source: "qdrant" as const,
      };
    });
  } catch (err) {
    console.error(
      "[quran-retrieval] semantic query failed, falling back to keyword library:",
      err,
    );
    return retrieveDaleelKeyword(query, k).map(toFallback);
  }
}

function toFallback(d: DaleelEntry): RetrievedDaleel {
  return {
    surah: d.surah,
    ayah: d.ayah,
    arabic: d.arabic,
    translation_id: d.translation_id,
    translation_en: d.translation_en,
    source_id: d.source_id,
    source_en: d.source_en,
    source: "keyword",
  };
}
