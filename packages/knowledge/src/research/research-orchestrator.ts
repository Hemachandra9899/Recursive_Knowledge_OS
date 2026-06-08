import { ingestMarkdownDocument } from "../ingestion/ingest-markdown-document.js";
import { SearchPlannerAgent } from "../agents/search-planner.agent.js";
import { MemoryAgent } from "../agents/memory-agent.js";
import { planResources } from "./resource-planner.js";
import { crawlResearchSources } from "./crawl-manager.js";
import { buildEvidencePack } from "./evidence-pack.js";
import type { EvidencePack } from "./source-types.js";

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
  plan: unknown;
  resourcesPlanned: Array<{
    title: string;
    url: string;
    tier: string;
    score: number;
    source: string;
    reason: string;
  }>;
  memories: {
    retrieved: number;
    written: number;
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

    const resourcePlan = await planResources({
      query: planResult.output.normalizedQuery,
      maxSources,
    });

    const crawl = await crawlResearchSources({
      projectId: input.projectId,
      query: planResult.output.normalizedQuery,
      resources: resourcePlan.resources,
      maxPagesPerSource:
        input.maxPagesPerSource ??
        planResult.output.recommendedMaxPagesPerSource ??
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
          normalizedQuery: resourcePlan.normalizedQuery,
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
      resourcesPlanned: resourcePlan.resources,
      evidence: crawl.evidence,
    });

    const sourceMemoryDrafts = this.memoryAgent.buildSourceMemoriesFromEvidencePack({
      projectId: input.projectId,
      userId: input.userId,
      evidencePack,
    });

    const writeResult = await this.memoryAgent.writeRunMemories(
      context,
      sourceMemoryDrafts
    );

    return {
      status:
        documents.length > 0
          ? crawl.failed.length > 0
            ? "partial"
            : "ok"
          : "error",
      query: input.query,
      normalizedQuery: resourcePlan.normalizedQuery,
      plan: planResult.output,
      resourcesPlanned: resourcePlan.resources.map((resource) => ({
        title: resource.title,
        url: resource.url,
        tier: resource.tier,
        score: resource.score,
        source: resource.source,
        reason: resource.reason,
      })),
      memories: {
        retrieved: retrievedMemoryCount,
        written: writeResult.output?.written ?? 0,
      },
      documents,
      failedCrawls: crawl.failed,
      evidencePack,
    };
  }
}
