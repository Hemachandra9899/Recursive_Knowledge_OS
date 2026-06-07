import { ModelClient } from "./modelClient.ts";
import { readable } from "./answerUtils.ts";
import type { AnswerSource, ChatMessage, SynthesizedAnswer } from "../types.ts";
import {
  inferStrategyType,
  parseStrategyOutput,
  renderStrategyOutput,
  STRATEGY_GUIDANCE,
} from "./strategyTemplates.ts";

const ANSWER_SYNTHESIS_PROMPT = `
You are RLM Forge's final answer writer.

Write a useful answer from retrieved evidence.

Rules:
1. Never output raw chunks, JSON, IDs, metadata, scores, or retrieval objects.
2. Never use vague filler like "varies" or placeholder phrases.
3. If evidence is missing, write "Not found in retrieved sources".
4. Prefer official/trusted docs for API facts, permissions, rate limits, pricing, and capability comparisons.
5. Community/example/media sources may be useful for tutorials, bugs, examples, and workarounds.
6. For comparison questions, use a markdown table.
7. Table rows must be actual products/APIs/entities from the user question, not source titles.
8. Columns should match the user request.
9. Add a short recommendation or next-step plan when useful.
10. End with "Sources" and list title + URL only.
`.trim();

function sourceListText(sources: AnswerSource[]): string {
  if (!sources.length) return "No explicit sources extracted.";

  return sources
    .map((source, index) => {
      return `${index + 1}. ${source.title || "Untitled source"} — ${source.url || "no url"}`;
    })
    .join("\n");
}

function looksLikeBadAnswer(answer: string) {
  const lower = answer.toLowerCase();

  const variesCount = (lower.match(/\bvaries\b/g) || []).length;

  const weakSourceRows =
    lower.includes("youtube") ||
    lower.includes("postman") ||
    lower.includes("stackoverflow") ||
    lower.includes("medium.com") ||
    lower.includes("reddit.com");

  const hasEmptyTable =
    lower.includes("| - |") ||
    lower.includes("|—|") ||
    lower.includes("| ?");

  const hasHallucinatedNumbers = /\b\d{4,}\b/.test(answer) && /\b(?:api|version|endpoint)\b/.test(lower);

  const containsJsonDump =
    lower.includes('"retrieval"') ||
    lower.includes('"sources"') ||
    lower.includes('"final"') ||
    (lower.includes('"type"') && lower.includes('"output"'));

  return variesCount >= 3 || weakSourceRows || hasEmptyTable || hasHallucinatedNumbers || containsJsonDump;
}

export class AnswerSynthesizer {
  constructor(private readonly modelClient = new ModelClient()) {}

  async synthesize(input: {
    query: string;
    rawFinal: unknown;
    stdout: string;
    sources: AnswerSource[];
  }): Promise<SynthesizedAnswer> {
    const strategyType = inferStrategyType(input.query);
    let guidance = "";

    if (strategyType) {
      guidance = `\n\nPrefer structured output format:\n${STRATEGY_GUIDANCE[strategyType]}`;
    }

    const messages: ChatMessage[] = [
      {
        role: "system",
        content: ANSWER_SYNTHESIS_PROMPT + guidance,
      },
      {
        role: "user",
        content: [
          `User question:`,
          input.query,
          "",
          "Raw final:",
          readable(input.rawFinal),
          "",
          "Execution stdout:",
          input.stdout,
          "",
          "Extracted sources:",
          sourceListText(input.sources),
          "",
          "Write the final clean answer now.",
        ].join("\n"),
      },
    ];

    let answer = await this.modelClient.chatReasoning(messages);

    const structured = parseStrategyOutput(answer);
    if (structured) {
      answer = renderStrategyOutput(structured);
    }

    if (looksLikeBadAnswer(answer)) {
      const retryMessages: ChatMessage[] = [
        {
          role: "system",
          content: `${ANSWER_SYNTHESIS_PROMPT}

The previous answer was bad. Reasons may include:
- Source titles used as table rows instead of real products/APIs
- "varies" used as filler in table cells
- Weak source URLs (YouTube, Postman, StackOverflow) dominating
- Empty or malformed table cells
- Raw JSON dumps mixed into the answer

Fix all of these. Use real product/API names as rows. Mark missing data exactly as "Not found in retrieved sources".`,
        },
        {
          role: "user",
          content: [
            `User question:`,
            input.query,
            "",
            "Evidence:",
            readable(input.rawFinal),
            "",
            "Stdout:",
            input.stdout,
            "",
            "Sources:",
            sourceListText(input.sources),
            "",
            "Write a corrected answer now. Do not use source titles as rows. Do not use 'varies'.",
          ].join("\n"),
        },
      ];

      const corrected = await this.modelClient.chatReasoning(retryMessages);

      const correctedStructured = parseStrategyOutput(corrected);
      const finalAnswer = correctedStructured
        ? renderStrategyOutput(correctedStructured)
        : corrected;

      return {
        answer: finalAnswer,
        sources: input.sources,
      };
    }

    const lines = [answer, "", "### Sources", ""];
    for (const source of input.sources) {
      if (source.url) {
        lines.push(`- [${source.title || "Source"}](${source.url})`);
      }
    }
    const answerWithSources = lines.join("\n");

    return {
      answer: answerWithSources,
      sources: input.sources,
    };
  }
}
