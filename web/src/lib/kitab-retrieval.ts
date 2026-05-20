/**
 * Unified semantic retrieval across the kitab corpus.
 *
 * Queries Qdrant collections in parallel — `quran`, `hadith`,
 * `tafsir_ibn_kathir` — embeds the query once via OpenAI, merges hits by
 * cosine score, returns the top-K.
 *
 * Architecture
 * ------------
 *  - One OpenAI embed of the topic per call (regardless of how many
 *    corpora we query), so multi-corpus search costs the same in embedding
 *    $ as single-corpus.
 *  - Per-corpus errors (collection not yet embedded, etc.) are caught and
 *    skipped — the merged result is the union of whatever IS embedded.
 *  - **Fails loudly when retrieval is fundamentally broken** — no OpenAI
 *    key, OpenAI embedding error, Qdrant unreachable on ALL collections,
 *    or zero matches across all corpora. The caller catches
 *    `RetrievalUnavailableError` and surfaces a typed error to the UI
 *    rather than shipping a brief with no daleel (per PRD §12: every
 *    Islamic reference must come from the corpus, never invented).
 */

import { QdrantClient } from "@qdrant/js-client-rest";
import OpenAI from "openai";

import { recordUsage } from "@/lib/usage-log";

/**
 * Thrown when semantic retrieval can't produce any daleel — no OpenAI key
 * configured, OpenAI / Qdrant unreachable, or zero hits across all queried
 * corpora. The brief action catches this and refuses to generate a brief
 * rather than shipping one without daleel.
 *
 * This is a system/pipeline failure — different from `WeakRelevanceError`,
 * which fires when the pipeline works but the topic just doesn't match
 * the corpus well enough.
 */
export class RetrievalUnavailableError extends Error {
  constructor(public readonly reason: string) {
    super(`Retrieval unavailable: ${reason}`);
    this.name = "RetrievalUnavailableError";
  }
}

/**
 * Thrown when retrieval succeeded but ALL hits scored below
 * `MIN_RELEVANCE`. The topic is genuinely too narrow / niche / off-corpus
 * for the kitab library to support a brief. The UI surfaces this as a
 * "try a broader framing" message, distinct from a retry-friendly system
 * outage.
 *
 * `topScore` carries the best score we did see, so the caller can log
 * "topic X had max relevance 0.32" — useful for tuning the threshold.
 */
export class WeakRelevanceError extends Error {
  constructor(
    public readonly reason: string,
    public readonly topScore: number,
  ) {
    super(`Weak relevance: ${reason}`);
    this.name = "WeakRelevanceError";
  }
}

/**
 * Cosine-similarity floor below which a hit is considered too weak to
 * include in a brief. Calibrated against text-embedding-3-large output
 * for our query-enrichment style ("<topic> for <segment> audience"):
 *   ≥ 0.7  strongly on-topic
 *   ≥ 0.55 solidly related
 *   ≥ 0.45 loosely related  ← floor
 *   < 0.45 padding / generic guidance
 * Tune after observing real-brief retrieval logs. If briefs feel padded,
 * raise to 0.5. If too many WeakRelevanceError events for legit topics,
 * drop to 0.4.
 */
const MIN_RELEVANCE = 0.45;

export type KitabCorpus =
  | "quran"
  | "bukhari"
  | "muslim"
  | "riyad"
  | "bulugh"
  | "tafsir";

const COLLECTION_NAMES: Record<KitabCorpus, string> = {
  quran: "quran",
  bukhari: "bukhari",
  muslim: "muslim",
  riyad: "riyad_as_salihin",
  bulugh: "bulugh_al_maram",
  tafsir: "tafsir_ibn_kathir",
};

// MUST match the model used in `api/src/api/scripts/embed_quran.py`,
// `embed_hadith.py`, `embed_tafsir.py`. One env var drives every embed
// + retrieval path so the vector dimensions always match.
const EMBEDDING_MODEL =
  process.env.EMBEDDING_MODEL ?? "text-embedding-3-large";

/**
 * One unified hit shape regardless of corpus. The brief generator only
 * cares about (arabic, translation, citation, score) — corpus-specific
 * fields like `surah`/`ayah` are kept for richer rendering downstream.
 */
export type LinkedAyah = {
  arabic: string;
  translation: string;
  citation: string;
};

export type KitabHit = {
  corpus: KitabCorpus;
  arabic: string;
  /** Locale-appropriate translation (id or en, picked by `locale`). */
  translation: string;
  /** Locale-appropriate citation, e.g. "QS. Al-Baqarah: 195" or "Sahih al-Bukhari 1". */
  citation: string;
  /** Cosine similarity (0–1) from Qdrant. */
  score?: number;
  retrievalSource: "qdrant";
  // Corpus-specific decoration kept around for the brief renderer.
  surah?: number;
  ayah?: number;
  hadithNumber?: number;
  /** For tafsir hits only: the Qur'an ayah this passage is commenting on,
   *  fetched from the quran collection by exact key. Lets the brief
   *  generator quote both the source verse and the commentary together,
   *  which is how tafsir is meant to be read. */
  linkedAyah?: LinkedAyah;
  /** Same hadith found in other corpora — populated by `dedupeByArabic()`.
   *  The primary hit (this object) is the highest-scoring; others are
   *  collapsed here so the brief can render the multi-source attribution
   *  ("agreed upon by Bukhari and Muslim") instead of repeating the hadith. */
  alsoFoundIn?: Array<{ corpus: KitabCorpus; citation: string }>;
};

export type RetrieveOptions = {
  /** Which corpus to query. Default "all" — Qur'an + 3 hadith books + tafsir in parallel. */
  corpus?: KitabCorpus | "all";
  /** Top-K **per corpus**. Default 2 → with `corpus: "all"`, each kitab
   *  contributes up to N hits to the brief instead of one corpus's high-
   *  score hits dominating the entire daleel block. Total returned scales
   *  with the number of corpora in `COLLECTION_NAMES`. */
  topK?: number;
  /** Locale for translation + citation. */
  locale: "id" | "en";
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
 * Top-K daleel for `query`, ranked by semantic similarity. Embed once,
 * query the requested corpora in parallel, merge by score, return top K.
 *
 * Throws `RetrievalUnavailableError` when the pipeline can't produce any
 * daleel — caller (briefs/actions.ts) catches this and refuses to ship
 * a daleel-less brief.
 */
export async function retrieveDaleel(
  query: string,
  opts: RetrieveOptions,
): Promise<KitabHit[]> {
  const topK = opts.topK ?? 2;
  const corpora: KitabCorpus[] =
    !opts.corpus || opts.corpus === "all"
      ? ["quran", "bukhari", "muslim", "riyad", "bulugh", "tafsir"]
      : [opts.corpus];

  const openai = getOpenai();
  if (!openai) {
    throw new RetrievalUnavailableError("OPENAI_API_KEY not configured");
  }

  let vector: number[] | undefined;
  try {
    const emb = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: query,
    });
    vector = emb.data[0]?.embedding;
    void recordUsage({
      provider: "openai",
      operation: "embedding",
      model: EMBEDDING_MODEL,
      tokensIn: emb.usage?.total_tokens ?? null,
    });
  } catch (err) {
    console.error("[kitab-retrieval] OpenAI embed failed:", err);
    throw new RetrievalUnavailableError(
      err instanceof Error ? err.message : "OpenAI embedding failed",
    );
  }
  if (!vector) {
    throw new RetrievalUnavailableError("OpenAI returned no embedding vector");
  }

  // Query each requested corpus in parallel and take its own top-K.
  // Per-corpus failures (collection not yet embedded, single-corpus
  // timeout) are skipped — we want partial results, not all-or-nothing.
  //
  // Returning EACH corpus's top-K (not a global top-K) is deliberate: a
  // brief grounded in Qur'an + hadith + tafsir reads richer than three
  // verses alone, and a da'i preparing a khutbah usually wants the
  // canonical scholarly structure of all three source types. The trade-off
  // is a bigger daleel block in the LLM prompt (~$0.005 extra/brief).
  const perCorpusHits = await Promise.all(
    corpora.map((c) => queryCorpus(c, vector!, topK, opts.locale)),
  );

  const merged = perCorpusHits
    .flat()
    .sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));

  // Zero hits across every corpus means EITHER Qdrant is wholly down OR
  // none of the requested corpora has been embedded. Either way, we have
  // no daleel and the brief can't ship — fail loudly so the UI tells the
  // user instead of silently producing a degraded brief.
  if (merged.length === 0) {
    throw new RetrievalUnavailableError(
      `no hits from any of [${corpora.join(", ")}] — collections may be empty or Qdrant is unreachable`,
    );
  }

  // Filter out weakly-relevant hits. Without this, a niche fiqh question
  // would still drag in low-score Qur'an + tafsir hits just to maintain
  // representation — padding the brief with daleel the LLM has to ignore.
  const filtered = merged.filter(
    (h) => (h.score ?? 0) >= MIN_RELEVANCE,
  );
  if (filtered.length === 0) {
    // Pipeline worked, corpus just doesn't cover this topic. Tell the
    // user to reformulate rather than retry.
    throw new WeakRelevanceError(
      `top score ${merged[0].score?.toFixed(2)} below floor ${MIN_RELEVANCE}`,
      merged[0].score ?? 0,
    );
  }

  // Cross-corpus dedup: the same hadith often appears in multiple
  // collections (Bukhari + Muslim + Riyad + Bulugh share many entries).
  // Without dedup, the LLM would see 3-4 copies of the same hadith and
  // we'd waste retrieval slots. Keep the highest-scoring instance as
  // primary; collapse others into `alsoFoundIn` so the multi-source
  // attribution ("agreed upon") is preserved as a credibility signal.
  const deduped = dedupeByArabic(filtered);

  // Enrich each tafsir hit with the Qur'an ayah it's commenting on.
  // Single batched retrieve by exact point ID; no vector search needed.
  return await attachLinkedAyahToTafsir(deduped, opts.locale);
}

/**
 * How many points each corpus collection holds. Used by the public
 * /kitab page to show the corpus size next to each kitab card. Reads
 * Qdrant collection info (fast, no embed) and returns 0 for any
 * corpus whose collection doesn't exist yet.
 */
export async function getKitabCounts(): Promise<Record<KitabCorpus, number>> {
  const qdrant = getQdrant();
  const corpora = Object.keys(COLLECTION_NAMES) as KitabCorpus[];
  const counts: Partial<Record<KitabCorpus, number>> = {};
  await Promise.all(
    corpora.map(async (c) => {
      try {
        const info = await qdrant.getCollection(COLLECTION_NAMES[c]);
        counts[c] = info.points_count ?? 0;
      } catch {
        counts[c] = 0;
      }
    }),
  );
  return counts as Record<KitabCorpus, number>;
}


/**
 * Public-facing browse search — distinct from `retrieveDaleel` because
 * we want different semantics here:
 *  - No MIN_RELEVANCE filter (let the user see weak matches too;
 *    they can judge for themselves)
 *  - No dedup (each kitab's hit is its own row, useful for citation
 *    research)
 *  - No throws on empty — return [] so the UI shows "no results"
 *  - Return at most `limit` rows ACROSS all queried corpora (vs.
 *    `retrieveDaleel`'s per-corpus topK)
 *
 * Used by the public `/kitab` page so any visitor can semantic-search
 * the corpus without needing a login or a brief.
 */
export async function searchKitabBrowse(
  query: string,
  opts: { corpora: KitabCorpus[]; limit: number; locale: "id" | "en" },
): Promise<KitabHit[]> {
  if (!query.trim() || opts.corpora.length === 0) return [];

  const openai = getOpenai();
  if (!openai) return [];

  let vector: number[] | null = null;
  try {
    const emb = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: query,
    });
    vector = emb.data[0]?.embedding ?? null;
    void recordUsage({
      provider: "openai",
      operation: "embedding",
      model: EMBEDDING_MODEL,
      tokensIn: emb.usage?.total_tokens ?? null,
    });
  } catch (err) {
    console.error("[kitab-search] embed failed:", err);
    return [];
  }
  if (!vector) return [];

  // Query each corpus for up to `limit` hits so we have enough merged
  // candidates to fairly compete across corpora. Worst case: 6 × 20 =
  // 120 candidates, sorted and sliced to `limit`.
  const perCorpusHits = await Promise.all(
    opts.corpora.map((c) => queryCorpus(c, vector!, opts.limit, opts.locale)),
  );

  return perCorpusHits
    .flat()
    .sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity))
    .slice(0, opts.limit);
}


async function queryCorpus(
  corpus: KitabCorpus,
  vector: number[],
  limit: number,
  locale: "id" | "en",
): Promise<KitabHit[]> {
  const qdrant = getQdrant();
  try {
    const results = await qdrant.search(COLLECTION_NAMES[corpus], {
      vector,
      limit,
      with_payload: true,
    });
    return results.map((r) => normalizeHit(corpus, r, locale));
  } catch (err) {
    // Collection doesn't exist yet (hadith / tafsir before their embed
    // scripts have been run) or Qdrant is unreachable — return empty so
    // the merge in retrieveDaleel still produces a result from the other
    // corpora that DO have data.
    console.warn(
      `[kitab-retrieval] ${corpus} query failed, skipping this corpus:`,
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

type QdrantHit = {
  score?: number;
  payload?: Record<string, unknown> | null;
};

function normalizeHit(
  corpus: KitabCorpus,
  hit: QdrantHit,
  locale: "id" | "en",
): KitabHit {
  const p = (hit.payload ?? {}) as Record<string, unknown>;
  const score = hit.score;

  if (corpus === "quran") {
    return {
      corpus,
      arabic: String(p.arabic ?? ""),
      translation: String(locale === "id" ? (p.id ?? p.en) : (p.en ?? p.id)) || "",
      citation: String(
        locale === "id" ? (p.citation_id ?? p.citation_en) : (p.citation_en ?? p.citation_id),
      ),
      surah: typeof p.surah === "number" ? p.surah : undefined,
      ayah: typeof p.ayah === "number" ? p.ayah : undefined,
      score,
      retrievalSource: "qdrant",
    };
  }

  if (
    corpus === "bukhari" ||
    corpus === "muslim" ||
    corpus === "riyad" ||
    corpus === "bulugh"
  ) {
    // All three hadith books share the same payload shape (AR + EN +
    // citation_en + hadithnumber). Only EN translation exists for hadith
    // today (per the AR+EN-only download script).
    return {
      corpus,
      arabic: String(p.ar ?? p.arabic ?? ""),
      translation: String(p.en ?? ""),
      citation: String(p.citation_en ?? p.citation ?? ""),
      hadithNumber: typeof p.hadithnumber === "number" ? p.hadithnumber : undefined,
      score,
      retrievalSource: "qdrant",
    };
  }

  // tafsir
  return {
    corpus,
    arabic: String(p.ayah_text_ar ?? p.arabic ?? ""),
    translation: String(p.chunk_text_en ?? p.ayah_text_en ?? ""),
    citation: String(p.citation_en ?? ""),
    surah: typeof p.surah === "number" ? p.surah : undefined,
    ayah: typeof p.ayah === "number" ? p.ayah : undefined,
    score,
    retrievalSource: "qdrant",
  };
}

/* ─────────────────────────────────────────────────────────────
 * Cross-corpus deduplication for the same hadith
 * ───────────────────────────────────────────────────────────── */

/**
 * Normalise Arabic text so the same hadith from different collections
 * compares equal regardless of which diacritics each editor included
 * or which hamza/alif variant the typesetter used.
 *
 * Drops: tashkeel (ً–ٟ), dagger alif (ٰ), tatweel
 * (ـ), and ZWJ/ZWNJ. Folds alif variants (madda آ, hamza-on-
 * alif أ, hamza-below-alif إ) → bare alif ا, and alif
 * maqsura ى → ya ي. Whitespace collapsed.
 *
 * Doesn't fold ta marbuta (ة) → ha (ه) — that distinction is
 * grammatically meaningful and shouldn't be lost for matching purposes.
 */
function normalizeArabic(text: string): string {
  return text
    .replace(/[ً-ٰٟ]/g, "")
    .replace(/[‌-‍]/g, "")
    .replace(/ـ/g, "")
    .replace(/[آأإ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

const DEDUP_MIN_CHARS = 30;

/**
 * Group hits by normalised Arabic text. The highest-scoring hit per
 * group is kept as the primary; the rest are collapsed into the
 * primary's `alsoFoundIn` array.
 *
 * Hits with very short or missing Arabic (< {@link DEDUP_MIN_CHARS}
 * chars after normalisation) bypass the merge — too short to dedupe
 * reliably and likely a different kind of content (Qur'an verse vs
 * hadith vs tafsir chunk, which have distinct Arabic anyway).
 */
function dedupeByArabic(hits: KitabHit[]): KitabHit[] {
  const groups = new Map<string, KitabHit[]>();
  const bypassed: KitabHit[] = [];

  for (const h of hits) {
    const key = normalizeArabic(h.arabic ?? "");
    if (key.length < DEDUP_MIN_CHARS) {
      bypassed.push(h);
      continue;
    }
    const group = groups.get(key);
    if (group) group.push(h);
    else groups.set(key, [h]);
  }

  const merged: KitabHit[] = bypassed.slice();
  for (const group of groups.values()) {
    // Sort by score desc — highest scoring is the primary citation,
    // the rest are attached as "also found in".
    group.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
    const [primary, ...rest] = group;
    if (rest.length === 0) {
      merged.push(primary);
      continue;
    }
    // Dedupe by (corpus, citation) in case the same secondary
    // appeared twice (shouldn't happen at the same retrieval call,
    // but defensive).
    const seen = new Set<string>([`${primary.corpus}|${primary.citation}`]);
    const alsoFoundIn: Array<{ corpus: KitabCorpus; citation: string }> = [];
    for (const r of rest) {
      const tag = `${r.corpus}|${r.citation}`;
      if (seen.has(tag)) continue;
      seen.add(tag);
      alsoFoundIn.push({ corpus: r.corpus, citation: r.citation });
    }
    merged.push({ ...primary, alsoFoundIn });
  }

  return merged.sort(
    (a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity),
  );
}

/**
 * For each tafsir hit, fetch the Qur'an ayah it's commenting on from the
 * `quran` collection by exact point ID (no vector search). Attaches the
 * matched ayah's Arabic + translation + citation as `linkedAyah` on the
 * hit so the brief generator can quote the source verse alongside the
 * commentary.
 *
 * The Qur'an embed script (api/src/api/scripts/embed_quran.py) writes
 * each ayah with a deterministic point ID `surah * 1000 + ayah`, so the
 * lookup here is a primary-key fetch — single batched call to Qdrant,
 * ~5ms, not metered.
 *
 * Silently degrades if the quran collection is unreachable or the
 * particular point doesn't exist (e.g. embed_quran.py hasn't run yet
 * for that range) — the tafsir hit is returned without `linkedAyah`
 * rather than failing the whole retrieval.
 */
async function attachLinkedAyahToTafsir(
  hits: KitabHit[],
  locale: "id" | "en",
): Promise<KitabHit[]> {
  const tafsirNeedingLink = hits.filter(
    (h) =>
      h.corpus === "tafsir" &&
      typeof h.surah === "number" &&
      typeof h.ayah === "number" &&
      !h.linkedAyah,
  );
  if (tafsirNeedingLink.length === 0) return hits;

  // Same deterministic scheme as embed_quran.py.
  const idFor = (surah: number, ayah: number) => surah * 1000 + ayah;
  const keyOf = (surah: number, ayah: number) => `${surah}:${ayah}`;

  const wantedIds = Array.from(
    new Set(
      tafsirNeedingLink.map((h) => idFor(h.surah!, h.ayah!)),
    ),
  );

  let byKey: Map<string, LinkedAyah>;
  try {
    const qdrant = getQdrant();
    const points = await qdrant.retrieve(COLLECTION_NAMES.quran, {
      ids: wantedIds,
      with_payload: true,
    });
    byKey = new Map(
      points.map((pt) => {
        const p = (pt.payload ?? {}) as Record<string, unknown>;
        const surah = typeof p.surah === "number" ? p.surah : 0;
        const ayah = typeof p.ayah === "number" ? p.ayah : 0;
        const linked: LinkedAyah = {
          arabic: String(p.arabic ?? ""),
          translation: String(
            locale === "id" ? (p.id ?? p.en) : (p.en ?? p.id),
          ),
          citation: String(
            locale === "id"
              ? (p.citation_id ?? p.citation_en)
              : (p.citation_en ?? p.citation_id),
          ),
        };
        return [keyOf(surah, ayah), linked];
      }),
    );
  } catch (err) {
    // Quran collection unreachable / not embedded yet — tafsir hits ship
    // without their linked ayah. Brief still generates; the LLM just
    // doesn't see the source verse for tafsir entries.
    console.warn(
      "[kitab-retrieval] failed to link tafsir hits to quran ayat:",
      err instanceof Error ? err.message : err,
    );
    return hits;
  }

  return hits.map((h) => {
    if (
      h.corpus !== "tafsir" ||
      typeof h.surah !== "number" ||
      typeof h.ayah !== "number"
    ) {
      return h;
    }
    const linked = byKey.get(keyOf(h.surah, h.ayah));
    return linked ? { ...h, linkedAyah: linked } : h;
  });
}

