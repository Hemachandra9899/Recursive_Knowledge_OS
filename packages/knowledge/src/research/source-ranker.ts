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

export function rankResourceCandidates(
  query: string,
  candidates: ResourceCandidate[],
  options?: {
    maxSources?: number;
    minScore?: number;
    memoryHints?: ResourceMemoryHint[];
  }
): RankedResource[] {
  const useCase = inferSourceUseCase(query);
  const queryTokens = new Set(tokenize(query));
  const maxSources = options?.maxSources ?? 10;
  const minScore = options?.minScore ?? 30;
  const memoryHints = options?.memoryHints ?? [];

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

  return deduped.slice(0, maxSources);
}
