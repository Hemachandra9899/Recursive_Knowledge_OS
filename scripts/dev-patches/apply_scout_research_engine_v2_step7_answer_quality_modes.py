#!/usr/bin/env python3
# Apply Scout Research Engine v2 Step 7: Answer Quality Modes.
#
# Run from Scout repo root on branch:
#   feat/research-engine-v2
#
# This patch improves deterministic answer synthesis:
# - Detects answer mode: comparison / how_to / research_summary / general.
# - Renders comparison questions as a comparison table + takeaways.
# - Renders implementation/debug questions as grounded steps.
# - Renders broad research questions as a concise research summary.
# - Keeps citations source-numbered and evidence constrained.
# - Updates types, exports docs, TODO, and LESSONS.
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
        "packages/knowledge/src/research/answer-synthesizer.ts",
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

export type AnswerMode =
  | "comparison"
  | "how_to"
  | "research_summary"
  | "general";

export type SynthesizedAnswer = {
  status: "answered" | "partial" | "insufficient_evidence";
  mode: AnswerMode;
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
  AnswerMode,
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

function shorten(text: string, maxChars: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars - 3)}...`;
}

function sourceKey(item: EvidenceItem): string {
  return item.url || `${item.title}:${item.tier}`;
}

function evidenceKey(item: EvidenceItem): string {
  return `${item.url}::${item.claim.toLowerCase().replace(/\s+/g, " ").trim()}`;
}

function detectAnswerMode(query: string, evidencePack: EvidencePack): AnswerMode {
  const q = query.toLowerCase();

  if (
    /\b(compare|comparison|versus|vs\.?|difference|differences|better|pros and cons|trade[-\s]?off|tradeoff)\b/.test(
      q
    ) ||
    evidencePack.useCase === "comparison"
  ) {
    return "comparison";
  }

  if (
    /\b(how to|implement|implementation|fix|debug|setup|set up|configure|install|integrate|deploy|error|issue|steps|guide)\b/.test(
      q
    ) ||
    evidencePack.useCase === "implementation_help" ||
    evidencePack.useCase === "tutorial"
  ) {
    return "how_to";
  }

  if (
    /\b(overview|summarize|summary|explain|what is|research|tell me about|deep dive|analysis)\b/.test(
      q
    )
  ) {
    return "research_summary";
  }

  return "general";
}

function scoreEvidence(query: string, item: EvidenceItem, status: CitationVerificationStatus): number {
  const queryTokens = new Set(tokenize(query));
  const itemTokens = new Set(
    tokenize([item.claim, item.section, item.product, item.domain, ...item.entities].filter(Boolean).join(" "))
  );

  const overlap = [...itemTokens].filter((token) => queryTokens.has(token)).length;
  const statusWeight = status === "supported" ? 40 : status === "weak" ? 12 : -100;

  return statusWeight + item.confidence * 35 + tierWeight(item.tier) + overlap * 3;
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

function buildNoEvidenceAnswer(evidencePack: EvidencePack, mode: AnswerMode): SynthesizedAnswer {
  const missing = evidencePack.coverage.missing.length
    ? evidencePack.coverage.missing.map((item) => `- ${item}`).join("\n")
    : "- No supported or weak claim-level evidence was available.";

  return {
    status: "insufficient_evidence",
    mode,
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

function citationSuffix(input: {
  item: EvidenceItem;
  citationIdBySource: Map<string, number>;
}): string {
  const citationId = input.citationIdBySource.get(sourceKey(input.item));
  return citationId ? ` [${citationId}]` : "";
}

function buildSourcesMarkdown(citations: AnswerCitation[]): string {
  if (citations.length === 0) return "";

  return citations
    .map((citation) => `[${citation.id}] ${citation.title} — ${citation.url}`)
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

function groupByProductOrDomain(rows: EvidenceWithStatus[]): Map<string, EvidenceWithStatus[]> {
  const groups = new Map<string, EvidenceWithStatus[]>();

  for (const row of rows) {
    const key =
      row.item.product ||
      row.item.domain ||
      row.item.entities[0] ||
      row.item.title ||
      "Other";

    const existing = groups.get(key) ?? [];
    existing.push(row);
    groups.set(key, existing);
  }

  return groups;
}

function buildComparisonMarkdown(input: {
  query: string;
  rows: EvidenceWithStatus[];
  citations: AnswerCitation[];
  citationIdBySource: Map<string, number>;
  status: SynthesizedAnswer["status"];
}): string {
  const groups = groupByProductOrDomain(input.rows);
  const groupNames = [...groups.keys()].slice(0, 4);

  const tableRows = groupNames
    .map((name) => {
      const claims = (groups.get(name) ?? []).slice(0, 3);
      const summary = claims
        .map((row) => `${shorten(row.item.claim, 140)}${citationSuffix({ item: row.item, citationIdBySource: input.citationIdBySource })}`)
        .join("<br>");
      return `| ${name} | ${summary || "No supported evidence found."} |`;
    })
    .join("\n");

  const topClaims = input.rows
    .slice(0, 5)
    .map((row, index) => {
      const prefix = row.status === "weak" ? "Likely: " : "";
      return `${index + 1}. ${prefix}${shorten(row.item.claim, 260)}${citationSuffix({ item: row.item, citationIdBySource: input.citationIdBySource })}`;
    })
    .join("\n");

  return [
    "## Answer",
    "",
    input.status === "answered"
      ? "Here is the grounded comparison based on supported evidence."
      : "I found limited evidence, so treat this as a partial comparison.",
    "",
    "## Comparison table",
    "",
    "| Topic | Evidence-backed points |",
    "|---|---|",
    tableRows || "| Evidence | No comparable supported evidence found. |",
    "",
    "## Key takeaways",
    "",
    topClaims,
    "",
    "## Evidence notes",
    "",
    buildEvidenceNotesMarkdown(input.rows),
    "",
    "## Sources",
    "",
    buildSourcesMarkdown(input.citations),
  ]
    .filter((part) => part.trim().length > 0)
    .join("\n");
}

function buildHowToMarkdown(input: {
  rows: EvidenceWithStatus[];
  citations: AnswerCitation[];
  citationIdBySource: Map<string, number>;
  status: SynthesizedAnswer["status"];
}): string {
  const steps = input.rows
    .slice(0, 8)
    .map((row, index) => {
      const prefix = row.status === "weak" ? "Likely: " : "";
      return `${index + 1}. ${prefix}${shorten(row.item.claim, 280)}${citationSuffix({ item: row.item, citationIdBySource: input.citationIdBySource })}`;
    })
    .join("\n");

  return [
    "## Answer",
    "",
    input.status === "answered"
      ? "Here are the evidence-backed steps/details."
      : "I found limited evidence, so treat these as partial steps.",
    "",
    "## Steps / implementation notes",
    "",
    steps,
    "",
    "## Things to verify",
    "",
    "- Check the linked official/trusted source before production use.",
    "- Treat weak evidence as a hint, not a final fact.",
    "- Re-run research with a narrower query if any required setup detail is missing.",
    "",
    "## Evidence notes",
    "",
    buildEvidenceNotesMarkdown(input.rows),
    "",
    "## Sources",
    "",
    buildSourcesMarkdown(input.citations),
  ]
    .filter((part) => part.trim().length > 0)
    .join("\n");
}

function buildResearchSummaryMarkdown(input: {
  rows: EvidenceWithStatus[];
  citations: AnswerCitation[];
  citationIdBySource: Map<string, number>;
  status: SynthesizedAnswer["status"];
}): string {
  const summaryClaims = input.rows
    .slice(0, 6)
    .map((row) => {
      const prefix = row.status === "weak" ? "Likely: " : "";
      return `- ${prefix}${shorten(row.item.claim, 260)}${citationSuffix({ item: row.item, citationIdBySource: input.citationIdBySource })}`;
    })
    .join("\n");

  return [
    "## Answer",
    "",
    input.status === "answered"
      ? "Here is the grounded research summary."
      : "I found limited evidence, so this is a partial research summary.",
    "",
    "## Main points",
    "",
    summaryClaims,
    "",
    "## Evidence notes",
    "",
    buildEvidenceNotesMarkdown(input.rows),
    "",
    "## Sources",
    "",
    buildSourcesMarkdown(input.citations),
  ]
    .filter((part) => part.trim().length > 0)
    .join("\n");
}

function buildGeneralMarkdown(input: {
  rows: EvidenceWithStatus[];
  citations: AnswerCitation[];
  citationIdBySource: Map<string, number>;
  status: SynthesizedAnswer["status"];
}): string {
  const claims = input.rows
    .slice(0, 10)
    .map((row, index) => {
      const prefix = row.status === "weak" ? "Likely: " : "";
      return `${index + 1}. ${prefix}${shorten(row.item.claim, 320)}${citationSuffix({ item: row.item, citationIdBySource: input.citationIdBySource })}`;
    })
    .join("\n");

  return [
    "## Answer",
    "",
    input.status === "answered"
      ? `Based on ${input.rows.filter((row) => row.status === "supported").length} supported claim(s) from ${input.citations.length} source(s), here is the grounded answer.`
      : "I found only weak evidence, so treat this as a partial answer.",
    "",
    claims,
    "",
    "## Evidence notes",
    "",
    buildEvidenceNotesMarkdown(input.rows),
    "",
    "## Sources",
    "",
    buildSourcesMarkdown(input.citations),
  ]
    .filter((part) => part.trim().length > 0)
    .join("\n");
}

function renderMarkdownForMode(input: {
  mode: AnswerMode;
  query: string;
  rows: EvidenceWithStatus[];
  citations: AnswerCitation[];
  citationIdBySource: Map<string, number>;
  status: SynthesizedAnswer["status"];
}): string {
  if (input.mode === "comparison") {
    return buildComparisonMarkdown(input);
  }

  if (input.mode === "how_to") {
    return buildHowToMarkdown(input);
  }

  if (input.mode === "research_summary") {
    return buildResearchSummaryMarkdown(input);
  }

  return buildGeneralMarkdown(input);
}

export function synthesizeAnswerFromEvidencePack(input: {
  query: string;
  evidencePack: EvidencePack;
  maxClaims?: number;
  mode?: AnswerMode;
}): SynthesizedAnswer {
  const mode = input.mode ?? detectAnswerMode(input.query, input.evidencePack);
  const maxClaims = input.maxClaims ?? (mode === "comparison" ? 14 : 10);

  const rows = groupEvidenceForAnswer({
    query: input.query,
    evidencePack: input.evidencePack,
    maxClaims,
  });

  if (rows.length === 0) {
    return buildNoEvidenceAnswer(input.evidencePack, mode);
  }

  const supportedEvidenceCount = rows.filter((row) => row.status === "supported").length;
  const weakEvidenceCount = rows.filter((row) => row.status === "weak").length;
  const status: SynthesizedAnswer["status"] =
    supportedEvidenceCount > 0 ? "answered" : "partial";

  const { citationBySource, citationIdBySource } = buildCitationMap(rows.map((row) => row.item));
  const citations = [...citationBySource.values()];

  const markdown = renderMarkdownForMode({
    mode,
    query: input.query,
    rows,
    citations,
    citationIdBySource,
    status,
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
  };
}
'''


TODO_APPEND = '''
## Done in v2 Slice 6

- [x] Added answer quality modes.
- [x] Added comparison-specific rendering with a comparison table.
- [x] Added how-to/debug rendering with steps and verification notes.
- [x] Added research-summary rendering for broad overview questions.
- [x] Added `answer.mode` to the synthesized answer output.

## Now

### Product/API cleanup

- [ ] Add tests for answer mode detection.
- [ ] Add tests for comparison/how-to/research-summary rendering.
- [ ] Expose answer mode in the UI.
- [ ] Add a source drawer UI for `answer.citations`.
- [ ] Remove root-level patch scripts or move them under `scripts/dev-patches/` before merging.
'''


LESSONS_APPEND = '''
## Research Engine v2 Slice 6

- One generic answer format is not enough. Comparison, how-to, and research-summary questions need different structure.
- Answer rendering can remain deterministic while still feeling useful.
- The answer layer should never introduce new facts; it should only reorganize verified evidence.
- Optional LLM polish should come after deterministic modes, not before.
'''


def update_todo() -> None:
    path = ROOT / "docs/TODO.md"
    if not path.exists():
        write("docs/TODO.md", "# Scout TODO\n\n" + TODO_APPEND)
        return

    text = path.read_text(encoding="utf-8").rstrip()
    if "Done in v2 Slice 6" not in text:
        text += "\n\n" + TODO_APPEND.strip() + "\n"
    path.write_text(text, encoding="utf-8")
    print("updated docs/TODO.md")


def update_lessons() -> None:
    path = ROOT / "docs/LESSONS.md"
    if not path.exists():
        write("docs/LESSONS.md", "# Scout Lessons\n\n" + LESSONS_APPEND)
        return

    text = path.read_text(encoding="utf-8").rstrip()
    if "Research Engine v2 Slice 6" not in text:
        text += "\n\n" + LESSONS_APPEND.strip() + "\n"
    path.write_text(text, encoding="utf-8")
    print("updated docs/LESSONS.md")


def main() -> None:
    assert_repo_root()

    write("packages/knowledge/src/research/source-types.ts", SOURCE_TYPES_TS)
    write("packages/knowledge/src/research/answer-synthesizer.ts", ANSWER_SYNTHESIZER_TS)

    update_todo()
    update_lessons()

    print("\nDone.")
    print("\nNext commands:")
    print("  npm run prisma:generate")
    print("  docker compose build api worker model-service")
    print("  docker compose up")
    print("\nSmoke tests:")
    print("  1. Compare query should return answer.mode = comparison.")
    print("  2. How-to query should return answer.mode = how_to.")
    print("  3. Overview query should return answer.mode = research_summary.")


if __name__ == "__main__":
    main()
