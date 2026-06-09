#!/usr/bin/env python3
# Apply Scout Research Engine v2 Step 9:
# Tests + export cleanup + DRY answer-renderer cleanup.
#
# Run from Scout repo root on main.
#
# This patch:
# - Adds package scripts for typecheck/test in packages/knowledge.
# - Adds Vitest dev dependency to packages/knowledge.
# - Exports answer-mode and answer-renderers from package.json.
# - Refactors answer-renderers.ts to reduce repeated markdown blocks.
# - Adds unit tests for answer-mode, answer-synthesizer/renderers,
#   citation-verifier, evidence-extractor, and memory-ranking.
#
# After applying:
#   npm install
#   npm --workspace packages/knowledge run typecheck
#   npm --workspace packages/knowledge test

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
        "packages/knowledge/package.json",
        "packages/knowledge/src/research/answer-renderers.ts",
        "packages/knowledge/src/research/answer-mode.ts",
        "packages/knowledge/src/research/answer-synthesizer.ts",
    ]
    missing = [p for p in required if not (ROOT / p).exists()]
    if missing:
        raise SystemExit(
            "Run this script from the Scout repo root. Missing:\n"
            + "\n".join(f"- {p}" for p in missing)
        )


ANSWER_RENDERERS_TS = r'''
import type {
  AnswerCitation,
  AnswerMode,
  CitationVerificationStatus,
  EvidenceItem,
  EvidencePack,
  SourceTier,
  SynthesizedAnswer,
} from "./source-types.js";

export type EvidenceWithStatus = {
  item: EvidenceItem;
  status: CitationVerificationStatus;
  score: number;
};

export type RenderAnswerInput = {
  mode: AnswerMode;
  query: string;
  rows: EvidenceWithStatus[];
  citations: AnswerCitation[];
  citationIdBySource: Map<string, number>;
  status: SynthesizedAnswer["status"];
};

type Section = {
  heading: string;
  body: string;
};

const SOURCE_TIER_WEIGHTS: Record<SourceTier, number> = {
  official_docs: 30,
  trusted_docs: 22,
  reference_examples: 12,
  community: 4,
  media: 2,
  unknown: 6,
};

const STATUS_WEIGHTS: Record<CitationVerificationStatus, number> = {
  supported: 40,
  weak: 12,
  unsupported: -100,
};

const MODE_INTROS: Record<AnswerMode, { answered: string; partial: string }> = {
  comparison: {
    answered: "Here is the grounded comparison based on supported evidence.",
    partial: "I found limited evidence, so treat this as a partial comparison.",
  },
  how_to: {
    answered: "Here are the evidence-backed steps/details.",
    partial: "I found limited evidence, so treat these as partial steps.",
  },
  research_summary: {
    answered: "Here is the grounded research summary.",
    partial: "I found limited evidence, so this is a partial research summary.",
  },
  general: {
    answered: "Here is the grounded answer.",
    partial: "I found only weak evidence, so treat this as a partial answer.",
  },
};

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9.+#\s-]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

export function shorten(text: string, maxChars: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars - 3)}...`;
}

export function sourceKey(item: EvidenceItem): string {
  return item.url || `${item.title}:${item.tier}`;
}

export function evidenceKey(item: EvidenceItem): string {
  return `${item.url}::${item.claim.toLowerCase().replace(/\s+/g, " ").trim()}`;
}

export function scoreEvidence(
  query: string,
  item: EvidenceItem,
  status: CitationVerificationStatus
): number {
  const queryTokens = new Set(tokenize(query));
  const evidenceText = [
    item.claim,
    item.section,
    item.product,
    item.domain,
    ...item.entities,
  ]
    .filter(Boolean)
    .join(" ");

  const itemTokens = new Set(tokenize(evidenceText));
  const overlap = [...itemTokens].filter((token) => queryTokens.has(token)).length;

  return (
    STATUS_WEIGHTS[status] +
    item.confidence * 35 +
    SOURCE_TIER_WEIGHTS[item.tier] +
    overlap * 3
  );
}

export function confidenceForAnswer(rows: EvidenceWithStatus[]): number {
  if (rows.length === 0) return 0;

  const supported = rows.filter((row) => row.status === "supported");
  const usable = supported.length > 0 ? supported : rows;
  const avg =
    usable.reduce((sum, row) => sum + row.item.confidence, 0) / usable.length;
  const supportBoost = supported.length / rows.length;

  return Math.min(0.98, Number((avg * 0.8 + supportBoost * 0.2).toFixed(2)));
}

export function buildCitationMap(evidence: EvidenceItem[]): {
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

function compact(parts: string[]): string {
  return parts.filter((part) => part.trim().length > 0).join("\n");
}

function markdownDocument(sections: Section[]): string {
  return compact(
    sections.flatMap((section) => [
      `## ${section.heading}`,
      "",
      section.body,
      "",
    ])
  );
}

function statusLabel(status: CitationVerificationStatus): string {
  if (status === "supported") return "supported";
  if (status === "weak") return "weak";
  return "unsupported";
}

function citationSuffix(input: {
  item: EvidenceItem;
  citationIdBySource: Map<string, number>;
}): string {
  const citationId = input.citationIdBySource.get(sourceKey(input.item));
  return citationId ? ` [${citationId}]` : "";
}

function claimLine(input: {
  row: EvidenceWithStatus;
  citationIdBySource: Map<string, number>;
  maxChars: number;
}): string {
  const prefix = input.row.status === "weak" ? "Likely: " : "";
  return `${prefix}${shorten(input.row.item.claim, input.maxChars)}${citationSuffix({
    item: input.row.item,
    citationIdBySource: input.citationIdBySource,
  })}`;
}

function numberedClaims(input: {
  rows: EvidenceWithStatus[];
  citationIdBySource: Map<string, number>;
  maxClaims: number;
  maxChars: number;
}): string {
  return input.rows
    .slice(0, input.maxClaims)
    .map(
      (row, index) =>
        `${index + 1}. ${claimLine({
          row,
          citationIdBySource: input.citationIdBySource,
          maxChars: input.maxChars,
        })}`
    )
    .join("\n");
}

function bulletClaims(input: {
  rows: EvidenceWithStatus[];
  citationIdBySource: Map<string, number>;
  maxClaims: number;
  maxChars: number;
}): string {
  return input.rows
    .slice(0, input.maxClaims)
    .map(
      (row) =>
        `- ${claimLine({
          row,
          citationIdBySource: input.citationIdBySource,
          maxChars: input.maxChars,
        })}`
    )
    .join("\n");
}

function buildSourcesMarkdown(citations: AnswerCitation[]): string {
  return citations
    .map((citation) => `[${citation.id}] ${citation.title} — ${citation.url}`)
    .join("\n");
}

function buildEvidenceNotesMarkdown(rows: EvidenceWithStatus[]): string {
  return rows
    .slice(0, 6)
    .map((row, index) => {
      const section = row.item.section ? `, section "${row.item.section}"` : "";
      return `${index + 1}. ${statusLabel(row.status)} evidence from ${
        row.item.title
      }${section}: "${shorten(row.item.quote, 220)}"`;
    })
    .join("\n");
}

function introFor(input: RenderAnswerInput): string {
  if (input.mode === "general" && input.status === "answered") {
    const supported = input.rows.filter((row) => row.status === "supported").length;
    return `Based on ${supported} supported claim(s) from ${input.citations.length} source(s), here is the grounded answer.`;
  }

  return MODE_INTROS[input.mode][input.status === "answered" ? "answered" : "partial"];
}

function commonSections(input: RenderAnswerInput): Section[] {
  return [
    {
      heading: "Evidence notes",
      body: buildEvidenceNotesMarkdown(input.rows),
    },
    {
      heading: "Sources",
      body: buildSourcesMarkdown(input.citations),
    },
  ];
}

function groupByProductOrDomain(rows: EvidenceWithStatus[]): Map<string, EvidenceWithStatus[]> {
  const groups = new Map<string, EvidenceWithStatus[]>();

  for (const row of rows) {
    const key =
      row.item.product ||
      row.item.domain ||
      row.item.entities[0] ||
      row.item.title ||
      "Other";

    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  return groups;
}

function comparisonTable(input: RenderAnswerInput): string {
  const rows = [...groupByProductOrDomain(input.rows).entries()]
    .slice(0, 4)
    .map(([name, groupRows]) => {
      const summary = groupRows
        .slice(0, 3)
        .map((row) =>
          claimLine({
            row,
            citationIdBySource: input.citationIdBySource,
            maxChars: 140,
          })
        )
        .join("<br>");

      return `| ${name} | ${summary || "No supported evidence found."} |`;
    })
    .join("\n");

  return compact([
    "| Topic | Evidence-backed points |",
    "|---|---|",
    rows || "| Evidence | No comparable supported evidence found. |",
  ]);
}

function renderComparison(input: RenderAnswerInput): string {
  return markdownDocument([
    {
      heading: "Answer",
      body: introFor(input),
    },
    {
      heading: "Comparison table",
      body: comparisonTable(input),
    },
    {
      heading: "Key takeaways",
      body: numberedClaims({
        rows: input.rows,
        citationIdBySource: input.citationIdBySource,
        maxClaims: 5,
        maxChars: 260,
      }),
    },
    ...commonSections(input),
  ]);
}

function renderHowTo(input: RenderAnswerInput): string {
  return markdownDocument([
    {
      heading: "Answer",
      body: introFor(input),
    },
    {
      heading: "Steps / implementation notes",
      body: numberedClaims({
        rows: input.rows,
        citationIdBySource: input.citationIdBySource,
        maxClaims: 8,
        maxChars: 280,
      }),
    },
    {
      heading: "Things to verify",
      body: [
        "- Check the linked official/trusted source before production use.",
        "- Treat weak evidence as a hint, not a final fact.",
        "- Re-run research with a narrower query if any required setup detail is missing.",
      ].join("\n"),
    },
    ...commonSections(input),
  ]);
}

function renderResearchSummary(input: RenderAnswerInput): string {
  return markdownDocument([
    {
      heading: "Answer",
      body: introFor(input),
    },
    {
      heading: "Main points",
      body: bulletClaims({
        rows: input.rows,
        citationIdBySource: input.citationIdBySource,
        maxClaims: 6,
        maxChars: 260,
      }),
    },
    ...commonSections(input),
  ]);
}

function renderGeneral(input: RenderAnswerInput): string {
  return markdownDocument([
    {
      heading: "Answer",
      body: compact([
        introFor(input),
        "",
        numberedClaims({
          rows: input.rows,
          citationIdBySource: input.citationIdBySource,
          maxClaims: 10,
          maxChars: 320,
        }),
      ]),
    },
    ...commonSections(input),
  ]);
}

export function renderAnswerMarkdown(input: RenderAnswerInput): string {
  if (input.mode === "comparison") return renderComparison(input);
  if (input.mode === "how_to") return renderHowTo(input);
  if (input.mode === "research_summary") return renderResearchSummary(input);
  return renderGeneral(input);
}
'''

ANSWER_MODE_TEST_TS = r'''
import { describe, expect, it } from "vitest";
import { detectAnswerMode } from "../answer-mode.js";

describe("detectAnswerMode", () => {
  it("detects comparison queries", () => {
    expect(detectAnswerMode("Compare Meta Ads API vs Google Ads API")).toBe("comparison");
  });

  it("detects how-to queries", () => {
    expect(detectAnswerMode("How to authenticate with Brand.dev API?")).toBe("how_to");
  });

  it("detects research summary queries", () => {
    expect(detectAnswerMode("Give me an overview of Mem0 memory architecture")).toBe(
      "research_summary"
    );
  });

  it("uses useCase as a fallback signal", () => {
    expect(detectAnswerMode("Meta and Google", "comparison")).toBe("comparison");
  });
});
'''

CITATION_VERIFIER_TEST_TS = r'''
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
'''

EVIDENCE_EXTRACTOR_TEST_TS = r'''
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
'''

MEMORY_RANKING_TEST_TS = r'''
import { describe, expect, it } from "vitest";
import { scoreResourceWithMemory } from "../memory-ranking.js";
import type { ResourceCandidate } from "../source-types.js";
import type { ScoutMemory } from "../../memory/memory-types.js";

function resource(overrides: Partial<ResourceCandidate> = {}): ResourceCandidate {
  return {
    title: "Example API Docs",
    url: "https://docs.example.com/auth",
    tier: "official_docs",
    reason: "Official docs",
    source: "registry",
    product: "Example API",
    domain: "docs.example.com",
    ...overrides,
  };
}

function memory(overrides: Partial<ScoutMemory> = {}): ScoutMemory {
  return {
    id: "mem_1",
    projectId: "project_1",
    scope: "source",
    kind: "source_quality",
    text: "Useful source",
    entities: ["Example API"],
    sourceUrls: ["https://docs.example.com/auth"],
    confidence: 0.9,
    metadata: {},
    createdAt: new Date(),
    ...overrides,
  };
}

describe("scoreResourceWithMemory", () => {
  it("boosts source_quality URL matches", () => {
    const result = scoreResourceWithMemory({
      query: "Example API auth",
      resource: resource(),
      memoryHints: [memory()],
    });

    expect(result.scoreDelta).toBeGreaterThan(0);
    expect(result.matchedBy.some((item) => item.includes("source_quality"))).toBe(true);
  });

  it("penalizes source_failure URL matches", () => {
    const result = scoreResourceWithMemory({
      query: "Example API auth",
      resource: resource(),
      memoryHints: [memory({ kind: "source_failure", text: "Failed source" })],
    });

    expect(result.scoreDelta).toBeLessThan(0);
    expect(result.matchedBy.some((item) => item.includes("source_failure"))).toBe(true);
  });

  it("lightly boosts durable fact entity matches", () => {
    const result = scoreResourceWithMemory({
      query: "Example API auth",
      resource: resource(),
      memoryHints: [
        memory({
          kind: "durable_fact",
          scope: "project",
          text: "Example API requires OAuth.",
          sourceUrls: [],
          entities: ["Example API"],
        }),
      ],
    });

    expect(result.scoreDelta).toBeGreaterThan(0);
    expect(result.matchedBy.some((item) => item.includes("durable_fact_entity"))).toBe(true);
  });
});
'''

ANSWER_SYNTHESIZER_TEST_TS = r'''
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
'''


def update_package_json() -> None:
    path = ROOT / "packages/knowledge/package.json"
    data = json.loads(path.read_text(encoding="utf-8"))

    scripts = data.setdefault("scripts", {})
    scripts["typecheck"] = "tsc --noEmit"
    scripts["test"] = "vitest run"

    exports = data.setdefault("exports", {})
    exports["./research/answer-mode"] = "./src/research/answer-mode.js"
    exports["./research/answer-mode.js"] = "./src/research/answer-mode.js"
    exports["./research/answer-renderers"] = "./src/research/answer-renderers.js"
    exports["./research/answer-renderers.js"] = "./src/research/answer-renderers.js"

    dev_deps = data.setdefault("devDependencies", {})
    dev_deps["typescript"] = "^5.6.3"
    dev_deps["vitest"] = "^2.1.8"
    dev_deps["@types/node"] = "^22.10.2"

    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print("updated packages/knowledge/package.json")


def update_index_exports() -> None:
    path = "packages/knowledge/src/index.ts"
    text = read(path)

    additions = [
        'export * from "./research/answer-mode.js";',
        'export * from "./research/answer-renderers.js";',
    ]

    for line in additions:
        if line not in text:
            marker = 'export * from "./research/answer-synthesizer.js";'
            text = text.replace(marker, marker + "\n" + line)

    write(path, text)


def update_todo() -> None:
    path = ROOT / "docs/TODO.md"
    text = path.read_text(encoding="utf-8") if path.exists() else "# Scout TODO\n"
    append = r'''
## Done in v2 Slice 8

- [x] Added initial unit tests for evidence extraction.
- [x] Added citation verifier tests.
- [x] Added memory ranking tests.
- [x] Added answer mode tests.
- [x] Added answer synthesizer tests.
- [x] Added package-level typecheck and test scripts.
- [x] Exported answer mode and answer renderers from the knowledge package.

## Now

### Stabilization

- [ ] Run `npm install`.
- [ ] Run `npm --workspace packages/knowledge run typecheck`.
- [ ] Run `npm --workspace packages/knowledge test`.
- [ ] Fix any TypeScript/test failures.
- [ ] Add orchestrator integration test with mocked search/crawl.
- [ ] Add CI command for package tests.
'''
    if "Done in v2 Slice 8" not in text:
        text = text.rstrip() + "\n\n" + append.strip() + "\n"
    path.write_text(text, encoding="utf-8")
    print("updated docs/TODO.md")


def update_lessons() -> None:
    path = ROOT / "docs/LESSONS.md"
    text = path.read_text(encoding="utf-8") if path.exists() else "# Scout Lessons\n"
    append = r'''
## Research Engine v2 Slice 8

- After a large deterministic pipeline lands, tests are the next feature.
- Public package exports must match README-documented modules.
- Renderer code should share helpers for common sections, citations, and claim formatting.
- Unit tests should lock down evidence safety before adding LLM polish or GraphAgent.
'''
    if "Research Engine v2 Slice 8" not in text:
        text = text.rstrip() + "\n\n" + append.strip() + "\n"
    path.write_text(text, encoding="utf-8")
    print("updated docs/LESSONS.md")


def main() -> None:
    assert_repo_root()

    write("packages/knowledge/src/research/answer-renderers.ts", ANSWER_RENDERERS_TS)
    write("packages/knowledge/src/research/__tests__/answer-mode.test.ts", ANSWER_MODE_TEST_TS)
    write("packages/knowledge/src/research/__tests__/citation-verifier.test.ts", CITATION_VERIFIER_TEST_TS)
    write("packages/knowledge/src/research/__tests__/evidence-extractor.test.ts", EVIDENCE_EXTRACTOR_TEST_TS)
    write("packages/knowledge/src/research/__tests__/memory-ranking.test.ts", MEMORY_RANKING_TEST_TS)
    write("packages/knowledge/src/research/__tests__/answer-synthesizer.test.ts", ANSWER_SYNTHESIZER_TEST_TS)

    update_package_json()
    update_index_exports()
    update_todo()
    update_lessons()

    print("\nDone.")
    print("\nNext commands:")
    print("  npm install")
    print("  npm --workspace packages/knowledge run typecheck")
    print("  npm --workspace packages/knowledge test")
    print("\nIf tests pass, next step is orchestrator integration test with mocked search/crawl.")
    print("Do not add GraphAgent, swarm, or LLM polish until tests are green.")


if __name__ == "__main__":
    main()
