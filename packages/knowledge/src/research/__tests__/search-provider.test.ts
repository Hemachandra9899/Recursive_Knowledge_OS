import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchResourceCandidates } from "../search-provider.js";
import type { SearchProvider } from "../search-providers/types.js";
import type { SourceTier } from "../source-types.js";

function provider(name: "firecrawl" | "tavily" | "github", url: string): SearchProvider {
  return {
    name,
    isConfigured: () => true,
    search: vi.fn(async () => [
      {
        title: `${name} result`,
        url,
        tier: "unknown" as SourceTier,
        reason: `From ${name}`,
        source: "web_search" as const,
        topics: [name],
        keywords: [name],
        metadata: {
          provider: name,
        },
      },
    ]),
  };
}

describe("searchResourceCandidates", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs configured providers and merges duplicate URLs", async () => {
    const providers = [
      provider("firecrawl", "https://docs.example.com/auth"),
      provider("tavily", "https://docs.example.com/auth/"),
      provider("github", "https://github.com/example/sdk"),
    ];

    const results = await searchResourceCandidates("example sdk auth", 5, {
      providers,
    });

    expect(providers[0].search).toHaveBeenCalled();
    expect(providers[1].search).toHaveBeenCalled();
    expect(providers[2].search).toHaveBeenCalled();

    expect(results).toHaveLength(2);
    expect(results[0].metadata?.alternateProviders).toContain("tavily");
  });

  it("passes freshnessRequired to providers", async () => {
    const p = provider("tavily", "https://docs.example.com/rate-limits");

    await searchResourceCandidates("latest API rate limits", 5, {
      providers: [p],
    });

    expect(p.search).toHaveBeenCalledWith(
      expect.objectContaining({
        freshnessRequired: true,
      })
    );
  });
});

describe("provider implementations", () => {
  const env = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...env };
  });

  afterEach(() => {
    process.env = env;
    vi.restoreAllMocks();
  });

  it("TavilySearchProvider maps search results", async () => {
    process.env.TAVILY_API_KEY = "tavily-key";

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          results: [
            {
              title: "Tavily Docs",
              url: "https://docs.example.com/tavily",
              content: "Tavily content",
              score: 0.9,
            },
          ],
        }),
      })) as any
    );

    const { TavilySearchProvider } = await import(
      "../search-providers/tavily.provider.js"
    );
    const results = await new TavilySearchProvider().search({
      query: "docs",
      limit: 5,
      freshnessRequired: true,
    });

    expect(results[0]).toMatchObject({
      title: "Tavily Docs",
      url: "https://docs.example.com/tavily",
      source: "web_search",
    });
    expect(results[0].metadata?.provider).toBe("tavily");
    expect(fetch).toHaveBeenCalledWith(
      "https://api.tavily.com/search",
      expect.objectContaining({
        method: "POST",
      })
    );
  });

  it("FirecrawlSearchProvider maps search results", async () => {
    process.env.FIRECRAWL_API_KEY = "firecrawl-key";

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: [
            {
              title: "Firecrawl Docs",
              url: "https://docs.example.com/firecrawl",
              description: "Firecrawl content",
              score: 0.8,
            },
          ],
        }),
      })) as any
    );

    const { FirecrawlSearchProvider } = await import(
      "../search-providers/firecrawl.provider.js"
    );
    const results = await new FirecrawlSearchProvider().search({
      query: "docs",
      limit: 5,
    });

    expect(results[0].metadata?.provider).toBe("firecrawl");
  });

  it("GitHubSearchProvider maps repository results only for code-related queries", async () => {
    process.env.GITHUB_TOKEN = "github-token";

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          items: [
            {
              full_name: "example/sdk",
              name: "sdk",
              html_url: "https://github.com/example/sdk",
              description: "Example SDK",
              stargazers_count: 100,
              language: "TypeScript",
              topics: ["sdk"],
              pushed_at: "2026-01-01T00:00:00Z",
              owner: { login: "example" },
              default_branch: "main",
            },
          ],
        }),
      })) as any
    );

    const { GitHubSearchProvider } = await import(
      "../search-providers/github.provider.js"
    );
    const provider = new GitHubSearchProvider();

    expect(await provider.search({ query: "weather today", limit: 5 })).toEqual([]);

    const results = await provider.search({
      query: "example sdk github repository",
      limit: 5,
    });

    expect(results[0]).toMatchObject({
      title: "example/sdk",
      url: "https://github.com/example/sdk",
      tier: "reference_examples",
    });
  });
});
