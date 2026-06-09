#!/usr/bin/env python3
# Apply Scout Research Engine v2 Step 18:
# Content dedupe + canonical URL handling for crawled pages.
#
# Run from Scout repo root on main AFTER Step 17.
#
# Why:
# Multi-provider search + crawl retries can surface the same page under:
# - trailing slash differences
# - tracking params
# - hash fragments
# - duplicate content from retry/fallback crawl modes
#
# This patch:
# - Adds crawl-dedupe.ts.
# - Canonicalizes URLs before duplicate checks.
# - Creates stable content fingerprints for accepted Markdown pages.
# - Skips duplicate URL/content pages before ingestion and evidence extraction.
# - Adds duplicate counters to CrawlTrace.
# - Adds duplicate skip records to skippedCrawls.
# - Adds tests for canonicalization, content hashing, and crawl-manager dedupe behavior.
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
        "packages/knowledge/src/research/crawl-manager.ts",
        "packages/knowledge/src/research/crawl-quality.ts",
        "packages/knowledge/src/research/crawl-retry-policy.ts",
    ]
    missing = [p for p in required if not (ROOT / p).exists()]
    if missing:
        raise SystemExit(
            "Run from Scout repo root after Step 17. Missing:\n"
            + "\n".join(f"- {p}" for p in missing)
        )


CRAWL_DEDUPE_TS = r'''
import { createHash } from "node:crypto";

export type CrawlDedupeStatus =
  | "accept"
  | "duplicate_url"
  | "duplicate_content";

export type CrawlDedupeDecision = {
  status: CrawlDedupeStatus;
  canonicalUrl: string;
  contentHash: string;
  reason?: string;
};

const TRACKING_QUERY_PREFIXES = ["utm_"];
const TRACKING_QUERY_KEYS = new Set([
  "fbclid",
  "gclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "ref",
  "source",
  "spm",
]);

function shouldDropQueryParam(key: string): boolean {
  const lower = key.toLowerCase();
  return (
    TRACKING_QUERY_KEYS.has(lower) ||
    TRACKING_QUERY_PREFIXES.some((prefix) => lower.startsWith(prefix))
  );
}

export function canonicalizeCrawlUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");

    const keptParams = [...parsed.searchParams.entries()]
      .filter(([key]) => !shouldDropQueryParam(key))
      .sort(([a], [b]) => a.localeCompare(b));

    parsed.search = "";
    for (const [key, value] of keptParams) {
      parsed.searchParams.append(key, value);
    }

    const path = parsed.pathname === "/" ? "/" : parsed.pathname.replace(/\/+$/, "");
    return `${parsed.origin}${path}${parsed.search}`;
  } catch {
    return url.trim().replace(/#.*$/, "").replace(/\/+$/, "");
  }
}

export function normalizeMarkdownForFingerprint(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[[^\]]+\]\([^)]+\)/g, " ")
    .replace(/[#>*_`|[\]()-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function contentFingerprint(markdown: string): string {
  const normalized = normalizeMarkdownForFingerprint(markdown);
  return createHash("sha256").update(normalized).digest("hex");
}

export class CrawlDedupeState {
  private readonly seenCanonicalUrls = new Set<string>();
  private readonly seenContentHashes = new Set<string>();

  checkAndMark(input: {
    url: string;
    markdown: string;
  }): CrawlDedupeDecision {
    const canonicalUrl = canonicalizeCrawlUrl(input.url);
    const contentHash = contentFingerprint(input.markdown);

    if (this.seenCanonicalUrls.has(canonicalUrl)) {
      return {
        status: "duplicate_url",
        canonicalUrl,
        contentHash,
        reason: `Duplicate canonical URL: ${canonicalUrl}`,
      };
    }

    if (this.seenContentHashes.has(contentHash)) {
      return {
        status: "duplicate_content",
        canonicalUrl,
        contentHash,
        reason: `Duplicate content fingerprint: ${contentHash}`,
      };
    }

    this.seenCanonicalUrls.add(canonicalUrl);
    this.seenContentHashes.add(contentHash);

    return {
      status: "accept",
      canonicalUrl,
      contentHash,
    };
  }
}
'''


CRAWL_MANAGER_TS = r'''
import { crawlSiteWithScrapling } from "../scrapers/scrapling.scraper.js";
import type { ScraplingCrawlMode } from "../scrapers/scrapling.scraper.js";
import type { RankedResource, EvidenceItem } from "./source-types.js";
import { extractEvidenceFromPages } from "./evidence-extractor.js";
import { scorePageQuality, type ContentQuality } from "./crawl-quality.js";
import { getFallbackMode, shouldRetry } from "./crawl-retry-policy.js";
import type { ResourceCrawlTrace } from "./crawl-retry-policy.js";
import {
  canonicalizeCrawlUrl,
  CrawlDedupeState,
  type CrawlDedupeDecision,
} from "./crawl-dedupe.js";

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
  dedupe?: CrawlDedupeDecision;
};

export type CrawlTrace = {
  totalPagesCrawled: number;
  acceptedPages: number;
  skippedPages: number;
  rejectedByQuality: number;
  rejectedByDuplicateUrl: number;
  rejectedByDuplicateContent: number;
  sourcesWithContent: number;
  sourcesSkipped: number;
  retryCount: number;
  resourceTraces: ResourceCrawlTrace[];
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

export { type ResourceCrawlTrace };

function modeForResource(resource: RankedResource): ScraplingCrawlMode {
  if (resource.tier === "official_docs" || resource.tier === "trusted_docs") {
    return "auto";
  }

  if (resource.tier === "community" || resource.tier === "media") {
    return "dynamic";
  }

  return "auto";
}

function rejectedQualityPlaceholder(): ContentQuality {
  return {
    status: "reject",
    score: 0,
    wordCount: 0,
    charCount: 0,
    uniqueWordRatio: 0,
    linkLikeLineRatio: 0,
    headingCount: 0,
    codeBlockCount: 0,
    flags: ["duplicate"],
  };
}

function processCrawlResult(
  resource: RankedResource,
  crawl: Awaited<ReturnType<typeof crawlSiteWithScrapling>>,
  pages: CrawledResearchPage[],
  failed: CrawlManagerOutput["failed"],
  skipped: SkippedCrawl[],
  dedupeState: CrawlDedupeState,
  maxTotalPages: number
): {
  accepted: number;
  skipped: number;
  failedCount: number;
  duplicateUrlCount: number;
  duplicateContentCount: number;
} {
  let accepted = 0;
  let skippedCount = 0;
  let duplicateUrlCount = 0;
  let duplicateContentCount = 0;

  for (const failedUrl of crawl.failedUrls ?? []) {
    failed.push({
      title: resource.title,
      url: failedUrl.url,
      reason: failedUrl.reason,
    });
  }

  for (const page of crawl.pages ?? []) {
    if (pages.length >= maxTotalPages) break;
    if (!page.markdown?.trim()) continue;

    const quality = scorePageQuality(page.markdown);
    const canonicalUrl = canonicalizeCrawlUrl(page.url);

    const baseMetadata = {
      ...page.metadata,
      contentQuality: quality,
      canonicalUrl,
      rootUrl: resource.url,
      sourceTier: resource.tier,
      sourceScore: resource.score,
      matchedBy: resource.matchedBy,
    };

    const crawledPage: CrawledResearchPage = {
      title: page.title || resource.title,
      url: canonicalUrl,
      markdown: page.markdown,
      depth: page.depth,
      source: resource,
      metadata: baseMetadata,
    };

    if (quality.status === "reject") {
      skipped.push({
        title: crawledPage.title,
        url: crawledPage.url,
        reason: `Quality check failed (score=${quality.score}): ${quality.flags.join(", ")}`,
        quality,
      });
      skippedCount++;
      continue;
    }

    const dedupe = dedupeState.checkAndMark({
      url: page.url,
      markdown: page.markdown,
    });

    if (dedupe.status !== "accept") {
      if (dedupe.status === "duplicate_url") duplicateUrlCount++;
      if (dedupe.status === "duplicate_content") duplicateContentCount++;

      skipped.push({
        title: crawledPage.title,
        url: dedupe.canonicalUrl,
        reason: dedupe.reason ?? `Duplicate crawl page: ${dedupe.status}`,
        quality: rejectedQualityPlaceholder(),
        dedupe,
      });
      skippedCount++;
      continue;
    }

    accepted++;
    pages.push({
      ...crawledPage,
      metadata: {
        ...baseMetadata,
        contentHash: dedupe.contentHash,
        dedupeStatus: dedupe.status,
      },
    });
  }

  return {
    accepted,
    skipped: skippedCount,
    failedCount: (crawl.failedUrls ?? []).length,
    duplicateUrlCount,
    duplicateContentCount,
  };
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
  const resourceTraces: ResourceCrawlTrace[] = [];
  const dedupeState = new CrawlDedupeState();
  let totalPagesCrawled = 0;
  let sourcesWithContent = 0;
  let sourcesSkipped = 0;
  let retryCount = 0;
  let rejectedByDuplicateUrl = 0;
  let rejectedByDuplicateContent = 0;

  for (const resource of input.resources) {
    if (pages.length >= maxTotalPages) break;

    const resourceTrace: ResourceCrawlTrace = {
      resourceUrl: resource.url,
      tier: resource.tier,
      modesPlanned: [],
      attempts: 0,
      retried: false,
      pagesAccepted: 0,
      pagesSkipped: 0,
      pagesFailed: 0,
      error: undefined,
    };

    let currentMode = modeForResource(resource);
    let resourceAcceptedCount = 0;
    let resourceSkippedCount = 0;
    let resourceFailedCount = 0;
    let resourceError: string | undefined;

    for (let attempt = 0; attempt < 2 && currentMode; attempt++) {
      resourceTrace.modesPlanned.push(currentMode);
      resourceTrace.attempts++;

      try {
        const crawl = await crawlSiteWithScrapling({
          rootUrl: resource.url,
          maxPages: Math.min(maxPagesPerSource, maxTotalPages - pages.length),
          maxDepth,
          mode: currentMode,
          aiTargeted: true,
          sameDomainOnly: true,
        });

        totalPagesCrawled += (crawl.pages ?? []).length;

        const result = processCrawlResult(
          resource, crawl, pages, failed, skipped, dedupeState, maxTotalPages
        );

        resourceAcceptedCount += result.accepted;
        resourceSkippedCount += result.skipped;
        resourceFailedCount += result.failedCount;
        rejectedByDuplicateUrl += result.duplicateUrlCount;
        rejectedByDuplicateContent += result.duplicateContentCount;

        if (result.accepted > 0) break;

        const retryDecision = shouldRetry({
          acceptedPages: result.accepted,
          skippedPages: result.skipped,
          failedUrls: result.failedCount,
          returnedPages: (crawl.pages ?? []).length,
        });

        if (retryDecision.shouldRetry) {
          const fallback = getFallbackMode(currentMode);
          if (fallback) {
            currentMode = fallback;
            resourceTrace.retried = true;
            retryCount++;
            continue;
          }
        }
        break;
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        resourceError = errMsg;

        if (attempt === 0) {
          const fallback = getFallbackMode(currentMode);
          if (fallback) {
            currentMode = fallback;
            resourceTrace.retried = true;
            retryCount++;
            continue;
          }
        }

        failed.push({
          title: resource.title,
          url: resource.url,
          reason: errMsg,
        });
        break;
      }
    }

    resourceTrace.pagesAccepted = resourceAcceptedCount;
    resourceTrace.pagesSkipped = resourceSkippedCount;
    resourceTrace.pagesFailed = resourceFailedCount;
    resourceTrace.error = resourceError;
    resourceTraces.push(resourceTrace);

    if (resourceAcceptedCount > 0) {
      sourcesWithContent++;
    } else {
      sourcesSkipped++;
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
      rejectedByQuality: skipped.length - rejectedByDuplicateUrl - rejectedByDuplicateContent,
      rejectedByDuplicateUrl,
      rejectedByDuplicateContent,
      sourcesWithContent,
      sourcesSkipped,
      retryCount,
      resourceTraces,
    },
  };
}
'''


CRAWL_DEDUPE_TEST_TS = r'''
import { describe, expect, it } from "vitest";
import {
  canonicalizeCrawlUrl,
  contentFingerprint,
  CrawlDedupeState,
  normalizeMarkdownForFingerprint,
} from "../crawl-dedupe.js";

describe("canonicalizeCrawlUrl", () => {
  it("removes hashes, trailing slash, www, and tracking params", () => {
    expect(
      canonicalizeCrawlUrl(
        "https://www.Example.com/docs/auth/?utm_source=x&b=2&a=1#section"
      )
    ).toBe("https://example.com/docs/auth?a=1&b=2");
  });

  it("keeps meaningful query params", () => {
    expect(canonicalizeCrawlUrl("https://example.com/docs?q=oauth&utm_medium=x")).toBe(
      "https://example.com/docs?q=oauth"
    );
  });
});

describe("contentFingerprint", () => {
  it("produces same hash for semantically identical markdown spacing", () => {
    const a = "# Auth\n\nThe API requires OAuth tokens.";
    const b = "Auth\n\nThe   API requires OAuth tokens.";

    expect(normalizeMarkdownForFingerprint(a)).toBe(
      normalizeMarkdownForFingerprint(b)
    );
    expect(contentFingerprint(a)).toBe(contentFingerprint(b));
  });
});

describe("CrawlDedupeState", () => {
  it("detects duplicate canonical URLs", () => {
    const state = new CrawlDedupeState();

    expect(
      state.checkAndMark({
        url: "https://example.com/docs/auth?utm_source=x",
        markdown: "First unique content about OAuth authentication and tokens.",
      }).status
    ).toBe("accept");

    expect(
      state.checkAndMark({
        url: "https://example.com/docs/auth/",
        markdown: "Second different content but same canonical URL.",
      }).status
    ).toBe("duplicate_url");
  });

  it("detects duplicate content across different URLs", () => {
    const state = new CrawlDedupeState();
    const markdown = "The API requires OAuth tokens and supports refresh token rotation.";

    expect(
      state.checkAndMark({
        url: "https://example.com/a",
        markdown,
      }).status
    ).toBe("accept");

    expect(
      state.checkAndMark({
        url: "https://example.com/b",
        markdown,
      }).status
    ).toBe("duplicate_content");
  });
});
'''


CRAWL_MANAGER_DEDUPE_TEST_TS = r'''
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RankedResource } from "../source-types.js";

const crawlSiteWithScraplingMock = vi.fn();

vi.mock("../../scrapers/scrapling.scraper.js", () => ({
  crawlSiteWithScrapling: crawlSiteWithScraplingMock,
}));

function resource(overrides: Partial<RankedResource> = {}): RankedResource {
  return {
    title: "Example API Docs",
    url: "https://docs.example.com/auth",
    tier: "official_docs",
    score: 100,
    source: "registry",
    reason: "Official docs",
    matchedBy: ["registry"],
    product: "Example API",
    domain: "docs.example.com",
    ...overrides,
  };
}

const goodMarkdown = `
# Authentication

The Example API requires OAuth access tokens for authenticated requests. Developers must create an application,
configure redirect URLs, request the required scopes, and exchange an authorization code for an access token.

## Required scopes

The API supports read and write scopes. Read scopes allow retrieval of account objects, campaign objects,
reporting resources, and configuration metadata. Write scopes allow mutation of campaign configuration after
the user grants permission. Production applications should store tokens securely and refresh them before expiry.

## Rate limits

Rate limits apply per account and per application. Clients should implement exponential backoff, retry only
idempotent operations, and log response headers for debugging quota problems.
`;

describe("crawlResearchSources dedupe behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips duplicate canonical URLs before ingestion/evidence", async () => {
    crawlSiteWithScraplingMock.mockResolvedValueOnce({
      status: "ok",
      rootUrl: "https://docs.example.com/auth",
      failedUrls: [],
      pages: [
        {
          title: "Auth A",
          url: "https://docs.example.com/auth?utm_source=x",
          depth: 0,
          markdown: goodMarkdown,
          metadata: {},
        },
        {
          title: "Auth B",
          url: "https://docs.example.com/auth/",
          depth: 0,
          markdown: `${goodMarkdown}\n\nExtra sentence about another thing.`,
          metadata: {},
        },
      ],
      metadata: {},
    });

    const { crawlResearchSources } = await import("../crawl-manager.js");
    const result = await crawlResearchSources({
      projectId: "project_1",
      query: "Example API authentication",
      resources: [resource()],
      maxPagesPerSource: 3,
      maxTotalPages: 3,
      maxDepth: 1,
    });

    expect(result.pages).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].dedupe?.status).toBe("duplicate_url");
    expect(result.trace.rejectedByDuplicateUrl).toBe(1);
    expect(result.trace.rejectedByDuplicateContent).toBe(0);
    expect(result.pages[0].url).toBe("https://docs.example.com/auth");
    expect(result.pages[0].metadata.contentHash).toBeTruthy();
  });

  it("skips duplicate content across different URLs", async () => {
    crawlSiteWithScraplingMock.mockResolvedValueOnce({
      status: "ok",
      rootUrl: "https://docs.example.com",
      failedUrls: [],
      pages: [
        {
          title: "Auth A",
          url: "https://docs.example.com/auth-a",
          depth: 0,
          markdown: goodMarkdown,
          metadata: {},
        },
        {
          title: "Auth B",
          url: "https://docs.example.com/auth-b",
          depth: 0,
          markdown: goodMarkdown,
          metadata: {},
        },
      ],
      metadata: {},
    });

    const { crawlResearchSources } = await import("../crawl-manager.js");
    const result = await crawlResearchSources({
      projectId: "project_1",
      query: "Example API authentication",
      resources: [resource({ url: "https://docs.example.com" })],
      maxPagesPerSource: 3,
      maxTotalPages: 3,
      maxDepth: 1,
    });

    expect(result.pages).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].dedupe?.status).toBe("duplicate_content");
    expect(result.trace.rejectedByDuplicateContent).toBe(1);
  });
});
'''


TODO_APPEND = r'''
## Done in v2 Slice 16

- [x] Added canonical URL handling for crawled pages.
- [x] Added content fingerprinting for accepted Markdown pages.
- [x] Added crawl dedupe state.
- [x] Skipped duplicate URL/content pages before ingestion and evidence extraction.
- [x] Added duplicate counters to crawl trace.
- [x] Added tests for canonicalization, content hashing, and crawl-manager dedupe.

## Now

### Crawl dedupe validation

- [ ] Run `npm run typecheck:knowledge`.
- [ ] Run `npm run test:knowledge`.
- [ ] Run full web-research smoke test.
- [ ] Inspect `crawlTrace.rejectedByDuplicateUrl` and `crawlTrace.rejectedByDuplicateContent`.
- [ ] Inspect `documents[].url` and `documents[].metadata.contentHash`.
'''


LESSONS_APPEND = r'''
## Research Engine v2 Slice 16

- Multi-provider search and retry crawling make duplicate URLs more likely.
- Dedupe should happen after quality gating but before ingestion/evidence extraction.
- Canonical URL dedupe and content hash dedupe catch different failure modes.
- Duplicate pages should be visible in crawl trace instead of silently ignored.
'''


README_APPEND = r'''
---

## Crawl dedupe

Scout canonicalizes and deduplicates crawled pages before document ingestion and evidence extraction.

It removes common tracking parameters, hash fragments, trailing slash variants, and duplicate content fingerprints.

Trace fields:

```text
crawlTrace.rejectedByDuplicateUrl
crawlTrace.rejectedByDuplicateContent
```

Accepted documents include:

```text
metadata.canonicalUrl
metadata.contentHash
```
'''


def update_index_exports() -> None:
    path = "packages/knowledge/src/index.ts"
    text = read(path)

    line = 'export * from "./research/crawl-dedupe.js";'
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


def main() -> None:
    assert_repo_root()

    write("packages/knowledge/src/research/crawl-dedupe.ts", CRAWL_DEDUPE_TS)
    write("packages/knowledge/src/research/crawl-manager.ts", CRAWL_MANAGER_TS)
    write("packages/knowledge/src/research/__tests__/crawl-dedupe.test.ts", CRAWL_DEDUPE_TEST_TS)
    write("packages/knowledge/src/research/__tests__/crawl-manager-dedupe.test.ts", CRAWL_MANAGER_DEDUPE_TEST_TS)

    update_index_exports()
    append_once("README.md", "Crawl dedupe", README_APPEND)
    append_once("docs/TODO.md", "Done in v2 Slice 16", TODO_APPEND)
    append_once("docs/LESSONS.md", "Research Engine v2 Slice 16", LESSONS_APPEND)

    print("\nDone.")
    print("\nNext commands:")
    print("  npm run typecheck:knowledge")
    print("  npm run test:knowledge")
    print("")
    print("Then run full /tools/web-research smoke test and inspect:")
    print("  crawlTrace.rejectedByDuplicateUrl")
    print("  crawlTrace.rejectedByDuplicateContent")
    print("  documents[].metadata.contentHash")


if __name__ == "__main__":
    main()
