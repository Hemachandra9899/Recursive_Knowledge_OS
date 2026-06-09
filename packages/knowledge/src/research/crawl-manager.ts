import { crawlSiteWithScrapling } from "../scrapers/scrapling.scraper.js";
import type { RankedResource, EvidenceItem } from "./source-types.js";
import { extractEvidenceFromPages } from "./evidence-extractor.js";
import { scorePageQuality, type ContentQuality } from "./crawl-quality.js";

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

export type SkippedCrawl = {
  title: string;
  url: string;
  reason: string;
  quality: ContentQuality;
};

export type CrawlTrace = {
  totalPagesCrawled: number;
  acceptedPages: number;
  skippedPages: number;
  rejectedByQuality: number;
  sourcesWithContent: number;
  sourcesSkipped: number;
};

export type CrawlManagerOutput = {
  pages: CrawledResearchPage[];
  evidence: EvidenceItem[];
  failed: Array<{
    title?: string;
    url?: string;
    reason: string;
  }>;
  skipped: SkippedCrawl[];
  trace: CrawlTrace;
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
  const failed: CrawlManagerOutput["failed"] = [];
  const skipped: SkippedCrawl[] = [];
  let totalPagesCrawled = 0;
  let sourcesWithContent = 0;
  let sourcesSkipped = 0;

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

      let resourceHadContent = false;

      for (const page of crawl.pages ?? []) {
        totalPagesCrawled++;
        if (!page.markdown?.trim()) continue;

        const quality = scorePageQuality(page.markdown);

        const crawledPage: CrawledResearchPage = {
          title: page.title || resource.title,
          url: page.url,
          markdown: page.markdown,
          depth: page.depth,
          source: resource,
          metadata: {
            ...page.metadata,
            contentQuality: quality,
            rootUrl: resource.url,
            sourceTier: resource.tier,
            sourceScore: resource.score,
            matchedBy: resource.matchedBy,
          },
        };

        if (quality.status === "reject") {
          skipped.push({
            title: crawledPage.title,
            url: crawledPage.url,
            reason: `Quality check failed (score=${quality.score}): ${quality.flags.join(", ")}`,
            quality,
          });
          continue;
        }

        resourceHadContent = true;
        pages.push(crawledPage);

        if (pages.length >= maxTotalPages) break;
      }

      if (resourceHadContent) {
        sourcesWithContent++;
      } else if ((crawl.pages ?? []).length > 0) {
        sourcesSkipped++;
      }
    } catch (error) {
      failed.push({
        title: resource.title,
        url: resource.url,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const evidence = extractEvidenceFromPages(
    pages.map((page) => ({
      title: page.title,
      url: page.url,
      markdown: page.markdown,
      product: page.source.product,
      domain: page.source.domain,
      tier: page.source.tier,
      reason: page.source.reason,
      metadata: page.metadata,
    }))
  );

  return {
    pages,
    evidence,
    failed,
    skipped,
    trace: {
      totalPagesCrawled,
      acceptedPages: pages.length,
      skippedPages: skipped.length,
      rejectedByQuality: skipped.length,
      sourcesWithContent,
      sourcesSkipped,
    },
  };
}
