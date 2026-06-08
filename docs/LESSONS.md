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
