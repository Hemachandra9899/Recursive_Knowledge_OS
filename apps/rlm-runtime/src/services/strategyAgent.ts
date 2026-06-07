import type { AnswerStrategy, ChatMessage } from "../types.ts";
import { ModelClient } from "./modelClient.ts";
import { stripMarkdownCodeFence } from "../utils/codeUtils.ts";

const COMPLEX_PATTERNS = [
  "compare",
  "research",
  "analyze",
  "should",
  "best",
  "architecture",
  "approach",
  "method",
  "strategy",
  "crawl",
  "url",
  "docs",
  "repo",
  "benchmark",
  "evaluate",
  "risk",
];

export function shouldUseStrategy(query: string): boolean {
  const q = query.toLowerCase();

  if (q.length > 180) return true;

  return COMPLEX_PATTERNS.some((pattern) => q.includes(pattern));
}

function fallbackStrategy(): AnswerStrategy {
  return {
    enabled: false,
    recommendedMethod: "direct_answer",
    bestMethod: "direct_answer",
    shouldUseTools: false,
    methods: [],
    reason: "Strategy disabled or unavailable.",
  };
}

function parseStrategy(text: string): AnswerStrategy {
  try {
    const cleaned = stripMarkdownCodeFence(text);
    return JSON.parse(cleaned) as AnswerStrategy;
  } catch {
    return fallbackStrategy();
  }
}

export class StrategyAgent {
  constructor(private readonly modelClient = new ModelClient()) {}

  async plan(query: string): Promise<AnswerStrategy> {
    if (!shouldUseStrategy(query)) {
      return fallbackStrategy();
    }

    const messages: ChatMessage[] = [
      {
        role: "system",
        content: `
You are the RLM Forge Strategy Agent.

Your job is NOT to answer the user.
Your job is to choose the safest and most reliable method for answering.

Available methods:
- direct_answer
- search_kb
- crawl_url
- crawl_then_search
- recursive_llm_query
- query_graph
- hybrid_tools

Return JSON only.
No markdown.
No explanation outside JSON.

Schema:
{
  "enabled": true,
  "recommendedMethod": "string",
  "bestMethod": "string",
  "shouldUseTools": boolean,
  "methods": [
    {
      "name": "string",
      "score": number,
      "risk": "string",
      "reason": "string"
    }
  ],
  "reason": "string"
}

Scoring:
- 10 = strongest, evidence-backed
- 1 = weak, likely hallucination

Prefer evidence-based methods for research/comparison questions.
Prefer direct_answer for simple questions.
        `.trim(),
      },
      {
        role: "user",
        content: query,
      },
    ];

    const response = await this.modelClient.chatCoding(messages);
    const parsed = parseStrategy(response);

    return {
      ...parsed,
      enabled: true,
    };
  }
}
