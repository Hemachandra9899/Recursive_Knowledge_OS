#!/usr/bin/env python3
# Apply Scout Research Engine v2 Step 11:
# Source freshness + diversity scoring.
#
# Run from Scout repo root on main.
#
# This patch:
# - Adds publishedAt + metadata fields to ResourceCandidate.
# - Captures published dates from search provider responses when available.
# - Adds freshness scoring to source-ranker.
# - Adds bounded per-domain diversity selection.
# - Adds tests for freshness and diversity behavior.
# - Updates TODO and LESSONS.
#
# After applying:
#   npm run typecheck:knowledge
#   npm run test:knowledge

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
        "packages/knowledge/src/research/source-types.ts",
        "packages/knowledge/src/research/source-ranker.ts",
        "packages/knowledge/src/research/search-provider.ts",
        "packages/knowledge/src/research/resource-planner.ts",
    ]
    missing = [p for p in required if not (ROOT / p).exists()]
    if missing:
        raise SystemExit(
            "Run this script from Scout repo root. Missing:\n"
            + "\n".join(f"- {p}" for p in missing)
        )


SOURCE_TYPES_TS = r'''
export type SourceTier =
  | "official_docs"
  | "trusted_docs"
  | "reference_examples"
  | "community"
  | "media"
  | "unknown";

export type SourceUseCase =
  | "api_facts"
  | "comparison"
  | "implementation_help"
  | "tutorial"
  | "general_research";

export type ResourceCandidate = {
  title: string;
  url: string;
  product?: string;
  domain?: string;
  tier: SourceTier;
  topics?: string[];
  keywords?: string[];
  reason: string;
  source: "registry" | "web_search" | "user_url";

  /**
   * Optional publication/update time surfaced by a search provider.
   * Used only as a ranking hint; official docs without dates are not penalized heavily.
   */
  publishedAt?: string;

  metadata?: Record<string, unknown>;
};

export type RankedResource = ResourceCandidate & {
  score: number;
  matchedBy: string[];
};

export type EvidenceItem = {
  claim: string;
  quote: string;
  title: string;
  url: string;
  section?: string;
  product?: string;
  domain?: string;
  tier: SourceTier;
  confidence: number;
  entities: string[];
  reason: string;
  text?: string;
  metadata?: Record<string, unknown>;
};

export type CitationVerificationStatus =
  | "supported"
  | "weak"
  | "unsupported";

export type CitationVerification = {
  status: CitationVerificationStatus;
  claim: string;
  supportingUrls: string[];
  reason: string;
};

export type EvidencePack = {
  query: string;
  useCase: SourceUseCase;
  resourcesPlanned: RankedResource[];
  evidence: EvidenceItem[];
  citationVerification: CitationVerification[];
  coverage: {
    hasEvidence: boolean;
    sourceCount: number;
    claimCount: number;
    uniqueSourceCount: number;
    officialSourceCount: number;
    supportedClaimCount: number;
    weakClaimCount: number;
    unsupportedClaimCount: number;
    missing: string[];
  };
};

export type AnswerCitation = {
  id: number;
  title: string;
  url: string;
  tier: SourceTier;
  usedClaims: number;
};

export type AnswerMode =
  | "comparison"
  | "how_to"
  | "research_summary"
  | "general";

export type SynthesizedAnswer = {
  status: "answered" | "partial" | "insufficient_evidence";
  mode: AnswerMode;
  markdown: string;
  citations: AnswerCitation[];
  usedEvidenceCount: number;
  supportedEvidenceCount: number;
  weakEvidenceCount: number;
  omittedUnsupportedCount: number;
  confidence: number;
};
'''


SOURCE_RANKER_TS = r'''
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
'''


SEARCH_PROVIDER_TS = r'''
import type { ResourceCandidate } from "./source-types.js";
import { inferTierFromUrl } from "./source-ranker.js";

function getFirecrawlApiKey() {
  return process.env.FIRECRAWL_API_KEY || "";
}

function pickUrl(row: any): string {
  return row?.url || row?.metadata?.sourceURL || "";
}

function pickPublishedAt(row: any): string | undefined {
  return (
    row?.publishedAt ||
    row?.published_at ||
    row?.date ||
    row?.updatedAt ||
    row?.updated_at ||
    row?.metadata?.publishedAt ||
    row?.metadata?.published_at ||
    row?.metadata?.date ||
    row?.metadata?.updatedAt ||
    row?.metadata?.updated_at
  );
}

export async function searchResourceCandidates(
  query: string,
  limit = 5
): Promise<ResourceCandidate[]> {
  const apiKey = getFirecrawlApiKey();

  if (!apiKey) return [];

  const response = await fetch("https://api.firecrawl.dev/v1/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      limit,
    }),
  });

  if (!response.ok) {
    return [];
  }

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
        title: row?.title || url,
        url,
        tier: inferTierFromUrl(url),
        topics: [],
        keywords: [],
        reason: "Discovered by web search fallback.",
        source: "web_search" as const,
        publishedAt: pickPublishedAt(row),
        metadata: {
          provider: "firecrawl",
          description: row?.description,
          rawScore: row?.score,
        },
      };
    })
    .filter(Boolean) as ResourceCandidate[];
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
      maxPerDomain: 2,
      freshnessRequired,
    }),
  };
}
'''


SOURCE_RANKER_TEST_TS = r'''
import { describe, expect, it } from "vitest";
import {
  isFreshnessRequired,
  rankResourceCandidates,
} from "../source-ranker.js";
import type { ResourceCandidate } from "../source-types.js";

function candidate(overrides: Partial<ResourceCandidate> = {}): ResourceCandidate {
  return {
    title: "Example API Docs",
    url: "https://docs.example.com/page",
    tier: "unknown",
    source: "web_search",
    reason: "Search result",
    topics: ["api"],
    keywords: ["api"],
    ...overrides,
  };
}

describe("source freshness scoring", () => {
  it("detects freshness-sensitive queries", () => {
    expect(isFreshnessRequired("latest API rate limits")).toBe(true);
    expect(isFreshnessRequired("compare authentication methods")).toBe(false);
  });

  it("boosts recent sources for freshness-sensitive queries", () => {
    const ranked = rankResourceCandidates(
      "latest API rate limits",
      [
        candidate({
          title: "Recent API Docs",
          url: "https://docs.example.com/recent",
          publishedAt: new Date().toISOString(),
        }),
        candidate({
          title: "Old API Docs",
          url: "https://docs.example.com/old",
          publishedAt: "2019-01-01",
        }),
      ],
      {
        maxSources: 2,
        minScore: 0,
      }
    );

    expect(ranked[0].title).toBe("Recent API Docs");
    expect(ranked[0].matchedBy.some((item) => item.includes("freshness:published_recent"))).toBe(true);
    expect(ranked[1].matchedBy.some((item) => item.includes("freshness:published_old"))).toBe(true);
  });

  it("penalizes deprecated sources", () => {
    const [ranked] = rankResourceCandidates(
      "api auth",
      [
        candidate({
          title: "Deprecated legacy API Docs",
          url: "https://docs.example.com/legacy",
        }),
      ],
      {
        maxSources: 1,
        minScore: 0,
      }
    );

    expect(ranked.matchedBy).toContain("freshness:deprecated:-24");
  });
});

describe("source diversity selection", () => {
  it("limits same-domain dominance before filling remaining slots", () => {
    const ranked = rankResourceCandidates(
      "api authentication",
      [
        candidate({
          title: "Docs 1",
          url: "https://docs.example.com/a",
          tier: "official_docs",
          source: "registry",
        }),
        candidate({
          title: "Docs 2",
          url: "https://docs.example.com/b",
          tier: "official_docs",
          source: "registry",
        }),
        candidate({
          title: "Docs 3",
          url: "https://docs.example.com/c",
          tier: "official_docs",
          source: "registry",
        }),
        candidate({
          title: "Other Docs",
          url: "https://docs.other.com/a",
          tier: "trusted_docs",
          source: "web_search",
        }),
      ],
      {
        maxSources: 3,
        minScore: 0,
        maxPerDomain: 2,
      }
    );

    const hosts = ranked.map((item) => new URL(item.url).hostname);
    expect(hosts.filter((host) => host === "docs.example.com")).toHaveLength(2);
    expect(hosts).toContain("docs.other.com");
  });
});
'''


def update_index_exports() -> None:
    path = "packages/knowledge/src/index.ts"
    text = read(path)

    line = 'export { isFreshnessRequired } from "./research/source-ranker.js";'
    if line not in text:
        text = text.rstrip() + "\n" + line + "\n"

    write(path, text)


def update_todo() -> None:
    path = ROOT / "docs/TODO.md"
    text = path.read_text(encoding="utf-8") if path.exists() else "# Scout TODO\n"
    append = '''
## Done in v2 Slice 10

- [x] Added source freshness scoring.
- [x] Captured provider-published timestamps when search results expose them.
- [x] Penalized deprecated/legacy/archive-like sources.
- [x] Added same-domain diversity selection.
- [x] Added source-ranker tests for freshness and diversity.

## Now

### Search quality

- [ ] Run `npm run typecheck:knowledge`.
- [ ] Run `npm run test:knowledge`.
- [ ] Run a real freshness query smoke test.
- [ ] Tune freshness penalties after observing real search results.
- [ ] Consider source freshness/diversity telemetry in trace output.
'''
    if "Done in v2 Slice 10" not in text:
        text = text.rstrip() + "\n\n" + append.strip() + "\n"
    path.write_text(text, encoding="utf-8")
    print("updated docs/TODO.md")


def update_lessons() -> None:
    path = ROOT / "docs/LESSONS.md"
    text = path.read_text(encoding="utf-8") if path.exists() else "# Scout Lessons\n"
    append = '''
## Research Engine v2 Slice 10

- Freshness is query-dependent. It matters for pricing, rate limits, versions, releases, and deprecations, but should not dominate stable documentation queries.
- Domain diversity should be a selection policy, not a replacement for authority scoring.
- Official docs without publication dates should not be punished heavily.
- Ranking changes need tests because small score changes can silently damage retrieval quality.
'''
    if "Research Engine v2 Slice 10" not in text:
        text = text.rstrip() + "\n\n" + append.strip() + "\n"
    path.write_text(text, encoding="utf-8")
    print("updated docs/LESSONS.md")


def main() -> None:
    assert_repo_root()

    write("packages/knowledge/src/research/source-types.ts", SOURCE_TYPES_TS)
    write("packages/knowledge/src/research/source-ranker.ts", SOURCE_RANKER_TS)
    write("packages/knowledge/src/research/search-provider.ts", SEARCH_PROVIDER_TS)
    write("packages/knowledge/src/research/resource-planner.ts", RESOURCE_PLANNER_TS)
    write("packages/knowledge/src/research/__tests__/source-ranker.test.ts", SOURCE_RANKER_TEST_TS)

    update_index_exports()
    update_todo()
    update_lessons()

    print("\nDone.")
    print("\nNext commands:")
    print("  npm run typecheck:knowledge")
    print("  npm run test:knowledge")
    print("\nSuggested real smoke query:")
    print('  "What are the latest Google Ads API rate limits and authentication requirements?"')
    print("\nNext after green tests: provider abstraction for multi-search sources, not GraphAgent yet.")


if __name__ == "__main__":
    main()
