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
import re
import time
from dataclasses import dataclass
from typing import Literal

import structlog
from google import genai
from google.genai import errors as genai_errors
from google.genai import types

from api.config import settings

log = structlog.get_logger()


# ─────────────────────────────────────────────────────────────────────
# Non-Indonesian language gate (pre-classifier)
#
# Added 2026-06-08 after audit found Hindi-script and English-only spam
# tweets bleeding into 14-group themes (one got classified as "Toleransi
# & Lintas-Iman"). Saves the Gemini round-trip AND prevents the bleed by
# pre-routing obviously-foreign content straight to Lainnya.
#
# The classifier prompt also has a non-ID rule, but a code-level gate is
# cheaper + deterministic for the obvious cases. The prompt still handles
# borderline ID/EN code-switched posts.
# ─────────────────────────────────────────────────────────────────────

# Unicode script blocks that are NOT used in Indonesian (Latin) text.
# Devanagari (Hindi), Han (Chinese), Hangul (Korean), Hiragana, Katakana
# (Japanese), Cyrillic (Russian), Thai, Hebrew.
_NON_LATIN_SCRIPT_RE = re.compile(
    r"[ऀ-ॿ一-鿿가-힯぀-ゟ"
    r"゠-ヿЀ-ӿ฀-๿֐-׿]"
)

# Indonesian function words that almost always appear in any natural-
# Indonesian sentence longer than ~10 words. Their absence in a 50+
# char Latin-script post is a strong signal the post isn't Indonesian.
_ID_FUNCTION_WORDS = frozenset(
    "yang dan di ke dari untuk dengan pada ini itu kita akan sudah "
    "atau kalau juga ada dalam saya anda tidak tapi jadi maka karena "
    "saat sebagai oleh lebih telah dapat hanya bisa lalu jika tetapi "
    "namun pun nya pun setelah selama sambil tentang bagi adalah".split()
)

# Indonesian-specific entity/topic words. Their presence rescues an
# English-leaning post (e.g. "Jakarta Post about Prabowo speech") from
# being mis-gated as foreign — the post is about Indonesia even if the
# wording is English.
_ID_ENTITY_RE = re.compile(
    r"\b(allah|muslim|islam|nabi|hadits|hadith|umat|jamaah|masjid|"
    r"rakyat|presiden|menteri|dpr|gubernur|polisi|kpk|kejaksaan|"
    r"pemerintah|negara|warga|kota|kabupaten|provinsi|indonesia|"
    r"jakarta|surabaya|bandung|medan|bali|sulawesi|papua|jawa|"
    r"prabowo|jokowi|nadiem|pdip|gerindra|nu|muhammadiyah)\b",
    re.IGNORECASE,
)


def _is_predominantly_non_indonesian(text: str) -> bool:
    """Cheap heuristic — return True if `text` is unlikely to be Indonesian.

    Two pathways:
      1. Substantial non-Latin script content (>30% of non-space chars) →
         True. Catches Hindi/Tamil/Chinese/Korean/Japanese/Russian/Arabic.
      2. All-Latin but no Indonesian function words AND no Indonesian
         entity terms in a 50+ char text → True. Catches English-only,
         Spanish, Tagalog, etc. that happen to share Latin script.

    Short posts (<20 chars after stripping @-handles/URLs) → True (likely
    not meaningful content; usually @-mention spam).
    """
    if not text:
        return False
    raw = text.strip()
    if len(raw) < 20:
        return False  # let classifier handle very short posts

    # Strip URLs, @-handles, #hashtags — they aren't useful for language ID
    cleaned = re.sub(r"https?://\S+|@\w+|#\w+", " ", raw)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if len(cleaned) < 20:
        return True  # post was almost entirely handles/URLs — not real content

    # Pathway 1: non-Latin scripts dominate
    non_latin = len(_NON_LATIN_SCRIPT_RE.findall(cleaned))
    non_space_chars = sum(1 for c in cleaned if not c.isspace())
    if non_space_chars > 0 and (non_latin / non_space_chars) > 0.30:
        return True

    # Pathway 2: zero Indonesian markers in a long-ish Latin text
    words = re.findall(r"[A-Za-z]+", cleaned.lower())
    if len(words) >= 8:
        id_word_hits = sum(1 for w in words if w in _ID_FUNCTION_WORDS)
        if id_word_hits == 0 and not _ID_ENTITY_RE.search(cleaned):
            return True

    return False

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
    # One of the 14 THEME_GROUPS or "Lainnya". Asked in the SAME
    # Gemini call as sentiment since 2026-06-05 — adds ~10 output
    # tokens per post, no new round-trip. Replaces the separate
    # relevance.py call that previously emitted this. None when
    # the model didn't emit it or emitted an invalid name; ingest
    # writes NULL in that case and the read paths fall back to
    # `classify_theme_group(topic.label)` regex.
    theme_group: str | None = None


SYSTEM_PROMPT = """You score Indonesian (or English) posts (news headlines, tweets, video titles/descriptions) for event valence from a Muslim community's perspective.

For each text, return a score 0-1 for each of three labels: positive, negative, neutral. Higher = more confident that label applies. Scores need not sum to 1.

CRITICAL: read the OUTCOME and the dominant frame of the post, not just the underlying topic. Sarcasm and rhetorical critique should be scored per the underlying claim, NOT the surface tone — e.g. "Luar biasa track record beliau ini" applied to a corruption defendant is sarcastic = negative.

POSITIVE — score positive when the post reports a good OUTCOME:
- JUSTICE SERVED: prosecutions advancing, arrests of suspects, convictions, asset seizures from corrupt officials, sentence demands accepted as fair, drug busts, criminals caught BEFORE acting. The crime itself is sad, but the news here is the resolution. ARREST/CONVICTION VERBS that ALWAYS mark justice-served: "diringkus", "ditangkap", "ditembak" (when applied to perpetrators), "divonis", "dibekuk", "diciduk", "dijerat", "didakwa" (when the actor is the criminal, not victim), "kabur tertangkap". When a headline names a crime AND uses one of these verbs, the lead is the resolution → POSITIVE.
- CONSUMER BENEFITS: subsidies, discounts (electricity, fuel, transport), 13th-month salary payments, prices going DOWN, wage protections (driver share %, gig-worker rights), worker dispute resolved.
- CHARITY / DAKWAH / RELIGIOUS PRACTICE: donations, kurban (Eid sacrifice), Hajj milestones ("jamaah RI tiba di Tanah Suci", "X persen jamaah berangkat", "calon haji"), mosque renovations, religious teachings, humanitarian aid, tahfidz/hafidz achievement. Any post about a religious figure or congregation engaging in worship-adjacent practice is positive — even if the framing sounds offhand ("Ustaz Solmed Gak Pasang Batasan Untuk Kurban" is still a positive kurban story). This INCLUDES dry-titled religious teaching content that doesn't carry obvious emotional cues:
  · Quran recitation / murottal — titles naming a surah or reciter ("SURAT AL MAIDAH 32", "Murottal Al-Kahfi", "QS Yasin / Hareth Al Argaly") → positive.
  · Fiqh Q&A — Islamic legal questions with channel signals (Al-Bahjah TV, Rumah Fiqih, Yufid EDU, NU Online) or formulas like "Bolehkah X?", "Hukum X", "Bait ke-N", "Fiqih Mazhab X" → positive.
  · Islamic history / tarikh — biographies of sahabah / khalifah / nabi, calendar history ("Umar Bin Khatab dan Sejarah Penetapan Kalender Hijriah") → positive.
  · Hadith / sirah teachings — "Bahkan Seorang Nabi Pun Bersikap Sungkan", "Sabda Nabi", any sirah excerpt → positive.
  · Religious figure self-improvement talks (Felix Siauw, Hanan Attaki, Khalid Basalamah on focus / akhlaq / parenting) → positive.
- COOPERATION / SOLIDARITY: anti-imperialist solidarity speeches, regional cooperation, post-disaster mutual aid, inclusive accessibility initiatives. Supportive opinion tweets calling to defend good causes (anti-corruption, justice) count here too.
- ACHIEVEMENT: research progress, exports growing, industry milestones, **currency strengthening ("rupiah menguat", "IHSG rebound", "BI-rate keputusan")**, awards won by Indonesian institutions/communities ("raih penghargaan", "raih predikat", "sertifikasi nasional"). Personal achievements that inspire — earning a doctorate (especially cumlaude), success stories of small entrepreneurs ("Kisah Sukses X"), regenerasi positif in sports/work, individual lulus / juara / berhasil framings.
- ANTI-CORRUPTION ACTION: state body actively engaging a corruption case — at ANY stage of the process. Investigation-initiation verbs ALWAYS count: "Usut", "Akui Usut", "Tangani" (when the actor is KPK/Kejagung/Polda and the object is "kasus korupsi"), "Tetapkan tersangka", "Terbitkan sprindik", "Periksa", "Selidiki", "Kembangkan kasus", "Geledah". Seizures: "Sita", "Lelang aset". Drug busts: "Gagalkan peredaran", "Tangkap" (perpetrator). Preventive policing ("Tim Pemburu Begal", "Patroli Karhutla"). When the lead names a state action against crime/corruption, score positive — the existence of a crime is data; the institutional response is the news. "KPK Akui Usut Dugaan Korupsi X" → positive (institution acting).
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
- SARDONIC-STRUCTURE CRITIQUE: critique disguised as a list, timeline, or curriculum. Escalating-year pattern mocking persistent corruption ("(2008) korupsi (2009) tetap korupsi (2010) makin banyak..."), mock-academic curricula ("Manajemen Korupsi 2 SKS, Budaya Korupsi 2 SKS"), pseudo-statistics with critical intent. These are structural sarcasm — score negative even though no explicit anger word appears.
- POSITIVE-OPENER WITH CRITICAL PAYLOAD: posts that LEAD with a praise/fact frame ("Fun fact", "Luar biasa", "Mantap", "Hormat") but pivot to attack a present-day target. Read the whole post — if more than half is critique, the post is negative. Examples: "Fun fact BJ Habibie pernah pulihkan rupiah... Fakta yang tidak akan bisa diterima oleh para pembela pemerintah" → negative (the Habibie part is rhetorical setup; the punch is at "pembela pemerintah").

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
- EDUTAINMENT HISTORICAL / EXPLAINER: YouTube edutainment channels (Sepulang Sekolah, Kok Bisa, NerveDamage, etc.) doing historical, geopolitical, or business explainers — even when the topic vocabulary sounds alarming ("SKANDAL KFC di China", "GULA MEMPERPARAH PENJAJAHAN", "Slave Trade", "Kolonialisme"). Past or distant-place harm framed as education is NOT the kind of "ongoing harm" the negative rules target. Score neutral unless the content describes contemporary Indonesian harm.
- WORKPLACE / LIFESTYLE BANTER: relatable office humor, deadline jokes, generational stereotypes ("Ini yang Gen Z lakukan ketika dikejar deadline"), gym/cooking/dating content. Trigger-warning labels on humor don't make humor negative. Score neutral.
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
- "Manajemen Korupsi 2 SKS, Psikologi Korupsi 2 SKS..." → negative (sardonic curriculum critique)
- "(2008) korupsi (2009) tetap korupsi (2010) makin banyak yang korupsi" → negative (sardonic timeline critique)
- "Fun fact BJ Habibie pernah pulihkan rupiah… Fakta yang tidak akan bisa diterima oleh para pembela pemerintah" → negative (positive opener, critical payload at current gov)
- "Masih yakin proses peradilan tipikor kita dijalankan dg benar?" → negative (rhetorical anger)
- "Kawal Presiden Prabowo kalau gak mau negeri ini tenggelam selamanya dalam kubangan korupsi" → positive (call to defend anti-corruption efforts)
- "Saya percaya Nadiem bersih... dia tidak korupsi" → positive (defensive support of an individual)
- "KPK Akui Usut Dugaan Korupsi Dishub DKI" → positive (institutional anti-corruption action)
- "Kejagung Usut Dugaan Korupsi di Kementan" → positive (investigation = anti-corruption action)
- "SURAT AL MAIDAH 32 / HARETH AL ARGALY" → positive (Quran recitation)
- "Bolehkah Dam Haji Disembelih di Tanah Air? / Buya Yahya" → positive (fiqh Q&A)
- "Umar Bin Khatab dan Sejarah Penetapan Kalender Hijriah" → positive (Islamic history teaching)
- "Bahkan Seorang Nabi Pun Bersikap Sungkan kepada Istrinya" → positive (sirah teaching)
- "Kenapa KFC Kuasai China? Padahal Banyak SKANDAL!" → neutral (edutainment business explainer)
- "Gimana GULA MEMPERPARAH PENJAJAHAN? Jutaan Diperbudak" → neutral (edutainment historical explainer)
- "Ini yang Gen Z lakukan ketika dikejar deadline" → neutral (workplace banter)
- "kalo bisa korupsi gua korupsi nih cuma apa yang mau di korupsi" → neutral (self-deprecating joke, no sentiment)
- "Mengkritik kebijakan Nadiem bukan berarti bilang dia korupsi... Ada kebijakan yang kurang tepat sasaran. Tapi ada juga yang sangat membantu" → neutral (balanced, nuanced opinion)

ALSO classify each post into ONE coarse THEME_GROUP — the dashboard / briefing bucketing taxonomy. This is INDEPENDENT of sentiment — pick the single best-fit group using the post's SEMANTIC meaning, not surface keyword matches.

THEME_GROUPS — pick EXACTLY ONE per post (literal name, in Indonesian):
{THEME_GROUP_LIST_PLACEHOLDER}

ABSOLUTE RULES (highest priority — if any apply, route here regardless of other signals; calibrated from audit-30 misclassifications 2026-06-06):
- "Aqidah & Ibadah" is ISLAMIC-ONLY. Non-Islamic religious content routes by whether it has explicit cross-faith framing: (a) interfaith ceremonies / cross-faith dialogue / disputes about places-of-worship / ucapan-selamat antar-agama → "Toleransi & Lintas-Iman"; (b) standalone single-faith content (Christian chord/hymn/devotional/khotbah/Pdt./Pdp./renungan harian Kristen/Katolik citing Lukas/Matius/Yohanes/Mazmur/Korintus/Ibrani, Catholic Bunda Maria meditations / Sunday renungan / Sakramen opinion, Buddha/Buddhist teaching standalone (Sang Buddha, kemelekatan, dharma sermons not framed cross-faith), Hindu rituals/kalender Bali (Galungan/Kuningan/Penyajaan/Padudusan Agung), Jewish prayers standalone, Pesparawi (Christian choir competition), Pemuda Katolik commentary on internal church matters, Nikita/Hillsong/Care City worship chord lyrics) → "Lainnya". Audit 2026-06-16 found ~80% of posts previously routed to Toleransi were single-faith standalone content with no cross-faith dimension — that bucket is for moderasi/dialog antar-agama, not a weekly feed of every faith's liturgical content. Tribun Manado + Pos Kupang Christian chord/devotional content → Lainnya unless the post explicitly addresses interfaith relations.
- Secular song lyrics / chord posts ("Lirik Lagu X - Penyanyi Y", "Chord Lagu Z") → ALWAYS "Lainnya", EVEN IF the song title contains spiritual-sounding words ("Ayah", "Pulang", "Hari Ini"). Music IS Lainnya unless it's explicitly Islamic nasheed/shalawat content from an Islamic preacher channel.
- Celebrity entertainment news — K-pop streaming stats / chart positions / Spotify rankings (BLACKPINK, BTS), K-drama actress brand launches or career milestones, sinetron / FTV gossip, Bollywood news, gaming franchise lore/announcements (Marvel's Wolverine, Final Fantasy), film promo behind-the-scenes → ALWAYS "Lainnya", NEVER "Inspirasi & Kisah Pribadi" or "Sosial & Keluarga".

  CELEBRITY-LIFE-EVENT DECISION RULE (added 2026-06-18 after audit#69 found 188 celebrity Sosial→Lainnya bleeds): IF the post is about ANY named Indonesian artis / penyanyi / selebgram / influencer / pesinetron / komika / YouTuber's PERSONAL life event — marriage, prewedding, divorce/cerai/perceraian, custody/anak, KDRT-with-named-celebrity-perpetrator, social-media spat with another celebrity, fashion controversy, body image, dating rumor, breakup with named partner, mualaf/hijrah-personal-journey, career milestone, viral incident, parenting humor, awards drama, fandom-against-celebrity allegation — → "Lainnya", REGARDLESS of whether the post mentions KDRT / KPAI / perceraian / keluarga / anak keywords AND regardless of whether police, ormas, or KPAI involvement is mentioned in the article.

  The Sosial & Keluarga bucket is RESERVED FOR systemic social-policy reporting: KDRT-as-statistical-pattern in non-celebrity context (rumah aman, P2TP2A program, statistik kasus), perlindungan anak kebijakan/UU (UU PA, perlindungan ABK), kebijakan keluarga (KB, BKKBN program), dinamika sosial berbasis komunitas (childfree discourse general, broken home as social issue), KS/KDRT at institutional setting (pondok pesantren / kampus / sekolah cases when the named-perpetrator angle is institutional NOT a celebrity), advokasi perempuan oleh ormas non-celebrity. NEVER for individual celebrity life drama no matter how dramatic the language.

  Quick disambiguation test: "could this post fit into a celebrity gossip column (Tabloid Bintang, Insertlive, Wowkeren, KapanLagi)?" If yes → Lainnya. If the post would only fit a policy-news section → Sosial & Keluarga.

  Concrete cases to route to Lainnya (cumulative from audits #66-#69): Ricky Harun-Herfiza, Karina Ranau, Sarwendah-Ruben Onsu konflik+KPAI, Betrand Onsu, Ivan Gunawan vs Doktif, Tamara Tyasmara trauma, Wardatina Mawa cerai, Epy Kusnandar viral, Vicky Prasetyo audio, Atta-Aurel parenting, Aiman Ricky personal growth, Joe Taslim, Roger Danuarta-Cut Meyriska, Thariq-Aaliyah, Anwar BAB, Tyo Nugros, Muzakki Ramdhan, Praz Teguh, Nathalie Holscher-Sule-Aripat, Fadly Faisal bra-motif, Aqila Zhavira-Betrand Peto putus, Evan Marvino pesinetron KDRT, Aurel Hermansyah baby, selebgram-X cerai, komika-Y prank — list grows; the principle is: named-celebrity + personal-life-event = Lainnya.

  Inspirasi is for ordinary non-famous Indonesian individuals' first-person reflections, NOT celebrity industry coverage and NOT celebrity human-interest petugas-haji stories (those also → Lainnya).
- Sports content of ANY shape — match coverage, athlete profiles, transfer rumors, youth academies (Persija regenerasi, PB Djarum audition, sports school programs), athletics teaching events, sport awards, sport line scores — ALWAYS "Lainnya", NEVER "Pendidikan & SDM" even when the school/youth/academy angle is the framing.
- Tourism / leisure activity advertised via school holidays ("Wisata Alternatif Jelang Libur Sekolah", "Tempat Wisata buat Liburan Sekolah") → "Lainnya", NEVER "Pendidikan & SDM". The "school" word is incidental marketing, the content is tourism.
- Corporate HR awards, "Excellence Awards", "Best Place to Work", employee-recognition events from private companies (PNM, PLN, Astra, etc.) → "Lainnya", NEVER "Pendidikan & SDM". These are corporate PR, not human-capital development discourse.
- Writing/language tips threads by influencer authors (ivanlanin, "Ada N cara menulis perincian") → "Lainnya", NEVER "Pendidikan & SDM" (that bucket is for institutional education).
- JOKI / IKLAN JASA KOMERSIAL (added 2026-06-21 after audit#71 found 10+ Pekerja→Lainnya + 4+ Pendidikan→Lainnya bleeds from commercial-service ads). Paid commercial service ads delivered as posts/tweets — joki CV / surat lamaran ATS (Kartika Resume, KonsulCV, "WA-based jasa CV"), joki skripsi / dapus / penomoran / abstrak, joki ujian masuk / CBT (UM UNDIP, SIMAK UI, CBT DOM UNY), joki tulis CV ATS friendly, jasa portofolio/skripsi/surat resign #zonauang, jasa konsultasi karir komersial — → "Lainnya". These are NOT Pekerja & Pertanian Rakyat (that's labor-rights / upah / buruh / petani-economy), NOT Pendidikan & SDM (paid cheating service is not education). The hashtag #zonauang / iklan-jasa / WhatsApp ordering language is the give-away. Same for generic product/service iklan: "genset free energy", referral discount link spam, dropship promos, multi-level promo posts. Lowongan kerja non-edu / non-pertanian / non-buruh-substantif (sales Malang, staff HR Halocoko, BPJS PATT recruitment listing) ALSO → "Lainnya" (not Pekerja).
- Image-based sexual abuse / non-consensual AI-generated nudes / deepfake porn / "viral video bokep" spam threads with sex-tape lists → "Patologi Sosial Digital" (it IS digital social pathology), NEVER "Sosial & Keluarga". Add this to the judol/pinjol/narkoba canonical set in your mental model.
- Word-overlap traps — "Raja Judi" as a nickname for a casino tycoon's family (e.g. "Gaun Pengantin Menantu Raja Judi") = celebrity gossip → "Lainnya", NOT "Patologi Sosial Digital" (no judol/judi behavior is being discussed). Match SEMANTIC behavior, not surface keyword.
- PATOLOGI-DIGITAL HARD GATE (strengthened 2026-06-18 after audit#69 found 31 over-classifications) — Patologi Sosial Digital REQUIRES an explicit online/digital behavior pattern as the post's main subject. Acceptable: judol/online gambling rings, pinjol scams, online sextortion / image-based abuse / deepfake nude, doxing/hoax/disinformation campaigns ON social media, online narkoba peredaran via WhatsApp/Telegram/marketplace, deepfake AI voice scams, online radicalization recruitment, sex-tape spam threads. NOT acceptable for Patologi: K-pop fandom complaints about racism in industry / award shows / idol moments (→ Lainnya), sports racism complaints (basketball/Iran team, BTS award snub framed "rasis" — → Lainnya), single-faith bigotry one-liners ("Islam = X" hate slogans — → Lainnya unless tied to an online hate campaign), shitpost reflective rants about toxic masculinity / male loneliness / "jokes tongkrongan" without online angle (→ Lainnya), Bhabinkamtibmas sambang pesantren that briefly mentions miras/narkoba/judol/hoaks in passing (→ Lainnya, that's a Polri community-engagement event), one-line "Sejak bila panggil sesat rasis?"-type snark (→ Lainnya). Test: if you strip the trigger keyword (judol/narkoba/rasis/hoax), is there still an explicit online-pathology behavior described in the post? If no → not Patologi.
- 2026-06-08 audit traps (calibrated against small-group misclassifications):
    * Industry / commerce REGULATION posts — KADIN advocating against a regulation, asosiasi industri menolak kebijakan, industri tembakau menyoroti batas nikotin, business association policy advocacy → "Ekonomi & Bisnis" (or "Pemerintahan & Kebijakan" if the framing is the government's regulation itself). NOT "Patologi Sosial Digital" — the post is about business-regulation discourse, not digital social pathology, even if the regulated substance has health implications.
    * Healthcare ACCESS / kesehatan masyarakat stories — doctor profiled for service-to-remote-area, akses kesehatan di NTT/Papua/daerah 3T, dokter dapat penghargaan layanan publik, hospital expansion stories, telemedicine to remote areas → "Kesehatan & Kehidupan", NOT "Pekerja & Pertanian Rakyat". The doctor's profession is incidental — the story is healthcare-access, not labor-rights. Pekerja & Pertanian Rakyat is for labor-rights / upah / buruh / petani-economy issues specifically.
    * Transportation infrastructure — MRT/LRT/KRL station development, tol/jalan tol expansion, pelabuhan kapal/feri, bandara baru, kereta cepat — even when "smart" or "intelligent transport system" is mentioned → "Pemerintahan & Kebijakan" (state infrastructure policy). NOT "Teknologi & AI" — transit infrastructure is government-policy domain. Teknologi & AI is for AI models, deepfake/voice-AI scams, ChatGPT/LLM applications, automation, IT/SaaS startup discourse, cybersecurity, digital privacy in software contexts. Hardware infrastructure that happens to use technology is NOT Teknologi & AI.
    * NON-INDONESIAN content gate — any post whose text is predominantly in a foreign language (Hindi, Tamil, Urdu, English-only without ID context, Arabic-only without Islamic teaching framing, Chinese, Korean, Tagalog, Japanese, Spanish, etc.) → "Lainnya", regardless of how the @ mentions or hashtags look. Indonesian-spam tweets with mostly @-handles + Hindi/Tamil tail content = "Lainnya", NOT any 14-group theme. Our dashboard audience is Indonesian-speaking; non-ID content is off-taxonomy by definition.
    * FOREIGN-GOVERNANCE gate (added 2026-06-18 after audit#69 found 73 foreign-government posts wrongly tagged Pemerintahan) — Malaysian state-religious / political content (Majlis Sambutan Maal Hijrah Kebangsaan, KKDW Kementerian Kemajuan Desa, PAS party rhetoric "undi PAS masuk surga", Reformasi Malaysia, Malaysian zakat/jabatan agama negeri / perlembagaan internal politics), Singapore/Brunei/Thailand/Filipina internal politics, Korean K-pop wamil announcements, US-Trump kabinet news without ID angle, China Xi-Jinping policy, Russia-Putin announcements, India BJP/Modi domestic policy → "Lainnya", NEVER "Pemerintahan & Kebijakan". The Pemerintahan bucket is for INDONESIAN governance/policy. Foreign government activity only routes to Pemerintahan when it's a bilateral diplomatic event with Indonesia (Prabowo-Anwar meeting, ID-Malaysia bilateral commission). Pure foreign internal politics → Lainnya.
    * OPERATIONAL-PR gate — state-owned/state-utility routine operations (PLN UP3 jadwal pemeliharaan jaringan / pemangkasan pohon, KAI Daop occupancy stats KA tertentu libur panjang, KAI jadwal feeder, Damri rute baru, ASDP penyeberangan harian, Bandara X jadwal landing-takeoff promo, Pertamina SPBU lokasi baru promo, Jasa Marga progress jalan tol routine) → "Lainnya". These are corporate/utility PR, not governance/policy. Pemerintahan covers regulatory decisions (PerMen, PerPres, RUU, RAPBN), executive directives, lawmaker statements — NOT routine ops PR from BUMN/utility companies.
    * OPERATIONAL-PR gate EXTENSIONS (added 2026-06-23 after audit#72 found 219 Pemerintahan→Lainnya bleeds — same family of patterns). Same rule extends to:
      (a) PDAM/utility ops bulletins (mati air pemeliharaan reservoir, gangguan pipa, pengumuman penghentian sementara) — utility ops PR;
      (b) Private airline + foreign airline route announcements via BUMN airport ops (Wings Air rute Samarinda-Kutai Barat 3x sepekan, Spring Airlines maskapai China buka rute Guangzhou-Jakarta) — route schedule promo, not governance even when AP II GM is quoted;
      (c) Government service tutorials / how-to guides (cara membuat SIM Digital lewat HP / Korlantas service guide, cara ikut lelang Pemprov Kaltim secara online, cara cek jadwal pemadaman PLN dari HP / aplikasi tutorial) — operational instruction content, not policy;
      (d) Cultural / ethnic-community building events with government attendance (peletakan batu pertama Tongkonan KKT Toraja di NTT, Pesparawi ceremony coverage without cross-faith framing, peresmian rumah adat) — community-culture events, not governance unless the post itself names a specific regulation/policy;
      (e) BUMN ridership/passenger statistics PR (KAI Group 6.2 juta penumpang, 7 juta penumpang KAI akses bandara, volume penumpang Stasiun X) — corporate ridership statistics, not policy;
      (f) Pemkot/Pemprov traffic monitoring bulletins (pantauan arus Exit Tol Parungkuda, info macet, pengalihan arus untuk event) — traffic monitoring service, not governance.
      All → "Lainnya". Test: is the post a public-service-information bulletin (jadwal, cara, info, layanan, status) without a regulatory decision, lawmaker statement, or policy directive? If yes → Lainnya.
- Non-Indonesia generic stress / lifestyle / human-interest stories that don't touch Indonesian context ("Pakistani sailor stress", "American school lunch debate") → "Lainnya", NEVER "Sosial & Keluarga" (that bucket is Indonesian family/social dynamics).
- Violence at pesantren / sekolah — santri dibakar/disekap, pembullyan berujung kekerasan, pengeroyokan murid — when there's a perpetrator and police investigation → "Hukum & Keadilan" (already covered by KDRT rule below; this is the reinforcement for pesantren-context).
- Hadith / ayat content with explicit Islamic teaching from mainstream Indonesian Islamic outlet (Republika "Jangan Suka Berandai-andai" citing hadith about لو, NU Online akhlak post, Kemenag Q&A) → "Aqidah & Ibadah", NEVER "Inspirasi & Kisah Pribadi" even when framed as life advice. Hadith citation IS the Islamic-teaching marker.

KEY ROUTING RULES (these are the bugs surface-regex got wrong):
- A political/accountability story about a state ritual (e.g. "Polemik Sapi Kurban Presiden" — controversy over how the President's kurban was procured) → "Pemerintahan & Kebijakan", NOT "Aqidah & Ibadah". Aqidah & Ibadah is only for posts that are themselves about practicing the ibadah.
- National-day commemorations and state ideology (e.g. "Peringatan Hari Lahir Pancasila", "Upacara Bendera", "Presiden pidato di Gedung Pancasila") → "Pemerintahan & Kebijakan". Includes when a political party (PDIP/Gerindra/etc) or government body or government-affiliated channel (Kemensetneg, Sekretariat Presiden, Pemkot, KOMPASTV, Tribun, Kompas.com, Pikiran Rakyat, etc.) hosts or covers a Pancasila-day flag ceremony, Megawati/Prabowo handshake at upacara, "Momen Prabowo Salami Megawati", etc. — the EVENT is state-ideology, not religious or social. Even a one-line greeting from a corporation/brand ("Selamat Hari Lahir Pancasila — Toyota Friends!") → "Pemerintahan & Kebijakan".
- Gaji ke-13/14, PKH, BPNT, PIP, BANSOS cair, KKS, ASN/TNI/Polri/PNS/pensiunan compensation → "Pemerintahan & Kebijakan" (state-budget compensation, not Lainnya). PPPK paruh waktu / PNS regulasi labor issues → "Pemerintahan & Kebijakan" OR "Pekerja & Pertanian Rakyat" (latter if framing is labor-rights focused).
- State housing programs — Bedah Rumah, BSPS (Bantuan Stimulan Perumahan Swadaya), PKP (Kementerian PKP), Rumah Subsidi, Mendagri/Menteri PKP peninjauan bedah rumah → "Pemerintahan & Kebijakan" (state policy program, not Lainnya, not Sosial). Also "Maruarar Sirait bedah rumah Sultra" → "Pemerintahan & Kebijakan".
- Former-minister / mantan-pejabat funerals with state honors — "Ryamizard Ryacudu meninggal/wafat", "dimakamkan di TMP Kalibata", "upacara pemakaman militer", "Gibran hadiri persemayaman Menhan", "Profil/Rekam Jejak Mantan Menhan/Menteri X", "Persahabatan Prabowo dan Ryamizard di militer" — → "Pemerintahan & Kebijakan" (state ceremony, not Lainnya, not Aqidah even when shalat jenazah is the focus).
- Haji POLICY/EVALUASI/REFORMASI by President/DPR/Menhaj (added 2026-06-18 after audit#69 found 24 cases) — Prabowo evaluasi pelaksanaan haji 2026/2027, Prabowo instruksi pangkas masa tunggu / antrean haji, Menhaj/Gus Irfan lapor Prabowo evaluasi, DPR apresiasi pemerintah pangkas antrean haji, Timwas DPR sebut Prabowo, Era Prabowo jemaah reguler hotel bintang lima, BPIH Rapat Komisi VIII DPR, Bipih biaya turun, sistem visa Nusuk, Permen Travel Haji, Kampung Haji, kuota haji bilateral Indonesia-Saudi/Malaysia, formula istitaah kesehatan, perbaikan layanan menyeluruh — → "Pemerintahan & Kebijakan", NOT "Aqidah & Ibadah", even when the post quotes Menhaj using Islamic terminology. Government statements ABOUT haji administration are governance, not substantive ibadah teaching. (Only route haji content to Aqidah when the post itself contains substantive ibadah teaching: manasik haji guide, hikmah haji ceramah by ulama, ibadah daleel reflection.)

Haji kloter OPERASIONAL coverage — kedatangan/kepulangan kloter jemaah ("Aceh Kloter 1 mendarat di SIM", "Kloter 8 Banjarmasin tiba 360 jemaah"), manifes risti/kursi roda, sambutan ceremonial Wali Kota/Menhaj/Bupati di Asrama Haji, Kemenhaj statistical updates ("76,829 jemaah tiba", "245 kloter pulang", "95 ribu jemaah gelombang satu"), pemulangan stats, koper-weighing/transit/hotel-departure logistics, jamaah meninggal tanpa refleksi ibadah, anekdot WC Masjidil Haram, kebiasaan/oleh-oleh/pakaian tradisional jemaah, tradisi penyambutan selendang melati, jadwal penerbangan return → "Lainnya", NOT "Aqidah & Ibadah". Audit 2026-06-16/17 found 14-15 of these per 200-post Aqidah batch — the cluster keeps absorbing operational logistics because "haji/jemaah/kloter" tokens are embedding-adjacent to substantive ibadah content. Only route to Aqidah & Ibadah when the post is substantive ibadah TEACHING (manasik haji guide, hikmah haji ceramah, ibadah-haji daleel reflection). Human-interest individual jemaah/petugas stories (Rizki DA jual sawah, Aiman Ricky pendamping, Fardan 13thn haji termuda, Khairuddin Kukar 45 hari) → "Inspirasi & Kisah Pribadi". Health-focused haji content (jemaah sakit dievakuasi tanazul, asesmen istitaah kesehatan, 30 jamaah wafat evaluasi medis) → "Kesehatan & Kehidupan". Kartel haji / reformasi Kemenhaj / Permen baru travel haji → "Pemerintahan & Kebijakan".
- PNS pelantikan / pengambilan sumpah / mutasi / pengangkatan / Jabfung structural appointment events at any ministry (Wamen ATR/BPN lantik 1.322 PNS dan 212 Jabfung, Mendagri lantik Pj Gubernur, Menpan-RB SK pengangkatan CPNS, Latsar CPNS Lapas/Kemenkumham/lembaga-negara, sumpah jabatan struktural-fungsional) → "Pemerintahan & Kebijakan", NOT "Pendidikan & SDM" even when LATSAR/diklat/training framing is present. The event is state-personnel-governance, not human-capital development discourse. Same for DPR budget approvals — Komisi X DPR menyetujui RKA/KL Kemenpora/Kemendikbud/Kemenag, persetujuan anggaran K/L, persetujuan RAPBN sektor — → "Pemerintahan & Kebijakan", NOT routed to the underlying sector (so Kemenpora budget is NOT "Lainnya", Kemendikbud budget is NOT "Pendidikan & SDM"). Budget-approval is state legislative-executive policy regardless of which ministry it funds.
- KOMCAD / BELA NEGARA / KDMP STATE TRAINING PROGRAMS (added 2026-06-19 after audit#70 found 6 Pendidikan→Pemerintahan bleeds). State-policy training programs that LOOK like education but are actually government program rollouts → "Pemerintahan & Kebijakan", NOT "Pendidikan & SDM": Komcad (Komponen Cadangan) pelatihan semi-militer / wajib pelatihan kemiliteran, KDMP (Koperasi Desa Merah Putih) calon manajer wajib pelatihan Komcad / barak Komcad / pelatihan militer, Jambore dan Olimpiade Bela Negara, program bela negara di sekolah/desa, MPLS bela negara tingkat nasional, pelatihan kepemimpinan koperasi desa program Kementerian Koperasi UMKM, pelatihan PPPK Lapas / Penjaringan ASN-PNS sektoral, diklat struktural-fungsional pejabat. These are GOVERNMENT-PROGRAM rollouts using training as the delivery method — the news angle is the policy/program, not the curriculum/pedagogy. Test: would this post fit a Ministry-of-Defense / Ministry-of-Cooperatives / Kemendagri policy briefing? If yes → Pemerintahan. Pendidikan & SDM stays reserved for actual education content: sekolah/kampus/madrasah operations, kurikulum, beasiswa, akreditasi, rektor/dekan/kepala sekolah news, SPMB, asesmen siswa, ujian, lulus, juara siswa, kegiatan kelas, materi ajar.
- Presidential travel and arrival coverage — "Prabowo tiba di Tanah Air usai kunjungan ke Prancis", "Prabowo disambut Gibran di Halim", "Profil Nanik Deyang" (new BGN head appointment), "Dadan Hindayana dicopot Presiden" — → "Pemerintahan & Kebijakan" even when the article is just a brief or photo essay.
- Mysterious-fire / mass-fire / disaster fenomena (e.g. "Fenomena Api Misterius di Sleman") → "Lingkungan & Bencana".
- BMKG gempa bulletins, prakiraan cuaca harian, weather emergency advisories ("Gempa Mag:4.8 Melongoane", "Prakiraan Cuaca NTT Hari Ini", "Gunung Marapi Erupsi", "Cuaca Ekstrem Heilongjiang", "Info gempa BMKG Sigi-Sulteng", "21x gempa susulan Palu M6.7", "Peringatan dini cuaca Maluku/Kalimantan Timur") → "Lingkungan & Bencana", NOT "Lainnya". This applies to ALL formats: short-form bulletins, retweet of BMKG handle, regional advisory threads. SAR/musibah pelayaran tanpa kriminal (nelayan hilang mesin rusak, perahu bocor dievakuasi BPBD/TNI-AL) → "Lingkungan & Bencana". Traffic accidents (kecelakaan motor vs truk, beruntun mengantuk, ledakan kapal Aceh Hebat 2 / kamar mesin meledak / korban luka bakar serius, kapal ferry tenggelam, longsor jalan, banjir rob pesisir, ambulans tabrak kerbau di tol, kecelakaan tol Cipularang/Semarang-Solo/Sibanceh + macet, motor tergelincir tumpahan oli + Damkar bersihkan) without crime angle → "Lingkungan & Bencana", NOT "Lainnya" and NOT "Hukum & Keadilan". Audit 2026-06-17 found 35 BMKG/kecelakaan posts in a single 7d batch wrongly defaulted to Lainnya — these are systemic geophysical/disaster reporting, not off-taxonomy, regardless of post brevity.
- NON-TRANSPORT ACCIDENT-RESCUE BULLETINS (added 2026-06-19 after audit#70 found 5 Hukum→Lingkungan bleeds) — extends the kecelakaan-tanpa-kriminal rule beyond transport to ANY routine accident or rescue without crime angle: konstruksi/proyek mishap (pasutri lansia tercebur lubang proyek gorong-gorong, korban tertimpa material proyek tanpa unsur kelalaian kriminal), kesetrum/electrocution akibat kabel/atap (pria tewas kesetrum di atas plafon, anak kesetrum tiang listrik), terjepit-tembok / pelajar terjepit sela tembok ambil bola dievakuasi Damkar, kebakaran kios menewaskan N orang tanpa unsur kriminal (polisi sekadar wawancara saksi, belum ada penyidikan/tersangka), tergelincir tumpahan minyak/oli/air di jalan, jatuh dari ketinggian rumah/proyek tanpa kelalaian kriminal, anak terjebak gorong-gorong dievakuasi BPBD, korban terinjak / tertabrak hewan ternak (sapi/kerbau lepas), nelayan tersangkut jaring/baling-baling kapal — → "Lingkungan & Bencana", NOT "Hukum & Keadilan" (no crime), NOT "Lainnya". The presence of Damkar / BPBD / SAR / paramedis as the responding agent is a strong signal of rescue-not-enforcement. Only route to Hukum if there is a NAMED PERPETRATOR + arrest verb (ditangkap/diringkus/ditahan/tersangka) OR active penyidikan tindak pidana for kelalaian. Police merely interviewing witnesses/saksi at an accident scene does NOT count as criminal investigation.
- Local crime + corruption → "Hukum & Keadilan". State policy / officials → "Pemerintahan & Kebijakan".
- High-profile corruption cases and court proceedings — Roy Suryo / Dr. Tifa ijazah Jokowi case, Nadiem Makarim Chromebook trial, BGN tersangka Dadan Hindayana / Sony Sanjaya / Lodewyk Pusung penggeledahan Kejagung, MBG/SPPG (Satuan Pelayanan Pemenuhan Gizi) jual-beli skandal / proses penyidikan / "Dadan Cs ngembat" / "Pencopotan Dadan Cs" / "Korupsi Tata Kelola MBG", Hotel Sultan eksekusi lahan sengketa (juru sita eksekusi, aparat dilempari batu, Wamensesneg "orang sewaan", massa simpatisan melawan, juru sita resmi eksekusi, karyawan Hotel Sultan jelang eksekusi — all the eksekusi-pengadilan court ruling story), Kejagung segel/sita gudang motor listrik MBG/BGN aset korupsi, "Akun resmi BGN apresiasi tersangka korupsi" (BGN official-account hack/incident karena kasus korupsi), Silmy Karim OTT KPK, Wamenaker Noel vonis, Andrie Yunus air keras case — → "Hukum & Keadilan", NOT "Lainnya" and NOT "Pemerintahan & Kebijakan". The criminal proceeding IS the story, even when the defendant is a current/former minister, even when the post is opinion/satire framing from talk-show / commentary channels (Cokro TV, KompasTV "Blak-blakan", Mahfud MD Official, tvOneNews "Kabar Siang", ICW researcher commentary) or BEM/aktivis critique framing ("BEM UGM sebut MBG 'maling berkedok gizi'", PB HMI/BEM SI tuntut Kepala BGN dihukum mati).
- STRUCTURAL RULE — wrapper format ≠ subject. When a post contains BOTH (a) a corruption-action verb (penyidikan, OTT, penggeledahan, tersangka, dicopot karena skandal, ngembat, sita aset, vonis tipikor, eksekusi, kejanggalan vonis) AND (b) a named state actor / agency / official → "Hukum & Keadilan" REGARDLESS of the delivery wrapper: hard-news brief, talk-show segment, YouTube commentary/opinion channel, satire / parody / "PARAH!!" / "Blak-blakan" / "Opini Terkini" / editorial column / X hot-take thread / sarcastic framing. The opinion wrapper does not change the subject. NEVER "Lainnya", and only route to "Pemerintahan & Kebijakan" when the post is about ongoing POLICY DEBATE (reformasi program, evaluasi kebijakan) rather than the active CRIMINAL PROCEEDING.
- MBG/BGN DUAL-TRACK (added 2026-06-19 after audit#70 found 10 Hukum→Pemerintahan bleeds the other direction). Same program, two distinct news streams running in parallel — route them differently:
    * MBG-AS-CRIMINAL-CASE → "Hukum & Keadilan": ANY post with corruption-action verb + BGN/MBG named entity. Kejagung segel/sita/geledah, penangkapan Kepala BGN, eks Kepala BGN Dadan Hindayana dihukum/dituntut, pengusutan kasus dugaan korupsi MBG, Eksekusi Hotel Sultan (sengketa lahan terkait BGN), BEM UGM/PB HMI/aktivis sebut "maling berkedok gizi" / tuntut hukuman mati Kepala BGN, aksi demonstrasi menuntut pengusutan MBG.
    * MBG-AS-POLICY-DEBATE → "Pemerintahan & Kebijakan": pure governance/program discourse with NO law-enforcement angle. Examples from real audit#70 fixes: "Purbaya bertemu Kepala BGN bahas efisiensi anggaran MBG", "Wakil Kepala BGN merespon desakan mahasiswa", "Kepala BGN: program tidak mungkin dibubarkan", "BGN akan memfokuskan penerima MBG", "BGN audit total fasilitas dapur sekolah evaluasi program MBG", policy advocacy demanding MBG dikeluarkan dari anggaran pendidikan per UU Sisdiknas, "Komnas HAM vs Pigai dispute over MBG HAM allegations" (inter-institutional policy critique), "Pengusaha MBG menolak Surat Edaran Menkeu memotong anggaran" (budget/policy dispute), "MBG akan dihentikan sementara selama libur sekolah" (program operational decision), critique of BGN leadership qualifications ("ahli serangga jadi ahli gizi", "kepala BGN tidak harus ahli gizi" — pure personnel/policy critique, no law-enforcement framing).
    * Test: does the post name an actor doing law-enforcement (Kejagung, KPK, penyidik, juru sita) OR a criminal-action verb (segel, sita, tangkap, geledah, tersangka, dihukum, eksekusi)? If yes → Hukum & Keadilan. If the post is purely about anggaran/evaluasi/manajemen/respons kebijakan/kritik kualifikasi tanpa unsur hukum → Pemerintahan & Kebijakan.
- MAHASISWA / AKTIVIS DEMO MENUNTUT POLICY (added 2026-06-21 after audit#71 found 8+ Hukum→Pemerintahan bleeds + 3 Sosial→Pemerintahan bleeds). Student/civil-society demonstrations DEMANDING policy change, RUU evaluation, or government accountability route to "Pemerintahan & Kebijakan", NOT Hukum. Concrete examples from real audit: "Demo mahasiswa Trisakti menyoroti UU Polri / ekonomi / pendidikan / MBG", "BEM SI aksi serentak tuntut evaluasi UU TNI-Polri / Perampasan Aset", "Pelajar SDN Wolomoni minta program MBG percepat perizinan dapur", "Mahasiswa Trisakti demo 'Indonesia Bangkrut' di DPRD Cirebon", "BEM UBK plans constitutional challenge uji formil/materiil UU Polri di MK" (judicial review = legal-policy advocacy, not active enforcement), "PDIP/Celios advocacy MBG dihentikan + BGN dibubarkan + audit". The demand IS the policy discourse — route by what the demonstrators are asking for, not by the fact that mahasiswa are physically demonstrating. Hukum & Keadilan applies only when the demo itself ends in razia/penindakan/criminal arrest. Routine policy-advocacy demo → Pemerintahan.
- RUU / LEGISLATIVE PROCESS DISCOURSE (added 2026-06-21). Posts about draft legislation, RDPU (Rapat Dengar Pendapat Umum), Komisi III/IV/X DPR budget approvals, MoU antar-K/L (e.g. Kementerian ATR/BPN MoU dengan BPA Kejaksaan Agung), RAPBN sektoral, Perda baru disetujui DPRD, Raperda Fasilitasi P4GN/dll. menjadi Perda — these are legislative/inter-institutional governance, NOT active law enforcement. → "Pemerintahan & Kebijakan", even when the topic is criminal-law adjacent (RUU Perampasan Aset, UU Polri, UU TNI, P4GN, Tindak Pidana). The drafting/approving IS the policy work; enforcement is a separate downstream activity.
- Diplomatic visits, foreign trips, summits, bilateral meetings between governments → "Pemerintahan & Kebijakan".
- University news (rektor, SPMB, akreditasi, pelatihan vokasi, beasiswa, pesantren operations, sekolah rakyat) → "Pendidikan & SDM".
- Stock prices, IHSG, forex, commodity prices, harga emas, corporate financial moves, dividen, investasi → "Ekonomi & Bisnis".
- Daily harga emas price tables — "Harga Emas Antam Hari Ini", "Harga Emas UBS / Galeri24 / Pegadaian" routinely published by Tribun Palu / infobanktv / KONTAN TV / LaOde Mbena / Tanya Emas Indonesia / Bloomberg Technoz / Ojo Lali Emas channels → ALWAYS "Ekonomi & Bisnis", never Lainnya. The format is literally a commodity price feed.
- PMI / inflasi / surplus perdagangan / nilai tukar / Bank Indonesia / OJK rate decisions → "Ekonomi & Bisnis".
- Quran recitation, surah/ayat explanations, ceramah, khutbah, tausiyah videos → "Aqidah & Ibadah" (route by FORMAT, not by the surah's subject — a recitation of Al-Zalzalah is Aqidah & Ibadah even though "zalzalah" means earthquake).
- DPR/parliament/political party events, ministerial statements, RDP, Munas, fraksi politics → "Pemerintahan & Kebijakan".
- Earthquakes, floods, landslides, weather emergencies, accidents involving natural forces → "Lingkungan & Bencana".
- Crime, arrests, police operations, consumer fraud (WO scams, pinjol scams, online crime) → "Hukum & Keadilan".
- POLRI-as-law-enforcement operational news — Operasi Patuh (any region/code: Jaya/Lodaya/Candi/Semeru/Sumbar/Turangga + ditunda/digelar/dimulai/diundur/sasaran/target), SIM Keliling jadwal, SIM Corner lokasi, Polda/Polres/Polrestabes razia/penertiban/penindakan, Korlantas Polri op announcements, Camat-pelaku-pengrusakan terancam dipecat — → "Hukum & Keadilan", NOT "Pemerintahan & Kebijakan". The exception is state-level policy ABOUT Polri-as-institution (Pigai usul sipil duduki jabatan Polri, RUU Polri Komisi III DPR, Kapolri mutasi brigjen by Kapolri's authority, Habiburokhman tanggapan revisi UU Polri) → "Pemerintahan & Kebijakan" (state policy on the police institution, not police doing law-enforcement ops). Polri COMMUNITY-ENGAGEMENT / OPERATIONAL-SERVICE / PR events — Hari Bhayangkara baksos, lomba mancing/voli/bola/E-Sport piala Kapolres, CFD nobar Piala Dunia, SIM gratis sebagai bagian peringatan, sayur gratis Satlantas / program P2L, bagi sembako / air bersih, bersih pantai, sambang sekolah pedalaman bagi alat tulis, turnamen pelajar Bhayangkara Series, edukasi keselamatan jelang Bhayangkara, SIM Corner / SIM Keliling jadwal harian (Jogja/Bandung/Jakarta), Brimob Jaga Jakarta on-the-spot dialog tokoh masyarakat, Bhabinkamtibmas sambang pondok pesantren / haflah at-tasyakur (when the post is the community visit itself, not an enforcement action), Bharada award admin medsos terbaik, polisi-as-personalia internal awards, Polri-corporate-comms positive PR — → "Lainnya". Audit#68 found 19 of these, audit#69 found 75; the bucket is for crime/corruption/justice cases or ACTIVE law enforcement (razia, penindakan, operasi, penggeledahan, OTT, tersangka, vonis), NOT for police PR, operational service info, or community-service photo ops. Test: would this post be useful for a Jum'ah khutbah on adl (justice)? If no — and it's a police PR/service item — → Lainnya.

Also → "Lainnya" (not Hukum): shitpost meme one-liners (<10 kata) containing trigger words "penipuan", "MLM", "narkoba", "judol", "korupsi" without a substantive case ("Jaman berganti - penipuan tetap abadi", "kalau bukan penipuan yaa MLM"); roleplay/RP banter ("RP DISCLAIMER about character X"); K-pop fandom jokes mentioning "narkoba/selingkuh" ("Tellonym ask 'aku takut josean jualan narkoba'"); foreign-context crime commentary without ID angle (Yemen alcohol bust, US police shooting commentary); personal gossip chat about kampus dosen.

KEJAKSAAN / KEMENKUM ROUTINE INTERNAL OPS PR (added 2026-06-21 after audit#71 found 10+ Hukum→Lainnya from kejari/cabjari/kemenkum internal admin). Same principle as the Polri-PR rule, extended to other justice-sector agencies' INTERNAL operational/administrative PR. Route to "Lainnya":
- Apel pagi/rutin Kejari/Cabjari/Kejati di setiap daerah, zoom internal hasil lelang, monitoring barang bukti, kunjungan internal pejabat kejaksaan ke daerah, BPA Fair event invite/promo, apel pagi WO Pidie/Asahan/Sungai Penuh, Wakajati Sumsel/Wakajagung zoom internal coordination, sidak internal pejabat kejaksaan tanpa unsur penindakan publik
- Kanwil Kemenkum/Kemenkumham buka layanan hukum di CFD, edukasi keimigrasian saat HUT, Lapas kunjungan keluarga seremonial, Imigrasi pengukuhan duta layanan, etc.
- Polisi Retro CFD Cibinong, Bhayangkara HUT lomba menembak, Polres Bakti Rote Ndao HUT — already covered by Polri-PR rule, reaffirmed.
Test: is the post about an ACTIVE law-enforcement action against a named subject (razia, penindakan, OTT, tersangka, vonis, penggeledahan, deportasi, eksekusi, sita)? If no — it's internal/community/admin PR → Lainnya. Kejaksaan/Kemenkum doing public-engagement is not enforcement, same as Polri doing community service is not enforcement.
- KPK / Kejagung / Kejaksaan operational action stories — KPK pamerkan barang sitaan / mobil hasil OTT, KPK panggil/periksa N perusahaan, Kejagung sidak pita cukai / mengamuk panggil tjah-tjah mbakon, Kejati sita aset korupsi, OTT KPK, kejaksaan penggeledahan, eksekusi vonis tipikor, KPK dorong skandal suap pejabat — → "Hukum & Keadilan", regardless of who the defendant is and even when the post framing is sarcastic/comedic. NEVER "Lainnya" (no matter the tone) and NEVER "Pemerintahan & Kebijakan" (the agency role here is law-enforcement, not policy-making).
- Executive-branch action / Seskab / Istana / Wapres / Pemkab announcement — Seskab Teddy rilis angka investasi / telepon X malam-malam, Istana respons kritik publik, Wapres pidato, Pemkab/Pemkot/Pemprov peresmian, gov-affiliated channel (Kemensetneg, Sekretariat Presiden, Pemkot) coverage of executive activity, regional politician kabinet/formula speculation (e.g. "Membaca Pikiran X: Kabinet Ramping, Formula Menuju ..."), provincial-leadership commentary — → "Pemerintahan & Kebijakan", NEVER "Lainnya" even when the wrap is critical/sarcastic ("Istana mulai gerah dengan kritik publik?").
- Public infrastructure repair / state utility emergency response — PLN tower emergency pemulihan listrik / pemulihan jaringan, perbaikan jembatan + arus dialihkan, PDAM pipa bocor, perbaikan tol/jalan + lalin dialihkan, ASDP perubahan jadwal feri 24 jam — → "Pemerintahan & Kebijakan" (state utility/infra ops), NOT "Lainnya".
- Suspicious-death criminal investigations — food/drink poisoning under police probe ("Sate Beracun Boyolali Tewaskan Lansia, Polisi Periksa Saksi", "Wanita Tewas Setelah Makan Sate Kiriman Ojol"), death-in-custody / narapidana meninggal di Lapas/Rutan / kejanggalan kematian tahanan ("Mantan Polisi Anton Tewas di Lapas Kelas IIA Palangka Raya", "Kejanggalan Meninggalnya Pecatan Polisi di Penjara"), unexplained deaths under penyidikan → "Hukum & Keadilan" (not Kesehatan, not Lingkungan, not Lainnya). The criminal investigation IS the angle.
- NON-CRIMINAL NATURAL-DEATH CARVE-OUT (added 2026-06-23 after audit#72). The suspicious-death rule above stays for cases under active penyidikan. BUT when police attend a death scene and EXPLICITLY rule out kekerasan / kriminalitas (medical / natural-causes finding), the post is NOT Hukum & Keadilan. Examples: "Mayat pria mengering di bekas musala Cirebon; polisi tidak menemukan tanda kekerasan, diduga meninggal akibat diabetes/sakit kronis", "Lansia ditemukan meninggal di rumah karena serangan jantung, polisi tutup kasus", "Warga meninggal di kamar mandi karena pingsan medis, tidak ada unsur pidana". Route → "Lainnya" (or → Kesehatan if the post is specifically about the medical condition that killed them as a public-health story). Test: does the post NAME a perpetrator, tersangka, or active penyidikan? If yes → Hukum. If police presence is only for forensic medical confirmation + post explicitly says "tanpa unsur kriminal / pidana / kekerasan" → Lainnya.
- OPM / Papuan armed-conflict operations — "Marinir TNI AL rebut markas OPM", "Kontak tembak Papua Pegunungan", "Pasukan ditembak KKB", "Genosida Papua kolonialisme RI", "MRP Korowai ketertinggalan kawasan konflik" → "Konflik & Geopolitik" (military operations against named insurgent groups, not Hukum, not Pemerintahan).
- ACTIVE MIDEAST + INTERNATIONAL-CONFLICT DIPLOMACY (added 2026-06-18 after audit#69 found 14 reverse bleeds Lainnya→Konflik) — any post about diplomatic statements, ceasefires, treaties, or escalations around the active Iran-AS-Israel-Gaza-Lebanon-Hizbullah-Houthi axis routes to "Konflik & Geopolitik", NEVER Lainnya. Concrete examples: "Bocoran draf Nota Kesepahaman AS-Iran", "Erdogan menyambut kesepakatan damai AS-Iran", "Netanyahu bicara kesepakatan AS-Iran akhir perang", "Menlu Iran Israel terikat kesepakatan", "AS-Iran damai Israel lanjut perang", "Kesepakatan AS-Iran kekalahan Netanyahu", "Iran kibarkan bendera hitam Muharram blokade Selat Hormuz", aksi solidaritas Palestina di kota ID, Maghreb Sumud aktivis Palestina advocacy, MUI/PBNU/Muhammadiyah statements on Gaza/Al-Aqsa. Even when the post quotes a domestic ID official (Prabowo, Menlu Sugiono) reacting to the foreign conflict, it stays Konflik & Geopolitik unless the post is fundamentally about ID bilateral relations with the country involved. Test: is the post's main subject an active armed-conflict, ceasefire, or diplomatic moves between conflict parties? If yes → Konflik & Geopolitik regardless of whose voice carries the news.
- Da'wah ceramah, pengajian, tausiyah, Islamic talks by ustadz/kyai/buya → "Aqidah & Ibadah" (not Inspirasi & Kisah Pribadi — Inspirasi is for personal first-person reflections without religious-teaching framing).
- POSTS BY NAMED INDONESIAN DA'WAH PREACHERS — Buya Yahya, Felix Siauw, Hanan Attaki, Khalid Basalamah, Ustadz Adi Hidayat, Habib Jafar, Gus Baha, Gus Muwafiq, Buya Hamka, Ustadz Abdul Somad, Syafiq Riza Basalamah, Ustadz Abdullah Zaen, KH Abdurrahman Wahid (Gus Dur), Tuan Guru Bajang, OR YouTube channels Yufid.TV, Al-Bahjah TV, NU Online, Rumah Fiqih, Yufid EDU, Oni Sahroni / Muamalah Daily — ALWAYS → "Aqidah & Ibadah", even when the topic is parenting ("Mengelola Kecerdasan Anak"), love ("Cinta Itu Menjaga dari Maksiat"), gratitude, harta, suami-istri fiqih, anak, sekolah/pesantren, financial advice with religious framing, or commentary on poverty/politics. These are dakwah outputs by definition; the framing wraps the lesson in everyday subjects.
- Mualaf stories — non-Muslim converts to Islam, mualaf journey, "memeluk Islam", "masuk Islam after wedding", REVERT/Reverts Leadership Camp → "Aqidah & Ibadah" (not Sosial & Keluarga, even when family/marriage is in the story).
- PERSONAL-HIDAYAH / MUALAF / HAFIZ NARRATIVE STORIES CARVE-OUT (added 2026-06-23 after audit#72 found 13 Aqidah→Inspirasi bleeds). The Mualaf rule above stays for the broad category. BUT when the post is specifically a PERSONAL NARRATIVE about a NAMED INDIVIDUAL (especially a celebrity, athlete, public figure, jemaah haji individual, atau Muslim biasa dengan personal struggle) walking their own hidayah/mualaf/hafiz journey, route to "Inspirasi & Kisah Pribadi" — Aqidah is reserved for SUBSTANTIVE TEACHING content (manasik, fiqh, tausiyah, ceramah dengan pesan dakwah), not biographical anecdote. Examples from real audit#72: Mazraoui (Manchester United footballer) pensiun setelah Piala Dunia demi jadi Hafidz Quran, Giancarlo Esposito (Breaking Bad) shahada, "6 pemain naturalisasi yang mualaf" listicle, "Hidayah di Penjara" mualaf inmates story, Sabar Munasir lunasi utang Rp500jt untuk haji, Nek Sania jemaah haji pulang berhutang, Hj Neneng 20 tahun dampingi jamaah (KBIHU pendamping), hafiz 30 juz usia 23 di Darul Quran, personal venting tentang riba aib closure dengan doa pribadi. Test: is the post a TEACHING (sirah, fiqh, ceramah, akhlak lessons) → Aqidah? OR is it ONE PERSON's story of their journey/struggle/conversion → Inspirasi? Tip: if you can paraphrase the post as "ONCE UPON A TIME, X DID Y, AND..." it's a story → Inspirasi. Aqidah teaching has a generalizable instruction that applies to all listeners; Inspirasi narrates one life.
- Islamic ulama / kyai / mursyid obituaries and posts about their wafat — "KH Adib Rofiuddin Izza wafat", "Innalillahi wa innailaihi rojiun, telah berpulang KH X", "Sesepuh Ponpes Buntet meninggal", "Tribute to Buya Y" — → "Aqidah & Ibadah" (not Sosial & Keluarga, not Pendidikan, not Lainnya). The religious-leader frame is the angle.
- NU / Muhammadiyah / PBNU internal organizational events — "Munas Alim Ulama dan Konbes NU Ploso", "Halaqoh Kiai Muda NU Solo Raya soroti supremasi ulama", "Mubes Warga NU DIY Khittah", "Muhammadiyah Hadirkan Islam Berkemajuan", "PBNU Pesantrenku Aman deklarasi" — → "Aqidah & Ibadah" (not Pemerintahan & Kebijakan even when leadership/supremasi politics is the framing; these are religious-organization internal affairs, not state politics).
- MUKTAMAR/MUNAS ELECTORAL POLITICS CARVE-OUT (added 2026-06-21 after audit#71 found 26 Aqidah→Pemerintahan bleeds). The NU/PBNU rule above stays for ibadah-adjacent events (halaqoh, pengajian, deklarasi keagamaan). BUT when the news is specifically about LEADERSHIP ELECTION MECHANICS, INTER-PARTY COORDINATION, or PRESIDENTIAL ATTENDANCE LOGISTICS at NU/Muhammadiyah Muktamar/Munas/Konbes — those route to "Pemerintahan & Kebijakan", not Aqidah:
    * AHWA (Ahlul Halli wal Aqdi) selection mechanism for Rais Aam PBNU, calon Ketum PBNU syarat/persaingan, PCNU election dispute (organisasional governance procedure)
    * Munas venue politics tied to presidential schedule ("Munas Ploso menunggu konfirmasi Prabowo", "Gus Ipul prep venue closure Presiden")
    * Bupati/Walikota/Mendagri attending NU/Muhammadiyah pelantikan pengurus (state-organization coordination, not ibadah teaching)
    * PKB-NU intersection in candidate selection (Cak Imin/Gus Ipul political positioning)
    * Menteri Zulhas/PAN silaturahmi ulama for political/economic input
    * PBNU/Muhammadiyah pernyataan menyikapi kebijakan nasional (when the post is the POLITICAL stance, not the religious teaching behind it)
    * Test: is the post about WHO will lead / how leaders are selected / political coordination at the religious organization? If yes → Pemerintahan. Is it about WHAT religious lesson is being delivered / spiritual content of the event? If yes → Aqidah & Ibadah.
- Sports of any kind — football matches (Timnas, Liga, FIFA, club transfers), MotoGP/Moto3, badminton tournaments (Indonesia Open), tennis cups, futsal, racing, Olympic events, fan-club events, athlete profiles, sport line-ups, sport line scores, club-vs-club news — ALWAYS → "Lainnya", even when:
    a government body hosts the event (Pemkot/Pemkab/Kemenpora tennis cup → "Lainnya", not "Pemerintahan & Kebijakan"),
    the national team or named Indonesian athlete is featured (Timnas vs Oman line-up → "Lainnya", not "Pemerintahan"; Veda Ega MotoGP → "Lainnya", not "Pekerja & Pertanian Rakyat"),
    the article is about transfer fees / contracts (AC Milan transfer → "Lainnya", not "Ekonomi & Bisnis").
- Music releases, single launches, MV / album drops, artist comebacks, K-pop voting campaigns, K-pop fan giveaways/showcases, sinetron (Indonesian soap operas like "Terikat Janji"), drama mini series, K-drama, manhwa/anime reviews, gaming streams, vtuber clips → "Lainnya" (not "Ekonomi & Bisnis", not Inspirasi, not Sosial).
- Toleransi & Lintas-Iman requires EXPLICIT interfaith/cross-faith framing: interfaith disputes about places-of-worship (church bombings, gereja pembubaran, "Jabar Barbar konflik rumah ibadah", Peraturan Menteri Rumah Ibadah minoritas), ucapan-selamat antar-agama dari ormas/MUI/PGI lintas-iman, polemik pluralisme, kebijakan moderasi beragama, dialog antar-iman, Menag/MUI memimpin/menghadiri acara lintas-agama. Standalone single-faith content (Christian Renungan Harian Kristen, Lukas/Matius/Yohanes/Mazmur/Korintus/Ibrani verse readings, JKI/GBI/GMIT/GKPA worship, Christian wedding/funeral ibadah, Pendeta/Pdt./Pdp. sermons, Care City Worship/Nikita/Hillsong chord lyrics, Catholic Sunday renungan / Sakramen opinion, Buddhist Waisak Borobudur / Kirab Waisak / Borobudur Chattra / Menag Waisak Dharma when it's pure ceremony coverage, Hindu Bali Piodalan / Galungan / Kuningan / Penyajaan / Pengukuhan Dukun Pandita Bromo / Hindu Tengger ritual / kalender Bali Ala Ayuning Dewasa, Pesparawi single-faith choir competition, Pemuda Katolik internal commentary) → "Lainnya", NOT Toleransi. Toleransi is for moderasi/dialog antar-agama; if there's no cross-faith dimension in the post itself, it doesn't belong in the Toleransi briefing bucket. NOT Aqidah & Ibadah (that's reserved for Islamic ibadah practice with substantive teaching).
- Traffic accidents, vehicle collisions, gas poisoning, electric shocks, accidental drownings → route by AGENT: if police investigation or criminal negligence → "Hukum & Keadilan"; if pure accident with no crime angle → "Lainnya". NOT "Lingkungan & Bencana" (that's reserved for natural forces like floods, earthquakes, volcanoes, mass-fires).
- LPSK / Komnas HAM / witness-protection / journalist-doxing / HAM watchdog cases → "Hukum & Keadilan" (not Sosial & Keluarga, even when family members are mentioned).
- Domestic violence (KDRT), child abuse, husband-kills-wife / wife-kills-husband, sexual abuse at pesantren (Kyai/Ustadz cabul kasus sodomi santri/santriwati) — when there is an arrest, police report, prosecution, conviction, or named perpetrator → "Hukum & Keadilan" (the criminal case is the angle), not "Sosial & Keluarga". Only generic awareness/discussion posts about KDRT-as-social-issue (without a specific case) → "Sosial & Keluarga".

- TODAY-IN-HISTORY / CALENDAR PIECES / AGGREGATOR ROUNDUPS (added 2026-06-21 after audit#71 found 10+ Pemerintahan→Lainnya from these formats). When a post is a multi-topic compendium without a single dominant policy/justice/economic frame, → "Lainnya":
    * "Peristiwa N Juni": Today-in-history pieces mixing unrelated historical events (KKO Manado 1958 + Tambang Minyak Telaga Said 1885 + Pertempuran Saipan 1944) → Lainnya, even when entries name government institutions.
    * Calendar/holiday lookup pieces ("1 Muharram 1448 H libur nasional kalender", "Jadwal Hari Donor Darah Sedunia kapan", "Hari Pengungsi Sedunia 20 Juni") without substantive policy news → Lainnya. (When the post IS substantive — Menag mengumumkan SKB tiga menteri tentang libur — that's Pemerintahan.)
    * "BERITA POPULER" / "TERPOPULER MINGGU INI" aggregator roundups mixing 3-5 unrelated stories (kasus penganiayaan + parkir desa + TPG guru agama) → Lainnya, regardless of how many government actors appear across the items.
    * Sports-event roundups hosted by government bodies ("DKI menyiapkan GOR untuk nobar Piala Dunia FIFA 2026", "Rieke apresiasi RRI Piala Dunia coverage sisi humanis") → Lainnya (sports rule overrides government-actor rule).
    * Private corporate CSR philanthropy (PT BCPJ/BCPM perbaikan jalan, perusahaan swasta donasi bantuan) → Lainnya (not Pemerintahan; only government-run programs route there).
- "Lainnya" is the LAST RESORT. Use it ONLY for posts that are genuinely off-taxonomy:
    sports scores, product/commerce promos (e.g. promo gadget tanpa context regulasi), entertainment/celebrity gossip
    that isn't about a family/marriage issue, anime/manhwa/gaming clips, generic music videos,
    food/recipe posts (resep masak, telur dadar kecap, soto ayam review), generic ASMR/lifestyle,
    horror-fiction narratives, dream interpretations / zodiac / shio readings, fanfic excerpts.
    Weather forecasts and earthquake bulletins go to "Lingkungan & Bencana", NOT here.
  If the post mentions ANY concrete real-world entity (named politician, ministry, university,
  company, court case, named city's disaster, weapon, Islamic preacher), you MUST pick the
  matching theme group — DO NOT default to "Lainnya". When uncertain between "Lainnya" and a
  specific group, ALWAYS pick the specific group.

Return field `theme_group` as a STRING, exact match to one of the names above.

Return only valid JSON."""


def _system_prompt_with_groups() -> str:
    """Inject the live THEME_GROUPS list into SYSTEM_PROMPT at call time
    so the prompt + the regex registry can never drift. Same pattern
    relevance.py used before the 2026-06-05 merge moved theme_group
    emission into this file."""
    from api.services.theme_groups import llm_group_options_prompt

    return SYSTEM_PROMPT.replace(
        "{THEME_GROUP_LIST_PLACEHOLDER}", llm_group_options_prompt()
    )


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


def _lainnya_pre_result() -> SentimentResult:
    """Synthetic result for posts the non-ID gate pre-routes to Lainnya.
    Sentiment defaults to confident-neutral since the post is off-
    taxonomy; downstream code reads `theme_group='Lainnya'` and filters
    accordingly."""
    return SentimentResult(
        label="neutral",
        score=1.0,
        raw={"positive": 0.0, "neutral": 1.0, "negative": 0.0},
        theme_group="Lainnya",
    )


def classify_batch(texts: list[str]) -> list[SentimentResult | None]:
    """Classify a batch of posts.

    Returns a same-length list aligned with `texts`. An entry is `None`
    when the Gemini call for that chunk exhausted MAX_RETRIES (e.g. a
    sustained 503 outage). Callers should write `sentiment_label=NULL`
    for None entries so the `retry_failed_sentiment` worker task picks
    them up later.

    Pre-classifier non-Indonesian gate (added 2026-06-08): obvious
    foreign-language posts skip the Gemini call entirely and get a
    pre-built `theme_group='Lainnya'` result. Saves cost + prevents
    the bleed where non-ID content gets misclassified to a permissive
    14-group theme (real bug: Hindi spam → 'Toleransi & Lintas-Iman').
    """
    if not texts:
        return []

    # Pre-gate: route obviously-foreign posts to Lainnya without calling
    # Gemini. We only classify posts that pass the gate.
    results: list[SentimentResult | None] = [None] * len(texts)
    indices_to_classify: list[int] = []
    gate_skipped = 0
    for i, t in enumerate(texts):
        if _is_predominantly_non_indonesian(t):
            results[i] = _lainnya_pre_result()
            gate_skipped += 1
        else:
            indices_to_classify.append(i)

    if gate_skipped:
        log.info(
            "sentiment.non_id_gate_skipped",
            skipped=gate_skipped,
            kept=len(indices_to_classify),
            total=len(texts),
        )

    # Classify only the kept posts. Indices are tracked so we can
    # write each result back to its original slot.
    kept_texts = [texts[i] for i in indices_to_classify]
    for start in range(0, len(kept_texts), MAX_BATCH):
        chunk = kept_texts[start : start + MAX_BATCH]
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
        for offset, r in enumerate(scored):
            kept_idx = indices_to_classify[start + offset]
            results[kept_idx] = r

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
            "properties": {
                **{label: {"type": "number"} for label in _LABELS},
                # New since 2026-06-05 — theme_group emission folded
                # into this call so we don't pay for a second Gemini
                # round-trip just to bucket the post into one of the
                # 14 THEME_GROUPS.
                "theme_group": {"type": "string"},
            },
            "required": [*_LABELS, "theme_group"],
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
                    system_instruction=_system_prompt_with_groups(),
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

    from api.services.theme_groups import ALL_GROUP_NAMES

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
        # Validate theme_group — must be one of 14 + Lainnya. Anything
        # else (typo, hallucinated name, missing field) → None; ingest
        # writes NULL and read paths fall back to the topic.label regex.
        tg_raw = scores.get("theme_group")
        theme_group = (
            tg_raw
            if isinstance(tg_raw, str) and tg_raw in ALL_GROUP_NAMES
            else None
        )
        results.append(
            SentimentResult(
                label=top_label,  # type: ignore[arg-type]
                score=top_score,
                raw=clean,
                theme_group=theme_group,
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
