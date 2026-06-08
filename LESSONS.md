# Research Engine v2 -- Lessons Learned

## Architecture

- **Import aliasing**: @scout/knowledge -> ../../../ in source files makes restructuring painful. Consider path aliases in tsconfig.
- **Module splitting**: Splitting answer-synthesizer.ts into answer-mode.ts + answer-renderers.ts + thin orchestrator greatly improves testability.
- **Memory as a priority queue**: Source ranking is effectively a learned priority queue -- treat it as infrastructure, not a plugin.

## Evidence Pipeline

- Claim-level extraction is far more useful than document-level: it enables citation verification, contradiction detection, and aspect-oriented rendering.
- Normalising evidence confidence scores across different extractors is surprisingly hard -- use a simple 0.0-1.0 range and document it early.

## Crawling

- Scrapling (Python) + subprocess bridge works well but adds startup latency.
- Rate limiting is essential -- many sites return 429s to aggressive crawling. The crawl manager implements exponential backoff.

## Memory

- Tf-Idf cosine dedup catches near-duplicate facts well but is O(n^2) in the naive implementation. Batch dedup in 100-fact chunks.
- Memory signals should decay over time -- a failure from 6 months ago is less relevant than one from yesterday. The decay function is in memory.ts.

## Question Categorisation

- Simple keyword heuristics (mode.ts) cover ~90% of cases. For the remaining 10%, consider an LLM-based classifier fallback.
- The research_summary mode is the most demanding -- it needs to group evidence by latent topic, which requires either clustering or an LLM call.

## Testing

- Integration tests with real search APIs are slow and brittle. Mock all external services in unit tests; keep 2-3 smoke tests for CI.
- The answer renderers produce Markdown -- snapshot testing works well here.
- Memory ranking tests need careful setup of embedded vectors. Use a small fixed corpus for deterministic similarity scores.
