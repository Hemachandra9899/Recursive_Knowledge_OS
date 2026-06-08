import type { AnswerMode } from "./source-types.js";

export function detectAnswerMode(query: string, useCase?: string): AnswerMode {
  const q = query.toLowerCase();

  if (
    /\b(compare|comparison|versus|vs\.?|difference|differences|better|pros and cons|trade[\-\s]?off|tradeoff)\b/.test(q) ||
    useCase === "comparison"
  ) {
    return "comparison";
  }

  if (
    /\b(how to|implement|implementation|fix|debug|setup|set up|configure|install|integrate|deploy|error|issue|steps|guide)\b/.test(q) ||
    useCase === "implementation_help" ||
    useCase === "tutorial"
  ) {
    return "how_to";
  }

  if (
    /\b(overview|summarize|summary|explain|what is|research|tell me about|deep dive|analysis)\b/.test(q)
  ) {
    return "research_summary";
  }

  return "general";
}
