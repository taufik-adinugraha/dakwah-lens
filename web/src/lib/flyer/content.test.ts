/**
 * Regression tests for the flyer daleel renderer.
 *
 * Every fixture below is a VERBATIM `translation_id` pulled from
 * production `briefings.daleel_refs`. That matters: the two bugs these
 * tests pin were both invisible to hand-written samples, because the
 * shapes that break the renderer (a three-chain isnad, a markdown
 * heading on its own line) are shapes you do not think to invent.
 *
 * `pickDaleelTranslation` is the single chokepoint every flyer layout
 * calls — HeroHeadline, HeroAyat, SplitImage and QuoteCard all route
 * through it with NO budget argument, so the defaults (targetChars 560,
 * cutThreshold 600) are what production actually renders. The tests
 * call it the same way, with no options, for that reason.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { pickDaleelTranslation } from "./content";

const pick = (translation_id: string) =>
  pickDaleelTranslation({ translation_id }, "id", {});

/** A chain-of-narrators formula. Must never reach a flyer card. */
const ISNAD =
  /telah\s+(?:menceritakan|mengabarkan|mengkhabarkan|memberitakan)\s+kepada|dengan\s+isnad\s+ini/i;

// ── Fixtures ──────────────────────────────────────────────────────

/** Three parallel chains joined by "(dalam riwayat lain)". The matn's
 *  opening quote sits at offset 454 — 174 chars past the 280-char
 *  window `stripNarratorIntro` inspects. This is the hadith from the
 *  operator's screenshot: the card rendered pure isnad. */
const MUSLIM_103A =
  "Telah menceritakan kepada kami Yahya bin Yahya, telah mengabarkan kepada kami Abu Mu'awiyah; " +
  "(dalam riwayat lain) dan telah menceritakan kepada kami Abu Bakr bin Abi Syaibah, telah " +
  "menceritakan kepada kami Abu Mu'awiyah dan Waki'; (dalam riwayat lain) dan telah menceritakan " +
  "kepada kami Ibnu Numair, telah menceritakan kepada kami ayahku—semuanya dari al-A'masy, dari " +
  "'Abdullah bin Murrah, dari Masruq, dari 'Abdullah, ia berkata: Rasulullah ﷺ bersabda, " +
  "“Bukan dari golongan kami, orang yang menampar pipi, merobek baju, atau menyeru dengan " +
  "seruan jahiliyyah.” Ini hadis Yahya. Adapun Ibnu Numair dan Abu Bakr, keduanya berkata, " +
  "“dan merobek, dan menyeru”—tanpa alif (yakni dengan wawu, bukan au).";

/** 386 chars — BELOW cutThreshold, so it fits the card and the length
 *  gate never fired. It still spent 246 of those chars on narrators. */
const MUSLIM_46 =
  "Telah menceritakan kepada kami Yahya bin Ayyub, Qutaibah bin Sa'id, dan 'Ali bin Hujr—semuanya " +
  "dari Isma'il bin Ja'far—Ibnu Ayyub berkata: telah menceritakan kepada kami Isma'il, ia berkata: " +
  "telah mengabarkan kepadaku al-'Ala', dari ayahnya, dari Abu Hurairah, bahwasanya Rasulullah ﷺ " +
  "bersabda, “Tidak akan masuk surga, orang yang tetangganya tidak aman dari kejahatannya " +
  "(bawa'iqihi).”";

/** A DIALOGUE hadith: question then answer, each its own quoted span.
 *  Quote-selection keeps only the first span, which drops the answer —
 *  the teaching. Guards the fix from being "simplified" back. */
const MUSLIM_42A =
  "Dan telah menceritakan kepadaku Sa'id bin Yahya bin Sa'id al-Umawi, ia berkata: telah " +
  "menceritakan kepadaku ayahku, telah menceritakan kepada kami Abu Burdah bin 'Abdillah bin Abi " +
  "Burdah bin Abi Musa, dari Abu Burdah, dari Abu Musa (al-Asy'ari), ia berkata: Aku berkata, " +
  "“Wahai Rasulullah, Islam manakah yang paling utama?” Beliau menjawab, “Yang " +
  "orang-orang Muslim selamat dari lidah dan tangannya.”";

/** Closes with a SUPPLEMENTARY riwayah. Anchoring on the last chain
 *  formula lands there, leaves 46 unusable chars, and the whole strip
 *  gives up — so the card printed the opening chain instead. */
const MUSLIM_1554C =
  "Telah menceritakan kepada kami Bisyr bin al-Hakam, Ibrahim bin Dinar, dan 'Abdul Jabbar bin " +
  "al-'Ala' — dan lafazh ini milik Bisyr — mereka berkata: telah menceritakan kepada kami " +
  "Sufyan bin 'Uyainah, dari Humaid al-A'raj, dari Sulaiman bin 'Atiq, dari Jabir, bahwa Nabi ﷺ " +
  "memerintahkan untuk meletakkan (membebaskan dari pembayaran) bencana-bencana (jawa'ih). Abu " +
  "Ishaq — sahabat Muslim — berkata: telah menceritakan kepada kami 'Abdurrahman bin Bisyr " +
  "dari Sufyan dengan ini.";

/** Transmission by 'ard ("aku membacakan kepada Malik") rather than the
 *  `telah menceritakan` formula — a second lead-in form after the first. */
const MUSLIM_1584A =
  "Telah menceritakan kepada kami Yahya bin Yahya, ia berkata: aku membacakan kepada Malik, dari " +
  "Nafi', dari Abu Sa'id al-Khudri, bahwa Rasulullah ﷺ bersabda: \"Janganlah kalian menjual " +
  "emas dengan emas kecuali sama beratnya — janganlah kalian melebihkan sebagian atas sebagian. " +
  "Janganlah kalian menjual perak dengan perak kecuali sama beratnya — janganlah kalian " +
  "melebihkan sebagian atas sebagian. Dan janganlah kalian menjual yang tidak ada (di tangan) " +
  "dengannya secara tunai.\"";

/** An ACT, not a saying — no quoted matn anywhere, so quote-selection
 *  cannot help and only the chain strip can. */
const MUSLIM_894B =
  "Dan telah menceritakan kepada kami Yahya bin Yahya, telah mengabarkan kepada kami Sufyan bin " +
  "'Uyainah, dari 'Abdullah bin Abi Bakr, dari 'Abbad bin Tamim, dari pamannya, ia berkata: Nabi " +
  "ﷺ keluar ke tempat shalat lalu beristisqa', menghadap kiblat, membalikkan selendangnya, dan " +
  "shalat dua rakaat.";

/** A classic-kitab section opening with a markdown heading on its OWN
 *  line, whose text is Arabic. `stripMd` drops the `###` marker but
 *  keeps the words; the sentence splitter breaks on the em-dash, so the
 *  heading became sentences[0], the next sentence blew the budget in one
 *  go, and the card rendered heading + ellipsis.
 *
 *  Read from disk rather than inlined, and NOT abridged. The bug needs
 *  the full 4,625 characters to reproduce: an excerpt falls under
 *  cutThreshold, takes a different branch, and passes against the very
 *  code it is meant to catch. (Learned the hard way — a 500-char
 *  excerpt of this exact text passed on the unfixed renderer.) */
const KITAB_ARABIC_HEADING = readFileSync(
  new URL("./__fixtures__/adab-alim-nau-8.txt", import.meta.url),
  "utf8",
);

const QURAN_2_188 =
  "Dan janganlah sebahagian kamu memakan harta sebahagian yang lain di antara kamu dengan jalan " +
  "yang bathil dan (janganlah) kamu membawa (urusan) harta itu kepada hakim, supaya kamu dapat " +
  "memakan sebahagian daripada harta benda orang lain itu dengan (jalan berbuat) dosa, padahal " +
  "kamu mengetahui.";

// ── The invariant ─────────────────────────────────────────────────

describe("no daleel ever renders its chain of narrators", () => {
  const all = {
    "Muslim 103a (three parallel chains)": MUSLIM_103A,
    "Muslim 46 (short, below cutThreshold)": MUSLIM_46,
    "Muslim 42a (dialogue)": MUSLIM_42A,
    "Muslim 1554c (trailing riwayah)": MUSLIM_1554C,
    "Muslim 1584a ('ard transmission)": MUSLIM_1584A,
    "Muslim 894b (an act, no quoted matn)": MUSLIM_894B,
  };

  for (const [name, text] of Object.entries(all)) {
    it(name, () => {
      expect(pick(text)).not.toMatch(ISNAD);
    });
  }
});

// ── Isnad → matn ──────────────────────────────────────────────────

describe("hadith render the teaching, not the chain", () => {
  it("Muslim 103a renders the matn the operator's flyer was missing", () => {
    expect(pick(MUSLIM_103A)).toContain(
      "Bukan dari golongan kami, orang yang menampar pipi",
    );
  });

  it("Muslim 103a does not name a narrator", () => {
    const out = pick(MUSLIM_103A);
    for (const narrator of ["Yahya bin Yahya", "Abu Mu'awiyah", "al-A'masy", "Masruq"]) {
      expect(out).not.toContain(narrator);
    }
  });

  it("a hadith BELOW cutThreshold still loses its chain", () => {
    // The length gate alone left 16 of these leaking in production.
    expect(MUSLIM_46.length).toBeLessThan(600);
    const out = pick(MUSLIM_46);
    expect(out).toContain("Tidak akan masuk surga");
    expect(out).not.toContain("Qutaibah");
  });

  it("keeps BOTH halves of a dialogue — question and answer", () => {
    const out = pick(MUSLIM_42A);
    expect(out).toContain("Islam manakah yang paling utama?");
    // The regression this pins: quote-selection kept only the question.
    expect(out).toContain("selamat dari lidah dan tangannya");
  });

  it("drops a supplementary riwayah tacked on at the end", () => {
    const out = pick(MUSLIM_1554C);
    expect(out).toContain("bencana-bencana (jawa'ih)");
    expect(out).not.toContain("'Abdurrahman bin Bisyr");
    // The sentence it was severed from keeps its full stop.
    expect(out.trimEnd().endsWith(".")).toBe(true);
  });

  it("handles 'ard transmission ('aku membacakan kepada Malik')", () => {
    const out = pick(MUSLIM_1584A);
    expect(out).toContain("Janganlah kalian menjual emas dengan emas");
    expect(out).not.toContain("membacakan kepada Malik");
    expect(out).not.toContain("Nafi'");
  });

  it("strips the chain from a reported ACT with no quoted matn", () => {
    const out = pick(MUSLIM_894B);
    expect(out).toContain("keluar ke tempat shalat lalu beristisqa'");
    expect(out).not.toContain("'Abbad bin Tamim");
  });

  it("does not open on a dangling subordinating conjunction", () => {
    // "bahwa"/"bahwasanya" subordinate to a chain clause that is gone.
    for (const text of [MUSLIM_46, MUSLIM_1554C, MUSLIM_894B]) {
      expect(pick(text)).not.toMatch(/^(?:bahwa|bahwasanya)\b/i);
    }
  });
});

// ── Leading markdown headings ─────────────────────────────────────

describe("classic-kitab sections that open with a heading", () => {
  it("renders the teaching, not the heading plus an ellipsis", () => {
    const out = pick(KITAB_ARABIC_HEADING);
    expect(out).toContain("Bergaul dengan manusia dengan akhlak yang mulia");
  });

  it("drops the heading text entirely", () => {
    // The citation line under the card already names bab and fasal.
    const out = pick(KITAB_ARABIC_HEADING);
    expect(out).not.toContain("Nau' Kedelapan");
    // Both halves — the Arabic is what actually rendered on the card.
    expect(out).not.toContain("\u0627\u0644\u0646\u064e\u0651\u0648\u0652\u0639\u064f");
  });

  it("is not a stub — a heading fragment then an ellipsis", () => {
    const out = pick(KITAB_ARABIC_HEADING);
    const words = out.replace(/…/g, "").trim().split(/\s+/).filter(Boolean);
    expect(words.length).toBeGreaterThan(8);
  });

  it("keeps a MID-TEXT heading — only the LEADING one is dropped", () => {
    // Deliberately asymmetric. A leading heading duplicates the
    // citation line under the card, so it goes. An interior one sits
    // between two real paragraphs and its text is the only thing
    // separating them, so it stays and flows inline. Narrowing
    // _LEADING_HEADINGS_RE's `^` anchor away would silently delete it.
    const mid =
      "Ketahuilah bahwa lisan adalah anggota tubuh yang paling kuat memengaruhi dirimu, dan " +
      "tidaklah manusia ditelungkupkan ke dalam neraka melainkan karena buah lisannya.\n\n" +
      "## Bagian Kedua\n\nDan adapun dusta, maka ia termasuk dosa yang paling buruk.";
    const out = pick(mid);
    expect(out).toContain("Ketahuilah bahwa lisan");
    expect(out).toContain("Bagian Kedua");
    expect(out).toContain("Dan adapun dusta");
    // The `##` marker itself never survives into the card.
    expect(out).not.toContain("#");
  });

  it("a text that is ONLY headings does not render empty", () => {
    expect(pick("## Fasal\n\n### Bab Kedua\n")).not.toBe("");
  });
});

// ── Corpora with no isnad must be untouched ───────────────────────

describe("non-hadith corpora are left alone", () => {
  it("a Qur'an ayat renders verbatim", () => {
    expect(pick(QURAN_2_188)).toBe(QURAN_2_188);
  });

  it("an ayat legitimately opening with 'Dan' keeps it", () => {
    // "Dan" renders و. It is the ayat, not a dangling conjunction.
    expect(pick(QURAN_2_188).startsWith("Dan janganlah")).toBe(true);
  });

  it("prose mentioning a narrator mid-text is not truncated there", () => {
    const report =
      "Salim bin 'Abdullah meriwayatkan dari ayahnya, ia berkata: Aku melihat orang-orang pada " +
      "masa Rasulullah ﷺ membeli bahan makanan secara borongan, lalu mereka dihukum karena " +
      "menjualnya kembali di tempat itu sebelum memindahkannya ke kediaman mereka.";
    expect(pick(report)).toContain("Aku melihat orang-orang");
  });
});

// ── Budget + degenerate input ─────────────────────────────────────

describe("budget and degenerate input", () => {
  it("returns '' for null, undefined and empty daleel", () => {
    expect(pickDaleelTranslation(null, "id", {})).toBe("");
    expect(pickDaleelTranslation(undefined, "id", {})).toBe("");
    expect(pickDaleelTranslation({ translation_id: "" }, "id", {})).toBe("");
  });

  it("never exceeds the flyer budget by more than the cut threshold", () => {
    for (const text of [MUSLIM_103A, MUSLIM_46, MUSLIM_1554C, KITAB_ARABIC_HEADING]) {
      expect(pick(text).length).toBeLessThanOrEqual(600);
    }
  });

  it("marks a real truncation with an ellipsis", () => {
    const long = `${"Perkara ini menuntut kesungguhan dari setiap muslim. ".repeat(30)}`;
    const out = pick(long);
    expect(out.length).toBeLessThanOrEqual(600);
    expect(out).toContain("…");
  });

  it("falls back to English when there is no Indonesian translation", () => {
    const out = pickDaleelTranslation(
      { translation_id: null, translation_en: "Whoever cheats is not one of us." },
      "id",
      {},
    );
    expect(out).toContain("Whoever cheats");
  });
});
