import { describe, expect, it } from "vitest";
import { synthesizeAnswerFromEvidencePack } from "../answer-synthesizer.js";
import type { EvidencePack } from "../source-types.js";

function pack(): EvidencePack {
  return {
    query: "Compare Meta API and Google API authentication",
    useCase: "comparison",
    resourcesPlanned: [],
    evidence: [
      {
        claim: "Meta API requires OAuth access tokens for authenticated requests.",
        quote: "Meta API requires OAuth access tokens for authenticated requests.",
        title: "Meta Docs",
        url: "https://developers.facebook.com/docs",
        tier: "official_docs",
        confidence: 0.92,
        entities: ["Meta API", "OAuth"],
        product: "Meta API",
        domain: "developers.facebook.com",
        reason: "Official docs",
      },
      {
        claim: "Google API uses OAuth credentials for authenticated requests.",
        quote: "Google API uses OAuth credentials for authenticated requests.",
        title: "Google Docs",
        url: "https://developers.google.com/docs",
        tier: "official_docs",
        confidence: 0.92,
        entities: ["Google API", "OAuth"],
        product: "Google API",
        domain: "developers.google.com",
        reason: "Official docs",
      },
      {
        claim: "Unsupported claim should not appear in answer.",
        quote: "",
        title: "Bad Blog",
        url: "https://blog.example.com",
        tier: "community",
        confidence: 0.2,
        entities: [],
        reason: "Unsupported",
      },
    ],
    citationVerification: [
      {
        status: "supported",
        claim: "Meta API requires OAuth access tokens for authenticated requests.",
        supportingUrls: ["https://developers.facebook.com/docs"],
        reason: "Supported",
      },
      {
        status: "supported",
        claim: "Google API uses OAuth credentials for authenticated requests.",
        supportingUrls: ["https://developers.google.com/docs"],
        reason: "Supported",
      },
      {
        status: "unsupported",
        claim: "Unsupported claim should not appear in answer.",
        supportingUrls: [],
        reason: "Missing quote",
      },
    ],
    coverage: {
      hasEvidence: true,
      sourceCount: 3,
      claimCount: 3,
      uniqueSourceCount: 3,
      officialSourceCount: 2,
      supportedClaimCount: 2,
      weakClaimCount: 0,
      unsupportedClaimCount: 1,
      missing: [],
    },
  };
}

describe("synthesizeAnswerFromEvidencePack", () => {
  it("renders comparison answers and omits unsupported claims", () => {
    const answer = synthesizeAnswerFromEvidencePack({
      query: "Compare Meta API and Google API authentication",
      evidencePack: pack(),
    });

    expect(answer.status).toBe("answered");
    expect(answer.mode).toBe("comparison");
    expect(answer.markdown).toContain("## Comparison table");
    expect(answer.markdown).toContain("Meta API requires OAuth");
    expect(answer.markdown).not.toContain("Unsupported claim should not appear");
    expect(answer.citations).toHaveLength(2);
  });

  it("returns insufficient_evidence when no usable evidence exists", () => {
    const base = pack();
    const emptyPack: EvidencePack = {
      ...base,
      evidence: [],
      citationVerification: [],
      coverage: {
        ...base.coverage,
        hasEvidence: false,
        sourceCount: 0,
        claimCount: 0,
        supportedClaimCount: 0,
        weakClaimCount: 0,
        unsupportedClaimCount: 0,
        missing: ["No claim-level evidence was collected."],
      },
    };

    const answer = synthesizeAnswerFromEvidencePack({
      query: "What is this?",
      evidencePack: emptyPack,
    });

    expect(answer.status).toBe("insufficient_evidence");
    expect(answer.confidence).toBe(0);
  });
});
