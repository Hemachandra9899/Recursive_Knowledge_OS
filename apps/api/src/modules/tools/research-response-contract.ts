import type {
  CrawlTrace,
  EvidencePack,
  GroundingAudit,
  SynthesizedAnswer,
} from "@rlm-forge/knowledge";

type RawOrchestratorOutput = {
  status: string;
  query: string;
  normalizedQuery: string;
  subqueries: Array<{ query: string; reason: string; priority: number }>;
  plan?: unknown;
  resourcesPlanned: Array<{
    title: string;
    url: string;
    tier: string;
    score: number;
    source?: string;
    reason: string;
    matchedBy?: string[];
  }>;
  memories?: { retrieved: number; written: number; usedForRanking: number; planned?: Record<string, number> };
  documents: Array<Record<string, unknown>>;
  failedCrawls: Array<{ title?: string; url?: string; reason: string }>;
  skippedCrawls: Array<{ title: string; url: string; reason: string }>;
  crawlTrace: CrawlTrace;
  evidencePack: EvidencePack;
  answer: SynthesizedAnswer;
};

export type RawContractFields = RawOrchestratorOutput;

export type ResearchResponseContract = RawOrchestratorOutput & {
  contractVersion: "research-response-v1";
  ui: {
    answerMarkdown: string;
    citations: SynthesizedAnswer["citations"];
    confidence: number;
    answerMode: string;
    groundingStatus: GroundingAudit["status"];
    groundingIssues: string[];
    evidenceCoverage: EvidencePack["coverage"];
    crawlTrace: CrawlTrace;
    skippedCrawls: Array<{
      title: string;
      url: string;
      reason: string;
    }>;
    resources: Array<{
      title: string;
      url: string;
      tier: string;
      score: number;
    }>;
    warnings: string[];
  };
  debug: {
    search: Record<string, unknown>;
    crawl: Record<string, unknown>;
    evidence: {
      rawClaimCount: number;
      filteredClaimCount: number;
      qualityRejected: number;
      duplicateRejected: number;
    };
    answer: {
      status: string;
      mode: string;
      usedEvidenceCount: number;
      supportedEvidenceCount: number;
      weakEvidenceCount: number;
      omittedUnsupportedCount: number;
      groundingAudit: GroundingAudit;
    };
    memories: Record<string, unknown>;
  };
};

export function buildResearchResponse(
  raw: RawOrchestratorOutput
): ResearchResponseContract {
  const { evidencePack, answer, crawlTrace, skippedCrawls, resourcesPlanned, memories } = raw;

  const warnings: string[] = [];

  if (raw.failedCrawls && raw.failedCrawls.length > 0) {
    warnings.push(`${raw.failedCrawls.length} source(s) failed to crawl`);
  }

  if (skippedCrawls && skippedCrawls.length > 0) {
    warnings.push(`${skippedCrawls.length} page(s) skipped by quality gate`);
  }

  if (answer.status !== "answered") {
    warnings.push(`Answer status: ${answer.status}`);
  }

  if (evidencePack.coverage.filteredClaimCount === 0) {
    warnings.push("No evidence claims passed quality filtering");
  }

  return {
    ...raw,
    contractVersion: "research-response-v1",
    ui: {
      answerMarkdown: answer.markdown,
      citations: answer.citations,
      confidence: answer.confidence,
      answerMode: answer.mode,
      groundingStatus: answer.groundingAudit.status,
      groundingIssues: answer.groundingAudit.issues,
      evidenceCoverage: evidencePack.coverage,
      crawlTrace,
      skippedCrawls: skippedCrawls.map((s) => ({
        title: s.title,
        url: s.url,
        reason: s.reason,
      })),
      resources: resourcesPlanned.map((r) => ({
        title: r.title,
        url: r.url,
        tier: r.tier,
        score: r.score,
      })),
      warnings,
    },
    debug: {
      search: {
        query: raw.query,
        normalizedQuery: raw.normalizedQuery,
        subqueries: raw.subqueries,
        plan: raw.plan,
      },
      crawl: {
        crawlTrace,
        failedCrawls: raw.failedCrawls,
        documents: raw.documents,
      },
      evidence: {
        rawClaimCount: evidencePack.coverage.rawClaimCount,
        filteredClaimCount: evidencePack.coverage.filteredClaimCount,
        qualityRejected: evidencePack.coverage.qualityRejectedClaimCount,
        duplicateRejected: evidencePack.coverage.duplicateRejectedClaimCount,
      },
      answer: {
        status: answer.status,
        mode: answer.mode,
        usedEvidenceCount: answer.usedEvidenceCount,
        supportedEvidenceCount: answer.supportedEvidenceCount,
        weakEvidenceCount: answer.weakEvidenceCount,
        omittedUnsupportedCount: answer.omittedUnsupportedCount,
        groundingAudit: answer.groundingAudit,
      },
      memories: memories ?? {},
    },
  };
}
