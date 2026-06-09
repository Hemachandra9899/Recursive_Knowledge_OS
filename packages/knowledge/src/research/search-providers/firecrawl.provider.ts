import type { SearchProvider, SearchProviderResult } from "./types.js";
import {
  clampLimit,
  pickPublishedAt,
  pickString,
  titleFromUrl,
  tierForUrl,
} from "./utils.js";

function getApiKey() {
  return process.env.FIRECRAWL_API_KEY || "";
}

function pickUrl(row: any): string {
  return row?.url || row?.metadata?.sourceURL || "";
}

export class FirecrawlSearchProvider implements SearchProvider {
  readonly name = "firecrawl" as const;

  isConfigured(): boolean {
    return Boolean(getApiKey());
  }

  async search(input: {
    query: string;
    limit: number;
  }): Promise<SearchProviderResult[]> {
    const apiKey = getApiKey();
    if (!apiKey) return [];

    const response = await fetch("https://api.firecrawl.dev/v1/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query: input.query,
        limit: clampLimit(input.limit, 20),
      }),
    });

    if (!response.ok) return [];

    const data = await response.json();
    const rows = Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data?.results)
        ? data.results
        : [];

    return rows
      .map((row: any) => {
        const url = pickUrl(row);
        if (!url) return null;

        return {
          title: pickString(row?.title) ?? titleFromUrl(url),
          url,
          tier: tierForUrl(url),
          topics: [],
          keywords: [],
          reason: "Discovered by Firecrawl search fallback.",
          source: "web_search" as const,
          publishedAt: pickPublishedAt(row),
          metadata: {
            provider: this.name,
            description: row?.description,
            rawScore: row?.score,
          },
        };
      })
      .filter(Boolean) as SearchProviderResult[];
  }
}
