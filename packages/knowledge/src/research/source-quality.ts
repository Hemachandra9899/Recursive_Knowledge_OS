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

const REFERENCE_EXAMPLE_DOMAINS = [
  "postman.com",
  "gitlab.com",
];

const COMMUNITY_DOMAINS = [
  "stackoverflow.com",
  "reddit.com",
  "medium.com",
  "dev.to",
  "hashnode.dev",
  "quora.com",
];

const MEDIA_DOMAINS = [
  "youtube.com",
  "youtu.be",
];

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

export function getSourceTier(url?: string | null): SourceTier {
  const host = getHostname(url);

  if (!host) return "unknown";
  if (matchesAny(host, OFFICIAL_DOC_DOMAINS)) return "official_docs";
  if (matchesAny(host, TRUSTED_DOC_DOMAINS)) return "trusted_docs";
  if (matchesAny(host, REFERENCE_EXAMPLE_DOMAINS)) return "reference_examples";
  if (matchesAny(host, COMMUNITY_DOMAINS)) return "community";
  if (matchesAny(host, MEDIA_DOMAINS)) return "media";

  return "unknown";
}

export function inferSourceUseCase(query: string): SourceUseCase {
  const q = query.toLowerCase();

  if (/\b(compare|comparison|vs|versus|difference|matrix)\b/.test(q)) {
    return "comparison";
  }

  if (/\b(api|endpoint|permission|oauth|quota|rate limit|field|pricing|docs|documentation)\b/.test(q)) {
    return "api_facts";
  }

  if (/\b(error|bug|fix|workaround|not working|debug|issue)\b/.test(q)) {
    return "implementation_help";
  }

  if (/\b(how to|tutorial|example|sample|guide)\b/.test(q)) {
    return "tutorial";
  }

  return "general_research";
}

export function sourceScore(url?: string | null, useCase: SourceUseCase = "general_research") {
  const tier = getSourceTier(url);

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

export function filterAndRankSources<
  T extends { url?: string | null; sourceUrl?: string | null },
>(
  sources: T[],
  query: string,
  options?: {
    minScore?: number;
    maxSources?: number;
  },
): T[] {
  const useCase = inferSourceUseCase(query);
  const minScore = options?.minScore ?? 30;
  const maxSources = options?.maxSources ?? 10;

  return [...sources]
    .map((source) => {
      const url = source.url || source.sourceUrl;
      return {
        source,
        score: sourceScore(url, useCase),
      };
    })
    .filter((item) => item.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSources)
    .map((item) => item.source);
}
