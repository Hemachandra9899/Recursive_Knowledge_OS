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
    const prefix = name.toUpperCase();
    const routeBudget = route[name];
    const envMax = process.env[`${prefix}_MAX_RESULTS`];
    const envEnabled = process.env[`${prefix}_ENABLED`];

    budgets[name] = {
      maxResults: envMax !== undefined && envMax !== ""
        ? envInt(`${prefix}_MAX_RESULTS`, routeBudget.maxResults)
        : routeBudget.maxResults,
      enabled: envEnabled !== undefined && envEnabled !== ""
        ? envBool(`${prefix}_ENABLED`, routeBudget.enabled)
        : routeBudget.enabled,
    };
  }

  return budgets;
}
