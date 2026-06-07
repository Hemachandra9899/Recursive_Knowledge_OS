import { ModelClient } from "./modelClient.ts";
import { readable } from "./answerUtils.ts";
import type { AnswerSource, ChatMessage, SynthesizedAnswer } from "../types.ts";

function sourceListText(sources: AnswerSource[]): string {
  if (!sources.length) return "No explicit sources extracted.";

  return sources
    .map((source, index) => {
      return `${index + 1}. ${source.title || "Untitled source"} - ${source.url || "no url"}`;
    })
    .join("\n");
}

function looksLikeBadAnswer(answer: string) {
  const lower = answer.toLowerCase();

  return (
    lower.includes("varies") &&
    lower.includes("varies") &&
    lower.includes("varies")
  );
}

export class AnswerSynthesizer {
  constructor(private readonly modelClient = new ModelClient()) {}

  async synthesize(input: {
    query: string;
    rawFinal: unknown;
    stdout: string;
    sources: AnswerSource[];
  }): Promise<SynthesizedAnswer> {
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: [
          "You are RLM Forge's final answer writer.",
          "",
          "Convert retrieved evidence into a clean user-facing answer.",
          "",
          "Rules:",
          "1. Do not output raw chunks, JSON, IDs, metadata, or retrieval objects.",
          '2. Do not use "varies" as a filler.',
          '3. If evidence is missing, write "Not found in retrieved sources" instead.',
          "4. Prefer official documentation over blogs, YouTube, Postman, Reddit, or StackOverflow.",
          "5. For comparison questions, create a markdown table.",
          "6. Table rows must be real products/APIs, not source titles.",
          "7. For ads API comparisons, rows should be:",
          "   - Meta Marketing API",
          "   - Google Ads API",
          "   - TikTok Business/Ads API",
          "8. Columns should match the user's request.",
          "9. Add an MVP recommendation after the table.",
          "10. Add a Sources section at the bottom with title + URL.",
          "11. Be concise, practical, and implementation-focused.",
        ].join("\n"),
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
          "Write the final answer now.",
        ].join("\n"),
      },
    ];

    const answer = await this.modelClient.chatReasoning(messages);

    if (looksLikeBadAnswer(answer)) {
      return {
        answer: [
          "I found sources, but the retrieved evidence was not strong enough to produce a reliable comparison.",
          "",
          "Please retry with official documentation only, or ask me to research each API separately first.",
        ].join("\n"),
        sources: input.sources,
      };
    }

    return {
      answer,
      sources: input.sources,
    };
  }
}