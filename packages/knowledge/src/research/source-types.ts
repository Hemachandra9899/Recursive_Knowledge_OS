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
