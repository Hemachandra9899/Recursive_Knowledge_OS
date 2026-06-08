#!/usr/bin/env python3
# Apply Scout Research Engine v2 Step 4: Memory v2.
#
# Run from Scout repo root on branch:
#   feat/research-engine-v2
#
# This patch implements:
# - source_failure memories
# - durable_fact memories from supported evidence
# - source_quality memory dedupe per URL
# - ResearchOrchestrator writes all three memory classes
# - TODO / LESSONS updates
#
# No DB migration required because prisma.model Memory.kind is a String.

from __future__ import annotations

from pathlib import Path


ROOT = Path.cwd()


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content.strip() + "\n", encoding="utf-8")
    print(f"wrote {path}")


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def assert_repo_root() -> None:
    required = [
        "package.json",
        "prisma/schema.prisma",
        "packages/knowledge/src/memory/memory-types.ts",
        "packages/knowledge/src/memory/memory-manager.ts",
        "packages/knowledge/src/agents/memory-agent.ts",
        "packages/knowledge/src/research/research-orchestrator.ts",
    ]
    missing = [p for p in required if not (ROOT / p).exists()]
    if missing:
        raise SystemExit(
            "Run this script from the Scout repo root. Missing:\n"
            + "\n".join(f"- {p}" for p in missing)
        )


MEMORY_TYPES_TS = r'''
export type ScoutMemoryScope =
  | "user"
  | "project"
  | "session"
  | "agent"
  | "source";

export type ScoutMemoryKind =
  | "preference"
  | "fact"
  | "durable_fact"
  | "source_quality"
  | "source_failure"
  | "decision"
  | "task_trace";

export type ScoutMemory = {
  id: string;
  projectId: string;
  userId?: string | null;
  scope: ScoutMemoryScope;
  kind: ScoutMemoryKind;
  text: string;
  entities: string[];
  sourceUrls: string[];
  confidence: number;
  eventTime?: Date | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
};

export type ScoutMemoryDraft = {
  projectId: string;
  userId?: string;
  scope: ScoutMemoryScope;
  kind: ScoutMemoryKind;
  text: string;
  entities?: string[];
  sourceUrls?: string[];
  confidence?: number;
  eventTime?: Date;
  metadata?: Record<string, unknown>;
};

export type ScoutMemorySearchInput = {
  projectId: string;
  userId?: string;
  query: string;
  limit?: number;
  scopes?: ScoutMemoryScope[];
  kinds?: ScoutMemoryKind[];
};
'''


MEMORY_MANAGER_TS = r'''
import { Prisma } from "@prisma/client";
import { prisma } from "@rlm-forge/database/prisma.js";
import type {
  ScoutMemory,
  ScoutMemoryDraft,
  ScoutMemorySearchInput,
} from "./memory-types.js";
import type { EvidenceItem, EvidencePack } from "../research/source-types.js";

type CrawlFailureForMemory = {
  title?: string;
  url?: string;
  reason: string;
};

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(String).filter(Boolean);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function unique(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function normalizeForKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function memoryDraftKey(draft: ScoutMemoryDraft): string {
  return [
    draft.projectId,
    draft.userId ?? "",
    draft.scope,
    draft.kind,
    normalizeForKey(draft.text),
    unique(draft.sourceUrls ?? []).sort().join("|"),
  ].join("::");
}

function dedupeDrafts(drafts: ScoutMemoryDraft[]): ScoutMemoryDraft[] {
  const seen = new Set<string>();
  const deduped: ScoutMemoryDraft[] = [];

  for (const draft of drafts) {
    const key = memoryDraftKey(draft);
    if (seen.has(key)) continue;

    seen.add(key);
    deduped.push({
      ...draft,
      entities: unique(draft.entities ?? []),
      sourceUrls: unique(draft.sourceUrls ?? []),
    });
  }

  return deduped;
}

function toScoutMemory(row: any): ScoutMemory {
  return {
    id: row.id,
    projectId: row.projectId,
    userId: row.userId,
    scope: row.scope,
    kind: row.kind,
    text: row.text,
    entities: asStringArray(row.entities),
    sourceUrls: asStringArray(row.sourceUrls),
    confidence: row.confidence ?? 0.7,
    eventTime: row.eventTime,
    metadata: asRecord(row.metadata),
    createdAt: row.createdAt,
  };
}

function scoreMemory(query: string, memory: ScoutMemory): number {
  const q = query.toLowerCase();
  const text = memory.text.toLowerCase();

  const entityScore = memory.entities.some((entity) =>
    q.includes(entity.toLowerCase())
  )
    ? 25
    : 0;

  const keywordScore = q
    .split(/\s+/)
    .filter((token) => token.length > 3 && text.includes(token)).length;

  const recencyScore = Math.max(
    0,
    10 -
      Math.floor(
        (Date.now() - memory.createdAt.getTime()) / (1000 * 60 * 60 * 24 * 30)
      )
  );

  const kindBoost =
    memory.kind === "durable_fact"
      ? 12
      : memory.kind === "source_quality"
        ? 8
        : memory.kind === "source_failure"
          ? 6
          : 0;

  return memory.confidence * 50 + entityScore + keywordScore * 3 + recencyScore + kindBoost;
}

function tierConfidence(item: EvidenceItem): number {
  if (item.tier === "official_docs" || item.tier === "trusted_docs") return 0.9;
  if (item.tier === "reference_examples") return 0.72;
  if (item.tier === "community") return 0.6;
  return 0.65;
}

export class MemoryManager {
  async addMany(drafts: ScoutMemoryDraft[]): Promise<number> {
    const deduped = dedupeDrafts(drafts);
    if (deduped.length === 0) return 0;

    await prisma.memory.createMany({
      data: deduped.map((draft) => ({
        projectId: draft.projectId,
        userId: draft.userId,
        scope: draft.scope,
        kind: draft.kind,
        text: draft.text,
        entities: (draft.entities ?? []) as unknown as Prisma.InputJsonValue,
        sourceUrls: (draft.sourceUrls ?? []) as unknown as Prisma.InputJsonValue,
        confidence: draft.confidence ?? 0.7,
        eventTime: draft.eventTime,
        metadata: (draft.metadata ?? {}) as unknown as Prisma.InputJsonValue,
      })),
    });

    return deduped.length;
  }

  async search(input: ScoutMemorySearchInput): Promise<ScoutMemory[]> {
    const limit = input.limit ?? 8;
    const rows = await prisma.memory.findMany({
      where: {
        projectId: input.projectId,
        ...(input.userId
          ? {
              OR: [{ userId: input.userId }, { userId: null }],
            }
          : {}),
        ...(input.scopes?.length ? { scope: { in: input.scopes } } : {}),
        ...(input.kinds?.length ? { kind: { in: input.kinds } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: Math.max(limit * 5, 25),
    });

    return rows
      .map(toScoutMemory)
      .sort((a, b) => scoreMemory(input.query, b) - scoreMemory(input.query, a))
      .slice(0, limit);
  }

  buildSourceMemoriesFromEvidencePack(input: {
    projectId: string;
    userId?: string;
    evidencePack: EvidencePack;
  }): ScoutMemoryDraft[] {
    const byUrl = new Map<
      string,
      {
        item: EvidenceItem;
        claimCount: number;
        supportedClaimCount: number;
      }
    >();

    input.evidencePack.evidence.forEach((item, index) => {
      if (!item.url) return;

      const existing = byUrl.get(item.url);
      const verification = input.evidencePack.citationVerification[index];
      const supported = verification?.status === "supported";

      if (!existing) {
        byUrl.set(item.url, {
          item,
          claimCount: 1,
          supportedClaimCount: supported ? 1 : 0,
        });
      } else {
        existing.claimCount += 1;
        if (supported) existing.supportedClaimCount += 1;

        if (tierConfidence(item) > tierConfidence(existing.item)) {
          existing.item = item;
        }
      }
    });

    const drafts: ScoutMemoryDraft[] = [];

    for (const [url, aggregate] of byUrl) {
      const item = aggregate.item;

      drafts.push({
        projectId: input.projectId,
        userId: input.userId,
        scope: "source",
        kind: "source_quality",
        text: `Source "${item.title}" was useful for query "${input.evidencePack.query}" with ${aggregate.claimCount} extracted claims and ${aggregate.supportedClaimCount} supported claims.`,
        sourceUrls: [url],
        entities: [item.product, item.domain, ...item.entities].filter(Boolean) as string[],
        confidence: Math.min(
          0.95,
          tierConfidence(item) + Math.min(aggregate.supportedClaimCount, 5) * 0.01
        ),
        metadata: {
          title: item.title,
          tier: item.tier,
          reason: item.reason,
          query: input.evidencePack.query,
          claimCount: aggregate.claimCount,
          supportedClaimCount: aggregate.supportedClaimCount,
        },
      });
    }

    return drafts;
  }

  buildFailureMemoriesFromCrawlFailures(input: {
    projectId: string;
    userId?: string;
    query: string;
    failedCrawls: CrawlFailureForMemory[];
  }): ScoutMemoryDraft[] {
    return input.failedCrawls
      .filter((failure) => Boolean(failure.url))
      .map((failure) => ({
        projectId: input.projectId,
        userId: input.userId,
        scope: "source",
        kind: "source_failure",
        text: `Source "${failure.url}" failed during crawl for query "${input.query}" because: ${failure.reason}`,
        sourceUrls: [failure.url as string],
        confidence: 0.8,
        metadata: {
          title: failure.title,
          query: input.query,
          reason: failure.reason,
        },
      }));
  }

  buildDurableFactMemoriesFromEvidencePack(input: {
    projectId: string;
    userId?: string;
    evidencePack: EvidencePack;
  }): ScoutMemoryDraft[] {
    const drafts: ScoutMemoryDraft[] = [];

    input.evidencePack.evidence.forEach((item, index) => {
      const verification = input.evidencePack.citationVerification[index];
      if (verification?.status !== "supported") return;

      const sourceUrls =
        verification.supportingUrls.length > 0
          ? verification.supportingUrls
          : [item.url];

      drafts.push({
        projectId: input.projectId,
        userId: input.userId,
        scope: "project",
        kind: "durable_fact",
        text: item.claim,
        sourceUrls,
        entities: item.entities,
        confidence: item.confidence,
        metadata: {
          title: item.title,
          section: item.section,
          tier: item.tier,
          quote: item.quote,
          query: input.evidencePack.query,
          reason: verification.reason,
        },
      });
    });

    return dedupeDrafts(drafts);
  }
}
'''


MEMORY_AGENT_TS = r'''
import type { AgentContext, AgentResult } from "./types.js";
import { okAgentResult } from "./types.js";
import { MemoryManager } from "../memory/memory-manager.js";
import type { ScoutMemory, ScoutMemoryDraft } from "../memory/memory-types.js";
import type { EvidencePack } from "../research/source-types.js";

type CrawlFailureForMemory = {
  title?: string;
  url?: string;
  reason: string;
};

export type MemoryAgentOutput = {
  retrieved: ScoutMemory[];
  written: number;
};

export class MemoryAgent {
  constructor(private readonly memoryManager = new MemoryManager()) {}

  async retrieveForRun(context: AgentContext): Promise<AgentResult<MemoryAgentOutput>> {
    const retrieved = await this.memoryManager.search({
      projectId: context.projectId,
      userId: context.userId,
      query: context.query,
      limit: 8,
    });

    return okAgentResult("memory", {
      retrieved,
      written: 0,
    });
  }

  buildSourceMemoriesFromEvidencePack(input: {
    projectId: string;
    userId?: string;
    evidencePack: EvidencePack;
  }): ScoutMemoryDraft[] {
    return this.memoryManager.buildSourceMemoriesFromEvidencePack(input);
  }

  buildFailureMemoriesFromCrawlFailures(input: {
    projectId: string;
    userId?: string;
    query: string;
    failedCrawls: CrawlFailureForMemory[];
  }): ScoutMemoryDraft[] {
    return this.memoryManager.buildFailureMemoriesFromCrawlFailures(input);
  }

  buildDurableFactMemoriesFromEvidencePack(input: {
    projectId: string;
    userId?: string;
    evidencePack: EvidencePack;
  }): ScoutMemoryDraft[] {
    return this.memoryManager.buildDurableFactMemoriesFromEvidencePack(input);
  }

  async writeRunMemories(
    context: AgentContext,
    drafts: ScoutMemoryDraft[]
  ): Promise<AgentResult<MemoryAgentOutput>> {
    if (drafts.length === 0) {
      return okAgentResult("memory", {
        retrieved: [],
        written: 0,
      });
    }

    const written = await this.memoryManager.addMany(
      drafts.map((draft) => ({
        ...draft,
        projectId: context.projectId,
        userId: draft.userId ?? context.userId,
      }))
    );

    return okAgentResult("memory", {
      retrieved: [],
      written,
    });
  }
}
'''


RESEARCH_ORCHESTRATOR_TS = r'''
import { ingestMarkdownDocument } from "../ingestion/ingest-markdown-document.js";
import { SearchPlannerAgent } from "../agents/search-planner.agent.js";
import { MemoryAgent } from "../agents/memory-agent.js";
import { planResources } from "./resource-planner.js";
import { crawlResearchSources } from "./crawl-manager.js";
import { buildEvidencePack } from "./evidence-pack.js";
import type { EvidencePack, RankedResource } from "./source-types.js";

export type ResearchOrchestratorInput = {
  projectId: string;
  userId?: string;
  query: string;
  maxSources?: number;
  maxPagesPerSource?: number;
  maxTotalPages?: number;
  maxDepth?: number;
};

export type ResearchOrchestratorOutput = {
  status: "ok" | "partial" | "error";
  query: string;
  normalizedQuery: string;
  subqueries: Array<{ query: string; reason: string; priority: number }>;
  plan: unknown;
  resourcesPlanned: Array<{
    title: string;
    url: string;
    tier: string;
    score: number;
    source: string;
    reason: string;
    matchedBy: string[];
  }>;
  memories: {
    retrieved: number;
    written: number;
    planned: {
      sourceQuality: number;
      sourceFailure: number;
      durableFact: number;
    };
  };
  documents: Array<{
    documentId: string;
    title: string;
    url: string;
    chunksTotal: number;
    embeddedChunks: number;
    deduped: boolean;
  }>;
  failedCrawls: Array<{
    title?: string;
    url?: string;
    reason: string;
  }>;
  evidencePack: EvidencePack;
};

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.origin + u.pathname.replace(/\/$/, "") + u.search;
  } catch {
    return url;
  }
}

function mergeResources(allResources: RankedResource[][]): RankedResource[] {
  const seen = new Map<string, RankedResource>();

  for (const batch of allResources) {
    for (const resource of batch) {
      const key = normalizeUrl(resource.url);
      const existing = seen.get(key);

      if (!existing) {
        seen.set(key, { ...resource, matchedBy: [...(resource.matchedBy ?? [])] });
        continue;
      }

      const newMatched = (resource.matchedBy ?? []).filter(
        (m) => !(existing.matchedBy ?? []).includes(m)
      );
      existing.matchedBy = [...(existing.matchedBy ?? []), ...newMatched];

      if (resource.score > existing.score) {
        existing.score = resource.score;
        existing.reason = resource.reason;
        existing.tier = resource.tier;
      }
    }
  }

  return [...seen.values()].sort((a, b) => b.score - a.score);
}

export class ResearchOrchestrator {
  constructor(
    private readonly searchPlanner = new SearchPlannerAgent(),
    private readonly memoryAgent = new MemoryAgent()
  ) {}

  async run(input: ResearchOrchestratorInput): Promise<ResearchOrchestratorOutput> {
    const context = {
      projectId: input.projectId,
      userId: input.userId,
      query: input.query,
    };

    const planResult = this.searchPlanner.plan(context);
    if (planResult.status !== "ok" || !planResult.output) {
      throw new Error(planResult.error ?? "Search planning failed");
    }

    const memoryResult = await this.memoryAgent.retrieveForRun(context);
    const retrievedMemoryCount = memoryResult.output?.retrieved.length ?? 0;

    const maxSources =
      input.maxSources ?? planResult.output.recommendedMaxSources ?? 8;

    const plan = planResult.output;
    const subqueries = plan.subqueries;

    const allResourceBatches: RankedResource[][] = [];

    for (const subquery of subqueries) {
      const resourcePlan = await planResources({
        query: subquery.query,
        maxSources: Math.max(5, Math.ceil(maxSources / subqueries.length)),
      });

      for (const resource of resourcePlan.resources) {
        if (!resource.matchedBy) {
          resource.matchedBy = [];
        }

        resource.matchedBy.push(`subquery:${subquery.query}`);
      }

      allResourceBatches.push(resourcePlan.resources);
    }

    const mergedResources = mergeResources(allResourceBatches).slice(
      0,
      maxSources
    );

    const crawl = await crawlResearchSources({
      projectId: input.projectId,
      query: plan.normalizedQuery,
      resources: mergedResources,
      maxPagesPerSource:
        input.maxPagesPerSource ??
        plan.recommendedMaxPagesPerSource ??
        3,
      maxTotalPages: input.maxTotalPages ?? 20,
      maxDepth: input.maxDepth ?? 1,
    });

    const documents = [];

    for (const page of crawl.pages) {
      const ingested = await ingestMarkdownDocument({
        projectId: input.projectId,
        sourceUrl: page.url,
        title: page.title,
        markdown: page.markdown,
        metadata: {
          ...page.metadata,
          provider: "scrapling",
          researchQuery: input.query,
          normalizedQuery: plan.normalizedQuery,
          sourceTitle: page.source.title,
          sourceTier: page.source.tier,
          sourceScore: page.source.score,
        },
      });

      documents.push({
        documentId: ingested.document.id,
        title: page.title,
        url: page.url,
        chunksTotal: ingested.chunksTotal,
        embeddedChunks: ingested.embeddedChunks,
        deduped: ingested.deduped,
      });
    }

    const evidencePack = buildEvidencePack({
      query: input.query,
      resourcesPlanned: mergedResources,
      evidence: crawl.evidence,
    });

    const sourceMemoryDrafts = this.memoryAgent.buildSourceMemoriesFromEvidencePack({
      projectId: input.projectId,
      userId: input.userId,
      evidencePack,
    });

    const failureMemoryDrafts = this.memoryAgent.buildFailureMemoriesFromCrawlFailures({
      projectId: input.projectId,
      userId: input.userId,
      query: input.query,
      failedCrawls: crawl.failed,
    });

    const durableFactMemoryDrafts =
      this.memoryAgent.buildDurableFactMemoriesFromEvidencePack({
        projectId: input.projectId,
        userId: input.userId,
        evidencePack,
      });

    const allMemoryDrafts = [
      ...sourceMemoryDrafts,
      ...failureMemoryDrafts,
      ...durableFactMemoryDrafts,
    ];

    const writeResult = await this.memoryAgent.writeRunMemories(
      context,
      allMemoryDrafts
    );

    return {
      status:
        documents.length > 0
          ? crawl.failed.length > 0
            ? "partial"
            : "ok"
          : "error",
      query: input.query,
      normalizedQuery: plan.normalizedQuery,
      subqueries: subqueries.map((sq) => ({
        query: sq.query,
        reason: sq.reason,
        priority: sq.priority,
      })),
      plan,
      resourcesPlanned: mergedResources.map((resource) => ({
        title: resource.title,
        url: resource.url,
        tier: resource.tier,
        score: resource.score,
        source: resource.source,
        reason: resource.reason,
        matchedBy: resource.matchedBy,
      })),
      memories: {
        retrieved: retrievedMemoryCount,
        written: writeResult.output?.written ?? 0,
        planned: {
          sourceQuality: sourceMemoryDrafts.length,
          sourceFailure: failureMemoryDrafts.length,
          durableFact: durableFactMemoryDrafts.length,
        },
      },
      documents,
      failedCrawls: crawl.failed,
      evidencePack,
    };
  }
}
'''


TODO_APPEND = '''
## Done in v2 Slice 3

- [x] Added source failure memories.
- [x] Added durable fact memories from supported claim-level evidence.
- [x] Deduped source-quality memories per URL.
- [x] Added memory write breakdown in `ResearchOrchestrator`.

## Now

### Memory-aware retrieval and ranking

- [ ] Use source failure memories to down-rank URLs/domains that repeatedly fail crawling.
- [ ] Use source quality memories to boost historically useful sources.
- [ ] Use durable fact memories as pre-retrieved context for answer synthesis.
- [ ] Add memory tests for source failure and durable fact memory builders.
'''


LESSONS_APPEND = '''
## Research Engine v2 Slice 3

- Memory should not only store user preferences. For a research engine, source quality, source failures, and durable supported facts are first-class memory.
- Keep memory add-only. Do not update or delete previous memories yet.
- Durable fact memories should only come from citation-supported evidence, not weak or unsupported evidence.
- Source failure memory is useful only if the next source-ranker consumes it. That is the next step.
'''


def update_todo() -> None:
    path = ROOT / "docs/TODO.md"
    if not path.exists():
        write("docs/TODO.md", "# Scout TODO\n\n" + TODO_APPEND)
        return

    text = path.read_text(encoding="utf-8").rstrip()
    if "Done in v2 Slice 3" not in text:
        text += "\n\n" + TODO_APPEND.strip() + "\n"
    path.write_text(text, encoding="utf-8")
    print("updated docs/TODO.md")


def update_lessons() -> None:
    path = ROOT / "docs/LESSONS.md"
    if not path.exists():
        write("docs/LESSONS.md", "# Scout Lessons\n\n" + LESSONS_APPEND)
        return

    text = path.read_text(encoding="utf-8").rstrip()
    if "Research Engine v2 Slice 3" not in text:
        text += "\n\n" + LESSONS_APPEND.strip() + "\n"
    path.write_text(text, encoding="utf-8")
    print("updated docs/LESSONS.md")


def main() -> None:
    assert_repo_root()

    write("packages/knowledge/src/memory/memory-types.ts", MEMORY_TYPES_TS)
    write("packages/knowledge/src/memory/memory-manager.ts", MEMORY_MANAGER_TS)
    write("packages/knowledge/src/agents/memory-agent.ts", MEMORY_AGENT_TS)
    write("packages/knowledge/src/research/research-orchestrator.ts", RESEARCH_ORCHESTRATOR_TS)

    update_todo()
    update_lessons()

    print("\nDone.")
    print("\nNext commands:")
    print("  npm run prisma:generate")
    print("  docker compose build api worker model-service")
    print("  docker compose up")
    print("\nSuggested smoke test:")
    print("  curl -X POST http://localhost:8000/tools/web-research -H 'Content-Type: application/json' -d '{\"projectId\":\"<PROJECT_ID>\",\"query\":\"Compare Meta Marketing API and Google Ads API permissions and rate limits\",\"maxResults\":5,\"maxPagesPerSource\":3,\"maxTotalPages\":12,\"maxDepth\":1,\"useOrchestrator\":true}'")


if __name__ == "__main__":
    main()
