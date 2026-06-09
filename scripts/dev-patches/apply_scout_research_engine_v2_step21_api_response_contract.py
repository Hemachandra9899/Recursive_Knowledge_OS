#!/usr/bin/env python3
# Apply Scout Research Engine v2 Step 21:
# API/UI response contract cleanup.
#
# Run from Scout repo root on main AFTER Step 20.
#
# Why:
# The pipeline now returns rich internals: searchTrace, crawlTrace, evidencePack.coverage,
# skippedCrawls, memories, answer.groundingAudit. The API should expose a stable
# UI/debug contract instead of forcing clients to dig through raw nested output.
#
# This patch:
# - Adds research-response-contract.ts.
# - Wraps /tools/web-research responses with:
#     contractVersion
#     ui
#     debug
# - Preserves the original raw fields at top-level.
# - Adds API unit tests for orchestrator + legacy shapes.
# - Adds apps/api test/typecheck scripts and root helper scripts.
# - Updates README/TODO/LESSONS.
#
# After applying:
#   npm install
#   npm run typecheck:api
#   npm run test:api
#   npm run typecheck:knowledge
#   npm run test:knowledge

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


def read_json(path: str) -> dict:
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


def write_json(path: str, data: dict) -> None:
    (ROOT / path).write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print(f"updated {path}")


def assert_repo_root() -> None:
    required = [
        "package.json",
        "apps/api/package.json",
        "apps/api/src/modules/tools/tools.service.ts",
    ]
    missing = [p for p in required if not (ROOT / p).exists()]
    if missing:
        raise SystemExit(
            "Run from Scout repo root after Step 20. Missing:\n"
            + "\n".join(f"- {p}" for p in missing)
        )


CONTRACT_TS = r'''
type AnyRecord = Record<string, any>;

export type ResearchResponseContractVersion = "research-response-v1";

export type ResearchDebugSummary = {
  mode: "orchestrator" | "legacy";
  search: {
    resourcesPlanned: number;
    selectedProviders: string[];
    routeKinds: string[];
    hasSearchTrace: boolean;
  };
  crawl: {
    acceptedPages: number;
    skippedPages: number;
    failedCount: number;
    retryCount: number;
    rejectedByQuality: number;
    rejectedByDuplicateUrl: number;
    rejectedByDuplicateContent: number;
    hasCrawlTrace: boolean;
  };
  evidence: {
    hasEvidence: boolean;
    rawClaimCount: number;
    filteredClaimCount: number;
    qualityRejectedClaimCount: number;
    duplicateRejectedClaimCount: number;
    supportedClaimCount: number;
    weakClaimCount: number;
    unsupportedClaimCount: number;
    missing: string[];
  };
  answer: {
    status?: string;
    mode?: string;
    citationCount: number;
    confidence?: number;
    groundingStatus?: string;
    groundingIssueCount?: number;
  };
  memories: {
    retrieved?: number;
    usedForRanking?: number;
    written?: number;
    planned?: AnyRecord;
  };
};

export type ResearchUiSummary = {
  status: string;
  query?: string;
  normalizedQuery?: string;
  answerMarkdown?: string;
  citations: AnyRecord[];
  confidence?: number;
  answerMode?: string;
  groundingStatus?: string;
  groundingIssues: AnyRecord[];
  evidenceCoverage?: AnyRecord;
  crawlTrace?: AnyRecord;
  skippedCrawls: AnyRecord[];
  resources: AnyRecord[];
  warnings: string[];
};

export type ResearchContractedResponse<T extends AnyRecord = AnyRecord> = T & {
  contractVersion: ResearchResponseContractVersion;
  ui: ResearchUiSummary;
  debug: ResearchDebugSummary;
};

function arrayOf<T = any>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function numberOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function compact<T>(items: Array<T | undefined | null | false>): T[] {
  return items.filter(Boolean) as T[];
}

function searchTraceForResource(resource: AnyRecord): AnyRecord | undefined {
  return resource?.metadata?.searchTrace;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function selectedProviders(resources: AnyRecord[]): string[] {
  return unique(
    resources.flatMap((resource) => {
      const trace = searchTraceForResource(resource);
      return arrayOf<string>(trace?.selectedProviders);
    })
  );
}

function routeKinds(resources: AnyRecord[]): string[] {
  return unique(
    resources
      .map((resource) => searchTraceForResource(resource)?.routeKind)
      .filter((value): value is string => typeof value === "string")
  );
}

function hasSearchTrace(resources: AnyRecord[]): boolean {
  return resources.some((resource) => Boolean(searchTraceForResource(resource)));
}

function evidenceCoverageOf(response: AnyRecord): AnyRecord {
  return response?.evidencePack?.coverage ?? {};
}

function answerOf(response: AnyRecord): AnyRecord | undefined {
  return response?.answer;
}

function crawlTraceOf(response: AnyRecord): AnyRecord {
  return response?.crawlTrace ?? {};
}

function skippedCrawlsOf(response: AnyRecord): AnyRecord[] {
  return arrayOf(response?.skippedCrawls);
}

function failedCrawlsOf(response: AnyRecord): AnyRecord[] {
  return arrayOf(response?.failedCrawls ?? response?.failedScrapes);
}

function warningsFor(response: AnyRecord, debug: ResearchDebugSummary): string[] {
  const warnings: string[] = [];

  if (debug.evidence.filteredClaimCount === 0) {
    warnings.push("No filtered evidence claims are available.");
  }

  if (debug.answer.groundingStatus && debug.answer.groundingStatus !== "pass") {
    warnings.push(`Answer grounding audit status is ${debug.answer.groundingStatus}.`);
  }

  if (debug.crawl.acceptedPages === 0 && debug.mode === "orchestrator") {
    warnings.push("Crawler accepted zero pages.");
  }

  if (failedCrawlsOf(response).length > 0) {
    warnings.push(`${failedCrawlsOf(response).length} crawl/scrape failure(s) occurred.`);
  }

  if (debug.evidence.missing.length > 0) {
    warnings.push(...debug.evidence.missing);
  }

  return unique(warnings);
}

export function buildResearchDebugSummary(
  response: AnyRecord,
  mode: "orchestrator" | "legacy"
): ResearchDebugSummary {
  const resources = arrayOf<AnyRecord>(response.resourcesPlanned);
  const crawlTrace = crawlTraceOf(response);
  const coverage = evidenceCoverageOf(response);
  const answer = answerOf(response);
  const groundingAudit = answer?.groundingAudit;

  return {
    mode,
    search: {
      resourcesPlanned: resources.length,
      selectedProviders: selectedProviders(resources),
      routeKinds: routeKinds(resources),
      hasSearchTrace: hasSearchTrace(resources),
    },
    crawl: {
      acceptedPages: numberOf(crawlTrace.acceptedPages),
      skippedPages: numberOf(crawlTrace.skippedPages),
      failedCount: failedCrawlsOf(response).length,
      retryCount: numberOf(crawlTrace.retryCount),
      rejectedByQuality: numberOf(crawlTrace.rejectedByQuality),
      rejectedByDuplicateUrl: numberOf(crawlTrace.rejectedByDuplicateUrl),
      rejectedByDuplicateContent: numberOf(crawlTrace.rejectedByDuplicateContent),
      hasCrawlTrace: Object.keys(crawlTrace).length > 0,
    },
    evidence: {
      hasEvidence: Boolean(coverage.hasEvidence),
      rawClaimCount: numberOf(coverage.rawClaimCount ?? coverage.claimCount),
      filteredClaimCount: numberOf(coverage.filteredClaimCount ?? coverage.claimCount),
      qualityRejectedClaimCount: numberOf(coverage.qualityRejectedClaimCount),
      duplicateRejectedClaimCount: numberOf(coverage.duplicateRejectedClaimCount),
      supportedClaimCount: numberOf(coverage.supportedClaimCount),
      weakClaimCount: numberOf(coverage.weakClaimCount),
      unsupportedClaimCount: numberOf(coverage.unsupportedClaimCount),
      missing: arrayOf<string>(coverage.missing),
    },
    answer: {
      status: answer?.status,
      mode: answer?.mode,
      citationCount: arrayOf(answer?.citations).length,
      confidence: answer?.confidence,
      groundingStatus: groundingAudit?.status,
      groundingIssueCount: groundingAudit?.issueCount,
    },
    memories: {
      retrieved: response?.memories?.retrieved,
      usedForRanking: response?.memories?.usedForRanking,
      written: response?.memories?.written,
      planned: response?.memories?.planned,
    },
  };
}

export function buildResearchUiSummary(
  response: AnyRecord,
  debug: ResearchDebugSummary
): ResearchUiSummary {
  const answer = answerOf(response);
  const groundingAudit = answer?.groundingAudit;
  const warnings = warningsFor(response, debug);

  return {
    status: response.status ?? "unknown",
    query: response.query,
    normalizedQuery: response.normalizedQuery,
    answerMarkdown: answer?.markdown,
    citations: arrayOf(answer?.citations),
    confidence: answer?.confidence,
    answerMode: answer?.mode,
    groundingStatus: groundingAudit?.status,
    groundingIssues: arrayOf(groundingAudit?.issues),
    evidenceCoverage: response?.evidencePack?.coverage,
    crawlTrace: response?.crawlTrace,
    skippedCrawls: skippedCrawlsOf(response),
    resources: arrayOf(response.resourcesPlanned),
    warnings,
  };
}

export function withResearchResponseContract<T extends AnyRecord>(
  response: T,
  mode: "orchestrator" | "legacy"
): ResearchContractedResponse<T> {
  const debug = buildResearchDebugSummary(response, mode);
  const ui = buildResearchUiSummary(response, debug);

  return {
    ...response,
    contractVersion: "research-response-v1",
    ui,
    debug,
  };
}
'''


CONTRACT_TEST_TS = r'''
import { describe, expect, it } from "vitest";
import {
  buildResearchDebugSummary,
  withResearchResponseContract,
} from "../research-response-contract.js";

function orchestratorResponse() {
  return {
    status: "ok",
    query: "Example query",
    normalizedQuery: "example query",
    resourcesPlanned: [
      {
        title: "Example Docs",
        url: "https://docs.example.com",
        metadata: {
          searchTrace: {
            routeKind: "official_docs",
            selectedProviders: ["tavily", "firecrawl"],
          },
        },
      },
    ],
    crawlTrace: {
      acceptedPages: 2,
      skippedPages: 1,
      retryCount: 1,
      rejectedByQuality: 1,
      rejectedByDuplicateUrl: 0,
      rejectedByDuplicateContent: 0,
    },
    skippedCrawls: [{ url: "https://docs.example.com/nav" }],
    failedCrawls: [],
    evidencePack: {
      coverage: {
        hasEvidence: true,
        rawClaimCount: 12,
        filteredClaimCount: 8,
        qualityRejectedClaimCount: 2,
        duplicateRejectedClaimCount: 2,
        supportedClaimCount: 6,
        weakClaimCount: 2,
        unsupportedClaimCount: 0,
        missing: [],
      },
    },
    memories: {
      retrieved: 3,
      usedForRanking: 2,
      written: 4,
      planned: {
        sourceQuality: 2,
      },
    },
    answer: {
      status: "answered",
      mode: "how_to",
      markdown: "Answer [1]",
      citations: [{ id: 1, url: "https://docs.example.com" }],
      confidence: 0.91,
      groundingAudit: {
        status: "pass",
        issueCount: 0,
        issues: [],
      },
    },
  };
}

describe("research response contract", () => {
  it("builds debug summary for orchestrator responses", () => {
    const debug = buildResearchDebugSummary(orchestratorResponse(), "orchestrator");

    expect(debug.mode).toBe("orchestrator");
    expect(debug.search.resourcesPlanned).toBe(1);
    expect(debug.search.selectedProviders).toEqual(["tavily", "firecrawl"]);
    expect(debug.search.routeKinds).toEqual(["official_docs"]);
    expect(debug.crawl.acceptedPages).toBe(2);
    expect(debug.crawl.retryCount).toBe(1);
    expect(debug.evidence.filteredClaimCount).toBe(8);
    expect(debug.answer.groundingStatus).toBe("pass");
    expect(debug.memories.written).toBe(4);
  });

  it("wraps response with stable contractVersion, ui, and debug", () => {
    const contracted = withResearchResponseContract(orchestratorResponse(), "orchestrator");

    expect(contracted.contractVersion).toBe("research-response-v1");
    expect(contracted.ui.answerMarkdown).toBe("Answer [1]");
    expect(contracted.ui.citations).toHaveLength(1);
    expect(contracted.ui.evidenceCoverage?.filteredClaimCount).toBe(8);
    expect(contracted.ui.groundingStatus).toBe("pass");
    expect(contracted.debug.crawl.acceptedPages).toBe(2);
  });

  it("surfaces warnings for unhealthy evidence/grounding", () => {
    const response = {
      ...orchestratorResponse(),
      evidencePack: {
        coverage: {
          hasEvidence: false,
          filteredClaimCount: 0,
          missing: ["No official/trusted sources were collected."],
        },
      },
      answer: {
        ...orchestratorResponse().answer,
        groundingAudit: {
          status: "fail",
          issueCount: 1,
          issues: [{ code: "missing_declared_citation" }],
        },
      },
    };

    const contracted = withResearchResponseContract(response, "orchestrator");

    expect(contracted.ui.warnings).toContain("No filtered evidence claims are available.");
    expect(contracted.ui.warnings).toContain("Answer grounding audit status is fail.");
    expect(contracted.ui.warnings).toContain("No official/trusted sources were collected.");
  });

  it("handles legacy responses without answer or crawlTrace", () => {
    const contracted = withResearchResponseContract(
      {
        status: "ok",
        query: "Legacy query",
        resourcesPlanned: [],
        documents: [],
        failedScrapes: [],
        evidencePack: {
          coverage: {
            hasEvidence: true,
            claimCount: 3,
            supportedClaimCount: 2,
            weakClaimCount: 1,
            unsupportedClaimCount: 0,
            missing: [],
          },
        },
      },
      "legacy"
    );

    expect(contracted.debug.mode).toBe("legacy");
    expect(contracted.debug.crawl.hasCrawlTrace).toBe(false);
    expect(contracted.debug.evidence.filteredClaimCount).toBe(3);
    expect(contracted.ui.citations).toEqual([]);
  });
});
'''


def patch_tools_service() -> None:
    path = "apps/api/src/modules/tools/tools.service.ts"
    text = read(path)

    if 'from "./research-response-contract.js"' not in text:
        text = text.replace(
            '} from "./tools.schema.js";',
            '} from "./tools.schema.js";\nimport { withResearchResponseContract } from "./research-response-contract.js";'
        )

    old_orchestrator = '''  if (input.useOrchestrator) {
    const orchestrator = new ResearchOrchestrator();
    return orchestrator.run({
      projectId: input.projectId,
      query: input.query,
      maxSources: input.maxResults,
      maxPagesPerSource: input.maxPagesPerSource,
      maxTotalPages: input.maxTotalPages,
      maxDepth: input.maxDepth,
    });
  }'''

    new_orchestrator = '''  if (input.useOrchestrator) {
    const orchestrator = new ResearchOrchestrator();
    const response = await orchestrator.run({
      projectId: input.projectId,
      query: input.query,
      maxSources: input.maxResults,
      maxPagesPerSource: input.maxPagesPerSource,
      maxTotalPages: input.maxTotalPages,
      maxDepth: input.maxDepth,
    });

    return withResearchResponseContract(response, "orchestrator");
  }'''

    if old_orchestrator in text:
        text = text.replace(old_orchestrator, new_orchestrator)
    else:
        print("warning: orchestrator branch pattern not found; skipping branch patch")

    old_legacy_return = '''  return {
    status: "ok",
    query: input.query,
    normalizedQuery: plan.normalizedQuery,
    strategy: plan.strategy,
    resourcesPlanned: plan.resources,
    documents,
    failedScrapes,
    evidencePack,
    results: evidence,
  };'''

    new_legacy_return = '''  return withResearchResponseContract(
    {
      status: "ok",
      query: input.query,
      normalizedQuery: plan.normalizedQuery,
      strategy: plan.strategy,
      resourcesPlanned: plan.resources,
      documents,
      failedScrapes,
      evidencePack,
      results: evidence,
    },
    "legacy"
  );'''

    if old_legacy_return in text:
        text = text.replace(old_legacy_return, new_legacy_return)
    else:
        print("warning: legacy return pattern not found; skipping legacy patch")

    write(path, text)


def update_api_package() -> None:
    pkg = read_json("apps/api/package.json")

    scripts = pkg.setdefault("scripts", {})
    scripts["typecheck"] = "tsc --noEmit"
    scripts["test"] = "vitest run"

    dev_deps = pkg.setdefault("devDependencies", {})
    dev_deps["vitest"] = "^2.1.8"
    dev_deps["@types/node"] = "^22.10.2"

    write_json("apps/api/package.json", pkg)


def update_root_package() -> None:
    pkg = read_json("package.json")
    scripts = pkg.setdefault("scripts", {})
    scripts["typecheck:api"] = "npm --workspace apps/api run typecheck"
    scripts["test:api"] = "npm --workspace apps/api test"
    write_json("package.json", pkg)


README_APPEND = r'''
---

## Research response contract

`/tools/web-research` returns the full raw research response plus a stable UI/debug contract.

Top-level additions:

```text
contractVersion = "research-response-v1"
ui
debug
```

Useful UI fields:

```text
ui.answerMarkdown
ui.citations
ui.evidenceCoverage
ui.crawlTrace
ui.skippedCrawls
ui.groundingStatus
ui.groundingIssues
ui.warnings
```

Useful debug fields:

```text
debug.search
debug.crawl
debug.evidence
debug.answer
debug.memories
```

This lets the frontend show source traces, crawl traces, evidence coverage, and grounding audits without knowing every internal nested structure.
'''


TODO_APPEND = r'''
## Done in v2 Slice 19

- [x] Added stable `/tools/web-research` response contract.
- [x] Added `contractVersion`, `ui`, and `debug`.
- [x] Wrapped orchestrator and legacy web research responses.
- [x] Added API unit tests for response contract shape.
- [x] Added API typecheck/test scripts.

## Now

### API/UI validation

- [ ] Run `npm install`.
- [ ] Run `npm run typecheck:api`.
- [ ] Run `npm run test:api`.
- [ ] Run `npm run typecheck:knowledge`.
- [ ] Run `npm run test:knowledge`.
- [ ] Run Docker smoke test and inspect `ui` + `debug`.
- [ ] Add frontend debug panels for Sources, Crawl, Evidence, Grounding.
'''


LESSONS_APPEND = r'''
## Research Engine v2 Slice 19

- Raw pipeline output is useful for debugging, but UI needs a stable contract.
- API response contracts should preserve raw fields while adding normalized summaries.
- Debug summaries should expose health signals without requiring clients to parse every nested object.
- Grounding, crawl, evidence, and provider traces should be first-class UI concepts.
'''


def append_once(path: str, heading: str, content: str) -> None:
    target = ROOT / path
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content.strip() + "\n", encoding="utf-8")
        print(f"wrote {path}")
        return

    text = target.read_text(encoding="utf-8")
    if heading in text:
        print(f"skipped {path}; already contains {heading}")
        return

    target.write_text(text.rstrip() + "\n\n" + content.strip() + "\n", encoding="utf-8")
    print(f"updated {path}")


def main() -> None:
    assert_repo_root()

    write("apps/api/src/modules/tools/research-response-contract.ts", CONTRACT_TS)
    write("apps/api/src/modules/tools/__tests__/research-response-contract.test.ts", CONTRACT_TEST_TS)

    patch_tools_service()
    update_api_package()
    update_root_package()

    append_once("README.md", "Research response contract", README_APPEND)
    append_once("docs/TODO.md", "Done in v2 Slice 19", TODO_APPEND)
    append_once("docs/LESSONS.md", "Research Engine v2 Slice 19", LESSONS_APPEND)

    print("\nDone.")
    print("\nNext commands:")
    print("  npm install")
    print("  npm run typecheck:api")
    print("  npm run test:api")
    print("  npm run typecheck:knowledge")
    print("  npm run test:knowledge")
    print("")
    print("Then Docker smoke test and inspect:")
    print("  contractVersion")
    print("  ui.answerMarkdown")
    print("  ui.evidenceCoverage")
    print("  ui.crawlTrace")
    print("  ui.groundingStatus")
    print("  debug.search")
    print("  debug.crawl")
    print("  debug.evidence")
    print("  debug.answer")


if __name__ == "__main__":
    main()
