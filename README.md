# Dakwah-Lens

Islamic Da'wah Media Intelligence Platform — monitors Indonesian media + social platforms, scores topics for da'wah relevance, and generates kitab-grounded advisory briefs for da'i.

Owner: Sukses & Berkah Group · Author: Taufik Adi · Stage: Prototype (v0.4)

See `Dakwah-Lens_PRD_v0.4.pdf` for the full product spec.

## Architecture (prototype)

```
┌─────────────────────────────────────────────────────────────┐
│  web/   Next.js 16 (App Router) + Tailwind v4 + next-intl   │
│         Pages: dashboard, trends, briefs, kitab library     │
└──────────────────────────┬──────────────────────────────────┘
                           │ REST
┌──────────────────────────┴──────────────────────────────────┐
│  api/   FastAPI + Celery workers                            │
│   ├─ ingestion   (RSS + YouTube; Apify actors paused)       │
│   ├─ ml          (Claude Sonnet 5.5 batch: sentiment,       │
│   │              theme, da'wah score; weekly topics)        │
│   ├─ rag         (OpenAI embeddings → Qdrant retrieval)     │
│   └─ briefs      (weekly: composed manually with Claude;    │
│                   on-demand kajian: Gemini 2.5 Pro)         │
└──────────┬──────────────┬───────────────┬───────────────────┘
           │              │               │
        Postgres       Qdrant          Redis
        (data)         (vectors)       (queue)
```

## Locked decisions (current as of 2026-11-26; AGENTS.md is the full list)

- Languages: Indonesian (primary) + English via next-intl
- Embedding model: OpenAI `text-embedding-3-large`
- VPS: IDCloudHost (Indonesia residency per UU PDP §27/2022)
- Kitab corpus (20 works; live list on `/how-it-works`): **Qur'an & tafsir** — Al-Qur'an (AR + ID Kemenag + EN Sahih International), Tafsir Ibn Katsir (AR + EN), Tafsir Ath-Thabari (AR — verse-keyed for the Tafsir Pekan Ini track, *not* in `/kitab` free-text search); **hadith** — Sahih al-Bukhari, Sahih Muslim, Riyad as-Salihin, Bulugh al-Maram; **sirah & sahabat** — Sirah Ibn Hisham, Ash-Shama'il al-Muhammadiyyah, Hayat as-Sahabah, Al-Bidayah wan-Nihayah; **fiqh** — Al-Umm, Fiqh as-Sunnah, Fath al-Mu'in, Fath al-Qarib; **aqidah & adab** — Bidayatul Hidayah, Nashaihul Ibad, Adab al-'Alim wa al-Muta'allim, 'Aqidat al-'Awam, Thalathat al-Ushul
- Multi-tenant: `organizations` + `org_members` (owner/admin/member), app-level scoping
- LLMs: Claude Sonnet 5.5 (Message Batches) labels sentiment, theme and da'wah score nightly and clusters topics weekly; Gemini Flash-Lite for rerank, query expansion, comment moderation and trending keywords, with rule and cosine fallbacks (Gemini prepaid credit ran out around 2026-07-27, so the fallbacks run today); Gemini 2.5 Pro for on-demand kajian, with Claude Sonnet 4.5 as fallback when `ANTHROPIC_API_KEY` is set; weekly briefings are composed manually with Claude

## Local development

```bash
cp .env.example .env       # fill in API keys

docker compose up -d       # postgres + qdrant + redis

# Frontend
cd web && npm install && npm run dev          # http://localhost:3000

# Backend (in another shell)
cd api && uv sync && uv run api               # http://localhost:8000
```

## Project structure

```
dakwah-lens/
├── docker-compose.yml          # local postgres, qdrant, redis
├── docker-compose.prod.yml     # full prod stack incl. web/api/worker/beat
├── web/                        # Next.js frontend
│   ├── src/app/[locale]/       # localized routes (/id, /en)
│   └── messages/               # ID + EN translation strings
└── api/                        # FastAPI backend (uv-managed Python 3.12)
    └── src/api/
        ├── routers/            # HTTP endpoints
        ├── models/             # SQLAlchemy + Pydantic
        ├── services/           # business logic (LLM clients, retrieval)
        ├── workers/            # Celery tasks + beat schedule
        └── scripts/            # one-off CLI (kitab embed, backfill, etc.)
```
