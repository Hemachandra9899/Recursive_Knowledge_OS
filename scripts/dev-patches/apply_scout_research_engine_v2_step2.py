#!/usr/bin/env python3
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
        "prisma/schema.prisma",
        "packages/knowledge/src/research/source-types.ts",
        "packages/knowledge/src/research/crawl-manager.ts",
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
'''


EVIDENCE_EXTRACTOR_TS = r'''
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
'''


CITATION_VERIFIER_TS = r'''
import type { CitationVerification, EvidenceItem } from "./source-types.js";

function hasUsableQuote(item: EvidenceItem): boolean {
  return Boolean(item.quote?.trim() && item.quote.trim().length >= 20);
}

function hasUsableSource(item: EvidenceItem): boolean {
  return Boolean(item.url?.trim() && /^https?:\/\//i.test(item.url));
}

function isStrongSource(item: EvidenceItem): boolean {
  return item.tier === "official_docs" || item.tier === "trusted_docs";
}

export function verifyEvidenceClaims(
  evidence: EvidenceItem[]
): CitationVerification[] {
  return evidence.map((item) => {
    if (!item.claim?.trim()) {
      return {
        status: "unsupported",
        claim: item.claim || "",
        supportingUrls: [],
        reason: "Missing extracted claim text.",
      };
    }

    if (!hasUsableQuote(item) || !hasUsableSource(item)) {
      return {
        status: "unsupported",
        claim: item.claim,
        supportingUrls: item.url ? [item.url] : [],
        reason: "Missing a usable quote or source URL.",
      };
    }

    if (item.confidence >= 0.75 || (isStrongSource(item) && item.confidence >= 0.7)) {
      return {
        status: "supported",
        claim: item.claim,
        supportingUrls: [item.url],
        reason: "Claim has quote-backed source evidence.",
      };
    }

    if (item.confidence >= 0.55) {
      return {
        status: "weak",
        claim: item.claim,
        supportingUrls: [item.url],
        reason: "Evidence exists, but source confidence is moderate.",
      };
    }

    return {
      status: "unsupported",
      claim: item.claim,
      supportingUrls: [item.url],
      reason: "Evidence confidence is too low for factual synthesis.",
    };
  });
}
'''


EVIDENCE_PACK_TS = r'''
import type {
  EvidenceItem,
  EvidencePack,
  RankedResource,
  SourceUseCase,
} from "./source-types.js";
import { inferSourceUseCase } from "./query-builder.js";
import { verifyEvidenceClaims } from "./citation-verifier.js";

function isOfficial(tier: string) {
  return tier === "official_docs" || tier === "trusted_docs";
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function buildEvidencePack(input: {
  query: string;
  resourcesPlanned: RankedResource[];
  evidence: EvidenceItem[];
}): EvidencePack {
  const useCase: SourceUseCase = inferSourceUseCase(input.query);
  const citationVerification = verifyEvidenceClaims(input.evidence);

  const uniqueSourceUrls = unique(input.evidence.map((item) => item.url));
  const officialSourceUrls = unique(
    input.evidence
      .filter((item) => isOfficial(item.tier))
      .map((item) => item.url)
  );

  const supportedClaimCount = citationVerification.filter(
    (item) => item.status === "supported"
  ).length;
  const weakClaimCount = citationVerification.filter(
    (item) => item.status === "weak"
  ).length;
  const unsupportedClaimCount = citationVerification.filter(
    (item) => item.status === "unsupported"
  ).length;

  const missing: string[] = [];

  if (input.evidence.length === 0) {
    missing.push("No claim-level evidence was collected.");
  }

  if (
    (useCase === "api_facts" || useCase === "comparison") &&
    officialSourceUrls.length === 0
  ) {
    missing.push("No official/trusted sources were collected.");
  }

  if (input.evidence.length > 0 && supportedClaimCount === 0) {
    missing.push("Evidence was collected, but no claim passed citation verification.");
  }

  return {
    query: input.query,
    useCase,
    resourcesPlanned: input.resourcesPlanned,
    evidence: input.evidence,
    citationVerification,
    coverage: {
      hasEvidence: input.evidence.length > 0,
      sourceCount: input.evidence.length,
      claimCount: input.evidence.length,
      uniqueSourceCount: uniqueSourceUrls.length,
      officialSourceCount: officialSourceUrls.length,
      supportedClaimCount,
      weakClaimCount,
      unsupportedClaimCount,
      missing,
    },
  };
}
'''


CRAWL_MANAGER_TS = r'''
import { crawlSiteWithScrapling } from "../scrapers/scrapling.scraper.js";
import type { RankedResource, EvidenceItem } from "./source-types.js";
import { extractEvidenceFromPages } from "./evidence-extractor.js";

export type CrawlManagerInput = {
  projectId: string;
  query: string;
  resources: RankedResource[];
  maxPagesPerSource?: number;
  maxTotalPages?: number;
  maxDepth?: number;
};

export type CrawledResearchPage = {
  title: string;
  url: string;
  markdown: string;
  depth: number;
  source: RankedResource;
  metadata: Record<string, unknown>;
};

export type CrawlManagerOutput = {
  pages: CrawledResearchPage[];
  evidence: EvidenceItem[];
  failed: Array<{
    title?: string;
    url?: string;
    reason: string;
  }>;
};

function modeForResource(resource: RankedResource): "auto" | "static" | "dynamic" | "stealth" {
  if (resource.tier === "official_docs" || resource.tier === "trusted_docs") {
    return "auto";
  }

  if (resource.tier === "community" || resource.tier === "media") {
    return "dynamic";
  }

  return "auto";
}

export async function crawlResearchSources(
  input: CrawlManagerInput
): Promise<CrawlManagerOutput> {
  const maxPagesPerSource = input.maxPagesPerSource ?? 3;
  const maxTotalPages = input.maxTotalPages ?? 20;
  const maxDepth = input.maxDepth ?? 1;

  const pages: CrawledResearchPage[] = [];
  const failed: CrawlManagerOutput["failed"] = [];

  for (const resource of input.resources) {
    if (pages.length >= maxTotalPages) break;

    try {
      const crawl = await crawlSiteWithScrapling({
        rootUrl: resource.url,
        maxPages: Math.min(maxPagesPerSource, maxTotalPages - pages.length),
        maxDepth,
        mode: modeForResource(resource),
        aiTargeted: true,
        sameDomainOnly: true,
      });

      for (const failedUrl of crawl.failedUrls ?? []) {
        failed.push({
          title: resource.title,
          url: failedUrl.url,
          reason: failedUrl.reason,
        });
      }

      for (const page of crawl.pages ?? []) {
        if (!page.markdown?.trim()) continue;

        const crawledPage: CrawledResearchPage = {
          title: page.title || resource.title,
          url: page.url,
          markdown: page.markdown,
          depth: page.depth,
          source: resource,
          metadata: {
            ...page.metadata,
            rootUrl: resource.url,
            sourceTier: resource.tier,
            sourceScore: resource.score,
            matchedBy: resource.matchedBy,
          },
        };

        pages.push(crawledPage);

        if (pages.length >= maxTotalPages) break;
      }
    } catch (error) {
      failed.push({
        title: resource.title,
        url: resource.url,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const evidence = extractEvidenceFromPages(
    pages.map((page) => ({
      title: page.title,
      url: page.url,
      markdown: page.markdown,
      product: page.source.product,
      domain: page.source.domain,
      tier: page.source.tier,
      reason: page.source.reason,
      metadata: page.metadata,
    }))
  );

  return {
    pages,
    evidence,
    failed,
  };
}
'''


TODO_MD = r'''
# Scout TODO

This file tracks the next implementation steps for Scout Research Engine v2.

## Done in v2 Slice 1

- [x] Add `ResearchOrchestrator` as the deterministic top-level research pipeline.
- [x] Keep the existing RLM runtime as the execution/reasoning layer, not the whole control plane.
- [x] Wire `ResearchOrchestrator` into `/tools/web-research` behind `useOrchestrator`.
- [x] Create a small, clean `packages/knowledge/src/agents` folder.
- [x] Add first deterministic agents:
  - `SearchPlannerAgent`
  - `MemoryAgent`
- [x] Replace single-page-only crawl behavior with bounded Scrapling site crawling.
- [x] Add crawler limits:
  - `maxPages`
  - `maxDepth`
  - same-domain restriction
  - duplicate URL removal
- [x] Add first-class `Memory` Prisma model.
- [x] Use add-only memory writes for source-quality memories.

## Done in v2 Slice 2

- [x] Upgrade `EvidencePack` from page previews to claim-level evidence.
- [x] Add deterministic Markdown evidence extraction.
- [x] Store:
  - claim
  - quote
  - source URL
  - source title
  - section
  - confidence
  - source tier
  - entities
- [x] Add citation verification statuses:
  - supported
  - weak
  - unsupported

## Now

### Evidence quality

- [ ] Add tests for `evidence-extractor.ts`.
- [ ] Add tests for `citation-verifier.ts`.
- [ ] Improve table-specific evidence extraction for API docs.
- [ ] Add quote span offsets later for source drawer highlighting.
- [ ] Add evidence deduplication across near-identical pages.

### Research planning

- [ ] Make `ResearchOrchestrator` actually use `SearchPlannerAgent.subqueries` for multi-query resource planning.
- [ ] Merge and dedupe ranked resources across subqueries.
- [ ] Add source freshness scoring.
- [ ] Add source diversity scoring.
- [ ] Add per-domain crawl budgets.

### Memory

- [ ] Add source failure memory so Scout avoids repeatedly bad URLs.
- [ ] Add durable fact memories from supported evidence.
- [ ] Add vector-backed memory retrieval later.

## Next

- [ ] Add graph extraction from crawled Markdown.
- [ ] Store entities, relations, and claims using existing Prisma graph tables.
- [ ] Add `GraphAgent`.
- [ ] Add `VerifierAgent` for final answer verification.

## Later

- [ ] Add swarm execution for parallel subquery search.
- [ ] Add swarm execution for parallel source crawling.
- [ ] Add multi-provider web search:
  - Firecrawl
  - Brave Search
  - Tavily
  - GitHub Search
  - Docs registry
- [ ] Add streaming run traces in the UI.
- [ ] Add source drawer with per-claim citations.
'''


LESSONS_MD_APPEND = r'''
## Research Engine v2 Slice 2

- Page-level previews are not enough for Perplexity-style answers. Scout needs claim-level evidence with quotes.
- Evidence extraction should stay deterministic first. LLM-based extraction can be added later after the pipeline is stable.
- Citation verification should happen before final synthesis, not after the answer is written.
- Keep route handlers thin. Research logic belongs in `packages/knowledge/src/research`.
- Do not add swarm or graph complexity before evidence quality is reliable.
'''


def update_index() -> None:
    path = "packages/knowledge/src/index.ts"
    text = read(path)

    additions = [
        'export * from "./research/evidence-extractor.js";',
        'export * from "./research/citation-verifier.js";',
    ]

    for line in additions:
        if line not in text:
            marker = 'export * from "./research/evidence-pack.js";'
            text = text.replace(marker, marker + "\n" + line)

    write(path, text)


def update_package_exports() -> None:
    path = ROOT / "packages/knowledge/package.json"
    data = json.loads(path.read_text(encoding="utf-8"))

    exports = data.setdefault("exports", {})
    exports["./research/evidence-extractor"] = "./src/research/evidence-extractor.js"
    exports["./research/evidence-extractor.js"] = "./src/research/evidence-extractor.js"
    exports["./research/citation-verifier"] = "./src/research/citation-verifier.js"
    exports["./research/citation-verifier.js"] = "./src/research/citation-verifier.js"

    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print(f"updated {path.relative_to(ROOT)}")


def update_tools_service_legacy_path() -> None:
    path = "apps/api/src/modules/tools/tools.service.ts"
    text = read(path)

    if "extractEvidenceFromPage" not in text.split('} from "@rlm-forge/knowledge";')[0]:
        text = text.replace(
            "  crawlSiteWithScrapling,\n  scrapeUrl,",
            "  crawlSiteWithScrapling,\n  extractEvidenceFromPage,\n  scrapeUrl,",
        )

    old_block = "\n".join([
        "    evidence.push({",
        "      title: scraped.title || resource.title,",
        "      url: scraped.url,",
        "      product: resource.product,",
        "      domain: resource.domain,",
        "      tier: resource.tier,",
        "      text: preview(scraped.markdown, 1800),",
        "      reason: resource.reason,",
        "    });",
    ])

    new_block = "\n".join([
        "    const extractedEvidence = extractEvidenceFromPage({",
        "      title: scraped.title || resource.title,",
        "      url: scraped.url,",
        "      markdown: scraped.markdown,",
        "      product: resource.product,",
        "      domain: resource.domain,",
        "      tier: resource.tier,",
        "      reason: resource.reason,",
        "      metadata: {",
        "        sourceType: resource.source,",
        "        matchedScore: resource.score,",
        "        matchedBy: resource.matchedBy,",
        "        normalizedQuery: plan.normalizedQuery,",
        "      },",
        "    });",
        "",
        "    if (extractedEvidence.length > 0) {",
        "      evidence.push(...extractedEvidence);",
        "    } else {",
        "      const quote = preview(scraped.markdown, 500);",
        "      evidence.push({",
        "        claim: `Source \"${scraped.title || resource.title}\" contains potentially relevant information for the query.`,",
        "        quote,",
        "        title: scraped.title || resource.title,",
        "        url: scraped.url,",
        "        product: resource.product,",
        "        domain: resource.domain,",
        "        tier: resource.tier,",
        "        confidence:",
        "          resource.tier === \"official_docs\" || resource.tier === \"trusted_docs\"",
        "            ? 0.72",
        "            : 0.55,",
        "        entities: [resource.product, resource.domain].filter(Boolean) as string[],",
        "        reason: resource.reason,",
        "        text: quote,",
        "        metadata: {",
        "          fallbackEvidence: true,",
        "          sourceType: resource.source,",
        "          matchedScore: resource.score,",
        "          matchedBy: resource.matchedBy,",
        "          normalizedQuery: plan.normalizedQuery,",
        "        },",
        "      });",
        "    }",
    ])

    if old_block in text:
        text = text.replace(old_block, new_block)
    else:
        print("warning: legacy evidence block not found; tools.service.ts may already be updated")

    write(path, text)


def update_lessons() -> None:
    path = ROOT / "docs/LESSONS.md"
    if path.exists():
        text = path.read_text(encoding="utf-8")
        if "Research Engine v2 Slice 2" not in text:
            text = text.rstrip() + "\n\n" + LESSONS_MD_APPEND.strip() + "\n"
        path.write_text(text, encoding="utf-8")
        print("updated docs/LESSONS.md")
    else:
        write("docs/LESSONS.md", "# Scout Lessons\n\n" + LESSONS_MD_APPEND)


def main() -> None:
    assert_repo_root()

    write("packages/knowledge/src/research/source-types.ts", SOURCE_TYPES_TS)
    write("packages/knowledge/src/research/evidence-extractor.ts", EVIDENCE_EXTRACTOR_TS)
    write("packages/knowledge/src/research/citation-verifier.ts", CITATION_VERIFIER_TS)
    write("packages/knowledge/src/research/evidence-pack.ts", EVIDENCE_PACK_TS)
    write("packages/knowledge/src/research/crawl-manager.ts", CRAWL_MANAGER_TS)

    update_index()
    update_package_exports()
    update_tools_service_legacy_path()

    write("docs/TODO.md", TODO_MD)
    update_lessons()

    print("\nDone.")
    print("\nNext commands:")
    print("  npm run prisma:generate")
    print("  docker compose build api worker model-service")
    print("  docker compose up")


if __name__ == "__main__":
    main()
