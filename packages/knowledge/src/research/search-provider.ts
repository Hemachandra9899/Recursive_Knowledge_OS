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
