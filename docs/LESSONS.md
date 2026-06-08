# Scout Lessons

## Architecture lessons

1. **Search and crawl are different jobs.**
   Search should discover candidate resources. Crawling should deeply extract content only after sources are ranked.

2. **Scrapling is the crawler, not the planner.**
   Scrapling should be used after Scout decides which URLs matter.

3. **The RLM runtime should not own the whole pipeline.**
   RLM is useful for reasoning, code execution, and flexible tool use. The product should still have a deterministic research pipeline.

4. **Small agents first.**
   Do not start with a large swarm. Start with a few focused agents:
   - Search planner
   - Crawler
   - Evidence extractor
   - Memory agent
   - Answer agent

5. **Memory must be scoped.**
   User preferences, project facts, source quality, and task traces should not be mixed together.

6. **Memory should be add-only in v1.**
   Do not overwrite facts early. Add new dated facts and let retrieval choose the best one.

7. **Evidence should be claim-level.**
   Page-level snippets are useful, but final answers need claim-level support with citations.

8. **Deep crawl must be bounded.**
   Every crawl needs max pages, max depth, same-domain restriction, and timeout.

9. **Official docs should usually win.**
   For API, SDK, product, and framework questions, official docs should outrank blogs and community content.

10. **Source failures are useful memory.**
    Failed crawls, blocked pages, duplicate pages, and low-value pages should be remembered so Scout improves over time.

## Research Engine v2 Slice 2

- Page-level previews are not enough for Perplexity-style answers. Scout needs claim-level evidence with quotes.
- Evidence extraction should stay deterministic first. LLM-based extraction can be added later after the pipeline is stable.
- Citation verification should happen before final synthesis, not after the answer is written.
- Keep route handlers thin. Research logic belongs in `packages/knowledge/src/research`.
- Do not add swarm or graph complexity before evidence quality is reliable.

## Research Engine v2 Slice 3

- Multi-query planning is the most important missing piece for source discovery.
- The `SearchPlannerAgent` was already generating subqueries, but `ResearchOrchestrator` was ignoring them.
- Merging resources across subqueries with URL normalization and score-based dedup is better than per-subquery limits.
- Tracking `matchedBy` per resource helps future debugging and source diversity scoring.
- The output should include `subqueries` so callers can see what was planned.

## Research Engine v2 Slice 4

- Memory becomes useful only when it changes future behavior. Writing memory is not enough.
- Source memory should affect resource planning before crawling, not only answer synthesis after crawling.
- Keep source penalties bounded. A failed URL should be penalized, but not permanently banned.
- Durable fact memory should give only a small boost during ranking; evidence from current sources should still dominate.

## Research Engine v2 Slice 5

- The final answer should be built from EvidencePack, not raw scraped chunks.
- Deterministic synthesis is a good first safety layer because it prevents unsupported claims from entering the answer.
- LLM polish should be optional and evidence-constrained. Do not let it introduce uncited facts.
- Returning both `answer` and `evidencePack` makes debugging and UI source drawers easier.

## Research Engine v2 Slice 6

- One generic answer format is not enough. Comparison, how-to, and research-summary questions need different structure.
- Answer rendering can remain deterministic while still feeling useful.
- The answer layer should never introduce new facts; it should only reorganize verified evidence.
- Optional LLM polish should come after deterministic modes, not before.
