import { describe, expect, it } from "vitest";
import { verifyEvidenceClaims } from "../citation-verifier.js";
import type { EvidenceItem } from "../source-types.js";

function item(overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    claim: "The API requires OAuth access tokens for authenticated requests.",
    quote: "The API requires OAuth access tokens for authenticated requests.",
    title: "Official Docs",
    url: "https://docs.example.com/auth",
    tier: "official_docs",
    confidence: 0.92,
    entities: ["OAuth"],
    reason: "Official docs",
    ...overrides,
  };
}

describe("verifyEvidenceClaims", () => {
  it("marks strong quote-backed evidence as supported", () => {
    const [result] = verifyEvidenceClaims([item()]);
    expect(result.status).toBe("supported");
    expect(result.supportingUrls).toEqual(["https://docs.example.com/auth"]);
  });

  it("marks moderate evidence as weak", () => {
    const [result] = verifyEvidenceClaims([
      item({ tier: "community", confidence: 0.58 }),
    ]);
    expect(result.status).toBe("weak");
  });

  it("marks missing quote as unsupported", () => {
    const [result] = verifyEvidenceClaims([item({ quote: "" })]);
    expect(result.status).toBe("unsupported");
  });
});
