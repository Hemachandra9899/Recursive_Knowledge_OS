import type { SearchProvider, SearchProviderResult } from "./types.js";
import {
  clampLimit,
  pickPublishedAt,
  pickString,
  titleFromUrl,
  tierForUrl,
} from "./utils.js";

function getApiKey() {
  return process.env.TAVILY_API_KEY || "";
}

function timeRange(required?: boolean): string | undefined {
  return required ? "year" : undefined;
}

export class TavilySearchProvider implements SearchProvider {
  readonly name = "tavily" as const;

  isConfigured(): boolean {
    return Boolean(getApiKey());
  }

  async search(input: {
    query: string;
    limit: number;
    freshnessRequired?: boolean;
  }): Promise<SearchProviderResult[]> {
    const apiKey = getApiKey();
    if (!apiKey) return [];

    const body: Record<string, unknown> = {
      query: input.query,
      max_results: clampLimit(input.limit, 20),
      search_depth: "basic",
      include_answer: false,
      include_raw_content: false,
      include_favicon: true,
    };

    const range = timeRange(input.freshnessRequired);
    if (range) body.time_range = range;

    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) return [];

    const data = await response.json();
    const rows = Array.isArray(data?.results) ? data.results : [];

    return rows
      .map((row: any) => {
        const url = row?.url;
        if (!url) return null;

        return {
          title: pickString(row?.title) ?? titleFromUrl(url),
          url,
          tier: tierForUrl(url),
          topics: [],
          keywords: [],
          reason: "Discovered by Tavily Search.",
          source: "web_search" as const,
          publishedAt: pickPublishedAt(row),
          metadata: {
            provider: this.name,
            content: row?.content,
            rawScore: row?.score,
            favicon: row?.favicon,
          },
        };
      })
      .filter(Boolean) as SearchProviderResult[];
  }
}
