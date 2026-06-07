import { semanticSearchChunks } from "./semantic-search.js";
import { keywordSearchChunks } from "./keyword-search.js";

export async function searchKnowledgeBase(input: {
  projectId?: string;
  query: string;
  topK?: number;
}) {
  try {
    const semanticResults = await semanticSearchChunks(input);

    if (semanticResults.length > 0) {
      return {
        retrieval: "semantic",
        results: semanticResults,
        error: null,
      };
    }
  } catch (error) {
    const keywordResults = await keywordSearchChunks(input);

    return {
      retrieval: "keyword_fallback",
      results: keywordResults,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const keywordResults = await keywordSearchChunks(input);

  return {
    retrieval: "keyword_fallback",
    results: keywordResults,
    error: "No semantic results found.",
  };
}
