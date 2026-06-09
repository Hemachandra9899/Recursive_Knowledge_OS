import { describe, expect, it } from "vitest";
import { canonicalizeUrl, contentHash, checkDedupe } from "../crawl-dedupe.js";

describe("canonicalizeUrl", () => {
  it("removes hash fragment", () => {
    expect(canonicalizeUrl("https://example.com/page#section")).toBe(
      "https://example.com/page"
    );
  });

  it("removes trailing slash", () => {
    expect(canonicalizeUrl("https://example.com/docs/auth/")).toBe(
      "https://example.com/docs/auth"
    );
  });

  it("removes www prefix", () => {
    expect(canonicalizeUrl("https://www.example.com/page")).toBe(
      "https://example.com/page"
    );
  });

  it("lowercases hostname", () => {
    expect(canonicalizeUrl("https://Example.com/Auth")).toBe(
      "https://example.com/Auth"
    );
  });

  it("strips utm_ tracking params", () => {
    const result = canonicalizeUrl(
      "https://example.com/page?utm_source=twitter&id=1&utm_campaign=test"
    );
    expect(result).toBe("https://example.com/page?id=1");
  });

  it("strips fbclid, gclid, msclkid, ref, source", () => {
    const result = canonicalizeUrl(
      "https://example.com/page?fbclid=abc&gclid=def&msclkid=ghi&ref=j&source=k&keep=1"
    );
    expect(result).toBe("https://example.com/page?keep=1");
  });

  it("sorts remaining query params alphabetically", () => {
    const result = canonicalizeUrl("https://example.com/page?z=1&a=2&m=3");
    expect(result).toBe("https://example.com/page?a=2&m=3&z=1");
  });

  it("preserves path if no trailing slash", () => {
    expect(canonicalizeUrl("https://example.com/docs/auth")).toBe(
      "https://example.com/docs/auth"
    );
  });

  it("does not remove single slash root", () => {
    expect(canonicalizeUrl("https://example.com/")).toBe("https://example.com/");
  });

  it("handles invalid URL by returning as-is", () => {
    expect(canonicalizeUrl("not-a-url")).toBe("not-a-url");
  });
});

describe("contentHash", () => {
  it("produces a stable 7-char string", () => {
    const hash = contentHash("Hello world");
    expect(hash).toMatch(/^[0-9a-z]{7}$/);
  });

  it("same content gives same hash", () => {
    const a = contentHash("# Title\n\nBody text here for hashing consistency across runs.");
    const b = contentHash("# Title\n\nBody text here for hashing consistency across runs.");
    expect(a).toBe(b);
  });

  it("whitespace differences produce same hash", () => {
    const a = contentHash("line1\n\nline2");
    const b = contentHash("  line1  \n\n  line2  ");
    expect(a).toBe(b);
  });

  it("different content gives different hash", () => {
    const a = contentHash("Some content here for the test to verify uniqueness.");
    const b = contentHash("Different content entirely that should produce another hash.");
    expect(a).not.toBe(b);
  });
});

describe("checkDedupe", () => {
  it("returns new for unseen url and content", () => {
    const urls = new Set<string>();
    const hashes = new Set<string>();
    const result = checkDedupe("https://example.com/page", "# Hello", urls, hashes);
    expect(result.dedupeStatus).toBe("new");
    expect(urls.has(result.canonicalUrl)).toBe(true);
    expect(hashes.has(result.contentHash)).toBe(true);
  });

  it("detects duplicate url across www and no-www", () => {
    const urls = new Set<string>();
    const hashes = new Set<string>();
    checkDedupe("https://example.com/page", "# First", urls, hashes);
    const result = checkDedupe(
      "https://www.example.com/page",
      "# Different content",
      urls,
      hashes
    );
    expect(result.dedupeStatus).toBe("duplicate_url");
  });

  it("detects duplicate url via trailing slash", () => {
    const urls = new Set<string>();
    const hashes = new Set<string>();
    checkDedupe("https://example.com/docs/auth", "# Content", urls, hashes);
    const result = checkDedupe(
      "https://example.com/docs/auth/",
      "# Other content",
      urls,
      hashes
    );
    expect(result.dedupeStatus).toBe("duplicate_url");
  });

  it("detects duplicate content", () => {
    const urls = new Set<string>();
    const hashes = new Set<string>();
    checkDedupe("https://example.com/page1", "# Same content here for testing hash based dedupe.", urls, hashes);
    const result = checkDedupe(
      "https://example.com/page2",
      "# Same content here for testing hash based dedupe.",
      urls,
      hashes
    );
    expect(result.dedupeStatus).toBe("duplicate_content");
  });

  it("different url and content is new", () => {
    const urls = new Set<string>();
    const hashes = new Set<string>();
    checkDedupe("https://example.com/page1", "# First content here.", urls, hashes);
    const result = checkDedupe(
      "https://example.com/page2",
      "# Second content here.",
      urls,
      hashes
    );
    expect(result.dedupeStatus).toBe("new");
  });

  it("tracks tracking params for deduplication", () => {
    const urls = new Set<string>();
    const hashes = new Set<string>();
    checkDedupe("https://example.com/page?id=1", "# Content", urls, hashes);
    const result = checkDedupe(
      "https://example.com/page?utm_source=twitter&id=1",
      "# Other content",
      urls,
      hashes
    );
    expect(result.dedupeStatus).toBe("duplicate_url");
  });
});
