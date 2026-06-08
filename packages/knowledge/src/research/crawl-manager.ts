import { crawlSiteWithScrapling } from "../scrapers/scrapling.scraper.js";
import type { RankedResource, EvidenceItem } from "./source-types.js";
import { preview } from "../text/chunk-text.js";

export type CrawlManagerInput = {
  projectId: string;
  query: string;
  resources: RankedResource[];
  maxPagesPerSource?: number;
  maxTotalPages?: number;
  maxDepth?: number;
};

export type CrawledResearchPage = {
  title: string;
  url: string;
  markdown: string;
  depth: number;
  source: RankedResource;
  metadata: Record<string, unknown>;
};

export type CrawlManagerOutput = {
  pages: CrawledResearchPage[];
  evidence: EvidenceItem[];
  failed: Array<{
    title?: string;
    url?: string;
    reason: string;
  }>;
};

function modeForResource(resource: RankedResource): "auto" | "static" | "dynamic" | "stealth" {
  if (resource.tier === "official_docs" || resource.tier === "trusted_docs") {
    return "auto";
  }

  if (resource.tier === "community" || resource.tier === "media") {
    return "dynamic";
  }

  return "auto";
}

export async function crawlResearchSources(
  input: CrawlManagerInput
): Promise<CrawlManagerOutput> {
  const maxPagesPerSource = input.maxPagesPerSource ?? 3;
  const maxTotalPages = input.maxTotalPages ?? 20;
  const maxDepth = input.maxDepth ?? 1;

  const pages: CrawledResearchPage[] = [];
  const evidence: EvidenceItem[] = [];
  const failed: CrawlManagerOutput["failed"] = [];

  for (const resource of input.resources) {
    if (pages.length >= maxTotalPages) break;

    try {
      const crawl = await crawlSiteWithScrapling({
        rootUrl: resource.url,
        maxPages: Math.min(maxPagesPerSource, maxTotalPages - pages.length),
        maxDepth,
        mode: modeForResource(resource),
        aiTargeted: true,
        sameDomainOnly: true,
      });

      for (const failedUrl of crawl.failedUrls ?? []) {
        failed.push({
          title: resource.title,
          url: failedUrl.url,
          reason: failedUrl.reason,
        });
      }

      for (const page of crawl.pages ?? []) {
        if (!page.markdown?.trim()) continue;

        const crawledPage: CrawledResearchPage = {
          title: page.title || resource.title,
          url: page.url,
          markdown: page.markdown,
          depth: page.depth,
          source: resource,
          metadata: {
            ...page.metadata,
            rootUrl: resource.url,
            sourceTier: resource.tier,
            sourceScore: resource.score,
            matchedBy: resource.matchedBy,
          },
        };

        pages.push(crawledPage);

        evidence.push({
          title: crawledPage.title,
          url: crawledPage.url,
          product: resource.product,
          domain: resource.domain,
          tier: resource.tier,
          text: preview(crawledPage.markdown, 1800),
          reason: resource.reason,
        });

        if (pages.length >= maxTotalPages) break;
      }
    } catch (error) {
      failed.push({
        title: resource.title,
        url: resource.url,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    pages,
    evidence,
    failed,
  };
}
