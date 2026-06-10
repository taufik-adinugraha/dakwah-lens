"""Daleel-first flyer content generator.

Replaces slots 1-4 of the briefing's `## Pesan Flyer` section with
content generated in this order:
  1. Extract N distinct news anchors from the briefing's executive
     summary so each slot grips a different storyline.
  2. Per slot — pick THE best daleel from the flyer pool (anti-reuse
     vs other slots), LLM-evaluated for fit + clean truncation at
     clause / sanad boundaries. The picker — not a regex — decides
     where to cut.
  3. Per slot — write a ~70-word Indonesian paragraph that builds
     FROM the chosen daleel toward the assigned news anchor.
  4. Per slot — write a ≤6-word Title Case headline that captures
     the bridge between the daleel and the news anchor.

The pipeline is gated by `settings.flyer_daleel_first_enabled` in
`briefing.py`; when off, the briefing's single-Gemini-call flyer
generation runs unchanged.

Slots 5-6 (Sunnah invitation + Du'a hero — both inline du'a flyers
with a different shape) are NOT touched by this generator. The
section-replace helper preserves them as-is when present.

Cost: ~13 Gemini 2.5 Pro calls per briefing (1 anchor extract + 4
slots × 3 LLM steps each). At ~$0.005/call → ~$0.07/briefing on top
of the briefing's own ~$0.06. Across 14 theme groups per weekly
batch ≈ ~$1/week ≈ Rp 65K/month. Inside the IDR 1.5-2M LLM budget.

Promoted 2026-06-10 from `api/scripts/poc_daleel_first.py` after
v4 of the POC consistently matched-or-beat the in-prompt generator
across two test briefings (Hukum & Keadilan, Patologi Sosial Digital).
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

import structlog
from google import genai
from google.genai import types

from api.config import settings
from api.services.kitab_retrieval import FLYER_ALLOWED_CORPORA

log = structlog.get_logger()

MODEL = "gemini-2.5-pro"


# Slot personas — mirror the four prose-flyer voices in the briefing
# prompt. Slot indices below are 0-based; the markdown emits the
# 1-based "Pesan Flyer N" headings.
SLOT_PERSONAS: list[dict[str, str]] = [
    {
        "id": "khutbah",
        "label": "Suara Khutbah",
        "section_title": "Suara Khutbah",
        "voice": (
            "Suara khateeb formal — Jumat / muhadarah resmi. Bahasa "
            "tertib, kalimat lengkap, sentuhan tematik tegas tapi tidak "
            "menggurui. Tidak slang, tidak emoji."
        ),
        "handle_pattern": (
            "Refleksi diri yang SPESIFIK — pertanyaan introspektif tentang "
            "amanah konkret yang dipikul pembaca (anak, jabatan kerja, "
            "kelas yang diajar, keluarga yang dinafkahi). Bukan 'periksa "
            "diri kita' yang abstrak, tapi 'periksa apakah jam kerja yang "
            "kita tagihkan bulan ini benar-benar produktif untuk pemberi "
            "amanah'."
        ),
    },
    {
        "id": "aksi",
        "label": "Suara Aksi Sosial",
        "section_title": "Suara Aksi Sosial",
        "voice": (
            "Suara campaign sosial — mendorong tindakan nyata. Aktif, "
            "memanggil pembaca dengan 'kita', bukan 'mereka'. Konkret, "
            "mengundang langkah pertama yang bisa dilakukan pekan ini."
        ),
        "handle_pattern": (
            "Tindakan TERUKUR yang menyebut PERAN + VENUE + TIMEFRAME. "
            "Contoh shape: 'Datangi rapat RT pekan ini dan minta laporan "
            "iuran sampah Q2 sebelum berakhir bulan'; 'Bentuk grup WA "
            "warga blok untuk track laporan kerusakan jalan, evaluasi 30 "
            "hari ke depan'; 'Minta takmir masjid publish ringkasan kas "
            "infaq Jumat depan'. JANGAN tulis 'tanyakan transparansi' / "
            "'dukung keadilan' / 'mulai dari lingkungan terdekat' — "
            "abstraksi seperti itu DILARANG untuk voice ini. Sebut PERAN "
            "(takmir / pengurus RT / ortu / guru), VENUE (masjid / kelas "
            "/ kantor / rapat warga), dan TIMEFRAME (pekan ini / 30 hari / "
            "sebelum Jumat depan)."
        ),
    },
    {
        "id": "kreator",
        "label": "Suara Kreator Konten",
        "section_title": "Kreator Konten",
        "voice": (
            "Suara content-creator dakwah Instagram/TikTok — opening hook "
            "tajam dalam 1 kalimat, lalu pengembangan reflektif. Boleh "
            "kalimat pendek-pendek untuk ritme. Tidak slang gaul, tapi "
            "lebih lincah dari khutbah formal."
        ),
        "handle_pattern": (
            "Pertanyaan reflektif yang punya 'hook' — bukan generic "
            "'sudahkah kita merenungi', tapi sesuatu yang bikin pembaca "
            "berhenti scroll. Contoh: 'Berapa kali bulan ini kita ambil "
            "sesuatu yang bukan hak — bahkan sekecil pulpen kantor?', "
            "'Kalau hidden camera ngerekam keputusan kerja kita hari ini, "
            "berani diputar di hari kiamat?'"
        ),
    },
    {
        "id": "genz",
        "label": "Suara Gen Z",
        "section_title": "Gen Z",
        "voice": (
            "Suara dakwah Gen Z — bahasa anak muda Indonesia kontemporer "
            "yang masih sopan (bukan vulgar). 'Aku' / 'kalian', bukan 'kami' / "
            "'antum'. Boleh pakai istilah pop ('FOMO', 'overthinking', "
            "'safe space') asalkan tetap thoughtful, bukan cringe."
        ),
        "handle_pattern": (
            "Refleksi sehari-hari pakai konteks Gen Z (kerja kelompok, "
            "magang, side-hustle, organisasi mahasiswa, group chat). "
            "Contoh: 'Pas tugas kelompok, ada gak temen yang kerjanya "
            "kita ambil credit-nya? Itu juga zalim, walaupun kecil.', "
            "'Di freelance / side hustle, sudah kita hitung yang fair "
            "buat klien — atau diam-diam markup waktu kerja?'"
        ),
    },
]


@dataclass
class DaleelEntry:
    """Normalized pool entry. Indexed back to the source `daleel_refs`
    dict via `source_index` so we can mutate the entry's `arabic` /
    `translation` fields in-place once the picker truncates."""

    source_index: int
    corpus: str
    citation: str
    arabic: str
    translation: str
    ref_id: str | None


def _coerce_pool(raw: list[dict[str, Any]] | None) -> list[DaleelEntry]:
    """Whitelist-filter + normalize. Tolerant of `translation` vs
    `translation_id` field-name drift across briefing-era schema
    changes."""
    out: list[DaleelEntry] = []
    for i, d in enumerate(raw or []):
        if not isinstance(d, dict):
            continue
        corpus = str(d.get("corpus") or "")
        if corpus not in FLYER_ALLOWED_CORPORA:
            continue
        citation = str(d.get("citation") or "").strip()
        arabic = str(d.get("arabic") or "").strip()
        translation = str(
            d.get("translation")
            or d.get("translation_id")
            or d.get("translation_en")
            or ""
        ).strip()
        if not citation or not translation:
            continue
        out.append(
            DaleelEntry(
                source_index=i,
                corpus=corpus,
                citation=citation,
                arabic=arabic,
                translation=translation,
                ref_id=str(d.get("ref_id") or "") or None,
            )
        )
    return out


# ── Topic + flyer-section extraction from the briefing markdown ──────


_RINGKASAN_RE = re.compile(
    r"^##\s+(?:ringkasan\s+eksekutif|executive\s+summary)\b",
    re.IGNORECASE | re.MULTILINE,
)
_FLYER_SECTION_RE = re.compile(
    r"^##\s+(?:pesan\s+flyer|flyer\s+messages)\b", re.IGNORECASE | re.MULTILINE
)
_FLYER_SUB_RE = re.compile(
    r"^###\s+(?:pesan\s+flyer|flyer\s+message)\s*(\d)[^\n]*$",
    re.IGNORECASE | re.MULTILINE,
)


def extract_topic_context(summary_md: str) -> str:
    """Pull the Ringkasan Eksekutif section as topic context. Falls
    back to the first ~1.2K chars when no heading match (older
    briefing format)."""
    m = _RINGKASAN_RE.search(summary_md or "")
    if not m:
        return (summary_md or "")[:1200].strip()
    start = m.end()
    rest = summary_md[start:]
    next_h2 = re.search(r"^##\s+", rest, flags=re.MULTILINE)
    section = rest[: next_h2.start()] if next_h2 else rest
    return section.strip()[:1200]


def _section_bounds(summary_md: str) -> tuple[int, int] | None:
    """Return (start, end) char offsets of the `## Pesan Flyer`
    section's body (NOT including the H2 line itself). end-of-section
    is the next H2 (or EOF). None when the section isn't present."""
    m = _FLYER_SECTION_RE.search(summary_md or "")
    if not m:
        return None
    section_start = m.end()
    rest = summary_md[section_start:]
    next_h2 = re.search(r"^##\s+", rest, flags=re.MULTILINE)
    section_end = section_start + (next_h2.start() if next_h2 else len(rest))
    return section_start, section_end


def _slot_blocks(section_md: str) -> dict[int, str]:
    """Slice the flyer section's body into 1-based slot → block-text.
    Slot N's block is the lines BETWEEN `### Pesan Flyer N` and the
    next H3 (or section end)."""
    blocks: dict[int, str] = {}
    matches = list(_FLYER_SUB_RE.finditer(section_md))
    for i, mm in enumerate(matches):
        idx = int(mm.group(1))
        body_start = mm.end()
        body_end = matches[i + 1].start() if i + 1 < len(matches) else len(section_md)
        blocks[idx] = section_md[body_start:body_end].strip()
    return blocks


# ── LLM client + the 3 pipeline steps ────────────────────────────────


_client: genai.Client | None = None


def _get_client() -> genai.Client:
    if not settings.gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY is not set; cannot run flyer_content")
    global _client
    if _client is None:
        _client = genai.Client(api_key=settings.gemini_api_key)
    return _client


_ANCHORS_SCHEMA = {
    "type": "object",
    "properties": {
        "anchors": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "label": {"type": "string"},
                    "detail": {"type": "string"},
                },
                "required": ["label", "detail"],
            },
        },
    },
    "required": ["anchors"],
}


def _llm_extract_anchors(
    client: genai.Client, topic_context: str, n: int
) -> list[dict[str, str]]:
    prompt = f"""Briefing dakwah pekan ini menyangkut beberapa storyline berbeda. Ekstrak {n} ANCHOR BERITA yang DISTINCT (saling berbeda) dari konteks di bawah. Setiap anchor harus:

1. Merujuk ke SATU storyline spesifik — nama orang / nama kasus / angka / lokasi yang berbeda dari anchor lain.
2. Cukup self-contained sehingga seorang penulis flyer bisa membuka paragraf dengannya tanpa konteks tambahan.
3. Pilih {n} storyline yang paling KAYA (paling konkret + paling potensi-renungan), bukan ringkasan paling umum.
4. Kalau briefing hanya punya satu storyline besar (jarang), bagi dari ANGLE yang berbeda (mis. dampak korban vs respons institusi vs preseden historis vs perilaku rakyat sehari-hari).

Return JSON: anchors (list of {n} objects). Setiap object:
- label: nama pendek storyline ("Suap WNA Silmy Karim", "Korupsi MBG Dadan", dst) — ≤ 6 kata
- detail: 1-2 kalimat yang menggambarkan storyline + nama+angka spesifiknya. Pakai bahasa Indonesia.

BRIEFING TOPIC:
{topic_context}
"""
    resp = client.models.generate_content(
        model=MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            temperature=0.3,
            response_mime_type="application/json",
            response_schema=_ANCHORS_SCHEMA,
        ),
    )
    data = json.loads(resp.text or "{}")
    anchors = data.get("anchors", [])
    while len(anchors) < n:
        # Defensive — pad with the topic itself so downstream slots
        # still have *something* to grip on a malformed extract.
        anchors.append({"label": "Konteks pekan ini", "detail": topic_context[:300]})
    return anchors[:n]


_PICK_SCHEMA = {
    "type": "object",
    "properties": {
        "pick_index": {"type": "integer"},
        "rationale": {"type": "string"},
        "truncated_arabic": {"type": "string"},
        "truncated_translation": {"type": "string"},
        "truncation_note": {"type": "string"},
    },
    "required": [
        "pick_index",
        "rationale",
        "truncated_arabic",
        "truncated_translation",
        "truncation_note",
    ],
}


@dataclass
class PickResult:
    index: int  # index into the candidate `pool` list
    rationale: str
    arabic: str  # final rendered Arabic (truncated when needed)
    translation: str  # final rendered ID translation
    truncation_note: str


def _format_pool(pool: list[DaleelEntry]) -> str:
    lines = []
    for i, d in enumerate(pool):
        lines.append(
            f"[{i}] {d.citation}\n"
            f"    AR ({len(d.arabic)}ch): {d.arabic}\n"
            f"    ID ({len(d.translation)}ch): {d.translation}"
        )
    return "\n\n".join(lines)


def _llm_pick_daleel(
    client: genai.Client,
    pool: list[DaleelEntry],
    topic_context: str,
    slot_persona: dict[str, str],
    used_picks: list[tuple[str, str]],
) -> PickResult:
    used_block = ""
    if used_picks:
        used_lines = "\n".join(
            f"  - [{cit}] sudah dipakai di flyer: {slot}" for cit, slot in used_picks
        )
        used_block = (
            "\nSUDAH DIPAKAI DI FLYER LAIN (HINDARI mengulang kecuali "
            "TIDAK ADA kandidat lain yang cocok untuk voice ini):\n"
            + used_lines
            + "\n"
        )
    prompt = f"""Anda memilih SATU daleel untuk satu flyer dakwah Indonesia (1080×1080).

BRIEFING TOPIC (konteks pekan ini):
{topic_context}

VOICE FLYER INI ({slot_persona["label"]}):
{slot_persona["voice"]}
{used_block}
KANDIDAT DALEEL (semua dari 7-kitab whitelist flyer; pilih INDEKS terbaik):
{_format_pool(pool)}

KRITERIA pilih:
1. JEMBATAN TEMATIK NYATA: kandidat memberi PELAJARAN yang bisa langsung diaplikasikan ke konteks pekan ini. Bukan sekadar overlap kata kunci. Tanyakan: "Apakah seorang da'i bisa preach DARI daleel ini KE topik pekan ini tanpa memaksakan?"
2. STAND-ALONE: daleel ini, lepas dari paragraf, masih jelas relevan ke topik. Bukan yang butuh dijelaskan panjang baru nyambung.
3. PULL-QUOTE FORMAT: kalimatnya self-contained, bukan potongan rantai narasi panjang ("ḥaddatsanā fulān… 'an fulān…"). Kalau ada rantai narator di depan, kita boleh memotong rantai (lihat aturan TRUNCATION di bawah).
4. VOICE-FIT: daleel cocok dengan voice flyer ini — khateeb formal beda dari Gen Z, dst.
5. ANTI-REPETITION: lihat daftar SUDAH DIPAKAI DI FLYER LAIN di atas. Kalau salah satunya muncul di daftar itu, JANGAN dipilih kecuali tidak ada kandidat lain yang sebanding untuk voice ini. Audience yang sama akan baca keempat flyer berdampingan — semua sama = malas.

TRUNCATION (PENTING, bukan rule-based, ANDA yang putuskan):
Flyer 1080×1080 hanya muat ~3-4 baris terjemahan + ~3 baris Arab dengan font yang masih terbaca di phone. Target nyaman: terjemahan ID ≤ 240 karakter, Arab ≤ 200 karakter. Kandidat yang AR atau ID-nya lebih panjang masih BISA dipakai KALAU bisa dipotong dengan bersih.

Aturan truncation:
- Potong di BATAS KLAUSA / KALIMAT — jangan tengah kata, jangan tengah idhafa Arab.
- Untuk hadits dengan rantai sanad ("ḥaddatsanā fulān… qāla qāla rasūlullah ﷺ…" / "Dari Abu Hurairah, dari Rasulullah ﷺ, beliau bersabda..."): potong rantai sanad, langsung ke matan (isi sabda). Itu SAH dan justru disarankan.
- Untuk ayat panjang yang punya beberapa ide independen: potong di pemisah kalimat yang logis. Tetap menjaga makna lengkap.
- KALAU sudah ≤ target, kembalikan string asli tanpa perubahan.
- KALAU tidak bisa dipotong tanpa merusak makna, JANGAN pilih kandidat itu — pilih yang lain.
- ID terjemahan harus tetap diakhiri dengan tanda baca yang wajar (titik / tanda seru).
- Arab harus tetap utuh sebagai unit makna (tidak boleh memotong di tengah kalimat Arab kecuali ada koma / waqf alami).

Return JSON:
- pick_index (int, 0-based)
- rationale (1 kalimat menjelaskan jembatan ke topik pekan ini)
- truncated_arabic (string — yang final yang akan dirender; kosong "" kalau pakai aslinya tidak perlu)
- truncated_translation (string — yang final yang akan dirender; kosong "" kalau aslinya cukup)
- truncation_note ("fits" kalau tidak perlu dipotong, atau 1 kalimat menjelaskan apa yang dipotong dan kenapa)
"""
    resp = client.models.generate_content(
        model=MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            temperature=0.2,
            response_mime_type="application/json",
            response_schema=_PICK_SCHEMA,
        ),
    )
    data = json.loads(resp.text or "{}")
    idx = int(data.get("pick_index", 0))
    idx = max(0, min(idx, len(pool) - 1))
    chosen = pool[idx]
    trunc_ar = str(data.get("truncated_arabic", "")).strip()
    trunc_id = str(data.get("truncated_translation", "")).strip()
    return PickResult(
        index=idx,
        rationale=str(data.get("rationale", "")).strip(),
        arabic=trunc_ar or chosen.arabic,
        translation=trunc_id or chosen.translation,
        truncation_note=str(data.get("truncation_note", "")).strip(),
    )


def _llm_write_message(
    client: genai.Client,
    daleel: DaleelEntry,
    rendered_translation: str,
    topic_context: str,
    slot_persona: dict[str, str],
    anchor: dict[str, str],
) -> str:
    prompt = f"""Tulis satu paragraf flyer dakwah (1080×1080, voice di bawah). Daleel sudah dipilih dan akan dirender visual di flyer — JANGAN sebut Arab atau citation di dalam paragraf.

VOICE FLYER ({slot_persona["label"]}):
{slot_persona["voice"]}

POLA HANDLE UNTUK VOICE INI (kalimat penutup paragraf harus mengikuti pola ini):
{slot_persona["handle_pattern"]}

DALEEL ANKER (yang akan tampil bersama paragraf ini):
- Citation: {daleel.citation}
- Terjemahan (yang akan dirender): "{rendered_translation}"
- (Arab tersedia di render visual)

ANCHOR BERITA UNTUK FLYER INI:
{anchor["label"]} — {anchor["detail"]}

BRIEFING TOPIC LENGKAP (referensi tambahan, voice-tone ide):
{topic_context}

PEDOMAN paragraf:
1. KALIMAT PEMBUKA grip anchor di atas — sebut nama / angka / kasus spesifik dari "ANCHOR BERITA" tadi. Cocokkan dengan voice (Gen Z buka beda dari khateeb).
2. Jembatan ke PELAJARAN daleel — gali makna daleel-nya, hubungkan ke situasi anchor. Boleh pakai analogi, idiom sehari-hari, atau frasa khas voice ("trust issue", "sistem busuk percuma" — kalau cocok dengan voice). Voice yang punya idiom natural — kembangkan secara natural, jangan diratakan.
3. Handle praktis — ikuti POLA HANDLE di atas. PENTING: ikuti pola spesifik voice ini, jangan generic. Khusus untuk Aksi Sosial: kalimat handle WAJIB menyebut PERAN + VENUE + TIMEFRAME konkret. Generic "mari mulai dari lingkungan terdekat" / "tanyakan transparansi" tanpa detail = FAIL.

OPENING YANG DIHINDARI — frase abstrak generic kayak "banjir berita korupsi", "rentetan kasus", "maraknya...", "fenomena...", "berita-berita yang kita lihat", "di tengah hiruk-pikuk" — kalau anchor di atas punya nama/angka spesifik, PAKAI itu, bukan generic abstraction. Tapi kalau anchor mengandung satu nama spesifik yang sama dengan flyer lain, ANGLE-nya yang dibedakan (mis. dampak korban vs respons institusi).

JANGAN MENGUTIP COUNTER ANALITIK — flyer adalah surface DAKWAH, bukan dashboard data. JANGAN sebut angka post count internal dari radar kita: "Pekan ini 82 postingan tentang...", "X juta view", "Y ribu view", "Z cerita di feed", "naik X% dari baseline", "menembus N juta view". Angka analitik (volume postingan, view count, engagement %) adalah konteks operator, bukan konten flyer. Ganti dengan deskripsi kualitatif: "Pekan ini ramai diskusi tentang...", "Pekan ini muncul kasus...", "banyak cerita pribadi". Boleh sebut angka yang merupakan FAKTA dari berita itu sendiri (Rp 145 miliar nilai kasus, 19 unit kendaraan disita, gaji Rp 400 ribu) — tapi BUKAN angka dari analitik internal kita.

ATURAN:
- BAHASA INDONESIA 100% — tidak ada Arab, tidak ada potongan ayat/hadits dikutip langsung, tidak ada marker citation.
- Panjang TARGET ~70 kata. Lebih boleh kalau memang butuh untuk narasi (cap ~90 kata). Jangan ngotot 70 kalau bikin paragraf jadi terpotong.
- Tidak ada frase "Allah berfirman" / "Rasulullah bersabda" + kutipan — daleel sudah dirender visual.
- Cocok dengan voice. Khutbah ≠ Gen Z ≠ kreator ≠ aksi — perbedaan harus terasa.

Tulis SAJA paragraphnya — tanpa pembuka "Berikut paragraf:", tanpa quote marks, tanpa label.
"""
    resp = client.models.generate_content(
        model=MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(temperature=0.7),
    )
    return (resp.text or "").strip()


def _llm_write_title(
    client: genai.Client,
    daleel: DaleelEntry,
    rendered_translation: str,
    message: str,
    slot_persona: dict[str, str],
) -> str:
    prompt = f"""Tulis SATU judul flyer (≤6 kata) untuk paragraf di bawah.

VOICE ({slot_persona["label"]}):
{slot_persona["voice"]}

DALEEL ANKER: {daleel.citation} — "{rendered_translation}"

PARAGRAF FLYER:
{message}

ATURAN WAJIB:
- ≤6 kata. Tegas, mudah dibaca <1 detik.
- Menangkap JEMBATAN antara topik pekan ini dan pelajaran daleel — bukan kutip ulang ayat/hadits secara harfiah.
- Tidak ada em-dash, tidak ada sub-judul, tidak ada quote marks.
- Tidak ada "Allah Ta'ala" / "Rasulullah ﷺ" / nama surah di judul (itu sudah di kartu daleel).
- Voice match: khutbah formal vs Gen Z punya register beda.
- KAPITALISASI: Title Case — kapitalkan huruf pertama tiap kata penting (kata sambung pendek seperti "dan", "di", "ke", "yang" boleh lowercase). JANGAN all-lowercase. JANGAN ALL CAPS.
- TIDAK ADA TITIK di akhir judul. Tanda tanya (?) boleh kalau memang kalimat tanya.

Return SAJA judulnya — satu baris, tanpa label, tanpa quote.
"""
    resp = client.models.generate_content(
        model=MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(temperature=0.4),
    )
    title = (resp.text or "").strip().strip("\"'`“”‘’").rstrip(".")
    return re.sub(r"\s+", " ", title)


# ── Orchestrator + markdown rewriter ─────────────────────────────────


@dataclass
class FlyerSlotResult:
    """One slot's regenerated content. Slot is 1-based to match the
    `### Pesan Flyer N` headings in the briefing markdown."""

    slot: int
    persona: dict[str, str]
    title: str
    daleel_citation: str
    rendered_arabic: str
    rendered_translation: str
    body: str
    anchor: dict[str, str]
    picker_rationale: str
    truncation_note: str
    daleel_source_index: int  # index in the original daleel_refs


def _emit_slot_md(result: FlyerSlotResult) -> str:
    """Format one slot's content as the markdown block the existing
    flyer renderer expects (Headline + Daleel markers, then body)."""
    return (
        f"### Pesan Flyer {result.slot} — {result.persona['section_title']}\n"
        f"**Headline:** {result.title}\n"
        f"**Daleel:** {result.daleel_citation}\n\n"
        f"{result.body}\n"
    )


def regenerate_flyer_messages(
    summary_md: str,
    daleel_refs: list[dict[str, Any]] | None,
    *,
    n_slots: int = 4,
) -> tuple[str, list[dict[str, Any]], list[FlyerSlotResult]]:
    """Run the daleel-first pipeline against an already-generated
    briefing. Returns (rewritten_md, mutated_daleel_refs, per_slot_results).

    The mutation on daleel_refs: for each picked slot, the source
    pool entry's `arabic` + `translation` (+ `translation_id`) fields
    are overwritten with the picker-truncated text so the flyer
    renderer downstream displays the picker's chosen length without
    needing markdown-marker plumbing on the web side.

    Slots 5-6 (inline du'a flyers) are PRESERVED untouched if they
    exist in the source markdown — we only replace the H3 blocks for
    slots 1..n_slots. If the source markdown has no `## Pesan Flyer`
    section at all (older briefing format), we return everything
    unchanged + an empty results list.
    """
    bounds = _section_bounds(summary_md or "")
    if bounds is None:
        log.warning("flyer_content.no_section", reason="no_pesan_flyer_h2")
        return summary_md, daleel_refs or [], []

    pool = _coerce_pool(daleel_refs)
    if not pool:
        log.warning("flyer_content.empty_pool", raw_count=len(daleel_refs or []))
        return summary_md, daleel_refs or [], []

    topic_context = extract_topic_context(summary_md)
    client = _get_client()
    anchors = _llm_extract_anchors(client, topic_context, n_slots)

    # Run all N slots; keep track of (citation, label) for anti-reuse
    # and a (slot → FlyerSlotResult) map for the markdown rewrite step.
    used_picks: list[tuple[str, str]] = []
    per_slot: dict[int, FlyerSlotResult] = {}
    mutated_refs = list(daleel_refs or [])
    for i in range(n_slots):
        persona = SLOT_PERSONAS[i]
        anchor = anchors[i]
        try:
            pick = _llm_pick_daleel(client, pool, topic_context, persona, used_picks)
        except Exception as exc:  # noqa: BLE001 — best-effort per slot
            log.warning(
                "flyer_content.pick_failed", slot=i + 1, error=str(exc)
            )
            continue
        winner = pool[pick.index]
        used_picks.append((winner.citation, persona["label"]))
        try:
            message = _llm_write_message(
                client, winner, pick.translation, topic_context, persona, anchor
            )
            title = _llm_write_title(
                client, winner, pick.translation, message, persona
            )
        except Exception as exc:  # noqa: BLE001
            log.warning(
                "flyer_content.write_failed", slot=i + 1, error=str(exc)
            )
            continue

        # Mutate the corresponding source pool entry so the renderer
        # picks up the truncated arabic + translation when it looks up
        # the citation. Touch all three fieldname variants the renderer
        # might read, so we don't depend on schema-drift assumptions.
        if 0 <= winner.source_index < len(mutated_refs):
            src = mutated_refs[winner.source_index]
            if isinstance(src, dict):
                src = dict(src)  # don't mutate the input dict aliased outside
                src["arabic"] = pick.arabic
                src["translation"] = pick.translation
                src["translation_id"] = pick.translation
                mutated_refs[winner.source_index] = src

        per_slot[i + 1] = FlyerSlotResult(
            slot=i + 1,
            persona=persona,
            title=title,
            daleel_citation=winner.citation,
            rendered_arabic=pick.arabic,
            rendered_translation=pick.translation,
            body=message,
            anchor=anchor,
            picker_rationale=pick.rationale,
            truncation_note=pick.truncation_note,
            daleel_source_index=winner.source_index,
        )

    if not per_slot:
        log.warning("flyer_content.no_slots_succeeded")
        return summary_md, daleel_refs or [], []

    # Rewrite slots 1..n_slots inside the section, preserve any
    # higher-numbered slots (5-6, inline du'a) intact.
    section_start, section_end = bounds
    section_body = summary_md[section_start:section_end]
    existing_blocks = _slot_blocks(section_body)

    new_blocks: list[str] = []
    for slot in range(1, n_slots + 1):
        if slot in per_slot:
            new_blocks.append(_emit_slot_md(per_slot[slot]))
        elif slot in existing_blocks:
            # The slot existed in source but our generator failed —
            # preserve original markdown for it so we don't drop a
            # whole slot from the rendered flyer set.
            new_blocks.append(
                f"### Pesan Flyer {slot}\n{existing_blocks[slot]}\n"
            )
    # Preserve inline-du'a slots (5-6 typically) untouched.
    for slot in sorted(existing_blocks.keys()):
        if slot <= n_slots:
            continue
        new_blocks.append(f"### Pesan Flyer {slot}\n{existing_blocks[slot]}\n")

    new_section_body = "\n".join(new_blocks).rstrip() + "\n"
    rewritten_md = (
        summary_md[:section_start].rstrip()
        + "\n\n"
        + new_section_body
        + summary_md[section_end:]
    )

    log.info(
        "flyer_content.rewrote_section",
        slots_done=sorted(per_slot.keys()),
        slots_preserved=[s for s in existing_blocks if s > n_slots],
        pool_size=len(pool),
    )
    return rewritten_md, mutated_refs, list(per_slot.values())
