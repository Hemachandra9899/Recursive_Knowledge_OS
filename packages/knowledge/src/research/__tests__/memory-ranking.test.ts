import { describe, expect, it } from "vitest";
import { scoreResourceWithMemory } from "../memory-ranking.js";
import type { ResourceCandidate } from "../source-types.js";
import type { ScoutMemory } from "../../memory/memory-types.js";

function resource(overrides: Partial<ResourceCandidate> = {}): ResourceCandidate {
  return {
    title: "Example API Docs",
    url: "https://docs.example.com/auth",
    tier: "official_docs",
    reason: "Official docs",
    source: "registry",
    product: "Example API",
    domain: "docs.example.com",
    ...overrides,
  };
}

function memory(overrides: Partial<ScoutMemory> = {}): ScoutMemory {
  return {
    id: "mem_1",
    projectId: "project_1",
    scope: "source",
    kind: "source_quality",
    text: "Useful source",
    entities: ["Example API"],
    sourceUrls: ["https://docs.example.com/auth"],
    confidence: 0.9,
    metadata: {},
    createdAt: new Date(),
    ...overrides,
  };
}

describe("scoreResourceWithMemory", () => {
  it("boosts source_quality URL matches", () => {
    const result = scoreResourceWithMemory({
      query: "Example API auth",
      resource: resource(),
      memoryHints: [memory()],
    });

    expect(result.scoreDelta).toBeGreaterThan(0);
    expect(result.matchedBy.some((item) => item.includes("source_quality"))).toBe(true);
  });

  it("penalizes source_failure URL matches", () => {
    const result = scoreResourceWithMemory({
      query: "Example API auth",
      resource: resource(),
      memoryHints: [memory({ kind: "source_failure", text: "Failed source" })],
    });

    expect(result.scoreDelta).toBeLessThan(0);
    expect(result.matchedBy.some((item) => item.includes("source_failure"))).toBe(true);
  });

  it("lightly boosts durable fact entity matches", () => {
    const result = scoreResourceWithMemory({
      query: "Example API auth",
      resource: resource(),
      memoryHints: [
        memory({
          kind: "durable_fact",
          scope: "project",
          text: "Example API requires OAuth.",
          sourceUrls: [],
          entities: ["Example API"],
        }),
      ],
    });

    expect(result.scoreDelta).toBeGreaterThan(0);
    expect(result.matchedBy.some((item) => item.includes("durable_fact_entity"))).toBe(true);
  });
});
