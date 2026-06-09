import type { SearchProviderName } from "./search-providers/types.js";

export type RouteKind = "docs" | "freshness" | "code";

export type ProviderRoute = {
  routeKind: RouteKind;
  routeReason: string;
  selectedProviders: SearchProviderName[];
  freshnessRequired: boolean;
};

const CODE_QUERY_PATTERN =
  /\b(github|repo|repository|sdk|client|library|implementation|readme|open source|oss|typescript|npm|pip|go get|install)\b/i;

const FRESHNESS_QUERY_PATTERN =
  /\b(latest|current|recent|today|now|new|updated|202[4-9]|version|changelog|release|pricing|rate limit|deprecated|deprecation)\b/i;

export function determineProviderRoute(query: string): ProviderRoute {
  if (CODE_QUERY_PATTERN.test(query)) {
    return {
      routeKind: "code",
      routeReason: "Code, SDK, repository, or implementation query.",
      selectedProviders: ["github", "tavily", "firecrawl"],
      freshnessRequired: false,
    };
  }

  if (FRESHNESS_QUERY_PATTERN.test(query)) {
    return {
      routeKind: "freshness",
      routeReason: "Freshness-sensitive query detected (latest, pricing, versions, deprecations).",
      selectedProviders: ["tavily", "firecrawl"],
      freshnessRequired: true,
    };
  }

  return {
    routeKind: "docs",
    routeReason: "General documentation or API reference query.",
    selectedProviders: ["tavily", "firecrawl"],
    freshnessRequired: false,
  };
}
