import { DOC_REGISTRY, type DocTarget } from "../registry/doc-registry.js";
import { filterAndRankSources } from "./source-quality.js";

export type PlannedResource = DocTarget & {
  matchedScore: number;
  matchedBy: string[];
};

export function normalizeResearchQuery(query: string): string {
  return query
    .replace(/\bmets\s+graph\s+api\b/gi, "Meta Graph API")
    .replace(/\bmeta\s+ads\s+api\b/gi, "Meta Marketing API")
    .replace(/\bfacebook\s+ads\s+api\b/gi, "Meta Marketing API")
    .trim();
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9.+#\s-]/g, " ")
    .split(/\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function phraseMatch(query: string, phrase: string) {
  return query.toLowerCase().includes(phrase.toLowerCase());
}

function scoreTarget(query: string, target: DocTarget): PlannedResource | null {
  const q = query.toLowerCase();
  const queryTokens = new Set(tokenize(query));

  let score = 0;
  const matchedBy: string[] = [];

  for (const keyword of target.keywords) {
    if (phraseMatch(q, keyword)) {
      score += 25;
      matchedBy.push(`keyword:${keyword}`);
    }
  }

  for (const topic of target.topics) {
    if (phraseMatch(q, topic)) {
      score += 15;
      matchedBy.push(`topic:${topic}`);
    }
  }

  for (const token of tokenize(target.product)) {
    if (queryTokens.has(token)) {
      score += 8;
      matchedBy.push(`product-token:${token}`);
    }
  }

  if (phraseMatch(q, target.domain)) {
    score += 10;
    matchedBy.push(`domain:${target.domain}`);
  }

  score += Math.min(target.priority / 10, 10);

  if (matchedBy.length === 0) return null;

  return {
    ...target,
    matchedScore: score,
    matchedBy,
  };
}

export function planResources(query: string, maxResults = 10): PlannedResource[] {
  const normalizedQuery = normalizeResearchQuery(query);

  const matched = DOC_REGISTRY
    .map((target) => scoreTarget(normalizedQuery, target))
    .filter(Boolean) as PlannedResource[];

  const ranked = matched.sort((a, b) => b.matchedScore - a.matchedScore);

  const deduped: PlannedResource[] = [];
  const seen = new Set<string>();

  for (const item of ranked) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    deduped.push(item);
  }

  return filterAndRankSources(deduped, normalizedQuery, {
    minScore: 30,
    maxSources: maxResults,
  });
}

export function hasPlannedResources(query: string) {
  return planResources(query, 1).length > 0;
}
