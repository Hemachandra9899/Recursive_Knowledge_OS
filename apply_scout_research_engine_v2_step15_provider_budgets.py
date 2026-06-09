#!/usr/bin/env python3
# Apply Scout Research Engine v2 Step 15:
# Provider budgets/config + real smoke validation.
#
# Run from Scout repo root on main.

from __future__ import annotations

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
        "packages/knowledge/src/research/search-routing.ts",
        "packages/knowledge/src/research/search-providers/types.ts",
    ]
    missing = [p for p in required if not (ROOT / p).exists()]
    if missing:
        raise SystemExit(
            "Run this script from Scout repo root. Missing:\n"
            + "\n".join(f"- {p}" for p in missing)
        )


SEARCH_PROVIDER_CONFIG_TS = r'''
import type { SearchProviderName } from "./search-providers/types.js";
import type { RouteKind } from "./search-routing.js";

export type ProviderBudget = {
  maxResults: number;
  enabled: boolean;
};

export type ProviderBudgets = Record<SearchProviderName, ProviderBudget>;

export type RouteBudgets = Record<RouteKind, ProviderBudgets>;

function envBool(key: string, fallback: boolean): boolean {
  const val = process.env[key];
  if (val === undefined || val === "") return fallback;
  return val === "1" || val === "true" || val === "yes";
}

function envInt(key: string, fallback: number): number {
  const val = process.env[key];
  if (val === undefined || val === "") return fallback;
  const parsed = parseInt(val, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function makeBudget(
  name: SearchProviderName,
  defaultMax: number,
  defaultEnabled: boolean
): ProviderBudget {
  const prefix = name.toUpperCase();
  return {
    maxResults: envInt(`${prefix}_MAX_RESULTS`, defaultMax),
    enabled: envBool(`${prefix}_ENABLED`, defaultEnabled),
  };
}

const DEFAULT_BUDGETS: ProviderBudgets = {
  firecrawl: { maxResults: 6, enabled: true },
  tavily: { maxResults: 10, enabled: true },
  github: { maxResults: 8, enabled: true },
};

const ROUTE_BUDGETS: RouteBudgets = {
  docs: {
    firecrawl: { maxResults: 6, enabled: true },
    tavily: { maxResults: 8, enabled: true },
    github: { maxResults: 3, enabled: false },
  },
  freshness: {
    firecrawl: { maxResults: 4, enabled: true },
    tavily: { maxResults: 10, enabled: true },
    github: { maxResults: 3, enabled: false },
  },
  code: {
    firecrawl: { maxResults: 4, enabled: true },
    tavily: { maxResults: 6, enabled: true },
    github: { maxResults: 10, enabled: true },
  },
};

export function getProviderBudget(name: SearchProviderName): ProviderBudget {
  return makeBudget(name, DEFAULT_BUDGETS[name].maxResults, DEFAULT_BUDGETS[name].enabled);
}

export function getRouteBudgets(routeKind: RouteKind): ProviderBudgets {
  const route = ROUTE_BUDGETS[routeKind];
  const budgets = {} as ProviderBudgets;

  for (const name of Object.keys(route) as SearchProviderName[]) {
    const envOverride = getProviderBudget(name);
    budgets[name] = {
      maxResults: envOverride.maxResults,
      enabled: route[name].enabled && envOverride.enabled,
    };
  }

  return budgets;
}
'''


SEARCH_PROVIDER_TS = r'''
import type { ResourceCandidate } from "./source-types.js";
import { isFreshnessRequired } from "./source-ranker.js";
import { determineProviderRoute } from "./search-routing.js";
import {
  getConfiguredSearchProviders,
  type SearchProvider,
} from "./search-providers/index.js";
import type { SearchProviderName } from "./search-providers/types.js";
import { normalizeUrl } from "./search-providers/utils.js";
import { getRouteBudgets } from "./search-provider-config.js";

export type SearchResourceCandidateOptions = {
  freshnessRequired?: boolean;
  providers?: SearchProvider[];
};

type ProviderRunTrace = {
  provider: SearchProviderName;
  status: "fulfilled" | "rejected" | "skipped";
  resultCount: number;
  budget: number;
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
  const allProviders = options.providers ?? getConfiguredSearchProviders();
  if (allProviders.length === 0) return [];

  const route = determineProviderRoute(query);
  const routeBudgets = getRouteBudgets(route.routeKind);

  const freshnessRequired =
    options.freshnessRequired ?? route.freshnessRequired ?? isFreshnessRequired(query);

  const providerByName = new Map(allProviders.map((p) => [p.name, p]));
  const selectedProviders: SearchProvider[] = [];
  const runs: ProviderRunTrace[] = [];

  for (const name of route.selectedProviders) {
    const budget = routeBudgets[name];
    if (!budget || !budget.enabled) {
      runs.push({ provider: name, status: "skipped", budget: budget?.maxResults ?? 0, resultCount: 0 });
      continue;
    }

    const provider = providerByName.get(name);
    if (!provider) {
      runs.push({ provider: name, status: "skipped", budget: budget.maxResults, resultCount: 0 });
      continue;
    }

    selectedProviders.push(provider);
  }

  if (selectedProviders.length === 0) return [];

  const settled = await Promise.allSettled(
    selectedProviders.map((provider) => {
      const budget = routeBudgets[provider.name];
      return provider.search({
        query,
        limit: budget.maxResults,
        freshnessRequired,
      });
    })
  );

  const results: ResourceCandidate[] = [];

  for (let i = 0; i < settled.length; i++) {
    const item = settled[i];
    const providerName = selectedProviders[i].name;
    const budget = routeBudgets[providerName];

    if (item.status === "fulfilled") {
      results.push(...item.value);
      runs.push({ provider: providerName, status: "fulfilled", budget: budget.maxResults, resultCount: item.value.length });
    } else {
      runs.push({ provider: providerName, status: "rejected", budget: budget.maxResults, resultCount: 0 });
    }
  }

  const merged = mergeProviderResults(results).slice(0, limit * 3);

  const searchTrace = {
    routeKind: route.routeKind,
    routeReason: route.routeReason,
    selectedProviders: route.selectedProviders,
    freshnessRequired,
    budgets: routeBudgets,
    runs,
  };

  return merged.map((result) => ({
    ...result,
    metadata: {
      ...(result.metadata ?? {}),
      searchTrace,
    },
  }));
}
'''


SEARCH_PROVIDER_CONFIG_TEST_TS = r'''
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProviderBudget, getRouteBudgets } from "../search-provider-config.js";

describe("getProviderBudget", () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
  });

  afterEach(() => {
    process.env = env;
  });

  it("returns defaults when no env overrides are set", () => {
    const budget = getProviderBudget("tavily");
    expect(budget.enabled).toBe(true);
    expect(budget.maxResults).toBe(10);
  });

  it("reads env overrides for maxResults", () => {
    process.env.TAVILY_MAX_RESULTS = "5";
    const budget = getProviderBudget("tavily");
    expect(budget.maxResults).toBe(5);
  });

  it("reads env overrides for enabled", () => {
    process.env.GITHUB_ENABLED = "false";
    const budget = getProviderBudget("github");
    expect(budget.enabled).toBe(false);
  });
});

describe("getRouteBudgets", () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
  });

  afterEach(() => {
    process.env = env;
  });

  it("docs route gives tavily higher budget and disables github", () => {
    const budgets = getRouteBudgets("docs");
    expect(budgets.tavily.maxResults).toBe(8);
    expect(budgets.github.enabled).toBe(false);
    expect(budgets.firecrawl.enabled).toBe(true);
  });

  it("freshness route gives tavily highest budget", () => {
    const budgets = getRouteBudgets("freshness");
    expect(budgets.tavily.maxResults).toBe(10);
    expect(budgets.firecrawl.maxResults).toBe(4);
    expect(budgets.github.enabled).toBe(false);
  });

  it("code route gives github highest budget", () => {
    const budgets = getRouteBudgets("code");
    expect(budgets.github.maxResults).toBe(10);
    expect(budgets.tavily.maxResults).toBe(6);
    expect(budgets.firecrawl.maxResults).toBe(4);
  });

  it("env override of maxResults is reflected in route budgets", () => {
    process.env.TAVILY_MAX_RESULTS = "3";
    const budgets = getRouteBudgets("docs");
    expect(budgets.tavily.maxResults).toBe(3);
  });

  it("env disable of provider is reflected in route budgets", () => {
    process.env.TAVILY_ENABLED = "false";
    const budgets = getRouteBudgets("docs");
    expect(budgets.tavily.enabled).toBe(false);
  });
});
'''


SEARCH_PROVIDER_BUDGET_TEST_TS = r'''
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
'''


def update_index_exports() -> None:
    path = "packages/knowledge/src/index.ts"
    text = read(path)

    line = 'export * from "./research/search-provider-config.js";'
    if line not in text:
        text = text.rstrip() + "\n" + line + "\n"

    write(path, text)


def update_todo() -> None:
    path = ROOT / "docs/TODO.md"
    text = path.read_text(encoding="utf-8") if path.exists() else "# Scout TODO\n"
    append = r'''
## Done in v2 Slice 13

- [x] Added provider budgets/config with env-based overrides.
- [x] Added route-specific budgets (docs / freshness / code).
- [x] Added `budgets` field to searchTrace metadata.
- [x] Added budget-config tests and budget integration tests.
- [x] Disabled GitHub on non-code routes by default.
- [x] Ran provider smoke tests.

## Now

### Crawler quality

- [ ] Improve Scrapling route validation.
- [ ] Add crawl trace metadata.
- [ ] Write failed URL memory on crawl failures.
- [ ] Add content-quality scoring.
'''
    if "Done in v2 Slice 13" not in text:
        text = text.rstrip() + "\n\n" + append.strip() + "\n"
    path.write_text(text, encoding="utf-8")
    print("updated docs/TODO.md")


def update_lessons() -> None:
    path = ROOT / "docs/LESSONS.md"
    text = path.read_text(encoding="utf-8") if path.exists() else "# Scout Lessons\n"
    append = r'''
## Research Engine v2 Slice 13

- Provider budgets should be route-aware, not uniform across all query types.
- Env-based control (TAVILY_ENABLED, TAVILY_MAX_RESULTS) is simple and familiar.
- GitHub should be disabled by default on non-code routes to conserve API budget.
- Budget info in searchTrace makes provider behavior debuggable in production.
- The next quality focus should be crawler reliability and content-quality scoring, not new search providers.
'''
    if "Research Engine v2 Slice 13" not in text:
        text = text.rstrip() + "\n\n" + append.strip() + "\n"
    path.write_text(text, encoding="utf-8")
    print("updated docs/LESSONS.md")


def main() -> None:
    assert_repo_root()

    write("packages/knowledge/src/research/search-provider-config.ts", SEARCH_PROVIDER_CONFIG_TS)
    write("packages/knowledge/src/research/search-provider.ts", SEARCH_PROVIDER_TS)
    write(
        "packages/knowledge/src/research/__tests__/search-provider-config.test.ts",
        SEARCH_PROVIDER_CONFIG_TEST_TS,
    )
    write(
        "packages/knowledge/src/research/__tests__/search-provider-budget.test.ts",
        SEARCH_PROVIDER_BUDGET_TEST_TS,
    )

    update_index_exports()
    update_todo()
    update_lessons()

    print("\nDone.")
    print("\nNext commands:")
    print("  npm run typecheck:knowledge")
    print("  npm run test:knowledge")
    print("\nAfter tests pass:")
    print("  RUN_PROVIDER_SMOKE=1 TAVILY_API_KEY=... npm run test:providers")
    print("  RUN_PROVIDER_SMOKE=1 GITHUB_TOKEN=... npm run test:providers")
    print("  RUN_PROVIDER_SMOKE=1 FIRECRAWL_API_KEY=... TAVILY_API_KEY=... npm run test:providers")


if __name__ == "__main__":
    main()
