<p align="center">
  <h1 align="center">Scout -- Research Engine v2</h1>
  <p align="center">Multi-agent, memory-augmented research pipeline for the modern web.</p>
</p>

## Overview

Scout Research Engine v2 (packages/knowledge/src/research/) is a TypeScript-based research
pipeline that:

1. **Plans** -- Decomposes complex questions into sub-queries using a language-model planning agent.
2. **Gathers** -- Runs sub-queries in parallel through multiple search providers and a high-fidelity crawler (Scrapling).
3. **Extracts** -- Mines each source for claim-level evidence with structured metadata (quote, context, confidence).
4. **Verifies** -- Cross-references claims across sources for corroboration and contradiction.
5. **Ranks** -- Orders sources by freshness, authority, relevance and memory (past failure/success signals).
6. **Synthesises** -- Renders a final answer in a mode appropriate to the question type.

## Architecture

```
packages/knowledge/src/research/
+-- agents/                   # LLM-powered agents
|   +-- search-planner.agent.ts  -- Decomposes questions into sub-queries
|   +-- memory-agent.ts          -- Memory-aware planning
+-- answer/                   # Answer synthesis (refactored Step 8)
|   +-- answer-mode.ts           -- Mode detection logic
|   +-- answer-renderers.ts      -- All renderers + shared helpers
|   +-- answer-synthesizer.ts    -- Thin orchestrator
+-- source-types.ts           -- Shared types
+-- answer-synthesizer.ts     -- (now in answer/)
+-- evidence-extractor.ts     -- Claim-level extraction
+-- citation-verifier.ts      -- Cross-source verification
+-- memory-ranking.ts         -- Memory-aware source ranking
+-- crawl-manager.ts          -- Crawl orchestration
+-- research-orchestrator.ts  -- Top-level orchestrator
```

## Key Concepts

### Answer Modes

| Mode | Trigger Keywords | Behaviour |
|------|-----------------|-----------|
| comparison | compare, vs, pros/cons | Structured entity-vs-aspect table |
| how_to | how do/to, steps, guide | Step-by-step procedural |
| research_summary | overview, summarize, research | Topic-grouped survey |
| general | (default) | Top-N evidence Q&A |

## Quick Start

```bash
pnpm install
pnpm --filter knowledge test
pnpm --filter knowledge build
```

## License

MIT
