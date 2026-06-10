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
- "Aqidah & Ibadah" is ISLAMIC-ONLY. Any non-Islamic religious content — Christian chord/hymn/devotional/khotbah/Pdt./Pdp./renungan harian Kristen/Katolik, Catholic Bunda Maria meditations, Buddha/Buddhist teaching (Sang Buddha, kemelekatan, dharma), Hindu rituals/kalender Bali, Jewish prayers (Mi Sheberakh, Avraham/Yitzhak), interfaith ceremonies, Pesparawi (Christian choir competition), Pemuda Katolik commentary — ALWAYS → "Toleransi & Lintas-Iman". Tribun Manado + Pos Kupang frequently publish Christian chord/devotional content that LOOKS like religious content but is NOT Islamic; route those to Toleransi.
- Secular song lyrics / chord posts ("Lirik Lagu X - Penyanyi Y", "Chord Lagu Z") → ALWAYS "Lainnya", EVEN IF the song title contains spiritual-sounding words ("Ayah", "Pulang", "Hari Ini"). Music IS Lainnya unless it's explicitly Islamic nasheed/shalawat content from an Islamic preacher channel.
- Celebrity entertainment news — K-pop streaming stats / chart positions / Spotify rankings (BLACKPINK, BTS), K-drama actress brand launches or career milestones, sinetron / FTV gossip, Bollywood news, gaming franchise lore/announcements (Marvel's Wolverine, Final Fantasy), film promo behind-the-scenes → ALWAYS "Lainnya", NEVER "Inspirasi & Kisah Pribadi" or "Sosial & Keluarga". Inspirasi is for ordinary Indonesian individuals' first-person reflections, not celebrity industry coverage.
- Sports content of ANY shape — match coverage, athlete profiles, transfer rumors, youth academies (Persija regenerasi, PB Djarum audition, sports school programs), athletics teaching events, sport awards, sport line scores — ALWAYS "Lainnya", NEVER "Pendidikan & SDM" even when the school/youth/academy angle is the framing.
- Tourism / leisure activity advertised via school holidays ("Wisata Alternatif Jelang Libur Sekolah", "Tempat Wisata buat Liburan Sekolah") → "Lainnya", NEVER "Pendidikan & SDM". The "school" word is incidental marketing, the content is tourism.
- Corporate HR awards, "Excellence Awards", "Best Place to Work", employee-recognition events from private companies (PNM, PLN, Astra, etc.) → "Lainnya", NEVER "Pendidikan & SDM". These are corporate PR, not human-capital development discourse.
- Writing/language tips threads by influencer authors (ivanlanin, "Ada N cara menulis perincian") → "Lainnya", NEVER "Pendidikan & SDM" (that bucket is for institutional education).
- Image-based sexual abuse / non-consensual AI-generated nudes / deepfake porn / "viral video bokep" spam threads with sex-tape lists → "Patologi Sosial Digital" (it IS digital social pathology), NEVER "Sosial & Keluarga". Add this to the judol/pinjol/narkoba canonical set in your mental model.
- Word-overlap traps — "Raja Judi" as a nickname for a casino tycoon's family (e.g. "Gaun Pengantin Menantu Raja Judi") = celebrity gossip → "Lainnya", NOT "Patologi Sosial Digital" (no judol/judi behavior is being discussed). Match SEMANTIC behavior, not surface keyword.
- 2026-06-08 audit traps (calibrated against small-group misclassifications):
    * Industry / commerce REGULATION posts — KADIN advocating against a regulation, asosiasi industri menolak kebijakan, industri tembakau menyoroti batas nikotin, business association policy advocacy → "Ekonomi & Bisnis" (or "Pemerintahan & Kebijakan" if the framing is the government's regulation itself). NOT "Patologi Sosial Digital" — the post is about business-regulation discourse, not digital social pathology, even if the regulated substance has health implications.
    * Healthcare ACCESS / kesehatan masyarakat stories — doctor profiled for service-to-remote-area, akses kesehatan di NTT/Papua/daerah 3T, dokter dapat penghargaan layanan publik, hospital expansion stories, telemedicine to remote areas → "Kesehatan & Kehidupan", NOT "Pekerja & Pertanian Rakyat". The doctor's profession is incidental — the story is healthcare-access, not labor-rights. Pekerja & Pertanian Rakyat is for labor-rights / upah / buruh / petani-economy issues specifically.
    * Transportation infrastructure — MRT/LRT/KRL station development, tol/jalan tol expansion, pelabuhan kapal/feri, bandara baru, kereta cepat — even when "smart" or "intelligent transport system" is mentioned → "Pemerintahan & Kebijakan" (state infrastructure policy). NOT "Teknologi & AI" — transit infrastructure is government-policy domain. Teknologi & AI is for AI models, deepfake/voice-AI scams, ChatGPT/LLM applications, automation, IT/SaaS startup discourse, cybersecurity, digital privacy in software contexts. Hardware infrastructure that happens to use technology is NOT Teknologi & AI.
    * NON-INDONESIAN content gate — any post whose text is predominantly in a foreign language (Hindi, Tamil, Urdu, English-only without ID context, Arabic-only without Islamic teaching framing, Chinese, Korean, Tagalog, Japanese, Spanish, etc.) → "Lainnya", regardless of how the @ mentions or hashtags look. Indonesian-spam tweets with mostly @-handles + Hindi/Tamil tail content = "Lainnya", NOT any 14-group theme. Our dashboard audience is Indonesian-speaking; non-ID content is off-taxonomy by definition.
- Non-Indonesia generic stress / lifestyle / human-interest stories that don't touch Indonesian context ("Pakistani sailor stress", "American school lunch debate") → "Lainnya", NEVER "Sosial & Keluarga" (that bucket is Indonesian family/social dynamics).
- Violence at pesantren / sekolah — santri dibakar/disekap, pembullyan berujung kekerasan, pengeroyokan murid — when there's a perpetrator and police investigation → "Hukum & Keadilan" (already covered by KDRT rule below; this is the reinforcement for pesantren-context).
- Hadith / ayat content with explicit Islamic teaching from mainstream Indonesian Islamic outlet (Republika "Jangan Suka Berandai-andai" citing hadith about لو, NU Online akhlak post, Kemenag Q&A) → "Aqidah & Ibadah", NEVER "Inspirasi & Kisah Pribadi" even when framed as life advice. Hadith citation IS the Islamic-teaching marker.

KEY ROUTING RULES (these are the bugs surface-regex got wrong):
- A political/accountability story about a state ritual (e.g. "Polemik Sapi Kurban Presiden" — controversy over how the President's kurban was procured) → "Pemerintahan & Kebijakan", NOT "Aqidah & Ibadah". Aqidah & Ibadah is only for posts that are themselves about practicing the ibadah.
- National-day commemorations and state ideology (e.g. "Peringatan Hari Lahir Pancasila", "Upacara Bendera", "Presiden pidato di Gedung Pancasila") → "Pemerintahan & Kebijakan". Includes when a political party (PDIP/Gerindra/etc) or government body or government-affiliated channel (Kemensetneg, Sekretariat Presiden, Pemkot, KOMPASTV, Tribun, Kompas.com, Pikiran Rakyat, etc.) hosts or covers a Pancasila-day flag ceremony, Megawati/Prabowo handshake at upacara, "Momen Prabowo Salami Megawati", etc. — the EVENT is state-ideology, not religious or social. Even a one-line greeting from a corporation/brand ("Selamat Hari Lahir Pancasila — Toyota Friends!") → "Pemerintahan & Kebijakan".
- Gaji ke-13/14, PKH, BPNT, PIP, BANSOS cair, KKS, ASN/TNI/Polri/PNS/pensiunan compensation → "Pemerintahan & Kebijakan" (state-budget compensation, not Lainnya). PPPK paruh waktu / PNS regulasi labor issues → "Pemerintahan & Kebijakan" OR "Pekerja & Pertanian Rakyat" (latter if framing is labor-rights focused).
- State housing programs — Bedah Rumah, BSPS (Bantuan Stimulan Perumahan Swadaya), PKP (Kementerian PKP), Rumah Subsidi, Mendagri/Menteri PKP peninjauan bedah rumah → "Pemerintahan & Kebijakan" (state policy program, not Lainnya, not Sosial). Also "Maruarar Sirait bedah rumah Sultra" → "Pemerintahan & Kebijakan".
- Former-minister / mantan-pejabat funerals with state honors — "Ryamizard Ryacudu meninggal/wafat", "dimakamkan di TMP Kalibata", "upacara pemakaman militer", "Gibran hadiri persemayaman Menhan", "Profil/Rekam Jejak Mantan Menhan/Menteri X", "Persahabatan Prabowo dan Ryamizard di militer" — → "Pemerintahan & Kebijakan" (state ceremony, not Lainnya, not Aqidah even when shalat jenazah is the focus).
- Presidential travel and arrival coverage — "Prabowo tiba di Tanah Air usai kunjungan ke Prancis", "Prabowo disambut Gibran di Halim", "Profil Nanik Deyang" (new BGN head appointment), "Dadan Hindayana dicopot Presiden" — → "Pemerintahan & Kebijakan" even when the article is just a brief or photo essay.
- Mysterious-fire / mass-fire / disaster fenomena (e.g. "Fenomena Api Misterius di Sleman") → "Lingkungan & Bencana".
- BMKG gempa bulletins, prakiraan cuaca harian, weather emergency advisories ("Gempa Mag:4.8 Melongoane", "Prakiraan Cuaca NTT Hari Ini", "Gunung Marapi Erupsi", "Cuaca Ekstrem Heilongjiang") → "Lingkungan & Bencana", NOT "Lainnya". These are systemic geophysical/weather reporting, not off-taxonomy.
- Local crime + corruption → "Hukum & Keadilan". State policy / officials → "Pemerintahan & Kebijakan".
- High-profile corruption cases and court proceedings — Roy Suryo / Dr. Tifa ijazah Jokowi case, Nadiem Makarim Chromebook trial, BGN tersangka Dadan Hindayana / Sony Sanjaya / Lodewyk Pusung penggeledahan Kejagung, MBG/SPPG (Satuan Pelayanan Pemenuhan Gizi) jual-beli skandal / proses penyidikan / "Dadan Cs ngembat" / "Pencopotan Dadan Cs" / "Korupsi Tata Kelola MBG", Silmy Karim OTT KPK, Wamenaker Noel vonis, Andrie Yunus air keras case — → "Hukum & Keadilan", NOT "Lainnya" and NOT "Pemerintahan & Kebijakan". The criminal proceeding IS the story, even when the defendant is a current/former minister, even when the post is opinion/satire framing from talk-show / commentary channels (Cokro TV, KompasTV "Blak-blakan", Mahfud MD Official, tvOneNews "Kabar Siang", ICW researcher commentary).
- Diplomatic visits, foreign trips, summits, bilateral meetings between governments → "Pemerintahan & Kebijakan".
- University news (rektor, SPMB, akreditasi, pelatihan vokasi, beasiswa, pesantren operations, sekolah rakyat) → "Pendidikan & SDM".
- Stock prices, IHSG, forex, commodity prices, harga emas, corporate financial moves, dividen, investasi → "Ekonomi & Bisnis".
- Daily harga emas price tables — "Harga Emas Antam Hari Ini", "Harga Emas UBS / Galeri24 / Pegadaian" routinely published by Tribun Palu / infobanktv / KONTAN TV / LaOde Mbena / Tanya Emas Indonesia / Bloomberg Technoz / Ojo Lali Emas channels → ALWAYS "Ekonomi & Bisnis", never Lainnya. The format is literally a commodity price feed.
- PMI / inflasi / surplus perdagangan / nilai tukar / Bank Indonesia / OJK rate decisions → "Ekonomi & Bisnis".
- Quran recitation, surah/ayat explanations, ceramah, khutbah, tausiyah videos → "Aqidah & Ibadah" (route by FORMAT, not by the surah's subject — a recitation of Al-Zalzalah is Aqidah & Ibadah even though "zalzalah" means earthquake).
- DPR/parliament/political party events, ministerial statements, RDP, Munas, fraksi politics → "Pemerintahan & Kebijakan".
- Earthquakes, floods, landslides, weather emergencies, accidents involving natural forces → "Lingkungan & Bencana".
- Crime, arrests, police operations, consumer fraud (WO scams, pinjol scams, online crime) → "Hukum & Keadilan".
- POLRI-as-law-enforcement operational news — Operasi Patuh (any region/code: Jaya/Lodaya/Candi/Semeru/Sumbar/Turangga + ditunda/digelar/dimulai/diundur/sasaran/target), SIM Keliling jadwal, SIM Corner lokasi, Polda/Polres/Polrestabes razia/penertiban/penindakan, Korlantas Polri op announcements, Polres community engagement (sembako bagi-bagi, esports turnamen Polres, edukasi keselamatan jelang Hari Bhayangkara), Camat-pelaku-pengrusakan terancam dipecat — → "Hukum & Keadilan", NOT "Pemerintahan & Kebijakan". The exception is state-level policy ABOUT Polri-as-institution (Pigai usul sipil duduki jabatan Polri, RUU Polri Komisi III DPR, Kapolri mutasi brigjen by Kapolri's authority, Habiburokhman tanggapan revisi UU Polri) → "Pemerintahan & Kebijakan" (state policy on the police institution, not police doing law-enforcement ops).
- KPK / Kejagung / Kejaksaan operational action stories — KPK pamerkan barang sitaan / mobil hasil OTT, KPK panggil/periksa N perusahaan, Kejagung sidak pita cukai / mengamuk panggil tjah-tjah mbakon, Kejati sita aset korupsi, OTT KPK, kejaksaan penggeledahan, eksekusi vonis tipikor, KPK dorong skandal suap pejabat — → "Hukum & Keadilan", regardless of who the defendant is and even when the post framing is sarcastic/comedic. NEVER "Lainnya" (no matter the tone) and NEVER "Pemerintahan & Kebijakan" (the agency role here is law-enforcement, not policy-making).
- Executive-branch action / Seskab / Istana / Wapres / Pemkab announcement — Seskab Teddy rilis angka investasi / telepon X malam-malam, Istana respons kritik publik, Wapres pidato, Pemkab/Pemkot/Pemprov peresmian, gov-affiliated channel (Kemensetneg, Sekretariat Presiden, Pemkot) coverage of executive activity, regional politician kabinet/formula speculation (e.g. "Membaca Pikiran X: Kabinet Ramping, Formula Menuju ..."), provincial-leadership commentary — → "Pemerintahan & Kebijakan", NEVER "Lainnya" even when the wrap is critical/sarcastic ("Istana mulai gerah dengan kritik publik?").
- Public infrastructure repair / state utility emergency response — PLN tower emergency pemulihan listrik / pemulihan jaringan, perbaikan jembatan + arus dialihkan, PDAM pipa bocor, perbaikan tol/jalan + lalin dialihkan, ASDP perubahan jadwal feri 24 jam — → "Pemerintahan & Kebijakan" (state utility/infra ops), NOT "Lainnya".
- Suspicious-death criminal investigations — food/drink poisoning under police probe ("Sate Beracun Boyolali Tewaskan Lansia, Polisi Periksa Saksi", "Wanita Tewas Setelah Makan Sate Kiriman Ojol"), death-in-custody / narapidana meninggal di Lapas/Rutan / kejanggalan kematian tahanan ("Mantan Polisi Anton Tewas di Lapas Kelas IIA Palangka Raya", "Kejanggalan Meninggalnya Pecatan Polisi di Penjara"), unexplained deaths under penyidikan → "Hukum & Keadilan" (not Kesehatan, not Lingkungan, not Lainnya). The criminal investigation IS the angle.
- OPM / Papuan armed-conflict operations — "Marinir TNI AL rebut markas OPM", "Kontak tembak Papua Pegunungan", "Pasukan ditembak KKB", "Genosida Papua kolonialisme RI", "MRP Korowai ketertinggalan kawasan konflik" → "Konflik & Geopolitik" (military operations against named insurgent groups, not Hukum, not Pemerintahan).
- Da'wah ceramah, pengajian, tausiyah, Islamic talks by ustadz/kyai/buya → "Aqidah & Ibadah" (not Inspirasi & Kisah Pribadi — Inspirasi is for personal first-person reflections without religious-teaching framing).
- POSTS BY NAMED INDONESIAN DA'WAH PREACHERS — Buya Yahya, Felix Siauw, Hanan Attaki, Khalid Basalamah, Ustadz Adi Hidayat, Habib Jafar, Gus Baha, Gus Muwafiq, Buya Hamka, Ustadz Abdul Somad, Syafiq Riza Basalamah, Ustadz Abdullah Zaen, KH Abdurrahman Wahid (Gus Dur), Tuan Guru Bajang, OR YouTube channels Yufid.TV, Al-Bahjah TV, NU Online, Rumah Fiqih, Yufid EDU, Oni Sahroni / Muamalah Daily — ALWAYS → "Aqidah & Ibadah", even when the topic is parenting ("Mengelola Kecerdasan Anak"), love ("Cinta Itu Menjaga dari Maksiat"), gratitude, harta, suami-istri fiqih, anak, sekolah/pesantren, financial advice with religious framing, or commentary on poverty/politics. These are dakwah outputs by definition; the framing wraps the lesson in everyday subjects.
- Mualaf stories — non-Muslim converts to Islam, mualaf journey, "memeluk Islam", "masuk Islam after wedding", REVERT/Reverts Leadership Camp → "Aqidah & Ibadah" (not Sosial & Keluarga, even when family/marriage is in the story).
- Islamic ulama / kyai / mursyid obituaries and posts about their wafat — "KH Adib Rofiuddin Izza wafat", "Innalillahi wa innailaihi rojiun, telah berpulang KH X", "Sesepuh Ponpes Buntet meninggal", "Tribute to Buya Y" — → "Aqidah & Ibadah" (not Sosial & Keluarga, not Pendidikan, not Lainnya). The religious-leader frame is the angle.
- NU / Muhammadiyah / PBNU internal organizational events — "Munas Alim Ulama dan Konbes NU Ploso", "Halaqoh Kiai Muda NU Solo Raya soroti supremasi ulama", "Mubes Warga NU DIY Khittah", "Muhammadiyah Hadirkan Islam Berkemajuan", "PBNU Pesantrenku Aman deklarasi" — → "Aqidah & Ibadah" (not Pemerintahan & Kebijakan even when leadership/supremasi politics is the framing; these are religious-organization internal affairs, not state politics).
- Sports of any kind — football matches (Timnas, Liga, FIFA, club transfers), MotoGP/Moto3, badminton tournaments (Indonesia Open), tennis cups, futsal, racing, Olympic events, fan-club events, athlete profiles, sport line-ups, sport line scores, club-vs-club news — ALWAYS → "Lainnya", even when:
    a government body hosts the event (Pemkot/Pemkab/Kemenpora tennis cup → "Lainnya", not "Pemerintahan & Kebijakan"),
    the national team or named Indonesian athlete is featured (Timnas vs Oman line-up → "Lainnya", not "Pemerintahan"; Veda Ega MotoGP → "Lainnya", not "Pekerja & Pertanian Rakyat"),
    the article is about transfer fees / contracts (AC Milan transfer → "Lainnya", not "Ekonomi & Bisnis").
- Music releases, single launches, MV / album drops, artist comebacks, K-pop voting campaigns, K-pop fan giveaways/showcases, sinetron (Indonesian soap operas like "Terikat Janji"), drama mini series, K-drama, manhwa/anime reviews, gaming streams, vtuber clips → "Lainnya" (not "Ekonomi & Bisnis", not Inspirasi, not Sosial).
- Christian devotionals ("Renungan Harian Kristen", Lukas/Matius verse readings, JKI/GBI/GMIT/GKPA worship, Christian wedding/funeral ibadah, Pendeta/Pdt./Pdp. sermons, Care City Worship chord lyrics), Buddhist content (Waisak Borobudur, Kirab Waisak, Borobudur Chattra, Menag Waisak Dharma), Hindu content (Bali Piodalan, Pengukuhan Dukun Pandita Bromo, Hindu Tengger ritual, kalender Bali Ala Ayuning Dewasa), interfaith disputes about places-of-worship (church bombings, gereja pembubaran, "Jabar Barbar konflik rumah ibadah", Peraturan Menteri Rumah Ibadah minoritas) → "Toleransi & Lintas-Iman". This is the catch-all for non-Islamic religious content + interfaith tension. NOT Aqidah & Ibadah (that's reserved for Islamic ibadah practice) and NOT Lainnya.
- Traffic accidents, vehicle collisions, gas poisoning, electric shocks, accidental drownings → route by AGENT: if police investigation or criminal negligence → "Hukum & Keadilan"; if pure accident with no crime angle → "Lainnya". NOT "Lingkungan & Bencana" (that's reserved for natural forces like floods, earthquakes, volcanoes, mass-fires).
- LPSK / Komnas HAM / witness-protection / journalist-doxing / HAM watchdog cases → "Hukum & Keadilan" (not Sosial & Keluarga, even when family members are mentioned).
- Domestic violence (KDRT), child abuse, husband-kills-wife / wife-kills-husband, sexual abuse at pesantren (Kyai/Ustadz cabul kasus sodomi santri/santriwati) — when there is an arrest, police report, prosecution, conviction, or named perpetrator → "Hukum & Keadilan" (the criminal case is the angle), not "Sosial & Keluarga". Only generic awareness/discussion posts about KDRT-as-social-issue (without a specific case) → "Sosial & Keluarga".

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
