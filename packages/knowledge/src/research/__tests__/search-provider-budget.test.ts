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

describe("search provider budgets", () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
  });

  afterEach(() => {
    process.env = env;
    vi.restoreAllMocks();
  });

  it("docs route does not call github even if configured", async () => {
    const github = provider("github", "https://github.com/example/sdk");
    const tavily = provider("tavily", "https://docs.example.com/docs");

    await searchResourceCandidates(
      "Google Ads API authentication documentation",
      5,
      { providers: [github, tavily] }
    );

    expect(github.search).not.toHaveBeenCalled();
    expect(tavily.search).toHaveBeenCalled();
  });

  it("code route calls github with higher budget limit", async () => {
    const github = provider("github", "https://github.com/example/sdk");
    const tavily = provider("tavily", "https://docs.example.com/sdk");

    await searchResourceCandidates(
      "typescript sdk github repository",
      5,
      { providers: [github, tavily] }
    );

    expect(github.search).toHaveBeenCalled();
    expect(tavily.search).toHaveBeenCalled();
    expect(github.search).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10 })
    );
  });

  it("env TAVILY_ENABLED=false skips tavily", async () => {
    process.env.TAVILY_ENABLED = "false";

    const tavily = provider("tavily", "https://docs.example.com/auth");
    const firecrawl = provider("firecrawl", "https://docs.example.com/auth/");

    const results = await searchResourceCandidates(
      "api authentication",
      5,
      { providers: [tavily, firecrawl] }
    );

    expect(tavily.search).not.toHaveBeenCalled();
    expect(firecrawl.search).toHaveBeenCalled();
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("includes budgets in searchTrace metadata", async () => {
    const tavily = provider("tavily", "https://docs.example.com/auth");

    const results = await searchResourceCandidates(
      "api authentication",
      5,
      { providers: [tavily] }
    );

    const trace = (results[0].metadata as any)?.searchTrace;
    expect(trace).toBeDefined();
    expect(trace.budgets).toBeDefined();
    expect(trace.budgets.tavily).toBeDefined();
    expect(trace.budgets.tavily.maxResults).toBeGreaterThan(0);
  });
});
