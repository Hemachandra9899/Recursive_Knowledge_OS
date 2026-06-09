#!/usr/bin/env python3
# Apply Scout Research Engine v2 Step 16:
# Crawler Quality + Crawl Trace.
#
# Run from Scout repo root on main.

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
        "packages/knowledge/src/research/crawl-manager.ts",
        "packages/knowledge/src/research/research-orchestrator.ts",
        "packages/knowledge/src/research/evidence-extractor.ts",
    ]
    missing = [p for p in required if not (ROOT / p).exists()]
    if missing:
        raise SystemExit(
            "Run this script from Scout repo root. Missing:\n"
            + "\n".join(f"- {p}" for p in missing)
        )


CRAWL_QUALITY_TS = r'''
export type ContentQualityStatus = "accept" | "reject";

export type ContentQuality = {
  status: ContentQualityStatus;
  score: number;
  wordCount: number;
  charCount: number;
  uniqueWordRatio: number;
  linkLikeLineRatio: number;
  headingCount: number;
  codeBlockCount: number;
  flags: string[];
};

const BLOCKED_PATTERNS = [
  /\baccess denied\b/i,
  /\bblocked\b/i,
  /\b403 forbidden\b/i,
  /\b404 not found\b/i,
  /\bsign in\b/i,
  /\blog in\b/i,
  /\bplease enable javascript\b/i,
  /\bthis page requires javascript\b/i,
];

const MIN_WORD_COUNT = 30;
const MIN_CHAR_COUNT = 200;
const MAX_LINK_LIKE_RATIO = 0.45;
const MIN_UNIQUE_WORD_RATIO = 0.15;

export function scorePageQuality(markdown: string): ContentQuality {
  const wordCount = countWords(markdown);
  const charCount = markdown.length;
  const uniqueWordRatio = computeUniqueWordRatio(markdown);
  const linkLikeLineRatio = computeLinkLikeLineRatio(markdown);
  const headingCount = (markdown.match(/^#{1,6}\s/gm) ?? []).length;
  const codeBlockCount = (markdown.match(/```/g) ?? []).length / 2;
  const flags: string[] = [];

  const checks: Array<{ score: number }> = [];

  if (wordCount < MIN_WORD_COUNT) {
    flags.push(`low_word_count:${wordCount}`);
  } else {
    checks.push({ score: Math.min(25, Math.round(wordCount * 0.08)) });
  }

  if (charCount < MIN_CHAR_COUNT) {
    flags.push(`low_char_count:${charCount}`);
  } else if (charCount > 500) {
    checks.push({ score: Math.min(10, Math.round(charCount * 0.005)) });
  }

  if (uniqueWordRatio < MIN_UNIQUE_WORD_RATIO) {
    flags.push(`low_unique_word_ratio:${uniqueWordRatio.toFixed(2)}`);
  } else if (uniqueWordRatio > 0.3) {
    checks.push({ score: Math.min(15, Math.round(uniqueWordRatio * 30)) });
  }

  if (linkLikeLineRatio > MAX_LINK_LIKE_RATIO) {
    flags.push(`high_nav_ratio:${linkLikeLineRatio.toFixed(2)}`);
  } else {
    checks.push({ score: Math.min(10, Math.round((1 - linkLikeLineRatio) * 15)) });
  }

  if (headingCount > 0) {
    checks.push({ score: Math.min(10, headingCount * 3) });
  }

  if (codeBlockCount > 0) {
    checks.push({ score: Math.min(8, codeBlockCount * 4) });
  }

  const blockedMatch = BLOCKED_PATTERNS.some((p) => p.test(markdown));
  if (blockedMatch) {
    flags.push("blocked_content");
  }

  const score = Math.min(100, checks.reduce((sum, c) => sum + c.score, 0));
  const reject =
    flags.length > 0 &&
    (wordCount < MIN_WORD_COUNT ||
      charCount < MIN_CHAR_COUNT ||
      linkLikeLineRatio > MAX_LINK_LIKE_RATIO ||
      uniqueWordRatio < MIN_UNIQUE_WORD_RATIO ||
      blockedMatch);

  return {
    status: reject ? "reject" : score >= 20 ? "accept" : "reject",
    score,
    wordCount,
    charCount,
    uniqueWordRatio,
    linkLikeLineRatio,
    headingCount,
    codeBlockCount,
    flags,
  };
}

function countWords(text: string): number {
  return text
    .split(/\s+/)
    .filter((w) => w.trim().length > 0 && !/^[#\-\*\|\[\]\(\)>]+$/.test(w.trim()))
    .length;
}

function computeUniqueWordRatio(text: string): number {
  const words = text
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ""))
    .filter((w) => w.length > 2);
  if (words.length === 0) return 0;
  return new Set(words).size / words.length;
}

function computeLinkLikeLineRatio(text: string): number {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return 0;
  const linkLines = lines.filter(
    (l) => /^https?:\/\//i.test(l.trim()) || /^\[.*?\]\(/.test(l.trim()) || /^\|.*\|$/.test(l.trim())
  ).length;
  return linkLines / lines.length;
}
'''


CRAWL_MANAGER_TS = r'''
import { crawlSiteWithScrapling } from "../scrapers/scrapling.scraper.js";
import type { RankedResource, EvidenceItem } from "./source-types.js";
import { extractEvidenceFromPages } from "./evidence-extractor.js";
import { scorePageQuality, type ContentQuality } from "./crawl-quality.js";

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

export type SkippedCrawl = {
  title: string;
  url: string;
  reason: string;
  quality: ContentQuality;
};

export type CrawlTrace = {
  totalPagesCrawled: number;
  acceptedPages: number;
  skippedPages: number;
  rejectedByQuality: number;
  sourcesWithContent: number;
  sourcesSkipped: number;
};

export type CrawlManagerOutput = {
  pages: CrawledResearchPage[];
  evidence: EvidenceItem[];
  failed: Array<{
    title?: string;
    url?: string;
    reason: string;
  }>;
  skipped: SkippedCrawl[];
  trace: CrawlTrace;
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
  const skipped: SkippedCrawl[] = [];
  let totalPagesCrawled = 0;
  let sourcesWithContent = 0;
  let sourcesSkipped = 0;

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

      let resourceHadContent = false;

      for (const page of crawl.pages ?? []) {
        totalPagesCrawled++;
        if (!page.markdown?.trim()) continue;

        const quality = scorePageQuality(page.markdown);

        const crawledPage: CrawledResearchPage = {
          title: page.title || resource.title,
          url: page.url,
          markdown: page.markdown,
          depth: page.depth,
          source: resource,
          metadata: {
            ...page.metadata,
            contentQuality: quality,
            rootUrl: resource.url,
            sourceTier: resource.tier,
            sourceScore: resource.score,
            matchedBy: resource.matchedBy,
          },
        };

        if (quality.status === "reject") {
          skipped.push({
            title: crawledPage.title,
            url: crawledPage.url,
            reason: `Quality check failed (score=${quality.score}): ${quality.flags.join(", ")}`,
            quality,
          });
          continue;
        }

        resourceHadContent = true;
        pages.push(crawledPage);

        if (pages.length >= maxTotalPages) break;
      }

      if (resourceHadContent) {
        sourcesWithContent++;
      } else if ((crawl.pages ?? []).length > 0) {
        sourcesSkipped++;
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
    skipped,
    trace: {
      totalPagesCrawled,
      acceptedPages: pages.length,
      skippedPages: skipped.length,
      rejectedByQuality: skipped.length,
      sourcesWithContent,
      sourcesSkipped,
    },
  };
}
'''


CRAWL_QUALITY_TEST_TS = r'''
import { describe, expect, it } from "vitest";
import { scorePageQuality } from "../crawl-quality.js";

describe("scorePageQuality", () => {
  it("accepts a normal documentation page", () => {
    const result = scorePageQuality(
      `# Authentication

The API requires OAuth access tokens for authenticated requests.

## Usage

To get started, create an application in the developer console.

## Rate Limits

The API supports rate limiting per account. You can increase your limit by contacting support.
`
    );
    expect(result.status).toBe("accept");
    expect(result.score).toBeGreaterThanOrEqual(20);
    expect(result.flags).toHaveLength(0);
  });

  it("rejects very short content", () => {
    const result = scorePageQuality("Short content.");
    expect(result.status).toBe("reject");
    expect(result.flags.some((f) => f.startsWith("low_word_count"))).toBe(true);
  });

  it("rejects blocked or access-denied pages", () => {
    const result = scorePageQuality(
      `# Access Denied

You do not have permission to access this page. Please sign in.
`
    );
    expect(result.flags).toContain("blocked_content");
  });

  it("rejects navigation-heavy pages", () => {
    const navPage = Array.from({ length: 20 }, (_, i) => `https://docs.example.com/page${i + 1}`).join(
      "\n"
    );
    const result = scorePageQuality(navPage);
    expect(result.status).toBe("reject");
    expect(result.flags.some((f) => f.startsWith("high_nav_ratio"))).toBe(true);
  });

  it("scores a page with code blocks higher", () => {
    const withCode = scorePageQuality(
      `# API Reference

## Endpoints

\`\`\`typescript
const api = new Client({ apiKey: "..." });
await api.users.list();
\`\`\`

## Authentication

The API uses OAuth 2.0.
`
    );
    const withoutCode = scorePageQuality(
      `# API Reference

## Endpoints

The API has several endpoints.

## Authentication

The API uses OAuth 2.0.
`
    );
    expect(withCode.score).toBeGreaterThan(withoutCode.score);
  });
});
'''


def update_index_exports() -> None:
    path = "packages/knowledge/src/index.ts"
    text = read(path)

    additions = [
        'export * from "./research/crawl-quality.js";',
    ]
    for line in additions:
        if line not in text:
            text = text.rstrip() + "\n" + line + "\n"

    write(path, text)


def update_orchestrator() -> None:
    path = "packages/knowledge/src/research/research-orchestrator.ts"
    text = read(path)

    old_return_section = '''  return {
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
    };'''

    new_return_section = '''  return {
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
      skippedCrawls: crawl.skipped.map((s) => ({
        title: s.title,
        url: s.url,
        reason: s.reason,
        quality: s.quality,
      })),
      crawlTrace: crawl.trace,
      evidencePack,
      answer,
    };'''

    if old_return_section in text:
        text = text.replace(old_return_section, new_return_section)
        write(path, text)
        print("updated research-orchestrator.ts")
    else:
        print("WARNING: could not find return section in research-orchestrator.ts")


def update_orchestrator_test() -> None:
    path = "packages/knowledge/src/research/__tests__/research-orchestrator.test.ts"
    text = read(path)

    old_mock = '''    crawlResearchSourcesMock.mockResolvedValue({
      pages: ['''
    new_mock = '''    crawlResearchSourcesMock.mockResolvedValue({
      pages: ['''

    # Add skipped and trace to the mock crawl result
    old_result_end = '''      failed: [],
    });'''
    new_result_end = '''      failed: [],
      skipped: [],
      trace: {
        totalPagesCrawled: 2,
        acceptedPages: 2,
        skippedPages: 0,
        rejectedByQuality: 0,
        sourcesWithContent: 2,
        sourcesSkipped: 0,
      },
    });'''

    if old_result_end in text:
        text = text.replace(old_result_end, new_result_end)
        write(path, text)
        print("updated research-orchestrator test mock")
    else:
        print("WARNING: could not find mock result end in orchestrator test")


def update_todo() -> None:
    path = ROOT / "docs/TODO.md"
    text = path.read_text(encoding="utf-8") if path.exists() else "# Scout TODO\n"
    append = r'''
## Done in v2 Slice 14

- [x] Added deterministic Markdown quality scoring.
- [x] Added crawl-quality.ts with word count, unique word ratio, link-like ratio, and blocked content detection.
- [x] Updated crawl-manager.ts to reject low-quality pages before evidence extraction.
- [x] Added skippedCrawls and crawlTrace to ResearchOrchestrator output.
- [x] Added quality metadata to crawled documents.
- [x] Added tests for crawl-quality scoring.
'''
    if "Done in v2 Slice 14" not in text:
        text = text.rstrip() + "\n\n" + append.strip() + "\n"
    path.write_text(text, encoding="utf-8")
    print("updated docs/TODO.md")


def update_lessons() -> None:
    path = ROOT / "docs/LESSONS.md"
    text = path.read_text(encoding="utf-8") if path.exists() else "# Scout Lessons\n"
    append = r'''
## Research Engine v2 Slice 14

- Content quality scoring should be deterministic, not LLM-based, so it can be tested and tuned.
- Navigation-heavy, blocked, and tiny pages should be rejected before evidence extraction, not after.
- Crawl trace metadata makes crawler behavior debuggable in production smoke tests.
- Skipped pages should not silently disappear; they should be recorded for memory and debugging.
- The next quality improvement should be crawl retry with different modes (auto → dynamic → stealth).
'''
    if "Research Engine v2 Slice 14" not in text:
        text = text.rstrip() + "\n\n" + append.strip() + "\n"
    path.write_text(text, encoding="utf-8")
    print("updated docs/LESSONS.md")


def main() -> None:
    assert_repo_root()

    write("packages/knowledge/src/research/crawl-quality.ts", CRAWL_QUALITY_TS)
    write("packages/knowledge/src/research/crawl-manager.ts", CRAWL_MANAGER_TS)
    write("packages/knowledge/src/research/__tests__/crawl-quality.test.ts", CRAWL_QUALITY_TEST_TS)

    update_index_exports()
    update_orchestrator()
    update_orchestrator_test()

    update_todo()
    update_lessons()

    print("\nDone.")
    print("\nNext commands:")
    print("  npm run typecheck:knowledge")
    print("  npm run test:knowledge")


if __name__ == "__main__":
    main()
