export type FirecrawlScrapeOutput = {
  url: string;
  title: string;
  markdown: string;
  metadata: Record<string, unknown>;
};

function getFirecrawlApiKey(): string {
  const apiKey = process.env.FIRECRAWL_API_KEY;

  if (!apiKey) {
    throw new Error("FIRECRAWL_API_KEY is not configured");
  }

  return apiKey;
}

function pickMarkdown(data: any): string {
  return (
    data?.data?.markdown ||
    data?.markdown ||
    data?.data?.content ||
    data?.content ||
    ""
  );
}

function pickTitle(data: any, fallbackUrl: string): string {
  return (
    data?.data?.metadata?.title ||
    data?.data?.title ||
    data?.metadata?.title ||
    data?.title ||
    fallbackUrl
  );
}

export type FirecrawlSearchResult = {
  url: string;
  title: string;
  markdown: string;
  description?: string;
  metadata: Record<string, unknown>;
};

function pickUrl(data: any): string {
  return data?.url || data?.data?.url || data?.metadata?.sourceURL || "";
}

export async function searchWeb(
  query: string,
  limit = 3
): Promise<FirecrawlSearchResult[]> {
  const response = await fetch("https://api.firecrawl.dev/v1/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getFirecrawlApiKey()}`,
    },
    body: JSON.stringify({
      query,
      limit,
      scrapeOptions: {
        formats: ["markdown"],
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Firecrawl search failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  const rows = Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data?.results)
      ? data.results
      : [];

  const results: FirecrawlSearchResult[] = [];

  for (const row of rows.slice(0, limit)) {
    const url = pickUrl(row);
    if (!url) continue;

    let markdown = pickMarkdown(row);
    let title = pickTitle(row, url);

    if (!markdown || markdown.trim().length < 100) {
      try {
        const scraped = await scrapeUrl(url);
        markdown = scraped.markdown;
        title = scraped.title || title;
      } catch {
        markdown = row?.description || row?.content || title;
      }
    }

    results.push({
      url,
      title,
      markdown,
      description: row?.description,
      metadata: {
        provider: "firecrawl-search",
        rawMetadata: row?.metadata ?? {},
      },
    });
  }

  return results;
}

export async function scrapeUrl(url: string): Promise<FirecrawlScrapeOutput> {
  const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getFirecrawlApiKey()}`,
    },
    body: JSON.stringify({
      url,
      formats: ["markdown"],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Firecrawl scrape failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  const markdown = pickMarkdown(data);
  const title = pickTitle(data, url);

  if (!markdown.trim()) {
    throw new Error("Firecrawl returned empty markdown");
  }

  return {
    url,
    title,
    markdown,
    metadata: {
      provider: "firecrawl",
      rawMetadata: data?.data?.metadata ?? data?.metadata ?? {},
    },
  };
}
