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

import { GoogleGenAI } from "@google/genai";
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
 * include in a brief. Recalibrated 2026-05-29 against an 11-query probe
 * (text-embedding-3-large + Gemini-Flash-Lite query expansion, run
 * against the live prod corpus). Observed score bands:
 *
 *   ≥ 0.55 strongly on-topic   ("sabar menghadapi musibah" → 0.62,
 *                                "berbakti kepada orang tua" → 0.56,
 *                                "amanah pejabat" → 0.55)
 *   ≥ 0.40 solidly related     ("judi online" → 0.44, "burnout
 *                                profesional muda" → 0.41, "manajemen
 *                                waktu pelajar" → 0.41)
 *   ≥ 0.32 loosely related ← floor  ("kesehatan mental" → 0.35,
 *                                    "bullying sekolah" → 0.35)
 *   < 0.32 off-topic            ("nasi goreng" → 0.26,
 *                                "film bioskop" → 0.23)
 *
 * Quran consistently scores higher than hadith because its Kemenag
 * Indonesian translations embed cleaner into the model's vector space.
 * The previous 0.45 floor was carryover from an obsolete calibration
 * and rejected most legitimate modern-phrased topics (burnout, judi
 * online, kesehatan mental). 0.32 keeps a comfortable margin above the
 * highest observed off-topic score (0.26).
 *
 * Tune after observing more real-brief retrieval logs. If briefs feel
 * padded with weak hits, raise toward 0.36. If too many legit topics
 * trip WeakRelevanceError, drop toward 0.30.
 */
const MIN_RELEVANCE = 0.32;

export type KitabCorpus =
  | "quran"
  | "bukhari"
  | "muslim"
  | "riyad"
  | "bulugh"
  | "tafsir"
  | "bidayat"
  | "umm"
  | "bn"
  | "nashaih"
  | "fs"
  | "fmuin"
  | "fqarib"
  | "adab"
  | "aqidah"
  | "ts3"
  | "syamail"
  | "sirah"
  | "hs";

const COLLECTION_NAMES: Record<KitabCorpus, string> = {
  quran: "quran",
  bukhari: "bukhari",
  muslim: "muslim",
  riyad: "riyad_as_salihin",
  bulugh: "bulugh_al_maram",
  tafsir: "tafsir_ibn_kathir",
  bidayat: "bidayat_al_hidayah",
  umm: "al_umm",
  bn: "al_bidayah_wan_nihayah",
  nashaih: "nashaihul_ibad",
  fs: "fiqh_as_sunnah",
  fmuin: "fath_al_muin",
  fqarib: "fath_al_qarib",
  adab: "adab_alim_mutaallim",
  aqidah: "aqidah_awam",
  ts3: "thalathat_al_usul",
  syamail: "syamail_muhammadiyyah",
  sirah: "sirah_ibn_hisham",
  hs: "hayat_as_sahabah",
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
  /** Tafsir-only: which chunk of the per-ayah commentary this hit is. */
  chunkIndex?: number;
  /** Tafsir-only: how many chunks the per-ayah commentary was split into. */
  totalChunks?: number;
  /** Tafsir-only: the FULL English commentary for the ayah (every chunk
   *  concatenated as it appeared in the source). Used by the UI to render
   *  a "show full commentary" expansion so a chunk hit doesn't read as
   *  cut-off mid-sentence. */
  fullCommentaryEn?: string;
  /** Tafsir-only: the FULL Arabic commentary for the ayah. Same purpose
   *  as fullCommentaryEn — gives the reader the whole exegesis when they
   *  expand the result. */
  fullCommentaryAr?: string;
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
      ? ["quran", "bukhari", "muslim", "riyad", "bulugh", "tafsir", "bidayat", "umm", "bn", "nashaih", "fs", "fmuin", "fqarib", "adab", "aqidah", "ts3", "syamail", "sirah", "hs"]
      : [opts.corpus];

  const openai = getOpenai();
  if (!openai) {
    throw new RetrievalUnavailableError("OPENAI_API_KEY not configured");
  }

  // Flash-Lite query expansion — same helper `searchKitabBrowse` uses.
  // Without this, raw user topics like "belajar agama utk gen z atau
  // alpha" land at <0.40 cosine similarity (the kitab corpus has no
  // "gen z" tokens) and trigger WeakRelevanceError even when the
  // theme IS covered. The expander rewrites colloquial / code-switched
  // Indonesian into syariah-vocabulary equivalents that the corpus
  // actually contains. Falls through to the raw query on any failure.
  const expandedQuery = await expandQuery(query);
  if (expandedQuery !== query) {
    console.info(
      "[kitab-retrieval] query expanded:",
      JSON.stringify(query),
      "→",
      JSON.stringify(expandedQuery),
    );
  }

  let vector: number[] | undefined;
  try {
    const emb = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: expandedQuery,
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
 * Re-rank embedding-retrieved daleel candidates by THEMATIC fit
 * using Gemini Flash-Lite.
 *
 * Cosine similarity matches passages whose embedding tokens overlap
 * the query — for "isu youth" it surfaces verses that contain `muda`
 * or `pemuda` regardless of context (e.g. Quran verses about youthful
 * paradise servants instead of real-world youth issues). This re-rank
 * asks a cheap LLM to score the *thematic relevance* of each candidate
 * to the theme.
 *
 * Falls back to the input order on any error (defense in depth — a
 * rerank failure must never break the brief pipeline).
 *
 * Ported from api/src/api/services/kitab_retrieval.py::rerank_daleel
 * so the brief flow gets the same quality lift the insights pipeline
 * already enjoys.
 */
export async function rerankDaleel(
  theme: string,
  candidates: KitabHit[],
  opts: { topN: number },
): Promise<KitabHit[]> {
  const { topN } = opts;
  if (candidates.length === 0 || candidates.length <= topN) {
    return candidates.slice(0, topN);
  }
  if (!process.env.GEMINI_API_KEY) {
    return candidates.slice(0, topN);
  }

  const numbered = candidates
    .map(
      (c, i) =>
        `[${i}] ${c.corpus.toUpperCase()} ${c.citation}\n` +
        `    Arab: ${c.arabic.slice(0, 200)}\n` +
        `    Terjemah: ${c.translation.slice(0, 300)}`,
    )
    .join("\n");

  const prompt = `Theme da'i akan diangkat pekan ini:
${theme}

Berikut adalah ${candidates.length} kandidat daleel dari Qur'an dan hadith yang ditemukan oleh pencarian embedding. Beberapa cocok dengan tema, beberapa hanya cocok pada kata kunci permukaan saja (tidak relevan secara tematik).

TUGAS: Pilih INDEX daleel yang BENAR-BENAR relevan secara TEMATIK untuk tema di atas.

ATURAN PENILAIAN — wajib ketat:
- Daleel TIDAK COCOK jika hanya berbagi kata permukaan tapi konteks asli berbeda. Contoh kesalahan yang HARUS Anda tolak:
  * tema "pinjol/riba" + daleel tentang "pemuda yang taat di Gua Kahfi" → TIDAK COCOK (sama-sama "muda", tapi tema-nya kepatuhan vs muamalah)
  * tema "judol/maysir" + daleel tentang "permainan anak-anak" → TIDAK COCOK (kata "lahw" tidak otomatis = perjudian)
  * tema "kekerasan terhadap anak" + daleel tentang "perlindungan harta yatim" → LEMAH (terkait, tapi tema sebenarnya kekerasan fisik, bukan harta)
  * tema "depresi/mental health" + daleel tentang "kesabaran nabi atas kafir Quraysy" → LEMAH (sabar tapi konteks dakwah-ke-luar, bukan ketenangan jiwa)
  * tema "KDRT / kekerasan seksual" + daleel tentang "mengubur anak perempuan hidup-hidup di zaman Jahiliyah" → LEMAH (ayat berbicara TENTANG kebudayaan kuno; konteks modern sebagai metafora terlalu jauh — da'i harus melakukan bridging rhetoric yang berisiko terasa janggal)
- TES APLIKABILITAS MODERN: untuk SETIAP daleel kandidat, tanya: "Kalau da'i mengutip ayat/hadith ini di mimbar untuk topik ini, apakah jamaah modern bisa langsung menangkap relevansinya, atau da'i perlu menjelaskan panjang lebar konteks aslinya?" Kalau perlu bridging > 2 kalimat → daleel ini LEMAH untuk topik ini, walaupun secara abstrak berbagi tema (perlindungan, keadilan, dll). Pilih daleel yang berbicara LANGSUNG tentang fenomena modern yang dibahas, bukan analogi historis yang harus diregangkan.
- Daleel COCOK kalau ayat/hadith-nya BENAR-BENAR berbicara tentang inti tema-nya, bukan hanya berbagi satu kata. Contoh yang BENAR:
  * tema "pinjol/riba" + daleel QS Al-Baqarah:275-281 (larangan riba) → COCOK
  * tema "judol/maysir" + daleel QS Al-Maidah:90-91 (khamr & maysir) → COCOK
  * tema "bullying/ghibah" + hadith tentang lisan yang menjaga saudara → COCOK
  * tema "korupsi/amanah" + ayat tentang menunaikan amanah → COCOK
  * tema "KDRT" + hadith Bukhari/Muslim tentang larangan memukul istri / perintah perlakuan baik terhadap perempuan → COCOK (berbicara LANGSUNG tentang fenomena)

PRINSIP TERAKHIR: lebih baik mengembalikan SEDIKIT daleel yang benar-benar tematik daripada memaksa ${topN} entri ketika hanya sebagian yang benar-benar relevan. Da'i akan mengutip ulang daleel ini di mimbar — daleel yang dipaksakan akan terasa janggal dan merusak kredibilitas pesan.

Kandidat:
${numbered}

Kembalikan JSON: {"indices": [i1, i2, ...]} dengan SEMUA index daleel yang BENAR-BENAR cocok (jumlah bisa antara 0 hingga ${topN}, urutan dari paling relevan). Kalau tidak ada satu pun yang cocok secara tematik, kembalikan {"indices": []}.`;

  try {
    const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const resp = await genai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        temperature: 0.1,
        maxOutputTokens: 200,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    void recordUsage({
      provider: "gemini",
      operation: "daleel_rerank",
      model: "gemini-2.5-flash-lite",
      tokensIn: resp.usageMetadata?.promptTokenCount ?? null,
      tokensOut: resp.usageMetadata?.candidatesTokenCount ?? null,
    });

    const raw = resp.text ?? "{}";
    const data: unknown = JSON.parse(raw);
    if (
      !data ||
      typeof data !== "object" ||
      !Array.isArray((data as { indices?: unknown }).indices)
    ) {
      throw new Error("indices not a list");
    }
    const indices = (data as { indices: unknown[] }).indices;
    const picked: KitabHit[] = [];
    const seen = new Set<number>();
    for (const idx of indices) {
      if (
        typeof idx === "number" &&
        Number.isInteger(idx) &&
        idx >= 0 &&
        idx < candidates.length &&
        !seen.has(idx)
      ) {
        picked.push(candidates[idx]);
        seen.add(idx);
        if (picked.length >= topN) break;
      }
    }
    console.info(
      "[kitab-retrieval] reranked",
      JSON.stringify({
        theme: theme.slice(0, 80),
        candidates_in: candidates.length,
        picked: picked.length,
      }),
    );
    // Do NOT top up with weak candidates — the rerank's whole point is
    // to drop surface-keyword matches. If it returned literally zero,
    // fall back to the single top-cosine hit so the brief still has
    // something to cite (mirrors the Python rerank's last-resort path).
    if (picked.length === 0) {
      console.warn(
        "[kitab-retrieval] rerank returned empty — falling back to top-1 cosine hit",
      );
      return [candidates[0]];
    }
    return picked;
  } catch (err) {
    console.warn(
      "[kitab-retrieval] rerank failed:",
      err instanceof Error ? err.message : err,
    );
    return candidates.slice(0, topN);
  }
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


/* ─────────────────────────────────────────────────────────────
 * Query expansion — bridge ID/EN/AR asymmetry across the corpora
 *
 * The Qdrant vectors were embedded asymmetrically across corpora:
 *   - Quran: EN + ID concatenated (multilingual matches well)
 *   - Hadith + Tafsir: EN only
 *
 * A query in pure Indonesian ("judi") therefore underperforms against
 * hadith/tafsir vs the English equivalent ("gambling"). Expanding the
 * query before embedding — adding its translation + 1-2 thematic
 * synonyms — flattens this asymmetry without re-embedding the corpus.
 *
 * Detection is implicit: we ask Flash-Lite to produce a "bilingual,
 * synonym-enriched" version of whatever the user typed; the model
 * figures out source language and supplies the missing translation.
 *
 * Cost: ~$0.0001 per search call on gemini-2.5-flash-lite. Latency adds
 * ~200-400ms but kitab search is already a "submit a form, wait for
 * results" interaction — that envelope is comfortable.
 *
 * Falls back to the original query string on any Gemini failure so
 * search never breaks because of the expansion step.
 * ───────────────────────────────────────────────────────────── */

let _genai: GoogleGenAI | null = null;
function getGenai(): GoogleGenAI | null {
  if (!process.env.GEMINI_API_KEY) return null;
  if (_genai === null) {
    _genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return _genai;
}

async function expandQuery(query: string): Promise<string> {
  const trimmed = query.trim();
  if (!trimmed) return trimmed;
  // Long queries are usually already context-rich and don't need
  // expansion; skip to save the LLM call.
  if (trimmed.length > 80) return trimmed;

  const genai = getGenai();
  if (!genai) return trimmed;

  const prompt = `User search query for an Islamic kitab library: "${trimmed}"

Output the same query enriched for semantic search across an Arabic-Indonesian-English corpus. Detect the input language and add:
- The equivalent term(s) in the OTHER language (id ↔ en)
- 1-2 close thematic synonyms in either language
- If the input is a transliteration of Arabic (e.g. "sabr"), include the Indonesian + English equivalents

Output ONLY the expanded query as a single space-separated string. No JSON, no labels, no quotes, no explanation.

Examples:
- "judi" → judi gambling betting maysir
- "gambling" → gambling judi maysir
- "sabar" → sabar patience perseverance
- "patience" → patience sabar tabah
- "anak yatim" → anak yatim orphan yatama
- "pinjol" → pinjol online lending riba interest

Expanded query:`;

  try {
    const resp = await genai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: prompt,
      config: {
        temperature: 0.2,
        maxOutputTokens: 60,
        // No reasoning needed — this is template-fill.
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    const expanded = (resp.text ?? "").trim().replace(/^["']|["']$/g, "");
    void recordUsage({
      provider: "gemini",
      operation: "kitab_query_expand",
      model: "gemini-2.5-flash-lite",
      tokensIn: resp.usageMetadata?.promptTokenCount ?? null,
      tokensOut: resp.usageMetadata?.candidatesTokenCount ?? null,
    });
    // Sanity check — if expansion returned empty or weirdly long
    // (~runaway generation), fall back to the original.
    if (!expanded || expanded.length > 300) return trimmed;
    return expanded;
  } catch (err) {
    console.warn(
      "[kitab-search] query expansion failed, using original:",
      err instanceof Error ? err.message : err,
    );
    return trimmed;
  }
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

  // Expand the query so an "judi" search hits English hadith/tafsir
  // vectors as well as Indonesian ones (and vice versa). See expandQuery
  // for the asymmetry rationale.
  const enrichedQuery = await expandQuery(query);

  let vector: number[] | null = null;
  try {
    const emb = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: enrichedQuery,
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
    corpus === "bidayat" ||
    corpus === "umm" ||
    corpus === "bn" ||
    corpus === "nashaih" ||
    corpus === "fs" ||
    corpus === "fmuin" ||
    corpus === "fqarib" ||
    corpus === "adab" ||
    corpus === "aqidah" ||
    corpus === "ts3" ||
    corpus === "syamail" ||
    corpus === "sirah" ||
    corpus === "hs"
  ) {
    // AR-only kitab payload (decision 2026-06-08). Translation backfill
    // is planned; chip falls back to rendering Arabic until then.
    const defaultCitations: Record<typeof corpus, string> = {
      bidayat: "Bidayatul Hidayah",
      umm: "Al-Umm",
      bn: "Al-Bidayah wan-Nihayah",
      nashaih: "Nashaihul Ibad",
      fs: "Fiqh as-Sunnah",
      fmuin: "Fath al-Mu'in",
      fqarib: "Fath al-Qarib",
      adab: "Adab al-'Alim wa al-Muta'allim",
      aqidah: "'Aqidat al-'Awam",
      ts3: "Thalathat al-Usul",
      syamail: "Ash-Shama'il al-Muhammadiyyah",
      sirah: "Sirah Ibn Hisham",
      hs: "Hayat as-Sahabah",
    };
    return {
      corpus,
      arabic: String(p.ar ?? ""),
      translation: "",
      citation: String(p.citation ?? defaultCitations[corpus]),
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
    // Hadith payload shape: AR + EN (+ optional ID for manually translated
    // corpora) + citation_en (+ optional citation_id) + hadithnumber.
    // Muslim was manually translated to Indonesian 2026-05; the embed
    // script now writes `id` and `citation_id` for any row that has them.
    // Bukhari / Riyad / Bulugh stay EN-only until they too are translated,
    // and the `?? p.en` fallback keeps the brief renderer working until
    // then (so we don't ship empty Indonesian translations for un-yet-
    // translated corpora).
    return {
      corpus,
      arabic: String(p.ar ?? p.arabic ?? ""),
      translation: String(
        locale === "id" ? (p.id ?? p.en ?? "") : (p.en ?? p.id ?? ""),
      ),
      citation: String(
        locale === "id"
          ? (p.citation_id ?? p.citation_en ?? p.citation ?? "")
          : (p.citation_en ?? p.citation_id ?? p.citation ?? ""),
      ),
      hadithNumber: typeof p.hadithnumber === "number" ? p.hadithnumber : undefined,
      score,
      retrievalSource: "qdrant",
    };
  }

  // tafsir. The matched `chunk_text_en` is what we surface as the primary
  // translation — that's the segment Qdrant scored high — but we ALSO
  // carry the full per-ayah commentary so the UI can offer "read full".
  // Without that, a chunk reads as cut-off mid-sentence (observed
  // 2026-05-21). The arabic field stays as the FULL ayah AR commentary
  // because we don't chunk Arabic alongside English at embed time —
  // there's no AR chunk to single out.
  const fullCommentaryEn = String(p.ayah_text_en ?? "");
  return {
    corpus,
    arabic: String(p.ayah_text_ar ?? p.arabic ?? ""),
    translation: String(p.chunk_text_en ?? fullCommentaryEn ?? ""),
    citation: String(p.citation_en ?? ""),
    surah: typeof p.surah === "number" ? p.surah : undefined,
    ayah: typeof p.ayah === "number" ? p.ayah : undefined,
    chunkIndex: typeof p.chunk_index === "number" ? p.chunk_index : undefined,
    totalChunks: typeof p.total_chunks === "number" ? p.total_chunks : undefined,
    fullCommentaryEn: fullCommentaryEn || undefined,
    fullCommentaryAr: String(p.ayah_text_ar ?? "") || undefined,
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

