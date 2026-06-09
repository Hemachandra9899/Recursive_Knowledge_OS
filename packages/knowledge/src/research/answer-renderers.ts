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

export function groupEvidenceForAnswer(input: {
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

export function buildNoEvidenceAnswer(evidencePack: EvidencePack, mode: string): SynthesizedAnswer {
  const missing = evidencePack.coverage.missing.length
    ? evidencePack.coverage.missing.map((item) => "- " + item).join("\n")
    : "- No supported or weak claim-level evidence was available.";

  return {
    status: "insufficient_evidence",
    mode: mode as AnswerMode,
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
    groundingAudit: {
      status: "pass",
      citationIdsReferenced: [],
      citationIdsDeclared: [],
      missingCitationIds: [],
      unusedCitationIds: [],
      unsupportedCitationIds: [],
      groundedClaimCount: 0,
      issueCount: 0,
      issues: [],
    },
  };
}

export function renderMarkdownForMode(input: RenderAnswerInput): string {
  return renderAnswerMarkdown(input);
}

export function renderAnswerMarkdown(input: RenderAnswerInput): string {
  if (input.mode === "comparison") return renderComparison(input);
  if (input.mode === "how_to") return renderHowTo(input);
  if (input.mode === "research_summary") return renderResearchSummary(input);
  return renderGeneral(input);
}
