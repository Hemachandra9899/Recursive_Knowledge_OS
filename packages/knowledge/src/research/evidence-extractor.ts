import type { EvidenceItem, SourceTier } from "./source-types.js";

export type EvidenceSourcePage = {
  title: string;
  url: string;
  markdown: string;
  product?: string;
  domain?: string;
  tier: SourceTier;
  reason: string;
  metadata?: Record<string, unknown>;
};

type MarkdownSection = {
  heading: string;
  text: string;
};

const MAX_EVIDENCE_PER_PAGE = 30;
const MIN_CLAIM_LENGTH = 45;
const MAX_CLAIM_LENGTH = 520;

const CLAIM_KEYWORDS = [
  " is ",
  " are ",
  " uses ",
  " use ",
  " supports ",
  " provides ",
  " returns ",
  " requires ",
  " required ",
  " allows ",
  " includes ",
  " contains ",
  " must ",
  " should ",
  " can ",
  " cannot ",
  " endpoint",
  " api",
  " oauth",
  " authentication",
  " permission",
  " permissions",
  " rate limit",
  " quota",
  " pricing",
  " version",
  " deprec",
  " token",
  " access token",
  " scope",
  " field",
  " request",
  " response",
];

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function stripMarkdown(text: string): string {
  return normalizeWhitespace(
    text
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      .replace(/<[^>]+>/g, " ")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/^\s*\d+\.\s+/gm, "")
      .replace(/\|/g, " ")
  );
}

function splitIntoSections(markdown: string): MarkdownSection[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const sections: MarkdownSection[] = [];

  let heading = "Page";
  let buffer: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,4}\s+(.+)$/);

    if (headingMatch) {
      const text = buffer.join("\n").trim();
      if (text) {
        sections.push({ heading, text });
      }

      heading = stripMarkdown(headingMatch[1]);
      buffer = [];
      continue;
    }

    buffer.push(line);
  }

  const finalText = buffer.join("\n").trim();
  if (finalText) {
    sections.push({ heading, text: finalText });
  }

  return sections.length > 0 ? sections : [{ heading: "Page", text: markdown }];
}

function splitSentenceCandidates(text: string): string[] {
  const cleaned = stripMarkdown(text);
  const sentenceCandidates =
    cleaned.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) ?? [];

  return sentenceCandidates
    .map(stripMarkdown)
    .filter((candidate) => {
      return (
        candidate.length >= MIN_CLAIM_LENGTH &&
        candidate.length <= MAX_CLAIM_LENGTH
      );
    });
}

function splitBulletCandidates(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[-*+]\s+/.test(line) || /^\d+\.\s+/.test(line))
    .map(stripMarkdown)
    .filter((candidate) => {
      return (
        candidate.length >= MIN_CLAIM_LENGTH &&
        candidate.length <= MAX_CLAIM_LENGTH
      );
    });
}

function splitTableRowCandidates(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes("|"))
    .filter((line) => !/^[-\s|:]+$/.test(line))
    .map(stripMarkdown)
    .filter((candidate) => {
      return (
        candidate.length >= MIN_CLAIM_LENGTH &&
        candidate.length <= MAX_CLAIM_LENGTH
      );
    });
}

function claimCandidatesFromSection(section: MarkdownSection): string[] {
  return unique([
    ...splitSentenceCandidates(section.text),
    ...splitBulletCandidates(section.text),
    ...splitTableRowCandidates(section.text),
  ]);
}

function looksLikeClaim(candidate: string): boolean {
  const normalized = ` ${candidate.toLowerCase()} `;

  if (candidate.length < MIN_CLAIM_LENGTH) return false;
  if (/^(home|next|previous|skip to|copyright|privacy|terms)\b/i.test(candidate)) {
    return false;
  }

  return CLAIM_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function extractEntities(text: string): string[] {
  const matches =
    text.match(/\b[A-Z][A-Za-z0-9.+#-]*(?:\s+[A-Z][A-Za-z0-9.+#-]*){0,4}\b/g) ??
    [];

  return unique(matches).slice(0, 10);
}

function confidenceForTier(tier: SourceTier): number {
  if (tier === "official_docs") return 0.92;
  if (tier === "trusted_docs") return 0.84;
  if (tier === "reference_examples") return 0.7;
  if (tier === "community") return 0.55;
  if (tier === "media") return 0.5;
  return 0.6;
}

function sectionConfidenceBoost(sectionHeading: string): number {
  const heading = sectionHeading.toLowerCase();

  if (
    /\b(api|reference|authentication|authorization|permission|rate limit|quota|pricing|endpoint|request|response|field|schema)\b/.test(
      heading
    )
  ) {
    return 0.04;
  }

  if (/\b(example|tutorial|faq|troubleshooting)\b/.test(heading)) {
    return 0.01;
  }

  return 0;
}

function clampConfidence(score: number): number {
  return Math.max(0.05, Math.min(0.99, Number(score.toFixed(2))));
}

function toEvidenceItem(input: {
  page: EvidenceSourcePage;
  section: MarkdownSection;
  candidate: string;
}): EvidenceItem {
  const baseConfidence = confidenceForTier(input.page.tier);
  const confidence = clampConfidence(
    baseConfidence + sectionConfidenceBoost(input.section.heading)
  );

  const claim = stripMarkdown(input.candidate);
  const quote = claim.length > 360 ? `${claim.slice(0, 357)}...` : claim;

  return {
    claim,
    quote,
    title: input.page.title,
    url: input.page.url,
    section: input.section.heading,
    product: input.page.product,
    domain: input.page.domain,
    tier: input.page.tier,
    confidence,
    entities: extractEntities(claim),
    reason: input.page.reason,
    text: quote,
    metadata: {
      ...(input.page.metadata ?? {}),
      extractor: "deterministic_markdown_claim_extractor_v1",
    },
  };
}

export function extractEvidenceFromPage(page: EvidenceSourcePage): EvidenceItem[] {
  const sections = splitIntoSections(page.markdown);
  const evidence: EvidenceItem[] = [];
  const seen = new Set<string>();

  for (const section of sections) {
    for (const candidate of claimCandidatesFromSection(section)) {
      if (!looksLikeClaim(candidate)) continue;

      const item = toEvidenceItem({ page, section, candidate });
      const key = `${item.url}::${item.claim.toLowerCase()}`;

      if (seen.has(key)) continue;
      seen.add(key);

      evidence.push(item);

      if (evidence.length >= MAX_EVIDENCE_PER_PAGE) {
        return evidence;
      }
    }
  }

  return evidence;
}

export function extractEvidenceFromPages(
  pages: EvidenceSourcePage[]
): EvidenceItem[] {
  const evidence = pages.flatMap((page) => extractEvidenceFromPage(page));
  const seen = new Set<string>();
  const deduped: EvidenceItem[] = [];

  for (const item of evidence) {
    const key = `${item.url}::${item.claim.toLowerCase()}`;
    if (seen.has(key)) continue;

    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}
