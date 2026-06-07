<div align="center">

<br/>

```
███████╗ ██████╗ ██████╗ ██╗   ██╗████████╗
██╔════╝██╔════╝██╔═══██╗██║   ██║╚══██╔══╝
███████╗██║     ██║   ██║██║   ██║   ██║   
╚════██║██║     ██║   ██║██║   ██║   ██║   
███████║╚██████╗╚██████╔╝╚██████╔╝   ██║   
╚══════╝ ╚═════╝ ╚═════╝  ╚═════╝    ╚═╝   
```

**A recursive AI research operating system.**  
Not a chatbot. A research agent that thinks before it speaks.

<br/>

![Next.js](https://img.shields.io/badge/Next.js-000000?style=flat-square&logo=nextdotjs&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-000000?style=flat-square&logo=fastify&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Deno](https://img.shields.io/badge/Deno-000000?style=flat-square&logo=deno&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-DC382D?style=flat-square&logo=redis&logoColor=white)
![Qdrant](https://img.shields.io/badge/Qdrant-FF4A6E?style=flat-square&logo=data:image/svg+xml;base64,&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?style=flat-square&logo=supabase&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white)

<br/>

</div>

---

## The Problem with Chatbots

Every AI assistant today does the same thing:

```
You ask → LLM answers
```

It sounds confident. It's often wrong. It never shows its work.

**Scout is different.**

---

## How Scout Thinks

```
You ask a question
        │
        ▼
  Intent Detection          ← What are you actually asking?
        │
        ▼
  Knowledge Base Search     ← Do we already know this? (Semantic)
        │
        ├── HIT  ──────────────────────────────────────────────┐
        │                                                       │
        ▼                                                       │
  Web Research + Deep Crawl ← Go find it. Crawl. Parse.        │
        │                                                       │
        ▼                                                       │
  Vector Ingestion          ← Embed it. Store it. Never ask    │
  & Real-time Chunking        the internet twice.              │
        │                                                       │
        └──────────────────────────┬────────────────────────────┘
                                   │
                                   ▼
                      Pyodide Execution Sandbox  ← Isolated Python.
                                   │               Dynamic reasoning.
                                   ▼
                         Answer Synthesis        ← Grounded. Cited.
                      & Source Attribution         Source-backed.
```

Scout doesn't guess. It researches, indexes, executes, then answers.

---

## Architecture

Scout is a modular monorepo. Every layer has one job.

| Layer | Technology | Responsibility |
|:---|:---|:---|
| **Frontend UI** | Next.js (App Router), Tailwind CSS | Research-oriented chat interface with live job tracking, source drawers, and runtime trace logs |
| **Central API** | Fastify, TypeScript, Prisma ORM | Orchestrates project scopes, dispatches background jobs, manages semantic document chunks |
| **Task Queue** | Redis, BullMQ | Decouples long-running research from request lifecycles — deterministic status polling |
| **Background Worker** | Node.js | Drives job state transitions: `QUEUED → RUNNING → COMPLETED / FAILED` |
| **Scout Runtime** | Deno + Pyodide (WASM) | Translates LLM reasoning into live Python — calls `search_kb()` and `web_research()` recursively |
| **Model Layer** | NVIDIA Triton / OpenRouter | Specialized endpoints: reasoning (`glm4.7`), code gen (`qwen3-coder-480b`), embeddings (`nv-embedqa-e5-v5`) |
| **Web Ingestion** | Firecrawl API | Deep scraping of public documentation into clean, structured Markdown |
| **Vector Storage** | Qdrant | High-dimensional semantic search, isolated per `projectId` |
| **Relational Storage** | Supabase Postgres | Jobs, Documents, Chunks, Reports, and granular Agent Execution traces |

---

## Getting Started

### Prerequisites

- [Docker](https://www.docker.com/products/docker-desktop/) ≥ 20.10.0  
- [Docker Compose](https://docs.docker.com/compose/) ≥ v2.0.0

That's it. Everything else runs inside containers.

---

### Option 1 — One Command

```bash
chmod +x ./run.sh && ./run.sh
```

Cleans, rebuilds, and spins up the full stack in one shot.

---

### Option 2 — Docker Compose

```bash
# Build all service images
docker-compose build

# Start everything
docker-compose up

# Or in detached mode
docker-compose up -d
```

Once containers are live, services auto-interconnect, migrations run, and the system is fully operational.

---

## API Reference

### System Health

```
GET  /health          →  Core gateway status
GET  /health/deps     →  Dependency check (Postgres, Qdrant, Redis)
```

### Project Management

```
POST /projects              →  Create a new isolated workspace
GET  /projects              →  List all active projects
GET  /projects/:id/jobs     →  Execution history for a project
```

### Research Engine

```
POST /research-jobs         →  Queue a question (returns jobId)
GET  /research-jobs/:id     →  Poll state, steps, and progress
```

### Knowledge Exploration

```
GET  /projects/:id/documents       →  Documents indexed in a project
GET  /documents/:id/chunks         →  Sub-chunks and parsed text blocks
GET  /knowledge/vector/status      →  Qdrant collection health
```

---

## End-to-End Test

To trigger the full pipeline — web crawl, ingestion, semantic search, Python execution, and synthesis — run this query in the UI:

> *"Compare Meta Marketing API, Google Ads API, and TikTok Ads API for building an ads automation platform. What data can I access, what can I automate, what are the required permissions, rate-limit risks, and the best MVP implementation plan?"*

**What happens:**

1. **Intent Analysis** — Scout detects multi-platform comparison, flags need for external documentation
2. **KB Fallback** — Qdrant returns empty; Firecrawl dispatched to crawl official API docs
3. **Ingestion** — Tables parsed, embedded, split into chunks, indexed into Qdrant
4. **Execution Loop** — Pyodide runs comparative evaluation scripts dynamically
5. **Synthesis** — A clean comparison matrix surfaces with direct source links

---

## Roadmap

- [ ] **Distraction-free UI** — Typography-first redesign, collapsible source drawers, hidden trace layouts by default
- [ ] **SSE Token Streaming** — Live token-by-token generation with real-time step metrics
- [ ] **Domain Prioritization** — Source ranking that elevates official developer subdomains over secondary blogs
- [ ] **Entity-Claim Knowledge Graphs** — Extract explicit code entities and store relational knowledge as graph networks

---

## Project Structure

```
scout/
├── apps/
│   ├── web/              # Next.js frontend
│   └── api/              # Fastify API gateway
├── workers/
│   ├── core/             # Background job runner (Node.js)
│   └── runtime/          # Scout execution sandbox (Deno + Pyodide)
├── services/
│   └── models/           # NVIDIA / OpenRouter model service
├── docker-compose.yml
└── run.sh
```

---

<div align="center">

<br/>

Built to think deeper. Research further. Answer better.

<br/>

</div>
