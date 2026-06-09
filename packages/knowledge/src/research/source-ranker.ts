import type {
  RankedResource,
  ResourceCandidate,
  SourceTier,
  SourceUseCase,
} from "./source-types.js";
import { inferSourceUseCase } from "./query-builder.js";
import {
  scoreResourceWithMemory,
  type ResourceMemoryHint,
} from "./memory-ranking.js";

const OFFICIAL_DOC_DOMAINS = [
  "developers.facebook.com",
  "developers.google.com",
  "business-api.tiktok.com",
  "ads.tiktok.com",
  "platform.openai.com",
  "docs.anthropic.com",
  "docs.api.nvidia.com",
  "qdrant.tech",
  "supabase.com",
  "postgresql.org",
  "redis.io",
  "nextjs.org",
  "tanstack.com",
  "fastify.dev",
  "prisma.io",
  "github.com",
  "learn.microsoft.com",
];

const TRUSTED_DOC_DOMAINS = [
  "support.google.com",
  "business.facebook.com",
  "docs.github.com",
];

const REFERENCE_DOMAINS = ["postman.com", "gitlab.com"];

const COMMUNITY_DOMAINS = [
  "stackoverflow.com",
  "reddit.com",
  "medium.com",
  "dev.to",
  "hashnode.dev",
  "quora.com",
];

const MEDIA_DOMAINS = ["youtube.com", "youtu.be"];

const FRESHNESS_QUERY_PATTERN =
  /\b(latest|current|recent|today|now|new|updated|202[4-9]|version|changelog|release|pricing|rate limit|deprecated|deprecation)\b/i;

const DEPRECATED_SOURCE_PATTERN =
  /\b(deprecated|deprecation|legacy|obsolete|archived|sunset|retired)\b/i;

export function getHostname(url?: string | null): string {
  if (!url) return "";

  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function hostMatches(host: string, domain: string) {
  return host === domain || host.endsWith(`.${domain}`);
}

function matchesAny(host: string, domains: string[]) {
  return domains.some((domain) => hostMatches(host, domain));
}

export function inferTierFromUrl(url?: string | null): SourceTier {
  const host = getHostname(url);

  if (!host) return "unknown";
  if (matchesAny(host, OFFICIAL_DOC_DOMAINS)) return "official_docs";
  if (matchesAny(host, TRUSTED_DOC_DOMAINS)) return "trusted_docs";
  if (matchesAny(host, REFERENCE_DOMAINS)) return "reference_examples";
  if (matchesAny(host, COMMUNITY_DOMAINS)) return "community";
  if (matchesAny(host, MEDIA_DOMAINS)) return "media";

  return "unknown";
}

function tierScore(tier: SourceTier, useCase: SourceUseCase): number {
  const scores: Record<SourceUseCase, Record<SourceTier, number>> = {
    api_facts: {
      official_docs: 100,
      trusted_docs: 75,
      reference_examples: 40,
      community: 20,
      media: 10,
      unknown: 25,
    },
    comparison: {
      official_docs: 100,
      trusted_docs: 75,
      reference_examples: 35,
      community: 15,
      media: 10,
      unknown: 25,
    },
    implementation_help: {
      official_docs: 100,
      trusted_docs: 80,
      reference_examples: 75,
      community: 65,
      media: 35,
      unknown: 35,
    },
    tutorial: {
      official_docs: 100,
      trusted_docs: 80,
      reference_examples: 75,
      community: 60,
      media: 50,
      unknown: 35,
    },
    general_research: {
      official_docs: 100,
      trusted_docs: 75,
      reference_examples: 60,
      community: 45,
      media: 30,
      unknown: 35,
    },
  };

  return scores[useCase][tier];
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9.+#\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function phraseMatch(query: string, phrase: string) {
  return query.toLowerCase().includes(phrase.toLowerCase());
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}${parsed.search}`;
  } catch {
    return url;
  }
}

function parseDate(value?: string): Date | null {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return date;
}

function yearsAgo(date: Date, now = new Date()): number {
  return (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24 * 365);
}

function inferYearFromText(text: string): number | null {
  const matches = text.match(/\b20\d{2}\b/g) ?? [];
  const years = matches
    .map(Number)
    .filter((year) => year >= 2018 && year <= new Date().getFullYear() + 1);

  if (years.length === 0) return null;
  return Math.max(...years);
}

export function isFreshnessRequired(query: string): boolean {
  return FRESHNESS_QUERY_PATTERN.test(query);
}

function scoreFreshness(input: {
  query: string;
  candidate: ResourceCandidate;
  tier: SourceTier;
}): {
  scoreDelta: number;
  matchedBy: string[];
} {
  const matchedBy: string[] = [];
  let scoreDelta = 0;

  const text = `${input.candidate.title} ${input.candidate.url} ${
    input.candidate.reason
  } ${(input.candidate.keywords ?? []).join(" ")}`;

  if (DEPRECATED_SOURCE_PATTERN.test(text)) {
    scoreDelta -= 24;
    matchedBy.push("freshness:deprecated:-24");
  }

  const freshnessRequired = isFreshnessRequired(input.query);
  const publishedAt = parseDate(input.candidate.publishedAt);
  const inferredYear = inferYearFromText(text);

  if (publishedAt) {
    const ageYears = yearsAgo(publishedAt);

    if (ageYears <= 0.75) {
      scoreDelta += freshnessRequired ? 18 : 6;
      matchedBy.push(`freshness:published_recent:+${freshnessRequired ? 18 : 6}`);
    } else if (ageYears <= 2) {
      scoreDelta += freshnessRequired ? 10 : 3;
      matchedBy.push(`freshness:published_moderate:+${freshnessRequired ? 10 : 3}`);
    } else if (freshnessRequired) {
      const penalty = input.tier === "official_docs" ? 8 : 18;
      scoreDelta -= penalty;
      matchedBy.push(`freshness:published_old:-${penalty}`);
    }

    return { scoreDelta, matchedBy };
  }

  if (inferredYear) {
    const currentYear = new Date().getFullYear();
    const yearAge = currentYear - inferredYear;

    if (yearAge <= 1) {
      scoreDelta += freshnessRequired ? 12 : 4;
      matchedBy.push(`freshness:year_recent:${inferredYear}:+${freshnessRequired ? 12 : 4}`);
    } else if (freshnessRequired && yearAge >= 3) {
      const penalty = input.tier === "official_docs" ? 4 : 10;
      scoreDelta -= penalty;
      matchedBy.push(`freshness:year_old:${inferredYear}:-${penalty}`);
    }

    return { scoreDelta, matchedBy };
  }

  if (freshnessRequired && input.tier !== "official_docs" && input.tier !== "trusted_docs") {
    scoreDelta -= 4;
    matchedBy.push("freshness:unknown_date:-4");
  }

  return { scoreDelta, matchedBy };
}

function selectWithDomainDiversity(input: {
  ranked: RankedResource[];
  maxSources: number;
  maxPerDomain: number;
}): RankedResource[] {
  const selected: RankedResource[] = [];
  const deferred: RankedResource[] = [];
  const domainCounts = new Map<string, number>();

  for (const item of input.ranked) {
    const host = getHostname(item.url) || "unknown";
    const currentCount = domainCounts.get(host) ?? 0;

    if (currentCount < input.maxPerDomain) {
      selected.push(item);
      domainCounts.set(host, currentCount + 1);
    } else {
      deferred.push({
        ...item,
        matchedBy: [...item.matchedBy, `diversity:deferred_domain:${host}`],
      });
    }

    if (selected.length >= input.maxSources) return selected;
  }

  for (const item of deferred) {
    if (selected.length >= input.maxSources) break;
    selected.push(item);
  }

  return selected;
}

export function rankResourceCandidates(
  query: string,
  candidates: ResourceCandidate[],
  options?: {
    maxSources?: number;
    minScore?: number;
    memoryHints?: ResourceMemoryHint[];
    maxPerDomain?: number;
    freshnessRequired?: boolean;
  }
): RankedResource[] {
  const useCase = inferSourceUseCase(query);
  const queryTokens = new Set(tokenize(query));
  const maxSources = options?.maxSources ?? 10;
  const minScore = options?.minScore ?? 30;
  const memoryHints = options?.memoryHints ?? [];
  const maxPerDomain = options?.maxPerDomain ?? 2;
  const rankingQuery =
    options?.freshnessRequired === true && !isFreshnessRequired(query)
      ? `${query} latest current`
      : query;

  const ranked = candidates.map((candidate) => {
    const tier = candidate.tier || inferTierFromUrl(candidate.url);
    const matchedBy: string[] = [];
    let score = tierScore(tier, useCase);

    for (const keyword of candidate.keywords || []) {
      if (phraseMatch(query, keyword)) {
        score += 25;
        matchedBy.push(`keyword:${keyword}`);
      }
    }

    for (const topic of candidate.topics || []) {
      if (phraseMatch(query, topic)) {
        score += 15;
        matchedBy.push(`topic:${topic}`);
      }
    }

    for (const token of tokenize(candidate.product || "")) {
      if (queryTokens.has(token)) {
        score += 8;
        matchedBy.push(`product-token:${token}`);
      }
    }

    if (candidate.domain && phraseMatch(query, candidate.domain)) {
      score += 10;
      matchedBy.push(`domain:${candidate.domain}`);
    }

    if (candidate.source === "registry") {
      score += 10;
      matchedBy.push("registry");
    }

    const memoryScore = scoreResourceWithMemory({
      query,
      resource: candidate,
      memoryHints,
    });

    score += memoryScore.scoreDelta;
    matchedBy.push(...memoryScore.matchedBy);

    const freshnessScore = scoreFreshness({
      query: rankingQuery,
      candidate,
      tier,
    });

    score += freshnessScore.scoreDelta;
    matchedBy.push(...freshnessScore.matchedBy);

    return {
      ...candidate,
      tier,
      score,
      matchedBy,
    };
  });

  const deduped: RankedResource[] = [];
  const seen = new Set<string>();

  for (const item of ranked.sort((a, b) => b.score - a.score)) {
    const key = normalizeUrl(item.url);
    if (seen.has(key)) continue;
    if (item.score < minScore) continue;

    seen.add(key);
    deduped.push(item);
  }

  return selectWithDomainDiversity({
    ranked: deduped,
    maxSources,
    maxPerDomain,
  });
}
