"""Sentiment classifier — Gemini Flash-Lite, scores event valence.

Single classifier for every platform (mainstream RSS, X, YouTube, TikTok,
Instagram, Facebook). We previously routed mainstream → Gemini and social
→ IndoBERT, but a 2026-05-25 manual eval on `korupsi` X tweets showed
IndoBERT mislabelled 6/7 "positive" tweets (sarcasm read as positive,
news-style reports read as positive, supportive tweets read as
negative). Per-platform Gemini reads the EVENT and FRAME consistently
across surface styles.

The prompt scores 0-1 per label across {positive, neutral, negative}.
Argmax with neutral-bias tie-break; low-confidence (< 0.5) → confident
neutral so we don't surface arbitrary positives. None entries on
exhausted-retry batches → caller writes NULL sentiment_label, which
`retry_failed_sentiment` cron picks up later.

Cost: ~$0.0001 per item on `gemini-2.5-flash-lite`. Batched up to
MAX_BATCH per call to amortize system-prompt tokens.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Literal

import structlog
from google import genai
from google.genai import errors as genai_errors
from google.genai import types

from api.config import settings

log = structlog.get_logger()

MODEL = "gemini-2.5-flash-lite"
# Was 50; lowered to 25 on 2026-05-21 after observing 503 "model overloaded"
# spikes that drop oversized requests first. Smaller chunks mean a single
# 503 doesn't soft-zero 50 items, and the prompt fits comfortably within
# the model's processing window even when Gemini is under load. Doubles
# the call count but each item is still ~$0.0001 — well inside cap.
MAX_BATCH = 25

# Retry config for transient Gemini 5xx (mostly 503 "model overloaded" during
# Indonesia daytime traffic peaks). Three attempts with exponential backoff
# is enough to absorb the typical ~10-30s overload windows; longer outages
# fall through to a NULL sentiment_label which `retry_failed_sentiment`
# picks up on its 2-hourly cron.
MAX_RETRIES = 3
RETRY_BASE_SLEEP_S = 4.0

_LABELS = ("positive", "neutral", "negative")


@dataclass(frozen=True)
class SentimentResult:
    label: Literal["positive", "neutral", "negative"]
    score: float  # confidence of the predicted label, 0-1
    raw: dict[str, float]  # per-class probabilities for the curious


SYSTEM_PROMPT = """You score Indonesian (or English) posts (news headlines, tweets, video titles/descriptions) for event valence from a Muslim community's perspective.

For each text, return a score 0-1 for each of three labels: positive, negative, neutral. Higher = more confident that label applies. Scores need not sum to 1.

CRITICAL: read the OUTCOME and the dominant frame of the post, not just the underlying topic. Sarcasm and rhetorical critique should be scored per the underlying claim, NOT the surface tone — e.g. "Luar biasa track record beliau ini" applied to a corruption defendant is sarcastic = negative.

POSITIVE — score positive when the post reports a good OUTCOME:
- JUSTICE SERVED: prosecutions advancing, arrests of suspects, convictions, asset seizures from corrupt officials, sentence demands accepted as fair, drug busts, criminals caught BEFORE acting. The crime itself is sad, but the news here is the resolution. ARREST/CONVICTION VERBS that ALWAYS mark justice-served: "diringkus", "ditangkap", "ditembak" (when applied to perpetrators), "divonis", "dibekuk", "diciduk", "dijerat", "didakwa" (when the actor is the criminal, not victim), "kabur tertangkap". When a headline names a crime AND uses one of these verbs, the lead is the resolution → POSITIVE.
- CONSUMER BENEFITS: subsidies, discounts (electricity, fuel, transport), 13th-month salary payments, prices going DOWN, wage protections (driver share %, gig-worker rights), worker dispute resolved.
- CHARITY / DAKWAH / RELIGIOUS PRACTICE: donations, kurban (Eid sacrifice), Hajj milestones ("jamaah RI tiba di Tanah Suci", "X persen jamaah berangkat", "calon haji"), mosque renovations, religious teachings, humanitarian aid, tahfidz/hafidz achievement. Any post about a religious figure or congregation engaging in worship-adjacent practice is positive — even if the framing sounds offhand ("Ustaz Solmed Gak Pasang Batasan Untuk Kurban" is still a positive kurban story).
- COOPERATION / SOLIDARITY: anti-imperialist solidarity speeches, regional cooperation, post-disaster mutual aid, inclusive accessibility initiatives. Supportive opinion tweets calling to defend good causes (anti-corruption, justice) count here too.
- ACHIEVEMENT: research progress, exports growing, industry milestones, **currency strengthening ("rupiah menguat", "IHSG rebound", "BI-rate keputusan")**, awards won by Indonesian institutions/communities ("raih penghargaan", "raih predikat", "sertifikasi nasional"). Personal achievements that inspire — earning a doctorate (especially cumlaude), success stories of small entrepreneurs ("Kisah Sukses X"), regenerasi positif in sports/work, individual lulus / juara / berhasil framings.
- ANTI-CORRUPTION ACTION: state body actively seizing or recovering corrupt assets ("Kejati sita lagi Rp X miliar korupsi", "KPK terbitkan sprindik", "Kembangkan kasus bupati"), drug seizures and busts ("Polda Gagalkan peredaran ganja", "BNN Tangkap anggota TNI jaringan narkoba"), preventive policing ("Tim Pemburu Begal", "Patroli Karhutla"). When the lead names a state action against crime/corruption, score positive — the existence of a crime is data; the institutional response is the news.
- INFRASTRUCTURE / DEVELOPMENT: roads built, schools opened, electrification, conservation programs, talent development.

NEGATIVE — score negative when the post is about ongoing harm OR critical of a current state of affairs:
- VIOLENCE / ABUSE: child sexual abuse (including in religious settings), bullying, school violence (NEVER neutral — read past the administrative framing), murder, assault, kidnapping (WNI captured by Israel), domestic violence, religious-tension incidents.
- DEATHS / MURDER DISCOVERY: a person found dead ("ditemukan meninggal", "tewas", "wafat", "MAYAT", "korban pembunuhan", "lehernya digorok", "dibunuh sadis" — when the subject is an ordinary citizen, a victim of crime, illness, or accident). The phrase "Polisi Sebut [the crime]" does NOT make this positive — police describing a murder is still a murder report. Justice-served language requires an ARREST verb (diringkus / ditangkap / divonis / dibekuk) applied to the perpetrator, not just police narration of the crime. Exception: peaceful death of an elderly public figure framed as a tribute → neutral.
- HUMANITARIAN AFTERMATH: "korban bencana", "warga terdampak", "rumah hilang", "ibu dan anak hilang tertimbun longsor" — disaster victims are negative even when the article describes recovery efforts.
- DISASTERS: earthquakes, eruptions, landslides, fires, floods, disease outbreaks.
- IMMORAL ACTS: corruption AS IT'S HAPPENING (not as it's being prosecuted), inappropriate viral content, fitnah / defamation.
- ECONOMIC HARM TO PUBLIC: prices RISING (food, materials), rupiah weakening (when it's the lead), small businesses struggling, budget CUTS to social programs (MBG cut).
- INJUSTICE / OPPRESSION: WNI captives, attacks on Indonesians abroad, mosque shootings, Islamophobic incidents (the violence is the lead, even if the article is the NU/etc. condemnation). Government-response framings ("Kemenlu pantau WNI ditahan Israel", "Istana koordinasi selamatkan WNI", "Keluarga ungkap kontak terakhir korban penculikan") are STILL negative — the underlying topic is oppression-of-Muslims, the government statement is a response to harm, not a positive resolution. A government response only becomes positive when the captives are actually released or a perpetrator is arrested.
- HOAXES IN PROGRESS (an active hoax/scam being reported). Hoaxes already DEBUNKED → see neutral.
- CRITIQUE / OUTRAGE OPINIONS: tweets expressing frustration, anger, or sarcastic mockery of injustice ("RIP Hukum Indonesia", "Bullshit!", rhetorical questions implying the system is broken). Sarcasm targeting bad actors = negative.

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
- SELF-DEPRECATING HUMOR / BANTER: throwaway jokes without sentiment ("kalo bisa korupsi gua korupsi nih cuma apa yang mau di korupsi"), playful exchanges, balanced nuanced opinions ("ada kebijakan kurang tepat sasaran, tapi ada juga yang sangat membantu").

WHEN UNCERTAIN — DEFAULT TO NEUTRAL, NOT POSITIVE:
If a post doesn't clearly fit positive OR negative criteria (routine politics, ambiguous diplomacy, unfamiliar non-religious topic, opinion piece, etc.), return `neutral` with a confident score (≥ 0.7), NOT a low-confidence positive. Never emit all three scores at or near 0 — that produces an arbitrary label. ALWAYS commit at least 0.5 to whichever label best fits; if none clearly does, that label is neutral.

Read the EVENT and its FRAME, not the writer's surface tone. News writing is restrained even for negative events; tweets often pack opinion under irony. Do not score "neutral" if the event itself is harmful or beneficial. BUT: do not score "negative" just because a sad topic is mentioned — if the lead is the resolution (prosecution succeeding, criminal caught, hoax debunked), the valence is positive or neutral.

Examples (carefully calibrated against real misclassifications):
- "Tujuh WNI Peserta Global Sumud Flotilla Terkonfirmasi Diculik Israel" → negative (kidnapping is the event)
- "Tuntutan 18 Tahun Nadiem Dinilai Wajar, Pakar Hukum: Jaksa Punya Bukti Kuat" → positive (sentence demand on corruption case accepted as fair = justice advancing)
- "Kemenlu: WNI yang Ditangkap Israel Bertambah Jadi 9 Orang" → negative (oppression count rising, not a positive resolution)
- "Istana dan Kemlu Terus Koordinasi Selamatkan WNI yang Ditahan Tentara Israel" → negative (government response to oppression — captives still held)
- "Keluarga Ungkap Kontak Terakhir Thoudy Badai Sebelum Diculik Israel" → negative (kidnapping context)
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
- "Komplotan Pencuri Aset Tower Seluler di Banyumas Diringkus" → positive ("diringkus" = arrest verb; criminals caught)
- "Jambret HP Bocah Perekam Bus Telolet Ditangkap, 2 Pelaku Ditembak" → positive (snatchers arrested + perpetrators shot)
- "ASN Aceh Raih Doktor Lewat Publikasi Jurnal Q1, Lulus Cumlaude" → positive (personal achievement)
- "Pria Ditemukan Meninggal di Sentani, Saksi Sebut Korban Sempat Mengeluh Demam" → negative (death of an ordinary citizen)
- "Gerindra: Ucapan Terima Kasih ke PDIP Bukti Prabowo Hormati Oposisi" → neutral (inter-party courtesy)
- "Kejati Kaltim sita lagi Rp57,45 miliar korupsi lahan transmigrasi" → positive (asset seizure from corrupt)
- "BNN Tangkap Anggota TNI terkait Jaringan Narkoba Aceh-Bogor" → positive (justice served + internal corruption surfaced)
- "Polda Metro Jaya Gagalkan Peredaran 2 Kg Ganja di Jaktim" → positive (drug bust)
- "Rupiah Menguat Usai Pidato Presiden dan Keputusan Suku Bunga BI" → positive (currency strengthening)
- "Pemkab Sidoarjo Raih Penghargaan Kearsipan Terbaik Nasional" → positive (institutional achievement)
- "Gus Irfan: 93 Persen Jamaah RI Sudah Tiba di Tanah Suci" → positive (Hajj milestone)
- "Ustaz Solmed Gak Pasang Batasan Anggaran Untuk Kurban" → positive (kurban story)
- "Pemkab Agam upayakan tambahan lahan relokasi warga korban bencana" → negative (humanitarian aftermath — bencana korban are still negative)
- "Longsor di Batangtoru Tapanuli Selatan, Ibu dan Anak Hilang Tertimbun" → negative (disaster victims missing)

Tweet/social examples:
- "Luar biasa track record beliau ini. Tidak menutup kemungkinan kasus korupsi di tubuh pln ada hubungannya..." → negative (sarcasm + accusation)
- "Bapake suka banget ya pidato depan tumpukan uang" → negative (sarcasm mocking the optic)
- "Manajemen Korupsi 2 SKS, Psikologi Korupsi 2 SKS..." → negative (sarcastic curriculum, critique of culture)
- "Masih yakin proses peradilan tipikor kita dijalankan dg benar?" → negative (rhetorical anger)
- "Kawal Presiden Prabowo kalau gak mau negeri ini tenggelam selamanya dalam kubangan korupsi" → positive (call to defend anti-corruption efforts)
- "Saya percaya Nadiem bersih... dia tidak korupsi" → positive (defensive support of an individual)
- "kalo bisa korupsi gua korupsi nih cuma apa yang mau di korupsi" → neutral (self-deprecating joke, no sentiment)
- "Mengkritik kebijakan Nadiem bukan berarti bilang dia korupsi... Ada kebijakan yang kurang tepat sasaran. Tapi ada juga yang sangat membantu" → neutral (balanced, nuanced opinion)

Return only valid JSON."""


_client: genai.Client | None = None


def _get_client() -> genai.Client:
    if not settings.gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY is not set. Add to .env.")
    global _client
    if _client is None:
        _client = genai.Client(api_key=settings.gemini_api_key)
    return _client


def classify(text: str) -> SentimentResult | None:
    return classify_batch([text])[0]


def classify_batch(texts: list[str]) -> list[SentimentResult | None]:
    """Classify a batch of posts.

    Returns a same-length list aligned with `texts`. An entry is `None`
    when the Gemini call for that chunk exhausted MAX_RETRIES (e.g. a
    sustained 503 outage). Callers should write `sentiment_label=NULL`
    for None entries so the `retry_failed_sentiment` worker task picks
    them up later.
    """
    if not texts:
        return []

    results: list[SentimentResult | None] = [None] * len(texts)
    for start in range(0, len(texts), MAX_BATCH):
        chunk = texts[start : start + MAX_BATCH]
        try:
            scored = _classify_chunk(chunk)
        except Exception:
            # All retries exhausted. Leave `None` in the slots so the
            # caller can write NULL labels — `retry_failed_sentiment`
            # cron retries them every 2h.
            log.exception(
                "sentiment.chunk_failed_after_retries",
                batch_size=len(chunk),
            )
            continue
        for i, r in enumerate(scored):
            results[start + i] = r

    return results


def _classify_chunk(texts: list[str]) -> list[SentimentResult | None]:
    client = _get_client()

    numbered = "\n\n".join(
        f"[{i + 1}] {t[:1500]}" for i, t in enumerate(texts)
    )
    user_prompt = (
        f"Score each of the following {len(texts)} post(s). "
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

    # Retry loop — Gemini Flash-Lite returns 503 "model overloaded" in
    # bursts during Indonesia daytime peaks. 3 attempts × exponential
    # backoff (4s, 8s, 16s) absorbs most of those windows. On final
    # failure we let the exception bubble; `classify_batch` catches and
    # leaves NULL labels for the cron retry job to pick up.
    last_exc: Exception | None = None
    resp = None
    for attempt in range(MAX_RETRIES):
        try:
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
            break
        except genai_errors.ServerError as exc:
            last_exc = exc
            if attempt == MAX_RETRIES - 1:
                log.warning(
                    "sentiment.gemini_5xx_giveup",
                    attempt=attempt + 1,
                    batch_size=len(texts),
                    error=str(exc)[:200],
                )
                raise
            wait_s = RETRY_BASE_SLEEP_S * (2**attempt)
            log.info(
                "sentiment.gemini_5xx_retry",
                attempt=attempt + 1,
                wait_s=wait_s,
                batch_size=len(texts),
            )
            time.sleep(wait_s)
    if resp is None:
        # Defensive: shouldn't reach here because the final attempt
        # either breaks or raises, but keeps the type-checker happy.
        raise RuntimeError(
            "sentiment: retry loop exited without response"
        ) from last_exc

    raw = resp.text or "[]"
    parsed: list[dict[str, float]] = json.loads(raw)

    from api.services.usage import gemini_output_tokens, record_usage

    usage_md = getattr(resp, "usage_metadata", None)
    record_usage(
        provider="gemini",
        operation="classify_sentiment",
        model=MODEL,
        tokens_in=getattr(usage_md, "prompt_token_count", None),
        tokens_out=gemini_output_tokens(usage_md),
        meta={"batch_size": len(texts)},
    )

    results: list[SentimentResult] = []
    for scores in parsed:
        clean = {label: float(scores.get(label, 0.0)) for label in _LABELS}
        # Argmax with a NEUTRAL-preferring tie-break. Python's `max()` on a
        # dict returns the first-seen key on ties, and dict-insertion order
        # here is (positive, neutral, negative). Before this fix, items the
        # model returned as {pos: 0, neu: 0, neg: 0} silently became
        # "positive · 0.00" rows. Sort key: (-score, neutral-bias) so
        # highest score wins, and `neutral` wins any tie with the others.
        ranked = sorted(
            clean.items(),
            key=lambda kv: (-kv[1], 0 if kv[0] == "neutral" else 1),
        )
        top_label, top_score = ranked[0]
        # Low-confidence punt: if the model didn't commit (top < 0.5), the
        # valence is genuinely unclear → treat as confident neutral. Floor
        # the score at 0.7 so the rows don't drag down the median confidence
        # of the neutral bucket.
        if top_score < 0.5:
            top_label = "neutral"
            top_score = max(0.7, clean.get("neutral", 0.0))
            clean = {"positive": 0.0, "neutral": top_score, "negative": 0.0}
        results.append(
            SentimentResult(
                label=top_label,  # type: ignore[arg-type]
                score=top_score,
                raw=clean,
            )
        )

    if len(results) != len(texts):
        log.warning(
            "sentiment.size_mismatch",
            expected=len(texts),
            got=len(results),
        )
        # Pad with None so callers see the same "unclassified" signal as
        # for a full-batch retry exhaustion. Better to surface the holes
        # than fabricate confident-neutral labels that hide the model
        # misbehaving.
        results.extend([None] * (len(texts) - len(results)))

    return results
