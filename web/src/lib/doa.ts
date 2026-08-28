/**
 * Halaman Doa — evergreen du'a topic pages.
 *
 * See `docs/doa-pages-plan.md`. These pages exist because the briefing
 * deliverables that make up ~96% of the sitemap carry no query intent, while
 * every query that has ever surfaced in GSC is an evergreen lookup
 * ("kisah asyura", "hadits tentang upah pekerja"). Du'a is the cheapest test
 * of that thesis: highest-volume, lowest-competition Indonesian category,
 * data already clean.
 *
 * Data source is `dua-library.json`, a build-time copy of
 * `api/src/api/data/dua_library.json`. It is imported rather than fetched so
 * the pages prerender fully static — no runtime dependency on the API.
 * `scripts/check-doa-parity.mjs` asserts the two copies match; two copies of
 * one dataset drifting is a bug this repo has shipped twice already.
 */
import raw from "./data/dua-library.json";

export type Dua = {
  citation: string;
  corpus: string;
  arabic: string;
  translation_id: string;
  transliteration?: string;
  tags: string[];
};

export const DUAS = raw as Dua[];

/**
 * The 16 published topics, each keyed by an existing tag.
 *
 * `query` is the Indonesian search phrase the page targets and is used
 * verbatim as the H1 and the <title> stem — writing the page around the
 * actual query is the entire point of the exercise.
 *
 * Three tags in the library are deliberately NOT published because nobody
 * searches them: `keteguhan-iman`, `akhlak`, `dunia-akhirat`. Their du'a
 * still surface through the other topics they are tagged with.
 */
export const TOPICS = [
  { slug: "ampunan", query: "Doa Minta Ampunan", lead: "memohon ampunan Allah atas dosa" },
  { slug: "perlindungan", query: "Doa Perlindungan", lead: "memohon perlindungan Allah dari keburukan" },
  { slug: "tobat", query: "Doa Taubat", lead: "kembali kepada Allah setelah berbuat dosa" },
  { slug: "wafat-kubur", query: "Doa untuk Orang Meninggal", lead: "mendoakan yang telah wafat" },
  { slug: "waktu-sulit", query: "Doa Saat Susah", lead: "memohon jalan keluar saat hidup terasa berat" },
  { slug: "syukur", query: "Doa Syukur", lead: "mensyukuri nikmat yang Allah berikan" },
  { slug: "rezeki", query: "Doa Minta Rezeki", lead: "memohon rezeki yang halal dan berkah" },
  { slug: "hidayah", query: "Doa Minta Hidayah", lead: "memohon petunjuk dan keteguhan di jalan yang lurus" },
  { slug: "pagi-petang", query: "Dzikir Pagi dan Petang", lead: "dibaca di pagi dan sore hari" },
  { slug: "fitnah", query: "Doa Terhindar dari Fitnah", lead: "memohon dijauhkan dari fitnah dan ujian" },
  { slug: "sabar", query: "Doa Minta Kesabaran", lead: "memohon kesabaran dalam menghadapi ujian" },
  { slug: "sakit-syifa", query: "Doa untuk Orang Sakit", lead: "memohon kesembuhan bagi yang sakit" },
  { slug: "safar", query: "Doa Safar dan Naik Kendaraan", lead: "dibaca ketika bepergian" },
  { slug: "keluarga-anak", query: "Doa untuk Anak dan Keluarga", lead: "mendoakan keluarga dan keturunan" },
  { slug: "ilmu", query: "Doa Menuntut Ilmu", lead: "memohon ilmu yang bermanfaat" },
  { slug: "hutang", query: "Doa Lunas Hutang", lead: "memohon dilunaskan dari beban hutang" },
] as const;

export type Topic = (typeof TOPICS)[number];

export function getTopic(slug: string): Topic | undefined {
  return TOPICS.find((t) => t.slug === slug);
}

/** Du'a carrying this tag, longest translation first so the page opens strong. */
export function duasForTopic(slug: string): Dua[] {
  return DUAS.filter((d) => d.tags?.includes(slug)).sort(
    (a, b) => (b.translation_id?.length ?? 0) - (a.translation_id?.length ?? 0),
  );
}

/** Human-readable source name for the citation line. */
export function corpusLabel(corpus: string): string {
  const M: Record<string, string> = {
    bukhari: "Sahih al-Bukhari",
    muslim: "Sahih Muslim",
    riyad_as_salihin: "Riyadhus Shalihin",
    bulugh_al_maram: "Bulughul Maram",
  };
  return M[corpus] ?? corpus;
}
