#!/usr/bin/env python3
# Apply Scout Research Engine v2 Step 20:
# Answer grounding audit.
#
# Run from Scout repo root on main AFTER Step 19.
#
# Why:
# Evidence is now filtered, but the final answer boundary still needs a guardrail:
# - every [n] citation in markdown should map to answer.citations[n]
# - every declared citation should be used in markdown
# - every used citation should map back to kept evidence rows
# - no unsupported evidence should appear in final answer rows
#
# This patch:
# - Adds answer-grounding.ts.
# - Adds AnswerGroundingAudit types.
# - Adds groundingAudit to SynthesizedAnswer.
# - Runs audit inside synthesizeAnswerFromEvidencePack().
# - Adds tests for grounding audit + synthesized answer audit.
#
# After applying:
#   npm run typecheck:knowledge
#   npm run test:knowledge

from __future__ import annotations

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
        "packages/knowledge/src/research/answer-synthesizer.ts",
        "packages/knowledge/src/research/answer-renderers.ts",
        "packages/knowledge/src/research/source-types.ts",
    ]
    missing = [p for p in required if not (ROOT / p).exists()]
    if missing:
        raise SystemExit(
            "Run from Scout repo root after Step 19. Missing:\n"
            + "\n".join(f"- {p}" for p in missing)
        )


ANSWER_GROUNDING_TS = r'''
import type {
  AnswerCitation,
  AnswerGroundingAudit,
  AnswerGroundingIssue,
  CitationVerificationStatus,
  EvidenceItem,
} from "./source-types.js";
import type { EvidenceWithStatus } from "./answer-renderers.js";

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function sourceKey(item: EvidenceItem): string {
  return item.url || `${item.title}:${item.tier}`;
}

function citationIdsFromMarkdown(markdown: string): number[] {
  const matches = markdown.match(/\[(\d+)\]/g) ?? [];

  return uniqueSorted(
    matches
      .map((match) => Number(match.replace(/[[\]]/g, "")))
      .filter((value) => Number.isFinite(value) && value > 0)
  );
}

function statusForAudit(issues: AnswerGroundingIssue[]): AnswerGroundingAudit["status"] {
  if (issues.some((issue) => issue.severity === "error")) return "fail";
  if (issues.length > 0) return "warning";
  return "pass";
}

function citationIdsForRows(input: {
  rows: EvidenceWithStatus[];
  citationIdBySource: Map<string, number>;
}): number[] {
  return uniqueSorted(
    input.rows
      .map((row) => input.citationIdBySource.get(sourceKey(row.item)))
      .filter((value): value is number => typeof value === "number")
  );
}

function unsupportedCitationIds(input: {
  rows: Array<{ item: EvidenceItem; status: CitationVerificationStatus }>;
  citationIdBySource: Map<string, number>;
}): number[] {
  return uniqueSorted(
    input.rows
      .filter((row) => row.status === "unsupported")
      .map((row) => input.citationIdBySource.get(sourceKey(row.item)))
      .filter((value): value is number => typeof value === "number")
  );
}

export function auditAnswerGrounding(input: {
  markdown: string;
  citations: AnswerCitation[];
  rows: EvidenceWithStatus[];
  citationIdBySource: Map<string, number>;
}): AnswerGroundingAudit {
  const issues: AnswerGroundingIssue[] = [];

  const citationIdsReferenced = citationIdsFromMarkdown(input.markdown);
  const citationIdsDeclared = uniqueSorted(input.citations.map((citation) => citation.id));
  const citationIdsFromRows = citationIdsForRows({
    rows: input.rows,
    citationIdBySource: input.citationIdBySource,
  });

  const declared = new Set(citationIdsDeclared);
  const referenced = new Set(citationIdsReferenced);
  const rowBacked = new Set(citationIdsFromRows);

  const missingCitationIds = citationIdsReferenced.filter((id) => !declared.has(id));
  const unusedCitationIds = citationIdsDeclared.filter((id) => !referenced.has(id));
  const unbackedCitationIds = citationIdsReferenced.filter((id) => !rowBacked.has(id));
  const unsupportedIds = unsupportedCitationIds({
    rows: input.rows,
    citationIdBySource: input.citationIdBySource,
  }).filter((id) => referenced.has(id));

  for (const id of missingCitationIds) {
    issues.push({
      code: "missing_declared_citation",
      severity: "error",
      message: `Markdown references citation [${id}], but answer.citations does not declare it.`,
      citationId: id,
    });
  }

  for (const id of unbackedCitationIds) {
    issues.push({
      code: "citation_without_evidence",
      severity: "error",
      message: `Markdown references citation [${id}], but no kept evidence row backs it.`,
      citationId: id,
    });
  }

  for (const id of unsupportedIds) {
    issues.push({
      code: "unsupported_citation_used",
      severity: "error",
      message: `Markdown references citation [${id}] from unsupported evidence.`,
      citationId: id,
    });
  }

  for (const id of unusedCitationIds) {
    issues.push({
      code: "declared_citation_unused",
      severity: "warning",
      message: `answer.citations declares [${id}], but the Markdown does not use it.`,
      citationId: id,
    });
  }

  if (input.rows.length > 0 && citationIdsReferenced.length === 0) {
    issues.push({
      code: "answer_has_evidence_but_no_citations",
      severity: "error",
      message: "Answer used evidence rows but rendered no inline citation markers.",
    });
  }

  return {
    status: statusForAudit(issues),
    citationIdsReferenced,
    citationIdsDeclared,
    missingCitationIds,
    unusedCitationIds,
    unsupportedCitationIds: unsupportedIds,
    groundedClaimCount: input.rows.length,
    issueCount: issues.length,
    issues,
  };
}

export function emptyAnswerGroundingAudit(): AnswerGroundingAudit {
  return {
    status: "pass",
    citationIdsReferenced: [],
    citationIdsDeclared: [],
    missingCitationIds: [],
    unusedCitationIds: [],
    unsupportedCitationIds: [],
    groundedClaimCount: 0,
    issueCount: 0,
    issues: [],
  };
}
'''


ANSWER_GROUNDING_TEST_TS = r'''
import { describe, expect, it } from "vitest";
import { auditAnswerGrounding } from "../answer-grounding.js";
import type { AnswerCitation, EvidenceItem } from "../source-types.js";
import type { EvidenceWithStatus } from "../answer-renderers.js";

function evidence(overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    claim: "The Example API requires OAuth access tokens for authenticated requests.",
    quote: "The Example API requires OAuth access tokens for authenticated requests.",
    title: "Example Docs",
    url: "https://docs.example.com/auth",
    section: "Authentication",
    tier: "official_docs",
    confidence: 0.95,
    entities: ["Example API", "OAuth"],
    reason: "Official docs",
    ...overrides,
  };
}

function citation(overrides: Partial<AnswerCitation> = {}): AnswerCitation {
  return {
    id: 1,
    title: "Example Docs",
    url: "https://docs.example.com/auth",
    tier: "official_docs",
    usedClaims: 1,
    ...overrides,
  };
}

describe("auditAnswerGrounding", () => {
  it("passes when markdown citations are declared and backed by evidence rows", () => {
    const citationIdBySource = new Map([["https://docs.example.com/auth", 1]]);
    const rows: EvidenceWithStatus[] = [
      {
        item: evidence(),
        status: "supported",
        score: 100,
      },
    ];

    const audit = auditAnswerGrounding({
      markdown: "The API requires OAuth tokens [1].",
      citations: [citation()],
      rows,
      citationIdBySource,
    });

    expect(audit.status).toBe("pass");
    expect(audit.issueCount).toBe(0);
    expect(audit.citationIdsReferenced).toEqual([1]);
  });

  it("fails when markdown references undeclared citations", () => {
    const audit = auditAnswerGrounding({
      markdown: "The API requires OAuth tokens [2].",
      citations: [citation()],
      rows: [],
      citationIdBySource: new Map(),
    });

    expect(audit.status).toBe("fail");
    expect(audit.missingCitationIds).toEqual([2]);
    expect(audit.issues.some((issue) => issue.code === "missing_declared_citation")).toBe(true);
  });

  it("warns when citations are declared but unused", () => {
    const audit = auditAnswerGrounding({
      markdown: "The API requires OAuth tokens.",
      citations: [citation()],
      rows: [],
      citationIdBySource: new Map(),
    });

    expect(audit.status).toBe("warning");
    expect(audit.unusedCitationIds).toEqual([1]);
  });

  it("fails when evidence rows exist but markdown renders no citation markers", () => {
    const citationIdBySource = new Map([["https://docs.example.com/auth", 1]]);
    const rows: EvidenceWithStatus[] = [
      {
        item: evidence(),
        status: "supported",
        score: 100,
      },
    ];

    const audit = auditAnswerGrounding({
      markdown: "The API requires OAuth tokens.",
      citations: [citation()],
      rows,
      citationIdBySource,
    });

    expect(audit.status).toBe("fail");
    expect(audit.issues.some((issue) => issue.code === "answer_has_evidence_but_no_citations")).toBe(true);
  });
});
'''


ANSWER_SYNTHESIZER_AUDIT_TEST_TS = r'''
import { describe, expect, it } from "vitest";
import { synthesizeAnswerFromEvidencePack } from "../answer-synthesizer.js";
import type { EvidencePack } from "../source-types.js";

function pack(): EvidencePack {
  return {
    query: "Example API authentication",
    useCase: "api_facts",
    resourcesPlanned: [],
    evidence: [
      {
        claim: "The Example API requires OAuth access tokens for authenticated requests and supports refresh token rotation.",
        quote: "The Example API requires OAuth access tokens for authenticated requests and supports refresh token rotation.",
        title: "Example Docs",
        url: "https://docs.example.com/auth",
        section: "Authentication",
        tier: "official_docs",
        confidence: 0.95,
        entities: ["Example API", "OAuth"],
        reason: "Official docs",
      },
    ],
    citationVerification: [
      {
        status: "supported",
        claim: "The Example API requires OAuth access tokens for authenticated requests and supports refresh token rotation.",
        supportingUrls: ["https://docs.example.com/auth"],
        reason: "Supported by quote.",
      },
    ],
    coverage: {
      hasEvidence: true,
      sourceCount: 1,
      claimCount: 1,
      rawClaimCount: 1,
      filteredClaimCount: 1,
      qualityRejectedClaimCount: 0,
      duplicateRejectedClaimCount: 0,
      uniqueSourceCount: 1,
      officialSourceCount: 1,
      supportedClaimCount: 1,
      weakClaimCount: 0,
      unsupportedClaimCount: 0,
      missing: [],
    },
  };
}

describe("synthesizeAnswerFromEvidencePack grounding audit", () => {
  it("includes a passing grounding audit for normal synthesized answers", () => {
    const answer = synthesizeAnswerFromEvidencePack({
      query: "Example API authentication",
      evidencePack: pack(),
    });

    expect(answer.groundingAudit.status).toBe("pass");
    expect(answer.groundingAudit.citationIdsReferenced).toEqual([1]);
    expect(answer.groundingAudit.groundedClaimCount).toBe(1);
  });
});
'''


def patch_source_types() -> None:
    path = "packages/knowledge/src/research/source-types.ts"
    text = read(path)

    if "export type AnswerGroundingIssue" not in text:
        marker = "export type SynthesizedAnswer = {"
        insert = r'''
export type AnswerGroundingIssue = {
  code:
    | "missing_declared_citation"
    | "declared_citation_unused"
    | "citation_without_evidence"
    | "unsupported_citation_used"
    | "answer_has_evidence_but_no_citations";
  severity: "warning" | "error";
  message: string;
  citationId?: number;
};

export type AnswerGroundingAudit = {
  status: "pass" | "warning" | "fail";
  citationIdsReferenced: number[];
  citationIdsDeclared: number[];
  missingCitationIds: number[];
  unusedCitationIds: number[];
  unsupportedCitationIds: number[];
  groundedClaimCount: number;
  issueCount: number;
  issues: AnswerGroundingIssue[];
};

'''
        text = text.replace(marker, insert + marker)

    if "groundingAudit: AnswerGroundingAudit;" not in text:
        text = text.replace(
            "  confidence: number;\n};",
            "  confidence: number;\n  groundingAudit: AnswerGroundingAudit;\n};"
        )

    write(path, text)


def patch_answer_synthesizer() -> None:
    path = "packages/knowledge/src/research/answer-synthesizer.ts"
    text = read(path)

    if 'from "./answer-grounding.js"' not in text:
        text = text.replace(
            '} from "./answer-renderers.js";',
            '} from "./answer-renderers.js";\nimport { auditAnswerGrounding, emptyAnswerGroundingAudit } from "./answer-grounding.js";'
        )

    if "return buildNoEvidenceAnswer(input.evidencePack, mode);" in text:
        text = text.replace(
            "return buildNoEvidenceAnswer(input.evidencePack, mode);",
            "const emptyAnswer = buildNoEvidenceAnswer(input.evidencePack, mode);\n    return {\n      ...emptyAnswer,\n      groundingAudit: emptyAnswerGroundingAudit(),\n    };"
        )

    old_return = '''  return {
    status,
    mode,
    markdown,
    citations,
    usedEvidenceCount: rows.length,
    supportedEvidenceCount,
    weakEvidenceCount,
    omittedUnsupportedCount: input.evidencePack.coverage.unsupportedClaimCount,
    confidence: confidenceForAnswer(rows),
  };'''

    new_return = '''  const groundingAudit = auditAnswerGrounding({
    markdown,
    citations,
    rows,
    citationIdBySource,
  });

  return {
    status,
    mode,
    markdown,
    citations,
    usedEvidenceCount: rows.length,
    supportedEvidenceCount,
    weakEvidenceCount,
    omittedUnsupportedCount: input.evidencePack.coverage.unsupportedClaimCount,
    confidence: confidenceForAnswer(rows),
    groundingAudit,
  };'''

    if old_return in text:
        text = text.replace(old_return, new_return)
    elif "groundingAudit" not in text:
        print("warning: could not patch answer-synthesizer return block automatically")

    write(path, text)


def patch_answer_renderers_no_evidence() -> None:
    path = "packages/knowledge/src/research/answer-renderers.ts"
    text = read(path)

    if "groundingAudit" in text:
        return

    # buildNoEvidenceAnswer returns SynthesizedAnswer, but synthesizeAnswerFromEvidencePack
    # wraps it with groundingAudit. To avoid TS errors before wrapping in some compilers,
    # cast only the local return.
    text = text.replace(
        "  return {\n    status: \"insufficient_evidence\",",
        "  return {\n    status: \"insufficient_evidence\","
    )
    # No-op placeholder; this function is patched through synthesizer spread.
    write(path, text)


def update_index_exports() -> None:
    path = "packages/knowledge/src/index.ts"
    text = read(path)

    line = 'export * from "./research/answer-grounding.js";'
    if line not in text:
        text = text.rstrip() + "\n" + line + "\n"

    write(path, text)


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


README_APPEND = r'''
---

## Answer grounding audit

Scout audits final answer citations after answer synthesis.

The audit checks:

```text
inline citation ids exist in answer.citations
declared citations are actually used
used citations map back to kept evidence rows
unsupported evidence is not cited
answers with evidence contain citation markers
```

Each answer includes:

```text
answer.groundingAudit
```

A healthy answer should have:

```text
answer.groundingAudit.status = "pass"
```
'''


TODO_APPEND = r'''
## Done in v2 Slice 18

- [x] Added answer grounding audit.
- [x] Verified Markdown citation markers against declared citations.
- [x] Verified citations map back to kept evidence rows.
- [x] Added groundingAudit to SynthesizedAnswer.
- [x] Added tests for audit failures and synthesized answer audit.

## Now

### Answer boundary validation

- [ ] Run `npm run typecheck:knowledge`.
- [ ] Run `npm run test:knowledge`.
- [ ] Run a full web-research smoke test.
- [ ] Inspect `answer.groundingAudit.status`.
- [ ] Treat non-pass grounding audit as a response warning in the API/UI.
'''


LESSONS_APPEND = r'''
## Research Engine v2 Slice 18

- The final answer boundary needs its own audit even when evidence is filtered.
- Citation rendering and citation metadata can drift unless tested directly.
- Grounding audits should be deterministic and cheap.
- Future LLM polish must pass the same grounding audit before being shown.
'''


def main() -> None:
    assert_repo_root()

    write("packages/knowledge/src/research/answer-grounding.ts", ANSWER_GROUNDING_TS)
    write("packages/knowledge/src/research/__tests__/answer-grounding.test.ts", ANSWER_GROUNDING_TEST_TS)
    write("packages/knowledge/src/research/__tests__/answer-synthesizer-grounding.test.ts", ANSWER_SYNTHESIZER_AUDIT_TEST_TS)

    patch_source_types()
    patch_answer_synthesizer()
    patch_answer_renderers_no_evidence()
    update_index_exports()

    append_once("README.md", "Answer grounding audit", README_APPEND)
    append_once("docs/TODO.md", "Done in v2 Slice 18", TODO_APPEND)
    append_once("docs/LESSONS.md", "Research Engine v2 Slice 18", LESSONS_APPEND)

    print("\nDone.")
    print("\nNext commands:")
    print("  npm run typecheck:knowledge")
    print("  npm run test:knowledge")
    print("")
    print("Then run full /tools/web-research smoke test and inspect:")
    print("  answer.groundingAudit.status")
    print("  answer.groundingAudit.issues")


if __name__ == "__main__":
    main()
