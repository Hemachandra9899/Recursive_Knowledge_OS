import { describe, expect, it } from "vitest";
import { synthesizeAnswerFromEvidencePack } from "../answer-synthesizer.js";
import type { EvidencePack } from "../source-types.js";

function pack(overrides: Partial<EvidencePack> = {}): EvidencePack {
  return {
    query: "How does Example API authentication work?",
    useCase: "api_facts",
    resourcesPlanned: [],
    evidence: [
      {
        claim: "Example API requires OAuth access tokens for authenticated API requests and secure data access.",
        quote: "Example API requires OAuth access tokens for authenticated API requests.",
        title: "Example Auth Docs",
        url: "https://docs.example.com/auth",
        section: "Authentication",
        tier: "official_docs",
        confidence: 0.92,
        entities: ["Example API", "OAuth"],
        reason: "Official docs",
        product: "Example API",
        domain: "docs.example.com",
      },
      {
        claim: "Example API supports rate limiting with configurable thresholds per project and account plan.",
        quote: "Example API supports rate limiting with configurable thresholds per project.",
        title: "Example Rate Limits",
        url: "https://docs.example.com/rate-limits",
        section: "Rate limits",
        tier: "official_docs",
        confidence: 0.9,
        entities: ["Example API"],
        reason: "Official docs",
        product: "Example API",
        domain: "docs.example.com",
      },
    ],
    citationVerification: [
      { status: "supported", claim: "Example API requires OAuth access tokens for authenticated API requests and secure data access.", supportingUrls: ["https://docs.example.com/auth"], reason: "Supported" },
      { status: "supported", claim: "Example API supports rate limiting with configurable thresholds per project and account plan.", supportingUrls: ["https://docs.example.com/rate-limits"], reason: "Supported" },
    ],
    coverage: {
      hasEvidence: true,
      sourceCount: 2,
      claimCount: 2,
      uniqueSourceCount: 2,
      officialSourceCount: 2,
      supportedClaimCount: 2,
      weakClaimCount: 0,
      unsupportedClaimCount: 0,
      rawClaimCount: 2,
      filteredClaimCount: 2,
      qualityRejectedClaimCount: 0,
      duplicateRejectedClaimCount: 0,
      missing: [],
    },
    ...overrides,
  };
}

describe("synthesizeAnswerFromEvidencePack grounding audit", () => {
  it("includes groundingAudit in the answer", () => {
    const answer = synthesizeAnswerFromEvidencePack({
      query: "How does Example API authentication work?",
      evidencePack: pack(),
    });

    expect(answer.groundingAudit).toBeDefined();
    expect(answer.groundingAudit.status).toBe("pass");
  });

  it("passes audit for well-grounded comparison answer", () => {
    const answer = synthesizeAnswerFromEvidencePack({
      query: "Compare Meta API and Google API authentication",
      evidencePack: {
        ...pack(),
        query: "Compare Meta API and Google API authentication",
        useCase: "comparison",
        evidence: [
          {
            claim: "Meta API requires OAuth access tokens for authenticated API requests to their graph endpoints.",
            quote: "Meta API requires OAuth access tokens for authenticated API requests.",
            title: "Meta Docs",
            url: "https://developers.facebook.com/docs",
            section: "Authentication",
            tier: "official_docs",
            confidence: 0.92,
            entities: ["Meta API", "OAuth"],
            reason: "Official docs",
            product: "Meta API",
            domain: "developers.facebook.com",
          },
          {
            claim: "Google API uses OAuth 2.0 credentials for authenticated API requests on their cloud platform.",
            quote: "Google API uses OAuth 2.0 credentials for authenticated API requests.",
            title: "Google Docs",
            url: "https://developers.google.com/docs",
            section: "Authentication",
            tier: "official_docs",
            confidence: 0.92,
            entities: ["Google API", "OAuth 2.0"],
            reason: "Official docs",
            product: "Google API",
            domain: "developers.google.com",
          },
        ],
        citationVerification: [
          { status: "supported", claim: "Meta API requires OAuth access tokens for authenticated API requests to their graph endpoints.", supportingUrls: ["https://developers.facebook.com/docs"], reason: "Supported" },
          { status: "supported", claim: "Google API uses OAuth 2.0 credentials for authenticated API requests on their cloud platform.", supportingUrls: ["https://developers.google.com/docs"], reason: "Supported" },
        ],
        coverage: {
          hasEvidence: true,
          sourceCount: 2,
          claimCount: 2,
          uniqueSourceCount: 2,
          officialSourceCount: 2,
          supportedClaimCount: 2,
          weakClaimCount: 0,
          unsupportedClaimCount: 0,
          rawClaimCount: 2,
          filteredClaimCount: 2,
          qualityRejectedClaimCount: 0,
          duplicateRejectedClaimCount: 0,
          missing: [],
        },
      },
    });

    expect(answer.groundingAudit.status).toBe("pass");
    expect(answer.groundingAudit.citationIdsReferenced.length).toBeGreaterThanOrEqual(
      1
    );
    expect(answer.groundingAudit.issueCount).toBe(0);
  });

  it("includes audit in insufficient_evidence answers", () => {
    const answer = synthesizeAnswerFromEvidencePack({
      query: "What is this?",
      evidencePack: {
        ...pack(),
        evidence: [],
        citationVerification: [],
        coverage: {
          hasEvidence: false,
          sourceCount: 0,
          claimCount: 0,
          uniqueSourceCount: 0,
          officialSourceCount: 0,
          supportedClaimCount: 0,
          weakClaimCount: 0,
          unsupportedClaimCount: 0,
          rawClaimCount: 0,
          filteredClaimCount: 0,
          qualityRejectedClaimCount: 0,
          duplicateRejectedClaimCount: 0,
          missing: ["No claim-level evidence was collected."],
        },
      },
    });

    expect(answer.groundingAudit).toBeDefined();
    expect(answer.groundingAudit.status).toBe("pass");
    expect(answer.groundingAudit.citationIdsReferenced).toEqual([]);
  });
});
