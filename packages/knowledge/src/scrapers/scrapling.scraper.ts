const MODEL_SERVICE_URL =
  process.env.MODEL_SERVICE_URL || "http://model-service:8100";

export type ScrapedPage = {
  status: string;
  url: string;
  title: string;
  markdown: string;
  metadata: Record<string, unknown>;
};

export type ScraplingCrawlMode = "auto" | "static" | "dynamic" | "stealth";

export type ScraplingCrawlPage = ScrapedPage & {
  depth: number;
  parentUrl?: string | null;
};

export type ScraplingCrawlOutput = {
  status: string;
  rootUrl: string;
  pages: ScraplingCrawlPage[];
  failedUrls: Array<{ url: string; reason: string }>;
  metadata: Record<string, unknown>;
};

export async function scrapePageWithScrapling(
  url: string,
  options?: {
    mode?: ScraplingCrawlMode;
    aiTargeted?: boolean;
  }
): Promise<ScrapedPage> {
  const response = await fetch(`${MODEL_SERVICE_URL}/scrape/page`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      mode: options?.mode ?? "auto",
      ai_targeted: options?.aiTargeted ?? true,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Scrapling scrape failed: ${response.status} ${text}`);
  }

  return await response.json();
}

export async function crawlSiteWithScrapling(input: {
  rootUrl: string;
  maxPages?: number;
  maxDepth?: number;
  mode?: ScraplingCrawlMode;
  aiTargeted?: boolean;
  sameDomainOnly?: boolean;
}): Promise<ScraplingCrawlOutput> {
  const response = await fetch(`${MODEL_SERVICE_URL}/scrape/crawl`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      root_url: input.rootUrl,
      max_pages: input.maxPages ?? 5,
      max_depth: input.maxDepth ?? 1,
      mode: input.mode ?? "auto",
      ai_targeted: input.aiTargeted ?? true,
      same_domain_only: input.sameDomainOnly ?? true,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Scrapling crawl failed: ${response.status} ${text}`);
  }

  return await response.json();
}
