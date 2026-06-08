import type {
  EvidenceItem,
  EvidencePack,
  RankedResource,
  SourceUseCase,
} from "./source-types.js";
import { inferSourceUseCase } from "./query-builder.js";
import { verifyEvidenceClaims } from "./citation-verifier.js";

function isOfficial(tier: string) {
  return tier === "official_docs" || tier === "trusted_docs";
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function buildEvidencePack(input: {
  query: string;
  resourcesPlanned: RankedResource[];
  evidence: EvidenceItem[];
}): EvidencePack {
  const useCase: SourceUseCase = inferSourceUseCase(input.query);
  const citationVerification = verifyEvidenceClaims(input.evidence);

  const uniqueSourceUrls = unique(input.evidence.map((item) => item.url));
  const officialSourceUrls = unique(
    input.evidence
      .filter((item) => isOfficial(item.tier))
      .map((item) => item.url)
  );

  const supportedClaimCount = citationVerification.filter(
    (item) => item.status === "supported"
  ).length;
  const weakClaimCount = citationVerification.filter(
    (item) => item.status === "weak"
  ).length;
  const unsupportedClaimCount = citationVerification.filter(
    (item) => item.status === "unsupported"
  ).length;

  const missing: string[] = [];

  if (input.evidence.length === 0) {
    missing.push("No claim-level evidence was collected.");
  }

  if (
    (useCase === "api_facts" || useCase === "comparison") &&
    officialSourceUrls.length === 0
  ) {
    missing.push("No official/trusted sources were collected.");
  }

  if (input.evidence.length > 0 && supportedClaimCount === 0) {
    missing.push("Evidence was collected, but no claim passed citation verification.");
  }

  return {
    query: input.query,
    useCase,
    resourcesPlanned: input.resourcesPlanned,
    evidence: input.evidence,
    citationVerification,
    coverage: {
      hasEvidence: input.evidence.length > 0,
      sourceCount: input.evidence.length,
      claimCount: input.evidence.length,
      uniqueSourceCount: uniqueSourceUrls.length,
      officialSourceCount: officialSourceUrls.length,
      supportedClaimCount,
      weakClaimCount,
      unsupportedClaimCount,
      missing,
    },
  };
}
