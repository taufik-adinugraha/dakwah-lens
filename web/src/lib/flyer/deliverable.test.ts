/**
 * Per-deliverable flyer cards (/api/briefings/{slug}/flyer/{deliverable}).
 *
 * 2026-10-08: across that week's 13 briefings, 64 of 78 cards had no
 * headline and the khutbah card used a citation ("Tafsir Ibn Kathir on
 * 33:56") — the extractors targeted Gemini-era markers current briefings
 * don't carry. Every deliverable H3 carries `— "<title>"` (required since
 * 2026-06-18), so that is the headline source; section matchers test only
 * the H3 NAME so a title word cannot hijack another slot.
 */
import { describe, expect, it } from "vitest";

import { extractDeliverableHeadline, extractDeliverableMessage } from "./content";

const BRIEF = `## Strategi & Aksi Dakwah

### Khutbah Jumat — "Cinta Nabi yang Menenangkan Tetangga"

#### Khutbah Pertama

Hadits ini menautkan tiga hal sekaligus: surga, iman, dan cinta di antara sesama. Lalu Rasulullah ﷺ menunjukkan pintunya.

**Tafsir Ibn Kathir on 33:56**

Maka marilah pekan ini kita wujudkan dalam enam langkah yang konkret:

1. **Hidupkan shalawat dalam keseharian.** Setiap kali adzan berkumandang, jawablah muadzin.
2. **Rancang peringatan yang menenangkan tetangga.** Umumkan jadwal kepada rumah terdekat.
3. **Jadikan berbagi sebagai inti perayaan.** Sisihkan sebagian hidangan.
4. **Sebarkan salam.** Ucapkan salam lebih dahulu.

#### Khutbah Kedua

1. **Langkah di khutbah kedua.** Tidak boleh terambil.

### Kultum — "Iman yang Diukur di Rumah Sendiri"

Isi kultum yang panjang tentang rumah tangga dan akhlak kepada pasangan, cukup panjang untuk lolos filter delapan puluh karakter.

### Kreator Konten Digital — "Judul Video Perang Bukan Berita"

**Hook (0-5 detik):** "Feed kamu penuh beginian minggu ini?"

**Body (5-60 detik):** "Jujur aja, judul video itu belum tentu berita. Itu klaim yang perlu dicek dulu sebelum dibagikan ke grup keluarga."

### Pengajaran di Rumah — "Berani Bercerita, Tidak Ikut Merundung"

**Tujuan sesi.** Menanamkan tiga sikap kepada anak: tidak merundung, berani bercerita bila ada yang dirundung, dan menyalurkan kepedulian ke pihak yang tepat.
`;

describe("deliverable headlines come from the H3 theme title", () => {
  it("khutbah uses its title, never a bold citation", () => {
    expect(extractDeliverableHeadline(BRIEF, "khutbah")).toBe("Cinta Nabi yang Menenangkan Tetangga");
  });

  it("a Kultum title containing 'Rumah' does not hijack the home slot", () => {
    expect(extractDeliverableHeadline(BRIEF, "home")).toBe("Berani Bercerita, Tidak Ikut Merundung");
  });

  it("content uses the Kreator title", () => {
    expect(extractDeliverableHeadline(BRIEF, "content")).toBe("Judul Video Perang Bukan Berita");
  });

  it("keeps the title's own punctuation", () => {
    const md = `### Khutbah Jumat — "Jangan Berhenti di Kata 'Andai'"\n\nisi`;
    expect(extractDeliverableHeadline(md, "khutbah")).toBe("Jangan Berhenti di Kata 'Andai'");
  });
});

describe("deliverable messages", () => {
  it("khutbah message = the first-sermon step titles, not a mid-sentence fragment", () => {
    const m = extractDeliverableMessage(BRIEF, "khutbah");
    expect(m).toMatch(/^Hidupkan shalawat dalam keseharian\./);
    expect(m).not.toMatch(/^surga, iman/);
    expect(m).not.toContain("khutbah kedua");
  });

  it("content message reads `**Body (… detik):**`", () => {
    expect(extractDeliverableMessage(BRIEF, "content")).toMatch(/^Jujur aja, judul video itu belum tentu berita/);
  });

  it("home message drops the 'Tujuan sesi.' label", () => {
    const m = extractDeliverableMessage(BRIEF, "home");
    expect(m).toMatch(/^Menanamkan tiga sikap kepada anak/);
    expect(m).not.toMatch(/^Tujuan sesi/i);
  });
});
