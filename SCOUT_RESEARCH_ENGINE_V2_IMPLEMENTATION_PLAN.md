# Scout Research Engine v2 — Implementation Plan for Agent

## Goal

Build Scout into a Perplexity-style research system with:

- high-quality resource search
- Scrapling-based detailed crawling
- clean Markdown ingestion
- memory-aware research
- small multi-agent orchestration
- graph-ready evidence extraction
- RLM as the execution runtime, not the whole control plane

## Important repo findings

1. Scout already has the right high-level architecture in the README: intent detection, KB search, web research, vector ingestion, Pyodide execution, and answer synthesis.
2. `packages/knowledge` already has early research modules: `resource-planner`, `source-ranker`, `search-provider`, and `evidence-pack`.
3. `webResearch()` already calls Scrapling after resource planning.
4. Model service currently uses simple `Fetcher.get(url)` only.
5. `crawlUrlSchema` already has `maxPages`, but current `crawlUrl()` does not actually perform multi-page crawling.
6. Prisma already has `Entity`, `Relation`, and `Claim`, so graph extraction can be added later without starting from zero.

## First implementation slice included

### 1. Docs

Adds:

- `docs/TODO.md`
- `docs/LESSONS.md`

These keep future coding agents aligned.

### 2. Memory

Adds:

- Prisma `Memory` model
- `packages/knowledge/src/memory/memory-types.ts`
- `packages/knowledge/src/memory/memory-manager.ts`

Memory design:

- add-only
- scoped by project/user/session/source
- supports source-quality memories
- ready for later vector-backed retrieval

### 3. Agents

Adds:

- `packages/knowledge/src/agents/types.ts`
- `packages/knowledge/src/agents/search-planner.agent.ts`
- `packages/knowledge/src/agents/memory-agent.ts`

Current agents are deterministic. Do not add swarm complexity yet.

### 4. Scrapling crawl upgrade

Updates model-service:

- `scrape_schema.py`
- `scrape_router.py`
- `scrape_service.py`

New endpoints:

```text
POST /scrape/page
POST /scrape/crawl
```

New crawl behavior:

- supports `auto`, `static`, `dynamic`, `stealth`
- bounded crawl by `max_pages`
- bounded crawl by `max_depth`
- same-domain-only crawling
- Markdown cleaning
- AI-targeted noise removal

### 5. TypeScript Scrapling wrapper

Updates:

- `packages/knowledge/src/scrapers/scrapling.scraper.ts`

Adds:

```ts
crawlSiteWithScrapling()
```

### 6. Crawl manager

Adds:

- `packages/knowledge/src/research/crawl-manager.ts`

This manages ranked resources → Scrapling crawl → evidence preview.

### 7. Research orchestrator

Adds:

- `packages/knowledge/src/research/research-orchestrator.ts`

Pipeline:

```text
SearchPlannerAgent
→ MemoryAgent.retrieveForRun
→ planResources
→ crawlResearchSources
→ ingestMarkdownDocument
→ buildEvidencePack
→ MemoryAgent.writeRunMemories
```

### 8. API integration

Updates:

- `apps/api/src/modules/tools/tools.schema.ts`
- `apps/api/src/modules/tools/tools.service.ts`

`/tools/web-research` can use the new orchestrator only when:

```json
{
  "useOrchestrator": true
}
```

This avoids breaking the current production path.

## How to apply

From repo root:

```bash
git checkout -b feat/research-engine-v2
python /path/to/apply_scout_research_engine_v2.py
npm run prisma:generate
prisma migrate dev --schema=prisma/schema.prisma --name add_memory_model
docker compose build model-service api worker
docker compose up
```

## Smoke tests

### 1. Health

```bash
curl http://localhost:8100/health
curl http://localhost:8000/health
```

### 2. Single scrape

```bash
curl -X POST http://localhost:8100/scrape/page \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","mode":"auto","ai_targeted":true}'
```

### 3. Multi-page crawl

```bash
curl -X POST http://localhost:8100/scrape/crawl \
  -H "Content-Type: application/json" \
  -d '{"root_url":"https://example.com","max_pages":3,"max_depth":1,"mode":"auto","ai_targeted":true,"same_domain_only":true}'
```

### 4. API crawl

```bash
curl -X POST http://localhost:8000/tools/crawl-url \
  -H "Content-Type: application/json" \
  -d '{"projectId":"<PROJECT_ID>","url":"https://example.com","maxPages":3,"maxDepth":1}'
```

### 5. New orchestrator path

```bash
curl -X POST http://localhost:8000/tools/web-research \
  -H "Content-Type: application/json" \
  -d '{
    "projectId":"<PROJECT_ID>",
    "query":"Compare Meta Marketing API and Google Ads API permissions and rate limits",
    "maxResults":5,
    "maxPagesPerSource":3,
    "maxTotalPages":12,
    "maxDepth":1,
    "useOrchestrator":true
  }'
```

## Next implementation step

After this slice works:

1. Add `EvidenceExtractor`.
2. Convert evidence from page preview to claim-level evidence.
3. Store claims in Prisma `Claim`.
4. Extract entities and relations into existing `Entity` and `Relation`.
5. Add `VerifierAgent`.
6. Use RLM only after evidence is collected.
