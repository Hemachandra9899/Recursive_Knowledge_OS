import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RankedResource } from "../source-types.js";
import type { ScraplingCrawlOutput } from "../../scrapers/scrapling.scraper.js";

const crawlSiteWithScraplingMock = vi.fn();

vi.mock("../../scrapers/scrapling.scraper.js", () => ({
  crawlSiteWithScrapling: crawlSiteWithScraplingMock,
}));

function resource(overrides: Partial<RankedResource> = {}): RankedResource {
  return {
    title: "Test Docs",
    url: "https://docs.example.com/test",
    tier: "official_docs",
    score: 100,
    source: "registry",
    reason: "Test resource",
    matchedBy: ["registry"],
    ...overrides,
  };
}

const GOOD_MD =
  "# Authentication Guide\n\nThis comprehensive guide explains how authentication works in our API system. You will learn about OAuth 2.0 flows, token management, and security best practices for production environments. We cover access tokens, refresh tokens, and client credentials grant types with detailed examples for each use case.";

function makeCrawlResult(
  pages: Array<{ url: string; markdown: string }>
): ScraplingCrawlOutput {
  return {
    status: "ok",
    rootUrl: "https://docs.example.com/test",
    pages: pages.map((p, i) => ({
      status: "ok",
      url: p.url,
      title: `Page ${i + 1}`,
      markdown: p.markdown,
      depth: 0,
      metadata: {},
    })),
    failedUrls: [],
    metadata: {},
  };
}

describe("crawlResearchSources dedupe behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deduplicates same canonical URL from same resource", async () => {
    crawlSiteWithScraplingMock.mockResolvedValueOnce(
      makeCrawlResult([
        { url: "https://docs.example.com/test/page1", markdown: GOOD_MD },
        { url: "https://docs.example.com/test/page1", markdown: GOOD_MD },
      ])
    );

    const { crawlResearchSources } = await import("../crawl-manager.js");

    const result = await crawlResearchSources({
      projectId: "project_1",
      query: "test",
      resources: [resource()],
      maxPagesPerSource: 5,
      maxTotalPages: 10,
      maxDepth: 1,
    });

    expect(result.pages).toHaveLength(1);
    expect(result.trace.rejectedByDuplicateUrl).toBe(1);
    expect(result.trace.rejectedByDuplicateContent).toBe(0);
  });

  it("deduplicates same canonical URL via www vs non-www across resources", async () => {
    crawlSiteWithScraplingMock
      .mockResolvedValueOnce(
        makeCrawlResult([
          { url: "https://docs.example.com/page1", markdown: GOOD_MD },
        ])
      )
      .mockResolvedValueOnce(
        makeCrawlResult([
          { url: "https://www.docs.example.com/page1", markdown: GOOD_MD },
        ])
      );

    const { crawlResearchSources } = await import("../crawl-manager.js");

    const result = await crawlResearchSources({
      projectId: "project_1",
      query: "test",
      resources: [resource(), resource()],
      maxPagesPerSource: 5,
      maxTotalPages: 10,
      maxDepth: 1,
    });

    expect(result.pages).toHaveLength(1);
    expect(result.trace.rejectedByDuplicateUrl).toBe(1);
  });

  it("deduplicates same content from different URLs", async () => {
    crawlSiteWithScraplingMock.mockResolvedValueOnce(
      makeCrawlResult([
        { url: "https://docs.example.com/page1", markdown: GOOD_MD },
        { url: "https://docs.example.com/page2", markdown: GOOD_MD },
      ])
    );

    const { crawlResearchSources } = await import("../crawl-manager.js");

    const result = await crawlResearchSources({
      projectId: "project_1",
      query: "test",
      resources: [resource()],
      maxPagesPerSource: 5,
      maxTotalPages: 10,
      maxDepth: 1,
    });

    expect(result.pages).toHaveLength(1);
    expect(result.trace.rejectedByDuplicateUrl).toBe(0);
    expect(result.trace.rejectedByDuplicateContent).toBe(1);
  });

  it("adds canonicalUrl, contentHash, dedupeStatus to accepted page metadata", async () => {
    crawlSiteWithScraplingMock.mockResolvedValueOnce(
      makeCrawlResult([
        { url: "https://docs.example.com/page1", markdown: GOOD_MD },
      ])
    );

    const { crawlResearchSources } = await import("../crawl-manager.js");

    const result = await crawlResearchSources({
      projectId: "project_1",
      query: "test",
      resources: [resource()],
      maxPagesPerSource: 5,
      maxTotalPages: 10,
      maxDepth: 1,
    });

    expect(result.pages).toHaveLength(1);
    const meta = result.pages[0].metadata;
    expect(meta.canonicalUrl).toBe("https://docs.example.com/page1");
    expect(meta.contentHash).toEqual(expect.any(String));
    expect(meta.dedupeStatus).toBe("new");
  });

  it("counts duplicates in trace correctly with mixed content", async () => {
    const MD_A = GOOD_MD;
    const MD_B =
      "# Rate Limiting\n\nThis document covers rate limiting and error handling strategies for API clients and developers. Developers should implement exponential backoff and retry logic for transient failures in production systems. You can also configure custom retry policies for different endpoint categories based on your specific use case requirements.";

    crawlSiteWithScraplingMock.mockResolvedValueOnce(
      makeCrawlResult([
        { url: "https://docs.example.com/a", markdown: MD_A },
        { url: "https://docs.example.com/a?ref=twitter", markdown: MD_B },
        { url: "https://docs.example.com/b", markdown: MD_A },
        { url: "https://docs.example.com/c", markdown: MD_B },
      ])
    );

    const { crawlResearchSources } = await import("../crawl-manager.js");

    const result = await crawlResearchSources({
      projectId: "project_1",
      query: "test",
      resources: [resource()],
      maxPagesPerSource: 10,
      maxTotalPages: 10,
      maxDepth: 1,
    });

    expect(result.pages).toHaveLength(2);
    expect(result.trace.rejectedByDuplicateUrl).toBe(1);
    expect(result.trace.rejectedByDuplicateContent).toBe(1);
    expect(result.trace.rejectedByQuality).toBe(0);
  });
});
