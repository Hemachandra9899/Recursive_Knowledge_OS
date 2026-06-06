import type { ChatMessage } from "../types.ts";
import { ModelClient } from "./modelClient.ts";
import { stripMarkdownCodeFence } from "../utils/codeUtils.ts";

export type UserIntent = {
  kind:
    | "simple_answer"
    | "knowledge_search"
    | "web_research"
    | "comparison"
    | "list"
    | "table"
    | "code"
    | "unknown";
  normalizedQuery: string;
  needsWebResearch: boolean;
  needsKnowledgeSearch: boolean;
  wantsTable: boolean;
  wantsSources: boolean;
  reason: string;
};

function fallbackIntent(query: string): UserIntent {
  const q = query.toLowerCase();

  const wantsTable =
    q.includes("compare") ||
    q.includes("comparison") ||
    q.includes("table") ||
    q.includes("list");

  const needsWebResearch =
    q.includes("api") ||
    q.includes("docs") ||
    q.includes("documentation") ||
    q.includes("latest") ||
    q.includes("current") ||
    q.includes("meta") ||
    q.includes("facebook") ||
    q.includes("ads");

  return {
    kind: wantsTable ? "comparison" : needsWebResearch ? "web_research" : "simple_answer",
    normalizedQuery: query.replace(/\bmets\s+graph\s+api\b/gi, "Meta Graph API"),
    needsWebResearch,
    needsKnowledgeSearch: true,
    wantsTable,
    wantsSources: needsWebResearch,
    reason: "Fallback heuristic intent.",
  };
}

function parseIntent(text: string, originalQuery: string): UserIntent {
  try {
    const parsed = JSON.parse(stripMarkdownCodeFence(text));
    return {
      ...fallbackIntent(originalQuery),
      ...parsed,
      normalizedQuery: parsed.normalizedQuery || originalQuery,
    };
  } catch {
    return fallbackIntent(originalQuery);
  }
}

export class IntentDetector {
  constructor(private readonly modelClient = new ModelClient()) {}

  async detect(query: string): Promise<UserIntent> {
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: `
You are the RLM Forge intent detector.

Return JSON only.

Schema:
{
  "kind": "simple_answer | knowledge_search | web_research | comparison | list | table | code | unknown",
  "normalizedQuery": "string",
  "needsWebResearch": boolean,
  "needsKnowledgeSearch": boolean,
  "wantsTable": boolean,
  "wantsSources": boolean,
  "reason": "string"
}

Rules:
- If user asks about public APIs/docs/companies/products/current info, set needsWebResearch=true.
- If user asks compare/list/table, set wantsTable=true.
- If user asks "mets graph api", normalize to "Meta Graph API".
- For Meta/Facebook ads platform questions, normalize to "Meta Graph API Marketing API ads platform endpoints".
        `.trim(),
      },
      {
        role: "user",
        content: query,
      },
    ];

    try {
      const response = await this.modelClient.chatReasoning(messages);
      return parseIntent(response, query);
    } catch {
      return fallbackIntent(query);
    }
  }
}
