# Scout TODO

This file tracks the next implementation steps for Scout Research Engine v2.

## Now

### Research orchestration

- [ ] Add `ResearchOrchestrator` as the deterministic top-level research pipeline.
- [ ] Keep the existing RLM runtime as the execution/reasoning layer, not the whole control plane.
- [ ] Wire `ResearchOrchestrator` into `/tools/web-research` after this first slice is stable.

### Agents

- [ ] Create a small, clean `packages/knowledge/src/agents` folder.
- [ ] Start with deterministic agents:
  - `SearchPlannerAgent`
  - `MemoryAgent`
  - `CoordinatorAgent` later
- [ ] Avoid large swarm complexity until the basic research pipeline is reliable.

### Crawling

- [ ] Replace single-page-only crawl behavior with bounded site crawling.
- [ ] Use Scrapling modes:
  - `static` for normal docs/blogs.
  - `dynamic` for JS-heavy pages.
  - `stealth` for protected pages only when needed.
- [ ] Always keep crawler limits:
  - `maxPages`
  - `maxDepth`
  - same-domain restriction
  - timeout
  - duplicate URL removal

### Memory

- [ ] Add a first-class `Memory` Prisma model.
- [ ] Use add-only memory writes.
- [ ] Do not update/delete memories in v1.
- [ ] Store source quality, decisions, durable facts, and task traces.
- [ ] Add vector-backed memory retrieval later.

### Evidence

- [ ] Upgrade `EvidencePack` from page previews to claim-level evidence.
- [ ] Store:
  - claim
  - quote
  - source URL
  - source title
  - confidence
  - source tier
- [ ] Add a verifier after claim extraction.

## Next

- [ ] Add graph extraction from crawled Markdown.
- [ ] Store entities, relations, and claims using existing Prisma graph tables.
- [ ] Add source freshness scoring.
- [ ] Add source diversity scoring.
- [ ] Add per-domain crawl budgets.
- [ ] Add source failure memory so Scout avoids repeatedly bad URLs.

## Later

- [ ] Add swarm execution for parallel subquery search.
- [ ] Add swarm execution for parallel source crawling.
- [ ] Add multi-provider web search:
  - Firecrawl
  - Brave Search
  - Tavily
  - GitHub Search
  - Docs registry
- [ ] Add streaming run traces in the UI.
- [ ] Add source drawer with per-claim citations.
