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
