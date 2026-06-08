# Scout TODO

This file tracks the next implementation steps for Scout Research Engine v2.

## Done in v2 Slice 1

- [x] Add `ResearchOrchestrator` as the deterministic top-level research pipeline.
- [x] Keep the existing RLM runtime as the execution/reasoning layer, not the whole control plane.
- [x] Wire `ResearchOrchestrator` into `/tools/web-research` behind `useOrchestrator`.
- [x] Create a small, clean `packages/knowledge/src/agents` folder.
- [x] Add first deterministic agents:
  - `SearchPlannerAgent`
  - `MemoryAgent`
- [x] Replace single-page-only crawl behavior with bounded Scrapling site crawling.
- [x] Add crawler limits:
  - `maxPages`
  - `maxDepth`
  - same-domain restriction
  - duplicate URL removal
- [x] Add first-class `Memory` Prisma model.
- [x] Use add-only memory writes for source-quality memories.

## Done in v2 Slice 2

- [x] Upgrade `EvidencePack` from page previews to claim-level evidence.
- [x] Add deterministic Markdown evidence extraction.
- [x] Store:
  - claim
  - quote
  - source URL
  - source title
  - section
  - confidence
  - source tier
  - entities
- [x] Add citation verification statuses:
  - supported
  - weak
  - unsupported

## Done in v2 Slice 3

- [x] `ResearchOrchestrator` uses `SearchPlannerAgent.subqueries` for multi-query resource planning.
- [x] Resources merged and deduplicated by normalized URL across subqueries.
- [x] Highest score per URL kept; all subquery sources tracked in `matchedBy`.

## Now

### Evidence quality

- [ ] Add tests for `evidence-extractor.ts`.
- [ ] Add tests for `citation-verifier.ts`.
- [ ] Improve table-specific evidence extraction for API docs.
- [ ] Add quote span offsets later for source drawer highlighting.
- [ ] Add evidence deduplication across near-identical pages.

### Research planning

- [ ] Add source freshness scoring.
- [ ] Add source diversity scoring.
- [ ] Add per-domain crawl budgets.

### Memory

- [ ] Add source failure memory so Scout avoids repeatedly bad URLs.
- [ ] Add durable fact memories from supported evidence.
- [ ] Add vector-backed memory retrieval later.

## Next

- [ ] Add graph extraction from crawled Markdown.
- [ ] Store entities, relations, and claims using existing Prisma graph tables.
- [ ] Add `GraphAgent`.
- [ ] Add `VerifierAgent` for final answer verification.

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
