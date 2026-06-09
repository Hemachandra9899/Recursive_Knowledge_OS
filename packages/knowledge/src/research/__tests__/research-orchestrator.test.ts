import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RankedResource } from "../source-types.js";
import type { ScoutMemoryDraft } from "../../memory/memory-types.js";

const planResourcesMock = vi.fn();
const crawlResearchSourcesMock = vi.fn();
const ingestMarkdownDocumentMock = vi.fn();

vi.mock("../resource-planner.js", () => ({
  planResources: planResourcesMock,
}));

vi.mock("../crawl-manager.js", () => ({
  crawlResearchSources: crawlResearchSourcesMock,
}));

vi.mock("../../ingestion/ingest-markdown-document.js", () => ({
  ingestMarkdownDocument: ingestMarkdownDocumentMock,
}));

function resource(overrides: Partial<RankedResource> = {}): RankedResource {
  return {
    title: "Example API Docs",
    url: "https://docs.example.com/auth",
    tier: "official_docs",
    score: 120,
    source: "registry",
    reason: "Official docs",
    matchedBy: ["registry"],
    product: "Example API",
    domain: "docs.example.com",
    topics: ["authentication"],
    keywords: ["oauth"],
    ...overrides,
  };
}

function fakeSearchPlanner() {
  return {
    plan: vi.fn(() => ({
      status: "ok",
      output: {
        normalizedQuery: "compare example api and sample api authentication",
        useCase: "comparison",
        recommendedMaxSources: 4,
        recommendedMaxPagesPerSource: 2,
        subqueries: [
          {
            query: "Example API authentication",
            reason: "Find Example API auth docs",
            priority: 1,
          },
          {
            query: "Sample API authentication",
            reason: "Find Sample API auth docs",
            priority: 2,
          },
        ],
      },
    })),
  };
}

function fakeMemoryAgent() {
  const sourceDrafts: ScoutMemoryDraft[] = [
    {
      projectId: "project_1",
      scope: "source",
      kind: "source_quality",
      text: "Useful source",
      sourceUrls: ["https://docs.example.com/auth"],
      confidence: 0.9,
    },
  ];

  const durableDrafts: ScoutMemoryDraft[] = [
    {
      projectId: "project_1",
      scope: "project",
      kind: "durable_fact",
      text: "Example API requires OAuth.",
      sourceUrls: ["https://docs.example.com/auth"],
      confidence: 0.92,
    },
  ];

  return {
    retrieveForRun: vi.fn(async () => ({
      status: "ok",
      agent: "memory",
      output: {
        retrieved: [
          {
            id: "mem_1",
            projectId: "project_1",
            userId: null,
            scope: "source",
            kind: "source_quality",
            text: "Example API docs were useful before.",
            entities: ["Example API"],
            sourceUrls: ["https://docs.example.com/auth"],
            confidence: 0.9,
            metadata: {},
            createdAt: new Date(),
          },
        ],
        written: 0,
      },
    })),
    buildSourceMemoriesFromEvidencePack: vi.fn(() => sourceDrafts),
    buildFailureMemoriesFromCrawlFailures: vi.fn(() => []),
    buildDurableFactMemoriesFromEvidencePack: vi.fn(() => durableDrafts),
    writeRunMemories: vi.fn(async (_context, drafts: ScoutMemoryDraft[]) => ({
      status: "ok",
      agent: "memory",
      output: {
        retrieved: [],
        written: drafts.length,
      },
    })),
  };
}

describe("ResearchOrchestrator integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    planResourcesMock
      .mockResolvedValueOnce({
        normalizedQuery: "Example API authentication",
        strategy: "registry_first",
        resources: [
          resource({
            title: "Example API Auth Docs",
            url: "https://docs.example.com/auth",
            matchedBy: ["registry", "memory:source_quality:+16"],
          }),
        ],
      })
      .mockResolvedValueOnce({
        normalizedQuery: "Sample API authentication",
        strategy: "registry_first",
        resources: [
          resource({
            title: "Sample API Auth Docs",
            url: "https://docs.sample.com/auth",
            product: "Sample API",
            domain: "docs.sample.com",
            matchedBy: ["registry"],
          }),
          resource({
            title: "Example API Auth Docs Duplicate",
            url: "https://docs.example.com/auth/",
            matchedBy: ["registry-duplicate"],
            score: 90,
          }),
        ],
      });

    crawlResearchSourcesMock.mockResolvedValue({
      pages: [
        {
          title: "Example API Auth Docs",
          url: "https://docs.example.com/auth",
          markdown: "# Authentication\n\nExample API requires OAuth access tokens for authenticated requests.",
          depth: 0,
          source: resource({
            title: "Example API Auth Docs",
            url: "https://docs.example.com/auth",
            matchedBy: ["registry", "memory:source_quality:+16"],
          }),
          metadata: {
            provider: "scrapling",
          },
        },
        {
          title: "Sample API Auth Docs",
          url: "https://docs.sample.com/auth",
          markdown: "# Authentication\n\nSample API uses OAuth credentials for authenticated requests.",
          depth: 0,
          source: resource({
            title: "Sample API Auth Docs",
            url: "https://docs.sample.com/auth",
            product: "Sample API",
            domain: "docs.sample.com",
          }),
          metadata: {
            provider: "scrapling",
          },
        },
      ],
      evidence: [
        {
          claim: "Example API requires OAuth access tokens for authenticated requests.",
          quote: "Example API requires OAuth access tokens for authenticated requests.",
          title: "Example API Auth Docs",
          url: "https://docs.example.com/auth",
          section: "Authentication",
          product: "Example API",
          domain: "docs.example.com",
          tier: "official_docs",
          confidence: 0.92,
          entities: ["Example API", "OAuth"],
          reason: "Official docs",
        },
        {
          claim: "Sample API uses OAuth credentials for authenticated requests.",
          quote: "Sample API uses OAuth credentials for authenticated requests.",
          title: "Sample API Auth Docs",
          url: "https://docs.sample.com/auth",
          section: "Authentication",
          product: "Sample API",
          domain: "docs.sample.com",
          tier: "official_docs",
          confidence: 0.91,
          entities: ["Sample API", "OAuth"],
          reason: "Official docs",
        },
      ],
      failed: [],
      skipped: [],
      trace: {
        totalPagesCrawled: 2,
        acceptedPages: 2,
        skippedPages: 0,
        rejectedByQuality: 0,
        rejectedByDuplicateUrl: 0,
        rejectedByDuplicateContent: 0,
        sourcesWithContent: 2,
        sourcesSkipped: 0,
        retryCount: 0,
        resourceTraces: [
          {
            resourceUrl: "https://docs.example.com/auth",
            tier: "official_docs",
            modesPlanned: ["auto"],
            attempts: 1,
            retried: false,
            pagesAccepted: 1,
            pagesSkipped: 0,
            pagesFailed: 0,
          },
          {
            resourceUrl: "https://docs.sample.com/auth",
            tier: "official_docs",
            modesPlanned: ["auto"],
            attempts: 1,
            retried: false,
            pagesAccepted: 1,
            pagesSkipped: 0,
            pagesFailed: 0,
          },
        ],
      },
    });

    ingestMarkdownDocumentMock
      .mockResolvedValueOnce({
        document: { id: "doc_1" },
        chunksTotal: 2,
        embeddedChunks: 2,
        deduped: false,
      })
      .mockResolvedValueOnce({
        document: { id: "doc_2" },
        chunksTotal: 2,
        embeddedChunks: 2,
        deduped: false,
      });
  });

  it("runs the full deterministic research path without network or database calls", async () => {
    const { ResearchOrchestrator } = await import("../research-orchestrator.js");

    const memoryAgent = fakeMemoryAgent();
    const orchestrator = new ResearchOrchestrator(
      fakeSearchPlanner() as any,
      memoryAgent as any
    );

    const result = await orchestrator.run({
      projectId: "project_1",
      userId: "user_1",
      query: "Compare Example API and Sample API authentication",
      maxSources: 4,
      maxPagesPerSource: 2,
      maxTotalPages: 4,
      maxDepth: 1,
    });

    expect(planResourcesMock).toHaveBeenCalledTimes(2);
    expect(planResourcesMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        query: "Example API authentication",
        memoryHints: expect.arrayContaining([
          expect.objectContaining({ kind: "source_quality" }),
        ]),
      })
    );

    expect(crawlResearchSourcesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project_1",
        maxPagesPerSource: 2,
        maxTotalPages: 4,
        maxDepth: 1,
      })
    );

    expect(ingestMarkdownDocumentMock).toHaveBeenCalledTimes(2);

    expect(result.status).toBe("ok");
    expect(result.subqueries).toHaveLength(2);
    expect(result.resourcesPlanned).toHaveLength(2);
    expect(result.resourcesPlanned[0].matchedBy).toEqual(
      expect.arrayContaining([
        "registry",
        "memory:source_quality:+16",
        "subquery:Example API authentication",
      ])
    );

    expect(result.evidencePack.coverage.claimCount).toBe(2);
    expect(result.evidencePack.coverage.supportedClaimCount).toBe(2);
    expect(result.answer.status).toBe("answered");
    expect(result.answer.mode).toBe("comparison");
    expect(result.answer.markdown).toContain("## Comparison table");
    expect(result.answer.citations).toHaveLength(2);

    expect(result.memories.retrieved).toBe(1);
    expect(result.memories.usedForRanking).toBe(1);
    expect(result.memories.planned.sourceQuality).toBe(1);
    expect(result.memories.planned.durableFact).toBe(1);
    expect(result.memories.written).toBe(2);

    expect(memoryAgent.writeRunMemories).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project_1",
        userId: "user_1",
      }),
      expect.arrayContaining([
        expect.objectContaining({ kind: "source_quality" }),
        expect.objectContaining({ kind: "durable_fact" }),
      ])
    );
  });
});
