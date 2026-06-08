#!/usr/bin/env python3
# Apply Scout Research Engine v2 Step 5: Memory-aware source ranking.
#
# Run from Scout repo root on branch:
#   feat/research-engine-v2
#
# This patch makes retrieved memories useful during source planning:
# - source_quality memories boost known useful URLs/domains
# - source_failure memories penalize failed URLs/domains
# - durable_fact memories lightly boost sources whose product/domain/entity matches query context
# - ResearchOrchestrator passes retrieved memories into planResources()
# - TODO / LESSONS updated
#
# No DB migration required.

from __future__ import annotations

import json
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
        "packages/knowledge/src/research/source-ranker.ts",
        "packages/knowledge/src/research/resource-planner.ts",
        "packages/knowledge/src/research/research-orchestrator.ts",
        "packages/knowledge/src/memory/memory-types.ts",
    ]
    missing = [p for p in required if not (ROOT / p).exists()]
    if missing:
        raise SystemExit(
            "Run this script from the Scout repo root. Missing:\n"
            + "\n".join(f"- {p}" for p in missing)
        )


MEMORY_RANKING_TS = r'''
import type { ResourceCandidate } from "./source-types.js";
import type { ScoutMemory } from "../memory/memory-types.js";

export type ResourceMemoryHint = Pick<
  ScoutMemory,
  "kind" | "text" | "entities" | "sourceUrls" | "confidence" | "metadata"
>;

export type ResourceMemoryScore = {
  scoreDelta: number;
  matchedBy: string[];
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeUrl(url?: string | null): string {
  if (!url) return "";

  try {
    const parsed = new URL(url);
    parsed.hash = "";

    const pathname = parsed.pathname.replace(/\/$/, "");
    return `${parsed.origin}${pathname}${parsed.search}`.toLowerCase();
  } catch {
    return String(url).toLowerCase().replace(/\/$/, "");
  }
}

function hostname(url?: string | null): string {
  if (!url) return "";

  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function hostMatches(left: string, right: string): boolean {
  if (!left || !right) return false;
  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`);
}

function queryOrResourceMentionsEntity(input: {
  query: string;
  resource: ResourceCandidate;
  entity: string;
}): boolean {
  const entity = input.entity.toLowerCase();
  if (!entity || entity.length < 2) return false;

  const haystack = [
    input.query,
    input.resource.title,
    input.resource.product,
    input.resource.domain,
    ...(input.resource.topics ?? []),
    ...(input.resource.keywords ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(entity);
}

function memoryUrlMatchesResource(memoryUrl: string, resourceUrl: string): boolean {
  const left = normalizeUrl(memoryUrl);
  const right = normalizeUrl(resourceUrl);

  if (!left || !right) return false;
  if (left === right) return true;

  const leftHost = hostname(memoryUrl);
  const rightHost = hostname(resourceUrl);

  return Boolean(leftHost && rightHost && hostMatches(leftHost, rightHost));
}

export function scoreResourceWithMemory(input: {
  query: string;
  resource: ResourceCandidate;
  memoryHints?: ResourceMemoryHint[];
}): ResourceMemoryScore {
  const hints = input.memoryHints ?? [];
  if (hints.length === 0) {
    return { scoreDelta: 0, matchedBy: [] };
  }

  let scoreDelta = 0;
  const matchedBy: string[] = [];
  const resourceHost = hostname(input.resource.url);

  for (const memory of hints) {
    const confidence = clamp(memory.confidence ?? 0.7, 0.1, 1);
    const sourceUrls = memory.sourceUrls ?? [];

    const hasExactOrHostMatch = sourceUrls.some((sourceUrl) =>
      memoryUrlMatchesResource(sourceUrl, input.resource.url)
    );

    const hasSameHost = sourceUrls.some((sourceUrl) =>
      hostMatches(hostname(sourceUrl), resourceHost)
    );

    if (memory.kind === "source_quality") {
      if (hasExactOrHostMatch) {
        const delta = Math.round(18 * confidence);
        scoreDelta += delta;
        matchedBy.push(`memory:source_quality:+${delta}`);
      } else if (hasSameHost) {
        const delta = Math.round(8 * confidence);
        scoreDelta += delta;
        matchedBy.push(`memory:source_quality_host:+${delta}`);
      }
    }

    if (memory.kind === "source_failure") {
      if (hasExactOrHostMatch) {
        const delta = Math.round(30 * confidence);
        scoreDelta -= delta;
        matchedBy.push(`memory:source_failure:-${delta}`);
      } else if (hasSameHost) {
        const delta = Math.round(10 * confidence);
        scoreDelta -= delta;
        matchedBy.push(`memory:source_failure_host:-${delta}`);
      }
    }

    if (memory.kind === "durable_fact") {
      const matchedEntity = (memory.entities ?? []).find((entity) =>
        queryOrResourceMentionsEntity({
          query: input.query,
          resource: input.resource,
          entity,
        })
      );

      if (matchedEntity) {
        const delta = Math.round(5 * confidence);
        scoreDelta += delta;
        matchedBy.push(`memory:durable_fact_entity:${matchedEntity}:+${delta}`);
      }
    }
  }

  return {
    scoreDelta,
    matchedBy,
  };
}
'''


SOURCE_RANKER_TS = r'''
import type {
  RankedResource,
  ResourceCandidate,
  SourceTier,
  SourceUseCase,
} from "./source-types.js";
import { inferSourceUseCase } from "./query-builder.js";
import {
  scoreResourceWithMemory,
  type ResourceMemoryHint,
} from "./memory-ranking.js";

const OFFICIAL_DOC_DOMAINS = [
  "developers.facebook.com",
  "developers.google.com",
  "business-api.tiktok.com",
  "ads.tiktok.com",
  "platform.openai.com",
  "docs.anthropic.com",
  "docs.api.nvidia.com",
  "qdrant.tech",
  "supabase.com",
  "postgresql.org",
  "redis.io",
  "nextjs.org",
  "tanstack.com",
  "fastify.dev",
  "prisma.io",
  "github.com",
  "learn.microsoft.com",
];

const TRUSTED_DOC_DOMAINS = [
  "support.google.com",
  "business.facebook.com",
  "docs.github.com",
];

const REFERENCE_DOMAINS = ["postman.com", "gitlab.com"];

const COMMUNITY_DOMAINS = [
  "stackoverflow.com",
  "reddit.com",
  "medium.com",
  "dev.to",
  "hashnode.dev",
  "quora.com",
];

const MEDIA_DOMAINS = ["youtube.com", "youtu.be"];

export function getHostname(url?: string | null): string {
  if (!url) return "";

  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function hostMatches(host: string, domain: string) {
  return host === domain || host.endsWith(`.${domain}`);
}

function matchesAny(host: string, domains: string[]) {
  return domains.some((domain) => hostMatches(host, domain));
}

export function inferTierFromUrl(url?: string | null): SourceTier {
  const host = getHostname(url);

  if (!host) return "unknown";
  if (matchesAny(host, OFFICIAL_DOC_DOMAINS)) return "official_docs";
  if (matchesAny(host, TRUSTED_DOC_DOMAINS)) return "trusted_docs";
  if (matchesAny(host, REFERENCE_DOMAINS)) return "reference_examples";
  if (matchesAny(host, COMMUNITY_DOMAINS)) return "community";
  if (matchesAny(host, MEDIA_DOMAINS)) return "media";

  return "unknown";
}

function tierScore(tier: SourceTier, useCase: SourceUseCase): number {
  const scores: Record<SourceUseCase, Record<SourceTier, number>> = {
    api_facts: {
      official_docs: 100,
      trusted_docs: 75,
      reference_examples: 40,
      community: 20,
      media: 10,
      unknown: 25,
    },
    comparison: {
      official_docs: 100,
      trusted_docs: 75,
      reference_examples: 35,
      community: 15,
      media: 10,
      unknown: 25,
    },
    implementation_help: {
      official_docs: 100,
      trusted_docs: 80,
      reference_examples: 75,
      community: 65,
      media: 35,
      unknown: 35,
    },
    tutorial: {
      official_docs: 100,
      trusted_docs: 80,
      reference_examples: 75,
      community: 60,
      media: 50,
      unknown: 35,
    },
    general_research: {
      official_docs: 100,
      trusted_docs: 75,
      reference_examples: 60,
      community: 45,
      media: 30,
      unknown: 35,
    },
  };

  return scores[useCase][tier];
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9.+#\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function phraseMatch(query: string, phrase: string) {
  return query.toLowerCase().includes(phrase.toLowerCase());
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}${parsed.search}`;
  } catch {
    return url;
  }
}

export function rankResourceCandidates(
  query: string,
  candidates: ResourceCandidate[],
  options?: {
    maxSources?: number;
    minScore?: number;
    memoryHints?: ResourceMemoryHint[];
  }
): RankedResource[] {
  const useCase = inferSourceUseCase(query);
  const queryTokens = new Set(tokenize(query));
  const maxSources = options?.maxSources ?? 10;
  const minScore = options?.minScore ?? 30;
  const memoryHints = options?.memoryHints ?? [];

  const ranked = candidates.map((candidate) => {
    const tier = candidate.tier || inferTierFromUrl(candidate.url);
    const matchedBy: string[] = [];
    let score = tierScore(tier, useCase);

    for (const keyword of candidate.keywords || []) {
      if (phraseMatch(query, keyword)) {
        score += 25;
        matchedBy.push(`keyword:${keyword}`);
      }
    }

    for (const topic of candidate.topics || []) {
      if (phraseMatch(query, topic)) {
        score += 15;
        matchedBy.push(`topic:${topic}`);
      }
    }

    for (const token of tokenize(candidate.product || "")) {
      if (queryTokens.has(token)) {
        score += 8;
        matchedBy.push(`product-token:${token}`);
      }
    }

    if (candidate.domain && phraseMatch(query, candidate.domain)) {
      score += 10;
      matchedBy.push(`domain:${candidate.domain}`);
    }

    if (candidate.source === "registry") {
      score += 10;
      matchedBy.push("registry");
    }

    const memoryScore = scoreResourceWithMemory({
      query,
      resource: candidate,
      memoryHints,
    });

    score += memoryScore.scoreDelta;
    matchedBy.push(...memoryScore.matchedBy);

    return {
      ...candidate,
      tier,
      score,
      matchedBy,
    };
  });

  const deduped: RankedResource[] = [];
  const seen = new Set<string>();

  for (const item of ranked.sort((a, b) => b.score - a.score)) {
    const key = normalizeUrl(item.url);
    if (seen.has(key)) continue;
    if (item.score < minScore) continue;

    seen.add(key);
    deduped.push(item);
  }

  return deduped.slice(0, maxSources);
}
'''


RESOURCE_PLANNER_TS = r'''
import { DOC_REGISTRY } from "../registry/doc-registry.js";
import type { RankedResource, ResourceCandidate } from "./source-types.js";
import { buildFallbackSearchQueries, normalizeResearchQuery } from "./query-builder.js";
import { rankResourceCandidates } from "./source-ranker.js";
import { searchResourceCandidates } from "./search-provider.js";
import type { ResourceMemoryHint } from "./memory-ranking.js";

export async function planResources(input: {
  query: string;
  maxSources?: number;
  memoryHints?: ResourceMemoryHint[];
}): Promise<{
  normalizedQuery: string;
  strategy: "registry_first" | "search_fallback" | "mixed";
  resources: RankedResource[];
}> {
  const normalizedQuery = normalizeResearchQuery(input.query);
  const maxSources = input.maxSources ?? 10;
  const memoryHints = input.memoryHints ?? [];

  const registryResources = rankResourceCandidates(
    normalizedQuery,
    DOC_REGISTRY,
    {
      maxSources,
      minScore: 45,
      memoryHints,
    }
  );

  if (registryResources.length >= Math.min(3, maxSources)) {
    return {
      normalizedQuery,
      strategy: "registry_first",
      resources: registryResources,
    };
  }

  const fallbackQueries = buildFallbackSearchQueries(normalizedQuery);
  const searchCandidates: ResourceCandidate[] = [];

  for (const query of fallbackQueries) {
    const results = await searchResourceCandidates(query, 5);
    searchCandidates.push(...results);
  }

  const combined = [...registryResources, ...searchCandidates];

  return {
    normalizedQuery,
    strategy: registryResources.length > 0 ? "mixed" : "search_fallback",
    resources: rankResourceCandidates(normalizedQuery, combined, {
      maxSources,
      minScore: 25,
      memoryHints,
    }),
  };
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
    usedForRanking: number;
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
    const retrievedMemories = memoryResult.output?.retrieved ?? [];
    const retrievedMemoryCount = retrievedMemories.length;

    const rankingMemories = retrievedMemories.filter((memory) =>
      ["source_quality", "source_failure", "durable_fact"].includes(memory.kind)
    );

    const maxSources =
      input.maxSources ?? planResult.output.recommendedMaxSources ?? 8;

    const plan = planResult.output;
    const subqueries = plan.subqueries;

    const allResourceBatches: RankedResource[][] = [];

    for (const subquery of subqueries) {
      const resourcePlan = await planResources({
        query: subquery.query,
        maxSources: Math.max(5, Math.ceil(maxSources / subqueries.length)),
        memoryHints: rankingMemories,
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
        usedForRanking: rankingMemories.length,
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
## Done in v2 Slice 4

- [x] Added memory-aware source ranking.
- [x] Boosted sources with prior `source_quality` memories.
- [x] Penalized sources with prior `source_failure` memories.
- [x] Lightly boosted sources/entities connected to `durable_fact` memories.
- [x] Exposed `memories.usedForRanking` in `ResearchOrchestrator` output.

## Now

### Validation and tests

- [ ] Add tests for memory-aware ranking.
- [ ] Add tests for `planResources({ memoryHints })`.
- [ ] Add an end-to-end smoke test that runs the same query twice and verifies useful sources are boosted on the second run.
- [ ] Add logging/traces for memory score deltas.

### Next product feature

- [ ] Add answer synthesis using `EvidencePack` directly instead of relying on raw RLM final output.
'''


LESSONS_APPEND = '''
## Research Engine v2 Slice 4

- Memory becomes useful only when it changes future behavior. Writing memory is not enough.
- Source memory should affect resource planning before crawling, not only answer synthesis after crawling.
- Keep source penalties bounded. A failed URL should be penalized, but not permanently banned.
- Durable fact memory should give only a small boost during ranking; evidence from current sources should still dominate.
'''


def update_index() -> None:
    path = "packages/knowledge/src/index.ts"
    text = read(path)
    line = 'export * from "./research/memory-ranking.js";'
    marker = 'export * from "./research/source-ranker.js";'
    if line not in text:
        text = text.replace(marker, marker + "\n" + line)
    write(path, text)


def update_package_exports() -> None:
    path = ROOT / "packages/knowledge/package.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    exports = data.setdefault("exports", {})
    exports["./research/memory-ranking"] = "./src/research/memory-ranking.js"
    exports["./research/memory-ranking.js"] = "./src/research/memory-ranking.js"
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print("updated packages/knowledge/package.json")


def update_todo() -> None:
    path = ROOT / "docs/TODO.md"
    if not path.exists():
        write("docs/TODO.md", "# Scout TODO\n\n" + TODO_APPEND)
        return

    text = path.read_text(encoding="utf-8").rstrip()
    if "Done in v2 Slice 4" not in text:
        text += "\n\n" + TODO_APPEND.strip() + "\n"
    path.write_text(text, encoding="utf-8")
    print("updated docs/TODO.md")


def update_lessons() -> None:
    path = ROOT / "docs/LESSONS.md"
    if not path.exists():
        write("docs/LESSONS.md", "# Scout Lessons\n\n" + LESSONS_APPEND)
        return

    text = path.read_text(encoding="utf-8").rstrip()
    if "Research Engine v2 Slice 4" not in text:
        text += "\n\n" + LESSONS_APPEND.strip() + "\n"
    path.write_text(text, encoding="utf-8")
    print("updated docs/LESSONS.md")


def main() -> None:
    assert_repo_root()

    write("packages/knowledge/src/research/memory-ranking.ts", MEMORY_RANKING_TS)
    write("packages/knowledge/src/research/source-ranker.ts", SOURCE_RANKER_TS)
    write("packages/knowledge/src/research/resource-planner.ts", RESOURCE_PLANNER_TS)
    write("packages/knowledge/src/research/research-orchestrator.ts", RESEARCH_ORCHESTRATOR_TS)

    update_index()
    update_package_exports()
    update_todo()
    update_lessons()

    print("\nDone.")
    print("\nNext commands:")
    print("  npm run prisma:generate")
    print("  docker compose build api worker model-service")
    print("  docker compose up")
    print("\nSmoke test:")
    print("  Run the same /tools/web-research query twice and compare resourcesPlanned[].matchedBy.")
    print("  On the second run, expect memory:source_quality or memory:durable_fact_entity entries.")


if __name__ == "__main__":
    main()
