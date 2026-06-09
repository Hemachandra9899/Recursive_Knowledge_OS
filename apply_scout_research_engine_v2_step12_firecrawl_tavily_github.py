#!/usr/bin/env python3
# Apply Scout Research Engine v2 Step 12:
# Multi-provider search abstraction WITHOUT Brave.
#
# Run from Scout repo root on main.
#
# Providers:
# - Firecrawl: general web search fallback, already supported by Scout.
# - Tavily: main web search provider.
# - GitHub: repo/SDK/code/example discovery for implementation queries.
#
# Env vars:
#   FIRECRAWL_API_KEY=optional_existing_key
#   TAVILY_API_KEY=required_for_tavily
#   GITHUB_TOKEN=required_for_github_repo_search
#
# No Brave provider is added.
#
# After applying:
#   npm run typecheck:knowledge
#   npm run test:knowledge

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path.cwd()


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content.strip() + "\n", encoding="utf-8")
    print(f"wrote {path}")


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def assert_repo_root() -> None:
    required = [
        "package.json",
        "packages/knowledge/src/research/search-provider.ts",
        "packages/knowledge/src/research/resource-planner.ts",
        "packages/knowledge/src/research/source-types.ts",
    ]
    missing = [p for p in required if not (ROOT / p).exists()]
    if missing:
        raise SystemExit(
            "Run this script from Scout repo root. Missing:\n"
            + "\n".join(f"- {p}" for p in missing)
        )


TYPES_TS = r'''
import type { ResourceCandidate } from "../source-types.js";

export type SearchProviderName =
  | "firecrawl"
  | "tavily"
  | "github";

export type SearchProviderInput = {
  query: string;
  limit: number;
  freshnessRequired?: boolean;
};

export type SearchProviderResult = ResourceCandidate & {
  metadata?: Record<string, unknown> & {
    provider?: SearchProviderName;
  };
};

export type SearchProvider = {
  name: SearchProviderName;
  isConfigured(): boolean;
  search(input: SearchProviderInput): Promise<SearchProviderResult[]>;
};
'''


UTILS_TS = r'''
import type { SourceTier } from "../source-types.js";
import { inferTierFromUrl } from "../source-ranker.js";

export function clampLimit(limit: number, max: number): number {
  return Math.max(1, Math.min(Math.floor(limit || 1), max));
}

export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}${parsed.search}`;
  } catch {
    return url;
  }
}

export function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

export function pickPublishedAt(row: any): string | undefined {
  return pickString(
    row?.publishedAt,
    row?.published_at,
    row?.date,
    row?.updatedAt,
    row?.updated_at,
    row?.age,
    row?.metadata?.publishedAt,
    row?.metadata?.published_at,
    row?.metadata?.date,
    row?.metadata?.updatedAt,
    row?.metadata?.updated_at
  );
}

export function titleFromUrl(url: string): string {
  const host = hostFromUrl(url);
  return host || url;
}

export function tierForUrl(url: string, fallback?: SourceTier): SourceTier {
  return fallback ?? inferTierFromUrl(url);
}
'''


FIRECRAWL_PROVIDER_TS = r'''
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
'''


TAVILY_PROVIDER_TS = r'''
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
'''


GITHUB_PROVIDER_TS = r'''
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
'''


PROVIDERS_INDEX_TS = r'''
export * from "./types.js";
export * from "./firecrawl.provider.js";
export * from "./tavily.provider.js";
export * from "./github.provider.js";

import type { SearchProvider } from "./types.js";
import { FirecrawlSearchProvider } from "./firecrawl.provider.js";
import { GitHubSearchProvider } from "./github.provider.js";
import { TavilySearchProvider } from "./tavily.provider.js";

export function getAllSearchProviders(): SearchProvider[] {
  return [
    new FirecrawlSearchProvider(),
    new TavilySearchProvider(),
    new GitHubSearchProvider(),
  ];
}

export function getConfiguredSearchProviders(): SearchProvider[] {
  return getAllSearchProviders().filter((provider) => provider.isConfigured());
}
'''


SEARCH_PROVIDER_TS = r'''
import type { ResourceCandidate } from "./source-types.js";
import { isFreshnessRequired } from "./source-ranker.js";
import {
  getConfiguredSearchProviders,
  type SearchProvider,
} from "./search-providers/index.js";
import { normalizeUrl } from "./search-providers/utils.js";

export type SearchResourceCandidateOptions = {
  freshnessRequired?: boolean;
  providers?: SearchProvider[];
};

function mergeProviderResults(results: ResourceCandidate[]): ResourceCandidate[] {
  const byUrl = new Map<string, ResourceCandidate>();

  for (const result of results) {
    const key = normalizeUrl(result.url);
    const existing = byUrl.get(key);

    if (!existing) {
      byUrl.set(key, result);
      continue;
    }

    byUrl.set(key, {
      ...existing,
      publishedAt: existing.publishedAt ?? result.publishedAt,
      topics: [...new Set([...(existing.topics ?? []), ...(result.topics ?? [])])],
      keywords: [
        ...new Set([...(existing.keywords ?? []), ...(result.keywords ?? [])]),
      ],
      metadata: {
        ...(existing.metadata ?? {}),
        alternateProviders: [
          ...new Set([
            ...((existing.metadata?.alternateProviders as string[]) ?? []),
            result.metadata?.provider as string,
          ].filter(Boolean)),
        ],
      },
      reason: `${existing.reason} Also discovered by ${result.metadata?.provider ?? "another provider"}.`,
    });
  }

  return [...byUrl.values()];
}

export async function searchResourceCandidates(
  query: string,
  limit = 5,
  options: SearchResourceCandidateOptions = {}
): Promise<ResourceCandidate[]> {
  const providers = options.providers ?? getConfiguredSearchProviders();
  if (providers.length === 0) return [];

  const freshnessRequired =
    options.freshnessRequired ?? isFreshnessRequired(query);

  const perProviderLimit = Math.max(3, Math.ceil(limit / providers.length) + 2);

  const settled = await Promise.allSettled(
    providers.map((provider) =>
      provider.search({
        query,
        limit: perProviderLimit,
        freshnessRequired,
      })
    )
  );

  const results = settled.flatMap((item) =>
    item.status === "fulfilled" ? item.value : []
  );

  return mergeProviderResults(results).slice(0, limit * 3);
}
'''


RESOURCE_PLANNER_TS = r'''
import { DOC_REGISTRY } from "../registry/doc-registry.js";
import type { RankedResource, ResourceCandidate } from "./source-types.js";
import { buildFallbackSearchQueries, normalizeResearchQuery } from "./query-builder.js";
import {
  isFreshnessRequired,
  rankResourceCandidates,
} from "./source-ranker.js";
import { searchResourceCandidates } from "./search-provider.js";
import type { ResourceMemoryHint } from "./memory-ranking.js";

export async function planResources(input: {
  query: string;
  maxSources?: number;
  memoryHints?: ResourceMemoryHint[];
}): Promise<{
  normalizedQuery: string;
  strategy: "registry_first" | "search_fallback" | "mixed";
  resources: RankedResource[];
}> {
  const normalizedQuery = normalizeResearchQuery(input.query);
  const maxSources = input.maxSources ?? 10;
  const memoryHints = input.memoryHints ?? [];
  const freshnessRequired = isFreshnessRequired(normalizedQuery);

  const registryResources = rankResourceCandidates(
    normalizedQuery,
    DOC_REGISTRY,
    {
      maxSources,
      minScore: 45,
      memoryHints,
      maxPerDomain: 2,
      freshnessRequired,
    }
  );

  if (registryResources.length >= Math.min(3, maxSources)) {
    return {
      normalizedQuery,
      strategy: "registry_first",
      resources: registryResources,
    };
  }

  const fallbackQueries = buildFallbackSearchQueries(normalizedQuery);
  const searchCandidates: ResourceCandidate[] = [];

  for (const query of fallbackQueries) {
    const results = await searchResourceCandidates(query, 5, {
      freshnessRequired,
    });
    searchCandidates.push(...results);
  }

  const combined = [...registryResources, ...searchCandidates];

  return {
    normalizedQuery,
    strategy: registryResources.length > 0 ? "mixed" : "search_fallback",
    resources: rankResourceCandidates(normalizedQuery, combined, {
      maxSources,
      minScore: 25,
      memoryHints,
      maxPerDomain: 2,
      freshnessRequired,
    }),
  };
}
'''


SEARCH_PROVIDER_TEST_TS = r'''
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchResourceCandidates } from "../search-provider.js";
import type { SearchProvider } from "../search-providers/types.js";

function provider(name: "firecrawl" | "tavily" | "github", url: string): SearchProvider {
  return {
    name,
    isConfigured: () => true,
    search: vi.fn(async () => [
      {
        title: `${name} result`,
        url,
        tier: "unknown",
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
'''


ENV_EXAMPLE = r'''
# Scout local environment

# Existing / optional
FIRECRAWL_API_KEY=

# Main web search provider
TAVILY_API_KEY=

# GitHub repository search.
# Fine-grained PAT is okay. For public repository search, no repo write permissions are needed.
GITHUB_TOKEN=

# Do not use Brave for now.
# BRAVE_SEARCH_API_KEY=
'''


def update_package_exports() -> None:
    path = ROOT / "packages/knowledge/package.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    exports = data.setdefault("exports", {})

    exports["./research/search-providers"] = "./src/research/search-providers/index.js"
    exports["./research/search-providers.js"] = "./src/research/search-providers/index.js"

    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print("updated packages/knowledge/package.json")


def update_index_exports() -> None:
    path = "packages/knowledge/src/index.ts"
    text = read(path)

    line = 'export * from "./research/search-providers/index.js";'
    if line not in text:
        text = text.rstrip() + "\n" + line + "\n"

    write(path, text)


def update_env_example() -> None:
    path = ROOT / ".env.example"

    if not path.exists():
        path.write_text(ENV_EXAMPLE.strip() + "\n", encoding="utf-8")
        print("wrote .env.example")
        return

    text = path.read_text(encoding="utf-8")

    additions = []
    for key in ["FIRECRAWL_API_KEY", "TAVILY_API_KEY", "GITHUB_TOKEN"]:
        if key not in text:
            additions.append(f"{key}=")

    if "BRAVE_SEARCH_API_KEY" not in text:
        additions.append("# BRAVE_SEARCH_API_KEY=")

    if additions:
        text = text.rstrip() + "\n\n# Search providers\n" + "\n".join(additions) + "\n"
        path.write_text(text, encoding="utf-8")
        print("updated .env.example")


def update_readme() -> None:
    path = ROOT / "README.md"
    if not path.exists():
        return

    text = path.read_text(encoding="utf-8")
    if "Multi-provider search" in text:
        return

    section = '''
---

## Multi-provider search

Scout can search through multiple providers when API keys are configured:

```text
FIRECRAWL_API_KEY
TAVILY_API_KEY
GITHUB_TOKEN
```

Provider behavior:

| Provider | Used for |
| --- | --- |
| Firecrawl | Existing general web search fallback |
| Tavily | Main web search provider |
| GitHub | Repository discovery for SDKs, clients, examples, and implementation references |

Brave Search is intentionally not used for now.

Search providers are optional. Scout uses whatever is configured and deduplicates URLs across providers before ranking.
'''
    marker = "\n## Roadmap\n"
    if marker in text:
        text = text.replace(marker, section + marker)
    else:
        text = text.rstrip() + "\n" + section + "\n"

    path.write_text(text, encoding="utf-8")
    print("updated README.md")


def update_todo() -> None:
    path = ROOT / "docs/TODO.md"
    text = path.read_text(encoding="utf-8") if path.exists() else "# Scout TODO\n"
    append = '''
## Done in v2 Slice 11

- [x] Added multi-provider search abstraction without Brave.
- [x] Added Firecrawl, Tavily, and GitHub search providers.
- [x] Added provider-level tests with mocked fetch.
- [x] Deduped URLs across providers.
- [x] Passed freshness intent into providers.
- [x] Added `.env.example` entries for Firecrawl, Tavily, and GitHub.

## Now

### Provider quality

- [ ] Run `npm run typecheck:knowledge`.
- [ ] Run `npm run test:knowledge`.
- [ ] Run smoke test with Tavily only.
- [ ] Run smoke test with GitHub token for SDK/repository queries.
- [ ] Run smoke test with Firecrawl + Tavily together if Firecrawl key is available.
- [ ] Tune provider budgets after observing real results.
'''
    if "Done in v2 Slice 11" not in text:
        text = text.rstrip() + "\n\n" + append.strip() + "\n"
    path.write_text(text, encoding="utf-8")
    print("updated docs/TODO.md")


def update_lessons() -> None:
    path = ROOT / "docs/LESSONS.md"
    text = path.read_text(encoding="utf-8") if path.exists() else "# Scout Lessons\n"
    append = '''
## Research Engine v2 Slice 11

- Search providers should be adapters, not core ranking logic.
- Provider failures should be isolated with Promise.allSettled so one bad provider does not kill a research run.
- GitHub search is valuable for implementation questions, but it should not run for every general web query.
- Provider dedupe should happen before ranking to avoid over-counting the same URL.
- Do not add paid providers if they are not needed; Tavily + GitHub + existing Firecrawl is enough for now.
'''
    if "Research Engine v2 Slice 11" not in text:
        text = text.rstrip() + "\n\n" + append.strip() + "\n"
    path.write_text(text, encoding="utf-8")
    print("updated docs/LESSONS.md")


def main() -> None:
    assert_repo_root()

    write("packages/knowledge/src/research/search-providers/types.ts", TYPES_TS)
    write("packages/knowledge/src/research/search-providers/utils.ts", UTILS_TS)
    write("packages/knowledge/src/research/search-providers/firecrawl.provider.ts", FIRECRAWL_PROVIDER_TS)
    write("packages/knowledge/src/research/search-providers/tavily.provider.ts", TAVILY_PROVIDER_TS)
    write("packages/knowledge/src/research/search-providers/github.provider.ts", GITHUB_PROVIDER_TS)
    write("packages/knowledge/src/research/search-providers/index.ts", PROVIDERS_INDEX_TS)
    write("packages/knowledge/src/research/search-provider.ts", SEARCH_PROVIDER_TS)
    write("packages/knowledge/src/research/resource-planner.ts", RESOURCE_PLANNER_TS)
    write("packages/knowledge/src/research/__tests__/search-provider.test.ts", SEARCH_PROVIDER_TEST_TS)

    update_package_exports()
    update_index_exports()
    update_env_example()
    update_readme()
    update_todo()
    update_lessons()

    print("\nDone.")
    print("\nNext commands:")
    print("  npm run typecheck:knowledge")
    print("  npm run test:knowledge")
    print("\nEnv vars:")
    print("  FIRECRAWL_API_KEY=...  # optional/existing")
    print("  TAVILY_API_KEY=...     # main web search")
    print("  GITHUB_TOKEN=...       # repo/sdk search")
    print("\nNo Brave key is needed or used.")


if __name__ == "__main__":
    main()
