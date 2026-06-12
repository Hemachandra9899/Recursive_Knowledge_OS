import { ingestMarkdownDocument } from "../ingestion/ingest-markdown-document.js";
import { SearchPlannerAgent } from "../agents/search-planner.agent.js";
import { MemoryAgent } from "../agents/memory-agent.js";
import { planResources } from "./resource-planner.js";
import { crawlResearchSources } from "./crawl-manager.js";
import { buildEvidencePack } from "./evidence-pack.js";
import { synthesizeAnswerFromEvidencePack } from "./answer-synthesizer.js";
import type {
  EvidencePack,
  RankedResource,
  SynthesizedAnswer,
} from "./source-types.js";

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
    metadata?: Record<string, unknown>;
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
  skippedCrawls: Array<{
    title: string;
    url: string;
    reason: string;
    quality: import("./crawl-quality.js").ContentQuality;
  }>;
  crawlTrace: import("./crawl-manager.js").CrawlTrace;
  evidencePack: EvidencePack;
  answer: SynthesizedAnswer;
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
      memoryHints: rankingMemories,
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

    const answer = synthesizeAnswerFromEvidencePack({
      query: input.query,
      evidencePack,
      maxClaims: 10,
    });

    const sourceMemoryDrafts = this.memoryAgent.buildSourceMemoriesFromEvidencePack({
      projectId: input.projectId,
      userId: input.userId,
      evidencePack,
    });

    const skippedAsFailures: Array<{
      title?: string;
      url?: string;
      reason: string;
    }> = crawl.skipped.map((s) => ({
      title: s.title,
      url: s.url,
      reason: `Skipped by quality gate: ${s.reason}`,
    }));

    const failureMemoryDrafts = this.memoryAgent.buildFailureMemoriesFromCrawlFailures({
      projectId: input.projectId,
      userId: input.userId,
      query: input.query,
      failedCrawls: [...crawl.failed, ...skippedAsFailures],
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
          ? crawl.failed.length > 0 || answer.status !== "answered"
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
        ...(resource.metadata && Object.keys(resource.metadata).length > 0 ? { metadata: resource.metadata } : {}),
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
      skippedCrawls: crawl.skipped.map((s) => ({
        title: s.title,
        url: s.url,
        reason: s.reason,
        quality: s.quality,
      })),
      crawlTrace: crawl.trace,
      evidencePack,
      answer,
    };
  }
}
