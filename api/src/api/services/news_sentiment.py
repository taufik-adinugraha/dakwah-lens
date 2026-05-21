"""News-sentiment classifier — Gemini Flash-Lite, scores event valence.

IndoBERT (`services/sentiment.py`) was fine-tuned on tweets/reviews and
reads *speaker emotion*. News writing is third-person and emotionally
restrained even when reporting awful events, so IndoBERT defaults ~95%
of mainstream posts to neutral — including ones like "WNI diculik Israel"
that the dashboard obviously wants flagged.

For mainstream RSS we instead ask Gemini to score *event valence* for
the Muslim community: is what's being reported good, bad, or routine?
That matches what a da'wah analyst actually needs.

Output format mirrors `SentimentResult` from the IndoBERT module so the
calling code only needs to pick which classifier to dispatch based on
platform — nothing downstream changes.

Cost: ~$0.0001 per item on `gemini-2.5-flash-lite`. Batched up to
MAX_BATCH per Gemini call to amortize system-prompt tokens.
"""

from __future__ import annotations

import json

import structlog
from google import genai
from google.genai import types

from api.config import settings
from api.services.sentiment import SentimentResult

log = structlog.get_logger()

MODEL = "gemini-2.5-flash-lite"
MAX_BATCH = 50

_LABELS = ("positive", "neutral", "negative")

SYSTEM_PROMPT = """You score Indonesian (or English) news items for event valence from a Muslim community's perspective.

For each text, return a score 0-1 for each of three labels: positive, negative, neutral. Higher = more confident that label applies. Scores need not sum to 1.

CRITICAL: read the OUTCOME and the dominant frame of the story, not just the underlying topic.

POSITIVE — score positive when the story reports a good OUTCOME:
- JUSTICE SERVED: prosecutions advancing, arrests of suspects, convictions, asset seizures from corrupt officials, sentence demands accepted as fair, drug busts, criminals caught BEFORE acting. The crime itself is sad, but the news here is the resolution. ARREST/CONVICTION VERBS that ALWAYS mark justice-served: "diringkus", "ditangkap", "ditembak" (when applied to perpetrators), "divonis", "dibekuk", "diciduk", "dijerat", "didakwa" (when the actor is the criminal, not victim), "kabur tertangkap". When a headline names a crime AND uses one of these verbs, the lead is the resolution → POSITIVE.
- CONSUMER BENEFITS: subsidies, discounts (electricity, fuel, transport), 13th-month salary payments, prices going DOWN, wage protections (driver share %, gig-worker rights), worker dispute resolved.
- CHARITY / DAKWAH: donations, kurban (Eid sacrifice), Hajj milestones, mosque renovations, religious teachings, humanitarian aid.
- COOPERATION / SOLIDARITY: anti-imperialist solidarity speeches, regional cooperation, post-disaster mutual aid, inclusive accessibility initiatives.
- ACHIEVEMENT: research progress, exports growing, industry milestones, currency strengthening, awards won by Indonesian institutions/communities. Personal achievements that inspire — earning a doctorate (especially cumlaude), success stories of small entrepreneurs ("Kisah Sukses X"), regenerasi positif in sports/work, individual lulus / juara / berhasil framings.
- INFRASTRUCTURE / DEVELOPMENT: roads built, schools opened, electrification, conservation programs, talent development.

NEGATIVE — score negative when the story is about ongoing harm:
- VIOLENCE / ABUSE: child sexual abuse (including in religious settings), bullying, school violence (NEVER neutral — read past the administrative framing), murder, assault, kidnapping (WNI captured by Israel), domestic violence, religious-tension incidents.
- DEATHS: a person found dead ("ditemukan meninggal", "tewas", "wafat" — when the subject is unknown, an ordinary citizen, or a victim of crime/accident). Exception: peaceful death of an elderly public figure where the article is a tribute, not a harm report → neutral.
- DISASTERS: earthquakes, eruptions, landslides, fires, floods, disease outbreaks.
- IMMORAL ACTS: corruption AS IT'S HAPPENING (not as it's being prosecuted), inappropriate viral content, fitnah / defamation.
- ECONOMIC HARM TO PUBLIC: prices RISING (food, materials), rupiah weakening (when it's the lead), small businesses struggling, budget CUTS to social programs (MBG cut).
- INJUSTICE / OPPRESSION: WNI captives, attacks on Indonesians abroad, mosque shootings, Islamophobic incidents (the violence is the lead, even if the article is the NU/etc. condemnation).
- HOAXES IN PROGRESS (an active hoax/scam being reported). Hoaxes already DEBUNKED → see neutral.

NEUTRAL — score neutral when there's no clear good/bad OUTCOME:
- ROUTINE POLITICS: speeches, anecdotes from speeches, party reactions, attendance announcements, policy proposals without yet an action, mutual diplomatic praise between coalition figures ("X menghormati Y", "X mengapresiasi Y", "X tegaskan Y memperkuat..."). "Prabowo hadir di rapat" is neutral. Inter-party courtesy / spin is neutral, NOT positive — there's no concrete outcome for the public.
- AMBIGUOUS FOREIGN VISITS / DIPLOMATIC ARRIVALS without a stated harm or benefit ("3 Kapal Perang X Tiba-Tiba Bersandar di Jakarta, Ada Urusan Apa?") — neutral until the outcome is reported.
- CELEBRITY DENIALS / DISPUTES without confirmed harm ("Erin Bantah Punya Perilaku Kasar"): the allegation is unconfirmed, the denial isn't an outcome — neutral.
- SCHEDULES / ANNOUNCEMENTS / WEATHER: train schedules, ship schedules, SIM keliling, weather forecasts, traffic alerts, exam result dates.
- SPORTS / CELEBRITY GOSSIP without serious harm: team line-ups, transfer news, celebrity dating/dispute (unless violence is involved).
- LEGAL PROCEDURE WITHOUT OUTCOME: trial postponed, defense lawyer prepares, hearing scheduled.
- COMMERCIAL: product launches, dealer events, app feature tutorials.
- FOREIGN RELIGIOUS / CULTURAL CONTENT: Balinese Hindu calendar, horoscopes, Christian Bible launches, foreign religious events. These are other communities' practices — not negative for Indonesian Muslims; treat as routine cultural reporting unless they describe an actual harm.
- HOAX DEBUNKED: "Hoaks! …" stories are factual corrections — neutral, not negative.
- TECHNICAL / INFORMATIONAL: medical explanation pieces, opinion analyses, market commentary without major movement.

Read the EVENT and its FRAME, not the writer's tone. News writing is restrained even for negative events; do not score "neutral" if the event itself is harmful or beneficial. BUT: do not score "negative" just because a sad topic is mentioned — if the article's lead is the resolution (prosecution succeeding, criminal caught, hoax debunked), the valence is positive or neutral.

Examples (carefully calibrated against real misclassifications):
- "Tujuh WNI Peserta Global Sumud Flotilla Terkonfirmasi Diculik Israel" → negative (kidnapping is the event)
- "Tuntutan 18 Tahun Nadiem Dinilai Wajar, Pakar Hukum: Jaksa Punya Bukti Kuat" → positive (justice advancing)
- "Pria Paruh Baya Cabuli Bocah 6 Tahun di Kamar Mandi Masjid" → negative (child abuse)
- "Ulah Bullying Siswa SD di Nabire Seret 13 Orang Tua ke Sekolah" → negative (bullying, not "parents at school")
- "Bareskrim Bongkar Pabrik Kosmetik Ilegal Berbahan Merkuri" → positive (illegal factory busted)
- "Diskon Listrik 50 Persen PLN Berlaku Lagi di Mei 2026" → positive (consumer benefit)
- "Hoaks! Purbaya pangkas gaji ke-13 PNS" → neutral (hoax debunked, factual correction)
- "Ala Ayuning Dewasa Kamis 21 Mei 2026 Sesuai Kalender Bali" → neutral (Balinese Hindu calendar)
- "Prabowo Bakal Hadiri Rapat Paripurna DPR" → neutral (routine politics)
- "Prabowo: Jangan Kagum dengan Bangsa yang Rampas Bangsa Lain" → positive (anti-imperialist solidarity)
- "Info BMKG Cuaca Sulawesi Utara Hari Ini" → neutral (weather)
- "Kemensos Lelang 6,2 Kg Emas HTT, Hasilnya untuk Bantu Warga Rentan" → positive (humanitarian)
- "PBNU Kutuk Penembakan di Masjid AS Tewaskan 3 Orang" → negative (mosque shooting, even though framed as condemnation)
- "Mayoritas Dapur MBG di Sleman Belum Kantongi Sertifikat Higiene" → negative (food safety concern)
- "Komplotan Pencuri Aset Tower Seluler di Banyumas Diringkus" → positive ("diringkus" = arrest verb; criminals caught)
- "Jambret HP Bocah Perekam Bus Telolet Ditangkap, 2 Pelaku Ditembak" → positive (snatchers arrested + perpetrators shot)
- "ASN Aceh Raih Doktor Lewat Publikasi Jurnal Q1, Lulus Cumlaude" → positive (personal achievement)
- "Kisah Sukses Otiv jadi Inspirasi Para Agen BRILink" → positive (inspiring success story)
- "Pria Ditemukan Meninggal di Sentani, Saksi Sebut Korban Sempat Mengeluh Demam" → negative (death of an ordinary citizen)
- "Gerindra: Ucapan Terima Kasih ke PDIP Bukti Prabowo Hormati Oposisi" → neutral (inter-party courtesy, no concrete outcome)
- "Qodari Tegaskan Presiden Prabowo Perkuat Pengawasan Ekspor demi Jalankan Pasal 33 UUD 1945" → neutral (political spin, no action yet)
- "3 Kapal Perang Pakistan Tiba-Tiba Bersandar di Jakarta, Ada Urusan Apa?" → neutral (ambiguous foreign arrival without outcome)
- "Erin Bantah Punya Perilaku Kasar ke ART" → neutral (celebrity denial, allegation unconfirmed)

Return only valid JSON."""


_client: genai.Client | None = None


def _get_client() -> genai.Client:
    if not settings.gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY is not set. Add to .env.")
    global _client
    if _client is None:
        _client = genai.Client(api_key=settings.gemini_api_key)
    return _client


def _neutral_result() -> SentimentResult:
    return SentimentResult(
        label="neutral",
        score=1.0,
        raw={"positive": 0.0, "neutral": 1.0, "negative": 0.0},
    )


def classify(text: str) -> SentimentResult:
    return classify_batch([text])[0]


def classify_batch(texts: list[str]) -> list[SentimentResult]:
    if not texts:
        return []

    results: list[SentimentResult | None] = [None] * len(texts)
    for start in range(0, len(texts), MAX_BATCH):
        chunk = texts[start : start + MAX_BATCH]
        try:
            scored = _classify_chunk(chunk)
        except Exception:
            # A Gemini outage shouldn't poison an ingest run — fall back
            # to neutral so the rest of the pipeline (relevance, upsert)
            # still commits its work.
            log.exception("news_sentiment.chunk_failed", batch_size=len(chunk))
            scored = [_neutral_result() for _ in chunk]
        for i, r in enumerate(scored):
            results[start + i] = r

    for i, r in enumerate(results):
        if r is None:
            log.warning("news_sentiment.missing_result", index=i)
            results[i] = _neutral_result()

    return [r for r in results if r is not None]


def _classify_chunk(texts: list[str]) -> list[SentimentResult]:
    client = _get_client()

    numbered = "\n\n".join(
        f"[{i + 1}] {t[:1500]}" for i, t in enumerate(texts)
    )
    user_prompt = (
        f"Score each of the following {len(texts)} news item(s). "
        f"Return an array of {len(texts)} score objects, in input order.\n\n"
        f"{numbered}"
    )

    response_schema = {
        "type": "array",
        "items": {
            "type": "object",
            "properties": {label: {"type": "number"} for label in _LABELS},
            "required": list(_LABELS),
        },
    }

    resp = client.models.generate_content(
        model=MODEL,
        contents=user_prompt,
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            response_mime_type="application/json",
            response_schema=response_schema,
            temperature=0.1,
        ),
    )
    raw = resp.text or "[]"
    parsed: list[dict[str, float]] = json.loads(raw)

    from api.services.usage import record_usage

    usage_md = getattr(resp, "usage_metadata", None)
    record_usage(
        provider="gemini",
        operation="classify_news_sentiment",
        model=MODEL,
        tokens_in=getattr(usage_md, "prompt_token_count", None),
        tokens_out=getattr(usage_md, "candidates_token_count", None),
        meta={"batch_size": len(texts)},
    )

    results: list[SentimentResult] = []
    for scores in parsed:
        clean = {label: float(scores.get(label, 0.0)) for label in _LABELS}
        top_label, top_score = max(clean.items(), key=lambda kv: kv[1])
        results.append(
            SentimentResult(
                label=top_label,  # type: ignore[arg-type]
                score=top_score,
                raw=clean,
            )
        )

    if len(results) != len(texts):
        log.warning(
            "news_sentiment.size_mismatch",
            expected=len(texts),
            got=len(results),
        )
        # Pad with neutral so caller can zip safely.
        while len(results) < len(texts):
            results.append(_neutral_result())

    return results
