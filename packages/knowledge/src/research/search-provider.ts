import type { ResourceCandidate } from "./source-types.js";
import { inferTierFromUrl } from "./source-ranker.js";

function getFirecrawlApiKey() {
  return process.env.FIRECRAWL_API_KEY || "";
}

function pickUrl(row: any): string {
  return row?.url || row?.metadata?.sourceURL || "";
}

function pickPublishedAt(row: any): string | undefined {
  return (
    row?.publishedAt ||
    row?.published_at ||
    row?.date ||
    row?.updatedAt ||
    row?.updated_at ||
    row?.metadata?.publishedAt ||
    row?.metadata?.published_at ||
    row?.metadata?.date ||
    row?.metadata?.updatedAt ||
    row?.metadata?.updated_at
  );
}

export async function searchResourceCandidates(
  query: string,
  limit = 5
): Promise<ResourceCandidate[]> {
  const apiKey = getFirecrawlApiKey();

  if (!apiKey) return [];

  const response = await fetch("https://api.firecrawl.dev/v1/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      limit,
    }),
  });

  if (!response.ok) {
    return [];
  }

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
        title: row?.title || url,
        url,
        tier: inferTierFromUrl(url),
        topics: [],
        keywords: [],
        reason: "Discovered by web search fallback.",
        source: "web_search" as const,
        publishedAt: pickPublishedAt(row),
        metadata: {
          provider: "firecrawl",
          description: row?.description,
          rawScore: row?.score,
        },
      };
    })
    .filter(Boolean) as ResourceCandidate[];
}
