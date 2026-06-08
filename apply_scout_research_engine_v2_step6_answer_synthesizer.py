#!/usr/bin/env python3
# Apply Scout Research Engine v2 Step 6: Evidence-based Answer Synthesizer.
#
# Run from Scout repo root on branch:
#   feat/research-engine-v2
#
# This patch adds deterministic answer synthesis directly from EvidencePack:
# - Uses only supported/weak citation-verified evidence.
# - Adds source-numbered markdown citations.
# - Returns answer metadata from ResearchOrchestrator.
# - Keeps unsupported claims out of final answer.
# - Updates exports, TODO, and LESSONS.
#
# No DB migration required.

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path.cwd()


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content.strip() + "\n", encoding="utf-8")
    print(f"wrote {path}")


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def assert_repo_root() -> None:
    required = [
        "package.json",
        "packages/knowledge/src/research/source-types.ts",
        "packages/knowledge/src/research/research-orchestrator.ts",
        "packages/knowledge/src/research/evidence-pack.ts",
    ]
    missing = [p for p in required if not (ROOT / p).exists()]
    if missing:
        raise SystemExit(
            "Run this script from the Scout repo root. Missing:\n"
            + "\n".join(f"- {p}" for p in missing)
        )


SOURCE_TYPES_TS = r'''
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

export type SynthesizedAnswer = {
  status: "answered" | "partial" | "insufficient_evidence";
  markdown: string;
  citations: AnswerCitation[];
  usedEvidenceCount: number;
  supportedEvidenceCount: number;
  weakEvidenceCount: number;
  omittedUnsupportedCount: number;
  confidence: number;
};
'''


ANSWER_SYNTHESIZER_TS = r'''
import type {
  AnswerCitation,
  CitationVerificationStatus,
  EvidenceItem,
  EvidencePack,
  SourceTier,
  SynthesizedAnswer,
} from "./source-types.js";

type EvidenceWithStatus = {
  item: EvidenceItem;
  status: CitationVerificationStatus;
  score: number;
};

function tierWeight(tier: SourceTier): number {
  if (tier === "official_docs") return 30;
  if (tier === "trusted_docs") return 22;
  if (tier === "reference_examples") return 12;
  if (tier === "community") return 4;
  if (tier === "media") return 2;
  return 6;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9.+#\s-]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function scoreEvidence(query: string, item: EvidenceItem, status: CitationVerificationStatus): number {
  const queryTokens = new Set(tokenize(query));
  const itemTokens = new Set(tokenize([item.claim, item.section, item.product, item.domain].filter(Boolean).join(" ")));

  const overlap = [...itemTokens].filter((token) => queryTokens.has(token)).length;
  const statusWeight = status === "supported" ? 40 : status === "weak" ? 12 : -100;

  return statusWeight + item.confidence * 35 + tierWeight(item.tier) + overlap * 3;
}

function evidenceKey(item: EvidenceItem): string {
  return `${item.url}::${item.claim.toLowerCase().replace(/\s+/g, " ").trim()}`;
}

function shorten(text: string, maxChars: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars - 3)}...`;
}

function sourceKey(item: EvidenceItem): string {
  return item.url || `${item.title}:${item.tier}`;
}

function buildCitationMap(evidence: EvidenceItem[]): {
  citationBySource: Map<string, AnswerCitation>;
  citationIdBySource: Map<string, number>;
} {
  const citationBySource = new Map<string, AnswerCitation>();
  const citationIdBySource = new Map<string, number>();

  for (const item of evidence) {
    const key = sourceKey(item);
    const existing = citationBySource.get(key);

    if (existing) {
      existing.usedClaims += 1;
      continue;
    }

    const id = citationBySource.size + 1;
    citationBySource.set(key, {
      id,
      title: item.title,
      url: item.url,
      tier: item.tier,
      usedClaims: 1,
    });
    citationIdBySource.set(key, id);
  }

  return {
    citationBySource,
    citationIdBySource,
  };
}

function statusLabel(status: CitationVerificationStatus): string {
  if (status === "supported") return "supported";
  if (status === "weak") return "weak";
  return "unsupported";
}

function groupEvidenceForAnswer(input: {
  query: string;
  evidencePack: EvidencePack;
  maxClaims: number;
}): EvidenceWithStatus[] {
  const seen = new Set<string>();
  const rows: EvidenceWithStatus[] = [];

  input.evidencePack.evidence.forEach((item, index) => {
    const verification = input.evidencePack.citationVerification[index];
    const status = verification?.status ?? "unsupported";

    if (status === "unsupported") return;

    const key = evidenceKey(item);
    if (seen.has(key)) return;
    seen.add(key);

    rows.push({
      item,
      status,
      score: scoreEvidence(input.query, item, status),
    });
  });

  return rows
    .sort((a, b) => b.score - a.score)
    .slice(0, input.maxClaims);
}

function buildNoEvidenceAnswer(evidencePack: EvidencePack): SynthesizedAnswer {
  const missing = evidencePack.coverage.missing.length
    ? evidencePack.coverage.missing.map((item) => `- ${item}`).join("\n")
    : "- No supported or weak claim-level evidence was available.";

  return {
    status: "insufficient_evidence",
    markdown: [
      "## Answer",
      "",
      "I do not have enough verified evidence to answer this confidently.",
      "",
      "## Evidence gaps",
      "",
      missing,
    ].join("\n"),
    citations: [],
    usedEvidenceCount: 0,
    supportedEvidenceCount: 0,
    weakEvidenceCount: 0,
    omittedUnsupportedCount: evidencePack.coverage.unsupportedClaimCount,
    confidence: 0,
  };
}

function confidenceForAnswer(rows: EvidenceWithStatus[]): number {
  if (rows.length === 0) return 0;

  const supported = rows.filter((row) => row.status === "supported");
  const usable = supported.length > 0 ? supported : rows;

  const avg = usable.reduce((sum, row) => sum + row.item.confidence, 0) / usable.length;
  const supportBoost = supported.length / rows.length;

  return Math.min(0.98, Number((avg * 0.8 + supportBoost * 0.2).toFixed(2)));
}

function buildClaimsMarkdown(input: {
  rows: EvidenceWithStatus[];
  citationIdBySource: Map<string, number>;
}): string {
  return input.rows
    .map((row, index) => {
      const citationId = input.citationIdBySource.get(sourceKey(row.item));
      const suffix = citationId ? ` [${citationId}]` : "";
      const qualifier = row.status === "weak" ? "Likely: " : "";

      return `${index + 1}. ${qualifier}${shorten(row.item.claim, 320)}${suffix}`;
    })
    .join("\n");
}

function buildEvidenceNotesMarkdown(rows: EvidenceWithStatus[]): string {
  return rows
    .slice(0, 6)
    .map((row, index) => {
      const section = row.item.section ? `, section "${row.item.section}"` : "";
      return `${index + 1}. ${statusLabel(row.status)} evidence from ${row.item.title}${section}: "${shorten(row.item.quote, 220)}"`;
    })
    .join("\n");
}

function buildSourcesMarkdown(citations: AnswerCitation[]): string {
  if (citations.length === 0) return "";

  return citations
    .map((citation) => {
      return `[${citation.id}] ${citation.title} — ${citation.url}`;
    })
    .join("\n");
}

export function synthesizeAnswerFromEvidencePack(input: {
  query: string;
  evidencePack: EvidencePack;
  maxClaims?: number;
}): SynthesizedAnswer {
  const maxClaims = input.maxClaims ?? 10;
  const rows = groupEvidenceForAnswer({
    query: input.query,
    evidencePack: input.evidencePack,
    maxClaims,
  });

  if (rows.length === 0) {
    return buildNoEvidenceAnswer(input.evidencePack);
  }

  const supportedEvidenceCount = rows.filter((row) => row.status === "supported").length;
  const weakEvidenceCount = rows.filter((row) => row.status === "weak").length;
  const status: SynthesizedAnswer["status"] =
    supportedEvidenceCount > 0 ? "answered" : "partial";

  const { citationBySource, citationIdBySource } = buildCitationMap(rows.map((row) => row.item));
  const citations = [...citationBySource.values()];

  const intro =
    status === "answered"
      ? `Based on ${supportedEvidenceCount} supported claim(s) from ${citations.length} source(s), here is the grounded answer.`
      : `I found only weak evidence, so treat this as a partial answer.`;

  const markdown = [
    "## Answer",
    "",
    intro,
    "",
    buildClaimsMarkdown({ rows, citationIdBySource }),
    "",
    "## Evidence notes",
    "",
    buildEvidenceNotesMarkdown(rows),
    "",
    "## Sources",
    "",
    buildSourcesMarkdown(citations),
  ]
    .filter((part) => part.trim().length > 0)
    .join("\n");

  return {
    status,
    markdown,
    citations,
    usedEvidenceCount: rows.length,
    supportedEvidenceCount,
    weakEvidenceCount,
    omittedUnsupportedCount: input.evidencePack.coverage.unsupportedClaimCount,
    confidence: confidenceForAnswer(rows),
  };
}
'''


RESEARCH_ORCHESTRATOR_TS = r'''
import { ingestMarkdownDocument } from "../ingestion/ingest-markdown-document.js";
import { SearchPlannerAgent } from "../agents/search-planner.agent.js";
import { MemoryAgent } from "../agents/memory-agent.js";
import { planResources } from "./resource-planner.js";
import { crawlResearchSources } from "./crawl-manager.js";
import { buildEvidencePack } from "./evidence-pack.js";
import { synthesizeAnswerFromEvidencePack } from "./answer-synthesizer.js";
import type {
  EvidencePack,
  RankedResource,
  SynthesizedAnswer,
} from "./source-types.js";

export type ResearchOrchestratorInput = {
  projectId: string;
  userId?: string;
  query: string;
  maxSources?: number;
  maxPagesPerSource?: number;
  maxTotalPages?: number;
  maxDepth?: number;
};

export type ResearchOrchestratorOutput = {
  status: "ok" | "partial" | "error";
  query: string;
  normalizedQuery: string;
  subqueries: Array<{ query: string; reason: string; priority: number }>;
  plan: unknown;
  resourcesPlanned: Array<{
    title: string;
    url: string;
    tier: string;
    score: number;
    source: string;
    reason: string;
    matchedBy: string[];
  }>;
  memories: {
    retrieved: number;
    written: number;
    usedForRanking: number;
    planned: {
      sourceQuality: number;
      sourceFailure: number;
      durableFact: number;
    };
  };
  documents: Array<{
    documentId: string;
    title: string;
    url: string;
    chunksTotal: number;
    embeddedChunks: number;
    deduped: boolean;
  }>;
  failedCrawls: Array<{
    title?: string;
    url?: string;
    reason: string;
  }>;
  evidencePack: EvidencePack;
  answer: SynthesizedAnswer;
};

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.origin + u.pathname.replace(/\/$/, "") + u.search;
  } catch {
    return url;
  }
}

function mergeResources(allResources: RankedResource[][]): RankedResource[] {
  const seen = new Map<string, RankedResource>();

  for (const batch of allResources) {
    for (const resource of batch) {
      const key = normalizeUrl(resource.url);
      const existing = seen.get(key);

      if (!existing) {
        seen.set(key, { ...resource, matchedBy: [...(resource.matchedBy ?? [])] });
        continue;
      }

      const newMatched = (resource.matchedBy ?? []).filter(
        (m) => !(existing.matchedBy ?? []).includes(m)
      );
      existing.matchedBy = [...(existing.matchedBy ?? []), ...newMatched];

      if (resource.score > existing.score) {
        existing.score = resource.score;
        existing.reason = resource.reason;
        existing.tier = resource.tier;
      }
    }
  }

  return [...seen.values()].sort((a, b) => b.score - a.score);
}

export class ResearchOrchestrator {
  constructor(
    private readonly searchPlanner = new SearchPlannerAgent(),
    private readonly memoryAgent = new MemoryAgent()
  ) {}

  async run(input: ResearchOrchestratorInput): Promise<ResearchOrchestratorOutput> {
    const context = {
      projectId: input.projectId,
      userId: input.userId,
      query: input.query,
    };

    const planResult = this.searchPlanner.plan(context);
    if (planResult.status !== "ok" || !planResult.output) {
      throw new Error(planResult.error ?? "Search planning failed");
    }

    const memoryResult = await this.memoryAgent.retrieveForRun(context);
    const retrievedMemories = memoryResult.output?.retrieved ?? [];
    const retrievedMemoryCount = retrievedMemories.length;

    const rankingMemories = retrievedMemories.filter((memory) =>
      ["source_quality", "source_failure", "durable_fact"].includes(memory.kind)
    );

    const maxSources =
      input.maxSources ?? planResult.output.recommendedMaxSources ?? 8;

    const plan = planResult.output;
    const subqueries = plan.subqueries;

    const allResourceBatches: RankedResource[][] = [];

    for (const subquery of subqueries) {
      const resourcePlan = await planResources({
        query: subquery.query,
        maxSources: Math.max(5, Math.ceil(maxSources / subqueries.length)),
        memoryHints: rankingMemories,
      });

      for (const resource of resourcePlan.resources) {
        if (!resource.matchedBy) {
          resource.matchedBy = [];
        }

        resource.matchedBy.push(`subquery:${subquery.query}`);
      }

      allResourceBatches.push(resourcePlan.resources);
    }

    const mergedResources = mergeResources(allResourceBatches).slice(
      0,
      maxSources
    );

    const crawl = await crawlResearchSources({
      projectId: input.projectId,
      query: plan.normalizedQuery,
      resources: mergedResources,
      maxPagesPerSource:
        input.maxPagesPerSource ??
        plan.recommendedMaxPagesPerSource ??
        3,
      maxTotalPages: input.maxTotalPages ?? 20,
      maxDepth: input.maxDepth ?? 1,
    });

    const documents = [];

    for (const page of crawl.pages) {
      const ingested = await ingestMarkdownDocument({
        projectId: input.projectId,
        sourceUrl: page.url,
        title: page.title,
        markdown: page.markdown,
        metadata: {
          ...page.metadata,
          provider: "scrapling",
          researchQuery: input.query,
          normalizedQuery: plan.normalizedQuery,
          sourceTitle: page.source.title,
          sourceTier: page.source.tier,
          sourceScore: page.source.score,
        },
      });

      documents.push({
        documentId: ingested.document.id,
        title: page.title,
        url: page.url,
        chunksTotal: ingested.chunksTotal,
        embeddedChunks: ingested.embeddedChunks,
        deduped: ingested.deduped,
      });
    }

    const evidencePack = buildEvidencePack({
      query: input.query,
      resourcesPlanned: mergedResources,
      evidence: crawl.evidence,
    });

    const answer = synthesizeAnswerFromEvidencePack({
      query: input.query,
      evidencePack,
      maxClaims: 10,
    });

    const sourceMemoryDrafts = this.memoryAgent.buildSourceMemoriesFromEvidencePack({
      projectId: input.projectId,
      userId: input.userId,
      evidencePack,
    });

    const failureMemoryDrafts = this.memoryAgent.buildFailureMemoriesFromCrawlFailures({
      projectId: input.projectId,
      userId: input.userId,
      query: input.query,
      failedCrawls: crawl.failed,
    });

    const durableFactMemoryDrafts =
      this.memoryAgent.buildDurableFactMemoriesFromEvidencePack({
        projectId: input.projectId,
        userId: input.userId,
        evidencePack,
      });

    const allMemoryDrafts = [
      ...sourceMemoryDrafts,
      ...failureMemoryDrafts,
      ...durableFactMemoryDrafts,
    ];

    const writeResult = await this.memoryAgent.writeRunMemories(
      context,
      allMemoryDrafts
    );

    return {
      status:
        documents.length > 0
          ? crawl.failed.length > 0 || answer.status !== "answered"
            ? "partial"
            : "ok"
          : "error",
      query: input.query,
      normalizedQuery: plan.normalizedQuery,
      subqueries: subqueries.map((sq) => ({
        query: sq.query,
        reason: sq.reason,
        priority: sq.priority,
      })),
      plan,
      resourcesPlanned: mergedResources.map((resource) => ({
        title: resource.title,
        url: resource.url,
        tier: resource.tier,
        score: resource.score,
        source: resource.source,
        reason: resource.reason,
        matchedBy: resource.matchedBy,
      })),
      memories: {
        retrieved: retrievedMemoryCount,
        written: writeResult.output?.written ?? 0,
        usedForRanking: rankingMemories.length,
        planned: {
          sourceQuality: sourceMemoryDrafts.length,
          sourceFailure: failureMemoryDrafts.length,
          durableFact: durableFactMemoryDrafts.length,
        },
      },
      documents,
      failedCrawls: crawl.failed,
      evidencePack,
      answer,
    };
  }
}
'''


TODO_APPEND = '''
## Done in v2 Slice 5

- [x] Added deterministic evidence-based answer synthesis.
- [x] Final answer now uses only supported or weak citation-verified evidence.
- [x] Final answer includes source-numbered Markdown citations.
- [x] Unsupported evidence is omitted from answer generation.
- [x] ResearchOrchestrator now returns `answer`.

## Now

### Answer quality

- [ ] Add tests for `answer-synthesizer.ts`.
- [ ] Add comparison-specific formatting for "A vs B" questions.
- [ ] Add implementation-specific formatting for "how to fix" questions.
- [ ] Add UI rendering for `answer.markdown` and `answer.citations`.
- [ ] Add an optional LLM polish step that is constrained to EvidencePack only.
'''


LESSONS_APPEND = '''
## Research Engine v2 Slice 5

- The final answer should be built from EvidencePack, not raw scraped chunks.
- Deterministic synthesis is a good first safety layer because it prevents unsupported claims from entering the answer.
- LLM polish should be optional and evidence-constrained. Do not let it introduce uncited facts.
- Returning both `answer` and `evidencePack` makes debugging and UI source drawers easier.
'''


def update_index() -> None:
    path = "packages/knowledge/src/index.ts"
    text = read(path)
    line = 'export * from "./research/answer-synthesizer.js";'
    marker = 'export * from "./research/evidence-pack.js";'
    if line not in text:
        text = text.replace(marker, marker + "\n" + line)
    write(path, text)


def update_package_exports() -> None:
    path = ROOT / "packages/knowledge/package.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    exports = data.setdefault("exports", {})
    exports["./research/answer-synthesizer"] = "./src/research/answer-synthesizer.js"
    exports["./research/answer-synthesizer.js"] = "./src/research/answer-synthesizer.js"
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print("updated packages/knowledge/package.json")


def update_todo() -> None:
    path = ROOT / "docs/TODO.md"
    if not path.exists():
        write("docs/TODO.md", "# Scout TODO\n\n" + TODO_APPEND)
        return

    text = path.read_text(encoding="utf-8").rstrip()
    if "Done in v2 Slice 5" not in text:
        text += "\n\n" + TODO_APPEND.strip() + "\n"
    path.write_text(text, encoding="utf-8")
    print("updated docs/TODO.md")


def update_lessons() -> None:
    path = ROOT / "docs/LESSONS.md"
    if not path.exists():
        write("docs/LESSONS.md", "# Scout Lessons\n\n" + LESSONS_APPEND)
        return

    text = path.read_text(encoding="utf-8").rstrip()
    if "Research Engine v2 Slice 5" not in text:
        text += "\n\n" + LESSONS_APPEND.strip() + "\n"
    path.write_text(text, encoding="utf-8")
    print("updated docs/LESSONS.md")


def main() -> None:
    assert_repo_root()

    write("packages/knowledge/src/research/source-types.ts", SOURCE_TYPES_TS)
    write("packages/knowledge/src/research/answer-synthesizer.ts", ANSWER_SYNTHESIZER_TS)
    write("packages/knowledge/src/research/research-orchestrator.ts", RESEARCH_ORCHESTRATOR_TS)

    update_index()
    update_package_exports()
    update_todo()
    update_lessons()

    print("\nDone.")
    print("\nNext commands:")
    print("  npm run prisma:generate")
    print("  docker compose build api worker model-service")
    print("  docker compose up")
    print("\nSmoke test:")
    print("  curl -X POST http://localhost:8000/tools/web-research -H 'Content-Type: application/json' -d '{\"projectId\":\"<PROJECT_ID>\",\"query\":\"Compare Meta Marketing API and Google Ads API permissions and rate limits\",\"maxResults\":5,\"maxPagesPerSource\":3,\"maxTotalPages\":12,\"maxDepth\":1,\"useOrchestrator\":true}'")
    print("\nExpected output:")
    print("  answer.markdown")
    print("  answer.citations")
    print("  answer.usedEvidenceCount")
    print("  answer.confidence")


if __name__ == "__main__":
    main()
