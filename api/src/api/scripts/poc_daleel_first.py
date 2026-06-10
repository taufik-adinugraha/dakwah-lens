"""POC: daleel-first flyer content generation.

Tests the user's hypothesis (2026-06-10) that title-message-daleel
coupling will tighten if we INVERT the current generation order. The
existing pipeline generates per-flyer message+title freely and tags a
daleel from the pool at the end — which the 2026-06-07 audit caught
silently mismatching ~55% of the time. The new flow:

  1. Filter the briefing's flyer daleel pool to (a) the 7-kitab
     whitelist (already done at briefing-gen time, kept here for
     defensive completeness) and (b) the hard length caps the renderer
     enforces (≤240ch translation, ≤200ch Arabic).
  2. LLM step 1 — given (briefing topic, slot persona), pick THE best
     daleel from the filtered pool. Returns index + 1-line rationale.
  3. LLM step 2 — given the WINNING daleel, write a 75-word ID
     paragraph that builds FROM the daleel's teaching toward this
     week's situation. Daleel anchors; message bridges.
  4. LLM step 3 — given (message, daleel), write a ≤6-word title that
     captures the bridge, not the daleel's literal words.

This script does NOT modify the briefing or anything in DB. It loads
an existing briefing, runs both flows (extracts the CURRENT flyer
content from summary_md + runs the NEW pipeline), and prints them
side-by-side so the operator can eyeball whether the daleel-first
output is genuinely tighter before we promote any of this to the
production briefing service.

Usage:
    uv run python -m api.scripts.poc_daleel_first --id <briefing-uuid>
    uv run python -m api.scripts.poc_daleel_first --id <uuid> --slots 0,1
    uv run python -m api.scripts.poc_daleel_first --id <uuid> --out /tmp/poc.md
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
from dataclasses import dataclass

import structlog
from google import genai
from google.genai import types
from sqlalchemy import select

from api.config import settings
from api.db import SessionLocal
from api.models.admin import Briefing
from api.services.kitab_retrieval import FLYER_ALLOWED_CORPORA

log = structlog.get_logger()

MODEL = "gemini-2.5-pro"


# ── Slot personas — mirror of the prompts in services/briefing.py for
# the four prose flyers. Slot 4/5 carry inline du'a content which the
# 3-step pipeline below isn't shaped for; we leave them to the existing
# flow for now.
SLOT_PERSONAS: list[dict[str, str]] = [
    {
        "id": "khutbah",
        "label": "Suara Khutbah (slot 1)",
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
        "label": "Suara Aksi Sosial (slot 2)",
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
        "label": "Suara Kreator Konten (slot 3)",
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
        "label": "Suara Gen Z (slot 4)",
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
    """One pool entry, normalized + with length flags pre-computed."""

    corpus: str
    citation: str
    arabic: str
    translation: str
    score: float | None
    ref_id: str | None

    @property
    def arabic_len(self) -> int:
        return len(self.arabic or "")

    @property
    def translation_len(self) -> int:
        return len(self.translation or "")

    @property
    def fits_flyer_strict(self) -> bool:
        """Old hard-cap rule (≤200ch Arabic, ≤240ch ID). Kept for stats —
        the audit showed almost every prod briefing's pool fails this
        across the board, so the strict-filter path is unusable. The
        LLM picker now evaluates fit + proposes a clean truncation."""
        return (
            self.arabic_len <= 200
            and self.translation_len <= 240
            and self.arabic_len > 0
            and self.translation_len > 0
        )

    @property
    def has_text(self) -> bool:
        return self.translation_len > 0


def _coerce_pool(raw: list[dict] | None) -> list[DaleelEntry]:
    """Normalize daleel_refs JSONB into DaleelEntry. Tolerant of the
    schema drift between briefings written in different prompt eras —
    some old rows used `translation_id`, newer ones use `translation`."""
    out: list[DaleelEntry] = []
    for d in raw or []:
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
                corpus=corpus,
                citation=citation,
                arabic=arabic,
                translation=translation,
                score=d.get("score"),
                ref_id=str(d.get("ref_id") or "") or None,
            )
        )
    return out


# ── Briefing topic + existing-flyer extraction from summary_md ────────


_RINGKASAN_RE = re.compile(
    r"^##\s+(?:ringkasan\s+eksekutif|executive\s+summary)\b",
    re.IGNORECASE | re.MULTILINE,
)


def extract_topic_context(summary_md: str) -> str:
    """Pull the first 800 chars of Ringkasan Eksekutif as the topic
    context. The full briefing would blow the LLM context budget for
    no real gain — the executive summary captures the week's story in
    a way that's already been distilled."""
    m = _RINGKASAN_RE.search(summary_md or "")
    if not m:
        return (summary_md or "")[:1200].strip()
    start = m.end()
    # Run until next H2 or EOF.
    rest = summary_md[start:]
    next_h2 = re.search(r"^##\s+", rest, flags=re.MULTILINE)
    section = rest[: next_h2.start()] if next_h2 else rest
    return section.strip()[:1200]


_FLYER_SUB_RE = re.compile(
    r"^###\s+(?:pesan\s+flyer|flyer\s+message)\s*(\d)\b.*$",
    re.IGNORECASE | re.MULTILINE,
)
_FLYER_SECTION_RE = re.compile(
    r"^##\s+(?:pesan\s+flyer|flyer\s+messages)\b", re.IGNORECASE | re.MULTILINE
)


def extract_existing_flyer(summary_md: str, slot: int) -> dict[str, str]:
    """Return {headline, daleel_citation, body} for slot N (1-indexed
    in the markdown; we pass 1-based here). Best-effort regex parse —
    if the briefing is older than 2026-05-23 the markers may be
    missing; we just return whatever we found."""
    sec_match = _FLYER_SECTION_RE.search(summary_md or "")
    if not sec_match:
        return {"headline": "", "daleel_citation": "", "body": ""}
    sec_start = sec_match.end()
    rest = summary_md[sec_start:]
    # Section runs until the next H2 or EOF.
    next_h2 = re.search(r"^##\s+", rest, flags=re.MULTILINE)
    section = rest[: next_h2.start()] if next_h2 else rest

    blocks: dict[int, str] = {}
    matches = list(_FLYER_SUB_RE.finditer(section))
    for i, m in enumerate(matches):
        idx = int(m.group(1))
        block_start = m.end()
        block_end = matches[i + 1].start() if i + 1 < len(matches) else len(section)
        blocks[idx] = section[block_start:block_end].strip()

    block = blocks.get(slot)
    if not block:
        return {"headline": "", "daleel_citation": "", "body": ""}

    headline_m = re.search(
        r"^\s*\*\*\s*(?:headline|judul|tema)\s*[:：]\s*\*\*\s*(.+?)\s*$",
        block,
        flags=re.IGNORECASE | re.MULTILINE,
    )
    daleel_m = re.search(
        r"^\s*\*\*\s*(?:daleel|dalil|citation)\s*[:：]\s*\*\*\s*(.+?)\s*$",
        block,
        flags=re.IGNORECASE | re.MULTILINE,
    )

    body = block
    if headline_m:
        body = body.replace(headline_m.group(0), "")
    if daleel_m:
        body = body.replace(daleel_m.group(0), "")

    return {
        "headline": (headline_m.group(1).strip() if headline_m else ""),
        "daleel_citation": (daleel_m.group(1).strip() if daleel_m else ""),
        "body": body.strip(),
    }


# ── LLM client + 3-step pipeline ──────────────────────────────────────


_client: genai.Client | None = None


def _get_client() -> genai.Client:
    if not settings.gemini_api_key:
        raise SystemExit("GEMINI_API_KEY is not set in .env")
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


def llm_extract_anchors(
    client: genai.Client,
    topic_context: str,
    n: int,
) -> list[dict[str, str]]:
    """Pull N distinct news anchors from the briefing topic. Each one
    is a SPECIFIC story (case + person/number/place) — so each slot's
    message step can grip a different storyline instead of all four
    landing on the same headline (v2's failure mode)."""
    prompt = f"""Briefing dakwah pekan ini menyangkut beberapa storyline berbeda. Ekstrak {n} ANCHOR BERITA yang DISTINCT (saling berbeda) dari konteks di bawah. Setiap anchor harus:

1. Merujuk ke SATU storyline spesifik — nama orang / nama kasus / angka / lokasi yang berbeda dari anchor lain.
2. Cukup self-contained sehingga seorang penulis flyer bisa membuka paragraf dengannya tanpa konteks tambahan.
3. Pilih {n} storyline yang paling KAYA (paling konkret + paling potensi-renungan), bukan ringkasan paling umum.
4. Kalau briefing hanya punya satu storyline besar (jarang), bagi dari ANGLE yang berbeda (mis. dampak korban vs respons institusi vs preseden historis vs perilaku rakyat sehari-hari).

Return JSON: anchors (list of {n} objects). Setiap object:
- label: nama pendek storyline ("Suap WNA Silmy Karim", "Korupsi MBG Dadan", "Kasus Solok Selatan", dst) — ≤ 6 kata
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
    # Defensive: pad with the topic context itself if the LLM returned
    # fewer anchors than slots (rare but possible on a very thin briefing).
    while len(anchors) < n:
        anchors.append({"label": "Konteks pekan ini", "detail": topic_context[:300]})
    return anchors[:n]


_PICK_SCHEMA = {
    "type": "object",
    "properties": {
        "pick_index": {"type": "integer"},
        "rationale": {"type": "string"},
        # If the chosen entry's Arabic or ID translation overflows the
        # ~200/240ch flyer caps, the picker must propose a CLEAN
        # truncation that ends at a sentence / clause boundary (not
        # mid-word, not mid-narrator-chain). Empty string when the
        # entry already fits.
        "truncated_arabic": {"type": "string"},
        "truncated_translation": {"type": "string"},
        # Why this needed truncation, or "fits" when it didn't.
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


def _format_pool(pool: list[DaleelEntry]) -> str:
    """One pool entry per line: `[i] citation — translation`. Arab is
    surfaced separately so the picker can see how much real estate
    each candidate will eat on the flyer."""
    lines = []
    for i, d in enumerate(pool):
        lines.append(
            f"[{i}] {d.citation}\n"
            f"    AR ({d.arabic_len}ch): {d.arabic}\n"
            f"    ID ({d.translation_len}ch): {d.translation}"
        )
    return "\n\n".join(lines)


@dataclass
class PickResult:
    index: int
    rationale: str
    arabic: str
    translation: str
    truncation_note: str


def llm_pick_daleel(
    client: genai.Client,
    pool: list[DaleelEntry],
    topic_context: str,
    slot_persona: dict[str, str],
    used_picks: list[tuple[str, str]],
) -> PickResult:
    """Step 1: pick THE best daleel + (when needed) propose a clean
    truncation. The picker — not a regex — decides where to cut, so
    we never end up with a mid-sanad chop or a translation cut at
    half a clause.

    `used_picks` is the list of (citation, slot_label) tuples already
    picked by earlier slots in this run, so the picker can avoid
    re-using the same daleel across the briefing's 4 flyers."""
    used_block = ""
    if used_picks:
        used_lines = "\n".join(
            f"  - [{cit}] sudah dipakai di flyer: {slot}"
            for cit, slot in used_picks
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


def llm_write_message(
    client: genai.Client,
    daleel: DaleelEntry,
    rendered_translation: str,
    topic_context: str,
    slot_persona: dict[str, str],
    anchor: dict[str, str],
) -> str:
    """Step 2: write the ~70-word ID paragraph FROM the daleel. The
    `rendered_translation` is the (possibly truncated) ID text the
    flyer will actually display — that's what the bridge has to
    serve, not the un-truncated original. The `anchor` is the
    specific news story this slot grips (different from other slots'
    anchors), so flyers in the same briefing don't all open with the
    same headline."""
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


def llm_write_title(
    client: genai.Client,
    daleel: DaleelEntry,
    rendered_translation: str,
    message: str,
    slot_persona: dict[str, str],
) -> str:
    """Step 3: write the ≤6-word headline."""
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
    title = (resp.text or "").strip()
    # Defensive: strip wrapping quotes / em-dashes / trailing period.
    # Model may add these despite the rules above; this is just a
    # cheap safety net, the prompt is the primary control.
    title = title.strip("\"'`“”‘’")
    title = title.rstrip(".")
    title = re.sub(r"\s+", " ", title)
    return title


# ── Orchestration ─────────────────────────────────────────────────────


async def load_briefing(*, id_: str) -> Briefing:
    async with SessionLocal() as session:
        row = (
            await session.execute(
                select(Briefing).where(Briefing.id == id_)
            )
        ).scalar_one_or_none()
        if row is None:
            raise SystemExit(f"briefing not found (id={id_})")
        return row


def render_comparison(
    *,
    slot_index: int,
    persona: dict[str, str],
    current: dict[str, str],
    new_daleel: DaleelEntry,
    new_arabic: str,
    new_translation: str,
    new_message: str,
    new_title: str,
    pick_rationale: str,
    truncation_note: str,
    pool_size: int,
) -> str:
    """Markdown side-by-side block for one slot."""
    lines: list[str] = []
    lines.append(f"### Slot {slot_index + 1} — {persona['label']}")
    lines.append("")
    lines.append(f"_pool size (flyer-corpora): {pool_size}_  ")
    lines.append(f"_picker rationale: {pick_rationale}_  ")
    lines.append(f"_truncation: {truncation_note}_  ")
    lines.append("")
    lines.append("**CURRENT (briefing-prompt extraction)**")
    lines.append(f"- Title: {current.get('headline') or '_(none)_'}")
    lines.append(
        f"- Daleel tag: {current.get('daleel_citation') or '_(none)_'}"
    )
    body_preview = (current.get("body") or "").strip()
    if body_preview:
        body_preview = body_preview[:600]
    lines.append(f"- Body: {body_preview or '_(none)_'}")
    lines.append("")
    lines.append("**NEW (daleel-first POC)**")
    lines.append(f"- Title: {new_title}")
    lines.append(
        f"- Daleel: {new_daleel.citation}  \n"
        f"  AR ({len(new_arabic)}ch): {new_arabic}  \n"
        f"  ID ({len(new_translation)}ch): {new_translation}"
    )
    lines.append(f"- Body ({len(new_message.split())} words): {new_message}")
    lines.append("")
    return "\n".join(lines)


def parse_slots_arg(raw: str | None) -> list[int]:
    """`--slots 0,2` → [0, 2]. Default all four."""
    if not raw:
        return [0, 1, 2, 3]
    out: list[int] = []
    for tok in raw.split(","):
        tok = tok.strip()
        if not tok:
            continue
        n = int(tok)
        if 0 <= n <= 3:
            out.append(n)
    return sorted(set(out)) or [0, 1, 2, 3]


async def main_async() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--id", dest="id_", required=True, help="briefing UUID")
    parser.add_argument(
        "--slots",
        dest="slots",
        help="comma-separated slot indices (0..3). Default: all four.",
    )
    parser.add_argument(
        "--out",
        dest="out",
        help="write the comparison report to this file instead of stdout.",
    )
    args = parser.parse_args()

    briefing = await load_briefing(id_=args.id_)
    pool_raw = briefing.daleel_refs or []
    pool = [d for d in _coerce_pool(pool_raw) if d.has_text]
    pool_fits_strict = sum(1 for d in pool if d.fits_flyer_strict)
    topic_context = extract_topic_context(briefing.summary_md or "")

    print(
        f"briefing: id={briefing.id} theme_group={briefing.theme_group} "
        f"period={briefing.period_start.date()}..{briefing.period_end.date()}",
        file=sys.stderr,
    )
    print(
        f"pool: {len(pool_raw)} raw → {len(pool)} flyer-corpora "
        f"({pool_fits_strict} fit strict caps; picker truncates the rest)",
        file=sys.stderr,
    )

    if not pool:
        raise SystemExit(
            "flyer pool is empty — no entries from the 7-kitab whitelist. "
            "Either the briefing skipped the FLYER POOL build or the "
            "underlying daleel_refs is missing those corpora."
        )

    client = _get_client()
    slots = parse_slots_arg(args.slots)

    sections: list[str] = []
    sections.append(f"# Daleel-first POC — briefing `{briefing.id}`")
    sections.append("")
    sections.append(f"theme_group: **{briefing.theme_group}**  ")
    sections.append(
        f"pool: {len(pool_raw)} raw → {len(pool)} flyer-corpora "
        f"({pool_fits_strict} already ≤200ch AR / ≤240ch ID; picker truncates the rest)  "
    )
    sections.append(f"slots: {slots}  ")
    sections.append("")
    sections.append("## Topic context (extracted from Ringkasan Eksekutif)")
    sections.append("```")
    sections.append(topic_context[:1000])
    sections.append("```")
    sections.append("")

    print(f"extracting {len(slots)} news anchors…", file=sys.stderr)
    anchors = llm_extract_anchors(client, topic_context, len(slots))
    for i, a in enumerate(anchors):
        print(f"  anchor {i + 1}: {a['label']}", file=sys.stderr)

    sections.append("## Per-slot news anchor assignment")
    for i, a in enumerate(anchors):
        sections.append(f"- **slot {slots[i] + 1}** → {a['label']}: {a['detail']}")
    sections.append("")
    sections.append("## Side-by-side")
    sections.append("")

    used_picks: list[tuple[str, str]] = []
    for i, slot in enumerate(slots):
        persona = SLOT_PERSONAS[slot]
        anchor = anchors[i]
        # Existing briefing slot index is 1-based in markdown.
        current = extract_existing_flyer(briefing.summary_md or "", slot + 1)
        print(f"slot {slot + 1} — picking daleel…", file=sys.stderr)
        pick = llm_pick_daleel(
            client, pool, topic_context, persona, used_picks
        )
        winner = pool[pick.index]
        used_picks.append((winner.citation, persona["label"]))
        print(
            f"slot {slot + 1} — picked [{pick.index}] {winner.citation} "
            f"(AR {len(pick.arabic)}ch, ID {len(pick.translation)}ch)",
            file=sys.stderr,
        )
        print(f"slot {slot + 1} — writing message…", file=sys.stderr)
        message = llm_write_message(
            client, winner, pick.translation, topic_context, persona, anchor
        )
        print(f"slot {slot + 1} — writing title…", file=sys.stderr)
        title = llm_write_title(client, winner, pick.translation, message, persona)
        sections.append(
            render_comparison(
                slot_index=slot,
                persona=persona,
                current=current,
                new_daleel=winner,
                new_arabic=pick.arabic,
                new_translation=pick.translation,
                new_message=message,
                new_title=title,
                pick_rationale=pick.rationale,
                truncation_note=pick.truncation_note,
                pool_size=len(pool),
            )
        )

    report = "\n".join(sections).rstrip() + "\n"
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(report)
        print(f"wrote {args.out}", file=sys.stderr)
    else:
        sys.stdout.write(report)


def main() -> None:
    asyncio.run(main_async())


if __name__ == "__main__":
    main()
