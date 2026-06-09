import { describe, expect, it } from "vitest";
import { auditAnswer } from "../answer-grounding.js";
import type { AnswerCitation } from "../source-types.js";
import type { EvidenceWithStatus } from "../answer-renderers.js";

function citation(overrides: Partial<AnswerCitation> = {}): AnswerCitation {
  return { id: 1, title: "Example Docs", url: "https://docs.example.com", tier: "official_docs", usedClaims: 2, ...overrides };
}

function row(overrides: Partial<EvidenceWithStatus> = {}): EvidenceWithStatus {
  return {
    item: {
      claim: "Example API requires OAuth tokens.",
      quote: "Example API requires OAuth tokens.",
      title: "Example Docs",
      url: "https://docs.example.com",
      tier: "official_docs",
      confidence: 0.92,
      entities: ["Example API"],
      reason: "Official docs",
    },
    status: "supported",
    score: 80,
    ...overrides,
  };
}

const BASE_MD = `
## Answer

Based on 2 supported claims from 2 sources.

Example API uses OAuth tokens for authentication [1].
Google API also supports OAuth 2.0 credentials [2].

## Evidence notes

1. supported evidence from Example Docs: "Example API requires OAuth tokens."

## Sources

[1] Example Docs — https://docs.example.com
[2] Google Docs — https://docs.google.com
`;

describe("auditAnswer", () => {
  it("passes when all citations are properly grounded", () => {
    const citations = [
      citation({ id: 1, url: "https://docs.example.com" }),
      citation({ id: 2, url: "https://docs.google.com" }),
    ];
    const rows = [
      row({ item: { ...row().item, url: "https://docs.example.com" } }),
      row({ item: { ...row().item, url: "https://docs.google.com", title: "Google Docs", entities: ["Google API"] } }),
    ];

    const audit = auditAnswer(BASE_MD, citations, rows);

    expect(audit.status).toBe("pass");
    expect(audit.citationIdsReferenced).toEqual([1, 2]);
    expect(audit.citationIdsDeclared).toEqual([1, 2]);
    expect(audit.missingCitationIds).toEqual([]);
    expect(audit.unusedCitationIds).toEqual([]);
    expect(audit.groundedClaimCount).toBe(2);
    expect(audit.issueCount).toBe(0);
  });

  it("fails when markdown references undeclared citation IDs", () => {
    const md = `
## Answer

Some claim here [1] and another [99].

## Sources

[1] Example Docs — https://docs.example.com
`;
    const citations = [citation({ id: 1 })];
    const rows = [row()];

    const audit = auditAnswer(md, citations, rows);

    expect(audit.status).toBe("fail");
    expect(audit.missingCitationIds).toEqual([99]);
    expect(audit.issues).toHaveLength(1);
  });

  it("fails when declared citations are unused in body", () => {
    const md = `
## Answer

Only one citation [1].

## Sources

[1] Example Docs — https://docs.example.com
[2] Another Doc — https://docs.another.com
`;
    const citations = [
      citation({ id: 1, url: "https://docs.example.com" }),
      citation({ id: 2, url: "https://docs.another.com", title: "Another Doc" }),
    ];
    const rows = [
      row(),
      row({ item: { ...row().item, url: "https://docs.another.com", title: "Another Doc" } }),
    ];

    const audit = auditAnswer(md, citations, rows);

    expect(audit.status).toBe("fail");
    expect(audit.unusedCitationIds).toEqual([2]);
    expect(audit.issues).toHaveLength(1);
  });

  it("fails when citations do not map back to evidence rows", () => {
    const md = `
## Answer

Some claim [1].

## Sources

[1] Example Docs — https://docs.example.com
`;
    const citations = [citation({ id: 1, url: "https://docs.example.com" })];
    const rows: EvidenceWithStatus[] = [];

    const audit = auditAnswer(md, citations, rows);

    expect(audit.status).toBe("fail");
    expect(audit.issues.some((i) => i.includes("do not map back"))).toBe(true);
  });

  it("warns when answer has evidence rows but no citation markers", () => {
    const md = `
## Answer

Some claim without a citation marker.

## Sources

[1] Example Docs — https://docs.example.com
`;
    const citations = [citation({ id: 1 })];
    const rows = [row()];

    const audit = auditAnswer(md, citations, rows);

    expect(audit.status).toBe("fail");
    expect(audit.issues.some((i) => i.includes("no inline citation markers"))).toBe(
      true
    );
  });

  it("handles empty answer gracefully", () => {
    const audit = auditAnswer("", [], []);

    expect(audit.status).toBe("pass");
    expect(audit.citationIdsReferenced).toEqual([]);
    expect(audit.citationIdsDeclared).toEqual([]);
    expect(audit.groundedClaimCount).toBe(0);
    expect(audit.issueCount).toBe(0);
  });
});
