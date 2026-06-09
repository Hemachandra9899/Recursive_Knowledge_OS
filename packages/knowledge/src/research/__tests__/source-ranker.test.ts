import { describe, expect, it } from "vitest";
import {
  isFreshnessRequired,
  rankResourceCandidates,
} from "../source-ranker.js";
import type { ResourceCandidate } from "../source-types.js";

function candidate(overrides: Partial<ResourceCandidate> = {}): ResourceCandidate {
  return {
    title: "Example API Docs",
    url: "https://docs.example.com/page",
    tier: "unknown",
    source: "web_search",
    reason: "Search result",
    topics: ["api"],
    keywords: ["api"],
    ...overrides,
  };
}

describe("source freshness scoring", () => {
  it("detects freshness-sensitive queries", () => {
    expect(isFreshnessRequired("latest API rate limits")).toBe(true);
    expect(isFreshnessRequired("compare authentication methods")).toBe(false);
  });

  it("boosts recent sources for freshness-sensitive queries", () => {
    const ranked = rankResourceCandidates(
      "latest API rate limits",
      [
        candidate({
          title: "Recent API Docs",
          url: "https://docs.example.com/recent",
          publishedAt: new Date().toISOString(),
        }),
        candidate({
          title: "Old API Docs",
          url: "https://docs.example.com/old",
          publishedAt: "2019-01-01",
        }),
      ],
      {
        maxSources: 2,
        minScore: 0,
      }
    );

    expect(ranked[0].title).toBe("Recent API Docs");
    expect(ranked[0].matchedBy.some((item) => item.includes("freshness:published_recent"))).toBe(true);
    expect(ranked[1].matchedBy.some((item) => item.includes("freshness:published_old"))).toBe(true);
  });

  it("penalizes deprecated sources", () => {
    const [ranked] = rankResourceCandidates(
      "api auth",
      [
        candidate({
          title: "Deprecated legacy API Docs",
          url: "https://docs.example.com/legacy",
        }),
      ],
      {
        maxSources: 1,
        minScore: 0,
      }
    );

    expect(ranked.matchedBy).toContain("freshness:deprecated:-24");
  });
});

describe("source diversity selection", () => {
  it("limits same-domain dominance before filling remaining slots", () => {
    const ranked = rankResourceCandidates(
      "api authentication",
      [
        candidate({
          title: "Docs 1",
          url: "https://docs.example.com/a",
          tier: "official_docs",
          source: "registry",
        }),
        candidate({
          title: "Docs 2",
          url: "https://docs.example.com/b",
          tier: "official_docs",
          source: "registry",
        }),
        candidate({
          title: "Docs 3",
          url: "https://docs.example.com/c",
          tier: "official_docs",
          source: "registry",
        }),
        candidate({
          title: "Other Docs",
          url: "https://docs.other.com/a",
          tier: "trusted_docs",
          source: "web_search",
        }),
      ],
      {
        maxSources: 3,
        minScore: 0,
        maxPerDomain: 2,
      }
    );

    const hosts = ranked.map((item) => new URL(item.url).hostname);
    expect(hosts.filter((host) => host === "docs.example.com")).toHaveLength(2);
    expect(hosts).toContain("docs.other.com");
  });
});
