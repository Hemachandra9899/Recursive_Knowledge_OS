import type {
  AnswerCitation,
  AnswerMode,
  EvidenceItem,
  EvidencePack,
  SynthesizedAnswer,
  SourceTier,
  CitationVerificationStatus,
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
  return clean.slice(0, maxChars - 3) + "...";
}

function sourceKey(item: EvidenceItem): string {
  return item.url || item.title + ":" + item.tier;
}

function evidenceKey(item: EvidenceItem): string {
  return item.url + "::" + item.claim.toLowerCase().replace(/\s+/g, " ").trim();
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

  return { citationBySource, citationIdBySource };
}

function statusLabel(status: CitationVerificationStatus): string {
  if (status === "supported") return "supported";
  if (status === "weak") return "weak";
  return "unsupported";
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
  };
}

export function confidenceForAnswer(rows: EvidenceWithStatus[]): number {
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
  return citationId ? " [" + citationId + "]" : "";
}

function buildSourcesMarkdown(citations: AnswerCitation[]): string {
  if (citations.length === 0) return "";
  return citations
    .map((citation) => "[" + citation.id + "] " + citation.title + " -- " + citation.url)
    .join("\n");
}

function buildEvidenceNotesMarkdown(rows: EvidenceWithStatus[]): string {
  return rows
    .slice(0, 6)
    .map((row, index) => {
      const section = row.item.section ? ', section "' + row.item.section + '"' : "";
      return (index + 1) + ". " + statusLabel(row.status) + " evidence from " + row.item.title + section + ': "' + shorten(row.item.quote, 220) + '"';
    })
    .join("\n");
}

function groupByProductOrDomain(rows: EvidenceWithStatus[]): Map<string, EvidenceWithStatus[]> {
  const groups = new Map<string, EvidenceWithStatus[]>();
  for (const row of rows) {
    const key = row.item.product || row.item.domain || row.item.entities[0] || row.item.title || "Other";
    const existing = groups.get(key) ?? [];
    existing.push(row);
    groups.set(key, existing);
  }
  return groups;
}

export function buildComparisonMarkdown(input: {
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
        .map((row) => shorten(row.item.claim, 140) + citationSuffix({ item: row.item, citationIdBySource: input.citationIdBySource }))
        .join("<br>");
      return "| " + name + " | " + (summary || "No supported evidence found.") + " |";
    })
    .join("\n");

  const topClaims = input.rows
    .slice(0, 5)
    .map((row, index) => {
      const prefix = row.status === "weak" ? "Likely: " : "";
      return (index + 1) + ". " + prefix + shorten(row.item.claim, 260) + citationSuffix({ item: row.item, citationIdBySource: input.citationIdBySource });
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

export function buildHowToMarkdown(input: {
  rows: EvidenceWithStatus[];
  citations: AnswerCitation[];
  citationIdBySource: Map<string, number>;
  status: SynthesizedAnswer["status"];
}): string {
  const steps = input.rows
    .slice(0, 8)
    .map((row, index) => {
      const prefix = row.status === "weak" ? "Likely: " : "";
      return (index + 1) + ". " + prefix + shorten(row.item.claim, 280) + citationSuffix({ item: row.item, citationIdBySource: input.citationIdBySource });
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

export function buildResearchSummaryMarkdown(input: {
  rows: EvidenceWithStatus[];
  citations: AnswerCitation[];
  citationIdBySource: Map<string, number>;
  status: SynthesizedAnswer["status"];
}): string {
  const summaryClaims = input.rows
    .slice(0, 6)
    .map((row) => {
      const prefix = row.status === "weak" ? "Likely: " : "";
      return "- " + prefix + shorten(row.item.claim, 260) + citationSuffix({ item: row.item, citationIdBySource: input.citationIdBySource });
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

export function buildGeneralMarkdown(input: {
  rows: EvidenceWithStatus[];
  citations: AnswerCitation[];
  citationIdBySource: Map<string, number>;
  status: SynthesizedAnswer["status"];
}): string {
  const claims = input.rows
    .slice(0, 10)
    .map((row, index) => {
      const prefix = row.status === "weak" ? "Likely: " : "";
      return (index + 1) + ". " + prefix + shorten(row.item.claim, 320) + citationSuffix({ item: row.item, citationIdBySource: input.citationIdBySource });
    })
    .join("\n");

  return [
    "## Answer",
    "",
    input.status === "answered"
      ? "Based on " + input.rows.filter((row) => row.status === "supported").length + " supported claim(s) from " + input.citations.length + " source(s), here is the grounded answer."
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

export function renderMarkdownForMode(input: {
  mode: string;
  query: string;
  rows: EvidenceWithStatus[];
  citations: AnswerCitation[];
  citationIdBySource: Map<string, number>;
  status: SynthesizedAnswer["status"];
}): string {
  if (input.mode === "comparison") return buildComparisonMarkdown(input);
  if (input.mode === "how_to") return buildHowToMarkdown(input);
  if (input.mode === "research_summary") return buildResearchSummaryMarkdown(input);
  return buildGeneralMarkdown(input);
}
