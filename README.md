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
│   ├─ ingestion   (RSS + YouTube + Apify actors)             │
│   ├─ ml          (IndoBERT for social-media sentiment;      │
│   │              Gemini Flash-Lite for news sentiment +     │
│   │              da'wah classifier + topic discovery)       │
│   ├─ rag         (OpenAI embeddings → Qdrant retrieval)     │
│   └─ briefs      (Gemini 2.5 Pro primary,                   │
│                   Claude Sonnet 4.6 fallback)               │
└──────────┬──────────────┬───────────────┬───────────────────┘
           │              │               │
        Postgres       Qdrant          Redis
        (data)         (vectors)       (queue)
```

## Locked decisions (current as of 2026-05-22)

- Languages: Indonesian (primary) + English via next-intl
- Embedding model: OpenAI `text-embedding-3-large`
- VPS: IDCloudHost (Indonesia residency per UU PDP §27/2022)
- Kitab corpus v0: Qur'an (AR + ID Kemenag + EN Sahih International), Sahih al-Bukhari, Sahih Muslim, Riyad as-Salihin
- Multi-tenant: `organizations` + `org_members` (owner/admin/member), app-level scoping
- Tiered LLM: Gemini Flash-Lite for classify/topic/rerank → Gemini 2.5 Pro for brief synthesis → Claude Sonnet 4.6 only as a Pro fallback

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
