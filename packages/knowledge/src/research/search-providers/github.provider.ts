import type { SearchProvider, SearchProviderResult } from "./types.js";
import { clampLimit, pickString, titleFromUrl } from "./utils.js";

function getToken() {
  return process.env.GITHUB_TOKEN || "";
}

function queryLooksCodeRelated(query: string): boolean {
  return /\b(github|repo|repository|code|sdk|client|package|library|implementation|example|readme|open source|oss)\b/i.test(
    query
  );
}

function repoSearchQuery(query: string): string {
  const trimmed = query.trim().slice(0, 180);
  if (/\bin:/.test(trimmed)) return trimmed;
  return `${trimmed} in:name,description,readme`;
}

export class GitHubSearchProvider implements SearchProvider {
  readonly name = "github" as const;

  isConfigured(): boolean {
    return Boolean(getToken());
  }

  async search(input: {
    query: string;
    limit: number;
  }): Promise<SearchProviderResult[]> {
    const token = getToken();
    if (!token) return [];
    if (!queryLooksCodeRelated(input.query)) return [];

    const params = new URLSearchParams({
      q: repoSearchQuery(input.query),
      per_page: String(clampLimit(input.limit, 20)),
      sort: "updated",
      order: "desc",
    });

    const response = await fetch(
      `https://api.github.com/search/repositories?${params.toString()}`,
      {
        method: "GET",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );

    if (!response.ok) return [];

    const data = await response.json();
    const rows = Array.isArray(data?.items) ? data.items : [];

    return rows
      .map((row: any) => {
        const url = row?.html_url;
        if (!url) return null;

        return {
          title: pickString(row?.full_name, row?.name) ?? titleFromUrl(url),
          url,
          tier: "reference_examples" as const,
          product: row?.name,
          domain: "github.com",
          topics: Array.isArray(row?.topics) ? row.topics : [],
          keywords: ["github", "repository", "readme", "code"],
          reason: "Discovered by GitHub repository search.",
          source: "web_search" as const,
          publishedAt: row?.pushed_at || row?.updated_at || row?.created_at,
          metadata: {
            provider: this.name,
            description: row?.description,
            stars: row?.stargazers_count,
            language: row?.language,
            owner: row?.owner?.login,
            defaultBranch: row?.default_branch,
          },
        };
      })
      .filter(Boolean) as SearchProviderResult[];
  }
}
