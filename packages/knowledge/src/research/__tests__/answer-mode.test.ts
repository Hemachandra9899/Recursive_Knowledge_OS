import { describe, expect, it } from "vitest";
import { detectAnswerMode } from "../answer-mode.js";

describe("detectAnswerMode", () => {
  it("detects comparison queries", () => {
    expect(detectAnswerMode("Compare Meta Ads API vs Google Ads API")).toBe("comparison");
  });

  it("detects how-to queries", () => {
    expect(detectAnswerMode("How to authenticate with Brand.dev API?")).toBe("how_to");
  });

  it("detects research summary queries", () => {
    expect(detectAnswerMode("Give me an overview of Mem0 memory architecture")).toBe(
      "research_summary"
    );
  });

  it("uses useCase as a fallback signal", () => {
    expect(detectAnswerMode("Meta and Google", "comparison")).toBe("comparison");
  });
});
