# Dakwah-Lens

Islamic Da'wah Media Intelligence Platform — monitors Indonesian media + social platforms, scores topics for da'wah relevance, and generates kitab-grounded advisory briefs for da'i.

Owner: Sukses & Berkah Group · Author: Taufik Adi · Stage: Prototype (v0.4)

See `Dakwah-Lens_PRD_v0.4.pdf` for the full product spec.

## Architecture (prototype)

```
┌─────────────────────────────────────────────────────────────┐
│  web/   Next.js 15 (App Router) + Tailwind + next-intl      │
│         Pages: dashboard, trends, briefs, kitab library     │
└──────────────────────────┬──────────────────────────────────┘
                           │ REST + SSE
┌──────────────────────────┴──────────────────────────────────┐
│  api/   FastAPI + Celery workers                            │
│   ├─ ingestion (RSS + Apify actors)                         │
│   ├─ ml          (IndoBERT sentiment, Gemini Flash classify)│
│   ├─ rag         (Qdrant retrieval)                         │
│   └─ briefs      (Claude Sonnet 4.6 brief generation)       │
└──────────┬──────────────┬───────────────┬──────────────┬───┘
           │              │               │              │
        Postgres       Qdrant          Redis         Object
        (data)         (vectors)       (queue)       store
```

## Locked decisions (2026-05-17)

- Languages: Indonesian (primary) + English via next-intl
- Embedding model: OpenAI `text-embedding-3-small`
- VPS: IDCloudHost (Indonesia residency per UU PDP §27/2022)
- Kitab corpus v0: Qur'an (AR + ID Kemenag + EN Sahih International), Sahih al-Bukhari, Sahih Muslim, Riyad as-Salihin
- Multi-tenant: `organizations` + `org_members` (owner/admin/member), app-level scoping
- Tiered LLM: Gemini Flash by default → Claude Sonnet 4.6 only for brief synthesis

## Local development

```bash
cp .env.example .env       # fill in API keys

docker compose up -d       # postgres + qdrant + redis

# Frontend
cd web && npm install && npm run dev          # http://localhost:3000

# Backend (in another shell)
cd api && uv sync && uv run uvicorn app.main:app --reload   # http://localhost:8000
```

## Project structure

```
dakwah-lens/
├── docker-compose.yml          # postgres, qdrant, redis (+ indobert-svc later)
├── web/                        # Next.js frontend
│   ├── src/app/[locale]/       # localized routes (/id, /en)
│   └── messages/               # ID + EN translation strings
└── api/                        # FastAPI backend
    ├── app/
    │   ├── routers/            # HTTP endpoints
    │   ├── models/             # SQLAlchemy + Pydantic
    │   ├── services/           # business logic
    │   └── workers/            # Celery tasks
    └── scripts/                # one-off CLI (kitab ingestion, etc.)
```
