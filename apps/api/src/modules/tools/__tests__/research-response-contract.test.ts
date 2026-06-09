import { describe, expect, it } from "vitest";
import { buildResearchResponse } from "../research-response-contract.js";
import type { CrawlTrace, EvidencePack, SynthesizedAnswer } from "@rlm-forge/knowledge";

const baseCrawlTrace: CrawlTrace = {
  totalPagesCrawled: 10,
  acceptedPages: 5,
  skippedPages: 3,
  rejectedByQuality: 2,
  rejectedByDuplicateUrl: 1,
  rejectedByDuplicateContent: 0,
  sourcesWithContent: 3,
  sourcesSkipped: 2,
  retryCount: 4,
  resourceTraces: [],
};

const baseCoverage: EvidencePack["coverage"] = {
  hasEvidence: true,
  sourceCount: 5,
  claimCount: 12,
  uniqueSourceCount: 4,
  officialSourceCount: 2,
  supportedClaimCount: 10,
  weakClaimCount: 1,
  unsupportedClaimCount: 1,
  rawClaimCount: 20,
  filteredClaimCount: 12,
  qualityRejectedClaimCount: 3,
  duplicateRejectedClaimCount: 5,
  missing: [],
};

const baseEvidencePack: EvidencePack = {
  query: "test query",
  useCase: "api_facts",
  resourcesPlanned: [],
  evidence: [],
  citationVerification: [],
  coverage: baseCoverage,
};

const baseAnswer: SynthesizedAnswer = {
  status: "answered",
  mode: "how_to",
  markdown: "# Answer\nSome markdown content.",
  citations: [{ id: 1, title: "Source", url: "https://example.com", tier: "official_docs", usedClaims: 3 }],
  usedEvidenceCount: 10,
  supportedEvidenceCount: 9,
  weakEvidenceCount: 1,
  omittedUnsupportedCount: 1,
  confidence: 0.92,
  groundingAudit: {
    status: "pass",
    citationIdsReferenced: [1],
    citationIdsDeclared: [1],
    missingCitationIds: [],
    unusedCitationIds: [],
    unsupportedCitationIds: [],
    groundedClaimCount: 3,
    issueCount: 0,
    issues: [],
  },
};

const baseInput = {
  status: "ok" as const,
  query: "test query",
  normalizedQuery: "test query",
  subqueries: [{ query: "test subquery", reason: "test", priority: 100 }],
  resourcesPlanned: [
    { title: "Doc 1", url: "https://example.com", tier: "official_docs", score: 95, source: "registry", reason: "Official" },
  ],
  documents: [{ documentId: "doc-1", title: "Doc 1", url: "https://example.com", chunksTotal: 5, embeddedChunks: 5, deduped: false }],
  failedCrawls: [],
  skippedCrawls: [],
  crawlTrace: baseCrawlTrace,
  evidencePack: baseEvidencePack,
  answer: baseAnswer,
};

describe("buildResearchResponse", () => {
  it("returns contractVersion research-response-v1", () => {
    const result = buildResearchResponse(baseInput);
    expect(result.contractVersion).toBe("research-response-v1");
  });

  it("preserves raw output fields at top level", () => {
    const result = buildResearchResponse(baseInput);
    expect(result.status).toBe("ok");
    expect(result.query).toBe("test query");
    expect(result.evidencePack).toBeDefined();
    expect(result.answer).toBeDefined();
    expect(result.crawlTrace).toBeDefined();
  });

  it("adds contractVersion, ui, debug alongside raw fields", () => {
    const result = buildResearchResponse(baseInput);
    expect(result.contractVersion).toBe("research-response-v1");
    expect(result.ui).toBeDefined();
    expect(result.debug).toBeDefined();
  });

  describe("ui", () => {
    it("includes answerMarkdown from answer.markdown", () => {
      const result = buildResearchResponse(baseInput);
      expect(result.ui.answerMarkdown).toBe(baseAnswer.markdown);
    });

    it("includes citations from answer.citations", () => {
      const result = buildResearchResponse(baseInput);
      expect(result.ui.citations).toEqual(baseAnswer.citations);
    });

    it("includes confidence from answer.confidence", () => {
      const result = buildResearchResponse(baseInput);
      expect(result.ui.confidence).toBe(0.92);
    });

    it("includes answerMode from answer.mode", () => {
      const result = buildResearchResponse(baseInput);
      expect(result.ui.answerMode).toBe("how_to");
    });

    it("includes groundingStatus from answer.groundingAudit.status", () => {
      const result = buildResearchResponse(baseInput);
      expect(result.ui.groundingStatus).toBe("pass");
    });

    it("includes groundingIssues from answer.groundingAudit.issues", () => {
      const result = buildResearchResponse(baseInput);
      expect(result.ui.groundingIssues).toEqual([]);
    });

    it("includes evidenceCoverage from evidencePack.coverage", () => {
      const result = buildResearchResponse(baseInput);
      expect(result.ui.evidenceCoverage).toEqual(baseCoverage);
    });

    it("includes crawlTrace", () => {
      const result = buildResearchResponse(baseInput);
      expect(result.ui.crawlTrace).toEqual(baseCrawlTrace);
    });

    it("includes resources mapped from resourcesPlanned", () => {
      const result = buildResearchResponse(baseInput);
      expect(result.ui.resources).toEqual([
        { title: "Doc 1", url: "https://example.com", tier: "official_docs", score: 95 },
      ]);
    });

    it("generates warnings when there are failed crawls", () => {
      const input = {
        ...baseInput,
        failedCrawls: [{ title: "Failed", url: "https://fail.com", reason: "Timeout" }],
      };
      const result = buildResearchResponse(input);
      expect(result.ui.warnings).toContain("1 source(s) failed to crawl");
    });

    it("generates warnings when there are skipped crawls", () => {
      const input = {
        ...baseInput,
        skippedCrawls: [{ title: "Skipped", url: "https://skip.com", reason: "Low quality", quality: { status: "reject" as const, score: 10, wordCount: 0, charCount: 0, uniqueWordRatio: 0, linkLikeLineRatio: 0, headingCount: 0, codeBlockCount: 0, flags: [] } }],
      };
      const result = buildResearchResponse(input);
      expect(result.ui.warnings).toContain("1 page(s) skipped by quality gate");
    });

    it("generates warning when answer status is not 'answered'", () => {
      const input = {
        ...baseInput,
        answer: { ...baseAnswer, status: "partial" as const },
      };
      const result = buildResearchResponse(input);
      expect(result.ui.warnings).toContain("Answer status: partial");
    });

    it("generates warning when filteredClaimCount is 0", () => {
      const input = {
        ...baseInput,
        evidencePack: {
          ...baseEvidencePack,
          coverage: { ...baseCoverage, filteredClaimCount: 0 },
        },
      };
      const result = buildResearchResponse(input);
      expect(result.ui.warnings).toContain("No evidence claims passed quality filtering");
    });
  });

  describe("debug", () => {
    it("includes search section with query, subqueries, and plan", () => {
      const result = buildResearchResponse(baseInput);
      expect(result.debug.search).toMatchObject({
        query: "test query",
        normalizedQuery: "test query",
        subqueries: [{ query: "test subquery", reason: "test", priority: 100 }],
      });
    });

    it("includes crawl section with crawlTrace and documents", () => {
      const result = buildResearchResponse(baseInput);
      expect(result.debug.crawl).toMatchObject({
        crawlTrace: baseCrawlTrace,
        documents: baseInput.documents,
      });
    });

    it("includes evidence section with claim counts", () => {
      const result = buildResearchResponse(baseInput);
      expect(result.debug.evidence).toEqual({
        rawClaimCount: 20,
        filteredClaimCount: 12,
        qualityRejected: 3,
        duplicateRejected: 5,
      });
    });

    it("includes answer section with status, mode, and groundingAudit", () => {
      const result = buildResearchResponse(baseInput);
      expect(result.debug.answer).toMatchObject({
        status: "answered",
        mode: "how_to",
        groundingAudit: { status: "pass" },
      });
    });

    it("includes memories section", () => {
      const result = buildResearchResponse(baseInput);
      expect(result.debug.memories).toBeDefined();
    });
  });
});
