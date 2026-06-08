import { DOC_REGISTRY } from "../registry/doc-registry.js";
import type { RankedResource, ResourceCandidate } from "./source-types.js";
import { buildFallbackSearchQueries, normalizeResearchQuery } from "./query-builder.js";
import { rankResourceCandidates } from "./source-ranker.js";
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

  const registryResources = rankResourceCandidates(
    normalizedQuery,
    DOC_REGISTRY,
    {
      maxSources,
      minScore: 45,
      memoryHints,
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
    const results = await searchResourceCandidates(query, 5);
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
    }),
  };
}
