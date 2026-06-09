import { describe, expect, it } from "vitest";
import { extractEvidenceFromPage } from "../evidence-extractor.js";

describe("extractEvidenceFromPage", () => {
  it("extracts claim-level evidence from markdown sections", () => {
    const evidence = extractEvidenceFromPage({
      title: "API Auth Docs",
      url: "https://docs.example.com/auth",
      markdown: `
# Authentication

The API requires OAuth access tokens for authenticated requests.
Short line.

## Rate limits

The API supports rate limits that apply per project and per account.
      `,
      tier: "official_docs",
      reason: "Official docs",
      product: "Example API",
      domain: "docs.example.com",
    });

    expect(evidence.length).toBeGreaterThanOrEqual(2);
    expect(evidence[0]).toMatchObject({
      title: "API Auth Docs",
      url: "https://docs.example.com/auth",
      tier: "official_docs",
    });
    expect(evidence.some((item) => item.claim.includes("OAuth access tokens"))).toBe(true);
  });

  it("returns empty evidence when no claim-like text exists", () => {
    const evidence = extractEvidenceFromPage({
      title: "Empty",
      url: "https://docs.example.com/empty",
      markdown: "# Welcome\n\nHome\nNext\nPrevious",
      tier: "official_docs",
      reason: "Official docs",
    });

    expect(evidence).toEqual([]);
  });
});
