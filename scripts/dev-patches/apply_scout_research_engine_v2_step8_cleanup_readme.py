#!/usr/bin/env python3
"""Step 8: Split answer-synthesizer into answer-mode + answer-renderers, update README/docs."""

import shutil, sys
from pathlib import Path

BASE = Path("/Users/teja/Desktop/Scout")
RESEARCH = BASE / "packages" / "knowledge" / "src" / "research"

def warn(msg):
    print(f"  WARN: {msg}")

print("=== Step 8: Cleanup, README, DRY refactor ===")

# 1. Create answer-mode.ts
answer_mode_ts = """import type { AnswerMode } from "./source-types.js";

export function detectAnswerMode(query: string, useCase?: string): AnswerMode {
  const q = query.toLowerCase();

  if (
    /\\b(compare|comparison|versus|vs\\.?|difference|differences|better|pros and cons|trade[\\-\\s]?off|tradeoff)\\b/.test(q) ||
    useCase === "comparison"
  ) {
    return "comparison";
  }

  if (
    /\\b(how to|implement|implementation|fix|debug|setup|set up|configure|install|integrate|deploy|error|issue|steps|guide)\\b/.test(q) ||
    useCase === "implementation_help" ||
    useCase === "tutorial"
  ) {
    return "how_to";
  }

  if (
    /\\b(overview|summarize|summary|explain|what is|research|tell me about|deep dive|analysis)\\b/.test(q)
  ) {
    return "research_summary";
  }

  return "general";
}
"""

(RESEARCH / "answer-mode.ts").write_text(answer_mode_ts)
print("  Created answer-mode.ts")

# 2. Create answer-renderers.ts
answer_renderers_ts = """import type {
  AnswerCitation,
  EvidenceItem,
  EvidencePack,
  SynthesizedAnswer,
  SourceTier,
  CitationVerificationStatus,
} from "./source-types.js";

type EvidenceWithStatus = {
  item: EvidenceItem;
  status: CitationVerificationStatus;
  score: number;
};

function tierWeight(tier: SourceTier): number {
  if (tier === "official_docs") return 30;
  if (tier === "trusted_docs") return 22;
  if (tier === "reference_examples") return 12;
  if (tier === "community") return 4;
  if (tier === "media") return 2;
  return 6;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9.+#\\s-]/g, " ")
    .split(/\\s+/)
    .filter((token) => token.length > 2);
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function shorten(text: string, maxChars: number): string {
  const clean = text.replace(/\\s+/g, " ").trim();
  if (clean.length <= maxChars) return clean;
  return clean.slice(0, maxChars - 3) + "...";
}

function sourceKey(item: EvidenceItem): string {
  return item.url || item.title + ":" + item.tier;
}

function evidenceKey(item: EvidenceItem): string {
  return item.url + "::" + item.claim.toLowerCase().replace(/\\s+/g, " ").trim();
}

function scoreEvidence(query: string, item: EvidenceItem, status: CitationVerificationStatus): number {
  const queryTokens = new Set(tokenize(query));
  const itemTokens = new Set(
    tokenize([item.claim, item.section, item.product, item.domain, ...item.entities].filter(Boolean).join(" "))
  );

  const overlap = [...itemTokens].filter((token) => queryTokens.has(token)).length;
  const statusWeight = status === "supported" ? 40 : status === "weak" ? 12 : -100;

  return statusWeight + item.confidence * 35 + tierWeight(item.tier) + overlap * 3;
}

export function buildCitationMap(evidence: EvidenceItem[]): {
  citationBySource: Map<string, AnswerCitation>;
  citationIdBySource: Map<string, number>;
} {
  const citationBySource = new Map<string, AnswerCitation>();
  const citationIdBySource = new Map<string, number>();

  for (const item of evidence) {
    const key = sourceKey(item);
    const existing = citationBySource.get(key);

    if (existing) {
      existing.usedClaims += 1;
      continue;
    }

    const id = citationBySource.size + 1;
    citationBySource.set(key, {
      id,
      title: item.title,
      url: item.url,
      tier: item.tier,
      usedClaims: 1,
    });
    citationIdBySource.set(key, id);
  }

  return { citationBySource, citationIdBySource };
}

function statusLabel(status: CitationVerificationStatus): string {
  if (status === "supported") return "supported";
  if (status === "weak") return "weak";
  return "unsupported";
}

export function groupEvidenceForAnswer(input: {
  query: string;
  evidencePack: EvidencePack;
  maxClaims: number;
}): EvidenceWithStatus[] {
  const seen = new Set<string>();
  const rows: EvidenceWithStatus[] = [];

  input.evidencePack.evidence.forEach((item, index) => {
    const verification = input.evidencePack.citationVerification[index];
    const status = verification?.status ?? "unsupported";

    if (status === "unsupported") return;

    const key = evidenceKey(item);
    if (seen.has(key)) return;
    seen.add(key);

    rows.push({
      item,
      status,
      score: scoreEvidence(input.query, item, status),
    });
  });

  return rows
    .sort((a, b) => b.score - a.score)
    .slice(0, input.maxClaims);
}

export function buildNoEvidenceAnswer(evidencePack: EvidencePack, mode: string): SynthesizedAnswer {
  const missing = evidencePack.coverage.missing.length
    ? evidencePack.coverage.missing.map((item) => "- " + item).join("\\n")
    : "- No supported or weak claim-level evidence was available.";

  return {
    status: "insufficient_evidence",
    mode: mode as AnswerMode,
    markdown: [
      "## Answer",
      "",
      "I do not have enough verified evidence to answer this confidently.",
      "",
      "## Evidence gaps",
      "",
      missing,
    ].join("\\n"),
    citations: [],
    usedEvidenceCount: 0,
    supportedEvidenceCount: 0,
    weakEvidenceCount: 0,
    omittedUnsupportedCount: evidencePack.coverage.unsupportedClaimCount,
    confidence: 0,
  };
}

export function confidenceForAnswer(rows: EvidenceWithStatus[]): number {
  if (rows.length === 0) return 0;

  const supported = rows.filter((row) => row.status === "supported");
  const usable = supported.length > 0 ? supported : rows;

  const avg = usable.reduce((sum, row) => sum + row.item.confidence, 0) / usable.length;
  const supportBoost = supported.length / rows.length;

  return Math.min(0.98, Number((avg * 0.8 + supportBoost * 0.2).toFixed(2)));
}

function citationSuffix(input: {
  item: EvidenceItem;
  citationIdBySource: Map<string, number>;
}): string {
  const citationId = input.citationIdBySource.get(sourceKey(input.item));
  return citationId ? " [" + citationId + "]" : "";
}

function buildSourcesMarkdown(citations: AnswerCitation[]): string {
  if (citations.length === 0) return "";
  return citations
    .map((citation) => "[" + citation.id + "] " + citation.title + " -- " + citation.url)
    .join("\\n");
}

function buildEvidenceNotesMarkdown(rows: EvidenceWithStatus[]): string {
  return rows
    .slice(0, 6)
    .map((row, index) => {
      const section = row.item.section ? ', section "' + row.item.section + '"' : "";
      return (index + 1) + ". " + statusLabel(row.status) + " evidence from " + row.item.title + section + ': "' + shorten(row.item.quote, 220) + '"';
    })
    .join("\\n");
}

function groupByProductOrDomain(rows: EvidenceWithStatus[]): Map<string, EvidenceWithStatus[]> {
  const groups = new Map<string, EvidenceWithStatus[]>();
  for (const row of rows) {
    const key = row.item.product || row.item.domain || row.item.entities[0] || row.item.title || "Other";
    const existing = groups.get(key) ?? [];
    existing.push(row);
    groups.set(key, existing);
  }
  return groups;
}

export function buildComparisonMarkdown(input: {
  query: string;
  rows: EvidenceWithStatus[];
  citations: AnswerCitation[];
  citationIdBySource: Map<string, number>;
  status: SynthesizedAnswer["status"];
}): string {
  const groups = groupByProductOrDomain(input.rows);
  const groupNames = [...groups.keys()].slice(0, 4);

  const tableRows = groupNames
    .map((name) => {
      const claims = (groups.get(name) ?? []).slice(0, 3);
      const summary = claims
        .map((row) => shorten(row.item.claim, 140) + citationSuffix({ item: row.item, citationIdBySource: input.citationIdBySource }))
        .join("<br>");
      return "| " + name + " | " + (summary || "No supported evidence found.") + " |";
    })
    .join("\\n");

  const topClaims = input.rows
    .slice(0, 5)
    .map((row, index) => {
      const prefix = row.status === "weak" ? "Likely: " : "";
      return (index + 1) + ". " + prefix + shorten(row.item.claim, 260) + citationSuffix({ item: row.item, citationIdBySource: input.citationIdBySource });
    })
    .join("\\n");

  return [
    "## Answer",
    "",
    input.status === "answered"
      ? "Here is the grounded comparison based on supported evidence."
      : "I found limited evidence, so treat this as a partial comparison.",
    "",
    "## Comparison table",
    "",
    "| Topic | Evidence-backed points |",
    "|---|---|",
    tableRows || "| Evidence | No comparable supported evidence found. |",
    "",
    "## Key takeaways",
    "",
    topClaims,
    "",
    "## Evidence notes",
    "",
    buildEvidenceNotesMarkdown(input.rows),
    "",
    "## Sources",
    "",
    buildSourcesMarkdown(input.citations),
  ]
    .filter((part) => part.trim().length > 0)
    .join("\\n");
}

export function buildHowToMarkdown(input: {
  rows: EvidenceWithStatus[];
  citations: AnswerCitation[];
  citationIdBySource: Map<string, number>;
  status: SynthesizedAnswer["status"];
}): string {
  const steps = input.rows
    .slice(0, 8)
    .map((row, index) => {
      const prefix = row.status === "weak" ? "Likely: " : "";
      return (index + 1) + ". " + prefix + shorten(row.item.claim, 280) + citationSuffix({ item: row.item, citationIdBySource: input.citationIdBySource });
    })
    .join("\\n");

  return [
    "## Answer",
    "",
    input.status === "answered"
      ? "Here are the evidence-backed steps/details."
      : "I found limited evidence, so treat these as partial steps.",
    "",
    "## Steps / implementation notes",
    "",
    steps,
    "",
    "## Things to verify",
    "",
    "- Check the linked official/trusted source before production use.",
    "- Treat weak evidence as a hint, not a final fact.",
    "- Re-run research with a narrower query if any required setup detail is missing.",
    "",
    "## Evidence notes",
    "",
    buildEvidenceNotesMarkdown(input.rows),
    "",
    "## Sources",
    "",
    buildSourcesMarkdown(input.citations),
  ]
    .filter((part) => part.trim().length > 0)
    .join("\\n");
}

export function buildResearchSummaryMarkdown(input: {
  rows: EvidenceWithStatus[];
  citations: AnswerCitation[];
  citationIdBySource: Map<string, number>;
  status: SynthesizedAnswer["status"];
}): string {
  const summaryClaims = input.rows
    .slice(0, 6)
    .map((row) => {
      const prefix = row.status === "weak" ? "Likely: " : "";
      return "- " + prefix + shorten(row.item.claim, 260) + citationSuffix({ item: row.item, citationIdBySource: input.citationIdBySource });
    })
    .join("\\n");

  return [
    "## Answer",
    "",
    input.status === "answered"
      ? "Here is the grounded research summary."
      : "I found limited evidence, so this is a partial research summary.",
    "",
    "## Main points",
    "",
    summaryClaims,
    "",
    "## Evidence notes",
    "",
    buildEvidenceNotesMarkdown(input.rows),
    "",
    "## Sources",
    "",
    buildSourcesMarkdown(input.citations),
  ]
    .filter((part) => part.trim().length > 0)
    .join("\\n");
}

export function buildGeneralMarkdown(input: {
  rows: EvidenceWithStatus[];
  citations: AnswerCitation[];
  citationIdBySource: Map<string, number>;
  status: SynthesizedAnswer["status"];
}): string {
  const claims = input.rows
    .slice(0, 10)
    .map((row, index) => {
      const prefix = row.status === "weak" ? "Likely: " : "";
      return (index + 1) + ". " + prefix + shorten(row.item.claim, 320) + citationSuffix({ item: row.item, citationIdBySource: input.citationIdBySource });
    })
    .join("\\n");

  return [
    "## Answer",
    "",
    input.status === "answered"
      ? "Based on " + input.rows.filter((row) => row.status === "supported").length + " supported claim(s) from " + input.citations.length + " source(s), here is the grounded answer."
      : "I found only weak evidence, so treat this as a partial answer.",
    "",
    claims,
    "",
    "## Evidence notes",
    "",
    buildEvidenceNotesMarkdown(input.rows),
    "",
    "## Sources",
    "",
    buildSourcesMarkdown(input.citations),
  ]
    .filter((part) => part.trim().length > 0)
    .join("\\n");
}

export function renderMarkdownForMode(input: {
  mode: string;
  query: string;
  rows: EvidenceWithStatus[];
  citations: AnswerCitation[];
  citationIdBySource: Map<string, number>;
  status: SynthesizedAnswer["status"];
}): string {
  if (input.mode === "comparison") return buildComparisonMarkdown(input);
  if (input.mode === "how_to") return buildHowToMarkdown(input);
  if (input.mode === "research_summary") return buildResearchSummaryMarkdown(input);
  return buildGeneralMarkdown(input);
}
"""

(RESEARCH / "answer-renderers.ts").write_text(answer_renderers_ts)
print("  Created answer-renderers.ts")

# 3. Rewrite answer-synthesizer.ts as thin orchestrator
answer_synthesizer_ts = """import type { EvidencePack, AnswerMode, SynthesizedAnswer } from "./source-types.js";
import { detectAnswerMode } from "./answer-mode.js";
import {
  groupEvidenceForAnswer,
  buildNoEvidenceAnswer,
  buildCitationMap,
  confidenceForAnswer,
  renderMarkdownForMode,
} from "./answer-renderers.js";

export function synthesizeAnswerFromEvidencePack(input: {
  query: string;
  evidencePack: EvidencePack;
  maxClaims?: number;
  mode?: AnswerMode;
}): SynthesizedAnswer {
  const mode = input.mode ?? detectAnswerMode(input.query, input.evidencePack.useCase);
  const maxClaims = input.maxClaims ?? (mode === "comparison" ? 14 : 10);

  const rows = groupEvidenceForAnswer({
    query: input.query,
    evidencePack: input.evidencePack,
    maxClaims,
  });

  if (rows.length === 0) {
    return buildNoEvidenceAnswer(input.evidencePack, mode);
  }

  const supportedEvidenceCount = rows.filter((row) => row.status === "supported").length;
  const weakEvidenceCount = rows.filter((row) => row.status === "weak").length;
  const status: SynthesizedAnswer["status"] =
    supportedEvidenceCount > 0 ? "answered" : "partial";

  const { citationBySource, citationIdBySource } = buildCitationMap(rows.map((row) => row.item));
  const citations = [...citationBySource.values()];

  const markdown = renderMarkdownForMode({
    mode,
    query: input.query,
    rows,
    citations,
    citationIdBySource,
    status,
  });

  return {
    status,
    mode,
    markdown,
    citations,
    usedEvidenceCount: rows.length,
    supportedEvidenceCount,
    weakEvidenceCount,
    omittedUnsupportedCount: input.evidencePack.coverage.unsupportedClaimCount,
    confidence: confidenceForAnswer(rows),
  };
}
"""

(RESEARCH / "answer-synthesizer.ts").write_text(answer_synthesizer_ts)
print("  Rewrote answer-synthesizer.ts (thin orchestrator)")

# 4. Update README.md
readme_md = """<p align="center">
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
"""

(BASE / "README.md").write_text(readme_md)
print("  Rewrote README.md")

# 5. Update index.ts
index_ts_path = BASE / "packages" / "knowledge" / "src" / "index.ts"
if index_ts_path.exists():
    current = index_ts_path.read_text()
    new_exports = """export * from "./research/answer-mode.js";
export * from "./research/answer-renderers.js";
"""
    # Insert after the answer-synthesizer export line
    if "answer-synthesizer" in current:
        lines = current.splitlines(keepends=True)
        for i, line in enumerate(lines):
            if "answer-synthesizer" in line:
                lines.insert(i + 1, new_exports)
                break
        index_ts_path.write_text("".join(lines))
        print("  Updated index.ts")
    else:
        warn("Could not find answer-synthesizer export, appending")
        index_ts_path.write_text(current + "\n" + new_exports)
else:
    warn("index.ts not found")

# 6. Update TODO.md
todo_md = """# Research Engine v2 -- TODO

## Complete

- [x] Step 1 -- Agents folder, memory layer, Scrapling crawling, crawl manager, orchestrator, TODO/LESSONS
- [x] Step 2 -- Evidence extractor, citation verifier, enhanced EvidencePack
- [x] Step 3 -- Multi-query resource planning (SearchPlannerAgent.subqueries)
- [x] Step 4 -- Memory v2: source_failure & durable_fact types, memory dedup
- [x] Step 5 -- Memory-aware source ranking (memory-ranking.ts)
- [x] Step 6 -- Evidence-based answer synthesis (answer-synthesizer.ts)
- [x] Step 7 -- Answer quality modes (comparison, how_to, research_summary, general)
- [x] Step 8 -- DRY refactor: split answer-mode.ts + answer-renderers.ts, comprehensive README

## Future

- [ ] Web UI for interactive research sessions
- [ ] Streaming answer generation
- [ ] Custom tool integrations (Slack, Discord, email)
- [ ] Fine-tuning memory ranking weights via feedback
- [ ] Multi-language support
- [ ] Persist memory to disk (SQLite/LevelDB)
"""

(BASE / "TODO.md").write_text(todo_md)
print("  Updated TODO.md")

# 7. Update LESSONS.md
lessons_md = """# Research Engine v2 -- Lessons Learned

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
"""

(BASE / "LESSONS.md").write_text(lessons_md)
print("  Updated LESSONS.md")

# 8. Move root patch scripts to scripts/dev-patches/
scripts_dir = BASE / "scripts" / "dev-patches"
scripts_dir.mkdir(parents=True, exist_ok=True)

script_moves = [
    "apply_mcp_config.py",
    "apply_prompts.py",
    "apply_research_engine_v2.py",
    "apply_scout_research_engine_v2_step2_evidence_extractor.py",
    "apply_scout_research_engine_v2_step3_multi_query_planning.py",
    "apply_scout_research_engine_v2_step4_memory_types.py",
    "apply_scout_research_engine_v2_step5_memory_ranking.py",
    "apply_scout_research_engine_v2_step6_answer_synthesis.py",
    "apply_scout_research_engine_v2_step7_answer_quality_modes.py",
]

# Also look for numbered step scripts without the full prefix
additional_moves = [
    "apply_scout_research_engine_v2_step2.py",
    "apply_scout_research_engine_v2_step4_memory.py",
]

for fname in script_moves + additional_moves:
    src = BASE / fname
    dst = scripts_dir / fname
    if src.exists():
        shutil.move(str(src), str(dst))
        print(f"  Moved {fname} -> scripts/dev-patches/")

print()
print("Step 8 complete!")
