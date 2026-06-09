import type { ResourceCandidate } from "../source-types.js";

export type SearchProviderName =
  | "firecrawl"
  | "tavily"
  | "github";

export type SearchProviderInput = {
  query: string;
  limit: number;
  freshnessRequired?: boolean;
};

export type SearchProviderResult = ResourceCandidate & {
  metadata?: Record<string, unknown> & {
    provider?: SearchProviderName;
  };
};

export type SearchProvider = {
  name: SearchProviderName;
  isConfigured(): boolean;
  search(input: SearchProviderInput): Promise<SearchProviderResult[]>;
};
