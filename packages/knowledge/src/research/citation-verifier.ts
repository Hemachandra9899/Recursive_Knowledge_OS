import type { CitationVerification, EvidenceItem } from "./source-types.js";

function hasUsableQuote(item: EvidenceItem): boolean {
  return Boolean(item.quote?.trim() && item.quote.trim().length >= 20);
}

function hasUsableSource(item: EvidenceItem): boolean {
  return Boolean(item.url?.trim() && /^https?:\/\//i.test(item.url));
}

function isStrongSource(item: EvidenceItem): boolean {
  return item.tier === "official_docs" || item.tier === "trusted_docs";
}

export function verifyEvidenceClaims(
  evidence: EvidenceItem[]
): CitationVerification[] {
  return evidence.map((item) => {
    if (!item.claim?.trim()) {
      return {
        status: "unsupported",
        claim: item.claim || "",
        supportingUrls: [],
        reason: "Missing extracted claim text.",
      };
    }

    if (!hasUsableQuote(item) || !hasUsableSource(item)) {
      return {
        status: "unsupported",
        claim: item.claim,
        supportingUrls: item.url ? [item.url] : [],
        reason: "Missing a usable quote or source URL.",
      };
    }

    if (item.confidence >= 0.75 || (isStrongSource(item) && item.confidence >= 0.7)) {
      return {
        status: "supported",
        claim: item.claim,
        supportingUrls: [item.url],
        reason: "Claim has quote-backed source evidence.",
      };
    }

    if (item.confidence >= 0.55) {
      return {
        status: "weak",
        claim: item.claim,
        supportingUrls: [item.url],
        reason: "Evidence exists, but source confidence is moderate.",
      };
    }

    return {
      status: "unsupported",
      claim: item.claim,
      supportingUrls: [item.url],
      reason: "Evidence confidence is too low for factual synthesis.",
    };
  });
}
