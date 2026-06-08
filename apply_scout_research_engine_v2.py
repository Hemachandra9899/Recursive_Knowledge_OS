#!/usr/bin/env python3
"""
Apply Scout Research Engine v2 implementation slice.

Run this from the Scout repo root:

    python apply_scout_research_engine_v2.py

Then run:

    npm run prisma:generate
    prisma migrate dev --schema=prisma/schema.prisma --name add_memory_model
    docker compose build model-service api worker
"""

from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path.cwd()


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    print(f"wrote {path}")


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    if old not in text:
        raise RuntimeError(f"Could not find target text in {path}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")
    print(f"updated {path}")


def replace_regex(path: str, pattern: str, replacement: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    new_text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"Could not apply regex replacement in {path}")
    target.write_text(new_text, encoding="utf-8")
    print(f"updated {path}")


def update_package_exports() -> None:
    path = ROOT / "packages/knowledge/package.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    exports = data.setdefault("exports", {})

    additions = {
        "./research/crawl-manager": "./src/research/crawl-manager.js",
        "./research/crawl-manager.js": "./src/research/crawl-manager.js",
        "./research/research-orchestrator": "./src/research/research-orchestrator.js",
        "./research/research-orchestrator.js": "./src/research/research-orchestrator.js",
        "./agents/types": "./src/agents/types.js",
        "./agents/types.js": "./src/agents/types.js",
        "./agents/search-planner.agent": "./src/agents/search-planner.agent.js",
        "./agents/search-planner.agent.js": "./src/agents/search-planner.agent.js",
        "./agents/memory-agent": "./src/agents/memory-agent.js",
        "./agents/memory-agent.js": "./src/agents/memory-agent.js",
        "./memory/memory-types": "./src/memory/memory-types.js",
        "./memory/memory-types.js": "./src/memory/memory-types.js",
        "./memory/memory-manager": "./src/memory/memory-manager.js",
        "./memory/memory-manager.js": "./src/memory/memory-manager.js",
    }

    exports.update(additions)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print("updated packages/knowledge/package.json")


def update_index_exports() -> None:
    path = ROOT / "packages/knowledge/src/index.ts"
    text = path.read_text(encoding="utf-8")
    additions = [
        'export * from "./research/crawl-manager.js";',
        'export * from "./research/research-orchestrator.js";',
        'export * from "./agents/types.js";',
        'export * from "./agents/search-planner.agent.js";',
        'export * from "./agents/memory-agent.js";',
        'export * from "./memory/memory-types.js";',
        'export * from "./memory/memory-manager.js";',
    ]

    for line in additions:
        if line not in text:
            text += f"\n{line}"

    path.write_text(text.rstrip() + "\n", encoding="utf-8")
    print("updated packages/knowledge/src/index.ts")


def update_prisma_schema() -> None:
    path = ROOT / "prisma/schema.prisma"
    text = path.read_text(encoding="utf-8")

    if "memories      Memory[]" not in text:
        text = text.replace(
            "  messages      ChatMessage[]\n}",
            "  messages      ChatMessage[]\n  memories      Memory[]\n}",
            1,
        )

    memory_model = """model Memory {
  id         String   @id @default(uuid())
  projectId  String
  userId     String?
  scope      String
  kind       String
  text       String
  entities   Json     @default("[]")
  sourceUrls Json     @default("[]")
  confidence Float    @default(0.7)
  eventTime  DateTime?
  metadata   Json     @default("{}")
  createdAt  DateTime @default(now())

  project    Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@index([projectId])
  @@index([userId])
  @@index([scope])
  @@index([kind])
  @@index([createdAt])
}

"""

    if "model Memory" not in text:
        text = text.replace("model AgentRun {", memory_model + "model AgentRun {", 1)

    path.write_text(text, encoding="utf-8")
    print("updated prisma/schema.prisma")


def update_tools_service() -> None:
    path = ROOT / "apps/api/src/modules/tools/tools.service.ts"
    text = path.read_text(encoding="utf-8")

    if "ResearchOrchestrator" not in text:
        text = text.replace(
            "  preview,\n  scrapePageWithScrapling,",
            "  preview,\n  ResearchOrchestrator,\n  scrapePageWithScrapling,\n  crawlSiteWithScrapling,"
        )

    crawl_fn = """export async function crawlUrl(input: CrawlUrlInput) {
  const crawl = await crawlSiteWithScrapling({
    rootUrl: input.url,
    maxPages: input.maxPages ?? 1,
    maxDepth: input.maxDepth ?? 0,
    mode: "auto",
    aiTargeted: true,
    sameDomainOnly: true,
  });

  const documents = [];

  for (const page of crawl.pages) {
    const ingested = await ingestMarkdownDocument({
      projectId: input.projectId,
      sourceUrl: page.url,
      title: page.title,
      markdown: page.markdown,
      metadata: page.metadata,
    });

    documents.push({
      url: page.url,
      title: page.title,
      documentId: ingested.document.id,
      chunksCreated: ingested.chunksCreated,
      chunksTotal: ingested.chunksTotal,
      embeddedChunks: ingested.embeddedChunks,
      embeddingError: ingested.embeddingError,
      deduped: ingested.deduped,
      markdownPreview: preview(page.markdown, 1200),
    });
  }

  return {
    status: "ok",
    rootUrl: crawl.rootUrl,
    documents,
    failedUrls: crawl.failedUrls,
    pagesCrawled: documents.length,
  };
}

"""

    text = re.sub(
        r"export async function crawlUrl\(input: CrawlUrlInput\) \{.*?\n\}\n\nexport async function searchKnowledgeBase",
        crawl_fn + "export async function searchKnowledgeBase",
        text,
        count=1,
        flags=re.S,
    )

    orchestrator_block = """export async function webResearch(input: WebResearchInput) {
  if (input.useOrchestrator) {
    const orchestrator = new ResearchOrchestrator();
    return orchestrator.run({
      projectId: input.projectId,
      query: input.query,
      maxSources: input.maxResults,
      maxPagesPerSource: input.maxPagesPerSource,
      maxTotalPages: input.maxTotalPages,
      maxDepth: input.maxDepth,
    });
  }

"""

    if "if (input.useOrchestrator)" not in text:
        text = text.replace(
            "export async function webResearch(input: WebResearchInput) {\n",
            orchestrator_block,
            1,
        )

    path.write_text(text, encoding="utf-8")
    print("updated apps/api/src/modules/tools/tools.service.ts")


def main() -> None:
    write("docs/TODO.md", '# Scout TODO\n\nThis file tracks the next implementation steps for Scout Research Engine v2.\n\n## Now\n\n### Research orchestration\n\n- [ ] Add `ResearchOrchestrator` as the deterministic top-level research pipeline.\n- [ ] Keep the existing RLM runtime as the execution/reasoning layer, not the whole control plane.\n- [ ] Wire `ResearchOrchestrator` into `/tools/web-research` after this first slice is stable.\n\n### Agents\n\n- [ ] Create a small, clean `packages/knowledge/src/agents` folder.\n- [ ] Start with deterministic agents:\n  - `SearchPlannerAgent`\n  - `MemoryAgent`\n  - `CoordinatorAgent` later\n- [ ] Avoid large swarm complexity until the basic research pipeline is reliable.\n\n### Crawling\n\n- [ ] Replace single-page-only crawl behavior with bounded site crawling.\n- [ ] Use Scrapling modes:\n  - `static` for normal docs/blogs.\n  - `dynamic` for JS-heavy pages.\n  - `stealth` for protected pages only when needed.\n- [ ] Always keep crawler limits:\n  - `maxPages`\n  - `maxDepth`\n  - same-domain restriction\n  - timeout\n  - duplicate URL removal\n\n### Memory\n\n- [ ] Add a first-class `Memory` Prisma model.\n- [ ] Use add-only memory writes.\n- [ ] Do not update/delete memories in v1.\n- [ ] Store source quality, decisions, durable facts, and task traces.\n- [ ] Add vector-backed memory retrieval later.\n\n### Evidence\n\n- [ ] Upgrade `EvidencePack` from page previews to claim-level evidence.\n- [ ] Store:\n  - claim\n  - quote\n  - source URL\n  - source title\n  - confidence\n  - source tier\n- [ ] Add a verifier after claim extraction.\n\n## Next\n\n- [ ] Add graph extraction from crawled Markdown.\n- [ ] Store entities, relations, and claims using existing Prisma graph tables.\n- [ ] Add source freshness scoring.\n- [ ] Add source diversity scoring.\n- [ ] Add per-domain crawl budgets.\n- [ ] Add source failure memory so Scout avoids repeatedly bad URLs.\n\n## Later\n\n- [ ] Add swarm execution for parallel subquery search.\n- [ ] Add swarm execution for parallel source crawling.\n- [ ] Add multi-provider web search:\n  - Firecrawl\n  - Brave Search\n  - Tavily\n  - GitHub Search\n  - Docs registry\n- [ ] Add streaming run traces in the UI.\n- [ ] Add source drawer with per-claim citations.\n')
    write("docs/LESSONS.md", '# Scout Lessons\n\n## Architecture lessons\n\n1. **Search and crawl are different jobs.**\n   Search should discover candidate resources. Crawling should deeply extract content only after sources are ranked.\n\n2. **Scrapling is the crawler, not the planner.**\n   Scrapling should be used after Scout decides which URLs matter.\n\n3. **The RLM runtime should not own the whole pipeline.**\n   RLM is useful for reasoning, code execution, and flexible tool use. The product should still have a deterministic research pipeline.\n\n4. **Small agents first.**\n   Do not start with a large swarm. Start with a few focused agents:\n   - Search planner\n   - Crawler\n   - Evidence extractor\n   - Memory agent\n   - Answer agent\n\n5. **Memory must be scoped.**\n   User preferences, project facts, source quality, and task traces should not be mixed together.\n\n6. **Memory should be add-only in v1.**\n   Do not overwrite facts early. Add new dated facts and let retrieval choose the best one.\n\n7. **Evidence should be claim-level.**\n   Page-level snippets are useful, but final answers need claim-level support with citations.\n\n8. **Deep crawl must be bounded.**\n   Every crawl needs max pages, max depth, same-domain restriction, and timeout.\n\n9. **Official docs should usually win.**\n   For API, SDK, product, and framework questions, official docs should outrank blogs and community content.\n\n10. **Source failures are useful memory.**\n    Failed crawls, blocked pages, duplicate pages, and low-value pages should be remembered so Scout improves over time.\n')

    write("packages/knowledge/src/agents/types.ts", 'export type ScoutAgentName =\n  | "coordinator"\n  | "search_planner"\n  | "crawler"\n  | "evidence"\n  | "memory"\n  | "answer"\n  | "graph"\n  | "verifier";\n\nexport type AgentContext = {\n  projectId: string;\n  userId?: string;\n  runId?: string;\n  query: string;\n  now?: Date;\n  metadata?: Record<string, unknown>;\n};\n\nexport type AgentResult<T> = {\n  agent: ScoutAgentName;\n  status: "ok" | "skipped" | "error";\n  output?: T;\n  error?: string;\n  metadata?: Record<string, unknown>;\n};\n\nexport function okAgentResult<T>(\n  agent: ScoutAgentName,\n  output: T,\n  metadata?: Record<string, unknown>\n): AgentResult<T> {\n  return { agent, status: "ok", output, metadata };\n}\n')
    write("packages/knowledge/src/agents/search-planner.agent.ts", 'import {\n  buildFallbackSearchQueries,\n  inferSourceUseCase,\n  normalizeResearchQuery,\n} from "../research/query-builder.js";\nimport type { SourceUseCase } from "../research/source-types.js";\nimport type { AgentContext, AgentResult } from "./types.js";\nimport { okAgentResult } from "./types.js";\n\nexport type PlannedSearchQuery = {\n  query: string;\n  reason: string;\n  priority: number;\n};\n\nexport type ResearchPlan = {\n  originalQuery: string;\n  normalizedQuery: string;\n  useCase: SourceUseCase;\n  entities: string[];\n  subqueries: PlannedSearchQuery[];\n  needsFreshness: boolean;\n  needsOfficialDocs: boolean;\n  recommendedMaxSources: number;\n  recommendedMaxPagesPerSource: number;\n};\n\nfunction unique(values: string[]): string[] {\n  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];\n}\n\nfunction extractSimpleEntities(query: string): string[] {\n  const candidates = query.match(/\\b[A-Z][A-Za-z0-9.+#-]*(?:\\s+[A-Z][A-Za-z0-9.+#-]*){0,4}\\b/g);\n  return unique(candidates ?? []).slice(0, 12);\n}\n\nfunction needsFreshness(query: string): boolean {\n  return /\\b(latest|current|today|recent|2025|2026|price|pricing|rate limit|version|changelog|news)\\b/i.test(\n    query\n  );\n}\n\nfunction needsOfficialDocs(useCase: SourceUseCase): boolean {\n  return useCase === "api_facts" || useCase === "comparison" || useCase === "implementation_help";\n}\n\nexport class SearchPlannerAgent {\n  plan(context: AgentContext): AgentResult<ResearchPlan> {\n    const normalizedQuery = normalizeResearchQuery(context.query);\n    const useCase = inferSourceUseCase(normalizedQuery);\n    const fallbackQueries = buildFallbackSearchQueries(normalizedQuery);\n    const officialDocsRequired = needsOfficialDocs(useCase);\n\n    const subqueries: PlannedSearchQuery[] = fallbackQueries.map((query, index) => ({\n      query,\n      priority: 100 - index * 10,\n      reason:\n        index === 0\n          ? "Primary query generated from normalized user intent."\n          : "Fallback query to improve source coverage.",\n    }));\n\n    if (officialDocsRequired) {\n      subqueries.unshift({\n        query: `${normalizedQuery} official docs`,\n        reason: "Official documentation should be preferred for factual/API research.",\n        priority: 120,\n      });\n    }\n\n    if (needsFreshness(normalizedQuery)) {\n      subqueries.push({\n        query: `${normalizedQuery} latest update changelog`,\n        reason: "Freshness-sensitive query for recent changes.",\n        priority: 75,\n      });\n    }\n\n    const plan: ResearchPlan = {\n      originalQuery: context.query,\n      normalizedQuery,\n      useCase,\n      entities: extractSimpleEntities(normalizedQuery),\n      subqueries: unique(subqueries.map((item) => item.query)).map((query) => {\n        const original = subqueries.find((item) => item.query === query);\n        return {\n          query,\n          reason: original?.reason ?? "Deduplicated planned query.",\n          priority: original?.priority ?? 50,\n        };\n      }),\n      needsFreshness: needsFreshness(normalizedQuery),\n      needsOfficialDocs: officialDocsRequired,\n      recommendedMaxSources: officialDocsRequired ? 8 : 6,\n      recommendedMaxPagesPerSource: officialDocsRequired ? 5 : 3,\n    };\n\n    return okAgentResult("search_planner", plan, {\n      subqueryCount: plan.subqueries.length,\n    });\n  }\n}\n')
    write("packages/knowledge/src/agents/memory-agent.ts", 'import type { AgentContext, AgentResult } from "./types.js";\nimport { okAgentResult } from "./types.js";\nimport { MemoryManager } from "../memory/memory-manager.js";\nimport type { ScoutMemory, ScoutMemoryDraft } from "../memory/memory-types.js";\nimport type { EvidencePack } from "../research/source-types.js";\n\nexport type MemoryAgentOutput = {\n  retrieved: ScoutMemory[];\n  written: number;\n};\n\nexport class MemoryAgent {\n  constructor(private readonly memoryManager = new MemoryManager()) {}\n\n  async retrieveForRun(context: AgentContext): Promise<AgentResult<MemoryAgentOutput>> {\n    const retrieved = await this.memoryManager.search({\n      projectId: context.projectId,\n      userId: context.userId,\n      query: context.query,\n      limit: 8,\n    });\n\n    return okAgentResult("memory", {\n      retrieved,\n      written: 0,\n    });\n  }\n\n  buildSourceMemoriesFromEvidencePack(input: {\n    projectId: string;\n    userId?: string;\n    evidencePack: EvidencePack;\n  }): ScoutMemoryDraft[] {\n    return this.memoryManager.buildSourceMemoriesFromEvidencePack(input);\n  }\n\n  async writeRunMemories(\n    context: AgentContext,\n    drafts: ScoutMemoryDraft[]\n  ): Promise<AgentResult<MemoryAgentOutput>> {\n    if (drafts.length === 0) {\n      return okAgentResult("memory", {\n        retrieved: [],\n        written: 0,\n      });\n    }\n\n    const written = await this.memoryManager.addMany(\n      drafts.map((draft) => ({\n        ...draft,\n        projectId: context.projectId,\n        userId: draft.userId ?? context.userId,\n      }))\n    );\n\n    return okAgentResult("memory", {\n      retrieved: [],\n      written,\n    });\n  }\n}\n')

    write("packages/knowledge/src/memory/memory-types.ts", 'export type ScoutMemoryScope =\n  | "user"\n  | "project"\n  | "session"\n  | "agent"\n  | "source";\n\nexport type ScoutMemoryKind =\n  | "preference"\n  | "fact"\n  | "source_quality"\n  | "decision"\n  | "task_trace";\n\nexport type ScoutMemory = {\n  id: string;\n  projectId: string;\n  userId?: string | null;\n  scope: ScoutMemoryScope;\n  kind: ScoutMemoryKind;\n  text: string;\n  entities: string[];\n  sourceUrls: string[];\n  confidence: number;\n  eventTime?: Date | null;\n  metadata: Record<string, unknown>;\n  createdAt: Date;\n};\n\nexport type ScoutMemoryDraft = {\n  projectId: string;\n  userId?: string;\n  scope: ScoutMemoryScope;\n  kind: ScoutMemoryKind;\n  text: string;\n  entities?: string[];\n  sourceUrls?: string[];\n  confidence?: number;\n  eventTime?: Date;\n  metadata?: Record<string, unknown>;\n};\n\nexport type ScoutMemorySearchInput = {\n  projectId: string;\n  userId?: string;\n  query: string;\n  limit?: number;\n  scopes?: ScoutMemoryScope[];\n  kinds?: ScoutMemoryKind[];\n};\n')
    write("packages/knowledge/src/memory/memory-manager.ts", 'import { prisma } from "@rlm-forge/database/prisma.js";\nimport type {\n  ScoutMemory,\n  ScoutMemoryDraft,\n  ScoutMemorySearchInput,\n} from "./memory-types.js";\nimport type { EvidencePack } from "../research/source-types.js";\n\nfunction asStringArray(value: unknown): string[] {\n  if (!Array.isArray(value)) return [];\n  return value.map(String).filter(Boolean);\n}\n\nfunction asRecord(value: unknown): Record<string, unknown> {\n  if (!value || typeof value !== "object" || Array.isArray(value)) return {};\n  return value as Record<string, unknown>;\n}\n\nfunction toScoutMemory(row: any): ScoutMemory {\n  return {\n    id: row.id,\n    projectId: row.projectId,\n    userId: row.userId,\n    scope: row.scope,\n    kind: row.kind,\n    text: row.text,\n    entities: asStringArray(row.entities),\n    sourceUrls: asStringArray(row.sourceUrls),\n    confidence: row.confidence ?? 0.7,\n    eventTime: row.eventTime,\n    metadata: asRecord(row.metadata),\n    createdAt: row.createdAt,\n  };\n}\n\nfunction scoreMemory(query: string, memory: ScoutMemory): number {\n  const q = query.toLowerCase();\n  const text = memory.text.toLowerCase();\n  const entityScore = memory.entities.some((entity) =>\n    q.includes(entity.toLowerCase())\n  )\n    ? 25\n    : 0;\n\n  const keywordScore = q\n    .split(/\\s+/)\n    .filter((token) => token.length > 3 && text.includes(token)).length;\n\n  const recencyScore = Math.max(\n    0,\n    10 -\n      Math.floor(\n        (Date.now() - memory.createdAt.getTime()) / (1000 * 60 * 60 * 24 * 30)\n      )\n  );\n\n  return memory.confidence * 50 + entityScore + keywordScore * 3 + recencyScore;\n}\n\nexport class MemoryManager {\n  async addMany(drafts: ScoutMemoryDraft[]): Promise<number> {\n    if (drafts.length === 0) return 0;\n\n    await prisma.memory.createMany({\n      data: drafts.map((draft) => ({\n        projectId: draft.projectId,\n        userId: draft.userId,\n        scope: draft.scope,\n        kind: draft.kind,\n        text: draft.text,\n        entities: draft.entities ?? [],\n        sourceUrls: draft.sourceUrls ?? [],\n        confidence: draft.confidence ?? 0.7,\n        eventTime: draft.eventTime,\n        metadata: draft.metadata ?? {},\n      })),\n    });\n\n    return drafts.length;\n  }\n\n  async search(input: ScoutMemorySearchInput): Promise<ScoutMemory[]> {\n    const limit = input.limit ?? 8;\n    const rows = await prisma.memory.findMany({\n      where: {\n        projectId: input.projectId,\n        ...(input.userId\n          ? {\n              OR: [{ userId: input.userId }, { userId: null }],\n            }\n          : {}),\n        ...(input.scopes?.length ? { scope: { in: input.scopes } } : {}),\n        ...(input.kinds?.length ? { kind: { in: input.kinds } } : {}),\n      },\n      orderBy: { createdAt: "desc" },\n      take: Math.max(limit * 5, 25),\n    });\n\n    return rows\n      .map(toScoutMemory)\n      .sort((a, b) => scoreMemory(input.query, b) - scoreMemory(input.query, a))\n      .slice(0, limit);\n  }\n\n  buildSourceMemoriesFromEvidencePack(input: {\n    projectId: string;\n    userId?: string;\n    evidencePack: EvidencePack;\n  }): ScoutMemoryDraft[] {\n    const drafts: ScoutMemoryDraft[] = [];\n\n    for (const item of input.evidencePack.evidence) {\n      if (!item.url) continue;\n\n      drafts.push({\n        projectId: input.projectId,\n        userId: input.userId,\n        scope: "source",\n        kind: "source_quality",\n        text: `Source "${item.title}" was used for query "${input.evidencePack.query}" and ranked as ${item.tier}.`,\n        sourceUrls: [item.url],\n        entities: [item.product, item.domain].filter(Boolean) as string[],\n        confidence:\n          item.tier === "official_docs" || item.tier === "trusted_docs"\n            ? 0.9\n            : 0.65,\n        metadata: {\n          title: item.title,\n          tier: item.tier,\n          reason: item.reason,\n          query: input.evidencePack.query,\n        },\n      });\n    }\n\n    return drafts;\n  }\n}\n')

    write("packages/knowledge/src/scrapers/scrapling.scraper.ts", 'const MODEL_SERVICE_URL =\n  process.env.MODEL_SERVICE_URL || "http://model-service:8100";\n\nexport type ScrapedPage = {\n  status: string;\n  url: string;\n  title: string;\n  markdown: string;\n  metadata: Record<string, unknown>;\n};\n\nexport type ScraplingCrawlMode = "auto" | "static" | "dynamic" | "stealth";\n\nexport type ScraplingCrawlPage = ScrapedPage & {\n  depth: number;\n  parentUrl?: string | null;\n};\n\nexport type ScraplingCrawlOutput = {\n  status: string;\n  rootUrl: string;\n  pages: ScraplingCrawlPage[];\n  failedUrls: Array<{ url: string; reason: string }>;\n  metadata: Record<string, unknown>;\n};\n\nexport async function scrapePageWithScrapling(\n  url: string,\n  options?: {\n    mode?: ScraplingCrawlMode;\n    aiTargeted?: boolean;\n  }\n): Promise<ScrapedPage> {\n  const response = await fetch(`${MODEL_SERVICE_URL}/scrape/page`, {\n    method: "POST",\n    headers: {\n      "Content-Type": "application/json",\n    },\n    body: JSON.stringify({\n      url,\n      mode: options?.mode ?? "auto",\n      ai_targeted: options?.aiTargeted ?? true,\n    }),\n  });\n\n  if (!response.ok) {\n    const text = await response.text();\n    throw new Error(`Scrapling scrape failed: ${response.status} ${text}`);\n  }\n\n  return await response.json();\n}\n\nexport async function crawlSiteWithScrapling(input: {\n  rootUrl: string;\n  maxPages?: number;\n  maxDepth?: number;\n  mode?: ScraplingCrawlMode;\n  aiTargeted?: boolean;\n  sameDomainOnly?: boolean;\n}): Promise<ScraplingCrawlOutput> {\n  const response = await fetch(`${MODEL_SERVICE_URL}/scrape/crawl`, {\n    method: "POST",\n    headers: {\n      "Content-Type": "application/json",\n    },\n    body: JSON.stringify({\n      root_url: input.rootUrl,\n      max_pages: input.maxPages ?? 5,\n      max_depth: input.maxDepth ?? 1,\n      mode: input.mode ?? "auto",\n      ai_targeted: input.aiTargeted ?? true,\n      same_domain_only: input.sameDomainOnly ?? true,\n    }),\n  });\n\n  if (!response.ok) {\n    const text = await response.text();\n    throw new Error(`Scrapling crawl failed: ${response.status} ${text}`);\n  }\n\n  return await response.json();\n}\n')
    write("packages/knowledge/src/research/crawl-manager.ts", 'import { crawlSiteWithScrapling } from "../scrapers/scrapling.scraper.js";\nimport type { RankedResource, EvidenceItem } from "./source-types.js";\nimport { preview } from "../text/chunk-text.js";\n\nexport type CrawlManagerInput = {\n  projectId: string;\n  query: string;\n  resources: RankedResource[];\n  maxPagesPerSource?: number;\n  maxTotalPages?: number;\n  maxDepth?: number;\n};\n\nexport type CrawledResearchPage = {\n  title: string;\n  url: string;\n  markdown: string;\n  depth: number;\n  source: RankedResource;\n  metadata: Record<string, unknown>;\n};\n\nexport type CrawlManagerOutput = {\n  pages: CrawledResearchPage[];\n  evidence: EvidenceItem[];\n  failed: Array<{\n    title?: string;\n    url?: string;\n    reason: string;\n  }>;\n};\n\nfunction modeForResource(resource: RankedResource): "auto" | "static" | "dynamic" | "stealth" {\n  if (resource.tier === "official_docs" || resource.tier === "trusted_docs") {\n    return "auto";\n  }\n\n  if (resource.tier === "community" || resource.tier === "media") {\n    return "dynamic";\n  }\n\n  return "auto";\n}\n\nexport async function crawlResearchSources(\n  input: CrawlManagerInput\n): Promise<CrawlManagerOutput> {\n  const maxPagesPerSource = input.maxPagesPerSource ?? 3;\n  const maxTotalPages = input.maxTotalPages ?? 20;\n  const maxDepth = input.maxDepth ?? 1;\n\n  const pages: CrawledResearchPage[] = [];\n  const evidence: EvidenceItem[] = [];\n  const failed: CrawlManagerOutput["failed"] = [];\n\n  for (const resource of input.resources) {\n    if (pages.length >= maxTotalPages) break;\n\n    try {\n      const crawl = await crawlSiteWithScrapling({\n        rootUrl: resource.url,\n        maxPages: Math.min(maxPagesPerSource, maxTotalPages - pages.length),\n        maxDepth,\n        mode: modeForResource(resource),\n        aiTargeted: true,\n        sameDomainOnly: true,\n      });\n\n      for (const failedUrl of crawl.failedUrls ?? []) {\n        failed.push({\n          title: resource.title,\n          url: failedUrl.url,\n          reason: failedUrl.reason,\n        });\n      }\n\n      for (const page of crawl.pages ?? []) {\n        if (!page.markdown?.trim()) continue;\n\n        const crawledPage: CrawledResearchPage = {\n          title: page.title || resource.title,\n          url: page.url,\n          markdown: page.markdown,\n          depth: page.depth,\n          source: resource,\n          metadata: {\n            ...page.metadata,\n            rootUrl: resource.url,\n            sourceTier: resource.tier,\n            sourceScore: resource.score,\n            matchedBy: resource.matchedBy,\n          },\n        };\n\n        pages.push(crawledPage);\n\n        evidence.push({\n          title: crawledPage.title,\n          url: crawledPage.url,\n          product: resource.product,\n          domain: resource.domain,\n          tier: resource.tier,\n          text: preview(crawledPage.markdown, 1800),\n          reason: resource.reason,\n        });\n\n        if (pages.length >= maxTotalPages) break;\n      }\n    } catch (error) {\n      failed.push({\n        title: resource.title,\n        url: resource.url,\n        reason: error instanceof Error ? error.message : String(error),\n      });\n    }\n  }\n\n  return {\n    pages,\n    evidence,\n    failed,\n  };\n}\n')
    write("packages/knowledge/src/research/research-orchestrator.ts", 'import { ingestMarkdownDocument } from "../ingestion/ingest-markdown-document.js";\nimport { SearchPlannerAgent } from "../agents/search-planner.agent.js";\nimport { MemoryAgent } from "../agents/memory-agent.js";\nimport { planResources } from "./resource-planner.js";\nimport { crawlResearchSources } from "./crawl-manager.js";\nimport { buildEvidencePack } from "./evidence-pack.js";\nimport type { EvidencePack } from "./source-types.js";\n\nexport type ResearchOrchestratorInput = {\n  projectId: string;\n  userId?: string;\n  query: string;\n  maxSources?: number;\n  maxPagesPerSource?: number;\n  maxTotalPages?: number;\n  maxDepth?: number;\n};\n\nexport type ResearchOrchestratorOutput = {\n  status: "ok" | "partial" | "error";\n  query: string;\n  normalizedQuery: string;\n  plan: unknown;\n  resourcesPlanned: Array<{\n    title: string;\n    url: string;\n    tier: string;\n    score: number;\n    source: string;\n    reason: string;\n  }>;\n  memories: {\n    retrieved: number;\n    written: number;\n  };\n  documents: Array<{\n    documentId: string;\n    title: string;\n    url: string;\n    chunksTotal: number;\n    embeddedChunks: number;\n    deduped: boolean;\n  }>;\n  failedCrawls: Array<{\n    title?: string;\n    url?: string;\n    reason: string;\n  }>;\n  evidencePack: EvidencePack;\n};\n\nexport class ResearchOrchestrator {\n  constructor(\n    private readonly searchPlanner = new SearchPlannerAgent(),\n    private readonly memoryAgent = new MemoryAgent()\n  ) {}\n\n  async run(input: ResearchOrchestratorInput): Promise<ResearchOrchestratorOutput> {\n    const context = {\n      projectId: input.projectId,\n      userId: input.userId,\n      query: input.query,\n    };\n\n    const planResult = this.searchPlanner.plan(context);\n    if (planResult.status !== "ok" || !planResult.output) {\n      throw new Error(planResult.error ?? "Search planning failed");\n    }\n\n    const memoryResult = await this.memoryAgent.retrieveForRun(context);\n    const retrievedMemoryCount = memoryResult.output?.retrieved.length ?? 0;\n\n    const maxSources =\n      input.maxSources ?? planResult.output.recommendedMaxSources ?? 8;\n\n    const resourcePlan = await planResources({\n      query: planResult.output.normalizedQuery,\n      maxSources,\n    });\n\n    const crawl = await crawlResearchSources({\n      projectId: input.projectId,\n      query: planResult.output.normalizedQuery,\n      resources: resourcePlan.resources,\n      maxPagesPerSource:\n        input.maxPagesPerSource ??\n        planResult.output.recommendedMaxPagesPerSource ??\n        3,\n      maxTotalPages: input.maxTotalPages ?? 20,\n      maxDepth: input.maxDepth ?? 1,\n    });\n\n    const documents = [];\n\n    for (const page of crawl.pages) {\n      const ingested = await ingestMarkdownDocument({\n        projectId: input.projectId,\n        sourceUrl: page.url,\n        title: page.title,\n        markdown: page.markdown,\n        metadata: {\n          ...page.metadata,\n          provider: "scrapling",\n          researchQuery: input.query,\n          normalizedQuery: resourcePlan.normalizedQuery,\n          sourceTitle: page.source.title,\n          sourceTier: page.source.tier,\n          sourceScore: page.source.score,\n        },\n      });\n\n      documents.push({\n        documentId: ingested.document.id,\n        title: page.title,\n        url: page.url,\n        chunksTotal: ingested.chunksTotal,\n        embeddedChunks: ingested.embeddedChunks,\n        deduped: ingested.deduped,\n      });\n    }\n\n    const evidencePack = buildEvidencePack({\n      query: input.query,\n      resourcesPlanned: resourcePlan.resources,\n      evidence: crawl.evidence,\n    });\n\n    const sourceMemoryDrafts = this.memoryAgent.buildSourceMemoriesFromEvidencePack({\n      projectId: input.projectId,\n      userId: input.userId,\n      evidencePack,\n    });\n\n    const writeResult = await this.memoryAgent.writeRunMemories(\n      context,\n      sourceMemoryDrafts\n    );\n\n    return {\n      status:\n        documents.length > 0\n          ? crawl.failed.length > 0\n            ? "partial"\n            : "ok"\n          : "error",\n      query: input.query,\n      normalizedQuery: resourcePlan.normalizedQuery,\n      plan: planResult.output,\n      resourcesPlanned: resourcePlan.resources.map((resource) => ({\n        title: resource.title,\n        url: resource.url,\n        tier: resource.tier,\n        score: resource.score,\n        source: resource.source,\n        reason: resource.reason,\n      })),\n      memories: {\n        retrieved: retrievedMemoryCount,\n        written: writeResult.output?.written ?? 0,\n      },\n      documents,\n      failedCrawls: crawl.failed,\n      evidencePack,\n    };\n  }\n}\n')

    write("apps/model-service/modules/scrape/scrape_schema.py", 'from pydantic import BaseModel\nfrom typing import Literal\n\n\nScrapeMode = Literal["auto", "static", "dynamic", "stealth"]\n\n\nclass ScrapePageRequest(BaseModel):\n    url: str\n    mode: ScrapeMode = "auto"\n    ai_targeted: bool = True\n\n\nclass CrawlRequest(BaseModel):\n    root_url: str\n    max_pages: int = 5\n    max_depth: int = 1\n    mode: ScrapeMode = "auto"\n    ai_targeted: bool = True\n    same_domain_only: bool = True\n')
    write("apps/model-service/modules/scrape/scrape_router.py", 'from fastapi import APIRouter\n\nfrom modules.scrape.scrape_schema import CrawlRequest, ScrapePageRequest\nfrom modules.scrape.scrape_service import crawl_site, scrape_page\n\nrouter = APIRouter()\n\n\n@router.post("/scrape/page")\ndef scrape_page_endpoint(req: ScrapePageRequest):\n    return scrape_page(req.url, mode=req.mode, ai_targeted=req.ai_targeted)\n\n\n@router.post("/scrape/crawl")\ndef crawl_endpoint(req: CrawlRequest):\n    return crawl_site(req)\n')
    write("apps/model-service/modules/scrape/scrape_service.py", 'from bs4 import BeautifulSoup\nfrom markdownify import markdownify as html_to_markdown\nfrom urllib.parse import urljoin, urlparse, urldefrag\n\nfrom modules.scrape.scrape_schema import CrawlRequest\n\ntry:\n    from scrapling.fetchers import DynamicFetcher, Fetcher, StealthyFetcher\nexcept Exception:\n    from scrapling import Fetcher\n    DynamicFetcher = None\n    StealthyFetcher = None\n\n\nNOISE_SELECTORS = [\n    "script",\n    "style",\n    "noscript",\n    "svg",\n    "iframe",\n    "template",\n    "nav",\n    "footer",\n    "header",\n    "[aria-hidden=\'true\']",\n]\n\n\ndef _normalize_url(url: str) -> str:\n    clean, _fragment = urldefrag(url)\n    return clean.rstrip("/")\n\n\ndef _same_domain(left: str, right: str) -> bool:\n    return urlparse(left).netloc == urlparse(right).netloc\n\n\ndef _extract_html(page) -> str:\n    return getattr(page, "html_content", None) or getattr(page, "content", "") or str(page)\n\n\ndef clean_html_to_markdown(html: str, ai_targeted: bool = True) -> str:\n    soup = BeautifulSoup(html, "html.parser")\n\n    selectors = NOISE_SELECTORS if ai_targeted else ["script", "style", "noscript", "svg", "iframe"]\n    for selector in selectors:\n        for tag in soup.select(selector):\n            tag.decompose()\n\n    main = (\n        soup.find("main")\n        or soup.find("article")\n        or soup.find("div", {"role": "main"})\n        or soup.body\n        or soup\n    )\n\n    markdown = html_to_markdown(str(main), heading_style="ATX")\n    lines = [line.rstrip() for line in markdown.splitlines()]\n    markdown = "\\n".join(lines)\n\n    while "\\n\\n\\n\\n" in markdown:\n        markdown = markdown.replace("\\n\\n\\n\\n", "\\n\\n\\n")\n\n    return markdown.strip()\n\n\ndef _fetch_static(url: str):\n    return Fetcher.get(url)\n\n\ndef _fetch_dynamic(url: str):\n    if DynamicFetcher is None:\n        return _fetch_static(url)\n    return DynamicFetcher.fetch(\n        url,\n        headless=True,\n        network_idle=True,\n        timeout=30000,\n    )\n\n\ndef _fetch_stealth(url: str):\n    if StealthyFetcher is None:\n        return _fetch_dynamic(url)\n    return StealthyFetcher.fetch(\n        url,\n        headless=True,\n        network_idle=True,\n        timeout=30000,\n    )\n\n\ndef fetch_page(url: str, mode: str = "auto"):\n    if mode == "static":\n        return _fetch_static(url), "static"\n\n    if mode == "dynamic":\n        return _fetch_dynamic(url), "dynamic"\n\n    if mode == "stealth":\n        return _fetch_stealth(url), "stealth"\n\n    # Auto mode: start cheap, then progressively try heavier fetchers.\n    try:\n        page = _fetch_static(url)\n        html = _extract_html(page)\n        if len(html) > 500:\n            return page, "static"\n    except Exception:\n        pass\n\n    try:\n        page = _fetch_dynamic(url)\n        html = _extract_html(page)\n        if len(html) > 500:\n            return page, "dynamic"\n    except Exception:\n        pass\n\n    return _fetch_stealth(url), "stealth"\n\n\ndef _extract_title(html: str, fallback_url: str) -> str:\n    try:\n        soup = BeautifulSoup(html, "html.parser")\n        if soup.title and soup.title.string:\n            return soup.title.string.strip()\n    except Exception:\n        pass\n    return fallback_url\n\n\ndef extract_links(html: str, base_url: str, same_domain_only: bool = True) -> list[str]:\n    soup = BeautifulSoup(html, "html.parser")\n    links: list[str] = []\n\n    for anchor in soup.find_all("a", href=True):\n        href = anchor.get("href")\n        if not href:\n            continue\n\n        absolute = _normalize_url(urljoin(base_url, href))\n        parsed = urlparse(absolute)\n\n        if parsed.scheme not in {"http", "https"}:\n            continue\n\n        if same_domain_only and not _same_domain(base_url, absolute):\n            continue\n\n        lowered = absolute.lower()\n        if any(\n            blocked in lowered\n            for blocked in [\n                "/login",\n                "/signin",\n                "/signup",\n                "/cart",\n                "/checkout",\n                "utm_",\n                "mailto:",\n            ]\n        ):\n            continue\n\n        links.append(absolute)\n\n    return list(dict.fromkeys(links))\n\n\ndef scrape_page(url: str, mode: str = "auto", ai_targeted: bool = True) -> dict:\n    page, fetch_mode = fetch_page(url, mode=mode)\n    html = _extract_html(page)\n    markdown = clean_html_to_markdown(html, ai_targeted=ai_targeted)\n\n    title = _extract_title(html, url)\n\n    if not markdown.strip():\n        raise ValueError("Scrapling returned empty markdown")\n\n    return {\n        "status": "ok",\n        "url": url,\n        "title": title,\n        "markdown": markdown,\n        "metadata": {\n            "provider": "scrapling",\n            "fetch_mode": fetch_mode,\n            "ai_targeted": ai_targeted,\n        },\n    }\n\n\ndef crawl_site(req: CrawlRequest) -> dict:\n    root_url = _normalize_url(req.root_url)\n    queue: list[tuple[str, int, str | None]] = [(root_url, 0, None)]\n    seen: set[str] = set()\n    pages: list[dict] = []\n    failed_urls: list[dict] = []\n\n    max_pages = max(1, min(req.max_pages, 25))\n    max_depth = max(0, min(req.max_depth, 3))\n\n    while queue and len(pages) < max_pages:\n        url, depth, parent_url = queue.pop(0)\n        url = _normalize_url(url)\n\n        if url in seen:\n            continue\n\n        seen.add(url)\n\n        try:\n            page, fetch_mode = fetch_page(url, mode=req.mode)\n            html = _extract_html(page)\n            markdown = clean_html_to_markdown(html, ai_targeted=req.ai_targeted)\n\n            if not markdown.strip():\n                raise ValueError("Scrapling returned empty markdown")\n\n            pages.append(\n                {\n                    "status": "ok",\n                    "url": url,\n                    "title": _extract_title(html, url),\n                    "markdown": markdown,\n                    "depth": depth,\n                    "parentUrl": parent_url,\n                    "metadata": {\n                        "provider": "scrapling",\n                        "fetch_mode": fetch_mode,\n                        "ai_targeted": req.ai_targeted,\n                    },\n                }\n            )\n\n            if depth < max_depth:\n                for link in extract_links(\n                    html,\n                    url,\n                    same_domain_only=req.same_domain_only,\n                ):\n                    if link not in seen:\n                        queue.append((link, depth + 1, url))\n        except Exception as exc:\n            failed_urls.append({"url": url, "reason": str(exc)})\n\n    return {\n        "status": "ok" if pages else "error",\n        "rootUrl": root_url,\n        "pages": pages,\n        "failedUrls": failed_urls,\n        "metadata": {\n            "provider": "scrapling",\n            "mode": req.mode,\n            "max_pages": max_pages,\n            "max_depth": max_depth,\n            "same_domain_only": req.same_domain_only,\n        },\n    }\n')

    write("apps/api/src/modules/tools/tools.schema.ts", 'import { z } from "zod";\n\nexport const crawlUrlSchema = z.object({\n  projectId: z.string().uuid(),\n  url: z.string().url(),\n  maxPages: z.number().int().min(1).max(20).optional(),\n  maxDepth: z.number().int().min(0).max(3).optional(),\n});\n\nexport const webResearchSchema = z.object({\n  projectId: z.string().uuid(),\n  query: z.string().min(1),\n  maxResults: z.number().int().min(1).max(10).optional(),\n  maxPagesPerSource: z.number().int().min(1).max(10).optional(),\n  maxTotalPages: z.number().int().min(1).max(50).optional(),\n  maxDepth: z.number().int().min(0).max(3).optional(),\n  useOrchestrator: z.boolean().optional(),\n});\n\nexport const planResourcesSchema = z.object({\n  query: z.string().min(1),\n  maxResults: z.number().int().min(1).max(10).optional(),\n});\n\nexport const searchKbSchema = z.object({\n  projectId: z.string().uuid().optional(),\n  query: z.string().min(1),\n  topK: z.number().int().min(1).max(20).optional(),\n});\n\nexport const queryGraphSchema = z.object({\n  projectId: z.string().uuid().optional(),\n  query: z.string().min(1),\n  depth: z.number().int().min(1).max(3).optional(),\n});\n\nexport const ingestFileSchema = z.object({\n  projectId: z.string().uuid(),\n});\n\nexport type CrawlUrlInput = z.infer<typeof crawlUrlSchema>;\nexport type WebResearchInput = z.infer<typeof webResearchSchema>;\nexport type PlanResourcesInput = z.infer<typeof planResourcesSchema>;\nexport type SearchKbInput = z.infer<typeof searchKbSchema>;\nexport type QueryGraphInput = z.infer<typeof queryGraphSchema>;\nexport type IngestFileInput = z.infer<typeof ingestFileSchema>;\n')

    update_package_exports()
    update_index_exports()
    update_prisma_schema()
    update_tools_service()

    print("\nDone. Next:")
    print("  npm run prisma:generate")
    print("  prisma migrate dev --schema=prisma/schema.prisma --name add_memory_model")
    print("  docker compose build model-service api worker")
    print("  docker compose up")


if __name__ == "__main__":
    main()
