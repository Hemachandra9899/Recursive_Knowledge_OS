import {
  buildFallbackSearchQueries,
  inferSourceUseCase,
  normalizeResearchQuery,
} from "../research/query-builder.js";
import type { SourceUseCase } from "../research/source-types.js";
import type { AgentContext, AgentResult } from "./types.js";
import { okAgentResult } from "./types.js";

export type PlannedSearchQuery = {
  query: string;
  reason: string;
  priority: number;
};

export type ResearchPlan = {
  originalQuery: string;
  normalizedQuery: string;
  useCase: SourceUseCase;
  entities: string[];
  subqueries: PlannedSearchQuery[];
  needsFreshness: boolean;
  needsOfficialDocs: boolean;
  recommendedMaxSources: number;
  recommendedMaxPagesPerSource: number;
};

function unique(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

function extractSimpleEntities(query: string): string[] {
  const candidates = query.match(/\b[A-Z][A-Za-z0-9.+#-]*(?:\s+[A-Z][A-Za-z0-9.+#-]*){0,4}\b/g);
  return unique(candidates ?? []).slice(0, 12);
}

function needsFreshness(query: string): boolean {
  return /\b(latest|current|today|recent|2025|2026|price|pricing|rate limit|version|changelog|news)\b/i.test(
    query
  );
}

function needsOfficialDocs(useCase: SourceUseCase): boolean {
  return useCase === "api_facts" || useCase === "comparison" || useCase === "implementation_help";
}

export class SearchPlannerAgent {
  plan(context: AgentContext): AgentResult<ResearchPlan> {
    const normalizedQuery = normalizeResearchQuery(context.query);
    const useCase = inferSourceUseCase(normalizedQuery);
    const fallbackQueries = buildFallbackSearchQueries(normalizedQuery);
    const officialDocsRequired = needsOfficialDocs(useCase);

    const subqueries: PlannedSearchQuery[] = fallbackQueries.map((query, index) => ({
      query,
      priority: 100 - index * 10,
      reason:
        index === 0
          ? "Primary query generated from normalized user intent."
          : "Fallback query to improve source coverage.",
    }));

    if (officialDocsRequired) {
      subqueries.unshift({
        query: `${normalizedQuery} official docs`,
        reason: "Official documentation should be preferred for factual/API research.",
        priority: 120,
      });
    }

    if (needsFreshness(normalizedQuery)) {
      subqueries.push({
        query: `${normalizedQuery} latest update changelog`,
        reason: "Freshness-sensitive query for recent changes.",
        priority: 75,
      });
    }

    const plan: ResearchPlan = {
      originalQuery: context.query,
      normalizedQuery,
      useCase,
      entities: extractSimpleEntities(normalizedQuery),
      subqueries: unique(subqueries.map((item) => item.query)).map((query) => {
        const original = subqueries.find((item) => item.query === query);
        return {
          query,
          reason: original?.reason ?? "Deduplicated planned query.",
          priority: original?.priority ?? 50,
        };
      }),
      needsFreshness: needsFreshness(normalizedQuery),
      needsOfficialDocs: officialDocsRequired,
      recommendedMaxSources: officialDocsRequired ? 8 : 6,
      recommendedMaxPagesPerSource: officialDocsRequired ? 5 : 3,
    };

    return okAgentResult("search_planner", plan, {
      subqueryCount: plan.subqueries.length,
    });
  }
}
