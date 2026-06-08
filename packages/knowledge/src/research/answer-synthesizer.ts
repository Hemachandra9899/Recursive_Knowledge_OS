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
